export type Role = "user" | "assistant" | "system";

export type ActivityKind =
  | "thinking"
  | "commentary"
  | "update_plan"
  | "list_files"
  | "read_file"
  | "ocr_file"
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
  durationMs?: number;
  commentary?: string;
  // process-chain：活动挂到的计划步骤 id（plan-update 时补稳定 id）
  stepId?: string;
  // process-chain：活动阶段（plan/execute/verify/fix/deliver），失败后同目标重试打 fix
  phase?: "plan" | "execute" | "verify" | "fix" | "deliver";
  // process-chain：子代理分支标记，带 branch 的活动不混入主活动流
  branch?: { parentId: string; title?: string; depth: number };
  // 子代理（dispatch_agent）分支活动：展开该活动时嵌套显示的时间线，
  // 随 message.activities 一并落盘（sessions.json），会话重载后仍可见
  children?: ActivityRecord[];
}

export interface ApprovalAction {
  id: string;
  kind: string;
  title: string;
  details: string;
  // 模型生成的操作影响要点（Markdown 列表），审批卡上渲染在原始详情下方
  impact?: string;
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
  // 模型生成的操作影响要点（Markdown 列表），收件箱审批卡上渲染
  impact?: string;
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
  // 稳定 id（plan-update 时生成，同位置同名步骤保持同一 id），用于把活动挂到具体步骤下
  id?: string;
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
  status: "done" | "paused" | "cancelled" | "error" | "sleeping" | "unverified";
  finalText: string;
  reason?: string;
  demo?: boolean;
  // 会话设有 /goal 长期目标且模型在 finish_task 中明确报告已达成时为 true；渲染端据此自动解除目标
  goalAchieved?: boolean;
  wake?: { wakeAt: string; reason: string };
  changes?: FileChange[];
  plan?: PlanStep[];
  memories?: Array<Omit<MemoryItem, "id" | "createdAt" | "workspacePath">>;
  workingContext?: string;
  executedMessages?: Array<{
    role: string;
    content: any;
    reasoning_content?: string;
    tool_calls?: any[];
    tool_call_id?: string;
  }>;
}

export interface DebugLogEntry {
  id: string;
  time: string;
  kind: "model-request" | "model-response" | "tool-call" | "tool-result";
  title: string;
  content: string;
}

