// 客户端插件热卸载与热挂载工具：供创造模式热同步、推荐卡片创建/打开/恢复复用。
import { requestPluginPanels } from "../PluginSlotView";
import { useLayoutStore } from "../state/layoutStore";
import { pluginHotMountRef } from "../state/sharedRefs";
import { clientHost } from "./clientHostSingleton.ts";
import { clientRuntime, loadBundleScript, loadedBundle } from "./index.ts";

export interface HotMountResult {
  id: string;
  name?: string;
  ok: boolean;
  hasClient: boolean;
  slots: string[];
  error?: string;
}

function appendHotRev(rawUrl: string, rev: string): string {
  return rawUrl.includes("?")
    ? `${rawUrl}&hot=${encodeURIComponent(rev)}`
    : `${rawUrl}?hot=${encodeURIComponent(rev)}`;
}

function resolveContributionLabel(meta: Record<string, unknown>, fallback: string): string {
  const raw = meta?.label;
  if (typeof raw === "function") {
    try {
      return String((raw as () => unknown)());
    } catch {
      return fallback;
    }
  }
  return String(raw ?? meta?.id ?? fallback);
}

/** 从客户端宿主与模块加载器卸载指定插件（同时兼容 entry.id 与 package name） */
export async function unmountClientPlugin(idOrName: string, extraName = ""): Promise<void> {
  const keys = [...new Set([idOrName, extraName].map((item) => String(item || "").trim()).filter(Boolean))];
  if (!keys.length) return;
  const host = clientHost();
  const loader = clientRuntime().loader;
  for (const key of keys) {
    try {
      await host.unload(key);
    } catch {
      // 忽略尚未挂载时的卸载错误
    }
    try {
      loader.invalidate(key);
    } catch {
      // 忽略模块失效清理错误
    }
  }
}

/** 激活插件贡献的界面插槽 */
export function activateClientPluginSlot(
  pluginId: string,
  preferredSlot?: string,
  slotKey?: string,
): string | null {
  const id = String(pluginId || "").trim();
  if (!id) return null;
  const host = clientHost();
  const order = preferredSlot && ["sidebar.right.pane.tab", "workspace.page", "conversation.view"].includes(preferredSlot)
    ? [preferredSlot, "sidebar.right.pane.tab", "workspace.page", "conversation.view"].filter((v, i, arr) => arr.indexOf(v) === i)
    : ["sidebar.right.pane.tab", "workspace.page", "conversation.view"];

  const layout = useLayoutStore.getState();

  for (const slot of order) {
    const contributions = host.contributionsFor(slot).filter((item) => item.pluginId === id);
    if (!contributions.length) continue;

    if (slot === "sidebar.right.pane.tab") {
      layout.setPluginsPageOpen(false);
      layout.setBotTeamPageOpen(false);
      requestPluginPanels(id, ["sidebar.right.pane.tab"], { open: true });
      return slot;
    }

    const picked = slotKey
      ? contributions.find((item) => String(item.meta?.key ?? item.meta?.id ?? "") === slotKey) || contributions[0]
      : contributions[0];
    const key = String(picked.meta?.key ?? picked.meta?.id ?? "");
    if (!key) continue;
    const label = resolveContributionLabel(picked.meta || {}, id);

    if (slot === "workspace.page") {
      layout.setPluginsPageOpen(false);
      layout.setBotTeamPageOpen(false);
      layout.setActiveWorkspacePage({ pluginId: id, key, label });
      return slot;
    }

    if (slot === "conversation.view") {
      layout.setPluginsPageOpen(false);
      layout.setBotTeamPageOpen(false);
      layout.setActiveWorkspacePage(null);
      layout.setConversationView(key);
      return slot;
    }
  }
  return null;
}

