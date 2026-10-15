// 工作区 Git 操作（模块级 actions）。
//
// 整组函数原样从 App.tsx 搬出，只是把「读写 state 的裸标识符」改成经 store 的
// getState() 解构拿到，派生值 composerWorkspacePath 改由 sessionStore 的小工具推导；
// 函数体、文案与行为均保持不变，供 App 顶栏分支下拉与提交推送面板调用。
import { getComposerWorkspacePath, useSessionStore } from "./sessionStore";
import { useViewStore } from "./viewStore";

export const refreshGitInfo = async () => {
  const { setGitInfo } = useSessionStore.getState();
  const { ready } = useViewStore.getState();
  const composerWorkspacePath = getComposerWorkspacePath();
  if (!ready || !window.dyworker?.gitBranches || !composerWorkspacePath) {
    setGitInfo(null);
    return;
  }
  try {
    const info = await window.dyworker.gitBranches(composerWorkspacePath);
    setGitInfo(info.isRepo ? info : null);
  } catch {
    setGitInfo(null);
  }
};

export const toggleBranchMenu = () => {
  const { setBranchMenuOpen, setBranchQuery, setCreatingBranch, setCommitPanelOpen } = useSessionStore.getState();
  setCommitPanelOpen(false);
  setBranchQuery("");
  setCreatingBranch(false);
  setBranchMenuOpen((value) => !value);
  void refreshGitInfo();
};

export const openCommitPanel = () => {
  const { setBranchMenuOpen, setCommitPanelOpen, setDiffStats } = useSessionStore.getState();
  const composerWorkspacePath = getComposerWorkspacePath();
  setBranchMenuOpen(false);
  setCommitPanelOpen(true);
  setDiffStats(null);
  if (window.dyworker?.gitDiffStats && composerWorkspacePath) {
    void window.dyworker.gitDiffStats(composerWorkspacePath).then(setDiffStats).catch(() => {});
  }
};

export const switchBranch = async (name: string) => {
  const { gitBusy, gitInfo, setGitBusy, setBranchMenuOpen } = useSessionStore.getState();
  const { setError, setNotice } = useViewStore.getState();
  const composerWorkspacePath = getComposerWorkspacePath();
  if (!window.dyworker?.gitCheckout || gitBusy || name === gitInfo?.current) return;
  setGitBusy("switch");
  try {
    const result = await window.dyworker.gitCheckout(composerWorkspacePath, name);
    if (!result.ok) {
      setError(result.error || "切换分支失败");
      return;
    }
    setNotice(`已切换到分支 ${name}`);
    setBranchMenuOpen(false);
    await refreshGitInfo();
  } finally {
    setGitBusy("");
  }
};

export const createBranch = async () => {
  const { newBranchName, gitBusy, setGitBusy, setNewBranchName, setCreatingBranch, setBranchMenuOpen } = useSessionStore.getState();
  const { setError, setNotice } = useViewStore.getState();
  const composerWorkspacePath = getComposerWorkspacePath();
  const name = newBranchName.trim();
  if (!window.dyworker?.gitCreateBranch || !name || gitBusy) return;
  setGitBusy("switch");
  try {
    const result = await window.dyworker.gitCreateBranch(composerWorkspacePath, name);
    if (!result.ok) {
      setError(result.error || "创建分支失败");
      return;
    }
    setNotice(`已创建并切换到分支 ${name}`);
    setNewBranchName("");
    setCreatingBranch(false);
    setBranchMenuOpen(false);
    await refreshGitInfo();
  } finally {
    setGitBusy("");
  }
};

// AI 生成提交信息（独立按钮触发，写入输入框供用户确认或修改）
export const generateCommitMessage = async () => {
  const { gitBusy, setGitBusy, setCommitMessage } = useSessionStore.getState();
  const { setError } = useViewStore.getState();
  const composerWorkspacePath = getComposerWorkspacePath();
  if (!window.dyworker?.gitSuggestCommitMessage || gitBusy) return;
  setGitBusy("generate");
  try {
    const result = await window.dyworker.gitSuggestCommitMessage(composerWorkspacePath);
    if (!result.ok || !result.message) setError(result.error || "生成提交信息失败");
    else setCommitMessage(result.message);
  } catch {
    setError("生成提交信息失败");
  } finally {
    setGitBusy("");
  }
};

export const runCommit = async (push: boolean) => {
  const { gitBusy, setGitBusy, commitMessage, includeUnstaged, setCommitMessage, setCommitPanelOpen } = useSessionStore.getState();
  const { setError, setNotice } = useViewStore.getState();
  const composerWorkspacePath = getComposerWorkspacePath();
  if (!window.dyworker?.gitCommit || gitBusy) return;
  setGitBusy(push ? "commit-push" : "commit");
  try {
    const commit = await window.dyworker.gitCommit({
      workspacePath: composerWorkspacePath,
      message: commitMessage,
      includeUnstaged,
    });
    if (!commit.ok) {
      setError(commit.error || "提交失败");
      return;
    }
    if (push && window.dyworker.gitPush) {
      const pushed = await window.dyworker.gitPush(composerWorkspacePath);
      if (!pushed.ok) setError(`已提交（${commit.message}），但推送失败：${pushed.error}`);
      else setNotice(`已提交并推送：${commit.message}`);
    } else {
      setNotice(`已提交：${commit.message}`);
    }
    setCommitMessage("");
    setCommitPanelOpen(false);
    await refreshGitInfo();
  } finally {
    setGitBusy("");
  }
};

export const runPushOnly = async () => {
  const { gitBusy, setGitBusy, setCommitPanelOpen } = useSessionStore.getState();
  const { setNotice, setError } = useViewStore.getState();
  const composerWorkspacePath = getComposerWorkspacePath();
  if (!window.dyworker?.gitPush || gitBusy) return;
  setGitBusy("push");
  try {
    const result = await window.dyworker.gitPush(composerWorkspacePath);
    if (result.ok) setNotice("已推送到远程仓库");
    else setError(result.error || "推送失败");
    setCommitPanelOpen(false);
    await refreshGitInfo();
  } finally {
    setGitBusy("");
  }
};
