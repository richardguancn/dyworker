export type Role = "user" | "assistant" | "system";

export type ActivityKind =
  | "thinking"
  | "update_plan"
  | "list_files"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "make_directory"
  | "append_file"
  | "copy_file"
  | "move_file"
  | "delete_file"
  | "find_files"
  | "search_in_files"
  | "get_datetime"
  | "export_excel_workbook"
  | "run_command"
  | "save_memory"
  | "search_history"
  | "read_history_context"
  | "list_skills"
  | "load_skill"
  | "save_skill"
  | "update_skill"
  | "web_search"
  | "gov_search"
  | "fetch_web_page"
  | "scan_sensitive_info"
  | "check_official_document"
  | "dispatch_agent"
  | "ask_user"
  | "sleep_until"
  | "finish";

export interface ActivityRecord {
  id: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  status: "running" | "success" | "error";
}

export interface ApprovalAction {
  id: string;
  kind: string;
  title: string;
  details: string;
  suggestedRule?: StandingRuleSuggestion;
}

// 常驻允许规则(见 electron/agent.mjs matchStandingRule):审批卡片「始终允许」生成
export interface StandingRuleSuggestion {
  kind: "path-glob" | "domain" | "mcp-tool" | "command-prefix";
  tool: string;
  pattern: string;
  label: string;
}

export interface StandingRule extends StandingRuleSuggestion {
  id: string;
  createdAt: string;
}

// 审批收件箱条目(见 electron/main.mjs createInboxItem):无人值守任务的审批/提问
export interface InboxItem {
  id: string;
  kind: "approval" | "question";
  sessionId: string;
  scheduleId?: string;
  tool?: string;
  title?: string;
  details?: string;
  question?: string;
  options?: string[];
  createdAt: string;
  status: "pending" | "resolved" | "expired";
  resolution?: string;
  resolvedAt?: string;
}

// ask_user 工具的提问请求(交互会话内联显示)
export interface QuestionRequest {
  id: string;
  question: string;
  options: string[];
}

export interface PlanStep {
  title: string;
  status: "pending" | "in_progress" | "completed";
}

export interface FileChange {
  path: string;
  added: number;
  removed: number;
  diff?: string;
}

export interface AgentResult {
  status: "done" | "paused" | "cancelled" | "error" | "sleeping";
  finalText: string;
  reason?: string;
  demo?: boolean;
  wake?: { wakeAt: string; reason: string };
  changes?: FileChange[];
  plan?: PlanStep[];
  memories?: Array<Omit<MemoryItem, "id" | "createdAt" | "workspacePath">>;
  workingContext?: string;
}

export interface DebugLogEntry {
  id: string;
  time: string;
  kind: "model-request" | "model-response" | "tool-call" | "tool-result";
  title: string;
  content: string;
}

// 工具钩子规则(见 electron/agent.mjs evaluateHooks)
export interface HookRule {
  event?: string;
  tool: string | string[];
  path?: string;
  command?: string;
  action: "block" | "require_approval";
  message?: string;
}

// 一次模型调用的 token 用量记录；estimated=true 表示端点未回 usage、为本地估算
export interface UsageRecord {
  time: string;
  model: string;
  prompt: number;
  completion: number;
  estimated: boolean;
}

// reviewer = 替我审批：低风险操作自动继续，越界操作由规则和审核助手判断，拿不准才转人工。
// allow-writes 仅作为旧版本数据的兼容值，新的界面和设置不再提供该模式。
export type ApprovalMode = "interactive" | "reviewer" | "allow-writes" | "full-access" | "deny-changes";

