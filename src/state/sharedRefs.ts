// 跨模块共享的模块级 ref。
//
// 这几个 ref 原本在 App.tsx 内用 useRef 声明，随会话辅助函数一起搬到模块级 actions
// 后必须保证「同一实例」——App 的清理 effect、IPC 订阅运行时与 actions 三处读写都要
// 指向同一份数据，因此抽成普通 `{ current: … }` 对象（模块只求值一次，天然单例）。
import type { Attachment, DebugLogEntry, MessageAnnotation, SessionRecord, SkillRecord, TraceEvent, WorkspaceEntry } from "../types";
import type { BrowserWebviewElement } from "../features/browser/browserUtils";
import type { RegisteredInputCandidate } from "../pluginRuntime/inputTriggers";
import type { ComposerHandle } from "../pluginRuntime/dshDraftEditor.ts";
import type { ComposerPasteBlock } from "./composerStore";
import type { ToolPanelTab } from "./layoutStore";
import type { WakingSessionEntry } from "./sessionStore";
import { previewSessions } from "./previewData";

// 事件回调里要读"当前正在续跑的会话"做气泡收口，同时保持 setState updater 纯净
export const wakingSessionsRef: { current: Record<string, WakingSessionEntry> } = { current: {} };
export const sessionNoticeTimersRef: { current: Map<string, number> } = { current: new Map() };
export const sessionErrorTimersRef: { current: Map<string, number> } = { current: new Map() };
// 会话列表快照 ref：渠道实时事件监听器（注册一次、长期存活）需要读取最新会话，
// 用 ref 避免闭包捕获到旧的 sessions 状态
export const sessionsRef: { current: SessionRecord[] } = { current: previewSessions };
export const sessionRenameRequestsRef: { current: Map<string, {title:string;token:symbol}> } = { current: new Map() };
export const sessionDraftsRef: { current: Record<string, { text: string; pastes: ComposerPasteBlock[]; annotations: MessageAnnotation[]; attachments: Attachment[] }> } = { current: {} };

// 当前活动会话镜像：App 每次渲染写入，browserActions 上报页面归属时读取
export const activeIdRef: { current: string } = { current: previewSessions[0].id };

// 浏览器面板：每个标签页常驻一个 webview、以及按 tabId 缓存的 ref 回调
export const browserWebviewsRef: { current: Map<string, BrowserWebviewElement> } = { current: new Map() };
export const browserWebviewRefCallbacks: { current: Map<string, (node: BrowserWebviewElement | null) => void> } = { current: new Map() };
// 浏览器「继续交给助手」广播去抖，避免同一次恢复被重复处理
export const browserResumeGuardRef: { current: boolean } = { current: false };

// 面板标签页序号，以及当前标签 / 标签列表的渲染镜像（App 每次渲染刷新，模块函数读取）
export const toolPanelTabSequenceRef: { current: number } = { current: 1 };
export const activeToolPanelTabIdRef: { current: string } = { current: "" };
export const toolPanelTabsRef: { current: ToolPanelTab[] } = { current: [] };
export const closeToolPanelTabRef: { current: ((id: string) => void) | null } = { current: null };

// 打开文件预览：由 toolPanelActions 模块初始化后指向真正的实现
export const openFilePreviewRef: { current: (filePath: string, root: string) => void } = { current: () => {} };

// 输入区 / 选区标注 / 右键菜单的模块级 ref：App 的 JSX 绑定与 composerActions 的读写
// 必须指向同一实例，随这组操作函数一起从 App.tsx 的 useRef 挪到模块级。
export const textareaRef: { current: ComposerHandle | null } = { current: null };
export const viewportRef: { current: HTMLDivElement | null } = { current: null };
// @token → 实际选择的文件路径：同名文件时以用户候选菜单里点选的那个为准
export const mentionTokenPathsRef: { current: Map<string, string> } = { current: new Map() };
// @「标题」token → 实际选择的会话 id：同名会话时以用户点选的那个为准（与文件同构）
export const sessionTokenIdsRef: { current: Map<string, string> } = { current: new Map() };
// 注释定位标记的引用列表：从当前正文重新定位，不保留可能失效的 Range
export const annotationQuotesRef: { current: Array<{ id: string; n: number; quote: string }> } = { current: [] };
// 插件候选菜单被主动关掉的记忆：文本/触发位一致时不再自动弹回（跨 actions 共享同一份）
export const dismissedPluginMention: { current: { sessionId: string; text: string; start: number; query: string } | null } = { current: null };
// 工作区文件扁平列表与 @// 候选项的渲染镜像：派生自 state，App 每次渲染刷新，actions 读取
export const workspaceFilesRef: { current: WorkspaceEntry[] } = { current: [] };
export type MentionItem = { id: string; title: string; detail: string; pluginInput?: RegisteredInputCandidate; skill?: SkillRecord; file?: WorkspaceEntry; prompt?: string; session?: SessionRecord };
export const mentionItemsRef: { current: MentionItem[] } = { current: [] };
// 新建任务：由 App 注册后指向真正的实现（applyMention 触发内置 /new 时调用）
export const createTaskRef: { current: (targetWorkspacePath?: string) => void } = { current: () => {} };

