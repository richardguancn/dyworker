// 内置插件（随应用分发、默认启用、可在插件页停用）的客户端半边自动加载。
//
// 为什么需要：内置插件的界面要走我们自己的客户端运行时（模块加载器 + cordis 容器），
// 但它没有"添加插件"时的那个手动按钮——内置就该开机即用。这里在启动后把它们逐个装载：
//   1. 取插件清单，挑出 builtin && !disabled && 有客户端半边的条目
//   2. 按依赖顺序加载它声明的客户端模块
//   3. 加载插件 bundle 并交给客户端 cordis 容器 apply
//
// 失败只记录不抛：某个内置插件坏了不该影响应用启动。

import { createClientRuntime, loadBundleScript } from "./index.ts";
import { clientHost } from "./clientHostSingleton.ts";

export interface BuiltinLoadResult {
  id: string;
  ok: boolean;
  slots: string[];
  error?: string;
}

export async function loadBuiltinClientHalves(bridge: any = (globalThis as any).dyworker): Promise<BuiltinLoadResult[]> {
  const results: BuiltinLoadResult[] = [];
  if (!bridge?.listPlugins) return results;

  let entries: any[] = [];
  try {
    const list = await bridge.listPlugins();
    entries = Array.isArray(list?.entries) ? list.entries : [];
  } catch {
    return results;
  }

  createClientRuntime(); // 确保运行时（window.__ModuleLoader__ + /api 桥）已装好

  for (const entry of entries) {
    if (!entry?.builtin || entry.disabled) continue;
    try {
      const info = await bridge.pluginClientBundles(entry.id);
      if (!info?.ok) {
        results.push({ id: entry.id, ok: false, slots: [], error: info?.error || "没有客户端半边" });
        continue;
      }
      for (const moduleRef of info.modules || []) {
        try {
          await loadBundleScript(moduleRef.url);
        } catch {
          // 单个模块失败：继续，插件自身可能不依赖它
        }
      }
      const primary = info.entries?.find((item: any) => item.primary) || info.entries?.[0];
      if (!primary) {
        results.push({ id: entry.id, ok: false, slots: [], error: "没有客户端入口" });
        continue;
      }
      const record = await loadBundleScript(primary.url);
      if (record.error) {
        results.push({ id: entry.id, ok: false, slots: [], error: record.error });
        continue;
      }
      const applied = await clientHost().load(record.exports, record.id || entry.id);
      results.push({ id: entry.id, ok: applied.ok, slots: applied.slots, error: applied.error });
    } catch (error: any) {
      results.push({ id: entry.id, ok: false, slots: [], error: String(error?.message || error) });
    }
  }
  return results;
}
