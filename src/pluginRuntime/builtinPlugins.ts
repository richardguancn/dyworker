// 内置插件（随应用分发、默认启用、可在插件页停用）的客户端半边自动加载。
//
// 为什么需要：内置插件的界面要走我们自己的客户端运行时（模块加载器 + cordis 容器），
// 但它没有"添加插件"时的那个手动按钮——内置就该开机即用。这里在启动后把它们逐个装载：
//   1. 取插件清单，挑出 builtin && !disabled && 有客户端半边的条目
//   2. 按依赖顺序加载它声明的客户端模块
//   3. 加载插件 bundle 并交给客户端 cordis 容器 apply
//
// 失败只记录不抛：某个内置插件坏了不该影响应用启动。

import { installClientRuntime, loadBundleScript, loadedBundle } from "./index.ts";
import { clientHost } from "./clientHostSingleton.ts";

export interface BuiltinLoadResult {
  id: string;
  ok: boolean;
  slots: string[];
  error?: string;
}

export async function loadBuiltinClientHalves(bridge: any = (globalThis as any).dyworker, includeExternal = false): Promise<BuiltinLoadResult[]> {
  const results: BuiltinLoadResult[] = [];
  if (!bridge?.listPlugins) return results;

  let entries: any[] = [];
  try {
    const list = await bridge.listPlugins();
    entries = Array.isArray(list?.entries) ? list.entries : [];
  } catch {
    return results;
  }

  // 必须用**单例**运行时：createClientRuntime() 会新建一个实例并覆盖 window.__ModuleLoader__，
  // 而 loadBundleScript 读的是单例——bundle 会注册到新实例、我们从单例里找，结果永远是
  // "新增注册 0 个"，插件界面出不来（实测就是这个）。
  installClientRuntime();

  for (const entry of entries) {
    if ((!entry?.builtin && !(includeExternal && entry.client)) || entry.disabled) continue;
    try {
      const info = await bridge.pluginClientBundles(entry.id);
      if (!info?.ok) {
        results.push({ id: entry.id, ok: false, slots: [], error: info?.error || "没有客户端半边" });
        continue;
      }
      const moduleErrors: string[] = [];
      for (const moduleRef of info.modules || []) {
        try {
          const loaded = loadedBundle(moduleRef.spec) || await loadBundleScript(moduleRef.url);
          // 单个模块失败不能静默：插件运行时 require 到它就会报"宿主未提供该模块"，
          // 而真正的原因藏在这里（脚本取不到 / 执行抛错）。
          if (loaded?.error) moduleErrors.push(`${moduleRef.spec}: ${loaded.error}`);
        } catch (error: any) {
          moduleErrors.push(`${moduleRef.spec}: ${String(error?.message || error)}`);
        }
      }
      if (moduleErrors.length) console.warn(`[plugin] 内置插件的客户端模块加载失败（${moduleErrors.length} 个）：${moduleErrors.slice(0, 3).join(" ｜ ")}`);
      const primary = info.entries?.find((item: any) => item.primary) || info.entries?.[0];
      if (!primary) {
        results.push({ id: entry.id, ok: false, slots: [], error: "没有客户端入口" });
        continue;
      }
      // 它可能已经作为别人的依赖模块加载过了：这时按包名复用，而不是当成失败
      let record = loadedBundle(info.name);
      if (!record) {
        try {
          record = await loadBundleScript(primary.url);
        } catch (error: any) {
          record = loadedBundle(info.name);
          if (!record) {
            results.push({ id: entry.id, ok: false, slots: [], error: String(error?.message || error) });
            continue;
          }
        }
      }
      if (record.error) {
        results.push({ id: entry.id, ok: false, slots: [], error: record.error });
        continue;
      }
      const applied = await clientHost().load(record.exports, entry.id);
      results.push({ id: entry.id, ok: applied.ok, slots: applied.slots, error: applied.error });
    } catch (error: any) {
      results.push({ id: entry.id, ok: false, slots: [], error: String(error?.message || error) });
    }
  }
  // 内置插件不多，结果留一行日志：出问题时这是唯一的线索
  if (results.length) {
    console.log("[plugin] 内置插件客户端半边：", results.map((r) => `${r.id} ${r.ok ? "✓" : `✗ ${r.error}`} 插槽[${r.slots.join(",")}]`).join("；"));
  }
  return results;
}

export const loadEnabledClientHalves = (bridge?: any) => loadBuiltinClientHalves(bridge, true);