export type AgentEvent =
  | { type: "activity"; activity: ActivityRecord }
  | { type: "activity-update"; id: string; status: ActivityRecord["status"]; detail?: string }
  | { type: "assistant-text"; text: string }
  | { type: "approval-request"; action: ApprovalAction }
  | { type: "ask-user"; request: QuestionRequest }
  | { type: "debug-log"; entry: DebugLogEntry }
  | { type: "context-usage"; used: number; completion: number; total?: number; estimated: boolean }
  | { type: "context-compacted" }
  | { type: "queued"; count: number }
  | { type: "queue-start"; count: number }
  | { type: "token-usage"; model: string; prompt: number; completion: number; estimated: boolean }
  | { type: "file-change"; changes: FileChange[] }
  | { type: "plan-update"; steps: PlanStep[] }
  | { type: "memory-saved"; item: Omit<MemoryItem, "id" | "createdAt" | "workspacePath"> }
  | { type: "skill-saved"; item: { name: string; description: string; instructions: string } }
  | { type: "skill-updated"; item: { id: string; name: string; description: string; instructions: string } }
  | { type: "loop-state"; active: boolean; iteration: number; maximum: number; status: string }
  | { type: "agent-finished"; result: AgentResult };

export interface SessionAgentEvent {
  sessionId: string;
  runId: string;
  event: AgentEvent;
}

export interface Attachment {
  name: string;
  path: string;
  size: number;
  mimeType: string;
  isImage?: boolean;
  previewUrl?: string;
}

export interface ChatMessage {
  id?: string;
  role: Role;
  content: string;
  // 关联的任务运行标识：排队消息用它定位会话存档中的最新内容
  runId?: string;
  // 引用技能时:content 含完整技能指令(发给模型),气泡只显示 displayContent + skillsUsed 标签
  displayContent?: string;
  skillsUsed?: string[];
  createdAt: string;
  attachments?: Attachment[];
  activities?: ActivityRecord[];
  changes?: FileChange[];  plan?: PlanStep[];
  durationMs?: number;
  taskStatus?: AgentResult["status"] | "queued";
  workingContext?: string;
}

export interface SessionRecord {
  id: string;
  title: string;
  workspacePath: string;
  // /goal 设定的长期目标：跨轮持续驱动，注入之后每个任务的系统提示
  goal?: string;
  // 上一轮实际读取和操作得到的工作资料，作为下一轮的隐藏上下文保存
  workingContext?: string;
  // 来源渠道(QQ/微信消息驱动的会话),用于列表标识
  channel?: "qq" | "wechat";
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  contextTokens?: number;
  contextTokensExact?: boolean;
  contextModel?: string;
  contextEndpoint?: string;
  pinned?: boolean;
  archived?: boolean;
  // 后台完成未读：任务在非当前会话完成时置 true，点开会话即清除（列表小绿点）
  unread?: boolean;
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: WorkspaceEntry[];
}

export interface WorkspaceContext {
  name: string;
  branch: string;
}

// 工作区 Git 状态（见 electron/git.mjs）：分支管理与提交推送
export interface GitBranchesInfo {
  isRepo: boolean;
  current: string;
  branches: string[];
  uncommitted: number;
  hasRemote: boolean;
}

export interface GitDiffStats {
  isRepo: boolean;
  added: number;
  removed: number;
  files: number;
  untracked: number;
}

// Codex 风格审阅视图：工作区改动 vs 基线（HEAD 或 upstream）
export interface GitReviewFile {
  path: string;
  status: "M" | "A" | "D" | "U";
  added: number;
  removed: number;
  binary?: boolean;
}

export interface GitReviewOverview {
  isRepo: boolean;
  current: string;
  upstream: string;
  base: string;
  files: GitReviewFile[];
  totals: { added: number; removed: number };
}

// 本机可导入数据的浏览器（导入 Cookie、密码与浏览记录，见 electron/browser-import.mjs）
export interface BrowserImportSource {
  id: string;
  name: string;
  userDataDir: string;
  profiles: { id: string; name: string }[];
}

export interface BrowserImportKinds {
  cookies: boolean;
  passwords: boolean;
  history: boolean;
}

export interface BrowserImportResult {
  ok: boolean;
  browser?: string;
  cookies?: number;
  passwords?: number;
  history?: number;
  warnings?: string[];
  weakProtection?: boolean;
  error?: string;
}

