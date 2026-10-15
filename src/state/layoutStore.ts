// 布局 / 外壳 / 可见性 / 菜单类 state 的 zustand store。
// 从 App.tsx 的 useState 逐字段搬来，字段名与同名 setter 保持不变，
// 使用点一次解构即可继续复用原有变量名。
import { create } from "zustand";

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
};

type Updater<T> = T | ((previous: T) => T);
const resolve = <T,>(value: Updater<T>, previous: T): T =>
  typeof value === "function" ? (value as (p: T) => T)(previous) : value;

export interface LayoutState {
  sidebarOpen: boolean;
  setSidebarOpen: (value: Updater<boolean>) => void;
  sidebarWidth: number;
  setSidebarWidth: (value: Updater<number>) => void;
  toolPanelWidth: number;
  setToolPanelWidth: (value: Updater<number>) => void;
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
  botTeamProvider: string;
  setBotTeamProvider: (value: Updater<string>) => void;

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
  workspaceSessionsExpanded: Record<string, boolean>;
  setWorkspaceSessionsExpanded: (value: Updater<Record<string, boolean>>) => void;

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
  setSidebarOpen: (value) => set((s) => ({ sidebarOpen: resolve(value, s.sidebarOpen) })),
  sidebarWidth: 240,
  setSidebarWidth: (value) => set((s) => ({ sidebarWidth: resolve(value, s.sidebarWidth) })),
  toolPanelWidth: initialToolPanelWidth(),
  setToolPanelWidth: (value) => set((s) => ({ toolPanelWidth: resolve(value, s.toolPanelWidth) })),
  viewportWidth: typeof window === "undefined" ? 1280 : window.innerWidth,
  setViewportWidth: (value) => set((s) => ({ viewportWidth: resolve(value, s.viewportWidth) })),
  rightPanelOpen: false,
  setRightPanelOpen: (value) => set((s) => ({ rightPanelOpen: resolve(value, s.rightPanelOpen) })),

  toolPanelTabs: [],
  setToolPanelTabs: (value) => set((s) => ({ toolPanelTabs: resolve(value, s.toolPanelTabs) })),
  toolPanelTabOverflow: { start: false, end: false },
  setToolPanelTabOverflow: (value) => set((s) => ({ toolPanelTabOverflow: resolve(value, s.toolPanelTabOverflow) })),
  activeToolPanelTabId: "",
  setActiveToolPanelTabId: (value) => set((s) => ({ activeToolPanelTabId: resolve(value, s.activeToolPanelTabId) })),
  toolPanelMenuOpen: false,
  setToolPanelMenuOpen: (value) => set((s) => ({ toolPanelMenuOpen: resolve(value, s.toolPanelMenuOpen) })),
  toolPanelAddMenuOpen: false,
  setToolPanelAddMenuOpen: (value) => set((s) => ({ toolPanelAddMenuOpen: resolve(value, s.toolPanelAddMenuOpen) })),

  settingsOpen: false,
  setSettingsOpen: (value) => set((s) => ({ settingsOpen: resolve(value, s.settingsOpen) })),
  addMenuOpen: false,
  setAddMenuOpen: (value) => set((s) => ({ addMenuOpen: resolve(value, s.addMenuOpen) })),
  modelMenuOpen: false,
  setModelMenuOpen: (value) => set((s) => ({ modelMenuOpen: resolve(value, s.modelMenuOpen) })),
  approvalMenuOpen: false,
  setApprovalMenuOpen: (value) => set((s) => ({ approvalMenuOpen: resolve(value, s.approvalMenuOpen) })),
  railMenuOpen: false,
  setRailMenuOpen: (value) => set((s) => ({ railMenuOpen: resolve(value, s.railMenuOpen) })),
  topMenuOpen: false,
  setTopMenuOpen: (value) => set((s) => ({ topMenuOpen: resolve(value, s.topMenuOpen) })),
  conversationToolsOpen: false,
  setConversationToolsOpen: (value) => set((s) => ({ conversationToolsOpen: resolve(value, s.conversationToolsOpen) })),

  sessionMenuId: null,
  setSessionMenuId: (value) => set((s) => ({ sessionMenuId: resolve(value, s.sessionMenuId) })),
  workspaceMenuPath: null,
  setWorkspaceMenuPath: (value) => set((s) => ({ workspaceMenuPath: resolve(value, s.workspaceMenuPath) })),
  renamingId: null,
  setRenamingId: (value) => set((s) => ({ renamingId: resolve(value, s.renamingId) })),

  pluginsPageOpen: false,
  setPluginsPageOpen: (value) => set((s) => ({ pluginsPageOpen: resolve(value, s.pluginsPageOpen) })),
  botTeamPageOpen: false,
  setBotTeamPageOpen: (value) => set((s) => ({ botTeamPageOpen: resolve(value, s.botTeamPageOpen) })),
  botTeamAvailable: false,
  setBotTeamAvailable: (value) => set((s) => ({ botTeamAvailable: resolve(value, s.botTeamAvailable) })),
  botTeamProvider: "ds-bot",
  setBotTeamProvider: (value) => set((s) => ({ botTeamProvider: resolve(value, s.botTeamProvider) })),

  conversationView: "chat",
  setConversationView: (value) => set((s) => ({ conversationView: resolve(value, s.conversationView) })),
  pluginConversationViews: [],
  setPluginConversationViews: (value) => set((s) => ({ pluginConversationViews: resolve(value, s.pluginConversationViews) })),

  showArchived: false,
  setShowArchived: (value) => set((s) => ({ showArchived: resolve(value, s.showArchived) })),
  workspaceOpen: true,
  setWorkspaceOpen: (value) => set((s) => ({ workspaceOpen: resolve(value, s.workspaceOpen) })),
  workspaceGroupOpen: {},
  setWorkspaceGroupOpen: (value) => set((s) => ({ workspaceGroupOpen: resolve(value, s.workspaceGroupOpen) })),
  workspaceSessionsExpanded: {},
  setWorkspaceSessionsExpanded: (value) => set((s) => ({ workspaceSessionsExpanded: resolve(value, s.workspaceSessionsExpanded) })),

  terminalOpen: false,
  setTerminalOpen: (value) => set((s) => ({ terminalOpen: resolve(value, s.terminalOpen) })),
  terminalMounted: false,
  setTerminalMounted: (value) => set((s) => ({ terminalMounted: resolve(value, s.terminalMounted) })),
  terminalAvailable: false,
  setTerminalAvailable: (value) => set((s) => ({ terminalAvailable: resolve(value, s.terminalAvailable) })),
  debugOpen: false,
  setDebugOpen: (value) => set((s) => ({ debugOpen: resolve(value, s.debugOpen) })),

  appUpdateDialogOpen: false,
  setAppUpdateDialogOpen: (value) => set((s) => ({ appUpdateDialogOpen: resolve(value, s.appUpdateDialogOpen) })),
}));