/** 重新拉取并热挂载指定插件的客户端半边；可选自动切换到其贡献的 UI 插槽 */
export async function mountClientPlugin(
  idOrName: string,
  options: {
    bridge?: any;
    openSlot?: boolean | string;
    slotKey?: string;
  } = {},
): Promise<HotMountResult> {
  const bridge = options.bridge ?? (globalThis as any).dyworker;
  const rawTarget = String(idOrName || "").trim();
  if (!rawTarget || !bridge?.pluginClientBundles) {
    return { id: rawTarget, ok: false, hasClient: false, slots: [], error: "插件宿主桥接不可用" };
  }

  let entryId = rawTarget;
  let pkgName = rawTarget;
  try {
    const entries = await bridge.listPlugins?.();
    if (Array.isArray(entries)) {
      const matched = entries.find((item: any) =>
        item && (item.id === rawTarget || item.name === rawTarget));
      if (matched) {
        entryId = String(matched.id || rawTarget);
        pkgName = String(matched.name || matched.id || rawTarget);
        if (matched.disabled) {
          await unmountClientPlugin(entryId, pkgName);
          return { id: entryId, name: pkgName, ok: true, hasClient: Boolean(matched.client), slots: [] };
        }
      }
    }
  } catch {
    // 列举失败时仍按原始目标尝试
  }

  await unmountClientPlugin(entryId, pkgName);

  let info = await bridge.pluginClientBundles(entryId);
  if (!info?.ok && pkgName !== entryId) {
    const alt = await bridge.pluginClientBundles(pkgName);
    if (alt?.ok || alt?.entries?.length) info = alt;
  }

  const infoError = String(info?.error || "");
  if (!info?.ok && /没有声明客户端半边/.test(infoError)) {
    return { id: entryId, name: pkgName, ok: true, hasClient: false, slots: [] };
  }
  const entries = Array.isArray(info?.entries) ? info.entries : [];
  if (!info?.ok || !entries.length) {
    return {
      id: entryId,
      name: pkgName,
      ok: false,
      hasClient: false,
      slots: [],
      error: infoError || "未能解析插件客户端入口",
    };
  }

  const rev = String(Date.now());
  const secondary = entries.filter((item: any) => !item?.primary && item?.url);
  const primary = entries.find((item: any) => item?.primary && item?.url) || entries.find((item: any) => item?.url);
  if (!primary?.url) {
    return { id: entryId, name: pkgName, ok: true, hasClient: false, slots: [] };
  }

  try {
    for (const mod of secondary) {
      await loadBundleScript(appendHotRev(String(mod.url), rev));
    }
    let record;
    try {
      record = await loadBundleScript(appendHotRev(String(primary.url), rev));
    } catch (loadError) {
      record = loadedBundle(String(info?.name || pkgName)) || loadedBundle(pkgName) || loadedBundle(entryId);
      if (!record) throw loadError;
    }
    if (record.error) {
      return { id: entryId, name: pkgName, ok: false, hasClient: true, slots: [], error: record.error };
    }
    const exportsValue = record.exports;
    if (!exportsValue) {
      return {
        id: entryId,
        name: pkgName,
        ok: false,
        hasClient: true,
        slots: [],
        error: record.error || "插件客户端模块未导出有效对象",
      };
    }
    const applied = await clientHost().load(exportsValue, entryId);
    if (!applied.ok) {
      return {
        id: entryId,
        name: pkgName,
        ok: false,
        hasClient: true,
        slots: applied.slots || [],
        error: applied.error || "插件客户端挂载失败",
      };
    }
    if (options.openSlot) {
      activateClientPluginSlot(
        entryId,
        typeof options.openSlot === "string" ? options.openSlot : undefined,
        options.slotKey,
      );
    }
    return {
      id: entryId,
      name: pkgName,
      ok: true,
      hasClient: true,
      slots: applied.slots || [],
    };
  } catch (error: any) {
    return {
      id: entryId,
      name: pkgName,
      ok: false,
      hasClient: true,
      slots: [],
      error: String(error?.message || error),
    };
  }
}

pluginHotMountRef.current = {
  mountClientPlugin,
  activateClientPluginSlot,
  unmountClientPlugin,
};