// 语音录制 / 朗读 / 播放的模块级 ref：App 的清理 effect 与 messageActions 的读写必须同一实例
export const recorderRef: { current: MediaRecorder | null } = { current: null };
export const recordingChunksRef: { current: Blob[] } = { current: [] };
export const microphoneStreamRef: { current: MediaStream | null } = { current: null };
// 语音转写结果的分发目标：默认写进 composer，评论卡录音时指向评论 setter
export const voiceTargetRef: { current: "composer" | ((text: string) => void) } = { current: "composer" };
export const speakAudioRef: { current: HTMLAudioElement | null } = { current: null };
export const speakObjectUrlRef: { current: string } = { current: "" };
export const speakTokenRef: { current: number } = { current: 0 };
export const voiceAudioRef: { current: HTMLAudioElement | null } = { current: null };
export const voiceObjectUrlRef: { current: string } = { current: "" };

// 刚点了「立即执行」的计划 id：等主进程回 schedules:run-started 时把这次运行的会话直接打开
// （scheduleActions 手动触发 与 sessionIpcRuntime 订阅 共用同一实例）
export const manualRunScheduleRef: { current: string } = { current: "" };

// 发消息 / 排队消息（sendMessageActions）共享的模块级 ref：App 的清理 effect、运行时与
// actions 必须指向同一实例，随这组函数一起从 App.tsx 的 useRef 挪到模块级。
export const queuedRunsRef: { current: Map<string, Set<string>> } = { current: new Map() };
export const agentUnsubscribeRefs: { current: Map<string, () => void> } = { current: new Map() };
export const runningRunIdsRef: { current: Map<string, string> } = { current: new Map() };
export const shouldScrollToBottomRef: { current: string | null } = { current: null };
// 当前活动的图片/文件附件镜像：async 发送期间用于判断附件是否还是同一次选择
export const attachmentsRef: { current: Attachment[] } = { current: [] };

// 仍留在 App 的本地实现：由 App 在各自定义处挂载，sendMessageActions 经此调用，避免 import App。
export const handleGoalActionRef: { current: (sessionId: string, action: "pause" | "resume" | "remove" | "complete") => void } = { current: () => undefined as never };
export const refreshMemoriesRef: { current: () => void } = { current: () => undefined as never };
export const refreshSkillsRef: { current: (announce?: boolean) => void } = { current: () => undefined as never };
export const queueDebugLogRef: { current: (entry: DebugLogEntry) => void } = { current: () => undefined as never };
export const appendSessionTracesRef: { current: (records: TraceEvent[]) => void } = { current: () => undefined as never };
export const playCompletionSoundRef: { current: () => void } = { current: () => undefined as never };

// 设置保存 / 应用更新 / 模型档案（settingsActions）共享的模块级 ref：App 的引导失败标记、
// 设置页就地提示与模型菜单的拉取去重都要指向同一实例，随这组函数一起从 App.tsx 的 useRef
// 挪到模块级。
// 引导是否失败：getInitialState 拿不到数据时（主进程 handler 抛错、IPC 异常等），
// 本地状态是空的/默认的，此时任何写回都会把磁盘上的真实数据覆盖掉。
// 真实事故：app:initial-state 因缺依赖抛错 → ready 仍被置真 → 会话/配置/置顶被整批覆盖。
export const bootstrapFailedRef: { current: boolean } = { current: false };
// 最近一次保存失败的原因：设置页整页展示时用于就地提示（聊天区提示条此时不可见）
export const settingsSaveErrorRef: { current: string } = { current: "" };
// 模型列表拉取去重键：同一 endpoint+key 只拉一次，换地址或密钥后重新拉
export const composerModelsKeyRef: { current: string } = { current: "" };