// 已导入的浏览记录条目（地址栏联想用）
export interface ImportedHistoryEntry {
  url: string;
  title: string;
  visits: number;
  lastVisit: number;
}

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
}

// 已保存的模型配置档案:切换服务商/模型时一键带入,密钥在 main 进程加密落盘
export interface ModelProfile {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  apiKey: string;
  transcriptionEndpoint?: string;
  transcriptionModel?: string;
}

// IM 消息渠道配置(见 electron/channels/):QQ 官方机器人 / 微信 ClawBot
// 微信登录凭据不进设置(主进程单独加密落盘),渲染端只持有开关
// modelProfileId 为空 = 渠道任务跟随桌面端当前模型;否则固定使用某个模型档案
// approvalMode:reviewer(默认,安全操作自动放行,高风险操作转人工)/ interactive(严格)
export interface ChannelsConfig {
  qq: { enabled: boolean; appId: string; appSecret: string };
  wechat: { enabled: boolean };
  modelProfileId: string;
  approvalMode: "reviewer" | "interactive";
}

export type ChannelConnectionStatus = "disabled" | "connecting" | "awaiting-scan" | "online" | "error";

export interface ChannelStatus {
  status: ChannelConnectionStatus;
  detail: string;
  qrUrl?: string;
}

export type ChannelsStatusMap = Record<"qq" | "wechat", ChannelStatus>;

export type UserIdentity = "general" | "government";

export type AppUpdateState = "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error" | "unavailable";

export interface AppUpdateStatus {
  state: AppUpdateState;
  currentVersion: string;
  version?: string;
  releaseName?: string;
  releaseDate?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  error?: string;
}

export interface ProviderSettings {
  identity: UserIdentity | null;
  endpoint: string;
  model: string;
  apiKey: string;
  visionEndpoint: string;
  visionModel: string;
  visionApiKey: string;
  profiles: ModelProfile[];
  transcriptionEndpoint: string;
  transcriptionModel: string;
  // 语音合成（渠道语音出站，OpenAI 兼容 /audio/speech；ttsApiKey 为空时回退主模型 apiKey）
  ttsEndpoint: string;
  ttsModel: string;
  ttsApiKey: string;
  searxngEndpoint: string;
  bochaApiKey: string;
  domesticSearchOnly: boolean;
  // 桌面端审批模式(composer 下拉选择):记住上次选择,下次启动继续生效
  approvalMode: ApprovalMode;
  // 防止休眠:off 关闭 / tasks 仅任务运行期间 / always 始终唤醒(只阻止系统挂起,屏幕照常锁屏)
  preventSleep: "off" | "tasks" | "always";
  // 应用更新来源:默认 GitHub 仓库,也可切换到其他 GitHub 仓库
  updateUrl: string;
  mcpServers: McpServerConfig[];
  channels: ChannelsConfig;
  skillLibraries: SkillLibraryConfig[];
}

export interface MemoryItem {
  id: string;
  category: string;
  content: string;
  kind: "preference" | "rule" | "taboo" | "fact" | "experience";
  scope: "global" | "workspace";
  workspacePath: string;
  relation: "extends" | "refines" | "supersedes";
  relatedMemoryId: string;
  createdAt: string;
  builtIn?: boolean;
}

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  builtIn?: boolean;
  source?: "builtin" | "saved" | "global" | "workspace";
  sourceLabel?: string;
  path?: string;
  readOnly?: boolean;
  createdAt: string;
}

export interface SkillLibraryConfig {
  id: string;
  name: string;
  description: string;
  websiteUrl: string;
  searchUrl: string;
  enabled: boolean;
}

export interface SkillLibrarySearchResult {
  libraryId: string;
  libraryName: string;
  slug: string;
  name: string;
  description: string;
  version: string;
}

