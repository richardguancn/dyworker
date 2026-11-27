// 布局 / 外壳 / 可见性 / 菜单类 state 的 zustand store。
// 从 App.tsx 的 useState 逐字段搬来，字段名与同名 setter 保持不变，
// 使用点一次解构即可继续复用原有变量名。
import { create } from "zustand";
import type { BrowserViewportState } from "../features/browser/browserViewport.ts";
import type { PluginBundleRecord, PluginEntryRecord } from "../types.ts";
import { updateField, type Updater } from "./updateField.ts";

export type PluginBundleVisual = {
  displayName?: string;
  author?: string;
  icon?: string;
  iconColor?: string;
};

/** 将插件列表返回的包级外观元数据索引为 Map，供侧栏/顶栏/右侧工具栏按 pluginId 或 packageName 读取 */
export function buildPluginBundleVisualMap(
  list: { entries?: PluginEntryRecord[]; bundles?: PluginBundleRecord[] } | null | undefined,
): Record<string, PluginBundleVisual> {
  const map: Record<string, PluginBundleVisual> = {};
  const entries = Array.isArray(list?.entries) ? list!.entries : [];
  const bundles = Array.isArray(list?.bundles) ? list!.bundles : [];
  for (const bundle of bundles) {
    if (!bundle) continue;
    const visual: PluginBundleVisual = {
      ...(bundle.displayName ? { displayName: bundle.displayName } : {}),
      ...(bundle.author ? { author: bundle.author } : {}),
      ...(bundle.icon ? { icon: bundle.icon } : {}),
      ...(bundle.iconColor ? { iconColor: bundle.iconColor } : {}),
    };
    if (!visual.displayName && !visual.author && !visual.icon && !visual.iconColor) continue;
    for (const key of [bundle.packageName, bundle.name]) {
      if (key) map[key] = visual;
    }
    for (const entry of entries) {
      if (entry && (entry.name === bundle.name || entry.name === bundle.packageName || entry.id === bundle.name || entry.id === bundle.packageName)) {
        if (entry.id) map[entry.id] = visual;
        if (entry.name) map[entry.name] = visual;
      }
    }
  }
  return map;
}

export type ToolPanelTab = {
  id: string;
  kind: "browser" | "files" | "review" | "chat" | "tasks" | "plugin" | "preview";
  filePath?: string;
  previewWorkspacePath?: string;
  previewRevision?: number;
  /** kind === "plugin"：插件登记的右侧面板标签（sidebar.right.pane.tab 插槽） */
  pluginId?: string;
  pluginKey?: string;
  title: string;
  url?: string;
  loadedUrl?: string;
  // 浏览器标签页实时状态：随 webview 导航事件同步
  favicon?: string;
  loading?: boolean;
  loadError?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  zoom?: number;
  /** 当前站点已保存的密码条数（dom-ready 时探测，用于填充提示） */
  fillHint?: number;
  /** 设备模拟（手机/平板视图） */
  device?: { name: string; width: number; height: number };
  /** 响应式/设备视口工具栏状态（Codex 风格） */
  viewport?: BrowserViewportState;
  /** 普通浏览态下，窄窗口是否自动缩放适配桌面宽度（缺省为 true） */
  autoFitDesktop?: boolean;
};

export const CHAT_CONTENT_WIDTH_KEY = "dyworker_chat_content_width";
export const CHAT_CONTENT_WIDTH_DEFAULT = 740;
export const CHAT_CONTENT_WIDTH_MIN = 560;
export const CHAT_CONTENT_WIDTH_MAX = 2400;

export function clampChatContentWidth(value: number, maxWidth = CHAT_CONTENT_WIDTH_MAX): number {
  if (!Number.isFinite(value)) return CHAT_CONTENT_WIDTH_DEFAULT;
  const upper = Math.max(CHAT_CONTENT_WIDTH_MIN, Math.floor(Number.isFinite(maxWidth) ? maxWidth : CHAT_CONTENT_WIDTH_MAX));
  return Math.min(upper, Math.max(CHAT_CONTENT_WIDTH_MIN, Math.round(value)));
}

