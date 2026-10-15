// 面板数据刷新（记忆 / 技能 / 导入历史）与滚动位置同步（模块级 actions）。
//
// 整组函数原样从 App.tsx 搬出，只是把「读写 state 的裸标识符」改成经 store 的
// getState() 解构拿到，并把跨模块共享的 ref 换成 sharedRefs 里的模块级单例；
// 函数体、文案与行为均保持不变，供 App 等任意位置 import 调用。
import { useComposerStore } from "./composerStore";
import { useInboxStore } from "./inboxStore";
import { usePanelStore } from "./panelStore";
import { useSessionStore } from "./sessionStore";
import { useViewStore } from "./viewStore";
import { viewportRef } from "./sharedRefs";

export const refreshMemories = async () => {
  const { setMemories } = usePanelStore.getState();
  if (window.dyworker?.listMemories) setMemories(await window.dyworker.listMemories());
};

export const refreshSkills = async (announce = false) => {
  const { workspacePath } = useSessionStore.getState();
  const { setSkills } = usePanelStore.getState();
  const { setMentionSkills, setActiveSkills } = useComposerStore.getState();
  const { setNotice } = useViewStore.getState();
  if (!window.dyworker?.listSkills) return;
  const items = await window.dyworker.listSkills(workspacePath);
  setSkills(items);
  setMentionSkills(items);
  setActiveSkills(current => current.flatMap(skill => {
    const updated = items.find(item => item.id === skill.id && item.enabled);
    return updated ? [updated] : [];
  }));
  if (announce) setNotice(`已刷新技能，共发现 ${items.length} 个`);
};

// 加载已导入的浏览记录（地址栏联想）；导入成功后由对话框回调刷新
export const refreshImportedHistory = () => {
  const { setImportedHistory } = useInboxStore.getState();
  if (!window.dyworker?.listImportedHistory) return;
  void window.dyworker.listImportedHistory().then(setImportedHistory).catch(() => {});
};

export const syncAtBottom = () => {
  const { setAtBottom } = useViewStore.getState();
  const viewport = viewportRef.current;
  if (!viewport) return;
  setAtBottom(viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 48);
};

export const refreshWorkspace = async () => {
  const { workspacePath, setWorkspaceEntries } = useSessionStore.getState();
  if (!window.dyworker || !workspacePath) return;
  setWorkspaceEntries(await window.dyworker.refreshWorkspace(workspacePath));
};