export interface ScheduleRecord {
  id: string;
  name: string;
  prompt: string;
  workspacePath: string;
  recurrence: "once" | "hourly" | "daily" | "weekly";
  nextRun: string;
  lastRun: string;
  enabled: boolean;
  allowWorkspaceWrites: boolean;
  lastStatus: "" | "running" | "success" | "failed" | "sleeping";
  lastSummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface DyworkerBridge {
  getInitialState(): Promise<{
    sessions: SessionRecord[];
    workspacePath: string;
    workspaceEntries: WorkspaceEntry[];
    settings: ProviderSettings;
    pinnedWorkspacePaths: string[];
    platform: string;
    windowShadow: boolean;
    windowMaximized: boolean;
  }>;
  saveSessions(sessions: SessionRecord[]): Promise<{ ok: boolean; error?: string }>;
  savePinnedWorkspaces(paths: string[]): Promise<{ ok: boolean; error?: string }>;
  chooseWorkspace(): Promise<{ canceled: boolean; path?: string; entries?: WorkspaceEntry[] }>;
  chooseAttachments(): Promise<{ canceled: boolean; attachments: Attachment[] }>;
  saveClipboardImage(payload: { data: number[]; mimeType: string }): Promise<{ ok: boolean; attachment?: Attachment; error?: string }>;
  readLocalImage(path: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  refreshWorkspace(path: string): Promise<WorkspaceEntry[]>;
  getWorkspaceContext(path: string): Promise<WorkspaceContext>;
  gitBranches(workspacePath: string): Promise<GitBranchesInfo>;
  gitDiffStats(workspacePath: string): Promise<GitDiffStats>;
  gitCheckout(workspacePath: string, branch: string): Promise<{ ok: boolean; error?: string }>;
  gitCreateBranch(workspacePath: string, branch: string): Promise<{ ok: boolean; error?: string }>;
  gitCommit(payload: { workspacePath: string; message: string; includeUnstaged: boolean }): Promise<{ ok: boolean; message?: string; error?: string }>;
  gitPush(workspacePath: string): Promise<{ ok: boolean; error?: string }>;
  gitReviewOverview(payload: { workspacePath: string; base?: string }): Promise<GitReviewOverview>;
  gitFileDiff(payload: { workspacePath: string; base?: string; path: string; untracked?: boolean }): Promise<{ ok: boolean; diff?: string; binary?: boolean; truncated?: boolean; error?: string }>;
  listImportableBrowsers(): Promise<BrowserImportSource[]>;
  importBrowserData(payload: { id: string; userDataDir: string; profileId: string; kinds: BrowserImportKinds }): Promise<BrowserImportResult>;
  listImportedHistory(): Promise<ImportedHistoryEntry[]>;
  readWorkspaceMarkdown(workspacePath: string, filePath: string): Promise<{ ok: boolean; content?: string; error?: string }>;
  readWorkspaceFile(workspacePath: string, filePath: string): Promise<{ ok: boolean; content?: string; binary?: boolean; error?: string }>;
  openPath(path: string): Promise<{ ok: boolean; error?: string }>;
  openBrowser(payload: { url: string; workspacePath?: string }): Promise<{ ok: boolean; result?: string; error?: string; url?: string }>;
  onBrowserPanelRequest(callback: (request: { action: "open" | "close"; url?: string }) => void): () => void;
  saveSettings(settings: ProviderSettings): Promise<{ ok: boolean; error?: string; updateUrl?: string }>;
  getAppUpdateStatus(): Promise<AppUpdateStatus>;
  checkForAppUpdate(): Promise<{ ok: boolean; state: AppUpdateState; version?: string; error?: string }>;
  downloadAppUpdate(): Promise<{ ok: boolean; state: AppUpdateState | "installing"; error?: string }>;
  installAppUpdate(): Promise<{ ok: boolean; state: AppUpdateState | "installing"; error?: string }>;
  onAppUpdateStatus(callback: (status: AppUpdateStatus) => void): () => void;
  completeChat(payload: {
    settings: ProviderSettings;
    messages: ChatMessage[];
  }): Promise<{ content: string; demo?: boolean }>;
  sendTask(payload: {
    settings: ProviderSettings;
    workspacePath: string;
    contextLimit?: number;
    goal?: string;
    workingContext?: string;
    messages: ChatMessage[];
    loop?: { enabled: boolean; maximum: number };
    approvalMode?: ApprovalMode;
    sessionId?: string;
    runId?: string;
  }): Promise<{ ok: boolean; result?: AgentResult; queued?: boolean; runId?: string; error?: string }>;
  removeQueuedTask(payload: { sessionId: string; runId: string }): Promise<{ ok: boolean; removed?: boolean }>;
  runQueuedTaskNow(payload: { sessionId: string; runId: string }): Promise<{ ok: boolean; error?: string }>;
  resolveApproval(sessionId: string, actionId: string, approved: boolean): Promise<{ ok: boolean }>;
  cancelTask(sessionId: string, runId: string): Promise<{ ok: boolean }>;
  onAgentEvent(callback: (event: SessionAgentEvent) => void): () => void;
  listMemories(): Promise<MemoryItem[]>;
  listUsageStats(): Promise<UsageRecord[]>;
  clearUsageStats(): Promise<{ ok: boolean }>;
  listHooks(): Promise<{ builtin: HookRule[]; user: HookRule[]; userPath: string }>;
  openUserHooks(): Promise<string>;
  listRules(): Promise<StandingRule[]>;
  addRule(rule: StandingRuleSuggestion): Promise<{ ok: boolean; error?: string; duplicated?: boolean }>;
  deleteRule(id: string): Promise<{ ok: boolean }>;
  openAuditLog(): Promise<string>;
  listInbox(): Promise<InboxItem[]>;
  resolveInbox(payload: { id: string; approved?: boolean; answer?: string }): Promise<{ ok: boolean; error?: string }>;
  dismissInbox(id: string): Promise<{ ok: boolean; error?: string }>;
  resolveQuestion(sessionId: string, requestId: string, answer: string): Promise<{ ok: boolean }>;
  onInboxChanged(callback: () => void): () => void;
  deleteMemory(id: string): Promise<{ ok: boolean }>;
  listSkills(workspacePath?: string): Promise<SkillRecord[]>;
  setSkillEnabled(id: string, enabled: boolean, workspacePath?: string): Promise<{ ok: boolean }>;
  deleteSkill(id: string): Promise<{ ok: boolean; error?: string }>;
  searchSkillLibraries(query: string): Promise<{ ok: boolean; results: SkillLibrarySearchResult[]; warnings: string[]; error?: string }>;
  installSkillFromLibrary(payload: { libraryId: string; slug: string }): Promise<{ ok: boolean; slug?: string; targetDir?: string; error?: string }>;
  listSchedules(): Promise<ScheduleRecord[]>;
  saveSchedule(payload: Partial<ScheduleRecord>): Promise<{ ok: boolean; error?: string }>;
  deleteSchedule(id: string): Promise<{ ok: boolean }>;
  setScheduleEnabled(id: string, enabled: boolean): Promise<{ ok: boolean }>;
  triggerSchedule(id: string): Promise<{ ok: boolean; error?: string }>;
  onSchedulesChanged(callback: () => void): () => void;
  onSessionPrepend(callback: (session: SessionRecord) => void): () => void;
  onSessionAppend(callback: (payload: { sessionId: string; workspacePath: string; channel?: "qq" | "wechat"; messages: ChatMessage[] }) => void): () => void;
  cancelWakesForSession(sessionId: string): Promise<{ ok: boolean }>;
  getChannelsStatus(): Promise<ChannelsStatusMap>;
  onChannelsStatus(callback: (statusMap: ChannelsStatusMap) => void): () => void;
  transcribeAudio(payload: {
    settings: ProviderSettings;
    audio: number[];
    mimeType: string;
  }): Promise<{ text: string }>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  onWindowStateChange(callback: (maximized: boolean) => void): () => void;
  reportWindowPointerDown(): void;
}

declare global {
  interface Window {
    dyworker?: DyworkerBridge;
  }
}