export function computeSymmetricChatWidth(
  edge: "chat-left" | "chat-right",
  startWidth: number,
  startX: number,
  currentX: number,
  maxWidth = CHAT_CONTENT_WIDTH_MAX,
): number {
  const delta = edge === "chat-left" ? (startX - currentX) * 2 : (currentX - startX) * 2;
  return clampChatContentWidth(startWidth + delta, maxWidth);
}

export function readSavedChatContentWidth(storage?: Pick<Storage, "getItem"> | null): number {
  try {
    const store = storage === undefined ? (typeof localStorage === "undefined" ? null : localStorage) : storage;
    const raw = store?.getItem(CHAT_CONTENT_WIDTH_KEY);
    if (!raw) return CHAT_CONTENT_WIDTH_DEFAULT;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return CHAT_CONTENT_WIDTH_DEFAULT;
    return clampChatContentWidth(parsed);
  } catch {
    return CHAT_CONTENT_WIDTH_DEFAULT;
  }
}

export function persistChatContentWidth(width: number, storage?: Pick<Storage, "setItem"> | null): void {
  try {
    const store = storage === undefined ? (typeof localStorage === "undefined" ? null : localStorage) : storage;
    store?.setItem(CHAT_CONTENT_WIDTH_KEY, String(clampChatContentWidth(width)));
  } catch {
    // 存储不可用时忽略
  }
}

export interface LayoutState {
  sidebarOpen: boolean;
  setSidebarOpen: (value: Updater<boolean>) => void;
  sidebarWidth: number;
  setSidebarWidth: (value: Updater<number>) => void;
  toolPanelWidth: number;
  setToolPanelWidth: (value: Updater<number>) => void;
  chatContentWidth: number;
  setChatContentWidth: (value: Updater<number>) => void;
  viewportWidth: number;
  setViewportWidth: (value: Updater<number>) => void;
  rightPanelOpen: boolean;
  setRightPanelOpen: (value: Updater<boolean>) => void;

  toolPanelTabs: ToolPanelTab[];
  setToolPanelTabs: (value: Updater<ToolPanelTab[]>) => void;
  toolPanelTabOverflow: { start: boolean; end: boolean };
  setToolPanelTabOverflow: (value: Updater<{ start: boolean; end: boolean }>) => void;
  activeToolPanelTabId: string;
  setActiveToolPanelTabId: (value: Updater<string>) => void;
  toolPanelMenuOpen: boolean;
  setToolPanelMenuOpen: (value: Updater<boolean>) => void;
  toolPanelAddMenuOpen: boolean;
  setToolPanelAddMenuOpen: (value: Updater<boolean>) => void;

  settingsOpen: boolean;
  setSettingsOpen: (value: Updater<boolean>) => void;
  addMenuOpen: boolean;
  setAddMenuOpen: (value: Updater<boolean>) => void;
  modelMenuOpen: boolean;
  setModelMenuOpen: (value: Updater<boolean>) => void;
  approvalMenuOpen: boolean;
  setApprovalMenuOpen: (value: Updater<boolean>) => void;
  railMenuOpen: boolean;
  setRailMenuOpen: (value: Updater<boolean>) => void;
  topMenuOpen: boolean;
  setTopMenuOpen: (value: Updater<boolean>) => void;
  conversationToolsOpen: boolean;
  setConversationToolsOpen: (value: Updater<boolean>) => void;

  sessionMenuId: string | null;
  setSessionMenuId: (value: Updater<string | null>) => void;
  workspaceMenuPath: string | null;
  setWorkspaceMenuPath: (value: Updater<string | null>) => void;
  renamingId: string | null;
  setRenamingId: (value: Updater<string | null>) => void;