// 统一轨迹事件（trace-console 底层，与 process-chain 共用同一条事件流）：
// 一切模型看到的内容都进这条 append-only 事件流，会话级落盘（userData/traces/<sessionId>.jsonl）可回放
export interface TraceEvent {
  seq: number;
  // 所属任务运行 id：跨 run 时 seq 会重置，控制台用 runId+seq 区分；历史回放合并依赖该字段
  runId?: string;
  time: string;
  turn: number;
  step: number;
  kind:
    | "model-request"
    | "model-response"
    | "tool-call"
    | "tool-result"
    | "token-usage"
    | "activity"
    | "activity-update"
    | "plan-update"
    | "file-change"
    | "agent-finished";
  direction: "in" | "out";
  target: "model" | "tool" | "system";
  // tool-result → tool-call、model-response → model-request、token-usage → 本轮请求/响应
  parentSeq?: number;
  title: string;
  content: string;
  usage?: { prompt: number; completion: number; estimated: boolean };
  // 子代理嵌套深度（0=主代理，转发时加深）
  depth?: number;
  activityId?: string;
  // 活动类型（activity 投影带出，供后台任务拓扑页显示类型徽标）
  activityKind?: string;
  status?: string;
  phase?: string;
  stepId?: string;
  branch?: { parentId: string; title?: string; depth: number };
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
  | { type: "activity-update"; id: string; status: ActivityRecord["status"]; detail?: string; durationMs?: number; commentary?: string; branch?: { parentId: string; title?: string; depth: number } }
  | { type: "assistant-text"; text: string }
  // 推理模型的思考流（reasoning_content 累积文本）：不进正文，仅用于界面实时展示思考过程
  | { type: "assistant-reasoning"; text: string }
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
  // 首条消息时由主进程并发生成的会话标题：渲染端仅在用户未手动重命名过时采用
  | { type: "session-title"; title: string }
  | { type: "agent-finished"; result: AgentResult }
  // 统一轨迹事件流（trace-console）：结构化投影，与 debug-log 等旧事件并行发出
  | { type: "trace"; trace: TraceEvent };

export interface SessionAgentEvent {
  sessionId: string;
  runId: string;
  // 渠道（QQ/微信）任务转发的事件带 true；桌面端 runTask 的事件没有此字段，
  // 渠道流式归约器凭它区分来源，避免同一运行被渲染成两个气泡
  channelRun?: boolean;
  event: AgentEvent;
}

export interface Attachment {
  name: string;
  path: string;
  size: number;
  mimeType: string;
  isImage?: boolean;
  isVoice?: boolean;
  duration?: number;
  previewUrl?: string;
  // 来自输入框 @token 的内联引用：气泡里随正文按顺序展示，不再重复渲染成 chip
  inlineRef?: boolean;
}

// 会话内选中文字的引用注释：quote 存所选文本（已归一化），comment 为可选评论
export interface MessageAnnotation {
  id: string;
  quote: string;
  comment: string;
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
  // 折叠的长粘贴块：content 已含原文（发给模型），气泡按块折叠展示、可展开查看
  pasteBlocks?: Array<{ id: string; text: string }>;
  createdAt: string;
  attachments?: Attachment[];
  activities?: ActivityRecord[];
  // 引用注释：quote/comment 已拼进 content 发给模型，气泡按 chip + 只读列表展示
  annotations?: MessageAnnotation[];
  // 推理模型的思考过程（流式累积）：不进正文、不回传模型，仅用于界面展示
  reasoning?: string;
  changes?: FileChange[];  plan?: PlanStep[];
  durationMs?: number;
  taskStatus?: AgentResult["status"] | "queued";
  workingContext?: string;
  executedMessages?: AgentResult["executedMessages"];
}

export interface SessionRecord {
  id: string;
  title: string;
  // 用户手动重命名过：不再被自动生成的会话标题覆盖
  titleCustom?: boolean;
  workspacePath: string;
  // /goal 设定的长期目标：注入会话内每个任务的系统提示，交付前对照自检；
  // 模型在 finish_task 中报告达成或用户在横幅确认后解除，不达成不自动消失
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
  // 会话累计 token 用量（含每轮请求的输入与输出；端点不回 usage 时为估算值）
  tokenStats?: { prompt: number; completion: number; requests: number };
  pinned?: boolean;
  archived?: boolean;
  // 后台完成未读：任务在非当前会话完成时置 true，点开会话即清除（列表小绿点）
  unread?: boolean;
}

// 会话保存增量载荷：渲染端按引用身份对比出「变化的会话」只发增量，
// order 是当前全部会话的权威顺序（主进程据此删除已不存在的会话文件）；
// meta 是渠道同步用的轻量信息。旧版整档数组仍被主进程兼容。
export interface SessionSavePayload {
  changed: SessionRecord[];
  removed: string[];
  order: string[];
  // 当前选中的会话 id：随增量落盘，重启后恢复选中
  activeId?: string;
  meta: Array<{ id: string; channel?: "qq" | "wechat"; workspacePath?: string }>;
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
  localstorage: boolean;
}

export interface BrowserImportResult {
  ok: boolean;
  browser?: string;
  cookies?: number;
  passwords?: number;
  history?: number;
  localStorageOrigins?: number;
  localStorageKeys?: number;
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

// 浏览器 Computer Use 控制状态
export interface BrowserControlState {
  status: "idle" | "acquiring" | "running" | "awaiting_approval" | "human_control" | "paused" | "completed" | "stopped" | "failed";
  controlSessionId: string;
  ownerSessionId: string;
  runId: string;
  tabId: string;
  webContentsId: number;
  leaseEpoch: number;
  actionText: string;
  pauseReason: string;
  elapsedMs: number;
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
  // 推理强度档位（见 providers.ts reasoningEfforts；空串 = 厂商默认）
  reasoningEffort?: string;
  transcriptionEndpoint?: string;
  transcriptionModel?: string;
}

// IM 消息渠道配置(见 electron/channels/):QQ 官方机器人 / 微信 ClawBot
// 微信登录凭据不进设置(主进程单独加密落盘),渲染端只持有开关
// modelProfileId 为空 = 渠道任务跟随桌面端当前模型;否则固定使用某个模型档案
// approvalMode:auto(自动执行,少打扰;越界路径由审核助手把关)/ reviewer(替我审批)/ interactive(严格逐次确认)
export interface ChannelsConfig {
  qq: { enabled: boolean; appId: string; appSecret: string };
  wechat: { enabled: boolean };
  modelProfileId: string;
  approvalMode?: "auto" | "reviewer" | "interactive";
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
  releaseNotes?: string;
  updateUrl?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  error?: string;
}

// 内置本地审核模型（Qwen3-0.6B）下载状态
export interface ReviewerLocalStatus {
  configured: boolean;
  downloaded: boolean;
  sizeBytes: number;
  expectedBytes: number;
  filePath?: string;
}

// 本地语音转写（可选模型 + llama-server）状态
export interface VoiceLocalFileStatus {
  fileName: string;
  role: string;
  downloaded: boolean;
  sizeBytes: number;
  expectedBytes: number;
  filePath: string;
}

// 候选本地转写模型概要（设置界面下拉列表用）
export interface VoiceLocalModelSummary {
  id: string;
  label: string;
  note: string;
  downloaded: boolean;
  sizeBytes: number;
  expectedBytes: number;
}

export interface VoiceLocalStatus {
  engine: "cloud" | "local";
  model: {
    id: string;
    label: string;
    configured: boolean;
    files: VoiceLocalFileStatus[];
    downloaded: boolean;
    sizeBytes: number;
    expectedBytes: number;
  };
  // 全部候选模型的概要（model 为当前保存的模型）
  models: VoiceLocalModelSummary[];
  runtime: { available: boolean; path: string; source: string };
}

// 本地语音合成（Qwen3-TTS + llama-tts）状态；运行时与语音转写共用同一份 llama.cpp 包
export interface TtsLocalStatus {
  engine: "cloud" | "local";
  model: {
    id: string;
    label: string;
    configured: boolean;
    files: VoiceLocalFileStatus[];
    downloaded: boolean;
    sizeBytes: number;
    expectedBytes: number;
  };
  // 全部候选模型的概要（model 为当前保存的模型）
  models: VoiceLocalModelSummary[];
  runtime: { available: boolean; path: string; binDir: string };
}

export interface ProviderSettings {
  identity: UserIdentity | null;
  endpoint: string;
  model: string;
  // 推理强度档位（见 providers.ts reasoningEfforts；空串 = 厂商默认）
  reasoningEffort: string;
  // 子代理（dispatch_agent）专用模型的档案 id；空串 = 跟随主模型
  subAgentProfileId: string;
  apiKey: string;
  visionEndpoint: string;
  visionModel: string;
  visionApiKey: string;
  profiles: ModelProfile[];
  transcriptionEndpoint: string;
  transcriptionModel: string;
  // 语音转写引擎：cloud 走 OpenAI 兼容 /audio/transcriptions，local 走内置 Qwen3-ASR + llama-server
  transcriptionEngine: "cloud" | "local";
  // 本地转写模型 ID（transcriptionEngine 为 local 时生效）
  asrModel: string;
  // 本地语音模型保存目录；留空存到应用数据目录 models/asr
  asrModelDir: string;
  // 自定义 llama-server 可执行文件路径；留空使用内置下载的引擎
  llamaServerPath: string;
  // 语音合成（渠道语音出站，OpenAI 兼容 /audio/speech；ttsApiKey 为空时回退主模型 apiKey）
  ttsEndpoint: string;
  ttsModel: string;
  // 语音合成引擎：cloud 走 OpenAI 兼容 /audio/speech，local 走内置 Qwen3-TTS + llama-tts
  ttsEngine: "cloud" | "local";
  // 本地合成模型（ttsEngine 为 local 时生效，与主进程 TTS_MODELS 对应）
  ttsLocalModel: string;
  // 本地语音合成模型保存目录；留空存到应用数据目录 models/tts
  ttsModelDir: string;
  // 本地合成参考音色音频路径（克隆音色）；留空用模型默认音色
  ttsVoicePath: string;
  ttsApiKey: string;
  // 审核助手独立模型（reviewer 模式自动审批判断用）；留空跟随主模型，可指向本地小模型端点
  reviewerEndpoint: string;
  reviewerModel: string;
  reviewerApiKey: string;
  // 审核助手模型来源：main 跟随主模型 / local 内置本地小模型 / custom 自定义端点
  reviewerBackend: "main" | "local" | "custom";
  // 内置本地审核模型的保存目录；留空存到应用数据目录 models/reviewer
  reviewerModelDir: string;
  searxngEndpoint: string;
  bochaApiKey: string;
  // DeepSeek 原生搜索密钥：非 DeepSeek 端点下 web_search 默认走 DeepSeek 服务端搜索时用
  // （DeepSeek 端点下直接复用会话 apiKey，无需配置此项）
  deepseekSearchApiKey: string;
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
  // 厂商原生工具总开关（如 Kimi 开放平台官方 Formula 工具），默认开启
  enableNativeTools: boolean;
  // 默认关闭的原生工具（如 Kimi memory/excel 这类向服务端持久化或上传文件内容的工具）
  nativeToolsDisabled: string[];
  // 是否启用厂商内置联网搜索（如 Kimi 内置 $web_search），默认关闭
  enableWebSearchBuiltin: boolean;
  // 使用统计与运营消息设置：统计默认关闭；统计上传与消息订阅分别开关
  telemetry: TelemetrySettings;
}

// ---- 使用统计与运营消息（方案《APP使用统计与消息推送实施方案-2026-09-24》）----
export interface TelemetrySettings {
  // 使用统计开关：默认关闭，开启后本地采集前台有效使用区间并批量上报
  statsEnabled: boolean;
  // 运营消息订阅开关：与统计互不影响，关闭统计仍可接收消息
  messagesEnabled: boolean;
  // 受控运营服务地址（HTTPS）；留空表示完全关闭；政府/内网版本配置内部部署地址
  serviceUrl: string;
  // 收到新消息时是否尝试系统通知（消息中心始终可查）
  notifyNewMessages: boolean;
  // 营销类消息是否弹系统通知（默认关闭，仅入中心）
  notifyMarketing: boolean;
  // 免打扰时段（本地时间 HH:mm-HH:mm，支持跨零点；空串关闭）
  quietHours: string;
  // 普通消息每日系统弹窗上限（0 = 不弹）
  dailyPopupLimit: number;
}

export interface TelemetryStatus {
  configured: boolean;
  serviceUrl: string;
  statsEnabled: boolean;
  messagesEnabled: boolean;
  registered: boolean;
  // safe-storage = 安全存储落盘 / session = 仅会话内（安全存储不可用）/ none
  credentialMode: "safe-storage" | "session" | "none";
  installationId: string;
  consentGeneration: number;
  queue: { pending: number; droppedOverflow: number; lastDroppedAt: string };
  lastSyncAt: string;
  lastError: string;
  clockOffsetMs: number | null;
  collecting: boolean;
}

// 运营消息（公告 announcement / 版本提醒 version / 维护通知 maintenance / 营销 marketing）
export interface SystemMessage {
  message_id: string;
  category: string;
  title: string;
  // 纯文本正文（服务端只允许纯文本或经清理的有限 Markdown）
  body: string;
  // 跳转仅允许 https 地址；空串表示无跳转
  link: string;
  published_at: string;
  expires_at: string;
  revoked: boolean;
  received_at: string;
  read_at: string;
  clicked_at: string;
  notified: boolean;
}

// ---- 外观自定义（独立存储于 userData/appearance.json，不随模型设置整包覆盖）----
export type AppearanceTheme = "system" | "light" | "dark";
export type AppearanceImageFit = "cover" | "contain" | "tile";
export type AppearanceGlassStrength = "subtle" | "standard" | "strong";

export interface AppearanceSettings {
  version: 1;
  theme: AppearanceTheme;
  background: {
    // null = 使用该主题默认底色
    lightColor: string | null;
    darkColor: string | null;
    // 面板对应用背景的透明度 0..70（百分比），文字不随其变淡
    transparency: number;
    // 应用管理的资源 ID（appearance-assets 内文件名），非任意路径
    imageId: string | null;
    imageFit: AppearanceImageFit;
    // 图片遮罩 0..80（百分比）
    overlay: number;
  };
  glass: {
    enabled: boolean;
    strength: AppearanceGlassStrength;
    lightweight: boolean;
    // 透出桌面（macOS vibrancy / Windows 背景材质），平台不支持时自动降级
    systemBackdrop: boolean;
  };
  typography: {
    // system / sans-serif / serif / 本机字体家族名（主进程已校验）
    family: string;
    uiSize: 13 | 14 | 16 | 18;
    contentSize: number;
  };
}

// 平台能力：available 仅表示"可尝试"，不代表已生效
export interface AppearanceCapabilities {
  systemBackdrop: { available: boolean; kind: "vibrancy" | "background-material" | null; reason: string | null };
  glassDefault: "standard" | "lightweight";
  backdropFilter: boolean;
  platform: string;
}

// 本机实际效果状态（与用户选择分开，不持久化）
export interface AppearanceEffectiveState {
  applied: "vibrancy" | "background-material" | "none";
  reason?: string | null;
}

export interface AppearanceSnapshot {
  ok: boolean;
  settings: AppearanceSettings;
  revision: number;
  effective?: AppearanceEffectiveState;
  capabilities?: AppearanceCapabilities;
  error?: string;
  stale?: boolean;
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

export interface WikiMemoryRow {
  id: string;
  kind: string;
  category: string;
  content: string;
  // 命名记忆：用户可按名字引用的简短名字
  name?: string;
  // 会话记忆所属的任务会话 id（仅"会话记忆"页的行有值）
  sessionId?: string;
  // 内置模型认知（随应用发布）：只能编辑，不能删除
  builtIn?: boolean;
}

export interface WikiMemoryPage {
  relPath: string;
  title: string;
  scope: "global" | "workspace";
  workspacePath: string;
  rows: WikiMemoryRow[];
  content: string;
  updated: string;
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
  // 运行历史：每次执行追加一条（时间/结果/关联会话 id），保留最近 10 条
  history?: Array<{ at: string; status: string; summary: string; sessionId: string }>;
}

/** 待唤醒（主动挂起）记录：主进程 wakes.json 里 status=pending 的条目 */
export interface PendingWakeRecord {
  sessionId: string;
  wakeAt: string;
  reason: string;
}

/**
 * 计划任务开始运行的实时通知：主进程在起跑 agent 之前下发。
 * 渲染端先用它建出会话（用户消息 + 流式占位气泡），后续 agent:event（scheduleRun 打标）
 * 边跑边填充，结束时再由 sessions:prepend 下发权威转录原位归并。
 */
export interface ScheduleRunStarted {
  sessionId: string;
  runId: string;
  scheduleId: string;
  title: string;
  workspacePath: string;
  prompt: string;
  startedAt: string;
  /** 用户点了「立即执行」（区别于到点自动运行）：界面可以把这次运行的会话直接推到眼前 */
  manual?: boolean;
}

export interface DyworkerBridge {
  /** 同步平台标识（preload 直接读 process.platform）：首帧渲染即用，不经过 IPC */
  readonly platform: string;
  getInitialState(): Promise<{
    sessions: SessionRecord[];
    // 渲染端上次选中的会话 id（可能已不存在，调用方需校验后回退）
    activeSessionId?: string;
    workspacePath: string;
    workspaceEntries: WorkspaceEntry[];
    settings: ProviderSettings;
    pinnedWorkspacePaths: string[];
    platform: string;
    windowShadow: boolean;
    windowMaximized: boolean;
  }>;
  saveSessions(payload: SessionRecord[] | SessionSavePayload): Promise<{ ok: boolean; error?: string }>;
  savePinnedWorkspaces(paths: string[]): Promise<{ ok: boolean; error?: string }>;
  chooseWorkspace(): Promise<{ canceled: boolean; path?: string; entries?: WorkspaceEntry[] }>;
  chooseAttachments(): Promise<{ canceled: boolean; attachments: Attachment[] }>;
  saveClipboardImage(payload: { data: number[]; mimeType: string }): Promise<{ ok: boolean; attachment?: Attachment; error?: string }>;
  readClipboardText(): Promise<string>;
  writeClipboardText(text: string): Promise<{ ok: boolean }>;
  writeClipboardImage(payload: { dataUrl?: string; path?: string }): Promise<{ ok: boolean; error?: string }>;
  readLocalImage(path: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  refreshWorkspace(path: string): Promise<WorkspaceEntry[]>;
  getWorkspaceContext(path: string): Promise<WorkspaceContext>;
  gitBranches(workspacePath: string): Promise<GitBranchesInfo>;
  gitDiffStats(workspacePath: string): Promise<GitDiffStats>;
  gitCheckout(workspacePath: string, branch: string): Promise<{ ok: boolean; error?: string }>;
  gitCreateBranch(workspacePath: string, branch: string): Promise<{ ok: boolean; error?: string }>;
  gitCommit(payload: { workspacePath: string; message: string; includeUnstaged: boolean }): Promise<{ ok: boolean; message?: string; error?: string }>;
  gitSuggestCommitMessage(workspacePath: string): Promise<{ ok: boolean; message?: string; error?: string }>;
  gitPush(workspacePath: string): Promise<{ ok: boolean; error?: string }>;
  gitReviewOverview(payload: { workspacePath: string; base?: string }): Promise<GitReviewOverview>;
  gitFileDiff(payload: { workspacePath: string; base?: string; path: string; untracked?: boolean }): Promise<{ ok: boolean; diff?: string; binary?: boolean; truncated?: boolean; error?: string }>;
  listImportableBrowsers(): Promise<BrowserImportSource[]>;
  importBrowserData(payload: { id: string; userDataDir: string; profileId: string; kinds: BrowserImportKinds }): Promise<BrowserImportResult>;
  listImportedHistory(): Promise<ImportedHistoryEntry[]>;
  getImportedLocalStorage(origin: string): Promise<Record<string, string> | null>;
  markImportedLocalStorageDone(origin: string): Promise<{ ok: boolean }>;
  readWorkspaceMarkdown(workspacePath: string, filePath: string): Promise<{ ok: boolean; content?: string; error?: string }>;
  readWorkspaceFile(workspacePath: string, filePath: string): Promise<{ ok: boolean; content?: string; binary?: boolean; error?: string }>;
  writeWorkspaceFile(workspacePath: string, filePath: string, content: string): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>;
  gitStage(workspacePath: string, paths: string[]): Promise<{ ok: boolean; error?: string }>;
  gitDiscard(workspacePath: string, paths: string[]): Promise<{ ok: boolean; error?: string }>;
  listTraces(sessionId: string): Promise<{ ok: boolean; count: number; size: number; updatedAt: string }>;
  readTraces(payload: { sessionId: string; offset?: number; limit?: number }): Promise<{ ok: boolean; records: TraceEvent[]; total: number; offset: number }>;
  openPath(path: string): Promise<{ ok: boolean; error?: string }>;
  revealInFolder(path: string): Promise<{ ok: boolean; error?: string }>;
  openBrowser(payload: { url: string; workspacePath?: string }): Promise<{ ok: boolean; result?: string; error?: string; url?: string }>;
  /** 上报当前显示的内置浏览器 webview 及其所属激活会话，agent 的 browser__* 工具只作用于可见页面 */
  setActiveBrowserContents?(webContentsId: number, ownerSessionId?: string): void;
  /** 在系统默认浏览器打开 http/https 网址 */
  openBrowserExternal?(url: string): Promise<{ ok: boolean; error?: string }>;
  /** 内置浏览器设备模拟（手机/平板视图），宽高为 0 时关闭 */
  emulateDevice?(webContentsId: number, width: number, height: number): Promise<{ ok: boolean; error?: string }>;
  /** 保存登录密码（safeStorage 加密落盘） */
  savePassword?(origin: string, username: string, password: string): Promise<{ ok: boolean; error?: string }>;
  /** 列出已保存的密码（不含明文）；origin 为空时返回全部 */
  listPasswords?(origin: string): Promise<{ ok: boolean; passwords?: Array<{ origin: string; username: string; source: string; importedAt: string }>; error?: string }>;
  /** 按条解密密码（填充用） */
  revealPassword?(origin: string, username: string): Promise<{ ok: boolean; password?: string; error?: string }>;
  /** 删除一条已保存的密码 */
  deletePassword?(origin: string, username: string): Promise<{ ok: boolean; error?: string }>;
  /** 清除内置浏览器的浏览数据 */
  clearBrowserData?(kinds: { cookies: boolean; cache: boolean; siteData: boolean }): Promise<{ ok: boolean; error?: string }>;
  /** 内置浏览器下载进度广播 */
  onBrowserDownloadProgress?(callback: (record: { id: string; filename: string; path: string; received: number; total: number; state: "progressing" | "interrupted" | "completed" | "cancelled"; startedAt: number }) => void): () => void;
  onBrowserPanelRequest(callback: (request: { action: "open" | "close"; url?: string; ownerSessionId?: string }) => void): () => void;
  /** 浏览器 Computer Use：用户主动接管控制权 */
  takeoverBrowserControl?(): Promise<{ ok: boolean; status?: string; result?: string }>;
  /** 浏览器 Computer Use：用户交还控制权让助手继续 */
  resumeBrowserControl?(payload?: { ownerSessionId?: string; runId?: string }): Promise<{ ok: boolean; status?: string; result?: string }>;
  /** 浏览器 Computer Use：停止当前操作 */
  stopBrowserControl?(): Promise<{ ok: boolean; status?: string; result?: string }>;
  /** 浏览器 Computer Use：获取当前控制状态 */
  getBrowserControlStatus?(): Promise<BrowserControlState>;
  /** 浏览器 Computer Use：监听控制状态广播 */
  onBrowserControlState?(callback: (state: BrowserControlState) => void): () => void;
  /** 浏览器 Computer Use：监听控制恢复广播（用于自动触发续跑任务） */
  onBrowserControlResumed?(callback: (payload: { ownerSessionId?: string; runId?: string; tabId?: string }) => void): () => void;
  saveSettings(settings: ProviderSettings): Promise<{ ok: boolean; error?: string; updateUrl?: string }>;
  // ---- 外观自定义（独立于模型设置存储；浏览器预览环境无此桥接，调用方需按 undefined 降级） ----
  getAppearance?(): Promise<AppearanceSnapshot>;
  saveAppearance?(payload: { settings: AppearanceSettings; revision: number }): Promise<AppearanceSnapshot>;
  getAppearanceCapabilities?(): Promise<AppearanceCapabilities>;
  /** 打开系统文件选择器导入背景图，返回暂存资源 ID；保存外观后才成为正式引用 */
  importAppearanceImage?(): Promise<{ ok: boolean; canceled?: boolean; imageId?: string; width?: number; height?: number; error?: string }>;
  /** 按资源 ID 读取已校验图片字节，渲染端创建 Blob URL 显示 */
  readAppearanceImage?(imageId: string): Promise<{ ok: boolean; bytes?: Uint8Array; mime?: string; error?: string }>;
  /** 仅窗口底色/系统材质类预览；纯页面样式预览留在渲染端 */
  previewAppearance?(settings: AppearanceSettings): Promise<{ ok: boolean; effective?: AppearanceEffectiveState }>;
  /** 取消原生预览，恢复到最后保存状态；discardStaged 回收草稿引用但未保存的暂存图片 */
  cancelAppearancePreview?(payload?: { discardStaged?: string[] }): Promise<{ ok: boolean; effective?: AppearanceEffectiveState }>;
  resetAppearance?(): Promise<AppearanceSnapshot>;
  /** 应用菜单"恢复默认外观"应急入口触发时广播 */
  onAppearanceReset?(callback: (snapshot: AppearanceSnapshot) => void): () => void;
  probeCredentials(payload: { endpoint: string; model: string; apiKey: string }): Promise<{ ok: boolean; status?: number; latencyMs?: number; message?: string; error?: string }>;
  /** 拉取同一服务地址 + 密钥下的可用模型列表（GET /models），用于模型名称下拉切换 */
  listModels(payload: { endpoint: string; apiKey: string }): Promise<{ ok: boolean; count?: number; models?: Array<{ id: string; contextLimit?: number }>; error?: string }>;
  getReviewerLocalStatus(): Promise<ReviewerLocalStatus>;
  downloadReviewerLocalModel(): Promise<{ ok: boolean; skipped?: boolean; error?: string; status?: ReviewerLocalStatus }>;
  chooseReviewerLocalDir(): Promise<{ canceled: boolean; path?: string }>;
  onReviewerLocalDownloadProgress(callback: (progress: { received: number; total: number; percent: number }) => void): () => void;
  getVoiceLocalStatus(): Promise<VoiceLocalStatus>;
  downloadVoiceLocalModel(payload?: { modelId?: string }): Promise<{ ok: boolean; error?: string; status?: VoiceLocalStatus }>;
  chooseVoiceLocalDir(): Promise<{ canceled: boolean; path?: string }>;
  onVoiceLocalDownloadProgress(callback: (progress: { phase: string; received: number; total: number; percent: number; modelId?: string }) => void): () => void;
  getTtsLocalStatus(): Promise<TtsLocalStatus>;
  downloadTtsLocalModel(payload?: { modelId?: string }): Promise<{ ok: boolean; error?: string; status?: TtsLocalStatus }>;
  chooseTtsLocalDir(): Promise<{ canceled: boolean; path?: string }>;
  chooseTtsVoice(): Promise<{ canceled: boolean; path?: string }>;
  // 参考音色转码：读原始字节给渲染层 Web Audio 解码，再把转换出的 wav 写回主进程
  readTtsVoiceFile(payload: { path: string }): Promise<{ ok: boolean; error?: string; bytes?: Uint8Array }>;
  writeTtsVoiceFile(payload: { bytes: Uint8Array }): Promise<{ ok: boolean; error?: string; path?: string }>;
  // 会话内朗读：合成文本并返回 wav（渲染层用 Blob 播放）
  speakText(payload: { text: string }): Promise<{ ok: boolean; error?: string; wav?: Uint8Array }>;
  onTtsLocalDownloadProgress(callback: (progress: { phase: string; received: number; total: number; percent: number; modelId?: string }) => void): () => void;
  getAppUpdateStatus(): Promise<AppUpdateStatus>;
  checkForAppUpdate(): Promise<{ ok: boolean; state: AppUpdateState; version?: string; error?: string }>;
  downloadAppUpdate(): Promise<{ ok: boolean; state: AppUpdateState | "installing"; error?: string }>;
  installAppUpdate(): Promise<{ ok: boolean; state: AppUpdateState | "installing"; error?: string }>;
  onAppUpdateStatus(callback: (status: AppUpdateStatus) => void): () => void;
  completeChat(payload: {
    settings: ProviderSettings;
    messages: ChatMessage[];
    // 侧边聊天传入当前主会话：主进程据此开放 search/read_current_session 只读检索工具
    session?: SessionRecord;
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
  listMemories(): Promise<WikiMemoryPage[]>;
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
  // ---- 使用统计与运营消息（不暴露设备凭据；凭据只在主进程保存）----
  /** 渲染端人工活动信号（点击/按键/滚动节流后 fire-and-forget），只记录发生时间 */
  reportUserActivity(): void;
  getTelemetryStatus(): Promise<TelemetryStatus>;
  /** 删除此安装已上传数据：撤销凭据并触发服务端删除流程 */
  deleteTelemetryData(): Promise<{ ok: boolean; deleted?: boolean; error?: string }>;
  listSystemMessages(): Promise<SystemMessage[]>;
  markSystemMessageRead(messageId: string): Promise<{ ok: boolean }>;
  markSystemMessageClicked(messageId: string): Promise<{ ok: boolean }>;
  onSystemMessagesChanged(callback: () => void): () => void;
  onSystemMessagesFocus(callback: (payload: { messageId: string }) => void): () => void;
  resolveQuestion(sessionId: string, requestId: string, answer: string): Promise<{ ok: boolean }>;
  onInboxChanged(callback: () => void): () => void;
  onInboxFocusItem?(callback: (item: InboxItem) => void): () => void;
  onWakeStatus?(callback: (payload: { sessionId: string; status: "running" | "idle"; runId?: string; wakeAt?: string; reason?: string; manual?: boolean }) => void): () => void;
  deleteMemory(id: string): Promise<{ ok: boolean; removed?: boolean }>;
  updateMemory(payload: { id: string; content: string; category?: string; name?: string; kind?: string }): Promise<{ ok: boolean; error?: string }>;
  lintMemories(): Promise<{ ok: boolean; applied?: number; error?: string }>;
  listSkills(workspacePath?: string): Promise<SkillRecord[]>;
  setSkillEnabled(id: string, enabled: boolean, workspacePath?: string): Promise<{ ok: boolean }>;
  deleteSkill(id: string): Promise<{ ok: boolean; error?: string }>;
  createSkill(payload: { name: string; description: string; instructions: string }): Promise<{ ok: boolean; item?: SkillRecord; error?: string }>;
  updateSkill(payload: { id: string; name: string; description: string; instructions: string }): Promise<{ ok: boolean; item?: SkillRecord; error?: string }>;
  searchSkillLibraries(query: string): Promise<{ ok: boolean; results: SkillLibrarySearchResult[]; warnings: string[]; error?: string }>;
  installSkillFromLibrary(payload: { libraryId: string; slug: string }): Promise<{ ok: boolean; slug?: string; targetDir?: string; error?: string }>;
  listSchedules(): Promise<ScheduleRecord[]>;
  saveSchedule(payload: Partial<ScheduleRecord>): Promise<{ ok: boolean; error?: string }>;
  deleteSchedule(id: string): Promise<{ ok: boolean }>;
  setScheduleEnabled(id: string, enabled: boolean): Promise<{ ok: boolean }>;
  triggerSchedule(id: string): Promise<{ ok: boolean; error?: string; started?: boolean }>;
  onSchedulesChanged(callback: () => void): () => void;
  /**
   * 计划任务开始运行（主进程 runScheduledTask 起跑前下发）：渲染端据此立刻建出这次运行的
   * 会话与流式占位气泡，用户点「立即执行」后不用等任务跑完（可能几十分钟）才看到它。
   */
  onScheduleRunStarted?(callback: (payload: ScheduleRunStarted) => void): () => void;
  onSessionPrepend(callback: (session: SessionRecord) => void): () => void;
  onSessionAppend(callback: (payload: { sessionId: string; workspacePath: string; channel?: "qq" | "wechat"; runId?: string; messages: ChatMessage[] }) => void): () => void;
  cancelWakesForSession(sessionId: string): Promise<{ ok: boolean }>;
  /** 主进程待唤醒列表：渲染端“挂起中”状态的权威来源（重启后同样准确） */
  listPendingWakes?(): Promise<PendingWakeRecord[]>;
  /** 立即继续挂起的任务：取走待唤醒并马上续跑，不等约定时间 */
  resumeWakeNow?(sessionId: string): Promise<{ ok: boolean; error?: string }>;
  getChannelsStatus(): Promise<ChannelsStatusMap>;
  onChannelsStatus(callback: (statusMap: ChannelsStatusMap) => void): () => void;
  transcribeAudio(payload: {
    settings: ProviderSettings;
    audio: number[];
    mimeType: string;
  }): Promise<{ text: string }>;
  readAudioAttachment(path: string): Promise<{
    ok: boolean;
    wav?: Uint8Array;
    bytes?: Uint8Array;
    mimeType?: string;
    duration?: number;
    error?: string;
  }>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  onWindowStateChange(callback: (maximized: boolean) => void): () => void;
  reportWindowPointerDown(): void;
  // Linux 透明阴影窗口：指针进入/离开透明留白区时切换点击穿透
  setIgnoreMouse(ignore: boolean): void;
  // Linux 上忽略态由主进程轮询光标恢复后通知渲染端复位本地状态
  onWindowIgnoreMouseRestored(callback: () => void): () => void;
  listBackgroundTasks(sessionId?: string): Promise<BackgroundTaskRecord[]>;
  startBackgroundTask(payload: { command: string; cwd?: string; sessionId?: string; name?: string }): Promise<BackgroundTaskRecord>;
  stopBackgroundTask(taskId: string): Promise<{ ok: boolean }>;
  restartBackgroundTask(taskId: string): Promise<BackgroundTaskRecord>;
  getBackgroundTaskLogs(taskId: string): Promise<string[]>;
  onBackgroundTaskUpdate(callback: (event: { type: string; task: BackgroundTaskRecord }) => void): () => void;
  // 插件管理（通道名见 electron/preload.cjs）
  listPlugins(): Promise<PluginListResult>;
  checkPluginCompatibility(spec: string): Promise<PluginCompatibility>;
  installPlugin(payload: { spec: string; id?: string; allowIncompatible?: boolean }): Promise<PluginInstallResult>;
  installPluginPackage(payload: { input?: string; spec?: string; version?: string; source?: "default" | "cn" | "custom"; customRegistry?: string; allowIncompatible?: boolean }): Promise<PluginInstallResult>;
  enablePlugin(id: string): Promise<{ ok: boolean; error?: string }>;
  disablePlugin(id: string): Promise<{ ok: boolean; error?: string }>;
  configurePlugin(payload: { id: string; config: unknown }): Promise<{ ok: boolean; error?: string }>;
  uninstallPlugin(id: string): Promise<{ ok: boolean; error?: string }>;
  reloadPlugins(): Promise<{ ok: boolean; count?: number }>;
  /** 客户端半边（dsh.client）入口：只返回 URL，真正执行在渲染端的客户端运行时 */
  pluginClientBundles(id: string): Promise<PluginClientBundlesResult>;
  /** 插件视图要的会话投影（DSH 客户端契约里的 useProjection） */
  pluginProjection(payload: { sessionId: string; key: string }): Promise<{ ok: boolean; value?: unknown; error?: string }>;

}

export interface BackgroundTaskRecord {
  id: string;
  sessionId: string;
  command: string;
  cwd: string;
  name: string;
  status: "running" | "stopped" | "error";
  startTime: string;
  endTime?: string | null;
  exitCode?: number | null;
  ports: number[];
  urls: string[];
  outputTail: string[];
  pid?: number;
}


// ---- 插件管理（host/plugins/plugins-ipc.mts 的通道契约）----

export interface PluginEntryRecord {
  id: string;
  name: string;
  description: string;
  /** 客户端半边声明（dsh.client）；手工加进清单、没有 bundle 记录的条目也靠它 */
  client?: { platform?: string; inject?: string[] } | null;
  /** 内置插件（随应用分发，默认启用，可在插件页停用） */
  builtin?: boolean;
  disabled: boolean;
  config: unknown;
  active: boolean;
  error: string | null;
}

export interface PluginBundleRecord {
  name: string;
  packageName: string;
  version: string;
  description: string;
  source?: { kind: string; input: string; source: string } | null;
  /** 客户端半边声明（dsh.client）；没有界面半边的插件为 null */
  client?: { platform?: string; inject?: string[] } | null;
  patchFile: string | null;
  declared: boolean;
  installed: boolean;
  pinnedVersion: string | null;
  drift: string | null;
  error: string | null;
}

/** 兼容性判定：runnable 能跑；partial 同名服务语义不同；unsupported 跑不了（含原因） */
export interface PluginCompatibility {
  name: string;
  version: string;
  verdict: "runnable" | "partial" | "unsupported";
  reasons: string[];
  matrix: string;
  missingPackages: string[];
  clientHalf: { platform?: string; inject?: string[] } | null;
  hostHalf: { entry: string; importable: boolean; importError: string | null; inject: string[]; hints: string[] };
  services: Array<{ name: string; state: "fulfilled" | "name-only" | "missing"; reason: string }>;
}

export interface PluginListResult {
  entries: PluginEntryRecord[];
  bundles: PluginBundleRecord[];
  warnings: string[];
  status: { dir: string; tree: string; mounted: boolean; count: number; failed: number };
}

/** 插件客户端半边（dsh.client）的入口清单：只给 URL，执行在渲染端 */
export interface PluginClientBundlesResult {
  ok: boolean;
  id?: string;
  name?: string;
  version?: string;
  platform?: string;
  /** 插件声明的客户端服务（cordis inject），界面用它说明"还差哪些服务" */
  inject?: string[];
  entries?: Array<{ subpath: string; relative: string; primary: boolean; url: string }>;
  /** 它声明的客户端模块（依赖在前）：slots/locale/settings 这些服务由它们提供 */
  modules?: Array<{ spec: string; url: string }>;
  /** 声明了但本机没装的客户端模块 */
  missingModules?: string[];
  error?: string;
}

export interface PluginInstallResult {
  ok: boolean;
  name?: string;
  id?: string;
  error?: string;
  incompatible?: boolean;
  verdict?: string;
  matrix?: string;
  entry?: PluginEntryRecord;
  stage?: string;
  /** 兼容性分析（拒绝时用来展示逐条原因） */
  analysis?: PluginCompatibility & { matrix?: string };
  downloaded?: { ok?: boolean; kind?: string; ranInstallScripts?: boolean; error?: string };
}

declare global {
  interface Window {
    dyworker?: DyworkerBridge;
  }
}
