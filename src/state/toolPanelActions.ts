// 右侧面板标签页管理（模块级 actions）。
//
// 整组函数原样从 App.tsx 搬出，只是把「读写 state 的裸标识符」改成经 store 的
// getState() 解构拿到，并把跨模块共享的 ref 换成 sharedRefs 里的模块级单例；
// 函数体、文案与行为均保持不变，供 App 与 browserActions 等任意位置 import 调用。
import { useLayoutStore } from "./layoutStore";
import type { ToolPanelTab } from "./layoutStore";
import { useViewStore } from "./viewStore";
import { openFilePreviewRef, toolPanelTabSequenceRef, toolPanelTabsRef } from "./sharedRefs";
import { pluginPanelPreferences } from "./pluginPreferences";

export const updateToolPanelTab = (id: string, patch: Partial<ToolPanelTab>) => {
  const { setToolPanelTabs } = useLayoutStore.getState();
  setToolPanelTabs((current) => current.map((tab) => tab.id === id ? { ...tab, ...patch } : tab));
};

export const focusToolPanelTab = (id: string) => {
  const { setActiveToolPanelTabId, setToolPanelMenuOpen } = useLayoutStore.getState();
  setActiveToolPanelTabId(id);
  setToolPanelMenuOpen(false);
};

export const openToolPanelTab = (kind: ToolPanelTab["kind"], createNew = false, initialUrl?: string) => {
  const { toolPanelTabs, setToolPanelTabs, setActiveToolPanelTabId, setToolPanelMenuOpen } = useLayoutStore.getState();
  if (!createNew) {
    const existing = toolPanelTabs.find((tab) => tab.kind === kind);
    if (existing) {
      if (initialUrl !== undefined) {
        updateToolPanelTab(existing.id, { url: initialUrl, title: initialUrl || existing.title });
      }
      focusToolPanelTab(existing.id);
      return existing.id;
    }
  }
  const sequence = toolPanelTabSequenceRef.current++;
  const tab: ToolPanelTab = {
    id: `${kind}-${sequence}`,
    kind,
    title: kind === "browser" ? (initialUrl || "新标签页") : kind === "review" ? "审阅" : kind === "chat" ? "侧边聊天" : kind === "tasks" ? "后台任务" : "打开文件",
    ...(kind === "browser" ? { url: initialUrl || "" } : {}),
  };
  setToolPanelTabs((current) => [...current, tab]);
  setActiveToolPanelTabId(tab.id);
  setToolPanelMenuOpen(false);
  return tab.id;
};

export const openFilePreview = (filePath: string, root: string) => {
  const { setToolPanelTabs, setActiveToolPanelTabId, setRightPanelOpen, setToolPanelMenuOpen, setToolPanelAddMenuOpen } = useLayoutStore.getState();
  const current = toolPanelTabsRef.current;
  const existing = current.find(tab => tab.kind === "preview" && tab.filePath === filePath && tab.previewWorkspacePath === root);
  const id = existing?.id || `preview-${toolPanelTabSequenceRef.current++}`;
  const next: ToolPanelTab[] = existing
    ? current.map(tab => tab.id === id ? { ...tab, previewRevision: (tab.previewRevision || 0) + 1 } : tab)
    : [...current, { id, kind: "preview", title: filePath.split(/[\\/]/).pop() || "文件预览", filePath, previewWorkspacePath: root }];
  toolPanelTabsRef.current = next;
  setToolPanelTabs(next);
  setActiveToolPanelTabId(id);
  setRightPanelOpen(true);
  setToolPanelMenuOpen(false);
  setToolPanelAddMenuOpen(false);
};
openFilePreviewRef.current = openFilePreview;

export const choosePreviewFile = async () => {
  const { setError } = useViewStore.getState();
  try {
    const choice = await window.dyworker?.choosePreviewFile();
    if (choice && !choice.canceled && choice.path && choice.workspacePath) openFilePreview(choice.path, choice.workspacePath);
  } catch (error) { setError(`打开文件失败：${String(error)}`); }
};

export const closeToolPanelTab = (id: string) => {
  const { toolPanelTabs, activeToolPanelTabId, setToolPanelTabs, setActiveToolPanelTabId, setToolPanelMenuOpen } = useLayoutStore.getState();
  const closing = toolPanelTabs.find(tab => tab.id === id);
  if (closing) pluginPanelPreferences.close(closing);
  const nextTabs = toolPanelTabs.filter((tab) => tab.id !== id);
  // 关掉最后一个标签页时回到菜单页，而不是再开一个空白浏览器（对照 Codex）
  if (!nextTabs.length) {
    setToolPanelTabs([]);
    setActiveToolPanelTabId("");
    setToolPanelMenuOpen(true);
    return;
  }
  setToolPanelTabs(nextTabs);
  if (id === activeToolPanelTabId) {
    const index = toolPanelTabs.findIndex((tab) => tab.id === id);
    setActiveToolPanelTabId(nextTabs[Math.max(0, index - 1)]?.id || nextTabs[0].id);
  }
};