  pluginsPageOpen: boolean;
  setPluginsPageOpen: (value: Updater<boolean>) => void;
  botTeamPageOpen: boolean;
  setBotTeamPageOpen: (value: Updater<boolean>) => void;
  botTeamAvailable: boolean;
  setBotTeamAvailable: (value: Updater<boolean>) => void;
  pluginWorkspacePages: Array<{ pluginId: string; key: string; label: string; icon?: string; iconColor?: string }>;
  setPluginWorkspacePages: (value: Updater<Array<{ pluginId: string; key: string; label: string; icon?: string; iconColor?: string }>>) => void;
  pluginBundleVisuals: Record<string, PluginBundleVisual>;
  setPluginBundleVisuals: (value: Updater<Record<string, PluginBundleVisual>>) => void;
  activeWorkspacePage: { pluginId: string; key: string; label: string; icon?: string; iconColor?: string } | null;
  setActiveWorkspacePage: (value: Updater<{ pluginId: string; key: string; label: string; icon?: string; iconColor?: string } | null>) => void;

  conversationView: string;
  setConversationView: (value: Updater<string>) => void;
  pluginConversationViews: Array<{ key: string; label: string }>;
  setPluginConversationViews: (value: Updater<Array<{ key: string; label: string }>>) => void;

  showArchived: boolean;
  setShowArchived: (value: Updater<boolean>) => void;
  workspaceOpen: boolean;
  setWorkspaceOpen: (value: Updater<boolean>) => void;
  workspaceGroupOpen: Record<string, boolean>;
  setWorkspaceGroupOpen: (value: Updater<Record<string, boolean>>) => void;
  workspaceSessionVisibleCounts: Record<string, number>;
  setWorkspaceSessionVisibleCounts: (value: Updater<Record<string, number>>) => void;

  terminalOpen: boolean;
  setTerminalOpen: (value: Updater<boolean>) => void;
  terminalMounted: boolean;
  setTerminalMounted: (value: Updater<boolean>) => void;
  terminalAvailable: boolean;
  setTerminalAvailable: (value: Updater<boolean>) => void;
  debugOpen: boolean;
  setDebugOpen: (value: Updater<boolean>) => void;

  appUpdateDialogOpen: boolean;
  setAppUpdateDialogOpen: (value: Updater<boolean>) => void;
}

