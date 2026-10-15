// 会话 / 工作区 / Git / 运行态 state 的 zustand store。
// 从 App.tsx 的 useState 逐字段搬来，字段名与同名 setter 保持不变，
// 使用点一次解构即可继续复用原有变量名。
import { create } from "zustand";
import type { ApprovalAction, GitBranchesInfo, GitDiffStats, PendingWakeRecord, QuestionRequest, SessionRecord, WorkspaceContext, WorkspaceEntry } from "../types";
import { previewSessions, previewWorkspace } from "./previewData";

// 正在续跑的会话（到点自动唤醒或用户点的「立即继续」）：气泡说明与运行状态行都按它改写
export type WakingSessionEntry = { wakeAt: string; manual?: boolean; marker: string; done: string };

type Updater<T> = T | ((previous: T) => T);
const resolve = <T,>(value: Updater<T>, previous: T): T =>
  typeof value === "function" ? (value as (p: T) => T)(previous) : value;

export interface SessionState {
  sessions: SessionRecord[];
  setSessions: (value: Updater<SessionRecord[]>) => void;
  // 未发送的新任务只保留在页面内，不进入会话列表和保存流程。
  newTaskDraft: SessionRecord | null;
  setNewTaskDraft: (value: Updater<SessionRecord | null>) => void;
  activeId: string;
  setActiveId: (value: Updater<string>) => void;
  workspacePath: string;
  setWorkspacePath: (value: Updater<string>) => void;
  workspaceContext: WorkspaceContext | null;
  setWorkspaceContext: (value: Updater<WorkspaceContext | null>) => void;
  // 工作区 Git 状态：分支下拉与提交推送面板
  gitInfo: GitBranchesInfo | null;
  setGitInfo: (value: Updater<GitBranchesInfo | null>) => void;
  branchMenuOpen: boolean;
  setBranchMenuOpen: (value: Updater<boolean>) => void;
  branchQuery: string;
  setBranchQuery: (value: Updater<string>) => void;
  creatingBranch: boolean;
  setCreatingBranch: (value: Updater<boolean>) => void;
  newBranchName: string;
  setNewBranchName: (value: Updater<string>) => void;
  commitPanelOpen: boolean;
  setCommitPanelOpen: (value: Updater<boolean>) => void;
  commitMessage: string;
  setCommitMessage: (value: Updater<string>) => void;
  includeUnstaged: boolean;
  setIncludeUnstaged: (value: Updater<boolean>) => void;
  diffStats: GitDiffStats | null;
  setDiffStats: (value: Updater<GitDiffStats | null>) => void;
  gitBusy: "" | "switch" | "commit" | "commit-push" | "push" | "generate";
  setGitBusy: (value: Updater<"" | "switch" | "commit" | "commit-push" | "push" | "generate">) => void;
  workspaceEntries: WorkspaceEntry[];
  setWorkspaceEntries: (value: Updater<WorkspaceEntry[]>) => void;
  pinnedWorkspacePaths: string[];
  setPinnedWorkspacePaths: (value: Updater<string[]>) => void;
  query: string;
  setQuery: (value: Updater<string>) => void;
  composerSessionId: string;
  setComposerSessionId: (value: Updater<string>) => void;
  runningSessionIds: Set<string>;
  setRunningSessionIds: (value: Updater<Set<string>>) => void;
  // 主动挂起（有待唤醒）的会话：主进程 wakes.json 是权威状态，这里只做镜像。
  // 不能用气泡上的 taskStatus=sleeping 代替——取消唤醒后它不会自己变，重启也读不出来。
  sleepingSessions: Record<string, PendingWakeRecord>;
  setSleepingSessions: (value: Updater<Record<string, PendingWakeRecord>>) => void;
  // 正在续跑（已唤醒）的会话：气泡那句将来时的挂起说明要改写成“正在继续处理”，
  // 运行状态行也要说清是自动唤醒还是用户点的「立即继续」
  wakingSessions: Record<string, WakingSessionEntry>;
  setWakingSessions: (value: Updater<Record<string, WakingSessionEntry>>) => void;
  runningStartedAt: Record<string, number>;
  setRunningStartedAt: (value: Updater<Record<string, number>>) => void;
  // 正在进行定时计划运行的会话（主进程 runScheduledTask 在跑）：这些会话的输入框要禁用，
  // 否则用户中途发消息会和后台那轮计划任务同时写同一个会话，收尾 prepend 会把新消息覆盖掉
  scheduledRunSessions: Set<string>;
  setScheduledRunSessions: (value: Updater<Set<string>>) => void;
  // 「立即执行」后要自动打开的会话：等它进了会话列表再由 selectSession 走完整切换流程
  // （切工作区、关旧审阅标签、刷新工作区文件），否则会话可能落在别的分组的折叠里
  pendingAutoOpenSessionId: string;
  setPendingAutoOpenSessionId: (value: Updater<string>) => void;
  sessionErrors: Record<string, string>;
  setSessionErrors: (value: Updater<Record<string, string>>) => void;
  sessionNotices: Record<string, string>;
  setSessionNotices: (value: Updater<Record<string, string>>) => void;
  pendingApprovals: Record<string, ApprovalAction>;
  setPendingApprovals: (value: Updater<Record<string, ApprovalAction>>) => void;
  pendingQuestions: Record<string, QuestionRequest>;
  setPendingQuestions: (value: Updater<Record<string, QuestionRequest>>) => void;
  skillSummarySessionId: string | null;
  setSkillSummarySessionId: (value: Updater<string | null>) => void;
  loopStates: Record<string, { iteration: number; maximum: number; status: string }>;
  setLoopStates: (value: Updater<Record<string, { iteration: number; maximum: number; status: string }>>) => void;
  dshChildHistory: { id: string; rootSessionId: string; displayTitle: string } | null;
  setDshChildHistory: (value: Updater<{ id: string; rootSessionId: string; displayTitle: string } | null>) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: previewSessions,
  setSessions: (value) => set((s) => ({ sessions: resolve(value, s.sessions) })),
  newTaskDraft: null,
  setNewTaskDraft: (value) => set((s) => ({ newTaskDraft: resolve(value, s.newTaskDraft) })),
  activeId: previewSessions[0].id,
  setActiveId: (value) => set((s) => ({ activeId: resolve(value, s.activeId) })),
  workspacePath: previewSessions[0].workspacePath,
  setWorkspacePath: (value) => set((s) => ({ workspacePath: resolve(value, s.workspacePath) })),
  workspaceContext: null,
  setWorkspaceContext: (value) => set((s) => ({ workspaceContext: resolve(value, s.workspaceContext) })),
  gitInfo: null,
  setGitInfo: (value) => set((s) => ({ gitInfo: resolve(value, s.gitInfo) })),
  branchMenuOpen: false,
  setBranchMenuOpen: (value) => set((s) => ({ branchMenuOpen: resolve(value, s.branchMenuOpen) })),
  branchQuery: "",
  setBranchQuery: (value) => set((s) => ({ branchQuery: resolve(value, s.branchQuery) })),
  creatingBranch: false,
  setCreatingBranch: (value) => set((s) => ({ creatingBranch: resolve(value, s.creatingBranch) })),
  newBranchName: "",
  setNewBranchName: (value) => set((s) => ({ newBranchName: resolve(value, s.newBranchName) })),
  commitPanelOpen: false,
  setCommitPanelOpen: (value) => set((s) => ({ commitPanelOpen: resolve(value, s.commitPanelOpen) })),
  commitMessage: "",
  setCommitMessage: (value) => set((s) => ({ commitMessage: resolve(value, s.commitMessage) })),
  includeUnstaged: true,
  setIncludeUnstaged: (value) => set((s) => ({ includeUnstaged: resolve(value, s.includeUnstaged) })),
  diffStats: null,
  setDiffStats: (value) => set((s) => ({ diffStats: resolve(value, s.diffStats) })),
  gitBusy: "",
  setGitBusy: (value) => set((s) => ({ gitBusy: resolve(value, s.gitBusy) })),
  workspaceEntries: previewWorkspace,
  setWorkspaceEntries: (value) => set((s) => ({ workspaceEntries: resolve(value, s.workspaceEntries) })),
  pinnedWorkspacePaths: [],
  setPinnedWorkspacePaths: (value) => set((s) => ({ pinnedWorkspacePaths: resolve(value, s.pinnedWorkspacePaths) })),
  query: "",
  setQuery: (value) => set((s) => ({ query: resolve(value, s.query) })),
  composerSessionId: previewSessions[0].id,
  setComposerSessionId: (value) => set((s) => ({ composerSessionId: resolve(value, s.composerSessionId) })),
  runningSessionIds: new Set(),
  setRunningSessionIds: (value) => set((s) => ({ runningSessionIds: resolve(value, s.runningSessionIds) })),
  sleepingSessions: {},
  setSleepingSessions: (value) => set((s) => ({ sleepingSessions: resolve(value, s.sleepingSessions) })),
  wakingSessions: {},
  setWakingSessions: (value) => set((s) => ({ wakingSessions: resolve(value, s.wakingSessions) })),
  runningStartedAt: {},
  setRunningStartedAt: (value) => set((s) => ({ runningStartedAt: resolve(value, s.runningStartedAt) })),
  scheduledRunSessions: new Set(),
  setScheduledRunSessions: (value) => set((s) => ({ scheduledRunSessions: resolve(value, s.scheduledRunSessions) })),
  pendingAutoOpenSessionId: "",
  setPendingAutoOpenSessionId: (value) => set((s) => ({ pendingAutoOpenSessionId: resolve(value, s.pendingAutoOpenSessionId) })),
  sessionErrors: {},
  setSessionErrors: (value) => set((s) => ({ sessionErrors: resolve(value, s.sessionErrors) })),
  sessionNotices: {},
  setSessionNotices: (value) => set((s) => ({ sessionNotices: resolve(value, s.sessionNotices) })),
  pendingApprovals: {},
  setPendingApprovals: (value) => set((s) => ({ pendingApprovals: resolve(value, s.pendingApprovals) })),
  pendingQuestions: {},
  setPendingQuestions: (value) => set((s) => ({ pendingQuestions: resolve(value, s.pendingQuestions) })),
  skillSummarySessionId: null,
  setSkillSummarySessionId: (value) => set((s) => ({ skillSummarySessionId: resolve(value, s.skillSummarySessionId) })),
  loopStates: {},
  setLoopStates: (value) => set((s) => ({ loopStates: resolve(value, s.loopStates) })),
  dshChildHistory: null,
  setDshChildHistory: (value) => set((s) => ({ dshChildHistory: resolve(value, s.dshChildHistory) })),
}));