const initialToolPanelWidth = () => {
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  return Math.min(520, Math.max(340, Math.round(viewportWidth * 0.28)));
};

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarOpen: typeof window === "undefined" || window.innerWidth > 820,
  setSidebarOpen: (value) => set((s) => updateField(s, "sidebarOpen", value)),
  sidebarWidth: 240,
  setSidebarWidth: (value) => set((s) => updateField(s, "sidebarWidth", value)),
  toolPanelWidth: initialToolPanelWidth(),
  setToolPanelWidth: (value) => set((s) => updateField(s, "toolPanelWidth", value)),
  chatContentWidth: readSavedChatContentWidth(),
  setChatContentWidth: (value) => set((s) => updateField(s, "chatContentWidth", value)),
  viewportWidth: typeof window === "undefined" ? 1280 : window.innerWidth,
  setViewportWidth: (value) => set((s) => updateField(s, "viewportWidth", value)),
  rightPanelOpen: false,
  setRightPanelOpen: (value) => set((s) => updateField(s, "rightPanelOpen", value)),

  toolPanelTabs: [],
  setToolPanelTabs: (value) => set((s) => updateField(s, "toolPanelTabs", value)),
  toolPanelTabOverflow: { start: false, end: false },
  setToolPanelTabOverflow: (value) => set((s) => updateField(s, "toolPanelTabOverflow", value)),
  activeToolPanelTabId: "",
  setActiveToolPanelTabId: (value) => set((s) => updateField(s, "activeToolPanelTabId", value)),
  toolPanelMenuOpen: false,
  setToolPanelMenuOpen: (value) => set((s) => updateField(s, "toolPanelMenuOpen", value)),
  toolPanelAddMenuOpen: false,
  setToolPanelAddMenuOpen: (value) => set((s) => updateField(s, "toolPanelAddMenuOpen", value)),

  settingsOpen: false,
  setSettingsOpen: (value) => set((s) => updateField(s, "settingsOpen", value)),
  addMenuOpen: false,
  setAddMenuOpen: (value) => set((s) => updateField(s, "addMenuOpen", value)),
  modelMenuOpen: false,
  setModelMenuOpen: (value) => set((s) => updateField(s, "modelMenuOpen", value)),
  approvalMenuOpen: false,
  setApprovalMenuOpen: (value) => set((s) => updateField(s, "approvalMenuOpen", value)),
  railMenuOpen: false,
  setRailMenuOpen: (value) => set((s) => updateField(s, "railMenuOpen", value)),
  topMenuOpen: false,
  setTopMenuOpen: (value) => set((s) => updateField(s, "topMenuOpen", value)),
  conversationToolsOpen: false,
  setConversationToolsOpen: (value) => set((s) => updateField(s, "conversationToolsOpen", value)),

  sessionMenuId: null,
  setSessionMenuId: (value) => set((s) => updateField(s, "sessionMenuId", value)),
  workspaceMenuPath: null,
  setWorkspaceMenuPath: (value) => set((s) => updateField(s, "workspaceMenuPath", value)),
  renamingId: null,
  setRenamingId: (value) => set((s) => updateField(s, "renamingId", value)),

  pluginsPageOpen: false,
  setPluginsPageOpen: (value) => set((s) => updateField(s, "pluginsPageOpen", value)),
  botTeamPageOpen: false,
  setBotTeamPageOpen: (value) => set((s) => updateField(s, "botTeamPageOpen", value)),
  botTeamAvailable: false,
  setBotTeamAvailable: (value) => set((s) => updateField(s, "botTeamAvailable", value)),
  pluginWorkspacePages: [],
  setPluginWorkspacePages: (value) => set((s) => updateField(s, "pluginWorkspacePages", value)),
  pluginBundleVisuals: {},
  setPluginBundleVisuals: (value) => set((s) => updateField(s, "pluginBundleVisuals", value)),
  activeWorkspacePage: null,
  setActiveWorkspacePage: (value) => set((s) => updateField(s, "activeWorkspacePage", value)),

  conversationView: "chat",
  setConversationView: (value) => set((s) => updateField(s, "conversationView", value)),
  pluginConversationViews: [],
  setPluginConversationViews: (value) => set((s) => updateField(s, "pluginConversationViews", value)),

  showArchived: false,
  setShowArchived: (value) => set((s) => updateField(s, "showArchived", value)),
  workspaceOpen: true,
  setWorkspaceOpen: (value) => set((s) => updateField(s, "workspaceOpen", value)),
  workspaceGroupOpen: {},
  setWorkspaceGroupOpen: (value) => set((s) => updateField(s, "workspaceGroupOpen", value)),
  workspaceSessionVisibleCounts: {},
  setWorkspaceSessionVisibleCounts: (value) => set((s) => updateField(s, "workspaceSessionVisibleCounts", value)),

  terminalOpen: false,
  setTerminalOpen: (value) => set((s) => updateField(s, "terminalOpen", value)),
  terminalMounted: false,
  setTerminalMounted: (value) => set((s) => updateField(s, "terminalMounted", value)),
  terminalAvailable: false,
  setTerminalAvailable: (value) => set((s) => updateField(s, "terminalAvailable", value)),
  debugOpen: false,
  setDebugOpen: (value) => set((s) => updateField(s, "debugOpen", value)),

  appUpdateDialogOpen: false,
  setAppUpdateDialogOpen: (value) => set((s) => updateField(s, "appUpdateDialogOpen", value)),
}));
