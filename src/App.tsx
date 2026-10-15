import { createTraceBuffer, trimRecentText } from "./traceBuffer";
import { createSessionSaveQueue } from "./sessionSaveQueue";
import { formatMessageTime } from "./lib/format";
import {
  FILE_TOKEN_REGEX,
  INLINE_TOKEN_REGEX,
  SESSION_TOKEN_REGEX,
  buildSkillSummaryMessages,
  buildSkillSummaryTranscript,
  copyTextToClipboard,
  displayWorkspace,
  formatSessionReference,
  indexConversation,
  latestWorkingContext,
  messageVisibleText,
  parseSkillDraft,
  pathDirname,
  shortTitle,
  skillTokensInText,
  stripControlMarkers,
  stripControlMarkersCached,
} from "./lib/text";
import { activityDisplayTitle, appendBranchActivity, patchActivityTree } from "./lib/activity";
import { WORKSPACE_FILE_DRAG_TYPE, buildReviewTree, filterWorkspaceEntries, isMarkdownFile, isTextPreviewFile, parseReviewDiff, workspaceFileAttachment } from "./lib/files";
import type { ReviewTreeDir } from "./lib/files";
import { FilesSplitPanel } from "./features/files/FilesSplitPanel";
import { GitReviewPanel } from "./features/review/GitReviewPanel";
import { ReviewPanel } from "./features/review/ReviewPanels";
import { BROWSER_DEVICE_PRESETS, BROWSER_MOBILE_UA, BROWSER_START_LINKS, browserPasswordFillScript, browserTabTitleOf, normalizeBrowserInput, type BrowserDownloadRecord, type BrowserWebviewElement } from "./features/browser/browserUtils";
import { BrowserImportDialog, BrowserPasswordsDialog, BrowserSectionDialog } from "./features/browser/BrowserDialogs";
import { SideChatPanel } from "./features/sessions/SideChatPanel";
import { InboxDialog } from "./features/inbox/InboxDialog";
import { ApprovalCard, ChangesSummary, MessagePasteBlocks, QuestionCard } from "./features/message/Cards";
import { ImageLightbox } from "./features/message/ImageLightbox";
import { AnnotationEditorCard, ContextMenuPopup, MessageAnnotationChip, SelectionQuoteBar, findQuoteRange, type ContextMenuItem } from "./features/annotations/SelectionOverlays";
import { MemoryEditDialog } from "./features/memory/MemoryPanels";
import { SkillDraftDialog, SkillEditDialog } from "./features/skills/SkillPanels";
import { composerApprovalModes } from "./features/plans/PlansPanel";
import type { ScheduleDraft } from "./features/plans/PlansPanel";
import { ContextRing } from "./features/usage/UsagePanels";
import { AppUpdateAction, AppUpdateDialog, FullAccessDialog, IdentitySetupDialog } from "./features/settings/SettingsSubPanels";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import type { SettingsTab } from "./features/settings/SettingsDialog";
import { ConversationToolsIcon, ForkBranchIcon, PanelLeftIcon, PanelRightIcon } from "./app/icons";
import { useLayoutStore } from "./state/layoutStore";
import type { ToolPanelTab } from "./state/layoutStore";
import { useSettingsStore } from "./state/settingsStore";
import { useBrowserStore } from "./state/browserStore";
import { Sidebar } from "./app/Sidebar";
import { ShellChrome } from "./app/ShellLayout";
import { ConversationPane } from "./features/conversation/ConversationPane";
import { ToolPanel } from "./features/toolpanel/ToolPanel";
import { defaultSettings, settingsWithProfile } from "./lib/settings";
import { blobToWavMono } from "./lib/audio";
import { ArchivedPlan, PlanProgress } from "./PlanProgress";
import { GoalBanner } from "./GoalBanner";
import { AppLogo } from "./AppLogo";
import { activeGoal, changeGoalStatus, goalElapsed, settleGoal, startGoal } from "./goal";
import { FilePreviewPanel } from "./FilePreviewPanel";
import { FileBrowserToolbar } from "./FileBrowserToolbar";
import { FileTextEditor } from "./FileTextEditor";
import { ExtensionCreationDialog } from './ExtensionCreationDialog';
import { getModelReasoningConfig, reasoningModelKey, selectedReasoningEffort, updateReasoningOverride } from '../electron/model-reasoning.ts';
import type { ExtensionCreationRequest } from './ExtensionCreationDialog';
import { authoringSkill } from '../electron/authoring-skills';
import type { AuthoringKind } from '../electron/authoring-skills';
import {
  AlarmClock,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  AtSign,
  Slash,
  BarChart3,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronUp,
  ClipboardPaste,
  Cookie,
  Database,
  Copy,
  CornerUpLeft,
  Download,
  FileCode2,
  FileDiff,
  File,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  ListTree,
  Hand,
  History,
  House,
  Info,
  KeyRound,
  Landmark,
  ListTodo,
  LoaderCircle,
  MessageSquarePlus,
  MessagesSquare,
  MessageSquare,
  MessageCircleQuestion,
  Mic,
  Minus,
  Monitor,
  Moon,
  MoreHorizontal,
  MoreVertical,
  Package,
  Palette,
  PanelRight,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanText,
  Search,
  Settings,
  Scissors,
  ShieldAlert,
  SquarePlus,
  SquarePen,
  SquareTerminal,
  Sparkles,
  Square,
  Target,
  Terminal,
  Trash2,
  GitCommitHorizontal,
  Upload,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import { CSSProperties, ClipboardEvent, createElement, DragEvent, FormEvent, KeyboardEvent, MouseEvent, ReactNode, memo, useCallback, useLayoutEffect, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { applyReasoningStream } from "./reasoningStream";
import { PluginIcon } from "./PluginIcon";
import { ModsPanelView } from './ModsPluginsPage';
import { PluginSlotView, onPluginPanelRequest } from "./PluginSlotView";
import type { PluginPanelRequest } from "./PluginSlotView";
import { availablePluginPanels, pluginPanelTab, PluginPanelPreferences } from "./pluginPanelTabs";
import type { PluginPanelTab } from "./pluginPanelTabs";
import { clientHost, onOpenSessionRequest } from "./pluginRuntime/clientHostSingleton.ts";
import type { RegisteredInputCandidate } from './pluginRuntime/inputTriggers.ts';
import { detectTrigger } from './pluginRuntime/vendor/dsh-input-controller/index.js';
import { DshChildHistory } from './DshChildHistory';
import { reconcileDshTurns, patchDshAssistant, mergeCreatedDshTask } from './dshTurns';
import { DshComposer } from './DshComposer';
import type { ComposerHandle } from './pluginRuntime/dshDraftEditor.ts';
import { loadEnabledClientHalves } from "./pluginRuntime/builtinPlugins.ts";
import { attachmentImageSource, copyImageToClipboard, ImageAttachmentThumb, ImageAttachmentView, rememberLocalImageData } from "./ImageAttachment";
import { contextUsageSummary, estimateSessionTokens, formatTokenCount } from "./contextUsage";
import { InteractiveMessage, MarkdownSnippet } from "./InteractiveMessage";
import { TokenActivity } from "./TokenActivityPanel";
import type { MarkdownLiveEditorHandle } from "./markdownLiveEditor";
import { TraceConsole } from "./TraceConsole";
import { BackgroundTasksPanel } from "./BackgroundTasksPanel";
import { SystemMessagesPanel } from "./SystemMessagesPanel";
import { BrowserControlOverlay } from "./BrowserControlOverlay";
import { forgetSessionStream, forgetStreamMessage, isChannelRunEnvelope, isScheduleRunEnvelope, isWakeRunEnvelope, mergePrependedSession, reconcileChannelAppend, registerStreamMessage, takeStreamMessage } from "./channelStream";
import type { ChannelStreamRef, ChannelStreamRuns } from "./channelStream";
import type { ActivityRecord, AgentResult, AppUpdateStatus, ApprovalAction, ApprovalMode, Attachment, BrowserControlState, BrowserImportKinds, BrowserImportSource, ChannelConnectionStatus, ChannelsConfig, ChannelsStatusMap, ChatMessage, DebugLogEntry, FileChange, GitBranchesInfo, GitDiffStats, GitReviewFile, GitReviewOverview, HookRule, ImportedHistoryEntry, InboxItem, MessageAnnotation, ModelProfile, ProviderSettings, QuestionRequest, PendingWakeRecord, ReviewerLocalStatus, ScheduleRecord, SessionRecord,  SkillLibraryConfig, SkillLibrarySearchResult, SkillRecord, StandingRule, TelemetrySettings, TelemetryStatus, TtsLocalStatus, TraceEvent, UsageRecord, UserIdentity, VoiceLocalStatus, WikiMemoryPage, WikiMemoryRow, WorkspaceContext, WorkspaceEntry } from "./types";
import { formatAnnotationsForPrompt, normalizeQuote } from "./annotations";
import { isGlmNativeVisionModel, matchProvider, modelContextLimit, providerPresets, usesResponsesApi } from "./providers";
import { ReasoningControl } from "./ReasoningControl";
import { hasConfiguredModel, isLocalModelEndpoint } from "../electron/host/dsh-runtime/model-settings.mts";
import { recordTaskFailure } from './taskFailure.ts';
import { assistantImageAttachments } from './assistantImages.ts';
import { beginSession, discardSession } from "./appearance/controller";
import { closeWakingNote, formatWakeTime, rephraseSleepNote, settleResolvedSleepNote, wakingNoteTexts } from "./wakeNote";
import { contentEchoesProcessCommentary, messageWithDeliveryContent, processActivitiesWithCommentary } from "./processCommentary.ts";
import { ClampedUserText, renderInlineTokens } from "./features/message/ClampedText";
import { isVoiceAttachment, isVoiceMessage, VoiceMessageBubble } from "./features/message/VoiceMessage";
import { ProcessTimeline, RunningStatusLabel } from "./features/message/ProcessTimeline";

// 兼容既有引用（tests/fixtures/file-browser.tsx 等）从 App 引入文件面板
export { FilesSplitPanel };

const now = new Date().toISOString();
// 正在续跑的会话（到点自动唤醒或用户点的「立即继续」）：气泡说明与运行状态行都按它改写
type WakingSessionEntry = { wakeAt: string; manual?: boolean; marker: string; done: string };
// 任务运行中的会话快照兜底保存间隔：流式输出让 sessions 状态以分片频率
// 变化，常规 180ms 防抖保存会把整份存档（大档几十 MB）以秒级频率整档
// 写盘 + IPC 克隆，曾在 Linux 上打出 194MB/s 磁盘写入并把进程拖死；
// 任务期间只按此间隔低频兜底，任务结束后常规保存立即恢复。
const SESSION_STREAMING_SAVE_INTERVAL_MS = 30000;

const previewSessions: SessionRecord[] = [
  {
    id: "codex-layout",
    title: "优化 UI 布局为 Codex 风格",
    workspacePath: "/workspace/dyworker",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        role: "user",
        createdAt: now,
        content: "主区域对话内容块的样式也要跟 Codex 对齐。",
      },
      {
        role: "assistant",
        createdAt: now,
        plan: [
          { title: "对比 Codex 参考截图与当前布局", status: "completed" },
          { title: "调整用户消息与助手回复样式", status: "completed" },
          { title: "统一 Markdown 内容层级", status: "completed" },
        ],
        changes: [
          {
            path: "src/styles.css",
            added: 3,
            removed: 2,
            diff: "--- a/src/styles.css\n+++ b/src/styles.css\n@@ -892,7 +892,7 @@\n .user-bubble {\n-  max-width: min(680px, 76%);\n-  padding: 11px 16px;\n+  max-width: min(680px, 78%);\n+  padding: 10px 16px;\n+  border-radius: 14px;\n   background: #efeee9;",
          },
          { path: "src/App.tsx", added: 58, removed: 23 },
        ],
        durationMs: 185_000,
        activities: [
          { id: "preview-act-1", kind: "read_file", title: "读取 src/App.tsx", detail: "界面主组件", status: "success" },
          { id: "preview-act-2", kind: "edit_file", title: "编辑 src/styles.css", detail: "已编辑 src/styles.css（+96 -41）", status: "success" },
        ],
        content:
          "**已完成主对话区优化：**\n\n- 用户消息改为 Codex 风格的浅灰内容块。\n- 助手回复采用开放式排版，不再堆叠卡片和分割线。\n- 统一了标题、正文、列表、引用、表格和代码内容的层级与间距。\n- 长内容更容易连续阅读，重要信息也更容易扫描。\n\n新界面已经切换到 Electron，后续可以继续完善任务执行和文件处理能力。",
      },
    ],
  },
  {
    id: "model-settings",
    title: "修复模型切换参数错误",
    workspacePath: "/workspace/dyworker",
    createdAt: now,
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    messages: [],
  },
  {
    id: "project-readme",
    title: "完善项目使用说明",
    workspacePath: "/workspace/dyworker",
    createdAt: now,
    updatedAt: new Date(Date.now() - 120_000).toISOString(),
    messages: [],
  },
];

const previewWorkspace: WorkspaceEntry[] = [
  { name: "build", path: "/dyworker/build", kind: "directory", children: [] },
  {
    name: "electron",
    path: "/dyworker/electron",
    kind: "directory",
    children: [
      { name: "channels", path: "/dyworker/electron/channels", kind: "directory", children: [] },
      { name: "main.mjs", path: "/dyworker/electron/main.mjs", kind: "file" },
      { name: "agent.mjs", path: "/dyworker/electron/agent.mjs", kind: "file" },
    ],
  },
  { name: "src", path: "/dyworker/src", kind: "directory", children: [] },
  { name: "tests", path: "/dyworker/tests", kind: "directory", children: [] },
];

// 内置斜杠命令（对照 Codex /init），与工作模板一起出现在 / 菜单里
const builtinCommands = [
  {
    id: "builtin:new",
    title: "/new",
    detail: "开启全新会话，重置对话上下文",
    prompt: "/new",
  },
  {
    id: "builtin:goal",
    title: "/goal",
    detail: "设定目标并持续推进；支持 /goal 暂停、继续、取消，输入框上方可查看状态和用时",
    prompt: "/goal ",
  },
  {
    id: "builtin:init",
    title: "/init",
    detail: "分析工作区并生成 AGENTS.md 项目约定",
    prompt: "请分析当前工作区的目录结构和主要文件，总结这个工作区的用途、内容组织方式和处理时的注意事项，在工作区根目录创建 AGENTS.md，把这些长期约定写清楚，让以后的任务能自动遵循。如果已经有 AGENTS.md，先读取它，在原有基础上补充完善，保留仍然有效的约定。",
  },
];

function makeSession(workspacePath = ""): SessionRecord {
  const createdAt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "新任务",
    workspacePath,
    createdAt,
    updatedAt: createdAt,
    messages: [],
  };
}

function keepSingleUnstartedSession(items: SessionRecord[]) {
  let kept = false;
  return items.filter((session) => {
    if (session.runtime === 'dsh' || session.archived || session.messages.length > 0) return true;
    if (kept) return false;
    kept = true;
    return true;
  });
}

// 任务完成提示音：两声短促的上行音（E5 → B5），用 WebAudio 合成，不依赖音频资源文件。
// 浏览器要求用户交互后才能出声，首次交互前的 AudioContext 处于 suspended，这里尝试 resume。
let completionAudioContext: AudioContext | null = null;
function playCompletionSound() {
  try {
    const AudioCtor = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    completionAudioContext = completionAudioContext || new AudioCtor();
    const ctx = completionAudioContext;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    [659.25, 987.77].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const start = now + index * 0.13;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.45);
    });
  } catch {
    // 音频不可用时静默跳过，不影响任务结果
  }
}

// 输入框长粘贴折叠块：超过阈值的大段粘贴文本不直接灌进输入框，
// 折叠成块随消息一起发送（对照 Codex 的长粘贴折叠呈现）
interface ComposerPasteBlock {
  id: string;
  text: string;
}
const COMPOSER_LONG_PASTE_THRESHOLD = 1000;

// ===== Codex 风格右侧面板:文本文件判断 / 代码查看 / 审阅 diff =====

let browserDefaultUserAgent = "";

// ===== 浏览器「导入 Cookie 和密码」对话框（对照 Codex 浏览器更多菜单） =====

const speakMessageKey = (message: ChatMessage) => message.id || `${message.role}:${message.createdAt}`;

type MessageRowActions = { [Key in "openReferencedFile" | "openImagePreview" | "handleMessageContextMenu" | "togglePlayVoice" | "toggleActivityCollapse" | "copyMessage" | "startMessageEdit" | "toggleSpeakMessage" | "openMessageSession" | "forkSessionAt" | "openPluginReference" | "openReview" | "bindMessageRow"]: (...args: any[]) => any };

// 回调始终读取最新的会话与设置，消息行的展示数据则全部通过 props 明确传入。
function useStableHandlers<T extends Record<string, (...args: any[]) => any>>(handlers: T): T {
  const latest = useRef(handlers);
  useLayoutEffect(() => { latest.current = handlers; });
  return useMemo(() => Object.fromEntries(Object.keys(handlers).map(key => [key,
    (...args: any[]) => latest.current[key](...args),
  ])) as T, []);
}

const ConversationMessageRow = memo(function ConversationMessageRow({
  message, index, turnIndex, sessionId, workspacePath, isEditing, activeTaskRunning, isStreamingMessage,
  playingVoicePath, voiceLoadingPath, speakingMessageKey, speakingLoadingKey, collapsedActivities, actions,
}: {
  message: ChatMessage; index: number; turnIndex: number; sessionId: string; workspacePath: string;
  isEditing: boolean; activeTaskRunning: boolean; isStreamingMessage: boolean;
  playingVoicePath: string | null; voiceLoadingPath: string | null; speakingMessageKey: string | null; speakingLoadingKey: string | null;
  collapsedActivities: Set<string>; actions: MessageRowActions;
}) {
  message = messageWithDeliveryContent(message);
  // 仍在输出中的助手消息（没有终态 taskStatus）不显示时间/复制行；
  // 不能按最后一条下标判断——后面可能跟着排队占位消息
  const hideAssistantActions = message.role === "assistant"
    && activeTaskRunning
    && !message.taskStatus
    && isStreamingMessage;
  // 未定稿（仍在流式输出）的助手消息：交给 InteractiveMessage 走增量 Markdown 路径
  // （按块解析、已定稿的块 memo 冻结，见该组件 streaming 说明）。
  // streamingAssistantIndex 在无运行任务时为 -1，下标不可能等于 -1，故天然安全

  // 旧路径（非 DSH 回合）执行中：模型的话在过程流里实时出现，正文区只在收尾后
  // 显示最终答复，避免同一段文字在过程流和正文区各出现一次。
  // DSH 回合的正文本身就是逐条回复累积的会话输出，照旧显示。
  const liveOutputInProcess = isStreamingMessage && !message.dshTurnId;
  // 用户气泡：@文件 token 高亮 + 点击打开；/技能 token 内联随正文展示
  const inlineTokenNames = message.role === "user"
    ? new Set((message.attachments ?? []).filter((attachment) => attachment.inlineRef).map((attachment) => attachment.name))
    : new Set<string>();
  const messageSkillNames = message.role === "user"
    ? new Set(message.skillsUsed ?? [])
    : new Set<string>();
  // 用户气泡：@「标题」会话 token 高亮，点击切到被引会话
  const messageSessionTitles = message.role === "user"
    ? new Set((message.sessionRefs ?? []).map((ref) => ref.title))
    : new Set<string>();
  // 旧消息兼容：正文里没有 /技能名 token 时才退回 chip 展示（新消息已内联融合）
  const legacySkillChips = message.role === "user"
    ? (message.skillsUsed ?? []).filter((name) => !skillTokensInText(messageVisibleText(message)).has(name))
    : [];
  // 纯图片消息：占位文字已去掉，气泡里没有文字/chip/粘贴块/注释/语音时整个气泡不渲染，只留图片
  const bubbleHasContent = message.role === "user" && (
    isVoiceMessage(message)
    || Boolean(messageVisibleText(message).trim())
    || legacySkillChips.length > 0
    || Boolean(message.attachments?.some((attachment) => !attachment.isImage && !attachment.inlineRef && !isVoiceAttachment(attachment)))
    || Boolean(message.pasteBlocks?.length)
    || Boolean(message.annotations?.length)
    || Boolean(message.dshAttachmentNames?.length)
  );
  // 气泡里只有注释 chip：不套气泡边框，chip 直接裸放（套框显得笨重）
  const bubbleBare = message.role === "user"
    && Boolean(message.annotations?.length)
    && !isVoiceMessage(message)
    && !messageVisibleText(message).trim()
    && !legacySkillChips.length
    && !message.attachments?.some((attachment) => !attachment.isImage && !attachment.inlineRef && !isVoiceAttachment(attachment))
    && !message.pasteBlocks?.length;
  const openMessageFile = (name: string) => {
    const recorded = (message.attachments ?? []).find((attachment) => attachment.inlineRef && attachment.name === name);
    void actions.openReferencedFile(name, recorded?.path);
  };
  const assistantImages = message.role === 'assistant' ? assistantImageAttachments(message) : [];
  const userImages: Attachment[] = message.role === 'user' ? [
    ...(message.attachments?.filter(attachment=>attachment.isImage) || []),
    ...(message.dshAttachments || []).flatMap((part,index)=>part.type === 'image' ? [{
      name:part.name || message.dshAttachmentNames?.[index] || '图片附件',path:'',mimeType:part.mediaType,
      size:Math.floor(part.data.length * 3 / 4),isImage:true,previewUrl:`data:${part.mediaType};base64,${part.data}`,
    }] : []),
  ] : [];
  // 点击气泡里的会话引用：切到对应会话（会话可能已被删除，找不到就提示）
  const openMessageSession = (title: string) => actions.openMessageSession(message, title);
  return (
  <div
    className={`message-row ${message.role}`}
    // key 用稳定的消息 id：此前拼 createdAt-index，任务收尾改写 createdAt 会让
    // 流式期间建好的整棵子树（高亮代码、mermaid 图）整体卸载重建
    // 旧版唤醒收尾曾给用户和助手写入同一个 id；按角色区分以兼容这些历史记录。
    key={`${message.role}:${message.id || `${message.createdAt}-${index}`}`}
    ref={(node) => actions.bindMessageRow(node, index, turnIndex, message.role === "user")}
  >
    {message.role === "system" ? null : message.role === "user" ? (
      <>
        <div className="user-message-stack">
          {/* 图片附件独立展示在气泡上方（微信风格方形缩略图），不与文本混排在气泡里 */}
          {Boolean(userImages.length) && (
            <div className="message-attachments">
              {userImages.map((attachment,index) => (
                attachment.path || attachment.previewUrl ? (
                  <ImageAttachmentView
                    key={`${message.createdAt}-${index}-${attachment.path || attachment.previewUrl}`}
                    attachment={attachment}
                    onPreview={(payload) => actions.openImagePreview(payload, userImages)}
                  />
                ) : (
                  <span key={`${message.createdAt}-${attachment.path}`}>
                    <FileImage size={13} />
                    图片
                  </span>
                )
              ))}
            </div>
          )}
          {bubbleHasContent && (
          <div
            className={`user-bubble${isEditing ? " editing" : ""}${isVoiceMessage(message) ? " voice-wrapper" : ""}${bubbleBare ? " bare" : ""}`}
            onContextMenu={(event) => actions.handleMessageContextMenu(event, message)}
          >
          {!!message.dshAttachmentNames?.length && <span className="message-inline-refs" aria-label="已发送的插件附件">
            {message.dshAttachmentNames.map((name,at)=><span className="ref-chip" key={at}><FileText size={13} /><span>{name}</span></span>)}
          </span>}
          {Boolean(legacySkillChips.length || message.attachments?.some((attachment) => !attachment.isImage && !attachment.inlineRef && !isVoiceAttachment(attachment))) && (
            <span className="message-inline-refs">
              {/* /技能名 已内联随正文高亮；这里只兜底旧消息（正文无 token）和手动添加的附件 chip */}
              {legacySkillChips.map((name) => (
                <span key={`${message.createdAt}-${name}`} className="ref-chip" title={`引用技能 /${name}`}>
                  <Package size={13} />
                  <span>{name}</span>
                </span>
              ))}
              {/* @token 内联引用已随正文高亮展示，这里只渲染手动添加的附件 chip */}
              {message.attachments?.filter((attachment) => !attachment.isImage && !attachment.inlineRef && !isVoiceAttachment(attachment)).map((attachment) => (
                <span key={`${message.createdAt}-${attachment.path}`} className="ref-chip" title={attachment.path}>
                  {/\.[cm]?[jt]sx?$/i.test(attachment.name) ? <FileCode2 size={13} /> : <FileText size={13} />}
                  <span>{attachment.name}</span>
                </span>
              ))}
            </span>
          )}
          {isVoiceMessage(message) ? (
            <VoiceMessageBubble
              message={message}
              playingPath={playingVoicePath}
              loadingPath={voiceLoadingPath}
              onTogglePlay={actions.togglePlayVoice}
              tokenNames={inlineTokenNames}
              skillNames={messageSkillNames}
              onFileToken={openMessageFile}
            />
          ) : (
            <ClampedUserText
              text={messageVisibleText(message)}
              tokenNames={inlineTokenNames}
              skillNames={messageSkillNames}
              onFileToken={openMessageFile}
              sessionTitles={messageSessionTitles}
              onSessionToken={openMessageSession}
              pluginReferences={message.pluginReferences}
              onPluginReference={ref => actions.openPluginReference(sessionId, ref)}
            />
          )}
          {Boolean(message.pasteBlocks?.length) && <MessagePasteBlocks blocks={message.pasteBlocks!} />}
          {Boolean(message.annotations?.length) && <MessageAnnotationChip annotations={message.annotations!} />}
          </div>
          )}
          <div className="message-actions user" aria-label="用户消息操作">
            <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
            <button type="button" onClick={() => void actions.copyMessage(message)} aria-label="复制消息" title="复制消息">
              <Copy size={16} />
            </button>
            {!activeTaskRunning && (
              <button type="button" onClick={() => actions.startMessageEdit(message, index)} aria-label="编辑消息" title="编辑消息">
                <Pencil size={16} />
              </button>
            )}
          </div>
        </div>
      </>
    ) : (
      <div className="assistant-message" onContextMenu={(event) => actions.handleMessageContextMenu(event, message)}>
          <ProcessTimeline
          message={message}
          messageIndex={index}
          isStreaming={activeTaskRunning && !message.taskStatus && isStreamingMessage}
          collapsedActivities={collapsedActivities}
          onToggleCollapse={actions.toggleActivityCollapse}
        />
        {message.content && !liveOutputInProcess && (
          <InteractiveMessage
            content={stripControlMarkersCached(message.content)}
            streaming={isStreamingMessage}
          />
        )}
        {assistantImages.length > 0 && <div className="message-attachments" aria-label="助手返回的图片">
          {assistantImages.map((attachment, imageIndex) => <ImageAttachmentView key={imageIndex}
            attachment={attachment} onPreview={payload => actions.openImagePreview(payload, assistantImages)} />)}
        </div>}
        {/* 改动文件卡片固定放在最后（对标 Codex：过程折叠条 → 结论 → 修改的文件） */}
        {Boolean(message.changes?.length) && (
          <ChangesSummary
            changes={message.changes!}
            workspacePath={workspacePath}
            onOpenReview={actions.openReview}
          />
        )}
        {!hideAssistantActions && (
          <div className="message-actions assistant" aria-label="助手消息操作">
            {Boolean(messageVisibleText(message).trim()) && (
              <button
                type="button"
                onClick={() => void actions.toggleSpeakMessage(message)}
                aria-label={speakingMessageKey === speakMessageKey(message) || speakingLoadingKey === speakMessageKey(message) ? "停止朗读" : "朗读回复"}
                title={speakingMessageKey === speakMessageKey(message) || speakingLoadingKey === speakMessageKey(message) ? "停止朗读" : "朗读回复"}
              >
                {speakingLoadingKey === speakMessageKey(message)
                  ? <LoaderCircle className="spin" size={16} />
                  : speakingMessageKey === speakMessageKey(message)
                    ? <Square size={16} />
                    : <Volume2 size={16} />}
              </button>
            )}
            <button type="button" onClick={() => void actions.copyMessage(message)} aria-label="复制消息" title="复制消息">
              <Copy size={16} />
            </button>
            <button type="button" onClick={() => actions.forkSessionAt(sessionId, index)} aria-label="从此处分叉新会话" title="从此处分叉：把会话开头到这里的对话复制为新会话">
              <ForkBranchIcon size={16} />
            </button>
            <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
            <span className="ai-disclaimer">由AI生成，请注意甄别</span>
          </div>
        )}
      </div>
    )}
  </div>
  );
});

export function App() {
  // 布局 / 外壳 / 设置类状态已迁到 zustand store（字段名与 setter 与原先的 useState 一致）。
  const {
    sidebarOpen, setSidebarOpen, sidebarWidth, setSidebarWidth, toolPanelWidth, setToolPanelWidth,
    viewportWidth, setViewportWidth, rightPanelOpen, setRightPanelOpen,
    toolPanelTabs, setToolPanelTabs, toolPanelTabOverflow, setToolPanelTabOverflow,
    activeToolPanelTabId, setActiveToolPanelTabId, toolPanelMenuOpen, setToolPanelMenuOpen,
    toolPanelAddMenuOpen, setToolPanelAddMenuOpen, settingsOpen, setSettingsOpen,
    addMenuOpen, setAddMenuOpen, modelMenuOpen, setModelMenuOpen, approvalMenuOpen, setApprovalMenuOpen,
    railMenuOpen, setRailMenuOpen, topMenuOpen, setTopMenuOpen, conversationToolsOpen, setConversationToolsOpen,
    sessionMenuId, setSessionMenuId, workspaceMenuPath, setWorkspaceMenuPath, renamingId, setRenamingId,
    pluginsPageOpen, setPluginsPageOpen, botTeamPageOpen, setBotTeamPageOpen,
    botTeamAvailable, setBotTeamAvailable, botTeamProvider, setBotTeamProvider,
    conversationView, setConversationView, pluginConversationViews, setPluginConversationViews,
    showArchived, setShowArchived, workspaceOpen, setWorkspaceOpen,
    workspaceGroupOpen, setWorkspaceGroupOpen, workspaceSessionsExpanded, setWorkspaceSessionsExpanded,
    terminalOpen, setTerminalOpen, terminalMounted, setTerminalMounted, terminalAvailable, setTerminalAvailable,
    debugOpen, setDebugOpen, appUpdateDialogOpen, setAppUpdateDialogOpen,
  } = useLayoutStore();
  const { settings, setSettings, settingsTab, setSettingsTab, appUpdate, setAppUpdate, approvalMode, setApprovalMode, platform, setPlatform, windowMaximized, setWindowMaximized } = useSettingsStore();
  const {
    browserOpening, setBrowserOpening, browserMoreOpen, setBrowserMoreOpen, browserSection, setBrowserSection,
    browserSuggestionsOpen, setBrowserSuggestionsOpen, browserSuggestionIndex, setBrowserSuggestionIndex,
    browserClearing, setBrowserClearing, importDialogOpen, setImportDialogOpen,
    browserUrlDraft, setBrowserUrlDraft, browserFind, setBrowserFind,
    browserSessionHistory, setBrowserSessionHistory, browserDownloads, setBrowserDownloads,
    browserPasswordPrompt, setBrowserPasswordPrompt, browserControlState, setBrowserControlState,
    browserPasswordsOpen, setBrowserPasswordsOpen, browserClearKinds, setBrowserClearKinds,
  } = useBrowserStore();
  const [sessions, setSessions] = useState<SessionRecord[]>(previewSessions);
  // 未发送的新任务只保留在页面内，不进入会话列表和保存流程。
  const [newTaskDraft, setNewTaskDraft] = useState<SessionRecord | null>(null);
  const [activeId, setActiveId] = useState(previewSessions[0].id);
  const activeSession = newTaskDraft?.id === activeId ? newTaskDraft : sessions.find((session) => session.id === activeId) || sessions[0];
  const [workspacePath, setWorkspacePath] = useState(previewSessions[0].workspacePath);
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContext | null>(null);
  // 工作区 Git 状态：分支下拉与提交推送面板
  const [gitInfo, setGitInfo] = useState<GitBranchesInfo | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [commitPanelOpen, setCommitPanelOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [diffStats, setDiffStats] = useState<GitDiffStats | null>(null);
  const [gitBusy, setGitBusy] = useState<"" | "switch" | "commit" | "commit-push" | "push" | "generate">("");
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>(previewWorkspace);
  const [pinnedWorkspacePaths, setPinnedWorkspacePaths] = useState<string[]>([]);

  // 引导是否失败：getInitialState 拿不到数据时（主进程 handler 抛错、IPC 异常等），
  // 本地状态是空的/默认的，此时任何写回都会把磁盘上的真实数据覆盖掉。
  // 真实事故：app:initial-state 因缺依赖抛错 → ready 仍被置真 → 会话/配置/置顶被整批覆盖。
  const bootstrapFailedRef = useRef(false);
  const [query, setQuery] = useState("");
  const [composer, setComposer] = useState("");
  // 长粘贴折叠块：当前会话输入框中折叠的大段粘贴文本
  const [composerPastes, setComposerPastes] = useState<ComposerPasteBlock[]>([]);
  const [expandedPasteId, setExpandedPasteId] = useState("");
  // 引用注释：会话内容里选中文字添加的注释，随消息一起发送
  const [annotations, setAnnotations] = useState<MessageAnnotation[]>([]);
  // 选区浮动条：选中会话内容后弹出的「添加到对话 / 侧边聊天」条
  const [selectionQuote, setSelectionQuote] = useState<{ text: string; x: number; y: number } | null>(null);
  // 评论编辑卡：固定定位锚点 + 目标注释 id，编辑内容用卡片局部 state
  const [annotationEditor, setAnnotationEditor] = useState<{ id: string; x: number; y: number } | null>(null);
  // composer 注释 chip 的 hover 弹层开关
  const [annotationListOpen, setAnnotationListOpen] = useState(false);
  // hover 弹层延迟关闭：mouseleave 后留短暂宽限，斜向移入弹层经过空隙时不闪关
  const annotationListCloseTimerRef = useRef(0);
  const openAnnotationList = () => {
    window.clearTimeout(annotationListCloseTimerRef.current);
    setAnnotationListOpen(true);
  };
  const scheduleCloseAnnotationList = () => {
    window.clearTimeout(annotationListCloseTimerRef.current);
    annotationListCloseTimerRef.current = window.setTimeout(() => setAnnotationListOpen(false), 200);
  };
  // 语音转写结果的分发目标：默认写进 composer，评论卡录音时指向评论 setter
  const voiceTargetRef = useRef<"composer" | ((text: string) => void)>("composer");
  // 侧边聊天预填：nonce 变化时把 text 填入侧边聊天草稿
  const [sideChatSeed, setSideChatSeed] = useState<{ text: string; nonce: number } | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  // 主动挂起（有待唤醒）的会话：主进程 wakes.json 是权威状态，这里只做镜像。
  // 不能用气泡上的 taskStatus=sleeping 代替——取消唤醒后它不会自己变，重启也读不出来。
  const [sleepingSessions, setSleepingSessions] = useState<Record<string, PendingWakeRecord>>({});
  // 正在续跑（已唤醒）的会话：气泡那句将来时的挂起说明要改写成"正在继续处理"，
  // 运行状态行也要说清是自动唤醒还是用户点的「立即继续」
  const [wakingSessions, setWakingSessions] = useState<Record<string, WakingSessionEntry>>({});
  // 事件回调里要读"当前正在续跑的会话"做气泡收口，同时保持 setState updater 纯净
  const wakingSessionsRef = useRef<Record<string, WakingSessionEntry>>({});
  const refreshPendingWakes = async () => {
    const list = await window.dyworker?.listPendingWakes?.();
    if (!Array.isArray(list)) return;
    const next: Record<string, PendingWakeRecord> = {};
    for (const item of list) {
      if (item?.sessionId) next[item.sessionId] = { ...item, sessionId: item.sessionId };
    }
    setSleepingSessions(next);
    // 这一觉已经走完（到点跑过 / 被取消 / 窗口关着时已触发）的会话：气泡里那句
    // "将于 X 自动唤醒继续"要收口成"原定 X 自动唤醒"，否则重启后它还在声称将来会唤醒。
    // 仍在待唤醒列表、或正在续跑中的会话不动。
    setSessions((current) => {
      let changedAny = false;
      const settled = current.map((session) => {
        if (next[session.id] || wakingSessionsRef.current[session.id]) return session;
        let changed = false;
        const messages = session.messages.map((message) => {
          if (message.role !== "assistant" || message.taskStatus !== "sleeping" || !message.content) return message;
          const content = String(message.content);
          const settledContent = settleResolvedSleepNote(content);
          if (settledContent === content) return message;
          changed = true;
          return { ...message, content: settledContent };
        });
        if (!changed) return session;
        changedAny = true;
        return { ...session, messages };
      });
      return changedAny ? settled : current;
    });
  };
  const [runningStartedAt, setRunningStartedAt] = useState<Record<string, number>>({});
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  // 模型菜单里「此密钥可用的模型」段：菜单打开时按 endpoint+key 拉一次 /models 并缓存，
  // 换服务地址或密钥后重新拉；拉取失败静默降级（菜单仍列出已保存的配置）
  const [composerModels, setComposerModels] = useState<Array<{ id: string; contextLimit?: number }> | null>(null);
  const [composerModelsLoading, setComposerModelsLoading] = useState(false);
  const composerModelsKeyRef = useRef("");
  // 会话区视图标签：对话 / 轨迹 / 插件贡献的视图（DSH 的 conversation.view 插槽）
  // 切换到任意会话（含新建任务）时回到聊天：插件页是主内容区的临时视图，不是常驻模式
  useEffect(() => {
    if (!activeId) return;
    setPluginsPageOpen(false);
    setBotTeamPageOpen(false);
  }, [activeId]);
  // 视口宽度跟随窗口变化：面板宽度只在拖动时按当时窗口夹取，窗口之后缩小
  // （如从高分屏搬到低分屏/笔记本屏）时必须重新夹取，否则固定像素宽度会吞掉整个主区域
  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      if (window.innerWidth <= 820) setSidebarOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // 夹取的是“生效宽度”而不是存储值：回到大窗口时用户拖出的宽度偏好自动恢复
  const appliedToolPanelWidth = Math.min(
    toolPanelWidth,
    Math.max(360, viewportWidth - 58 - (sidebarOpen ? sidebarWidth : 0) - 420),
  );
  const appliedSidebarWidth = Math.min(
    sidebarWidth,
    Math.max(220, viewportWidth - 58 - (rightPanelOpen ? appliedToolPanelWidth : 0) - 420),
  );
  // 初始没有任何标签页：浏览器只是菜单中的一个选项，用户选择之前什么都不打开（对照 Codex）
  // 标签条横向溢出状态：两侧滚动按钮与渐隐遮罩只在真正放不下时出现
  const toolPanelTabStripRef = useRef<HTMLDivElement | null>(null);
  const [pluginPanelPreferences] = useState(() => new PluginPanelPreferences(localStorage));
  const [pluginPanelChoices, setPluginPanelChoices] = useState<PluginPanelTab[]>([]);
  // 「总结为工作模板」：正在提炼的会话 id（防重复点击）与待确认的草稿（非空即打开对话框）
  const [skillSummarySessionId, setSkillSummarySessionId] = useState<string | null>(null);
  const [skillDraft, setSkillDraft] = useState<{ name: string; description: string; instructions: string } | null>(null);
  const [creationKind, setCreationKind] = useState<AuthoringKind | null>(null);
  // 设置面板里的手动编辑：正在编辑的记忆行 / 工作模板（非空即打开编辑对话框）
  const [memoryEdit, setMemoryEdit] = useState<WikiMemoryRow | null>(null);
  const [skillEdit, setSkillEdit] = useState<SkillRecord | null>(null);
  // 已导入的浏览记录：地址栏输入联想
  const [importedHistory, setImportedHistory] = useState<ImportedHistoryEntry[]>([]);
  const [ready, setReady] = useState(false);
  // 平台标识初始值同步取自 preload（process.platform），首帧就能渲染正确布局，
  // 不会先按未知平台画出自绘标题栏再闪改（mac 红绿灯会盖到 DYWorker 文字上）
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // 会话内朗读（助手回复转语音播放）：与渠道语音发送共用同一套 TTS 设置
  const [speakingMessageKey, setSpeakingMessageKey] = useState<string | null>(null);
  const [speakingLoadingKey, setSpeakingLoadingKey] = useState<string | null>(null);
  const [sessionErrors, setSessionErrors] = useState<Record<string, string>>({});
  const [sessionNotices, setSessionNotices] = useState<Record<string, string>>({});
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, ApprovalAction>>({});
  const [pendingQuestions, setPendingQuestions] = useState<Record<string, QuestionRequest>>({});
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);
  // 收件箱分类页签（任务待办 / 系统消息）与系统消息未读、通知点击定位
  const [inboxTab, setInboxTab] = useState<"inbox" | "messages">("inbox");
  const [systemMessageFocusId, setSystemMessageFocusId] = useState("");
  const [systemMessagesUnread, setSystemMessagesUnread] = useState(0);
  const [fullAccessDialogOpen, setFullAccessDialogOpen] = useState(false);
  const [loopStates, setLoopStates] = useState<Record<string, { iteration: number; maximum: number; status: string }>>({});
  const [memories, setMemories] = useState<WikiMemoryPage[]>([]);
  const [memoriesLinting, setMemoriesLinting] = useState(false);
  const [memoriesLintMessage, setMemoriesLintMessage] = useState("");
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [mentionMenu, setMentionMenu] = useState<{ kind: "slash" | "at"; query: string; start: number; end?: number; programmatic?: boolean } | null>(null);
  const dismissedPluginMention = useRef<{ sessionId: string; text: string; start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionSkills, setMentionSkills] = useState<SkillRecord[]>([]);
  const [pluginInputCandidates, setPluginInputCandidates] = useState<RegisteredInputCandidate[]>([]);
  const [pluginInputRevision, setPluginInputRevision] = useState(0);
  const [dshChildHistory, setDshChildHistory] = useState<{ id: string; rootSessionId: string; displayTitle: string } | null>(null);
  const closeDshChildHistory = useCallback(() => setDshChildHistory(null), []);
  const [activeSkills, setActiveSkills] = useState<SkillRecord[]>([]);
  const [collapsedActivities, setCollapsedActivities] = useState<Set<string>>(new Set());
  // 传给 memo 化的 ProcessTimeline 的回调必须引用稳定，否则整树重渲染时
  // 每条消息都会因新函数引用而击穿 memo
  const toggleActivityCollapse = useCallback((messageKey: string, nextCollapsed: boolean) => {
    setCollapsedActivities((current) => {
      const next = new Set(current);
      if (nextCollapsed) {
        next.delete(`${messageKey}:expanded`);
        next.add(messageKey);
      } else {
        next.delete(messageKey);
        next.add(`${messageKey}:expanded`);
      }
      return next;
    });
  }, []);
  const [hoveredTurnIndex, setHoveredTurnIndex] = useState<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const debugOpenRef = useRef(debugOpen);
  debugOpenRef.current = debugOpen;
  useEffect(() => {
    const host = clientHost();
    const sync = () => {
      const available = host.contributionsFor("workspace.terminal").some(item => item.pluginId === "dyworker-terminal");
      setTerminalAvailable(available);
      if (!available) setTerminalOpen(false);
    };
    sync();
    return host.subscribe(sync);
  }, []);
  const toggleTerminal = () => {
    if (!terminalAvailable) { setNotice("请先启用内置终端插件。"); return; }
    setTerminalMounted(true);
    setTerminalOpen(value => !value);
  };
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  // debug-log 事件频率与模型流式对齐，逐条 setState 会让整个 App 高频重渲染；
  // 先进 ref 缓冲，1 秒合并刷入一次（TraceConsole 是诊断视图，秒级延迟无感知）
  const pendingDebugLogsRef = useRef<DebugLogEntry[]>([]);
  const recentDebugLogsRef = useRef<DebugLogEntry[]>([]);
  const debugLogFlushTimerRef = useRef<number | null>(null);
  const queueDebugLog = useCallback((entry: DebugLogEntry) => {
    pendingDebugLogsRef.current = trimRecentText([...pendingDebugLogsRef.current, entry]);
    if (debugLogFlushTimerRef.current !== null) return;
    debugLogFlushTimerRef.current = window.setTimeout(() => {
      debugLogFlushTimerRef.current = null;
      const pending = pendingDebugLogsRef.current.splice(0);
      if (pending.length) {
        recentDebugLogsRef.current = trimRecentText([...recentDebugLogsRef.current, ...pending]);
        if (debugOpenRef.current) setDebugLogs(recentDebugLogsRef.current);
      }
    }, 1000);
  }, []);
  useEffect(() => () => {
    if (debugLogFlushTimerRef.current !== null) window.clearTimeout(debugLogFlushTimerRef.current);
  }, []);
  // 面板关闭时仅保存最近记录，不触发主界面更新；历史在控制台打开后按需读取。
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const traceBuffer = useMemo(() => createTraceBuffer(), []);
  const tracePublishTimerRef = useRef<number | null>(null);
  const appendSessionTraces = useCallback((records: TraceEvent[]) => {
    if (!traceBuffer.append(records) || !debugOpenRef.current || tracePublishTimerRef.current !== null) return;
    tracePublishTimerRef.current = window.setTimeout(() => {
      tracePublishTimerRef.current = null;
      if (debugOpenRef.current) setTraceEvents(traceBuffer.snapshot());
    }, 100);
  }, [traceBuffer]);
  useEffect(() => {
    if (debugOpen) {
      setTraceEvents(traceBuffer.snapshot());
      setDebugLogs(trimRecentText([...recentDebugLogsRef.current, ...pendingDebugLogsRef.current]));
    } else { setTraceEvents([]); setDebugLogs([]); }
    return () => {
      if (tracePublishTimerRef.current !== null) window.clearTimeout(tracePublishTimerRef.current);
      tracePublishTimerRef.current = null;
    };
  }, [debugOpen, traceBuffer]);
  const [usageStats, setUsageStats] = useState<UsageRecord[] | null>(null);
  const [planSeed, setPlanSeed] = useState<{ name: string; prompt: string } | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ sessionId: string; messageIndex: number; original: ChatMessage } | null>(null);
  const [imagePreview, setImagePreview] = useState<{ url: string; name: string; path?: string } | null>(null);
  // 同一条消息的全部图片附件：预览灯箱用它在多张图之间左右切换
  const [imagePreviewPeers, setImagePreviewPeers] = useState<Array<Pick<Attachment, "path" | "previewUrl" | "name">>>([]);
  const openImagePreview = (payload: { url: string; name: string; path?: string }, peers?: Array<Pick<Attachment, "path" | "previewUrl" | "name">>) => {
    setImagePreviewPeers(peers ?? []);
    setImagePreview(payload);
  };
  const closeImagePreview = () => {
    setImagePreview(null);
    setImagePreviewPeers([]);
  };
  const imagePreviewIndex = imagePreview
    ? imagePreviewPeers.findIndex((peer) => (peer.path || peer.previewUrl || "") === (imagePreview.path || imagePreview.url))
    : -1;
  // 左右切换（循环）：目标图可能还没读过原图，先经附件通道取 dataURL
  const navigateImagePreview = (direction: -1 | 1) => {
    const current = imagePreview;
    if (!current || imagePreviewPeers.length < 2) return;
    const currentKey = current.path || current.url;
    const index = imagePreviewPeers.findIndex((peer) => (peer.path || peer.previewUrl || "") === currentKey);
    const next = imagePreviewPeers[(Math.max(index, 0) + direction + imagePreviewPeers.length) % imagePreviewPeers.length];
    if (!next) return;
    void attachmentImageSource(next).then((result) => {
      if (result.ok && result.dataUrl) setImagePreview({ url: result.dataUrl, name: next.name || "图片", path: next.path });
    });
  };
  // 会话内搜索：在当前会话的消息 DOM 里高亮命中并按出现位置跳转（⌘F / Ctrl+F 打开）
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [conversationSearchQuery, setConversationSearchQuery] = useState("");
  const [conversationSearchMatchIndex, setConversationSearchMatchIndex] = useState(0);
  const [conversationMatchTotal, setConversationMatchTotal] = useState(0);
  // 排队中的任务运行标识：同会话内串行执行，排队消息未执行前允许编辑或取消
  const [queuedRunIds, setQueuedRunIds] = useState<Set<string>>(new Set());
  // 队列卡片里 ⋯ 菜单当前挂在哪条排队消息上
  const [queueMenuRunId, setQueueMenuRunId] = useState<string | null>(null);
  // 右键菜单：消息文本选中复制、输入框复制/剪切/粘贴
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const queuedRunsRef = useRef<Map<string, Set<string>>>(new Map());
  const agentUnsubscribeRefs = useRef<Map<string, () => void>>(new Map());
  const runningRunIdsRef = useRef<Map<string, string>>(new Map());
  // 已保存会话的引用镜像（id → 上次发给主进程的对象）：会话更新全部走
  // 不可变替换，比较引用即可零成本找出「变化的会话」，保存只发增量
  const sessionSaveQueue = useMemo(() => createSessionSaveQueue(
    async payload => {
      const result = await window.dyworker!.saveSessions(payload);
      if (result?.ok && clientHost().dshSettings.sessionId()) void clientHost().dshSettings.refresh();
      return result;
    },
    session => session.goalState?.status === "active" ? { ...session, goalState: { ...session.goalState, elapsedMs: goalElapsed(session), activeSince: Date.now() } } : session,
  ), []);
  const sessionSaveRetryRef = useRef<number | null>(null);
  const sessionSaveMountedRef = useRef(true);
  useEffect(() => {
    sessionSaveMountedRef.current = true;
    return () => {
      sessionSaveMountedRef.current = false;
      if (sessionSaveRetryRef.current !== null) window.clearTimeout(sessionSaveRetryRef.current);
    };
  }, []);
  const sessionNoticeTimersRef = useRef<Map<string, number>>(new Map());
  const sessionErrorTimersRef = useRef<Map<string, number>>(new Map());
  const viewportRef = useRef<HTMLDivElement>(null);
  // 对话区在机器人团队页/设置页之间会被整棵卸载重挂（App 主区域的条件分支），
  // 用 state 承载节点，让依赖它们的 effect 在重挂后重新绑定
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null);
  const [composerDockNode, setComposerDockNode] = useState<HTMLDivElement | null>(null);
  // 必须是稳定引用：内联箭头每次渲染都会先 ref(null) 再 ref(node)，
  // 会让依赖 viewportNode 的贴底跟随 effect 每次渲染都重建并强制滚到底部
  const bindViewport = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    setViewportNode(node);
  }, []);
  const activeIdRef = useRef(activeId);
  const conversationTurnRefs = useRef<Record<number, HTMLDivElement | null>>({});
  // 会话内搜索：所有已渲染消息行的引用（含助手消息），DOM 高亮与跳转都用它
  const messageRowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const conversationSearchInputRef = useRef<HTMLInputElement>(null);
  // 当前搜索命中的 DOM 区间列表（与 matchIndex 对齐），由高亮 effect 维护
  const searchMatchRangesRef = useRef<Array<{ row: HTMLDivElement; range: Range }>>([]);
  // 上一次自动滚动定位的命中标识（query#index），避免流式更新时反复滚动
  const searchScrollKeyRef = useRef<string | null>(null);
  const textareaRef = useRef<ComposerHandle | null>(null);
  // @引用高亮镜像层：与 textarea 同步滚动，保持 token 背景对齐
  const composerMirrorRef = useRef<HTMLDivElement>(null);
  // @token → 实际选择的文件路径：同名文件时以用户候选菜单里点选的那个为准
  const mentionTokenPathsRef = useRef<Map<string, string>>(new Map());
  // @「标题」token → 实际选择的会话 id：同名会话时以用户点选的那个为准（与文件同构）
  const sessionTokenIdsRef = useRef<Map<string, string>>(new Map());
  // 每个浏览器标签页一个常驻 webview：切换标签不销毁页面（对照 Codex 浏览器）
  const browserWebviewsRef = useRef<Map<string, BrowserWebviewElement>>(new Map());
  const appShellRef = useRef<HTMLDivElement>(null);
  const panelGeometryRef = useRef({ rightPanelOpen, sidebarOpen, appliedSidebarWidth, appliedToolPanelWidth });
  panelGeometryRef.current = { rightPanelOpen, sidebarOpen, appliedSidebarWidth, appliedToolPanelWidth };
  const panelResizeRef = useRef<{ edge: "left" | "right"; startX: number; startWidth: number } | null>(null);
  const toolPanelTabSequenceRef = useRef(1);
  const composingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const shouldScrollToBottomRef = useRef<string | null>(null);
  const sessionRenameRequestsRef = useRef(new Map<string, {title:string;token:symbol}>());

  // 会话更新与通知工具：定义在状态之后、各 effect 之前，供渠道实时事件监听器与 runTask 共用
  const updateSession = (id: string, updater: (session: SessionRecord) => SessionRecord) => {
    setNewTaskDraft((current) => current?.id === id ? updater(current) : current);
    setSessions((current) => current.map((session) => session.id === id ? updater(session) : session));
  };

  // 续跑开始/结束时改写那条挂起气泡的说明（只动我们自己生成的那句，不碰模型正文）。
  // 目标靠"将于/原定 {wakeAt} 自动唤醒"这个精确时间 + 注入的 marker 定位：同一会话可能
  // 挂起过多轮，不能简单按"最后一条 sleeping"取，否则会把新一轮的挂起说明也改掉。
  const patchWakingSleepNote = (sessionId: string, wakeAt: string, marker: string, phase: "waking" | "woke", done = "") => {
    const wakeAtText = formatWakeTime(wakeAt);
    updateSession(sessionId, (session) => {
      let changed = false;
      const messages = session.messages.map((message) => {
        if (message.role !== "assistant" || !message.content) return message;
        const content = String(message.content);
        if (phase === "waking") {
          const next = rephraseSleepNote(content, wakeAtText, marker);
          if (next === content) return message;
          changed = true;
          return { ...message, content: next };
        }
        const next = closeWakingNote(content, marker, done);
        if (next === content) return message;
        changed = true;
        return { ...message, content: next };
      });
      return changed ? { ...session, messages } : session;
    });
  };

  const clearSessionNotice = (sessionId: string) => {
    const previous = sessionNoticeTimersRef.current.get(sessionId);
    if (previous) {
      window.clearTimeout(previous);
      sessionNoticeTimersRef.current.delete(sessionId);
    }
    setSessionNotices((current) => {
      if (!current[sessionId]) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  };

  const clearSessionError = (sessionId: string) => {
    const previous = sessionErrorTimersRef.current.get(sessionId);
    if (previous) {
      window.clearTimeout(previous);
      sessionErrorTimersRef.current.delete(sessionId);
    }
    setSessionErrors((current) => {
      if (!current[sessionId]) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  };

  const showSessionNotice = (sessionId: string, message: string) => {
    setSessionNotices((current) => ({ ...current, [sessionId]: message }));
    const previous = sessionNoticeTimersRef.current.get(sessionId);
    if (previous) window.clearTimeout(previous);
    const timeout = window.setTimeout(() => {
      setSessionNotices((current) => {
        if (current[sessionId] !== message) return current;
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      sessionNoticeTimersRef.current.delete(sessionId);
    }, 3200);
    sessionNoticeTimersRef.current.set(sessionId, timeout);
  };

  const showSessionError = (sessionId: string, message: string, duration = 5000) => {
    setSessionErrors((current) => ({ ...current, [sessionId]: message }));
    const previous = sessionErrorTimersRef.current.get(sessionId);
    if (previous) window.clearTimeout(previous);
    const timeout = window.setTimeout(() => {
      setSessionErrors((current) => {
        if (current[sessionId] !== message) return current;
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      sessionErrorTimersRef.current.delete(sessionId);
    }, duration);
    sessionErrorTimersRef.current.set(sessionId, timeout);
  };

  // 输入区高度随内容（编辑条、附件、提示条）变化，把实际高度写入 CSS 变量，
  // 对话列表底部 padding 据此预留空间，避免最后一条消息被输入框遮挡。
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // 会话草稿：切换会话时保留各自输入框内容、折叠的长文本块与引用注释（对照 Codex 的 per-session 草稿）。
  // composer/composerPastes/annotations 的最新值经 ref 读取，避免 activeId 变化的同一次提交里闭包取到旧值。
  const composerRef = useRef(composer);
  const composerPastesRef = useRef(composerPastes);
  const annotationsRef = useRef(annotations);
  const attachmentsRef = useRef(attachments);
  const sessionDraftsRef = useRef<Record<string, { text: string; pastes: ComposerPasteBlock[]; annotations: MessageAnnotation[]; attachments: Attachment[] }>>({});
  const lastActiveIdRef = useRef(activeId);
  const [composerSessionId, setComposerSessionId] = useState(activeId);
  useEffect(() => { composerRef.current = composer; }, [composer]);
  useEffect(() => { composerPastesRef.current = composerPastes; }, [composerPastes]);
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);
  useEffect(() => { attachmentsRef.current = attachments; clientHost().cancelInput(lastActiveIdRef.current); }, [attachments]);
  useEffect(() => {
    sessionDraftsRef.current[lastActiveIdRef.current] = {
      text: composerRef.current,
      pastes: composerPastesRef.current,
      annotations: annotationsRef.current,
      attachments: attachmentsRef.current,
    };
  }, [composer, composerPastes, annotations, attachments]);
  useEffect(() => {
    if (lastActiveIdRef.current === activeId) return;
    sessionDraftsRef.current[lastActiveIdRef.current] = {
      text: composerRef.current,
      pastes: composerPastesRef.current,
      annotations: annotationsRef.current,
      attachments: attachmentsRef.current,
    };
    lastActiveIdRef.current = activeId;
    setComposerSessionId(activeId);
    const draft = sessionDraftsRef.current[activeId];
    setComposer(draft?.text || "");
    setComposerPastes(draft?.pastes || []);
    setAnnotations(draft?.annotations || []);
    setAttachments(draft?.attachments || []);
    setExpandedPasteId("");
  }, [activeId]);

  // 会话列表快照 ref：渠道实时事件监听器（注册一次、长期存活）需要读取最新会话，
  // 用 ref 避免闭包捕获到旧的 sessions 状态
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // 渠道流式气泡登记（跨两个长期存活的监听器共享）：
  // sessionId → 占位消息 id（实时事件归约用）；runId → 占位位置（收尾 append 原位替换用）。
  // 定时计划运行（scheduleRun 打标）复用同一套登记：它的占位气泡同样按会话清理。
  const channelStreamIdsRef = useRef<Map<string, string>>(new Map());
  const channelStreamRunsRef: { current: ChannelStreamRuns } = useRef(new Map<string, ChannelStreamRef>());
  // 正在进行定时计划运行的会话（主进程 runScheduledTask 在跑）：这些会话的输入框要禁用，
  // 否则用户中途发消息会和后台那轮计划任务同时写同一个会话，收尾 prepend 会把新消息覆盖掉
  const [scheduledRunSessions, setScheduledRunSessions] = useState<Set<string>>(() => new Set());
  // 刚点了「立即执行」的计划 id：等主进程回 schedules:run-started 时把这次运行的会话直接打开
  const manualRunScheduleRef = useRef<string>("");
  // 「立即执行」后要自动打开的会话：等它进了会话列表再由 selectSession 走完整切换流程
  // （切工作区、关旧审阅标签、刷新工作区文件），否则会话可能落在别的分组的折叠里
  const [pendingAutoOpenSessionId, setPendingAutoOpenSessionId] = useState("");

  // 工作台布局持久化：面板 Tab、分栏比例按会话保存到 localStorage，切换会话恢复、重启不丢。
  // 恢复先于保存执行，避免启动时用空状态覆盖已保存布局；没有自定义过布局（无 Tab）的会话不落盘。
  const PANEL_LAYOUT_PREFIX = "dyworker:panel-layout:v1:";
  const PANEL_LAYOUT_MAX = 30;
  useEffect(() => {
    if (!ready || !activeId) return;
    let saved: { tabs?: ToolPanelTab[]; activeTabId?: string; width?: number; open?: boolean } | null = null;
    try {
      const raw = localStorage.getItem(`${PANEL_LAYOUT_PREFIX}${activeId}`);
      if (raw) saved = JSON.parse(raw);
    } catch {
      saved = null;
    }
    // 插件登记的标签不算「用户自己配的面板布局」：过滤掉再判断，避免内置插件
    // 让每个会话都被记成"以前开过面板"，切会话时把面板连插件内容一起弹出来
    const savedTabs = (saved && Array.isArray(saved.tabs) ? saved.tabs : []).filter((tab) => tab.kind !== "plugin");
    if (!saved || !savedTabs.length) {
      // 目标会话没有自己的面板布局：清空当前 tabs，避免上一会话的浏览器
      // 标签页和 webview 原样穿透到本会话界面（后台任务还会继续操作它）
      toolPanelTabsRef.current = [];
      setToolPanelTabs([]);
      setActiveToolPanelTabId("");
      return;
    }
    // 恢复的 tab id 是各会话独立编号的（如都叫 browser-1），直接使用会与当前
    // 已挂载的 webview 撞 React key 导致跨会话复用同一个有状态页面；统一重映射
    // 为本次运行的全局唯一 id，并同步 activeTabId
    const idMap = new Map<string, string>();
    const remappedTabs = savedTabs.map((tab) => {
      const nextId = `${tab.kind}-${toolPanelTabSequenceRef.current++}`;
      idMap.set(tab.id, nextId);
      return { ...tab, id: nextId };
    });
    toolPanelTabsRef.current = remappedTabs;
    setToolPanelTabs(remappedTabs);
    const savedActiveWasValid = savedTabs.some((tab) => tab.id === saved.activeTabId);
    setActiveToolPanelTabId(savedActiveWasValid ? idMap.get(saved.activeTabId!)! : "");
    if (typeof saved.width === "number" && saved.width >= 300) setToolPanelWidth(saved.width);
    if (typeof saved.open === "boolean") setRightPanelOpen(saved.open);
  }, [ready, activeId]);

  useEffect(() => {
    if (!ready || !activeId) return;
    const key = `${PANEL_LAYOUT_PREFIX}${activeId}`;
    try {
      // 插件登记进来的标签不落盘：它们每次开机由插槽同步重建，
      // 一旦写进布局，就会把「这个会话以前开过面板」记成事实，下次切回来面板自己弹出来
      const persistableTabs = toolPanelTabs.filter((tab) => tab.kind !== "plugin");
      if (!persistableTabs.length) {
        // 没有用户自建的标签页（含只有插件标签的情况）：不落盘，并清理旧键
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, JSON.stringify({
        tabs: persistableTabs,
        activeTabId: persistableTabs.some((tab) => tab.id === activeToolPanelTabId) ? activeToolPanelTabId : "",
        width: toolPanelWidth,
        open: rightPanelOpen,
        savedAt: Date.now(),
      }));
      // 陈旧会话清理：只保留最近 30 个会话的布局
      const keys: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const itemKey = localStorage.key(index);
        if (itemKey?.startsWith(PANEL_LAYOUT_PREFIX)) keys.push(itemKey);
      }
      if (keys.length > PANEL_LAYOUT_MAX) {
        const stale = keys
          .map((itemKey) => {
            let savedAt = 0;
            try { savedAt = Number(JSON.parse(localStorage.getItem(itemKey) || "{}").savedAt || 0); } catch { /* 忽略坏键 */ }
            return { key: itemKey, savedAt };
          })
          .sort((a, b) => b.savedAt - a.savedAt)
          .slice(PANEL_LAYOUT_MAX);
        for (const entry of stale) localStorage.removeItem(entry.key);
      }
    } catch {
      // 布局持久化失败不影响使用
    }
  }, [ready, activeId, toolPanelTabs, activeToolPanelTabId, toolPanelWidth, rightPanelOpen]);

  useEffect(() => {
    if (!composerDockNode) return;
    const update = () => {
      document.documentElement.style.setProperty("--composer-height", `${Math.ceil(composerDockNode.getBoundingClientRect().height)}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(composerDockNode);
    return () => observer.disconnect();
  }, [composerDockNode]);

  // 图片预览浮层：Esc 关闭，多图时 ←/→ 切换
  useEffect(() => {
    if (!imagePreview) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeImagePreview();
      else if (event.key === "ArrowLeft") navigateImagePreview(-1);
      else if (event.key === "ArrowRight") navigateImagePreview(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [imagePreview, imagePreviewPeers]);

  // 会话内搜索：⌘F / Ctrl+F 打开（拦截浏览器默认查找），Esc 关闭
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setConversationSearchOpen(true);
        requestAnimationFrame(() => conversationSearchInputRef.current?.select());
      } else if (event.key === "Escape" && conversationSearchOpen) {
        setConversationSearchOpen(false);
        setConversationSearchQuery("");
        setConversationSearchMatchIndex(0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [conversationSearchOpen]);

  // 会话内搜索高亮：直接在已渲染的消息行 DOM 文本上建 Range，注册 CSS Custom Highlight，
  // 这样用户气泡与助手 Markdown 渲染结果都能命中，不必侵入各渲染组件。
  useEffect(() => {
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: AbstractRange[]) => unknown }).Highlight;
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const query = conversationSearchQuery.trim().toLowerCase();
    if (!conversationSearchOpen || !query || !HighlightCtor || !highlights) {
      highlights?.delete("conversation-search");
      highlights?.delete("conversation-search-current");
      searchMatchRangesRef.current = [];
      setConversationMatchTotal(0);
      return;
    }
    // 按消息下标顺序收集所有命中区间（跨 text node 的大小写不敏感匹配）
    const matches: Array<{ row: HTMLDivElement; range: Range }> = [];
    const walkerFilter = { acceptNode: () => NodeFilter.FILTER_ACCEPT };
    for (const index of Object.keys(messageRowRefs.current).map(Number).sort((a, b) => a - b)) {
      const row = messageRowRefs.current[index];
      if (!row || !row.isConnected) continue;
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, walkerFilter);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue || "";
        const lower = text.toLowerCase();
        let start = lower.indexOf(query);
        while (start !== -1) {
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + query.length);
          matches.push({ row, range });
          start = lower.indexOf(query, start + query.length);
        }
      }
    }
    searchMatchRangesRef.current = matches;
    highlights.set("conversation-search", new HighlightCtor(...matches.map((match) => match.range)) as never);
    setConversationMatchTotal((previous) => previous === matches.length ? previous : matches.length);

    // 当前命中：单独一层高亮并滚动定位（同一命中不重复滚动，避免流式更新时跳动）
    const effectiveIndex = Math.min(conversationSearchMatchIndex, Math.max(0, matches.length - 1));
    // 总数变少（改词/删消息）时把序号收敛回有效范围，保持显示与跳转一致
    if (matches.length && conversationSearchMatchIndex !== effectiveIndex) {
      setConversationSearchMatchIndex(effectiveIndex);
    }
    const current = matches[effectiveIndex];
    highlights.delete("conversation-search-current");
    if (current) {
      highlights.set("conversation-search-current", new HighlightCtor(current.range) as never);
      const scrollKey = `${query}#${effectiveIndex}`;
      if (searchScrollKeyRef.current !== scrollKey) {
        searchScrollKeyRef.current = scrollKey;
        current.row.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } else {
      searchScrollKeyRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationSearchOpen, conversationSearchQuery, conversationSearchMatchIndex, activeSession?.messages, activeId, collapsedActivities]);

  // 关闭搜索或切换会话时清掉残留高亮；换会话后命中序号失效，回到第一个
  useEffect(() => {
    setConversationSearchMatchIndex(0);
    searchScrollKeyRef.current = null;
    if (conversationSearchOpen) return;
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    highlights?.delete("conversation-search");
    highlights?.delete("conversation-search-current");
    searchMatchRangesRef.current = [];
  }, [conversationSearchOpen, activeId]);

  // 助手发来的浏览器面板指令转发到下面定义的标签页操作（打开 / 切换 / 关闭）：
  // 经 ref 转发，监听只挂一次也能拿到最新状态
  const browserPanelCommandsRef = useRef<{
    open: (url: string, tabId?: string) => void;
    activate: (tabId: string) => void;
    close: (tabId: string) => void;
  } | null>(null);

  // 模型浏览器工具与手动浏览共用右侧面板：助手每打开一个网页就开一个新标签页
  // （当前标签页还没打开过网页时先复用它），不再把用户看着的那个页面顶掉。
  useEffect(() => {
    const unsubscribe = window.dyworker?.onBrowserPanelRequest((request) => {
      // 归属校验：后台会话的面板请求（打开或关闭）只在它正是当前激活会话时
      // 处理，否则会把别的会话要开的网页打在、或把它要关的面板收在用户
      // 正在看的其他会话界面上（穿透）
      const requestOwner = String(request.ownerSessionId || "");
      if (requestOwner && requestOwner !== String(activeIdRef.current || "")) return;
      if (request.action === "close") {
        setRightPanelOpen(false);
        return;
      }
      if (request.action === "activate") {
        const tabId = String(request.tabId || "");
        if (tabId) browserPanelCommandsRef.current?.activate(tabId);
        return;
      }
      if (request.action === "close-tab") {
        const tabId = String(request.tabId || "");
        if (tabId) browserPanelCommandsRef.current?.close(tabId);
        return;
      }
      const url = String(request.url || "").trim();
      if (!url) return;
      browserPanelCommandsRef.current?.open(url, String(request.tabId || ""));
    });
    return unsubscribe;
  }, []);

  // 下拉菜单（会话项/顶栏/输入区“+”）：点击菜单容器之外或按 Esc 时关闭
  const anyMenuOpen = railMenuOpen || sessionMenuId !== null || workspaceMenuPath !== null || topMenuOpen || conversationToolsOpen || addMenuOpen || modelMenuOpen || approvalMenuOpen || toolPanelMenuOpen || toolPanelAddMenuOpen || browserMoreOpen || branchMenuOpen || commitPanelOpen || queueMenuRunId !== null;
  useEffect(() => {
    if (!anyMenuOpen) return;
    const closeAll = () => {
      setSessionMenuId(null);
      setWorkspaceMenuPath(null);
      setTopMenuOpen(false);
      setConversationToolsOpen(false);
      setRailMenuOpen(false);
      setAddMenuOpen(false);
      setModelMenuOpen(false);
      setApprovalMenuOpen(false);
      setToolPanelMenuOpen(false);
      setToolPanelAddMenuOpen(false);
      setBrowserMoreOpen(false);
      setBranchMenuOpen(false);
      setCommitPanelOpen(false);
      setQueueMenuRunId(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-menu-root]")) return;
      closeAll();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeAll();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [anyMenuOpen]);

  useEffect(() => {
    let frame = 0;
    let pendingX: number | null = null;
    let width: number | null = null;
    const apply = () => {
      frame = 0;
      const resize = panelResizeRef.current;
      const shell = appShellRef.current;
      if (!resize || !shell || pendingX === null) return;
      const geometry = panelGeometryRef.current;
      if (resize.edge === "left") {
        const max = Math.max(220, window.innerWidth - 58 - (geometry.rightPanelOpen ? geometry.appliedToolPanelWidth : 0) - 420);
        width = Math.min(Math.max(resize.startWidth + pendingX - resize.startX, 220), Math.min(520, max));
        shell.style.setProperty("--sidebar-width", `${width}px`);
      } else {
        const max = Math.max(360, window.innerWidth - 58 - (geometry.sidebarOpen ? geometry.appliedSidebarWidth : 0) - 420);
        width = Math.min(Math.max(resize.startWidth + resize.startX - pendingX, 320), max);
        shell.style.setProperty("--tool-panel-width", `${width}px`);
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!panelResizeRef.current) return;
      pendingX = event.clientX;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const finish = () => {
      if (!panelResizeRef.current) return;
      cancelAnimationFrame(frame);
      apply();
      if (width !== null) {
        if (panelResizeRef.current.edge === "left") setSidebarWidth(width);
        else setToolPanelWidth(width);
      }
      panelResizeRef.current = null;
      pendingX = width = null;
      document.body.classList.remove("resizing-panels");
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    return () => {
      cancelAnimationFrame(frame);
      document.body.classList.remove("resizing-panels");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!window.dyworker) {
        // 桌面壳里没有桥接 = preload 没加载成功：界面显示的是内置演示数据、
        // 所有保存都是空操作，必须让用户看见，不能装作一切正常。
        if (/Electron\//.test(navigator.userAgent)) {
          setError("桌面桥接没有加载（preload 缺失）：当前界面是内置演示数据，设置和对话都无法保存。请重新构建并重启 DYWorker。");
        }
        setReady(true);
        return;
      }
      try {
        const state = await window.dyworker.getInitialState();
        if (cancelled) return;
        const loaded = keepSingleUnstartedSession(state.sessions);
        const initialDraft = loaded.length ? null : makeSession(state.workspacePath);
        setNewTaskDraft(initialDraft);
        setSessions(loaded.map(session => session.goal && !session.goalState
          ? { ...session, ...startGoal(session.goal) }
          : session));
        // 种子保存基线：首次保存不需要把整档重发一遍
        sessionSaveQueue.seed(loaded, state.activeSessionId || loaded[0]?.id || "");
        // 恢复上次选中的会话；已不存在（被删/来自旧版本存档）则回退到列表第一项
        const restoredActiveId = loaded.some((session) => session.id === state.activeSessionId) ? state.activeSessionId : loaded[0]?.id;
        setActiveId(restoredActiveId || initialDraft!.id);
        // 全局工作目录可能被上次的无目录会话清空，优先用当前会话保存的目录
        setWorkspacePath(loaded.find(session => session.id === restoredActiveId)?.workspacePath || state.workspacePath);
        setWorkspaceEntries(state.workspaceEntries);
        setSettings(state.settings);
        setPinnedWorkspacePaths(state.pinnedWorkspacePaths || []);
        setPlatform(state.platform || "");
        setWindowMaximized(Boolean(state.windowMaximized));
      } catch (loadError) {
        bootstrapFailedRef.current = true;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  // 所有平台共用应用工具栏；最大化状态在首帧绘制前同步。
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("window-maximized", windowMaximized);
  }, [windowMaximized]);

  useEffect(() => {
    if (!window.dyworker) return;
    const unsubscribe = window.dyworker.onWindowStateChange?.((maximized) =>
      setWindowMaximized(Boolean(maximized)),
    );
    return () => unsubscribe?.();
  }, []);

  // 保存队列负责串行、合并和成功确认；失败后用最新状态重试，不漏报未保存的会话。
  const saveSessionSnapshot = async () => {
    if (!window.dyworker || bootstrapFailedRef.current) return;
    const ok = await sessionSaveQueue.request(sessionsRef.current, activeIdRef.current);
    if (!sessionSaveMountedRef.current) return;
    if (ok) {
      if (sessionSaveRetryRef.current !== null) window.clearTimeout(sessionSaveRetryRef.current);
      sessionSaveRetryRef.current = null;
    } else if (sessionSaveRetryRef.current === null) {
      setError(`会话保存失败，将自动重试：${sessionSaveQueue.error()}`);
      sessionSaveRetryRef.current = window.setTimeout(() => {
        sessionSaveRetryRef.current = null;
        void saveSessionSnapshot();
      }, 2000);
    }
  };

  useEffect(() => {
    if (!ready || !window.dyworker || bootstrapFailedRef.current) return;
    // 有任务在跑时暂停常规保存（见 SESSION_STREAMING_SAVE_INTERVAL_MS 的
    // 说明）；任务结束 runningSessionIds 变化后本 effect 重跑，最终内容
    // 会按 180ms 防抖立即落盘，流式期间的内容不会丢
    if (runningSessionIds.size) return;
    const timeout = window.setTimeout(() => void saveSessionSnapshot(), 180);
    return () => window.clearTimeout(timeout);
  }, [ready, sessions, activeId, runningSessionIds]);

  // 任务运行中的低频兜底快照：应用崩溃时最多丢这一窗口内的流式内容
  useEffect(() => {
    if (!ready || !window.dyworker || bootstrapFailedRef.current || !runningSessionIds.size) return;
    const interval = window.setInterval(() => {
      void saveSessionSnapshot();
    }, SESSION_STREAMING_SAVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [ready, runningSessionIds]);

  // 启动/重启后恢复"挂起中"会话：主进程 wakes.json 里还挂着的待唤醒必须重新显示，
  // 否则刚重启时输入框会被当成空闲，用户一发消息就会和到点续跑撞在同一个会话里
  useEffect(() => {
    if (!ready || !window.dyworker || bootstrapFailedRef.current) return;
    void refreshPendingWakes();
  }, [ready]);

  useEffect(() => {
    if (!ready || !window.dyworker || bootstrapFailedRef.current) return;
    const timeout = window.setTimeout(() => void window.dyworker?.savePinnedWorkspaces(pinnedWorkspacePaths), 180);
    return () => window.clearTimeout(timeout);
  }, [pinnedWorkspacePaths, ready]);

  // 审批模式记住上次选择：启动时从设置恢复，切换后立即落盘
  useEffect(() => {
    const saved = settings?.approvalMode;
    if (saved === "allow-writes") {
      setApprovalMode("reviewer");
    } else if (saved && ["interactive", "reviewer", "full-access", "deny-changes"].includes(saved)) {
      setApprovalMode(saved as ApprovalMode);
    }
  }, [settings?.approvalMode]);

  // 切换会话（含启动加载）后贴底，并在整个会话期间持续跟随内容增长：
  // 流式思考/回答、图片附件、mermaid、echarts 都会让内容一长再长，没有跟随的话
  // 最新文字会从悬浮输入框背后溜走（半透明模式下与输入框文字交叠成两层）。
  // 上滚判定不能只看 scroll 事件里的「距底部是否超阈值」：流式期间内容每帧都在
  // 长高，RO 的 stick 会抢在排队的 scroll 事件之前把用户刚滚出的位置拉回底部，
  // 证据被覆盖（实测 scrollBy 500px 被吞）；锚定/content-visibility 抖动也会凭空
  // 把距离顶过阈值（实测 10px）误杀跟随。因此 stick 时按「当前距离 > 上次距离 +
  // 本帧增量 + 容差」识别用户上滚，scroll 事件只做补充判定。
  useEffect(() => {
    const viewport = viewportNode;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight });
    setAtBottom(true);
    let pinned = true;
    let lastDist = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    let lastHeight = viewport.scrollHeight;
    // 用户按住（拖滚动条/划选区）期间挂起跟随，松开后按位置重算
    let interacting = false;
    // 滚轮上翻宽限期：同帧 RO 抢跑时兜底，避免和用户抢滚动条
    let upGestureUntil = 0;
    const dist = () => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const onScroll = () => {
      const d = dist();
      if (viewport.scrollHeight === lastHeight && d > lastDist) {
        // 内容高度没变而距离变大：用户在上滚（滚动条拖动/按键），退出跟随
        pinned = false;
      } else if (d <= 48) {
        // 贴回底部恢复跟随（48 与跳底按钮的贴底语义一致）；贴底期间的锚定抖动也在此保持跟随
        pinned = true;
      } else if (d < lastDist - 100 && d <= 200) {
        // 大幅下滚且落点接近底部：视为回底。事件里的落点可能带过冲——落点处的
        // 行此刻才进入 content-visibility 渲染区、高度才兑现，真实落底位置比
        // 事件里的 d 更贴近底部（实测过冲 60px+），不能按 d≤24 硬判
        pinned = true;
      }
      lastDist = d;
      lastHeight = viewport.scrollHeight;
    };
    const onPointerDown = () => {
      interacting = true;
    };
    const endInteraction = () => {
      if (!interacting) return;
      interacting = false;
      if (dist() <= 48) pinned = true;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) upGestureUntil = performance.now() + 400;
    };
    const stick = () => {
      if (interacting || performance.now() < upGestureUntil) return;
      const growth = viewport.scrollHeight - lastHeight;
      const d = dist();
      if (d > lastDist + growth + 24) {
        // 距离超出「上次 + 本帧增量 + 容差」：用户已上滚（其 scroll 事件可能
        // 还排在队里，位置证据会被本帧 stick 覆盖，只能在这里判），退出跟随
        pinned = false;
        return;
      }
      // 贴底（含刚滚回底部）即恢复跟随：不依赖 scroll 事件曾把 pinned 置回
      if (d <= 48) pinned = true;
      if (!pinned) return;
      viewport.scrollTo({ top: viewport.scrollHeight });
      lastDist = 0;
      lastHeight = viewport.scrollHeight;
    };
    const column = viewport.firstElementChild;
    const observer = new ResizeObserver(stick);
    // border-box：--composer-height 变化（输入框多行长高/排队卡片增减）改的是
    // padding-bottom，只有 border-box 能感知，否则加高后的输入框会盖住末行
    if (column) observer.observe(column, { box: "border-box" });
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", endInteraction);
    window.addEventListener("pointercancel", endInteraction);
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", endInteraction);
      window.removeEventListener("pointercancel", endInteraction);
    };
  }, [activeId, ready, viewportNode]);

  useEffect(() => {
    setHoveredTurnIndex(null);
  }, [activeId]);

  useEffect(() => {
    if (shouldScrollToBottomRef.current !== activeId) return;
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "smooth" });
    shouldScrollToBottomRef.current = null;
  }, [sessions, runningSessionIds, activeId]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => setError(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  useEffect(() => () => {
    recorderRef.current?.stop();
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    for (const unsubscribe of agentUnsubscribeRefs.current.values()) unsubscribe();
    agentUnsubscribeRefs.current.clear();
    for (const timeout of sessionNoticeTimersRef.current.values()) window.clearTimeout(timeout);
    sessionNoticeTimersRef.current.clear();
    for (const timeout of sessionErrorTimersRef.current.values()) window.clearTimeout(timeout);
    sessionErrorTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!settingsOpen || !window.dyworker) return;
    void window.dyworker.listMemories?.().then(setMemories);
    void window.dyworker.listSchedules?.().then(setSchedules);
  }, [settingsOpen, workspacePath]);

  useEffect(() => {
    if (!ready || !window.dyworker?.listSkills) return;
    void window.dyworker.listSkills(workspacePath).then((items) => {
      setSkills(items);
      setMentionSkills(items);
    });
  }, [ready, workspacePath, settingsOpen]);

  useEffect(() => {
    if (!(settingsOpen && settingsTab === "usage") || !window.dyworker) return;
    void window.dyworker.listUsageStats().then(setUsageStats);
  }, [settingsOpen, settingsTab]);

  useEffect(() => {
    const updater = window.dyworker;
    if (!updater?.onAppUpdateStatus) return;
    const offUpdate = updater.onAppUpdateStatus((status) => {
      setAppUpdate((previous) => {
        // 自动检查在后台静默进行：发现新版本只点亮侧栏下载按钮，不主动弹窗；
        // 只有用户正在查看更新对话框、或更新由「下载中」变为「下载完成」时才自动弹出
        if (status.state === "available" && (appUpdateDialogOpen || previous.state === "checking")) setAppUpdateDialogOpen(true);
        if (status.state === "downloaded" && previous.state === "downloading") setAppUpdateDialogOpen(true);
        return status;
      });
    });
    void updater.getAppUpdateStatus().then(setAppUpdate);
    return () => offUpdate?.();
  }, []);

  useEffect(() => {
    const offSchedules = window.dyworker?.onSchedulesChanged?.(() => {
      void window.dyworker?.listSchedules?.().then(setSchedules);
      void window.dyworker?.listMemories?.().then(setMemories);
    });
    const offPrepend = window.dyworker?.onSessionPrepend?.((session) => {
      const workingContext = session.workingContext ?? latestWorkingContext(session.messages);
      const incoming: SessionRecord = { ...session, ...(workingContext !== undefined ? { workingContext } : {}) };
      // 计划运行开始时已按同一个会话 id 乐观建过会话（schedules:run-started），这里必须按 id
      // 原位归并权威转录：直接 prepend 会在「最近任务」里多出一条同 id 的重复会话，一条停在
      // 运行中、一条已是最终结果（markdown 渲染也会因为 React key 重复而漂移）。
      // mergePrependedSession 是纯函数，可安全放进 updater（StrictMode 双调结果一致）。
      setSessions((current) => mergePrependedSession<SessionRecord>(current, incoming).sessions);
      // 一轮运行结束（完成/挂起/失败都会走到这里）：清掉这次运行的流式占位与运行标记，
      // 否则气泡永远停在"正在执行"，侧栏的转圈也不会停
      forgetSessionStream(channelStreamRunsRef.current, session.id);
      channelStreamIdsRef.current.delete(session.id);
      const finishedRun = [...session.messages].reverse().find(message => message.role === 'assistant')?.runId;
      if (finishedRun && runningRunIdsRef.current.get(session.id) === finishedRun) runningRunIdsRef.current.delete(session.id);
      setScheduledRunSessions((current) => {
        if (!current.has(session.id)) return current;
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
      setRunningSessionIds((current) => {
        if (!current.has(session.id)) return current;
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
      setLoopStates((current) => {
        if (!(session.id in current)) return current;
        const next = { ...current };
        delete next[session.id];
        return next;
      });
      // 计划主动挂起时，界面要立刻出「立即继续 / 取消唤醒」卡片（挂起状态以主进程
      // wakes.json 为权威）；已完成/失败的一轮也会借此清掉过期的挂起标记
      void refreshPendingWakes();
      setNotice(session.channel
        ? `收到${session.channel === "qq" ? "QQ" : "微信"}消息，渠道会话已建立`
        : "定时计划已执行，结果已保存到最近任务");
    });
    // 定时计划开始运行：主进程在起跑前就把本次运行的会话标识推过来，界面立刻建出会话与
    // 流式占位气泡（后续 agent:event 带 scheduleRun 打标实时填充）。以前只在运行结束（或
    // 挂起）时才 prepend 整段转录，一个跑几十分钟的计划这段时间里界面上什么都没有。
    const offScheduleRunStarted = window.dyworker?.onScheduleRunStarted?.((payload) => {
      const sessionId = String(payload?.sessionId || "");
      if (!sessionId) return;
      const runId = String(payload?.runId || sessionId);
      const startedAt = payload?.startedAt || new Date().toISOString();
      const assistantId = `${runId}:assistant`;
      runningRunIdsRef.current.set(sessionId,runId);
      // 占位气泡登记放在 updater 外：StrictMode 下 updater 会被双调，ref 写入必须只发生一次
      registerStreamMessage(channelStreamRunsRef.current, runId, { sessionId, messageId: assistantId });
      channelStreamIdsRef.current.set(sessionId, assistantId);
      setSessions((current) => mergePrependedSession<SessionRecord>(current, {
        id: sessionId,runtime:payload?.runtime === 'dsh' ? 'dsh' : 'dyworker',
        title: payload?.title || "计划任务",
        workspacePath: String(payload?.workspacePath || ""),
        createdAt: startedAt,
        updatedAt: startedAt,
        messages: [
          { id: `${runId}:user`,runId,role: "user", content: String(payload?.prompt || ""), createdAt: startedAt },
          { id: assistantId,runId,role: "assistant", content: "", createdAt: startedAt, activities: [] },
        ],
      }).sessions);
      setRunningSessionIds((current) => new Set(current).add(sessionId));
      setRunningStartedAt((current) => ({ ...current, [sessionId]: Date.now() }));
      setScheduledRunSessions((current) => new Set(current).add(sessionId));
      // 手动「立即执行」：用户点它就是要马上看到这次运行，直接把会话推到眼前
      // （到点自动执行的计划只进列表，不抢当前会话焦点）
      if (payload?.manual && manualRunScheduleRef.current === String(payload?.scheduleId || "")) {
        manualRunScheduleRef.current = "";
        setSettingsOpen(false);
        setPendingAutoOpenSessionId(sessionId);
      }
      showSessionNotice(sessionId, "计划任务已开始执行，进度实时显示在这里");
    });
    const offAppend = window.dyworker?.onSessionAppend?.((payload) => {
      const appendUnread = payload.sessionId !== activeIdRef.current;
      // 渠道任务收尾的落库消息与运行期间的流式占位气泡是同一条回复：凭 runId 找到占位气泡
      // 原位替换，否则会出现两条重复消息。takeStreamMessage 是 delete-on-read（替换只发生一次），
      // 必须在 setSessions updater 外调用——updater 在 StrictMode 下会被双调，里面要保持纯净。
      const streamRef = takeStreamMessage(channelStreamRunsRef.current, String(payload.runId || ""));
      const placeholderMessageId = streamRef && streamRef.sessionId === payload.sessionId ? streamRef.messageId : null;
      setSessions((current) => {
        const existing = current.find((session) => session.id === payload.sessionId);
        const workingContext = latestWorkingContext(payload.messages);
        if (existing) {
          const { messages: mergedMessages, replacedMessageId } = reconcileChannelAppend(existing.messages, placeholderMessageId, payload.messages);
          if (replacedMessageId) {
            // 占位气泡已被最终消息接管：随后的 agent-finished 补丁不得再覆盖它
            // （补丁只会写裸 finalText，会丢「已发送 N 个文件」等收尾注记）。delete 幂等，双调安全。
            channelStreamIdsRef.current.delete(payload.sessionId);
          }
          return current.map((session) => session.id === payload.sessionId
            ? {
                ...session,
                // 渠道里用「更换工作目录至…」切换后，主进程随下一条消息带回新路径
                workspacePath: payload.workspacePath || session.workspacePath,
                ...(payload.goalState && session.goalState?.id === payload.goalState.id && session.goalState.status === 'active' ? { goalState: payload.goalState } : {}),
                ...(workingContext !== undefined ? { workingContext } : {}),
                ...(appendUnread ? { unread: true } : {}),
                messages: mergedMessages,
                updatedAt: new Date().toISOString(),
              }
            : session);
        }
        const now = new Date().toISOString();
        return [{
          id: payload.sessionId,
          title: payload.channel ? `${payload.channel === "qq" ? "QQ" : "微信"}消息` : "到点自动唤醒续跑",
          workspacePath: payload.workspacePath,
          ...(payload.channel ? { channel: payload.channel } : {}),
          ...(workingContext !== undefined ? { workingContext } : {}),
          ...(appendUnread ? { unread: true } : {}),
          createdAt: now,
          updatedAt: now,
          messages: payload.messages,
        }, ...current];
      });
      setNotice(payload.channel
        ? `${payload.channel === "qq" ? "QQ" : "微信"}渠道任务有新进展`
        : "挂起的任务已到点自动唤醒，结果已写入任务记录");
    });
    const offInbox = window.dyworker?.onInboxChanged?.(() => {
      void window.dyworker?.listInbox?.().then(setInboxItems);
    });
    const offWakeStatus = window.dyworker?.onWakeStatus?.((payload) => {
      if (payload.status === "running") {
        setRunningSessionIds((current) => new Set(current).add(payload.sessionId));
        setRunningStartedAt((current) => ({ ...current, [payload.sessionId]: Date.now() }));
        // 主进程下发了续跑的 runId：登记后 ESC/停止按钮才能真的打断无人值守续跑
        if (payload.runId) runningRunIdsRef.current.set(payload.sessionId, payload.runId);
        // 已经开跑就不再是"挂起中"，避免挂起卡片和运行状态同时显示
        setSleepingSessions((current) => {
          if (!(payload.sessionId in current)) return current;
          const next = { ...current };
          delete next[payload.sessionId];
          return next;
        });
        // 记录"续跑中"：运行状态行与气泡说明都按这个状态改写，
        // 免得界面上还挂着"将于 X 自动唤醒"的将来时，下面却在跑任务
        const wakeAt = String(payload.wakeAt || "");
        const { marker, done } = wakingNoteTexts(formatWakeTime(wakeAt), Boolean(payload.manual));
        const wakingEntry: WakingSessionEntry = { wakeAt, manual: Boolean(payload.manual), marker, done };
        wakingSessionsRef.current = { ...wakingSessionsRef.current, [payload.sessionId]: wakingEntry };
        setWakingSessions(wakingSessionsRef.current);
        patchWakingSleepNote(payload.sessionId, wakeAt, marker, "waking");
        showSessionNotice(
          payload.sessionId,
          payload.manual ? "已按你的要求立即继续，正在处理..." : "已到点自动唤醒，正在自主推进任务...",
        );
      } else {
        setRunningSessionIds((current) => {
          const next = new Set(current);
          next.delete(payload.sessionId);
          return next;
        });
        if (runningRunIdsRef.current.get(payload.sessionId) === payload.runId) {
          runningRunIdsRef.current.delete(payload.sessionId);
        }
        // 续跑收尾：把气泡从"正在继续处理"收口为已完成时态，再清掉续跑标记。
        // 这里用 ref 读、状态更新保持纯净（updater 在 StrictMode 下会被双调）
        const finished = wakingSessionsRef.current[payload.sessionId];
        if (finished) {
          patchWakingSleepNote(payload.sessionId, finished.wakeAt, finished.marker, "woke", finished.done);
          const next = { ...wakingSessionsRef.current };
          delete next[payload.sessionId];
          wakingSessionsRef.current = next;
          setWakingSessions(next);
        }
        // 续跑可能又挂了新的一觉（或已被用户取消）：回主进程取权威状态
        void refreshPendingWakes();
      }
    });
    const offInboxFocus = window.dyworker?.onInboxFocusItem?.((item) => {
      if (item?.sessionId) {
        setActiveId(item.sessionId);
      }
      setInboxOpen(true);
    });
    // 运营消息：未读数随主进程消息中心变化自动刷新；系统通知点击后定位到对应消息
    const refreshSystemUnread = () => {
      void window.dyworker?.listSystemMessages?.().then((items) => {
        const now = Date.now();
        setSystemMessagesUnread((items || []).filter((message) =>
          !message.read_at && !message.revoked
          && !(message.expires_at && Number.isFinite(Date.parse(message.expires_at)) && Date.parse(message.expires_at) <= now),
        ).length);
      });
    };
    const offSystemMessages = window.dyworker?.onSystemMessagesChanged?.(refreshSystemUnread);
    const offSystemMessagesFocus = window.dyworker?.onSystemMessagesFocus?.(({ messageId }) => {
      setInboxTab("messages");
      setSystemMessageFocusId(String(messageId || ""));
      setInboxOpen(true);
    });
    refreshSystemUnread();
    // 人工活动信号：应用内点击/按键/滚动节流上报主进程，只记录发生时间（用于前台有效使用
    // 时长统计；不读取键盘内容、剪贴板或页面正文），统计关闭时主进程直接忽略
    let lastActivityReport = 0;
    const reportActivity = () => {
      const stamp = Date.now();
      if (stamp - lastActivityReport < 1000) return;
      lastActivityReport = stamp;
      window.dyworker?.reportUserActivity?.();
    };
    const activityOptions = { capture: true, passive: true } as AddEventListenerOptions;
    window.addEventListener("pointerdown", reportActivity, activityOptions);
    window.addEventListener("keydown", reportActivity, activityOptions);
    window.addEventListener("wheel", reportActivity, activityOptions);
    void window.dyworker?.listInbox?.().then(setInboxItems);
    return () => {
      offSchedules?.();
      offPrepend?.();
      offScheduleRunStarted?.();
      offAppend?.();
      offInbox?.();
      offWakeStatus?.();
      offInboxFocus?.();
      offSystemMessages?.();
      offSystemMessagesFocus?.();
      window.removeEventListener("pointerdown", reportActivity, activityOptions);
      window.removeEventListener("keydown", reportActivity, activityOptions);
      window.removeEventListener("wheel", reportActivity, activityOptions);
    };
  }, []);

  // 渠道（QQ/微信）/定时计划会话实时进度：主进程在任务运行期间把关键 agent 事件
  // （活动流、正文流式、计划、循环状态、任务结束）通过 agent:event 转发过来（渠道信封带
  // channelRun: true，计划运行带 scheduleRun: true），这里归约进对应会话的消息，让它们在
  // 界面上边跑边显示，而不是等全部结束才一次性落库。与 runTask 内的监听器互不干扰：
  // 它只处理 taskSessionId+taskRunId，不碰这两类会话；这里只认显式打标的信封，
  // 桌面端在渠道会话里发起的运行（无标记）不会被重复渲染成第二个气泡。
  // 两类运行共用同一套占位气泡归约：计划会话的占位气泡在 schedules:run-started 时就已建好，
  // ensureChannelAssistant 只是兜底（信封先到、run-started 后到的极端时序）。
  useEffect(() => {
    if (!window.dyworker?.onAgentEvent) return;
    // 每个流式会话当前正在更新的 assistant 占位消息 id（按 sessionId 记录）
    const channelStreamIds = channelStreamIdsRef.current;
    const streamRuns = channelStreamRunsRef.current;
    const activeDshTurns = new Map<string,string>();
    const patchChannelAssistant = (sessionId: string, updater: (current: ChatMessage) => ChatMessage) => {
      const targetId = channelStreamIds.get(sessionId);
      if (!targetId) return;
      const runId = [...streamRuns.entries()].find(([,ref])=>ref.sessionId===sessionId && ref.messageId===targetId)?.[0] || '';
      const turnId = activeDshTurns.get(runId);
      updateSession(sessionId, (session) => ({
        ...session,
        messages: patchDshAssistant(session.messages,{assistantId:targetId,runId,turnId},updater),
      }));
    };
    const ensureChannelAssistant = (sessionId: string, runId: string): string => {
      const existing = channelStreamIds.get(sessionId);
      if (existing) return existing;
      const id = `${runId}:assistant`;
      channelStreamIds.set(sessionId, id);
      // 登记 runId → 占位位置：收尾 sessions:append 凭它原位替换占位气泡，而不是追加第二条
      registerStreamMessage(streamRuns, runId, { sessionId, messageId: id });
      updateSession(sessionId, (session) => ({
        ...session,
        messages: [...session.messages, {
          id, runId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          activities: [],
        }],
      }));
      return id;
    };
    const unsubscribe = window.dyworker.onAgentEvent((sessionAgentEvent) => {
      const { sessionId, runId, event } = sessionAgentEvent;
      if (sessionAgentEvent.childRun) {
        if (event.type === 'queue-start') {
          runningRunIdsRef.current.set(sessionId,runId);
          setRunningSessionIds(current => new Set(current).add(sessionId));
        } else if (runningRunIdsRef.current.get(sessionId) === runId) {
          if (event.type === 'approval-request') setPendingApprovals(current => ({...current,[sessionId]:event.action}));
          if (event.type === 'approval-withdrawn') setPendingApprovals(current => { if (current[sessionId]?.id !== event.actionId) return current; const next={...current}; delete next[sessionId]; return next; });
          if (event.type === 'ask-user') setPendingQuestions(current => ({...current,[sessionId]:event.request}));
          if (event.type === 'agent-finished') {
            runningRunIdsRef.current.delete(sessionId);
            setRunningSessionIds(current => {const next=new Set(current);next.delete(sessionId);return next;});
            setPendingApprovals(current => {const next={...current};delete next[sessionId];return next;});
            setPendingQuestions(current => {const next={...current};delete next[sessionId];return next;});
            showSessionNotice(sessionId,event.result.status === 'done' ? '子任务本轮已结束' : event.result.reason || '子任务已停止');
          }
        }
        return;
      }
      // 自动会话标题在全局监听器处理（桌面与渠道运行都算）：按 sessionId 更新，
      // 不依赖 runTask 的 runId 专属监听器，任务先结束、标题后生成也能收到
      if (event.type === "session-title") {
        const title = String(event.title || "").trim().slice(0, 40);
        if (title) {
          updateSession(sessionId, (session) => (session.titleCustom ? session : { ...session, title }));
        }
        return;
      }
      // 只处理带运行标记的转发事件：桌面会话由 runTask 内注册的专属监听器处理，
      // 桌面端在渠道会话里发起的运行（信封无 channelRun 标记）也归它，这里必须跳过
      const scheduledRun = isScheduleRunEnvelope(sessionAgentEvent);
      const wakingRun = isWakeRunEnvelope(sessionAgentEvent);
      if (!isChannelRunEnvelope(sessionAgentEvent) && !scheduledRun && !wakingRun) return;
      const target = sessionsRef.current.find((session) => session.id === sessionId);
      if (!target) return;
      // 渠道归约只认渠道会话（桌面端可能在同一个渠道会话里起运行，那是 runTask 的事）；
      // 计划运行只认本次运行已经建好占位气泡的会话（run-started 先到，标识在 channelStreamIds 里）
      if (!scheduledRun && !wakingRun && !target.channel) return;
      if (wakingRun && runningRunIdsRef.current.get(sessionId)!==runId) return;
      if (scheduledRun && !channelStreamIds.has(sessionId)) return;
      if (event.type === 'dsh-conversation') {
        const assistantId = ensureChannelAssistant(sessionId,runId);
        activeDshTurns.set(runId,event.turns.at(-1)?.user.id || '');
        updateSession(sessionId,session=> {
          let messages = session.messages;
          let user = messages.find(message=>message.role==='user' && message.runId===runId);
          if (!user) {
            user={id:`${runId}:user`,role:'user',runId,content:event.turns[0]?.user.text || '',createdAt:new Date().toISOString()};
            const index=messages.findIndex(message=>message.id===assistantId);
            messages=[...messages.slice(0,index),user,...messages.slice(index)];
          }
          return {...session,messages:reconcileDshTurns(messages,event.turns,{userId:user.id!,assistantId,runId,live:true})};
        });
      } else if (event.type === "queue-start") {
        runningRunIdsRef.current.set(sessionId,runId);
        ensureChannelAssistant(sessionId, runId);
        setRunningSessionIds((current) => new Set(current).add(sessionId));
        setRunningStartedAt((current) => ({ ...current, [sessionId]: Date.now() }));
      } else if (event.type === "activity") {
        ensureChannelAssistant(sessionId, runId);
        if (event.activity.branch) {
          // 子代理分支活动挂到父活动 children（与桌面 runTask 监听器同一套归约）
          patchChannelAssistant(sessionId, (current) => {
            const { list, attached } = appendBranchActivity(current.activities || [], event.activity);
            if (!attached) {
              console.warn("子代理分支活动找不到父活动，已丢弃", event.activity.id);
              return current;
            }
            return { ...current, activities: list };
          });
        } else {
          patchChannelAssistant(sessionId, (current) => ({ ...current, activities: [...(current.activities || []), event.activity] }));
        }
      } else if (event.type === "activity-update") {
        patchChannelAssistant(sessionId, (current) => ({
          ...current,
          activities: patchActivityTree(current.activities || [], event.id, event.status, event.detail, event.durationMs, event.commentary),
        }));
      } else if (event.type === "assistant-text" && !activeDshTurns.has(runId)) {
        ensureChannelAssistant(sessionId, runId);
        patchChannelAssistant(sessionId, (current) => ({ ...current, content: event.text }));
      } else if (event.type === "assistant-reasoning" && !activeDshTurns.has(runId)) {
        ensureChannelAssistant(sessionId, runId);
        patchChannelAssistant(sessionId, (current) => applyReasoningStream(current, event.text));
      } else if (event.type === "plan-update") {
        ensureChannelAssistant(sessionId, runId);
        patchChannelAssistant(sessionId, (current) => ({ ...current, plan: event.steps }));
      } else if (event.type === "file-change") {
        patchChannelAssistant(sessionId, (current) => ({ ...current, changes: event.changes }));
      } else if (event.type === "loop-state") {
        setLoopStates((current) => {
          const next = { ...current };
          if (event.active) {
            next[sessionId] = { iteration: event.iteration, maximum: event.maximum, status: event.status };
          } else {
            delete next[sessionId];
          }
          return next;
        });
      } else if (event.type === "agent-finished") {
        // 收尾：用结果体把流式气泡收口为最终形态，并清掉运行标记。
        // 若收尾 append 已原位替换占位气泡，channelStreamIds 条目已被清掉，这里的补丁自然落空，
        // 不会用裸 finalText 覆盖落库消息。
        const result = event.result;
        patchChannelAssistant(sessionId, (current) => {
          const plan = result.plan?.length ? result.plan : current.plan;
          return {
            ...current,
            content: result.finalText || current.content,
            // 占位气泡创建于消息提交时；这里在任务收尾打点，让气泡时间显示模型回复时间
            createdAt: new Date().toISOString(),
            changes: result.changes?.length ? result.changes : current.changes,
            plan,
            durationMs: (result as { durationMs?: number }).durationMs,
            taskStatus: result.status,
          };
        });
        if (result.dshTurns?.length && channelStreamIds.has(sessionId)) {
          const assistantId=channelStreamIds.get(sessionId)!;
          updateSession(sessionId,session=> {
            const user=session.messages.find(message=>message.role==='user' && message.runId===runId);
            return user ? {...session,messages:reconcileDshTurns(session.messages,result.dshTurns!,{userId:user.id!,assistantId,runId})} : session;
          });
        }
        activeDshTurns.delete(runId);
        if (runningRunIdsRef.current.get(sessionId) === runId) runningRunIdsRef.current.delete(sessionId);
        channelStreamIds.delete(sessionId);
        forgetStreamMessage(streamRuns, runId);
        setRunningSessionIds((current) => {
          const next = new Set(current);
          next.delete(sessionId);
          return next;
        });
        setLoopStates((current) => {
          const next = { ...current };
          delete next[sessionId];
          return next;
        });
        if (result.status === "done" && !result.demo) {
          playCompletionSound();
          showSessionNotice(sessionId, "任务已完成");
        } else if (result.status === "sleeping" && result.wake) {
          // 渠道会话同样会有主动挂起：挂起期间也不该再起新一轮（会与到点续跑撞车）
          setSleepingSessions((current) => ({
            ...current,
            [sessionId]: {
              sessionId,
              wakeAt: result.wake!.wakeAt,
              reason: result.wake!.reason || "",
            },
          }));
          showSessionNotice(sessionId, `已挂起，将于 ${formatWakeTime(result.wake.wakeAt)} 自动唤醒继续`);
          // 以主进程 pending 列表为准自纠正（登记被跳过时不该把输入框锁死）
          void refreshPendingWakes();
        }
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  const refreshMemories = async () => {
    if (window.dyworker?.listMemories) setMemories(await window.dyworker.listMemories());
  };

  const refreshSkills = async (announce = false) => {
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

  const syncAtBottom = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setAtBottom(viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 48);
  };

  useEffect(() => {
    syncAtBottom();
  }, [sessions, runningSessionIds, activeId]);

  // 输入区展示的工作目录以当前会话为准，全局值仅作兜底（老会话可能保存了自己的目录）
  const composerWorkspacePath = String(activeSession?.workspacePath || workspacePath || "").trim();
  // 后台任务拓扑按当前会话隔离：只取本会话消息 runId 对应的轨迹，避免切换会话后串看别的会话。
  // 会话消息没有 runId（空会话、纯问答等非任务消息）时本会话没有自己的轨迹，返回空，
  // 不能回退到全量轨迹池——那是所有会话混合的数据，会造成轨迹串会话
  const activeSessionTraceEvents = useMemo(() => {
    if (!debugOpen) return [];
    const runIds = new Set((activeSession?.messages || []).map((message) => message.runId).filter((runId): runId is string => Boolean(runId)));
    if (!runIds.size) return [];
    return traceEvents.filter((entry) => Boolean(entry.runId) && runIds.has(entry.runId!));
  }, [debugOpen, traceEvents, activeSession?.messages]);

  // 历史轨迹由 TraceConsole 在打开时读取，不在每次切换普通会话时预装全部记录。

  // 点开会话即视为已读，清掉未读小绿点
  useEffect(() => {
    setSessions((current) => current.some((session) => session.id === activeId && session.unread)
      ? current.map((session) => session.id === activeId ? { ...session, unread: false } : session)
      : current);
  }, [activeId, sessions]);

  // 工作目录 chip 只在新建会话（尚无消息）时展示；已有会话的工作目录已固定，不再占用输入区空间
  const showComposerContext = Boolean(composerWorkspacePath) && (!activeSession || activeSession.messages.length === 0);

  useEffect(() => {
    if (!showComposerContext) {
      setWorkspaceContext(null);
      return;
    }
    setWorkspaceContext({ name: displayWorkspace(composerWorkspacePath), branch: "" });
    if (!ready || !window.dyworker?.getWorkspaceContext) return;
    let cancelled = false;
    void window.dyworker.getWorkspaceContext(composerWorkspacePath).then((context) => {
      if (!cancelled) setWorkspaceContext(context);
    }).catch(() => {
      // 工作目录仍可用时，至少保留目录名。
    });
    return () => { cancelled = true; };
  }, [ready, composerWorkspacePath, showComposerContext]);

  // 工作区 Git 状态：顶栏分支下拉与提交推送面板共用
  const refreshGitInfo = async () => {
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

  useEffect(() => {
    setBranchMenuOpen(false);
    setCommitPanelOpen(false);
    setConversationToolsOpen(false);
    void refreshGitInfo();
  }, [ready, composerWorkspacePath]);

  const toggleBranchMenu = () => {
    setCommitPanelOpen(false);
    setBranchQuery("");
    setCreatingBranch(false);
    setBranchMenuOpen((value) => !value);
    void refreshGitInfo();
  };

  const openCommitPanel = () => {
    setBranchMenuOpen(false);
    setCommitPanelOpen(true);
    setDiffStats(null);
    if (window.dyworker?.gitDiffStats && composerWorkspacePath) {
      void window.dyworker.gitDiffStats(composerWorkspacePath).then(setDiffStats).catch(() => {});
    }
  };

  const switchBranch = async (name: string) => {
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

  const createBranch = async () => {
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
  const generateCommitMessage = async () => {
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

  const runCommit = async (push: boolean) => {
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

  const runPushOnly = async () => {
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

  const conversationIndex = useMemo(() => indexConversation(activeSession?.messages || []), [activeSession?.messages]);
  const conversationTurns = conversationIndex.turns;
  const activeTaskRunning = Boolean(activeSession?.id && runningSessionIds.has(activeSession.id));
  // 当前会话是否有待唤醒的挂起任务：有则禁止发送——挂起期间再起一轮会让老任务的到点续跑
  // 追到新任务的回复后面（同一会话两个线程），这正是"回复框串味"的来源
  const activeSleeping = activeSession?.id ? sleepingSessions[activeSession.id] : undefined;
  // 当前会话正被一轮定时计划任务占用（主进程 runScheduledTask 在跑）：这次运行的会话现在
  // 是实时可见的，但输入框必须锁住——中途发消息会和后台那轮计划并行写同一个会话，
  // 计划收尾的 sessions:prepend 一归并就把新消息覆盖没了
  const activeScheduledRun = Boolean(activeSession?.id && scheduledRunSessions.has(activeSession.id));
  // 当前会话正在做挂起后的续跑：运行状态行要显示"已到点自动唤醒/已按你的要求立即继续"
  const activeWaking = activeSession?.id ? wakingSessions[activeSession.id] : undefined;
  // 排队消息收在输入框上方的队列卡片里（对照 Codex），不插进对话流；
  // 主进程开始执行（queue-start 出队）后才作为正式消息渲染
  const activeQueuedMessages = useMemo(() => {
    if (!activeSession) return [] as { message: ChatMessage; messageIndex: number }[];
    return activeSession.messages
      .map((message, messageIndex) => ({ message, messageIndex }))
      .filter(({ message }) => message.role === "user" && Boolean(message.runId) && queuedRunIds.has(message.runId!));
  }, [activeSession, queuedRunIds]);
  // 仍在输出中的助手消息下标：没有终态 taskStatus 的最后一条助手消息。
  // 不能简单取 messages 末尾——后面可能跟着排队占位消息
  const streamingAssistantIndex = useMemo(() => {
    if (!activeSession || !activeTaskRunning) return -1;
    // 流式占位气泡**永远**是提交任务时追加在消息末尾的那一条（桌面路径见 sendTask，
    // 渠道路径见 ensureChannelAssistant），所以只认最后一条非排队消息。
    // 不能向前回溯找「最近一条没有 taskStatus 的助手消息」：唤醒续跑只置位
    // runningSessionIds、并不新建占位气泡，向前回溯会命中一条早已定稿的历史消息，
    // 把它误判成流式气泡（渲染成纯文本、并隐藏它的时间/复制/分叉操作行）。
    // 排队占位气泡（taskStatus=queued）会跟在末尾，需要跳过。
    for (let index = activeSession.messages.length - 1; index >= 0; index -= 1) {
      const item = activeSession.messages[index];
      if (item.runId && queuedRunIds.has(item.runId)) continue;
      return item.role === "assistant" && !item.taskStatus ? index : -1;
    }
    return -1;
  }, [activeSession, activeTaskRunning, queuedRunIds]);
  const markQueued = (sessionId: string, runId: string) => {
    const set = queuedRunsRef.current.get(sessionId) || new Set<string>();
    set.add(runId);
    queuedRunsRef.current.set(sessionId, set);
    setQueuedRunIds((current) => {
      const next = new Set(current);
      next.add(runId);
      return next;
    });
  };
  const unmarkQueued = (sessionId: string, runId: string) => {
    const set = queuedRunsRef.current.get(sessionId);
    if (!set) return;
    set.delete(runId);
    if (!set.size) queuedRunsRef.current.delete(sessionId);
    setQueuedRunIds((current) => {
      if (!current.has(runId)) return current;
      const next = new Set(current);
      next.delete(runId);
      return next;
    });
  };
  const sessionHasQueued = (sessionId: string) => Boolean(queuedRunsRef.current.get(sessionId)?.size);
  const activePendingApproval = activeSession?.id ? pendingApprovals[activeSession.id] || null : null;
  const activePendingQuestion = activeSession?.id ? pendingQuestions[activeSession.id] || null : null;
  const activeLoopState = activeSession?.id ? loopStates[activeSession.id] || null : null;
  const inboxPendingCount = inboxItems.filter((item) => item.status === "pending").length;
  const sessionPendingInboxCount = (sessionId: string) =>
    inboxItems.filter((item) => item.status === "pending" && item.sessionId === sessionId).length;
  const activeSessionPendingInboxApproval = useMemo(() => {
    if (!activeSession?.id) return null;
    return inboxItems.find((item) => item.status === "pending" && item.kind === "approval" && item.sessionId === activeSession.id) || null;
  }, [activeSession?.id, inboxItems]);
  const activeSessionPendingInboxQuestion = useMemo(() => {
    if (!activeSession?.id) return null;
    return inboxItems.find((item) => item.status === "pending" && item.kind === "question" && item.sessionId === activeSession.id) || null;
  }, [activeSession?.id, inboxItems]);
  const activeSessionError = activeSession?.id ? sessionErrors[activeSession.id] || "" : "";
  const activeSessionNotice = activeSession?.id ? sessionNotices[activeSession.id] || "" : "";
  const visibleSessions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const pool = sessions
      .filter((session) => showArchived || !session.archived)
      .filter((session) => !needle
        || `${session.title} ${session.messages.map((message) => message.content).join(" ")}`.toLocaleLowerCase().includes(needle));
    return [...pool].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  }, [query, sessions, showArchived]);

  const workspaceSessionGroups = useMemo(() => {
    const groups = new Map<string, SessionRecord[]>();
    const recent: SessionRecord[] = [];
    for (const session of visibleSessions) {
      const path = String(session.workspacePath || "").trim();
      if (!path) {
        recent.push(session);
        continue;
      }
      const current = groups.get(path) || [];
      current.push(session);
      groups.set(path, current);
    }
    const order = (items: SessionRecord[]) => [...items].sort((a, b) => {
      const pinned = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      return pinned || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return {
      workspaces: [...groups.entries()]
        .map(([path, items]) => ({
          path,
          sessions: order(items),
          pinned: pinnedWorkspacePaths.includes(path),
        }))
        .sort((a, b) => {
          const pinned = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
          return pinned || new Date(b.sessions[0]?.updatedAt || 0).getTime() - new Date(a.sessions[0]?.updatedAt || 0).getTime();
        }),
      recent: order(recent),
    };
  }, [pinnedWorkspacePaths, visibleSessions]);

  // 切换会话/工作区时关掉旧工作区的审阅标签页（内容已过期）
  const closeFilePanelTabs = () => {
    if (!toolPanelTabs.some((tab) => tab.kind === "review")) return;
    const kept = toolPanelTabs.filter((tab) => tab.kind !== "review");
    setToolPanelTabs(kept);
    if (!kept.some((tab) => tab.id === activeToolPanelTabId)) setActiveToolPanelTabId(kept[0]?.id || "");
    if (kept.length === 0) setToolPanelMenuOpen(true);
  };

  const applyWorkspaceSelection = (targetWorkspacePath: string) => {
    setWorkspacePath(targetWorkspacePath);
    setWorkspaceMenuPath(null);
    if (targetWorkspacePath) {
      setWorkspaceOpen(true);
      setWorkspaceGroupOpen((current) => ({ ...current, [targetWorkspacePath]: true }));
      if (targetWorkspacePath !== workspacePath) {
        if (window.dyworker?.refreshWorkspace) {
          void window.dyworker.refreshWorkspace(targetWorkspacePath).then(setWorkspaceEntries).catch(() => setWorkspaceEntries([]));
        } else {
          setWorkspaceEntries(targetWorkspacePath === "/workspace/dyworker" ? previewWorkspace : []);
        }
      }
    } else {
      setWorkspaceEntries([]);
    }
  };

  const createTask = (targetWorkspacePath = workspacePath) => {
    setPluginsPageOpen(false);
    setBotTeamPageOpen(false);
    setConversationView("chat");
    const nextWorkspacePath = String(targetWorkspacePath || "");
    if (newTaskDraft) {
      setActiveId(newTaskDraft.id);
      updateSession(newTaskDraft.id, draft => ({ ...draft, workspacePath: nextWorkspacePath }));
      applyWorkspaceSelection(nextWorkspacePath);
      setActiveSkills([]);
      setEditingMessage(null);
      closeFilePanelTabs();
      setNotice("");
      window.setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }

    // 新任务继承当前工作目录，避免切换新会话后助手提示要先选目录；
    // 每个会话仍可在顶部或“+”菜单单独更换或移除工作目录。
    const session = makeSession(nextWorkspacePath);
    setNewTaskDraft(session);
    setActiveId(session.id);
    applyWorkspaceSelection(nextWorkspacePath);
    setComposer("");
    setAttachments([]);
    setActiveSkills([]);
    setEditingMessage(null);
    closeFilePanelTabs();
    setNotice("");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const prepareExtensionCreation = ({ kind, requirement, workspacePath: targetDirectory }: ExtensionCreationRequest) => {
    const bundled = authoringSkill(kind);
    const creator: SkillRecord = skills.find(item => item.id === bundled.id) || {
      ...bundled, enabled: true, builtIn: true, source: 'builtin', sourceLabel: '内置', createdAt: new Date().toISOString(),
    };
    const session = { ...makeSession(targetDirectory), title: kind === 'plugin' ? '制作插件' : '制作技能' };
    const text = `/${creator.name}\n请根据以下需求制作${kind === 'plugin' ? 'DYWorker 插件' : '可复用技能'}，完成后实际检查并说明如何使用。\n\n${requirement}`;
    // 先登记新会话的草稿，避免会话切换时的草稿恢复覆盖制作需求。
    sessionDraftsRef.current[session.id] = { text, pastes: [], annotations: [], attachments: [] };
    setSessions(current => [session, ...current]);
    setActiveId(session.id);
    setActiveSkills([creator]);
    setEditingMessage(null);
    setMentionMenu(null);
    setCreationKind(null);
    setSettingsOpen(false);
    setPluginsPageOpen(false);
    setConversationView('chat');
    applyWorkspaceSelection(targetDirectory);
    setNotice('制作需求已准备，发送后开始制作。');
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  // 从指定消息处分叉：复制会话开头到该消息(含)的内容为新会话，原会话保持不变（对照 Codex fork）
  const forkSession = async (session: SessionRecord, messageIndex: number) => {
    if (session.runtime === 'dsh') {
      try {
        const message = session.messages[messageIndex];
        if (!message?.dshMessageId) throw new Error('这条消息还没有完整保存，请稍后再复制');
        const reply = await window.dyworker?.dshOperation?.({sessionId: '', action: 'session-fork', payload: {
          sourceRootId: session.id, address: {kind: 'session', sessionId: session.id},
          messageId: message.dshMessageId, ...(message.dshTurnId ? {turnId: message.dshTurnId} : {}),
        }});
        if (!reply?.ok || !reply.value?.nativeSession) throw new Error(reply?.error?.message || '复制任务失败');
        const forked = reply.value.nativeSession as SessionRecord;
        clientHost().acceptCreatedSession(forked);
        setSessions(current => [forked, ...current.filter(row => row.id !== forked.id)]);
        selectSession(forked);
        shouldScrollToBottomRef.current = forked.id;
        setNotice('已从此处分叉出新任务，可继续独立对话');
      } catch (error) { setNotice(error instanceof Error ? error.message : '复制任务失败'); }
      return;
    }
    const now = new Date().toISOString();
    const forked: SessionRecord = {
      id: crypto.randomUUID(),
      title: `${session.title}（分支）`,
      workspacePath: session.workspacePath,
      ...(session.runtime ? { runtime: session.runtime } : {}),
      ...(session.goal ? { goal: session.goal, goalState: { ...startGoal(session.goal).goalState!, status: "paused", activeSince: undefined } } : {}),
      createdAt: now,
      updatedAt: now,
      messages: session.messages.slice(0, messageIndex + 1).map((message) => ({ ...message })),
    };
    setSessions((current) => [forked, ...current]);
    setActiveId(forked.id);
    shouldScrollToBottomRef.current = forked.id;
    setNotice("已从此处分叉出新任务，可继续独立对话");
  };

  const deleteSession = (id: string) => {
    setSessionMenuId(null);
    // 会话删除时,它登记的待唤醒一并取消,避免无主的自动续跑
    void window.dyworker?.cancelWakesForSession?.(id);
    setSleepingSessions((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (wakingSessionsRef.current[id]) {
      const next = { ...wakingSessionsRef.current };
      delete next[id];
      wakingSessionsRef.current = next;
      setWakingSessions(next);
    }
    delete sessionDraftsRef.current[id];
    setSessions((current) => {
      const remaining = current.filter((session) => session.id !== id);
      if (!remaining.length) {
        const fresh = makeSession();
        setWorkspacePath("");
        setWorkspaceEntries([]);
        setActiveId(fresh.id);
        setNewTaskDraft(fresh);
        return [];
      }
      if (id === activeId) setActiveId(remaining[0].id);
      return remaining;
    });
  };

  // 「立即继续」：取走主进程的待唤醒并马上续跑（不等约定时间）。
  // 先乐观收起挂起卡片，失败时回主进程重新拉一次权威状态，避免界面与磁盘不一致。
  const resumeSleepingTask = async (sessionId: string) => {
    setSleepingSessions((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setRunningSessionIds((current) => new Set(current).add(sessionId));
    setRunningStartedAt((current) => ({ ...current, [sessionId]: Date.now() }));
    const result = await window.dyworker?.resumeWakeNow?.(sessionId);
    if (result && !result.ok) {
      // 主进程没接（会话占用/后台任务占着调度道）：乐观加上的运行态要撤回，
      // 否则会留下一个转不完的运行中图标和点不动的停止键
      setRunningSessionIds((current) => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
      setRunningStartedAt((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      void refreshPendingWakes();
      showSessionNotice(sessionId, result.error || "立即继续失败，任务仍会在到点时自动唤醒");
    }
  };

  // 「取消唤醒」：不打断已有内容，只是让这个会话重新可交互
  const cancelSleepingTask = async (sessionId: string) => {
    await window.dyworker?.cancelWakesForSession?.(sessionId);
    setSleepingSessions((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    // 挂起气泡里的说明是历史留痕：不补一句，它会继续声称"到点自动唤醒"
    updateSession(sessionId, (session) => {
      const index = session.messages.map((message) => message.taskStatus === "sleeping").lastIndexOf(true);
      if (index < 0) return session;
      return {
        ...session,
        messages: session.messages.map((message, messageIndex) => messageIndex === index
          ? { ...message, content: `${message.content}\n\n**已取消自动唤醒**，本会话可以继续对话。`.trim() }
          : message),
      };
    });
    showSessionNotice(sessionId, "已取消自动唤醒");
  };

  const unarchiveSession = (id: string) => {
    setSessionMenuId(null);
    updateSession(id, (session) => ({ ...session, archived: false }));
  };

  const togglePin = (id: string) => {
    setTopMenuOpen(false);
    updateSession(id, (session) => ({ ...session, pinned: !session.pinned }));
  };

  const toggleWorkspacePin = (targetWorkspacePath: string) => {
    const pinned = pinnedWorkspacePaths.includes(targetWorkspacePath);
    setPinnedWorkspacePaths((current) => pinned
      ? current.filter((path) => path !== targetWorkspacePath)
      : [...current, targetWorkspacePath]);
    setWorkspaceMenuPath(null);
    setNotice(pinned ? "已取消置顶工作目录" : "工作目录已置顶");
  };

  const openWorkspaceInFileManager = async (targetWorkspacePath: string) => {
    setWorkspaceMenuPath(null);
    if (!window.dyworker?.openPath) {
      setNotice("当前预览环境无法打开系统文件管理器");
      return;
    }
    try {
      const result = await window.dyworker.openPath(targetWorkspacePath);
      if (!result.ok) {
        setError(result.error || "无法打开工作目录");
        return;
      }
      setNotice("已在系统文件管理器中打开工作目录");
    } catch (openError) {
      setError(`无法打开工作目录：${openError instanceof Error ? openError.message : String(openError)}`);
    }
  };

  const archiveSession = (id: string) => {
    setTopMenuOpen(false);
    updateSession(id, (session) => ({ ...session, archived: true, pinned: false }));
    if (id === activeId) {
      const next = sessions.find((session) => session.id !== id && !session.archived);
      if (next) setActiveId(next.id);
      else {
        const fresh = makeSession();
        setWorkspacePath("");
        setWorkspaceEntries([]);
        setNewTaskDraft(fresh);
        setActiveId(fresh.id);
      }
    }
  };

  const renameSession = async (id: string, title: string) => {
    const trimmed = title.trim();
    setRenamingId(null);
    if (!trimmed) return;
    const requested = trimmed.slice(0, 40);
    const existing = sessionsRef.current.find(session => session.id === id);
    if (!existing) return;
    if (existing.runtime !== 'dsh') {
      updateSession(id, session => ({...session,title:requested,titleCustom:true}));
      return;
    }
    // Enter and blur may settle the same edit; only the current accepted write updates the view.
    if (sessionRenameRequestsRef.current.get(id)?.title === requested) return;
    const request = {title:requested,token:Symbol(id)};
    sessionRenameRequestsRef.current.set(id,request);
    try {
      if (!window.dyworker?.dshOperation) throw new Error('当前应用不能保存 DSH 任务标题');
      const reply = await window.dyworker.dshOperation({sessionId:id,action:'session-rename',
        payload:{address:{kind:'session',sessionId:id},title:requested}});
      if (!reply?.ok || typeof reply.value?.title !== 'string')
        throw new Error(reply?.error?.message || '任务重命名失败');
      if (sessionRenameRequestsRef.current.get(id) !== request) return;
      updateSession(id, session => ({...session,title:reply.value.title,titleCustom:true}));
    } catch (error) {
      if (sessionRenameRequestsRef.current.get(id) === request)
        setNotice(error instanceof Error ? error.message : '任务重命名失败');
    } finally {
      if (sessionRenameRequestsRef.current.get(id) === request) sessionRenameRequestsRef.current.delete(id);
    }
  };

  const workspaceFiles = useMemo(() => {
    const out: WorkspaceEntry[] = [];
    const walk = (entries: WorkspaceEntry[]) => {
      for (const entry of entries) {
        if (entry.kind === "file") out.push(entry);
        if (entry.children) walk(entry.children);
      }
    };
    walk(workspaceEntries);
    return out;
  }, [workspaceEntries]);

  // 把文件解析成 @token 引用：优先用用户在候选菜单里点选的路径，同名文件退回按名字匹配
  const resolveTokenFile = (name: string): WorkspaceEntry | undefined => {
    const recorded = mentionTokenPathsRef.current.get(name);
    if (recorded) {
      const exact = workspaceFiles.find((file) => file.path === recorded);
      if (exact) return exact;
    }
    return workspaceFiles.find((file) => file.name === name);
  };

  // 把 @「标题」token 解析成会话：优先用候选菜单点选时记录的 id（同名会话不串），
  // 退回按标题匹配（最新优先），并排除当前会话——引用自己没有意义
  const resolveTokenSession = (title: string): SessionRecord | undefined => {
    const recorded = sessionTokenIdsRef.current.get(title);
    if (recorded) {
      const exact = sessions.find((session) => session.id === recorded);
      if (exact) return exact;
    }
    return sessions
      .filter((session) => session.title === title && session.id !== activeSession?.id && session.messages.length > 0)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  };

  // 输入框正文里能解析成文件引用的 @token：镜像层只为这些 token 画高亮
  const activeTokenNames = useMemo(() => {
    const names = new Set<string>();
    if (!composer) return names;
    FILE_TOKEN_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FILE_TOKEN_REGEX.exec(composer))) {
      if (!names.has(match[1]) && resolveTokenFile(match[1])) names.add(match[1]);
    }
    return names;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composer, workspaceFiles]);

  // 正文里已选技能的 /技能名：与 @文件 一样在镜像层画内联高亮
  const activeSkillNames = useMemo(() => new Set(activeSkills.map((skill) => skill.name)), [activeSkills]);

  // 正文里能解析成会话引用的 @「标题」token：镜像层同样画高亮
  const activeSessionTitles = useMemo(() => {
    const titles = new Set<string>();
    if (!composer) return titles;
    SESSION_TOKEN_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SESSION_TOKEN_REGEX.exec(composer))) {
      if (!titles.has(match[1]) && resolveTokenSession(match[1])) titles.add(match[1]);
    }
    return titles;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composer, sessions]);

  // 打开气泡里被引用的文件（@token 点击）：优先用消息里记录的附件路径，桌面版调主进程，预览环境给提示
  const openReferencedFile = async (name: string, knownPath?: string) => {
    const filePath = knownPath || resolveTokenFile(name)?.path;
    if (!filePath) {
      setNotice(`没有找到文件 ${name}，可能已移动或删除`);
      return;
    }
    openFilePreview(filePath, workspacePath);
  };

  // 在光标处插入「@文件名 」内联 token：引用随正文按顺序展示（对齐 Codex 的 @ 引用体验）
  const insertFileToken = (file: WorkspaceEntry) => {
    const token = `@${file.name} `;
    const textarea = textareaRef.current;
    const start = textarea ? textarea.selectionStart : composer.length;
    const end = textarea ? textarea.selectionEnd : composer.length;
    mentionTokenPathsRef.current.set(file.name, file.path);
    setComposer(composer.slice(0, start) + token + composer.slice(end));
    setMentionMenu(null);
    setNotice(`已引用文件：${file.name}`);
    window.setTimeout(() => {
      const target = textareaRef.current;
      if (target) {
        const pos = start + token.length;
        target.focus();
        target.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const handleComposerDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(WORKSPACE_FILE_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setComposerDragActive(true);
  };

  const handleComposerDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setComposerDragActive(false);
  };

  const handleComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    const filePath = event.dataTransfer.getData(WORKSPACE_FILE_DRAG_TYPE);
    if (!filePath) return;
    event.preventDefault();
    setComposerDragActive(false);
    const file = workspaceFiles.find((entry) => entry.path === filePath);
    if (file) insertFileToken(file);
  };

  // 超过阈值的大段粘贴文本折叠成块，避免撑爆输入框；发送时自动附在消息正文后
  const addLongPasteBlock = (text: string) => {
    setComposerPastes((current) => [...current, { id: crypto.randomUUID(), text }]);
    setNotice(`长文本已折叠（${text.length.toLocaleString()} 字），发送时会自动附带`);
  };

  const handleComposerPaste = async (event: ClipboardEvent<HTMLElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
    const image = imageItem?.getAsFile();
    if (!image) {
      const text = event.clipboardData.getData("text/plain");
      if (text.length >= COMPOSER_LONG_PASTE_THRESHOLD) {
        event.preventDefault();
        addLongPasteBlock(text);
      }
      return;
    }
    event.preventDefault();
    setError("");
    if (image.size > 12 * 1024 * 1024) {
      setError("剪贴板图片超过 12 MB，无法添加");
      return;
    }
    try {
      const owner = activeIdRef.current;
      const bytes = Array.from(new Uint8Array(await image.arrayBuffer()));
      let attachment: Attachment | undefined;
      if (window.dyworker?.saveClipboardImage) {
        const result = await window.dyworker.saveClipboardImage({ data: bytes, mimeType: image.type || "image/png", sessionId: owner });
        if (!result.ok || !result.attachment) throw new Error(result.error || "剪贴板图片保存失败");
        attachment = result.attachment;
      } else {
        const previewUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("剪贴板图片预览失败"));
          reader.readAsDataURL(image);
        });
        attachment = {
          name: "剪贴板图片.png",
          path: `clipboard-preview:${crypto.randomUUID()}`,
          size: image.size,
          mimeType: image.type || "image/png",
          isImage: true,
          previewUrl,
        };
      }
      if (activeIdRef.current !== owner) {
        const draft = sessionDraftsRef.current[owner];
        if (draft) draft.attachments = [...draft.attachments, attachment].slice(0, 12);
        return;
      }
      setAttachments((current) => current.some((entry) => entry.path === attachment!.path)
        ? current
        : [...current, attachment!].slice(0, 12));
      setNotice("已粘贴剪贴板图片");
    } catch (pasteError) {
      setError(`无法添加剪贴板图片：${pasteError instanceof Error ? pasteError.message : String(pasteError)}`);
    }
  };

  const openContextMenu = (x: number, y: number, items: ContextMenuItem[]) => {
    setContextMenu({ x, y, items });
  };

  const closeContextMenu = () => setContextMenu(null);

  // 会话内容区松手：有选中文本时弹出「添加到对话 / 侧边聊天」浮动条，
  // 定位在选区上方（fixed + 边缘钳制）；composer/输入框里的选区不响应
  const handleConversationMouseUp = () => {
    const selection = window.getSelection();
    const selected = selection?.toString() ?? "";
    const anchor = selection?.anchorNode;
    const collapsed = !selection || selection.isCollapsed || !selected.trim();
    const inside = Boolean(
      anchor?.nodeType === Node.TEXT_NODE
        ? anchor.parentElement?.closest(".conversation-column")
        : (anchor as Element | null)?.closest?.(".conversation-column"),
    );
    if (collapsed || !inside) {
      setSelectionQuote(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const text = normalizeQuote(selected);
    if (!text) {
      setSelectionQuote(null);
      return;
    }
    setSelectionQuote({ text, x: rect.left + rect.width / 2, y: rect.top });
  };

  // 浮动条「添加到对话」：注释进 composer，评论编辑卡锚到选区上方
  const addSelectionToComposer = () => {
    if (!selectionQuote) return;
    const annotation: MessageAnnotation = { id: crypto.randomUUID(), quote: selectionQuote.text, comment: "" };
    setAnnotations((current) => [...current, annotation]);
    setAnnotationEditor({ id: annotation.id, x: selectionQuote.x, y: selectionQuote.y });
    setSelectionQuote(null);
    window.getSelection()?.removeAllRanges();
  };

  // 浮动条「侧边聊天」：打开右栏聊天页并把选中文本预填进草稿
  const sendSelectionToSideChat = () => {
    if (!selectionQuote) return;
    const text = selectionQuote.text;
    setRightPanelOpen(true);
    openToolPanelTab("chat");
    setSideChatSeed({ text, nonce: Date.now() });
    setSelectionQuote(null);
    window.getSelection()?.removeAllRanges();
  };

  // 选区浮动条的关闭时机：选区塌陷（重新选择/点空白）、Esc、视口滚动
  useEffect(() => {
    if (!selectionQuote) return;
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) setSelectionQuote(null);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSelectionQuote(null);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectionQuote]);

  // 注释定位标记：composer 待发送注释与已发送消息里的注释，都在引用文本起点上方放编号小气泡。
  // 从当前正文定位引用，不保留可能因文本节点替换而失效的 Range。
  const [annotationMarkers, setAnnotationMarkers] = useState<Array<{ id: string; n: number; top: number; left: number }>>([]);
  const annotationQuotesRef = useRef<Array<{ id: string; n: number; quote: string }>>([]);
  const updateAnnotationMarkers = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const viewportRect = viewport.getBoundingClientRect();
    const column = viewport.querySelector(".conversation-column");
    const nextMarkers = annotationQuotesRef.current.flatMap(({ id, n, quote }) => {
      // React 可能替换文本节点，旧 Range 会退化到父元素；每次从当前正文重新找引用。
      const range = findQuoteRange(column, quote);
      if (!range) return [];
      const element = range.startContainer.parentElement;
      const row = element?.closest(".message-row");
      const rowRect = row?.getBoundingClientRect();
      if (rowRect && (rowRect.bottom <= viewportRect.top || rowRect.top >= viewportRect.bottom)) return [];
      // content-visibility:auto 跳过的正文没有可靠文字坐标，不能把它画到视口左边。
      if (element && !element.checkVisibility({ contentVisibilityAuto: true })) return [];
      const rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return [];
      return [{
        id,
        n,
        top: Math.max(2, rect.top - viewportRect.top - viewport.clientTop + viewport.scrollTop - 24),
        left: rect.left - viewportRect.left - viewport.clientLeft + viewport.scrollLeft,
      }];
    });
    setAnnotationMarkers(previous => previous.length === nextMarkers.length && previous.every((entry, index) => {
      const next = nextMarkers[index];
      return entry.id === next.id && entry.n === next.n && entry.top === next.top && entry.left === next.left;
    }) ? previous : nextMarkers);
  };
  // 注释增删、切换会话或新消息落盘时更新引用列表
  const activeMessageCount = activeSession?.messages.length ?? 0;
  useEffect(() => {
    const quotes: Array<{ id: string; n: number; quote: string }> = [
      ...annotations.map((annotation, index) => ({ id: annotation.id, n: index + 1, quote: annotation.quote })),
      ...(activeSession?.messages ?? []).flatMap((message, messageIndex) =>
        (message.annotations ?? []).map((annotation, index) => ({
          id: `${message.id ?? messageIndex}-${annotation.id}`,
          n: index + 1,
          quote: annotation.quote,
        }))),
    ];
    annotationQuotesRef.current = quotes;
    updateAnnotationMarkers();
    // activeSession 由 sessions 派生，消息数变化已能覆盖注释落盘的时机
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, activeId, activeMessageCount]);
  // 内容更新后重新定位引用（rAF 合帧）
  useEffect(() => {
    if (!annotationQuotesRef.current.length) return;
    const frame = requestAnimationFrame(updateAnnotationMarkers);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.messages]);
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateAnnotationMarkers);
    };
    const viewport = viewportRef.current;
    const observer = new ResizeObserver(schedule);
    if (viewport) observer.observe(viewport);
    const column = viewport?.querySelector(".conversation-column");
    if (column) observer.observe(column);
    viewport?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // 消息文本上右键：始终提供「复制」。有选中文本时复制选中内容，
  // 未选中时复制整条消息正文（跳过操作按钮、时间等非正文区域）。
  const handleMessageContextMenu = (event: MouseEvent<HTMLElement>, message?: ChatMessage) => {
    event.preventDefault();
    const selection = window.getSelection();
    const selected = selection?.toString().trim() ?? "";
    const anchor = selection?.anchorNode;
    const inside = Boolean(anchor && event.currentTarget.contains(anchor));
    const hasSelected = inside && selected.length > 0;
    const bodyEl = event.currentTarget.querySelector(".message-content, .user-message-text");
    const text = hasSelected ? selected : (bodyEl?.textContent ?? event.currentTarget.textContent ?? "").trim();
    if (!text) return;
    openContextMenu(event.clientX, event.clientY, [
      {
        key: "copy-selection",
        label: hasSelected ? "复制" : "复制消息",
        icon: <Copy size={15} />,
        onSelect: () => {
          // 复制一律为纯文本（图片由缩略图上的复制按钮单独复制）
          void copyTextToClipboard(text).then((copied) => setNotice(copied ? "已复制" : "复制失败，请检查剪贴板权限"));
        },
      },
    ]);
  };

  // 输入框右键：复制 / 剪切 / 粘贴
  const handleComposerContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const hasSelection = end > start;
    const selected = composer.slice(start, end);
    openContextMenu(event.clientX, event.clientY, [
      {
        key: "copy",
        label: "复制",
        icon: <Copy size={15} />,
        disabled: !hasSelection,
        onSelect: () => {
          if (!hasSelection) return;
          void copyTextToClipboard(selected).then((copied) => setNotice(copied ? "已复制" : "复制失败，请检查剪贴板权限"));
          window.setTimeout(() => textareaRef.current?.focus(), 0);
        },
      },
      {
        key: "cut",
        label: "剪切",
        icon: <Scissors size={15} />,
        disabled: !hasSelection,
        onSelect: () => {
          if (!hasSelection) return;
          setComposer(composer.slice(0, start) + composer.slice(end));
          setMentionMenu(null);
          void copyTextToClipboard(selected).then((copied) => setNotice(copied ? "已剪切" : "剪切内容已删除，但复制到剪贴板失败"));
          window.setTimeout(() => {
            const target = textareaRef.current;
            if (target) {
              target.focus();
              target.setSelectionRange(start, start);
            }
          }, 0);
        },
      },
      {
        key: "paste",
        label: "粘贴",
        icon: <ClipboardPaste size={15} />,
        onSelect: () => {
          void pasteComposerText(start, end);
        },
      },
    ]);
  };

  // 向输入框光标处粘贴剪贴板文本；优先用异步剪贴板 API，被拦截时回退到 execCommand
  const pasteComposerText = async (start: number, end: number) => {
    const textarea = textareaRef.current;
    let text = "";
    // 主进程剪贴板读取不依赖渲染端权限，最可靠，优先使用
    try {
      if (window.dyworker?.readClipboardText) {
        text = await window.dyworker.readClipboardText();
      }
    } catch {
      text = "";
    }
    if (!text) {
      try {
        if (navigator.clipboard?.readText) {
          text = await navigator.clipboard.readText();
        }
      } catch {
        text = "";
      }
    }
    if (!text) {
      textarea?.focus();
      if (document.execCommand("paste")) {
        window.setTimeout(() => {
          const target = textareaRef.current;
          if (target && target.value !== composer) setComposer(target.value);
          setMentionMenu(null);
        }, 0);
      } else {
        setNotice("粘贴失败，请检查剪贴板权限");
      }
      return;
    }
    if (text.length >= COMPOSER_LONG_PASTE_THRESHOLD) {
      addLongPasteBlock(text);
      textarea?.focus();
      return;
    }
    setComposer(composer.slice(0, start) + text + composer.slice(end));
    setMentionMenu(null);
    window.setTimeout(() => {
      const target = textareaRef.current;
      if (target) {
        target.focus();
        target.setSelectionRange(start + text.length, start + text.length);
      }
    }, 0);
  };

  useEffect(() => clientHost().subscribeInputSources(() => setPluginInputRevision(value => value + 1)), []);
  useEffect(() => clientHost().subscribe(() => setPluginInputRevision(value => value + 1)), []);
  useEffect(() => { if (mentionMenu?.programmatic) textareaRef.current?.focus(); }, [mentionMenu?.programmatic, activeSession?.id]);
  useEffect(() => {
    if (!mentionMenu?.programmatic || activeSession?.runtime !== 'dsh') return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.mention-menu, .composer-input-wrap, .add-menu-wrap')) return;
      clientHost().dismissInputMenu(activeSession.id); setMentionMenu(null);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [mentionMenu?.programmatic, activeSession?.id, activeSession?.runtime]);
  useEffect(() => {
    const id = activeSession?.id; if (!id || activeSession.runtime !== 'dsh') return;
    const read = (changedId: string) => {
      if (changedId !== id) return;
      const menu = clientHost().inputMenuSnapshot(id);
      if (menu?.launched && menu.state.hit && clientHost().inputReady(id)) {
        const hit = menu.state.hit;
        setPluginInputCandidates(menu.candidates);
        setMentionMenu(previous => previous?.programmatic && previous.kind === (hit.trigger === '/' ? 'slash' : 'at')
          && previous.query === hit.query && previous.start === hit.span.start && previous.end === hit.span.end ? previous
          : { kind: hit.trigger === '/' ? 'slash' : 'at', query: hit.query, start: hit.span.start, end: hit.span.end, programmatic: true });
        setMentionIndex(0);
      } else setMentionMenu(previous => previous?.programmatic ? null : previous);
    };
    const off = clientHost().subscribeInputMenus(read); read(id); return off;
  }, [activeSession?.id, activeSession?.runtime]);
  useEffect(() => {
    const controller = new AbortController();
    if (mentionMenu?.programmatic) return () => controller.abort();
    setPluginInputCandidates([]);
    if (mentionMenu && activeSession?.runtime === 'dsh') {
      void clientHost().inputCandidates(activeSession.id, mentionMenu.query, mentionMenu.start, composer, controller.signal,
        mentionMenu.kind === 'slash' ? '/' : '@', mentionMenu.end)
        .then(items => { if (!controller.signal.aborted) setPluginInputCandidates(items); })
        .catch(error => { if (!controller.signal.aborted) setError(`插件命令读取失败：${String(error?.message || error)}`); });
    }
    return () => controller.abort();
  }, [mentionMenu, activeSession?.id, activeSession?.runtime, composer, pluginInputRevision]);
  useEffect(() => {
    if (activeSession?.id) clientHost().setInputDraft(activeSession.id, composer);
  }, [activeSession?.id, composer]);
  useEffect(() => clientHost().subscribeInputConsumer((sessionId, text, edit) => {
    if (activeSession?.id !== sessionId) return false;
    setComposer(text);
    if (edit?.continue) { dismissedPluginMention.current = null; syncComposerDerivedState(text, edit.caret); }
    else setMentionMenu(null);
    window.setTimeout(() => { textareaRef.current?.focus(); if (edit) textareaRef.current?.setSelectionRange(edit.caret, edit.caret); }, 0);
    return true;
  }), [activeSession?.id]);

  const mentionItems = useMemo((): { id: string; title: string; detail: string; pluginInput?: RegisteredInputCandidate; skill?: SkillRecord; file?: WorkspaceEntry; prompt?: string; session?: SessionRecord }[] => {
    if (!mentionMenu) return [];
    if (mentionMenu.programmatic) return pluginInputCandidates.map(item => ({ id: item.id,
      title: item.candidate.label || `${mentionMenu.kind === 'slash' ? '/' : '@'}${item.candidate.name}`,
      detail: item.candidate.description || (mentionMenu.kind === 'slash' ? '插件命令' : '插件引用'), pluginInput: item }));
    const query = mentionMenu.query.toLowerCase();
    if (mentionMenu.kind === "slash") {
      const commands = builtinCommands
        .filter((command) => !query || command.title.toLowerCase().includes(query) || command.detail.toLowerCase().includes(query))
        .map((command) => ({ id: command.id, title: command.title, detail: command.detail, prompt: command.prompt }));
      const skills = mentionSkills
        .filter((skill) => skill.enabled !== false && (!query || skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((skill) => ({
          id: skill.id,
          title: `/${skill.name}`,
          detail: `${skill.sourceLabel || "本地模板"} · ${skill.description}`,
          skill,
        }));
      const plugins = pluginInputCandidates.map(item => ({ id: item.id, title: `/${item.candidate.name}`,
        detail: item.candidate.description || item.candidate.label || '插件命令', pluginInput: item }));
      return [...plugins, ...commands, ...skills];
    }
    // @ 候选 = 历史会话 + 工作区文件：会话按置顶/最近更新排在前面（上限 4 条），
    // 空会话（还没跑过任务）与当前会话对引用没有价值，不进候选。
    // 会话过滤前去掉定界括号：点回已插入的 @「标题」token 重新唤起菜单时，查询自带「」
    const sessionQuery = query.replace(/[「」]/g, "");
    const sessionCandidates = sessions
      .filter((session) => session.messages.length > 0 && !session.archived && session.id !== activeSession?.id)
      .filter((session) => !sessionQuery || session.title.toLowerCase().includes(sessionQuery))
      .sort((a, b) => (Boolean(b.pinned) !== Boolean(a.pinned) ? (Boolean(b.pinned) ? 1 : -1) : String(b.updatedAt).localeCompare(String(a.updatedAt))))
      .slice(0, 4)
      .map((session) => ({
        id: `session:${session.id}`,
        title: `@「${session.title}」`,
        detail: `历史会话 · ${formatMessageTime(session.updatedAt)} · ${session.messages.length} 条消息${session.channel === "qq" ? " · QQ" : session.channel === "wechat" ? " · 微信" : ""}`,
        session,
      }));
    const fileCandidates = workspaceFiles
      .filter((file) => !query || file.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query))
      .slice(0, 8)
      .map((file) => ({ id: file.path, title: file.name, detail: file.path, file }));
    const plugins = pluginInputCandidates.map(item => ({ id: item.id, title: item.candidate.label || `@${item.candidate.name}`,
      detail: item.candidate.description || '插件引用', pluginInput: item }));
    return [...plugins, ...sessionCandidates, ...fileCandidates];
  }, [mentionMenu, mentionSkills, workspaceFiles, sessions, activeSession, pluginInputCandidates]);

  // 候选菜单触发（对照 Codex/Claude 的 @、/ 引用）：以光标位置为准检测紧邻的触发 token，
  // 文本中间随时可触发；触发符前只允许行首/空白/中日韩字符——邮箱(a@b)与路径(src/)这类
  // 连续 ASCII 里夹杂的 @// 不打扰候选菜单
  const updateComposer = (value: string, caret?: number) => {
    setComposer(value);
    syncComposerDerivedState(value, caret);
  };

  // 候选菜单与技能引用的同步：只按文本与光标位置推导，绝不回写 composer。
  // 与 updateComposer 拆开是因为 onSelect 会被 React 合成到 keydown/keyup 上，
  // 而这两个事件的派发发生在 DOM 更新之前：回车发送刚把 composer 清空时读到的
  // DOM 仍是旧正文，回写就把清空撤销了（实测：消息发出、输入框内容还在）。
  const syncComposerDerivedState = (value: string, caret?: number) => {
    const position = Math.min(Math.max(caret ?? value.length, 0), value.length);
    if (activeSession?.runtime === 'dsh' && mentionMenu?.programmatic) {
      clientHost().trackInputMenu(activeSession.id, value, position);
      if (clientHost().inputMenuSnapshot(activeSession.id)?.launched) return;
    }
    const before = value.slice(0, position);
    const slashMatch = before.match(/(?:^|[\s\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])\/([^\s@/]*)$/);
    // @ 引用允许在路径中出现 /（如 @src/pages/list），输入 / 不再中断候选菜单
    const atMatch = before.match(/(?:^|[\s\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])@([^\s@]*)$/);
    const detected = activeSession?.runtime === 'dsh'
      ? detectTrigger(clientHost().inputProjection(activeSession.id, value), clientHost().inputCaret(activeSession.id, position),
        { tier: clientHost().inputClaim(activeSession.id) ? 'claimed' : 'plain' }) : null;
    const matched = activeSession?.runtime === 'dsh'
      ? detected ? { kind: detected.trigger === '/' ? 'slash' as const : 'at' as const, query: detected.query } : null
      : slashMatch
      ? { kind: "slash" as const, query: slashMatch[1] }
      : atMatch
        ? { kind: "at" as const, query: atMatch[1] }
        : null;
    if (matched) {
      const start = detected?.span.start ?? position - matched.query.length - 1;
      const dismissed = dismissedPluginMention.current;
      if (matched.kind === 'slash' && dismissed?.sessionId === activeSession?.id && dismissed.text === value
        && dismissed.start === start && dismissed.query === matched.query) {
        setMentionMenu(null); return;
      }
      dismissedPluginMention.current = null;
      if (matched.kind === "slash" && mentionMenu?.kind !== "slash") {
        void window.dyworker?.listSkills?.(workspacePath).then((items) => {
          setSkills(items);
          setMentionSkills(items);
        });
      }
      setMentionMenu({ kind: matched.kind, query: matched.query, start, end: detected?.span.end ?? position });
      setMentionIndex(0);
    } else {
      dismissedPluginMention.current = null;
      if (mentionMenu) setMentionMenu(null);
    }
    // 技能引用以 /技能名 内联 token 留在正文里：删掉 token 即移除引用（与 @文件 一致）
    if (activeSkills.length) {
      const inlineSkillNames = skillTokensInText(value);
      setActiveSkills((current) => current.filter((skill) => inlineSkillNames.has(skill.name)));
    }
  };

  const applyMention = (index: number, action: 'pick' | 'drill' = 'pick') => {
    const item = mentionItems[index];
    if (!item || !mentionMenu) return;
    if (item.pluginInput && activeSession?.runtime === 'dsh') {
      try {
        dismissedPluginMention.current = { sessionId: activeSession.id, text: composer,
          start: mentionMenu.start, query: mentionMenu.query };
        const draftRev = clientHost().setInputDraft(activeSession.id, composer);
        clientHost().pickInputCandidate(activeSession.id, item.pluginInput, { start: mentionMenu.start,
          end: mentionMenu.end ?? mentionMenu.start + mentionMenu.query.length + 1, draftRev }, action);
        if (action === 'pick') setMentionMenu(null);
      } catch (error) { dismissedPluginMention.current = null; setError(String((error as any)?.message || error)); }
      return;
    }
    const nativeSpan = activeSession?.runtime === 'dsh' ? clientHost().inputEditor(activeSession.id)?.clipboardSpan({
      start: mentionMenu.start, end: mentionMenu.end ?? mentionMenu.start + mentionMenu.query.length + 1,
    }) : undefined;
    const nativeStart = nativeSpan?.start ?? mentionMenu.start;
    const nativeEnd = nativeSpan?.end ?? mentionMenu.start + mentionMenu.query.length + 1;
    if (mentionMenu.kind === "slash" && item.id === "builtin:new") {
      setMentionMenu(null);
      setComposer("");
      setAttachments([]);
      setActiveSkills([]);
      setComposerPastes([]);
      setAnnotations([]);
      if (activeSession && activeSession.messages.length === 0) {
        setNotice("当前已是新会话");
        window.setTimeout(() => textareaRef.current?.focus(), 0);
      } else {
        createTask();
        setNotice("已开启新会话");
      }
      return;
    }
    if (mentionMenu.kind === "slash" && item.prompt) {
      // 内置命令（如 /init）：把预设指令填入输入框，由用户确认后发送
      setComposer(item.prompt);
    } else if (mentionMenu.kind === "at" && item.file) {
      // 文件引用：在 @ 位置原地插入内联 token，引用按输入顺序留在正文里
      const token = `@${item.file.name} `;
      const start = nativeStart;
      const end = nativeEnd;
      mentionTokenPathsRef.current.set(item.file.name, item.file.path);
      setComposer(composer.slice(0, start) + token + composer.slice(end));
      window.setTimeout(() => {
        const target = textareaRef.current;
        if (target) {
          const pos = start + token.length;
          target.focus();
          target.setSelectionRange(pos, pos);
        }
      }, 0);
    } else if (mentionMenu.kind === "at" && item.session) {
      // 会话引用：在 @ 位置原地插入「@「标题」」内联 token，标题用全角括号定界（可含空格）
      const session = item.session;
      const token = `@「${session.title}」 `;
      const start = nativeStart;
      const end = nativeEnd;
      sessionTokenIdsRef.current.set(session.title, session.id);
      setComposer(composer.slice(0, start) + token + composer.slice(end));
      setNotice(`已引用会话：${session.title}`);
      window.setTimeout(() => {
        const target = textareaRef.current;
        if (target) {
          const pos = start + token.length;
          target.focus();
          target.setSelectionRange(pos, pos);
        }
      }, 0);
    } else if (mentionMenu.kind === "slash" && item.skill) {
      // 技能引用：在 / 触发位置原地插入 /技能名 内联 token，前后正文保留（与 @文件 同一融合呈现）
      const skill = item.skill;
      const token = `/${skill.name} `;
      const start = nativeStart;
      const end = nativeEnd;
      setActiveSkills((current) => current.some((entry) => entry.id === skill.id) ? current : [...current, skill]);
      setComposer(composer.slice(0, start) + token + composer.slice(end));
      window.setTimeout(() => {
        const target = textareaRef.current;
        if (target) {
          const pos = start + token.length;
          target.focus();
          target.setSelectionRange(pos, pos);
        }
      }, 0);
    } else {
      // 防御：仅清掉触发文本
      setComposer(composer.slice(0, mentionMenu.start));
    }
    setMentionMenu(null);
    if (mentionMenu.kind === "slash") window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const chooseWorkspace = async () => {
    setAddMenuOpen(false);
    setError("");
    try {
      const result = window.dyworker
        ? await window.dyworker.chooseWorkspace()
        : { canceled: false, path: "/workspace/dyworker", entries: previewWorkspace };
      if (result.canceled || !result.path) {
        setNotice("已取消选择工作文件夹");
        return;
      }
      setWorkspacePath(result.path);
      setWorkspaceEntries(result.entries || []);
      setWorkspaceOpen(true);
      setNotice(`工作文件夹已选择：${displayWorkspace(result.path)}`);
      if (activeSession) updateSession(activeSession.id, (session) => ({ ...session, workspacePath: result.path! }));
    } catch (workspaceError) {
      setError(`无法打开工作文件夹：${workspaceError instanceof Error ? workspaceError.message : String(workspaceError)}`);
    }
  };

  const chooseAttachments = async () => {
    const owner = activeIdRef.current;
    setAddMenuOpen(false);
    setError("");
    try {
      const result = window.dyworker
        ? await window.dyworker.chooseAttachments(owner)
        : {
            canceled: false,
            attachments: [{
              name: "界面需求说明.md",
              path: "/preview/界面需求说明.md",
              size: 1840,
              mimeType: "text/markdown",
              isImage: false,
            }],
          };
      if (result.canceled || !result.attachments.length) {
        setNotice("未添加附件");
        return;
      }
      if (activeIdRef.current !== owner) {
        const draft = sessionDraftsRef.current[owner];
        if (draft) draft.attachments = [...draft.attachments, ...result.attachments].slice(0, 12);
        return;
      }
      setAttachments((current) => {
        const known = new Set(current.map((attachment) => attachment.path));
        return [...current, ...result.attachments.filter((attachment) => !known.has(attachment.path))].slice(0, 12);
      });
      setNotice(`已添加 ${result.attachments.length} 个附件`);
      textareaRef.current?.focus();
    } catch (attachmentError) {
      setError(`无法添加附件：${attachmentError instanceof Error ? attachmentError.message : String(attachmentError)}`);
    }
  };

  // 右侧面板快捷键（Codex 风格）：macOS 显示 ⌘/⌥/⌃，Windows/Linux 用 Ctrl/Alt 组合
  const isMacPlatform = platform === "darwin";
  const shortcutLabel = (mac: string, other: string) => (isMacPlatform ? mac : other);

  // 处理器经 ref 读取最新状态，effect 只在挂载时挂一次监听；
  // 此前无依赖数组，流式期间每个 token 都 remove+add 一次 window keydown
  const keydownHandlerRef = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  keydownHandlerRef.current = (event: globalThis.KeyboardEvent) => {
    const key = event.key.toLowerCase();
    const modOnly = (isMacPlatform ? event.metaKey : event.ctrlKey) && !event.shiftKey && !event.altKey;
    if (modOnly && key === "t") {
      event.preventDefault();
      setRightPanelOpen(true);
      // 新标签页：浏览器可以多开，不覆盖已打开的页面
      openBrowserTab();
    } else if (modOnly && key === "p") {
      event.preventDefault();
      setRightPanelOpen(true);
      openToolPanelTab("files");
    } else if (modOnly && key === "j") {
      event.preventDefault();
      toggleTerminal();
    } else if (event.ctrlKey && event.shiftKey && key === "g" && !event.metaKey && !event.altKey) {
      event.preventDefault();
      setRightPanelOpen(true);
      openToolPanelTab("review");
    } else if (key === "s" && event.altKey && (isMacPlatform ? event.metaKey : event.ctrlKey)) {
      event.preventDefault();
      setRightPanelOpen(true);
      openToolPanelTab("chat");
    }
  };
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => keydownHandlerRef.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeToolPanelTab = toolPanelTabs.find((tab) => tab.id === activeToolPanelTabId) || toolPanelTabs[0];
  const activeToolPanelKind = activeToolPanelTab?.kind || "browser";

  // ===== 内置浏览器：webview 生命周期 =====
  // 每个浏览器标签页常驻一个 webview，切换标签不销毁页面；导航/标题/图标/加载状态
  // 通过 webview 事件同步到标签页状态（对照 Codex 浏览器）。当前显示的 webview 上报给
  // 主进程，让助手的 browser__* 工具只作用于用户可见的页面。

  // 每次渲染刷新镜像：ref 回调与 webview 事件闭包里读最新值
  const activeToolPanelTabIdRef = useRef("");
  activeToolPanelTabIdRef.current = activeToolPanelTabId;
  const toolPanelTabsRef = useRef<ToolPanelTab[]>([]);
  toolPanelTabsRef.current = toolPanelTabs;
  // 助手要求关闭标签页时复用面板自己的关闭逻辑（面板 Tab 索引更新在下面统一处理）
  const closeToolPanelTabRef = useRef<((id: string) => void) | null>(null);

  // 浏览器标签页可以多开（对照真实浏览器）。开新页时的复用规则，按优先级：
  // 1. 网址已经在某个标签页里打开：切到那个标签页，不重复开同一页；
  // 2. 助手打开网页时还有没打开过网页的空标签页（起始页）：先用它，不堆叠空标签页；
  // 3. 其余情况新开一个标签页。用户按 ⌘T / 点 + 属于这一类：每次都新开一个
  //    （和真实浏览器一致），只有助手的打开才复用空白页。
  // 助手打开网页同样走这里：旧页面留在自己的标签页里，不会被新网址顶掉。
  const openBrowserTab = (initialUrl?: string, options: { reuseBlank?: boolean } = {}) => {
    const target = String(initialUrl || "").trim();
    const browserTabs = toolPanelTabsRef.current.filter((tab) => tab.kind === "browser");
    if (target) {
      const sameUrl = browserTabs.find((tab) => (tab.loadedUrl || tab.url || "") === target);
      if (sameUrl) {
        setRightPanelOpen(true);
        setActiveToolPanelTabId(sameUrl.id);
        setToolPanelMenuOpen(false);
        return sameUrl.id;
      }
    }
    const reuseBlank = options.reuseBlank === true;
    const blank = reuseBlank ? browserTabs.find((tab) => !tab.loadedUrl) : undefined;
    const id = blank?.id || `browser-${toolPanelTabSequenceRef.current++}`;
    setToolPanelTabs((current) => {
      if (blank && !target) {
        // 空标签页任务栏复用：保持原样，只切过去
        return current;
      }
      if (blank) {
        return current.map((tab) => tab.id === blank.id
          ? { ...tab, url: target, loadedUrl: target, title: browserTabTitleOf(target), loadError: "", favicon: "" }
          : tab);
      }
      const created: ToolPanelTab = target
        ? { id, kind: "browser", title: browserTabTitleOf(target), url: target, loadedUrl: target }
        : { id, kind: "browser", title: "新标签页", url: "" };
      return [...current, created];
    });
    setRightPanelOpen(true);
    setActiveToolPanelTabId(id);
    setToolPanelMenuOpen(false);
    return id;
  };

  // 助手指定的标签页切换：切到指定标签页（由主进程等待渲染端上报后接管控制）
  const activateBrowserTabById = (tabId: string) => {
    const tab = toolPanelTabsRef.current.find((item) => item.id === tabId && item.kind === "browser");
    if (!tab) return false;
    setRightPanelOpen(true);
    setActiveToolPanelTabId(tab.id);
    setToolPanelMenuOpen(false);
    return true;
  };

  // 助手指定的标签页关闭：复用关闭按钮那套（最后一个标签页关掉就回到菜单页）
  const closeBrowserTabById = (tabId: string) => {
    const closing = toolPanelTabsRef.current.find((item) => item.id === tabId && item.kind === "browser");
    if (!closing) return false;
    closeToolPanelTabRef.current?.(tabId);
    return true;
  };

  // 面板里的浏览器标签页清单上报主进程：助手的标签页工具据此列出、切换、关闭
  const reportBrowserTabState = () => {
    if (!window.dyworker?.reportBrowserTabs) return;
    const tabs = toolPanelTabsRef.current.filter((tab) => tab.kind === "browser").map((tab) => {
      let webContentsId = 0;
      try {
        webContentsId = browserWebviewsRef.current.get(tab.id)?.getWebContentsId?.() || 0;
      } catch {
        webContentsId = 0;
      }
      return {
        id: tab.id,
        title: tab.title || "",
        url: tab.loadedUrl || tab.url || "",
        active: tab.id === activeToolPanelTabIdRef.current,
        webContentsId,
      };
    });
    window.dyworker.reportBrowserTabs({ ownerSessionId: activeIdRef.current, tabs });
  };

  const patchBrowserTab = (tabId: string, patch: Partial<ToolPanelTab>) => {
    setToolPanelTabs((current) => current.map((tab) => tab.id === tabId ? { ...tab, ...patch } : tab));
  };

  const readWebviewNavState = (webview: BrowserWebviewElement) => ({
    url: webview.getURL?.() || "",
    canGoBack: webview.canGoBack?.() ?? false,
    canGoForward: webview.canGoForward?.() ?? false,
  });

  // 主进程路由 agent 浏览器工具的目标：当前激活标签页的 webview
  const reportActiveBrowserContents = () => {
    reportBrowserTabState();
    const webview = browserWebviewsRef.current.get(activeToolPanelTabIdRef.current);
    try {
      const id = webview?.getWebContentsId?.();
      if (id) window.dyworker?.setActiveBrowserContents?.(id, activeIdRef.current);
    } catch {
      // webview 尚未 attach：did-attach 后会再报一次
    }
  };

  // 首次访问站点时注入暂存的 localStorage（每个 URL 只注入一次，注入后刷新生效）；
  // 同时探测该站点是否有已保存的密码，用于显示填充提示
  const prepareGuestPage = (webview: BrowserWebviewElement, tabId: string) => {
    const handledUrls = new Set<string>();
    webview.addEventListener("dom-ready", () => {
      const url = webview.getURL?.() || "";
      if (!/^https?:\/\//i.test(url) || handledUrls.has(url)) return;
      handledUrls.add(url);
      let origin = "";
      try {
        origin = new URL(url).origin;
      } catch {
        return;
      }
      void (async () => {
        try {
          const entries = await window.dyworker?.getImportedLocalStorage?.(origin);
          if (entries) {
            await webview.executeJavaScript?.(
              `(() => { const data = ${JSON.stringify(entries)}; for (const [k, v] of Object.entries(data)) { try { localStorage.setItem(k, v); } catch { /* 单键失败不阻塞其余 */ } } })()`,
            );
            await window.dyworker?.markImportedLocalStorageDone?.(origin);
            webview.reload?.();
          }
        } catch {
          // 注入失败：保留暂存数据，下次访问该站点时重试
        }
        try {
          const stored = await window.dyworker?.listPasswords?.(origin);
          patchBrowserTab(tabId, { fillHint: stored?.passwords?.length || undefined });
        } catch {
          // 探测失败不影响页面
        }
      })();
    });
  };

  // 绑定单个 webview 的事件（ref 回调里调用；监听器随元素销毁，无需手动解绑）
  const bindBrowserWebview = (tabId: string, webview: BrowserWebviewElement) => {
    const navSync = () => patchBrowserTab(tabId, readWebviewNavState(webview));
    const rememberInHistory = () => {
      const url = webview.getURL?.() || "";
      if (!/^https?:\/\//i.test(url)) return;
      setBrowserSessionHistory((current) => {
        if (current[0]?.url === url) return current;
        const host = url.replace(/^https?:\/\//i, "").split("/")[0] || url;
        return [{ url, title: host, at: Date.now() }, ...current].slice(0, 100);
      });
    };
    webview.addEventListener("did-start-loading", () => patchBrowserTab(tabId, { loading: true, loadError: "" }));
    webview.addEventListener("did-stop-loading", () => patchBrowserTab(tabId, { loading: false, ...readWebviewNavState(webview) }));
    webview.addEventListener("did-navigate", () => { navSync(); rememberInHistory(); });
    webview.addEventListener("did-navigate-in-page", () => { navSync(); rememberInHistory(); });
    webview.addEventListener("page-title-updated", ((event: Event & { title: string }) => {
      const title = event.title || "";
      if (!title) return;
      patchBrowserTab(tabId, { title });
      const url = webview.getURL?.() || "";
      setBrowserSessionHistory((current) => current.map((entry, index) => index === 0 && entry.url === url ? { ...entry, title } : entry));
    }) as EventListener);
    webview.addEventListener("page-favicon-updated", ((event: Event & { favicons: string[] }) => {
      patchBrowserTab(tabId, { favicon: event.favicons?.[event.favicons.length - 1] || "" });
    }) as EventListener);
    webview.addEventListener("did-fail-load", ((event: Event & { errorCode: number; errorDescription: string; isMainFrame: boolean }) => {
      // ERR_ABORTED 是导航被打断（如重定向、手动停止），不算失败；子框架失败不影响整页
      if (event.errorCode === -3 || !event.isMainFrame) return;
      patchBrowserTab(tabId, {
        loading: false,
        loadError: `网页加载失败（${event.errorDescription || event.errorCode}）`,
      });
    }) as EventListener);
    webview.addEventListener("found-in-page", ((event: Event & { matches: number; activeMatchOrdinal: number }) => {
      setBrowserFind((current) => current && current.tabId === tabId
        ? { ...current, matches: event.matches ?? 0, active: event.activeMatchOrdinal ?? 0 }
        : current);
    }) as EventListener);
    webview.addEventListener("did-attach", () => {
      const zoom = toolPanelTabsRef.current.find((tab) => tab.id === tabId)?.zoom ?? 0;
      if (zoom) webview.setZoomLevel?.(zoom);
      if (tabId === activeToolPanelTabIdRef.current) reportActiveBrowserContents();
    });
    // 客页面报告的登录表单提交（webview-preload.cjs 经 sendToHost 发来）：弹出保存密码提示
    webview.addEventListener("ipc-message", ((event: Event & { channel: string; args: unknown[] }) => {
      if (event.channel !== "dyworker:password-submit") return;
      const payload = event.args?.[0] as { origin?: string; username?: string; password?: string } | undefined;
      if (!payload?.password) return;
      // origin 由客页面自行上报、可被恶意站点伪造：一律以 webview 当前实际 URL 的 origin 为准
      let actualOrigin = "";
      try {
        actualOrigin = new URL(webview.getURL?.() || "").origin;
      } catch {
        return;
      }
      if (!/^https?:\/\//i.test(actualOrigin)) return;
      setBrowserPasswordPrompt({ tabId, origin: actualOrigin, username: payload.username || "", password: payload.password });
    }) as EventListener);
    prepareGuestPage(webview, tabId);
  };

  // ref 回调按 tabId 缓存稳定身份，避免每次渲染触发挥挂/卸载
  const browserWebviewRefCallbacks = useRef<Map<string, (node: BrowserWebviewElement | null) => void>>(new Map());
  const browserWebviewRefFor = (tabId: string) => {
    let callback = browserWebviewRefCallbacks.current.get(tabId);
    if (!callback) {
      callback = (node: BrowserWebviewElement | null) => {
        const previous = browserWebviewsRef.current.get(tabId);
        if (previous === node) return;
        if (node) {
          browserWebviewsRef.current.set(tabId, node);
          bindBrowserWebview(tabId, node);
        } else {
          browserWebviewsRef.current.delete(tabId);
          if (activeToolPanelTabIdRef.current === tabId) window.dyworker?.setActiveBrowserContents?.(0, activeIdRef.current);
        }
      };
      browserWebviewRefCallbacks.current.set(tabId, callback);
    }
    return callback;
  };

  // 激活标签页或其 webview 变化后上报主进程：可见页（控制目标）+ 浏览器标签页清单
  useEffect(() => {
    reportBrowserTabState();
    if (activeToolPanelKind !== "browser") return;
    reportActiveBrowserContents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeToolPanelTabId, activeToolPanelKind, toolPanelTabs.map((tab) => tab.kind === "browser" ? `${tab.id}:${tab.loadedUrl || ""}` : tab.id).join("|")]);

  // 菜单页可见性派生：没有任何标签页时始终显示菜单页（即使全局 closeAll 把菜单状态关掉，
  // 比如拖动面板边框触发的外部点击关闭），避免出现空面板。
  // 再加一条：面板里只有插件登记的标签、而用户一个都没点过时，也留在菜单页——
  // 内置插件是开机异步登记的，否则 activeToolPanelTab 会回退到 tabs[0]，
  // 表现成「一打开右侧面板就是插件内容」（实测被用户抓到）。
  const pluginTabOnlyPendingChoice = !activeToolPanelTabId && toolPanelTabs.length > 0
    && toolPanelTabs.every((tab) => tab.kind === "plugin");
  const menuPageShown = toolPanelMenuOpen || toolPanelTabs.length === 0 || pluginTabOnlyPendingChoice;
  // 纯净菜单页:还没有任何标签页时,菜单页不显示标签栏和 + 按钮(对照 Codex)
  const pristineMenuPage = toolPanelTabs.length === 0;

  // 审阅面板数据:当前会话最近一轮的文件改动(对照 Codex 审阅页)
  const reviewChanges = useMemo(() => {
    const messages = activeSession?.messages || [];
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.role === "assistant" && message.changes?.length) return message.changes;
    }
    return [];
  }, [activeSession]);

  // 「查看更改」点开的具体那条消息的改动（非 Git 工作区时作为审阅面板的数据源）
  const [reviewFocusChanges, setReviewFocusChanges] = useState<FileChange[] | null>(null);
  useEffect(() => { setReviewFocusChanges(null); }, [activeId]);

  const activeBrowserUrl = activeToolPanelTab?.kind === "browser" ? activeToolPanelTab.url || "" : "";

  // 加载已导入的浏览记录（地址栏联想）；导入成功后由对话框回调刷新
  const refreshImportedHistory = () => {
    if (!window.dyworker?.listImportedHistory) return;
    void window.dyworker.listImportedHistory().then(setImportedHistory).catch(() => {});
  };
  useEffect(refreshImportedHistory, []);

  const updateToolPanelTab = (id: string, patch: Partial<ToolPanelTab>) => {
    setToolPanelTabs((current) => current.map((tab) => tab.id === id ? { ...tab, ...patch } : tab));
  };

  const focusToolPanelTab = (id: string) => {
    setActiveToolPanelTabId(id);
    setToolPanelMenuOpen(false);
  };

  // 内置插件（随应用分发、默认启用）的客户端半边开机自动加载——内置就该开机即用，
  // 不需要用户去插件页点"加载界面半边"。失败只记录，不影响启动。
  useEffect(() => {
    let cancelled = false;
    void loadEnabledClientHalves().then((results) => {
      if (cancelled) return;
      const failed = results.filter((result) => !result.ok);
      if (failed.length) console.warn("[plugin] 内置插件客户端半边加载失败：", failed);
    });
    return () => { cancelled = true; };
  }, []);

  // 客户端宿主取会话的数据来源：插件用 ctx.sessions.binding(id) 拿它渲染轨迹等视图
  useEffect(() => {
    clientHost().dshSettings.setSession(activeSession?.runtime === 'dsh' ? activeSession.id : '');
    clientHost().setSessionProvider((sessionId) =>
      sessions.find(session => String(session.id) === String(sessionId)));
    clientHost().setCollections(() => ({ items: sessions, current: activeSession }), () => ({
      items: [...new Set(sessions.map(session => session.workspacePath).filter(Boolean))].map(path => ({ id: path, path,
        title: String(path).split(/[\\/]/).filter(Boolean).at(-1) || String(path),
        sessionIds: sessions.filter(session => session.workspacePath === path).map(session => session.id) })),
      current: workspacePath ? { id: workspacePath, path: workspacePath } : null,
      archivedSessionIds: sessions.filter(session => session.archived).map(session => session.id),
    }));
  }, [activeSession, sessions, workspacePath]);

  useEffect(() => {
    const host=clientHost();
    void host.selectMainSession(activeSession?.runtime==='dsh'?activeSession.id:'').catch(error=>{
      console.warn('[plugin] 当前任务界面读取失败：',error);
    });
    return ()=>{void host.selectMainSession('').catch(()=>{});};
  }, [activeSession?.id, activeSession?.runtime]);

  // 异步登记只同步可用页面；关闭选择独立保存，不能被宿主刷新覆盖。
  useEffect(() => {
    const host = clientHost();
    const sync = () => {
      const contributions = host.contributionsFor("sidebar.right.pane.tab").filter(contribution =>
        activeSession?.runtime !== 'dsh' || contribution.pluginId !== 'dyworker-context');
      const available = availablePluginPanels(contributions);
      setPluginPanelChoices(available);
      setToolPanelTabs(current => pluginPanelPreferences.reconcile(current, available));
    };
    sync();
    return host.subscribe(sync);
  }, [ready, activeId, activeSession?.runtime, pluginPanelPreferences]);

  useEffect(() => {
    const host = clientHost();
    const sync = () => {
      const pages = host.contributionsFor("workspace.page");
      const qwenpaw = pages.some(item => item.pluginId === "qwenpaw" && item.meta.key === "qwenpaw");
      const available = qwenpaw || pages.some(item => item.pluginId === "ds-bot" && item.meta.key === "bot-team");
      setBotTeamProvider(qwenpaw ? "qwenpaw" : "ds-bot");
      setBotTeamAvailable(available);
      if (!available) setBotTeamPageOpen(false);
    };
    sync();
    return host.subscribe(sync);
  }, []);

  // 插件贡献的会话区视图：注册进 conversation.view 插槽的，每个成为会话区的一个标签页
  useEffect(() => {
    const host = clientHost();
    const sync = () => {
      setPluginConversationViews(host.contributionsFor("conversation.view").filter(contribution =>
        activeSession?.runtime !== 'dsh' || contribution.pluginId !== 'dyworker-context').map((contribution) => ({
        key: String(contribution.meta.key ?? contribution.meta.id ?? ""),
        label: typeof contribution.meta.label === "function"
          ? String((contribution.meta.label as () => unknown)())
          : String(contribution.meta.label ?? contribution.meta.id ?? "插件视图"),
      })).filter((view) => view.key));
    };
    sync();
    return host.subscribe(sync);
  }, [activeSession?.runtime]);

  // 切会话（含新建任务）时回到对话标签，避免停在上一个会话的插件视图上
  useEffect(() => { setConversationView("chat"); }, [activeId]);


  const openPluginPanel = useCallback((request: PluginPanelRequest) => {
    const panel = pluginPanelTab(request.pluginId, request.key, request.label);
    if (!pluginPanelPreferences.open(panel, request.open !== false)) return;
    if (request.open !== false) setRightPanelOpen(true);
    setToolPanelTabs(current => [...current.filter(tab => tab.kind !== "plugin"
      || tab.pluginKey !== panel.pluginKey || (tab.pluginId || "") !== panel.pluginId), panel]);
    if (request.open !== false) {
      setActiveToolPanelTabId(panel.id);
      setToolPanelMenuOpen(false);
    }
  }, [pluginPanelPreferences]);

  useEffect(() => onPluginPanelRequest(openPluginPanel), [openPluginPanel]);

  const openToolPanelTab = (kind: ToolPanelTab["kind"], createNew = false, initialUrl?: string) => {
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

  const openFilePreview = (filePath: string, root: string) => {
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
  const choosePreviewFile = async () => {
    try {
      const choice = await window.dyworker?.choosePreviewFile();
      if (choice && !choice.canceled && choice.path && choice.workspacePath) openFilePreview(choice.path, choice.workspacePath);
    } catch (error) { setError(`打开文件失败：${String(error)}`); }
  };
  const openFilePreviewRef = useRef(openFilePreview);
  openFilePreviewRef.current = openFilePreview;
  const pendingFilePreviews = useRef(new Map<string, Array<{ path: string; workspacePath: string }>>());
  useEffect(() => window.dyworker?.onFilePanelRequest?.(request => {
    if (!request.ownerSessionId) return;
    if (request.ownerSessionId !== activeIdRef.current) {
      const queued = pendingFilePreviews.current.get(request.ownerSessionId) || [];
      pendingFilePreviews.current.set(request.ownerSessionId, [...queued.filter(item => item.path !== request.path || item.workspacePath !== request.workspacePath), request].slice(-50));
      return;
    }
    openFilePreviewRef.current(request.path, request.workspacePath);
  }), []);
  useEffect(() => {
    if (!ready) return;
    const pending = pendingFilePreviews.current.get(activeId);
    if (pending) {
      pendingFilePreviews.current.delete(activeId);
      for (const request of pending) openFilePreviewRef.current(request.path, request.workspacePath);
    }
  }, [activeId, ready]);

  // 标签条两侧是否还有被藏起来的标签：滚动按钮与渐隐遮罩按这个状态出现。
  // 标签不多时保持原来的样子（整条空白区仍是窗口拖拽区）。
  const syncToolPanelTabOverflow = useCallback(() => {
    const strip = toolPanelTabStripRef.current;
    if (!strip) return;
    const maxScrollLeft = strip.scrollWidth - strip.clientWidth;
    const next = {
      start: strip.scrollLeft > 1,
      end: maxScrollLeft - strip.scrollLeft > 1,
    };
    setToolPanelTabOverflow((current) => (
      current.start === next.start && current.end === next.end ? current : next
    ));
  }, []);

  useEffect(() => {
    const strip = toolPanelTabStripRef.current;
    if (!strip) return;
    syncToolPanelTabOverflow();
    const observer = new ResizeObserver(() => syncToolPanelTabOverflow());
    observer.observe(strip);
    strip.addEventListener("scroll", syncToolPanelTabOverflow, { passive: true });
    return () => {
      observer.disconnect();
      strip.removeEventListener("scroll", syncToolPanelTabOverflow);
    };
  }, [syncToolPanelTabOverflow, rightPanelOpen, pristineMenuPage, toolPanelTabs.length]);

  // 标签多起来之后要能滚：Chromium 不会把鼠标竖向滚轮转成横向滚动，
  // 这里把滚轮位移交给标签条，滚到头就放行（外层其它滚动区不受影响）。
  useEffect(() => {
    const strip = toolPanelTabStripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const maxScrollLeft = strip.scrollWidth - strip.clientWidth;
      if (maxScrollLeft <= 0) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1;
      const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit;
      if (!delta) return;
      const next = Math.max(0, Math.min(maxScrollLeft, strip.scrollLeft + delta));
      if (next === strip.scrollLeft) return;
      strip.scrollLeft = next;
      event.preventDefault();
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, [rightPanelOpen, pristineMenuPage, toolPanelTabs.length]);

  // 标签条整体重排（新增/关闭标签、面板宽度变化、面板展开收起）后重新判断溢出
  useEffect(() => {
    syncToolPanelTabOverflow();
  }, [syncToolPanelTabOverflow, toolPanelTabs, appliedToolPanelWidth]);

  // 当前标签必须可见：切标签、开新标签、拖宽面板后都把它带进视野
  useEffect(() => {
    const strip = toolPanelTabStripRef.current;
    const tab = strip?.querySelector<HTMLElement>(`[data-tool-panel-tab-id="${activeToolPanelTabId}"]`);
    if (strip && tab) {
      const stripRect = strip.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      if (tabRect.left < stripRect.left) strip.scrollLeft -= stripRect.left - tabRect.left;
      else if (tabRect.right > stripRect.right) strip.scrollLeft += tabRect.right - stripRect.right;
      syncToolPanelTabOverflow();
    }
  }, [activeToolPanelTabId, rightPanelOpen, appliedToolPanelWidth, syncToolPanelTabOverflow]);

  const scrollToolPanelTabStrip = (direction: -1 | 1) => {
    const strip = toolPanelTabStripRef.current;
    if (!strip) return;
    const step = Math.max(180, Math.round(strip.clientWidth * 0.7));
    strip.scrollBy({ left: direction * step, behavior: "smooth" });
  };

  const closeToolPanelTab = (id: string) => {
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
  closeToolPanelTabRef.current = closeToolPanelTab;
  browserPanelCommandsRef.current = {
    open: (url: string, tabId?: string) => {
      const target = tabId
        ? toolPanelTabsRef.current.find((tab) => tab.id === tabId && tab.kind === "browser")
        : undefined;
      // 助手点名了某个标签页：在那个标签页里打开（不另开），否则按多开规则开新页
      if (target) {
        setRightPanelOpen(true);
        setToolPanelTabs((current) => current.map((tab) => tab.id === target.id
          ? { ...tab, url, loadedUrl: url, title: browserTabTitleOf(url), loadError: "", favicon: "" }
          : tab));
        setActiveToolPanelTabId(target.id);
        setToolPanelMenuOpen(false);
        return;
      }
      openBrowserTab(url, { reuseBlank: true });
    },
    activate: activateBrowserTabById,
    close: closeBrowserTabById,
  };

  const browserSuggestionQuery = (browserUrlDraft && browserUrlDraft.tabId === activeToolPanelTab?.id ? browserUrlDraft.value : activeToolPanelTab?.url || "").trim().toLowerCase();
  const browserSuggestions = useMemo(() => {
    const seen = new Set<string>();
    return [...browserSessionHistory, ...importedHistory].filter((entry) => {
      if (seen.has(entry.url)) return false;
      seen.add(entry.url);
      return !browserSuggestionQuery || `${entry.title} ${entry.url}`.toLowerCase().includes(browserSuggestionQuery);
    }).slice(0, 8);
  }, [browserSessionHistory, importedHistory, browserSuggestionQuery]);
  useEffect(() => { setBrowserSuggestionsOpen(false); setBrowserSuggestionIndex(-1); }, [activeToolPanelTabId]);

  const openBrowserUrl = async (rawOverride?: string) => {
    setBrowserSuggestionsOpen(false);
    const tab = activeToolPanelTab?.kind === "browser" ? activeToolPanelTab : undefined;
    const draft = tab && browserUrlDraft?.tabId === tab.id ? browserUrlDraft.value : "";
    const raw = (rawOverride ?? draft ?? activeBrowserUrl).trim();
    if (!tab) {
      openToolPanelTab("browser", true, rawOverride);
      return;
    }
    if (!raw) {
      setError("请输入网址");
      return;
    }
    const url = normalizeBrowserInput(raw);
    setBrowserUrlDraft(null);
    updateToolPanelTab(tab.id, { url, loadError: "" });
    setError("");
    setBrowserOpening(true);
    try {
      if (!window.dyworker?.openBrowser) {
        setNotice("当前预览环境没有连接浏览器窗口");
        return;
      }
      const result = await window.dyworker.openBrowser({ url, workspacePath });
      if (!result.ok) {
        setError(result.error || result.result || "网页打开失败");
        return;
      }
      const loadedUrl = result.url || url;
      const webview = browserWebviewsRef.current.get(tab.id);
      // 地址未变化时 src 属性不变、不会触发导航，手动刷新一次
      if (webview?.getURL?.() === loadedUrl) webview.reload?.();
      updateToolPanelTab(tab.id, {
        url: loadedUrl,
        loadedUrl,
        title: loadedUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "新标签页",
      });
    } catch (browserError) {
      setError(`网页打开失败：${browserError instanceof Error ? browserError.message : String(browserError)}`);
    } finally {
      setBrowserOpening(false);
    }
  };

  const activeBrowserWebview = () => browserWebviewsRef.current.get(activeToolPanelTabId);

  // ===== 页内查找 =====
  const openBrowserFind = () => {
    if (activeToolPanelKind !== "browser" || !activeToolPanelTab?.loadedUrl) return;
    setBrowserFind({ tabId: activeToolPanelTabId, text: browserFind?.tabId === activeToolPanelTabId ? browserFind.text : "", matches: 0, active: 0 });
  };
  const runBrowserFind = (forward: boolean, findNext: boolean) => {
    const webview = activeBrowserWebview();
    const text = browserFind?.text ?? "";
    if (!webview?.findInPage || !text) return;
    void webview.findInPage(text, { forward, findNext });
  };
  const closeBrowserFind = () => {
    if (browserFind?.tabId) browserWebviewsRef.current.get(browserFind.tabId)?.stopFindInPage?.("clearSelection");
    setBrowserFind(null);
  };

  // ===== 缩放（1.2 的幂次，与 Chromium 缩放步进一致）=====
  const browserZoomPercent = (tab: ToolPanelTab | undefined) => Math.round(100 * 1.2 ** (tab?.zoom ?? 0));
  const changeBrowserZoom = (delta: number) => {
    const tab = activeToolPanelTab;
    if (!tab || tab.kind !== "browser") return;
    const level = Math.min(8, Math.max(-5, (tab.zoom ?? 0) + delta));
    updateToolPanelTab(tab.id, { zoom: level });
    activeBrowserWebview()?.setZoomLevel?.(level);
  };
  const resetBrowserZoom = () => {
    const tab = activeToolPanelTab;
    if (!tab || tab.kind !== "browser") return;
    updateToolPanelTab(tab.id, { zoom: 0 });
    activeBrowserWebview()?.setZoomLevel?.(0);
  };

  // ===== 截图到剪贴板 =====
  const captureBrowserScreenshot = async () => {
    const webview = activeBrowserWebview();
    if (!webview?.capturePage) {
      setNotice("当前页面还不支持截取");
      return;
    }
    try {
      const image = await webview.capturePage();
      await copyImageToClipboard({ ok: true, dataUrl: image.toDataURL() });
      setNotice("已截取页面并复制到剪贴板");
    } catch (captureError) {
      setNotice(`截图失败：${captureError instanceof Error ? captureError.message : String(captureError)}`);
    }
  };

  // ===== 在系统默认浏览器打开 =====
  const openBrowserExternal = async () => {
    const url = activeToolPanelTab?.url;
    if (!url || !window.dyworker?.openBrowserExternal) {
      if (url) setNotice("当前预览环境无法调用系统浏览器");
      return;
    }
    const result = await window.dyworker.openBrowserExternal(url);
    if (!result?.ok) setNotice(result?.error || "系统浏览器打开失败");
  };

  const clearBrowserSessionHistory = () => {
    if (window.confirm("确定清空本次浏览历史吗？清空后无法恢复，已导入的历史记录不受影响。")) setBrowserSessionHistory([]);
  };

  // ===== 下载进度 =====
  useEffect(() => window.dyworker?.onBrowserDownloadProgress?.((record) => {
    setBrowserDownloads((current) => [record, ...current.filter((entry) => entry.id !== record.id)].slice(0, 20));
  }), []);
  const browserActiveDownloadCount = browserDownloads.filter((entry) => entry.state === "progressing" || entry.state === "interrupted").length;

  // ===== 浏览器 Computer Use 控制状态广播 =====
  useEffect(() => {
    window.dyworker?.getBrowserControlStatus?.().then((initial) => {
      if (initial) setBrowserControlState(initial);
    }).catch(() => {});
    const unsubscribe = window.dyworker?.onBrowserControlState?.((state) => {
      setBrowserControlState(state);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  // ===== 密码：保存提示 / 填充 =====
  const dismissBrowserPasswordPrompt = () => setBrowserPasswordPrompt(null);
  const saveBrowserPasswordPrompt = async () => {
    const prompt = browserPasswordPrompt;
    if (!prompt) return;
    dismissBrowserPasswordPrompt();
    if (!window.dyworker?.savePassword) {
      setNotice("当前预览环境无法保存密码");
      return;
    }
    const result = await window.dyworker.savePassword(prompt.origin, prompt.username, prompt.password);
    setNotice(result.ok ? "密码已保存，下次登录时可一键填充" : (result.error || "保存失败"));
  };
  const fillSavedPassword = async () => {
    const tab = activeToolPanelTab;
    const webview = activeBrowserWebview();
    if (!tab || !webview?.executeJavaScript) return;
    let origin = "";
    try {
      origin = new URL(webview.getURL?.() || "").origin;
    } catch {
      return;
    }
    const stored = await window.dyworker?.listPasswords?.(origin);
    const entry = stored?.passwords?.[0];
    if (!entry) return;
    const revealed = await window.dyworker?.revealPassword?.(entry.origin, entry.username);
    if (!revealed?.ok || !revealed.password) {
      setNotice(revealed?.error || "无法读取已保存的密码");
      return;
    }
    try {
      const result = await webview.executeJavaScript(browserPasswordFillScript(entry.username, revealed.password), true);
      setNotice(typeof result === "string" ? result : "已填充密码");
    } catch (fillError) {
      setNotice(`填充失败：${fillError instanceof Error ? fillError.message : String(fillError)}`);
    }
  };

  // ===== 打印 =====
  const printBrowserPage = () => activeBrowserWebview()?.print?.();

  // ===== 设备视图（手机/平板模拟）=====
  const applyBrowserDevice = async (tab: ToolPanelTab, device: { name: string; width: number; height: number } | null) => {
    const webview = browserWebviewsRef.current.get(tab.id);
    updateToolPanelTab(tab.id, { device: device ? { ...device } : undefined });
    if (!webview) return;
    try {
      if (!browserDefaultUserAgent && webview.getUserAgent) browserDefaultUserAgent = webview.getUserAgent();
      if (device && webview.setUserAgent) webview.setUserAgent(BROWSER_MOBILE_UA);
      else if (!device && browserDefaultUserAgent && webview.setUserAgent) webview.setUserAgent(browserDefaultUserAgent);
      await window.dyworker?.emulateDevice?.(webview.getWebContentsId?.() || 0, device ? device.width : 0, device ? device.height : 0);
    } catch {
      // 模拟失败时仅保留容器尺寸，页面照常显示
    }
  };
  const rotateBrowserDevice = () => {
    const tab = activeToolPanelTab;
    if (!tab?.device) return;
    void applyBrowserDevice(tab, { ...tab.device, width: tab.device.height, height: tab.device.width });
  };

  // ===== 清除浏览数据 =====
  const clearBrowserData = async () => {
    if (browserClearing || !Object.values(browserClearKinds).some(Boolean)) return;
    const selected = [browserClearKinds.cookies && "Cookie 和登录状态", browserClearKinds.cache && "缓存的图片和文件", browserClearKinds.siteData && "站点数据和网站设置"].filter(Boolean).join("、");
    if (!window.confirm(`确定清除${selected}吗？此操作无法撤销。${browserClearKinds.cookies || browserClearKinds.siteData ? "部分网站可能需要重新登录。" : ""}`)) return;
    if (!window.dyworker?.clearBrowserData) {
      setNotice("当前预览环境无法清除浏览数据");
      return;
    }
    setBrowserClearing(true);
    try {
    const result = await window.dyworker.clearBrowserData(browserClearKinds);
    if (!result.ok) {
      setNotice(result.error || "清除失败");
      return;
    }
    for (const webview of browserWebviewsRef.current.values()) webview.reload?.();
    setNotice("已清除所选的浏览数据");
    setBrowserSection(null);
    } catch { setNotice("清除失败，请重试"); } finally { setBrowserClearing(false); }
  };

  const finishRecording = async (recorder: MediaRecorder) => {
    const stream = microphoneStreamRef.current;
    microphoneStreamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
    recordingChunksRef.current = [];
    if (!blob.size) {
      setVoiceState("idle");
      setError("没有录到声音，请检查麦克风后重试");
      return;
    }
    setVoiceState("transcribing");
    setNotice("正在把录音转换成文字");
    try {
      if (!window.dyworker) {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        applyVoiceText("请根据当前工作文件夹整理一份工作摘要。");
      } else {
        // 本地引擎只认 WAV：webm 录音先解码重采样成 16k 单声道；云端直接发原始格式
        const engineLocal = settings.transcriptionEngine === "local";
        const audio = engineLocal
          ? await blobToWavMono(blob, 16000)
          : new Uint8Array(await blob.arrayBuffer());
        const result = await window.dyworker.transcribeAudio({
          settings,
          audio: Array.from(audio),
          mimeType: engineLocal ? "audio/wav" : blob.type || "audio/webm",
        });
        applyVoiceText(result.text);
      }
      setNotice("语音已转换为文字");
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    } catch (voiceError) {
      setError(voiceError instanceof Error ? voiceError.message : String(voiceError));
    } finally {
      recorderRef.current = null;
      setVoiceState("idle");
    }
  };

  // 转写结果按目标分发：默认写进 composer，评论卡录音时由 voiceTargetRef 指向评论 setter
  const applyVoiceText = (text: string) => {
    const target = voiceTargetRef.current;
    voiceTargetRef.current = "composer";
    if (target === "composer") {
      setComposer((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}${text}`);
    } else {
      target(text);
    }
  };

  const toggleVoiceInput = async () => {
    setError("");
    if (voiceState === "transcribing") return;
    if (voiceState === "recording") {
      recorderRef.current?.stop();
      return;
    }
    if (!window.dyworker) {
      setVoiceState("transcribing");
      setNotice("正在把录音转换成文字");
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      applyVoiceText("请根据当前工作文件夹整理一份工作摘要。");
      setVoiceState("idle");
      setNotice("语音已转换为文字");
      return;
    }
    // 本地引擎不需要云端密钥与转写地址；模型没下载时由主进程转写报错提示
    if (settings.transcriptionEngine !== "local"
      && (!settings.apiKey || (!settings.transcriptionEndpoint && !settings.endpoint))) {
      setError("请先在设置中配置模型密钥和语音转写服务");
      setSettingsOpen(true);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("当前系统没有提供可用的录音能力");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      microphoneStreamRef.current = stream;
      recorderRef.current = recorder;
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => void finishRecording(recorder);
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        setVoiceState("idle");
        setError("录音中断，请检查麦克风权限后重试");
      };
      recorder.start(250);
      setVoiceState("recording");
      setNotice("正在录音，再次点击麦克风即可结束");
    } catch (voiceError) {
      setError(`无法使用麦克风：${voiceError instanceof Error ? voiceError.message : String(voiceError)}`);
    }
  };

  const refreshWorkspace = async () => {
    if (!window.dyworker || !workspacePath) return;
    setWorkspaceEntries(await window.dyworker.refreshWorkspace(workspacePath));
  };

  const goalActionsRef = useRef(new Set<string>());
  const handleGoalAction = async (sessionId: string, action: 'pause' | 'resume' | 'remove' | 'complete') => {
    const session = sessionsRef.current.find(row => row.id === sessionId);
    if (!session?.goal || goalActionsRef.current.has(sessionId)) return;
    if (session.goalState?.status === 'complete' && action !== 'remove') return;
    goalActionsRef.current.add(sessionId);
    try {
      if (action === 'resume') {
        if (runningSessionIds.has(sessionId) || runningRunIdsRef.current.has(sessionId)) {
          showSessionNotice(sessionId, '当前任务结束后可继续目标。');
          return;
        }
        void sendMessage(`继续推进目标：${session.goal}\n先核对已有进展，完成剩余工作并验证结果。`, sessionId, undefined, undefined, true);
        return;
      }
      const next = action === 'remove' ? { ...session, goal: undefined, goalState: undefined }
        : changeGoalStatus(session, action === 'pause' ? 'paused' : 'complete');
      // Persist before cancellation drains the queue, so queued work cannot revive an old goal.
      const updated = sessionsRef.current.map(row => row.id === sessionId ? next : row);
      sessionsRef.current = updated;
      setSessions(updated);
      let saveError = "";
      if (window.dyworker?.saveSessions) {
        const saved = await window.dyworker.saveSessions({ changed: [next], removed: [], order: updated.map(row => row.id),
          activeId: activeIdRef.current, meta: updated.map(row => ({ id: row.id, channel: row.channel, workspacePath: row.workspacePath })) }).catch(error => ({ ok: false, error: String(error) }));
        if (!saved.ok) saveError = saved.error || '目标状态保存失败';
      }
      const runId = runningRunIdsRef.current.get(sessionId);
      if (activeGoal(session) && runId) await window.dyworker?.cancelTask(sessionId, runId);
      if (activeGoal(session) && sleepingSessions[sessionId]) await cancelSleepingTask(sessionId);
      if (saveError) throw new Error(saveError);
      showSessionNotice(sessionId, action === 'pause' ? '目标已暂停' : action === 'remove' ? '目标已删除' : '目标已标记完成');
    } catch (error) {
      showSessionError(sessionId, error instanceof Error ? error.message : '目标操作失败');
    } finally { goalActionsRef.current.delete(sessionId); }
  };

  const sendMessage = async (overridePrompt?: string, overrideSessionId?: string, overrideRunId?: string,
    pluginSubmission?: import('./pluginRuntime/conversation').ConversationSubmission, resumeGoal = false) => {
    if (pluginSubmission) {
      pluginSubmission.signal.throwIfAborted();
      const owned = sessions.find(session => session.id === pluginSubmission.sessionId);
      if (!owned || owned.runtime !== 'dsh') throw new Error('插件会话已关闭，输入未发送');
      if (!settings.identity) throw new Error('请先选择 DYWorker 的使用身份');
      if (!window.dyworker?.sendTask) throw new Error('当前应用没有真实任务发送入口');
      if (!owned.workspacePath) throw new Error('插件会话需要选择工作文件夹');
      if (sleepingSessions[owned.id]) throw new Error('此任务正在等待唤醒，输入已保留');
      if (!pluginSubmission.text.trim() && !pluginSubmission.attachments.length) throw new Error('消息和附件均为空');
    }
    let dshDraft: Awaited<ReturnType<ReturnType<typeof clientHost>['serializeInputDraft']>>;
    if (overridePrompt === undefined && activeSession?.runtime === 'dsh') {
      try {
        if (!clientHost().inputReady(activeSession.id)) throw new Error('引用编辑器正在准备，请稍后重试');
        const scopedInput = clientHost().sessionInput((clientHost().ctx as any).sessions.scope(activeSession.id));
        if (scopedInput.state.getSnapshot().attachmentIds.length) {
          scopedInput.submit('queue', 'enter'); return;
        }
        clientHost().setInputDraft(activeSession.id, composer);
        const owner = activeSession.id; const selected = attachments;
        const current = () => activeIdRef.current === owner && attachmentsRef.current === selected;
        if (await clientHost().matchInputEnter(owner, composer.trim(), {
          count: selected.length, current,
          async serialize(signal) {
            signal.throwIfAborted();
            if (!window.dyworker?.serializeCommandAttachments) throw new Error('当前应用不能传递插件命令附件');
            if (selected.some(file => !file.commandGrantId)) throw new Error('附件需要重新选择后才能交给插件命令');
            const result = await window.dyworker.serializeCommandAttachments({ sessionId: owner, grantIds: selected.map(file => file.commandGrantId!) });
            signal.throwIfAborted();
            if (!result.ok || !result.attachments) throw new Error(result.error || '附件保存失败');
            return result.attachments;
          },
          consume() { if (selected.length && current()) setAttachments([]); },
        }, setNotice)) { setMentionMenu(null); return; }
        dshDraft = await clientHost().serializeInputDraft(activeSession.id);
      } catch (error) { showSessionError(activeSession.id, String((error as any)?.message || error)); return; }
    }
    if (!settings.identity) {
      setNotice("请先选择 DYWorker 的使用身份");
      return;
    }
    const isOverride = typeof overridePrompt === "string";
    const targetSession = overrideSessionId
      ? sessionsRef.current.find((session) => session.id === overrideSessionId) || (pluginSubmission ? undefined : activeSession)
      : activeSession;
    if (!targetSession) return;

    let content = isOverride ? overridePrompt.trim() : (dshDraft?.clipboardText ?? composer).trim();
    const clipboardLeading = (dshDraft?.clipboardText ?? composer).length - (dshDraft?.clipboardText ?? composer).trimStart().length;
    const isPluginReference = (at: number) => dshDraft?.references.some(ref => at + clipboardLeading >= ref.offset && at + clipboardLeading < ref.offset + ref.length);
    if (!isOverride && (!content && !attachments.length && !activeSkills.length && !composerPastes.length && !annotations.length)) return;
    const goalCommand = !isOverride ? content.match(/^\/goal(?:\s+([\s\S]*))?$/i) : null;
    if (goalCommand) {
      const argument = (goalCommand[1] || '').trim();
      const action = ({ '暂停': 'pause', pause: 'pause', '继续': 'resume', resume: 'resume', '取消': 'remove', '清除': 'remove', clear: 'remove', '完成': 'complete' } as const)[argument.toLowerCase() as 'pause'];
      if (!argument || action) {
        setComposer('');
        setMentionMenu(null);
        if (!argument) setNotice(targetSession.goal ? `当前目标：${targetSession.goal}（可在目标栏暂停、继续或删除）` : '用法：/goal 目标描述');
        else await handleGoalAction(targetSession.id, action);
        return;
      }
      if (targetSession.goal && targetSession.goalState?.status !== 'complete') {
        setNotice('当前还有未完成的目标，请先完成或删除，再创建新目标。');
        return;
      }
    }
    const queueSupported = Boolean(window.dyworker?.sendTask);
    // 任务运行期间仍允许发送：桌面版进入消息队列，等当前任务结束后自动执行
    if (activeTaskRunning && !queueSupported) return;
    // 挂起等待唤醒期间不接收新消息：否则本会话会立刻起第二轮 run，而到点的自动续跑
    // 随后又把老任务的结果追进来，同一个回复框里就出现两个线程（正文互相穿插）
    const targetSleeping = sleepingSessions[targetSession.id];
    if (targetSleeping) {
      setNotice(`${formatWakeTime(targetSleeping.wakeAt)} 将自动唤醒继续；可点输入框上方的「立即继续」提前续跑，或「取消唤醒」后再发送`);
      return;
    }
    const editingTarget = !isOverride && editingMessage?.sessionId === targetSession.id
      ? targetSession.messages[editingMessage.messageIndex]
      : null;
    // 排队中的消息允许编辑：保留原 runId，主进程开始执行时按 runId 取会话里最新内容
    const editingQueuedRunId = editingTarget?.runId && queuedRunIds.has(editingTarget.runId)
      ? editingTarget.runId
      : undefined;

    let goalDriven = false;
    let pastedBlocks = composerPastes;
    let messageAnnotations = annotations;
    let annotationText = "";
    let pastedText = "";
    let selectedAttachments: Attachment[] = [];
    let selectedSkills = activeSkills;
    // @「标题」引用的历史会话：解析出的引用与模型可见的摘要块
    let sessionRefs: Array<{ id: string; title: string }> = [];
    let sessionText = "";

    if (!isOverride) {
      // /new：开启全新会话（对齐渠道快捷指令与斜杠菜单）
      const isPureNewSession = /^(?:\/new|\/reset|new|reset|新建会话|新会话|新任务|重置会话|重置对话|清空上下文)[。.!！?？\s]*$/i.test(content);
      if (isPureNewSession) {
        setComposer("");
        setAttachments([]);
        setActiveSkills([]);
        setComposerPastes([]);
        setAnnotations([]);
        if (targetSession.messages.length === 0) {
          setNotice("当前已是新会话");
          window.setTimeout(() => textareaRef.current?.focus(), 0);
        } else {
          createTask();
          setNotice("已开启新会话");
        }
        return;
      }
      if (goalCommand) {
        content = goalCommand[1].trim();
        goalDriven = true;
      }
      setError("");
      setComposer("");
      setComposerPastes([]);
      setExpandedPasteId("");
      setAnnotations([]);
      setAnnotationListOpen(false);
      annotationText = formatAnnotationsForPrompt(messageAnnotations);
      pastedText = pastedBlocks.length
        ? `\n\n${pastedBlocks.map((block, index) => `【粘贴的长文本 ${index + 1}｜共 ${block.text.length} 字】\n${block.text}`).join("\n\n")}`
        : "";
      const tokenAttachments: Attachment[] = [];
      const seenTokenPaths = new Set<string>();
      FILE_TOKEN_REGEX.lastIndex = 0;
      let tokenMatch: RegExpExecArray | null;
      while ((tokenMatch = FILE_TOKEN_REGEX.exec(content))) {
        if (isPluginReference(tokenMatch.index)) continue;
        const file = resolveTokenFile(tokenMatch[1]);
        if (file && !seenTokenPaths.has(file.path)) {
          seenTokenPaths.add(file.path);
          tokenAttachments.push({ ...workspaceFileAttachment(file), inlineRef: true });
        }
      }
      mentionTokenPathsRef.current.clear();
      // @「标题」会话引用：解析出被引会话，尾部摘要块随消息正文发给模型；
      // 气泡按 sessionRefs 高亮 token 并支持点击跳转，完整上下文由模型按 id 自取
      const resolvedSessionRefs: Array<{ id: string; title: string }> = [];
      const sessionBlocks: string[] = [];
      const seenSessionIds = new Set<string>();
      SESSION_TOKEN_REGEX.lastIndex = 0;
      let sessionMatch: RegExpExecArray | null;
      while ((sessionMatch = SESSION_TOKEN_REGEX.exec(content))) {
        if (isPluginReference(sessionMatch.index)) continue;
        const session = resolveTokenSession(sessionMatch[1]);
        if (session && !seenSessionIds.has(session.id)) {
          seenSessionIds.add(session.id);
          resolvedSessionRefs.push({ id: session.id, title: session.title });
          sessionBlocks.push(formatSessionReference(session));
        }
      }
      sessionRefs = resolvedSessionRefs;
      sessionText = sessionBlocks.length ? `\n\n${sessionBlocks.join("\n\n")}` : "";
      sessionTokenIdsRef.current.clear();
      selectedAttachments = [
        ...tokenAttachments,
        ...attachments.filter((attachment) => !seenTokenPaths.has(attachment.path)),
      ];
      setAttachments([]);
      setActiveSkills([]);
      setMentionMenu(null);
    } else {
      pastedBlocks = [];
      messageAnnotations = [];
      selectedAttachments = [];
      selectedSkills = [];
    }

    const taskSessionId = targetSession.id;
    const taskRunId = overrideRunId || crypto.randomUUID();
    const cancelPluginInput = () => { void window.dyworker?.cancelTask(targetSession.id, taskRunId); };
    if (pluginSubmission) { pluginSubmission.signal.throwIfAborted(); pluginSubmission.signal.addEventListener('abort', cancelPluginInput, {once:true}); }
    let queuedResponse = false;
    const messageRunId = editingQueuedRunId || overrideRunId || taskRunId;
    const targetTaskRunning = Boolean(targetSession.id && runningSessionIds.has(targetSession.id));
    const isQueuedEdit = Boolean(editingQueuedRunId);
    const queuedNow = isQueuedEdit || (!editingTarget && targetTaskRunning && queueSupported);
    if (!queueSupported) runningRunIdsRef.current.set(taskSessionId, taskRunId);
    clearSessionError(taskSessionId);
    clearSessionNotice(taskSessionId);
    setRunningSessionIds((current) => {
      const next = new Set(current);
      next.add(taskSessionId);
      return next;
    });
    if (!isQueuedEdit) setRunningStartedAt((current) => ({ ...current, [taskSessionId]: Date.now() }));
    shouldScrollToBottomRef.current = taskSessionId;
    const skillsBlock = selectedSkills.length
      ? `请按照以下技能执行：\n${selectedSkills.map((skill) => {
          const location = skill.path ? `\n技能目录:${pathDirname(skill.path)}(入口文件:${skill.path})` : "";
          return `【${skill.name}】${skill.description}${location}\n执行要求:${skill.instructions}`;
        }).join("\n\n")}\n\n以下是我的任务:\n`
      : "";
    const typedContent = content;
    const modelContent = dshDraft?.references.length ? dshDraft.text : typedContent || (selectedSkills.length ? "（按模板处理当前工作区）" : pastedBlocks.length ? "请处理这段粘贴的长文本。" : messageAnnotations.length ? "请处理以下引用注释。" : "请处理这些附件。");
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      runId: messageRunId,
      content: skillsBlock + modelContent + pastedText + annotationText + sessionText,
      ...(typedContent !== modelContent || selectedSkills.length || pastedBlocks.length || messageAnnotations.length || sessionRefs.length || dshDraft?.references.length ? {
        displayContent: dshDraft?.references.length ? dshDraft.clipboardText : typedContent,
        ...(selectedSkills.length ? { skillsUsed: selectedSkills.map((skill) => skill.name) } : {}),
      } : {}),
      ...(pastedBlocks.length ? { pasteBlocks: pastedBlocks.map((block, index) => ({ id: `paste-${index}`, text: block.text })) } : {}),
      ...(messageAnnotations.length ? { annotations: messageAnnotations } : {}),
      ...(sessionRefs.length ? { sessionRefs } : {}),
      ...(dshDraft?.references.length ? { pluginReferences: dshDraft.references } : {}),
      ...(pluginSubmission?.presentation?.references.length ? {
        displayContent: pluginSubmission.presentation.text, pluginReferences: pluginSubmission.presentation.references,
      } : {}),
      attachments: selectedAttachments,
      ...(pluginSubmission?.attachments.length ? {dshAttachments:[...pluginSubmission.attachments] as ChatMessage['dshAttachments']} : {}),
      ...(pluginSubmission?.attachmentNames?.length ? {dshAttachmentNames:[...pluginSubmission.attachmentNames]} : {}),
      createdAt: new Date().toISOString(),
    };
    const baseMessages = editingTarget && editingMessage
      ? activeSession.messages.slice(0, editingMessage.messageIndex)
      : targetSession.messages;
    const editingQueuedAssistant = isQueuedEdit && editingTarget && editingMessage
      ? targetSession.messages[editingMessage.messageIndex + 1]
      : null;
    const updatedSession: SessionRecord = {
      ...targetSession,
      ...(goalDriven ? startGoal(content) : (resumeGoal || targetSession.goalState?.status === "blocked") ? { goalState: { ...changeGoalStatus(targetSession, "active").goalState!, id: crypto.randomUUID() } } : {}),
      ...(editingTarget ? { workingContext: undefined } : {}),
      title: baseMessages.length === 0 ? shortTitle(content || (pastedBlocks.length ? "粘贴的长文本" : "")) : targetSession.title,
      workspacePath: pluginSubmission ? targetSession.workspacePath : workspacePath || targetSession.workspacePath || "",
      updatedAt: new Date().toISOString(),
      messages: [
        ...baseMessages,
        message,
        ...(editingQueuedAssistant?.role === "assistant" ? [editingQueuedAssistant] : []),
      ],
    };
    setEditingMessage(null);
    // 首条有效消息提交时，才把页面草稿提升为真实会话；在异步发送前同步快照。
    const submittedSessions = sessionsRef.current.some(session => session.id === targetSession.id)
      ? sessionsRef.current.map(session => session.id === targetSession.id ? updatedSession : session)
      : [updatedSession, ...sessionsRef.current];
    sessionsRef.current = submittedSessions;
    setSessions(current => current.some(session => session.id === targetSession.id)
      ? current.map(session => session.id === targetSession.id ? updatedSession : session)
      : [updatedSession, ...current]);
    setNewTaskDraft(current => current?.id === targetSession.id ? null : current);

    if (isQueuedEdit) {
      setNotice("排队中的消息已更新，将在当前任务结束后按新内容执行");
      return;
    }

    let requestAssistantId: string | undefined;
    try {
      if (window.dyworker?.sendTask) {
        const assistantId = crypto.randomUUID();
        requestAssistantId = assistantId;
        let activeDshTurnId: string | undefined;
        const taskStartedAt = Date.now();
        const patchAssistant = (updater: (current: ChatMessage) => ChatMessage) => {
          const turnId = activeDshTurnId;
          updateSession(targetSession.id, (session) => ({
            ...session,
            messages: patchDshAssistant(session.messages,{assistantId,runId:messageRunId,turnId},updater),
          }));
        };
        updateSession(targetSession.id, (session) => ({
          ...session,
          messages: [...session.messages, {
            id: assistantId,
            role: "assistant",
            content: "",
            createdAt: new Date().toISOString(),
            activities: [],
            runId: messageRunId,
            taskStatus: queuedNow ? "queued" : undefined,
          }],
        }));
        const applyAgentResult = (result: AgentResult) => {
          patchAssistant((current) => {
            let content = result.finalText || current.content;
            if (result.status === "paused" && result.reason) {
              content = content ? `${content}\n\n**已暂停**：${result.reason}` : `**已暂停**：${result.reason}`;
            } else if (result.status === "sleeping" && result.wake) {
              const sleepNote = `**已主动挂起**：将于 ${formatWakeTime(result.wake.wakeAt)} 自动唤醒继续（原因：${result.wake.reason}）。期间可以关闭应用，到点会照常继续。`;
              content = content ? `${content}\n\n${sleepNote}` : sleepNote;
            } else if (result.status === "cancelled") {
              content = content ? `${content}\n\n已按你的要求停止。` : "已按你的要求停止。";
            } else if (result.status === "error") {
              content = [content,result.reason].filter(Boolean).join("\n\n") || "任务执行出错";
            }
            const plan = result.plan?.length ? result.plan : current.plan;
            return {
              ...current,
              content,
              // 占位气泡创建于消息提交时；这里在任务收尾打点，让气泡时间显示模型回复时间
              createdAt: new Date().toISOString(),
              changes: result.changes?.length ? result.changes : current.changes,
              plan,
              durationMs: Date.now() - taskStartedAt,
              taskStatus: result.status,
              ...(Array.isArray(result.executedMessages) && result.executedMessages.length
                ? { executedMessages: result.executedMessages }
                : {}),
              ...(result.workingContext !== undefined ? { workingContext: result.workingContext } : {}),
            };
          });
          if (result.dshTurns?.length && updatedSession.messages.at(-1)?.id) {
            updateSession(targetSession.id, session => ({...session,messages:reconcileDshTurns(session.messages,result.dshTurns!,{
              userId:updatedSession.messages.at(-1)!.id!,assistantId,runId:messageRunId,
            })}));
          }
          if (result.workingContext !== undefined) {
            updateSession(targetSession.id, (session) => ({ ...session, workingContext: result.workingContext }));
          }
          // 非当前会话在后台完成时标记未读（列表小绿点），点开会话即清除
          if ((result.status === "done" || result.status === "error") && taskSessionId !== activeIdRef.current) {
            updateSession(taskSessionId, (session) => ({ ...session, unread: true }));
          }
          if (result.status === "done" && !result.demo) {
            playCompletionSound();
            showSessionNotice(taskSessionId, "任务已完成");
          } else if (result.status === "sleeping" && result.wake) {
            showSessionNotice(taskSessionId, `已挂起，将于 ${formatWakeTime(result.wake.wakeAt)} 自动唤醒继续`);
            // 挂起态以主进程登记为准（这里先给即时反馈，重启后的权威列表由 wakes:list-pending 拉取）
            setSleepingSessions((current) => ({
              ...current,
              [taskSessionId]: {
                sessionId: taskSessionId,
                wakeAt: result.wake!.wakeAt,
                reason: result.wake!.reason || "",
              },
            }));
            // 再回主进程核对一次：没有工作目录等情况下登记会被跳过（到点根本不会唤醒），
            // 只信本地标记会把输入框永久锁死，所以以磁盘上的 pending 列表为准自纠正
            void refreshPendingWakes();
          }
          updateSession(taskSessionId, (session) => settleGoal(session, updatedSession, result));
          if (result.status === 'done' && result.goalAchieved && activeGoal(sessionsRef.current.find(row => row.id === taskSessionId) || updatedSession)) {
            showSessionNotice(taskSessionId, "目标已完成");
          }
        };
        let finishedEventSeen = false;
        // 收尾结果只应用一次：agent-finished 事件与 sendTask 的返回值是两条通道，
        // 谁先到不保证；两边都应用会让"已按你的要求停止。"之类追加重叠出现两遍。
        let agentResultApplied = false;
        const applyAgentResultOnce = (result: AgentResult) => {
          if (agentResultApplied) return;
          agentResultApplied = true;
          applyAgentResult(result);
        };
        const unsubscribeAgent = window.dyworker.onAgentEvent((sessionAgentEvent) => {
          if (sessionAgentEvent.sessionId !== taskSessionId || sessionAgentEvent.runId !== taskRunId) return;
          const agentEvent = sessionAgentEvent.event;
          if (agentEvent.type === "dsh-conversation" && updatedSession.messages.at(-1)?.id) {
            activeDshTurnId = agentEvent.turns.at(-1)?.user.id;
            updateSession(targetSession.id, session => ({...session,messages:reconcileDshTurns(session.messages,agentEvent.turns,{
              userId:updatedSession.messages.at(-1)!.id!,assistantId,runId:messageRunId,live:true,
            })}));
          } else if (agentEvent.type === "activity") {
            // 子代理分支活动（带 branch）挂到父活动（dispatch_agent）的 children 上，
            // 随 message.activities 落盘；不再走单独的全局缓存（会跨会话串数据）
            if (agentEvent.activity.branch) {
              patchAssistant((current) => {
                const { list, attached } = appendBranchActivity(current.activities || [], agentEvent.activity);
                if (!attached) {
                  console.warn("子代理分支活动找不到父活动，已丢弃", agentEvent.activity.id);
                  return current;
                }
                return { ...current, activities: list };
              });
            } else {
              patchAssistant((current) => ({ ...current, activities: [...(current.activities || []), agentEvent.activity] }));
            }
          } else if (agentEvent.type === "activity-update") {
            // patchActivityTree 同时覆盖主活动与子代理 children，branch 标记无需区分
            patchAssistant((current) => ({
              ...current,
              activities: patchActivityTree(current.activities || [], agentEvent.id, agentEvent.status, agentEvent.detail, agentEvent.durationMs, agentEvent.commentary),
            }));
          } else if (agentEvent.type === "trace") {
            appendSessionTraces([agentEvent.trace]);
          } else if (agentEvent.type === "assistant-text" && !activeDshTurnId) {
            patchAssistant((current) => ({ ...current, content: agentEvent.text }));
          } else if (agentEvent.type === "assistant-reasoning" && !activeDshTurnId) {
            patchAssistant((current) => applyReasoningStream(current, agentEvent.text));
          } else if (agentEvent.type === "file-change") {
            patchAssistant((current) => ({ ...current, changes: agentEvent.changes }));
          } else if (agentEvent.type === "plan-update") {
            patchAssistant((current) => ({ ...current, plan: agentEvent.steps }));
          } else if (agentEvent.type === "approval-request") {
            setPendingApprovals((current) => ({ ...current, [taskSessionId]: agentEvent.action }));
          } else if (agentEvent.type === "approval-withdrawn") {
            setPendingApprovals(current => {
              if (current[taskSessionId]?.id !== agentEvent.actionId) return current;
              const next = { ...current }; delete next[taskSessionId]; return next;
            });
          } else if (agentEvent.type === "ask-user") {
            setPendingQuestions((current) => ({ ...current, [taskSessionId]: agentEvent.request }));
          } else if (agentEvent.type === "loop-state") {
            setLoopStates((current) => {
              const next = { ...current };
              if (agentEvent.active) {
                next[taskSessionId] = { iteration: agentEvent.iteration, maximum: agentEvent.maximum, status: agentEvent.status };
              } else {
                delete next[taskSessionId];
              }
              return next;
            });
          } else if (agentEvent.type === "queued") {
            markQueued(taskSessionId, taskRunId);
            setRunningSessionIds((current) => {
              const next = new Set(current);
              next.add(taskSessionId);
              return next;
            });
          } else if (agentEvent.type === "queue-start") {
            unmarkQueued(taskSessionId, taskRunId);
            runningRunIdsRef.current.set(taskSessionId, taskRunId);
            setRunningSessionIds((current) => {
              const next = new Set(current);
              next.add(taskSessionId);
              return next;
            });
            setRunningStartedAt((current) => ({ ...current, [taskSessionId]: Date.now() }));
            patchAssistant((current) => ({ ...current, taskStatus: undefined }));
          } else if (agentEvent.type === "memory-saved") {
            void refreshMemories();
            showSessionNotice(taskSessionId, "已保存一条长期记忆");
          } else if (agentEvent.type === "skill-saved") {
            void refreshSkills();
            showSessionNotice(taskSessionId, `工作模板「${agentEvent.item.name}」已保存`);
          } else if (agentEvent.type === "skill-updated") {
            void refreshSkills();
            showSessionNotice(taskSessionId, `工作模板「${agentEvent.item.name}」已改进`);
          } else if (agentEvent.type === "debug-log") {
            queueDebugLog(agentEvent.entry);
          } else if (agentEvent.type === "context-usage") {
            const total = agentEvent.total ?? agentEvent.used + agentEvent.completion;
            updateSession(updatedSession.id, (session) => ({
              ...session,
              contextTokens: total,
              contextTokensExact: !agentEvent.estimated,
              contextModel: settings.model,
              contextEndpoint: settings.endpoint,
            }));
          } else if (agentEvent.type === "token-usage") {
            // 会话累计用量：每次模型调用按服务端 usage（或估算）累加，圆环 tooltip 展示
            updateSession(updatedSession.id, (session) => ({
              ...session,
              tokenStats: {
                prompt: (session.tokenStats?.prompt || 0) + (Number(agentEvent.prompt) || 0),
                completion: (session.tokenStats?.completion || 0) + (Number(agentEvent.completion) || 0),
                requests: (session.tokenStats?.requests || 0) + 1,
              },
            }));
          } else if (agentEvent.type === "context-compacted") {
            // 保留最近实际用量，随后由压缩后的请求/有效上下文更新；
            // 清空会让回退估算重新把完整聊天记录计入，显示虚假的 100%。
            showSessionNotice(taskSessionId, "上下文空间不足，已自动把早前工作压缩为摘要，任务继续");
          } else if (agentEvent.type === "agent-finished") {
            finishedEventSeen = true;
            void refreshMemories();
            applyAgentResultOnce(agentEvent.result);
            if (runningRunIdsRef.current.get(taskSessionId) === taskRunId) {
              runningRunIdsRef.current.delete(taskSessionId);
            }
            setRunningStartedAt((current) => {
              const next = { ...current };
              delete next[taskSessionId];
              return next;
            });
            setPendingApprovals((current) => {
              const next = { ...current };
              delete next[taskSessionId];
              return next;
            });
            setPendingQuestions((current) => {
              const next = { ...current };
              delete next[taskSessionId];
              return next;
            });
            // 排队消息的监听器一直保留到真正执行完成，这里统一收尾
            const unsubscribe = agentUnsubscribeRefs.current.get(taskRunId);
            agentUnsubscribeRefs.current.delete(taskRunId);
            if (unsubscribe) window.setTimeout(unsubscribe, 1000);
            // 会话是否继续显示运行状态由队列决定：还有排队消息则保持，全部完成才收起
            if (!sessionHasQueued(taskSessionId)) {
              setRunningSessionIds((current) => {
                if (!current.has(taskSessionId)) return current;
                const next = new Set(current);
                next.delete(taskSessionId);
                return next;
              });
            }
          }
        });
        agentUnsubscribeRefs.current.set(taskRunId, unsubscribeAgent);
        try {
          // Goal controls and queued runs read the archive; publish the goal before admission.
          if (updatedSession.goal || targetSession.goal) {
            const saved = await window.dyworker.saveSessions({ changed: [updatedSession], removed: [],
              order: sessionsRef.current.map(row => row.id), activeId: activeIdRef.current,
              meta: sessionsRef.current.map(row => ({ id: row.id, channel: row.channel, workspacePath: row.workspacePath })) });
            if (!saved.ok) throw new Error(saved.error || '目标保存失败，请重试');
            const latest = sessionsRef.current.find(row => row.id === taskSessionId);
            if (activeGoal(updatedSession) && (!latest || !activeGoal(latest) || latest.goalState?.id !== updatedSession.goalState?.id)) {
              applyAgentResultOnce({ status: 'cancelled', finalText: '' });
              if (!runningRunIdsRef.current.has(taskSessionId)) setRunningSessionIds(current => {
                const next = new Set(current); next.delete(taskSessionId); return next;
              });
              return;
            }
          }
          const response = await window.dyworker.sendTask({
            settings,
            runtime: updatedSession.runtime,
            workspacePath: pluginSubmission ? targetSession.workspacePath : workspacePath,
            sessionId: updatedSession.id,
            contextLimit: modelContextLimit(settings.model, settings.endpoint),
            workingContext: updatedSession.workingContext,
            goal: activeGoal(updatedSession),
            goalId: updatedSession.goalState?.id,
            messages: updatedSession.messages,
            loop: { enabled: Boolean(activeGoal(updatedSession)), maximum: activeGoal(updatedSession) ? 10 : 1 },
            approvalMode,
            runId: taskRunId,
          });
          if (response.queued) {
            queuedResponse = true;
            markQueued(taskSessionId, taskRunId);
          } else {
            if (!response.ok || !response.result) throw new Error(response.error || "任务执行失败");
            if (!finishedEventSeen) applyAgentResultOnce(response.result);
          }
        } finally {
          if (runningRunIdsRef.current.get(taskSessionId) === taskRunId) {
            runningRunIdsRef.current.delete(taskSessionId);
          }
          // 非排队消息的监听器在此收尾；排队消息由 agent-finished 统一收尾（任务可能尚未开始）
          if (!queuedResponse) {
            // webContents.send 的尾部事件可能晚于 invoke 响应到达，延迟取消订阅避免丢事件
            const unsubscribe = agentUnsubscribeRefs.current.get(taskRunId);
            agentUnsubscribeRefs.current.delete(taskRunId);
            if (unsubscribe) window.setTimeout(unsubscribe, 1000);
          }
          // 预览模式没有主进程队列事件，由这里收起运行状态；桌面版由 agent-finished 维护
          if (!queueSupported) {
            setRunningSessionIds((current) => {
              if (!current.has(taskSessionId)) return current;
              const next = new Set(current);
              next.delete(taskSessionId);
              return next;
            });
          }
          // 排队消息尚未执行，不清理当前任务的循环状态（由 queue-start/agent-finished 维护）
          if (!queuedResponse) {
            setLoopStates((current) => {
              const next = { ...current };
              delete next[taskSessionId];
              return next;
            });
          }
        }
      } else {
        let response;
        if (window.dyworker) {
          response = await window.dyworker.completeChat({ settings, messages: updatedSession.messages });
        } else {
          await new Promise((resolve) => window.setTimeout(resolve, 650));
          response = {
            content:
              "**新任务已进入 Electron 工作区。**\n\n我会继续保持现在的阅读层级和紧凑布局。桌面版接入模型设置后，这里会直接显示真实回复。",
          };
        }
        const assistant: ChatMessage = {
          role: "assistant",
          content: response.content,
          createdAt: new Date().toISOString(),
        };
        shouldScrollToBottomRef.current = taskSessionId;
        updateSession(taskSessionId, (session) => ({
          ...settleGoal(session, updatedSession, { status: "paused", finalText: "", reason: "当前环境仅展示预览，未执行目标。" }),
          updatedAt: assistant.createdAt,
          messages: [...session.messages, assistant],
        }));
      }
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : String(requestError);
      showSessionError(taskSessionId, detail);
      updateSession(taskSessionId, (session) => ({
        ...settleGoal(session, updatedSession, { status: "error", finalText: "", reason: detail }),
        messages: recordTaskFailure(session.messages, { assistantId: requestAssistantId, runId: messageRunId,
          detail, createdAt: new Date().toISOString() }),
      }));
      if (pluginSubmission) throw requestError;
    } finally {
      pluginSubmission?.signal.removeEventListener('abort', cancelPluginInput);
      if (runningRunIdsRef.current.get(taskSessionId) === taskRunId) {
        runningRunIdsRef.current.delete(taskSessionId);
      }
      // 桌面版运行状态由主进程队列事件维护；预览模式（无队列事件）在这里收起
      if (!window.dyworker?.sendTask) {
        setRunningSessionIds((current) => {
          const next = new Set(current);
          next.delete(taskSessionId);
          return next;
        });
      }
      // 排队消息尚未执行：不清理当前任务的运行态，防止误删正在执行任务的审批/计时
      if (!queuedResponse) {
        setRunningStartedAt((current) => {
          const next = { ...current };
          delete next[taskSessionId];
          return next;
        });
        setPendingApprovals((current) => {
          const next = { ...current };
          delete next[taskSessionId];
          return next;
        });
        setPendingQuestions((current) => {
          const next = { ...current };
          delete next[taskSessionId];
          return next;
        });
      }
    }
  };

  useEffect(() => {
    clientHost().setNativeAttachmentProvider(owner => {
      const selected = attachmentsRef.current;
      if (activeIdRef.current !== owner || !selected.length) return undefined;
      const current = () => activeIdRef.current === owner && attachmentsRef.current === selected;
      return {count:selected.length,names:selected.map(file=>file.name),current,
        async serialize(signal) {
          signal.throwIfAborted();
          if (!current()) throw new Error('附件或会话已经变化，输入已保留');
          if (!window.dyworker?.serializeCommandAttachments || selected.some(file => !file.commandGrantId))
            throw new Error('附件需要重新选择后才能发送');
          const result = await window.dyworker.serializeCommandAttachments({sessionId:owner,grantIds:selected.map(file=>file.commandGrantId!)});
          signal.throwIfAborted();
          if (!current()) throw new Error('附件或会话已经变化，输入已保留');
          if (!result.ok || !result.attachments) throw new Error(result.error || '附件保存失败');
          return result.attachments;
        },
        consume() { if (current()) setAttachments([]); },
      };
    });
    const offQueue = clientHost().subscribeInputQueue(change => {
      updateSession(change.sessionId, session => ({...session,messages:change.action.kind === 'remove'
        ? session.messages.filter(message => message.id !== change.itemId)
        : change.action.kind === 'edit' ? session.messages.map(message => message.id === change.itemId
          ? {...message,content:change.action.content.map((part:any) => part.text).join('\n'),dshAttachments:undefined,dshAttachmentNames:undefined,
            displayContent:undefined,pluginReferences:undefined} : message) : session.messages}));
    });
    clientHost().setInputSubmit(async input => {
      if (runningSessionIds.has(input.sessionId)) {
        input.signal.throwIfAborted();
        const requestId = crypto.randomUUID();
        const response = await window.dyworker?.dshOperation({sessionId:input.sessionId,action:'input-admit',payload:{
          requestId,mode:input.mode,content:[...(input.text ? [{type:'text',text:input.text}] : []),...input.attachments],
        }});
        if (!response?.ok) {
          if (response?.error?.code !== 'dyworker/input-unavailable') throw new Error(response?.error?.message || '插件输入未发送');
          // 原任务刚结束时，按应用正常入口取得下一轮授权；空闲状态下即时补充也是新一轮。
        } else {
          const accepted = response.value;
          if (accepted?.accepted !== true || typeof accepted.messageId !== 'string') throw new Error('任务没有返回已接收消息的确认');
          updateSession(input.sessionId, session => {
            if (session.messages.some(message => message.id === accepted.messageId)) return session;
            const message: ChatMessage = {id:accepted.messageId,role:'user',content:input.text,createdAt:new Date().toISOString(),
              ...(input.attachmentNames?.length ? {dshAttachmentNames:[...input.attachmentNames]} : {}),
              ...(input.presentation?.references.length ? {displayContent:input.presentation.text,pluginReferences:input.presentation.references} : {}),
              ...(input.attachments.length ? {dshAttachments:[...input.attachments] as ChatMessage['dshAttachments']} : {})};
            const messages = [...session.messages,message];
            return {...session,messages,updatedAt:message.createdAt};
          });
          await clientHost().refreshInputInbox(input.sessionId);
          return {kind:'success'};
        }
      }
      await sendMessage(input.text, input.sessionId, undefined, input);
      return {kind:'success'};
    });
    return () => {offQueue();clientHost().setInputSubmit(undefined);clientHost().setNativeAttachmentProvider(undefined);};
  });

  // 浏览器 Computer Use 控制：响应“继续交给助手”广播，真正恢复任务执行 (F4 / 补充要求 4)
  const browserResumeGuardRef = useRef(false);
  useEffect(() => {
    const unsubscribe = window.dyworker?.onBrowserControlResumed?.(async (payload) => {
      if (browserResumeGuardRef.current) return;
      browserResumeGuardRef.current = true;
      try {
        const targetSessionId = payload?.ownerSessionId || activeId;
        if (!targetSessionId) return;

        // 如果该会话已有任务正在运行，不重复发起
        if (runningSessionIds.has(targetSessionId)) return;

        // 生成新代次 runId，并同步给主进程控制管理器，彻底解决 runId 代次过期问题 (F5)
        const nextRunId = payload?.runId || crypto.randomUUID();
        await window.dyworker?.resumeBrowserControl?.({
          ownerSessionId: targetSessionId,
          runId: nextRunId
        });

        const resumePrompt = "我已完成手动接管操作。请先调用 browser__observe（或 browser__snapshot）重新观察当前网页的最新状态与控件编号，然后继续完成原定任务。";
        await sendMessage(resumePrompt, targetSessionId, nextRunId);
      } finally {
        window.setTimeout(() => {
          browserResumeGuardRef.current = false;
        }, 1200);
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, [activeId, runningSessionIds, sessions, settings, workspacePath]);

  const onComposerKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === ' ' && !event.metaKey && !event.ctrlKey && !event.altKey && activeSession?.runtime === 'dsh') {
      try { if (clientHost().matchInputSpace(activeSession.id, composer, textareaRef.current?.selectionStart ?? composer.length)) {
        event.preventDefault(); return;
      } } catch (error) { event.preventDefault(); setError(String((error as any)?.message || error)); return; }
    }
    if (mentionMenu) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((index) => mentionItems.length ? (index + 1) % mentionItems.length : 0);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((index) => mentionItems.length ? (index - 1 + mentionItems.length) % mentionItems.length : 0);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyMention(mentionIndex, event.key === 'Tab' && !event.shiftKey && mentionItems[mentionIndex]?.pluginInput?.candidate.drill ? 'drill' : 'pick');
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (activeSession?.runtime === 'dsh') clientHost().dismissInputMenu(activeSession.id);
        setMentionMenu(null);
        return;
      }
    }
    // ESC 中断：无候选菜单时按 ESC 终止当前会话正在运行的任务（对齐 Codex 的 ESC 打断）
    if (event.key === 'Escape' && activeSession && clientHost().cancelInput(activeSession.id)) {
      event.preventDefault(); return;
    }
    if (event.key === "Escape" && activeSession && runningSessionIds.has(activeSession.id)) {
      const runId = runningRunIdsRef.current.get(activeSession.id);
      if (runId && window.dyworker?.cancelTask) {
        event.preventDefault();
        void window.dyworker.cancelTask(activeSession.id, runId);
        setNotice("已请求终止当前任务");
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  // 最近一次保存失败的原因：设置页整页展示时用于就地提示（聊天区提示条此时不可见）
  const settingsSaveErrorRef = useRef("");

  const saveProviderSettings = async (nextSettings: ProviderSettings, successMessage = "设置已保存") => {
    const failSave = (message: string) => {
      // 设置是整页界面，聊天区的错误条在设置页打开时不可见，把原因一并留给设置页就地提示
      settingsSaveErrorRef.current = message;
      setError(message);
      return false;
    };
    if (bootstrapFailedRef.current) {
      return failSave("启动时未能读到本地配置，已阻止保存以免覆盖磁盘上的数据；请重启应用后重试。");
    }
    // 桥接缺失必须报错而不是"保存成功"：window.dyworker?.saveSettings 是可选链，
    // 没有 preload 时会静默返回 undefined，被当成保存成功——用户看到「设置已保存」，
    // 磁盘上一个字都没写（设置里改不动的现场）。浏览器里单独跑界面预览时没有桥接
    // 属于正常情况，那种场景不报错。
    if (!window.dyworker?.saveSettings && /Electron\//.test(navigator.userAgent)) {
      return failSave("桌面桥接没有加载（preload 缺失），设置无法写入磁盘。请重新构建并重启 DYWorker；若重启后依旧如此，说明安装包不完整。");
    }
    try {
      settingsSaveErrorRef.current = "";
      const result = await window.dyworker?.saveSettings(nextSettings);
      if (result && !result.ok) {
        return failSave(result.error || "模型设置保存失败");
      }
      setSettings({ ...nextSettings, updateUrl: result?.updateUrl || nextSettings.updateUrl });
      setNotice(successMessage);
      return true;
    } catch (saveError) {
      return failSave(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const checkAppUpdate = async () => {
    setAppUpdateDialogOpen(true);
    try {
      const result = await window.dyworker?.checkForAppUpdate();
      if (result && !result.ok && result.error) setNotice(result.error);
    } catch (updateError) {
      setNotice(updateError instanceof Error ? updateError.message : String(updateError));
    }
  };

  const openAppUpdateDialog = () => {
    setAppUpdateDialogOpen(true);
    if (["idle", "not-available", "error", "unavailable"].includes(appUpdate.state)) void checkAppUpdate();
  };

  const downloadAppUpdate = () => {
    void window.dyworker?.downloadAppUpdate().then((result) => {
      if (!result.ok && result.error) setNotice(result.error);
    });
  };

  const installAppUpdate = () => {
    void window.dyworker?.installAppUpdate().then((result) => {
      if (!result.ok && result.error) setNotice(result.error);
    });
  };

  const chooseIdentity = (identity: UserIdentity) =>
    saveProviderSettings({ ...settings, identity }, "身份设置已保存");

  const selectApprovalMode = (nextMode: ApprovalMode) => {
    if (nextMode === "full-access") {
      setApprovalMenuOpen(false);
      setFullAccessDialogOpen(true);
      return;
    }
    setApprovalMode(nextMode);
    setApprovalMenuOpen(false);
    void saveProviderSettings({ ...settings, approvalMode: nextMode }, "审批模式已记住，下次启动继续生效");
  };

  const confirmFullAccess = async () => {
    const saved = await saveProviderSettings({ ...settings, approvalMode: "full-access" }, "完整访问权限已开启");
    if (!saved) return false;
    setApprovalMode("full-access");
    setFullAccessDialogOpen(false);
    return true;
  };

  const activateModelProfile = async (profile: ModelProfile) => {
    const nextSettings = settingsWithProfile(settings, profile);
    setModelMenuOpen(false);
    await saveProviderSettings(nextSettings, `已切换到 ${profile.name}`);
  };

  // 模型菜单打开时拉一次「此密钥可用的模型」；同一 endpoint+key 只拉一次，换地址或密钥后重新拉
  const ensureComposerModels = () => {
    const endpoint = settings.endpoint.trim();
    const key = `${endpoint}\n${settings.apiKey.trim()}`;
    if (!endpoint || composerModelsKeyRef.current === key) return;
    composerModelsKeyRef.current = key;
    setComposerModels(null);
    setComposerModelsLoading(true);
    window.dyworker?.listModels({ endpoint, apiKey: settings.apiKey })
      .then((result) => setComposerModels(result?.ok ? (result.models || []) : []))
      .catch(() => setComposerModels([]))
      .finally(() => setComposerModelsLoading(false));
  };

  // 在同一密钥下切换到另一个模型：已有对应配置就整个启用；没有就按当前密钥现做一套并保存，
  // 之后它会出现在「已保存的模型」列表里，可与其它厂商配置一样管理
  const switchComposerModel = async (modelId: string) => {
    const endpoint = settings.endpoint.trim();
    const model = modelId.trim();
    if (!endpoint || !model) return;
    setModelMenuOpen(false);
    const existing = (settings.profiles || []).find((item) => item.endpoint === endpoint && item.model === model);
    if (existing) {
      await saveProviderSettings(settingsWithProfile(settings, existing), `已切换到 ${existing.name}`);
      return;
    }
    let shortProvider = providerPresets.find((item) => item.id === matchProvider(endpoint))?.name.replace(/（.*?）/g, "") || "";
    if (matchProvider(endpoint) === "custom") {
      try {
        shortProvider = new URL(endpoint).host;
      } catch {
        shortProvider = "自定义";
      }
    }
    const profile: ModelProfile = {
      id: crypto.randomUUID(),
      name: `${shortProvider} · ${model}`.trim(),
      endpoint,
      model,
      apiKey: settings.apiKey.trim(),
      reasoningEffort: "",
      transcriptionEndpoint: settings.transcriptionEndpoint,
      transcriptionModel: settings.transcriptionModel,
    };
    const next = {
      ...settings,
      model,
      reasoningEffort: "",
      profiles: [
        ...(settings.profiles || []).filter((item) => !(item.endpoint === endpoint && item.model === model)),
        profile,
      ],
    };
    await saveProviderSettings(next, `已切换到 ${profile.name}`);
  };

  const saveSchedule = async (draft: ScheduleDraft) => {
    const planWorkspacePath = (draft.workspacePath || "").trim() || workspacePath;
    const result = await window.dyworker?.saveSchedule({ ...draft, workspacePath: planWorkspacePath });
    if (!result?.ok) {
      setError(result?.error || "保存计划失败");
      return false;
    }
    setNotice("定时计划已保存");
    setSchedules(await window.dyworker?.listSchedules() || []);
    return true;
  };

  const toggleSchedule = (id: string, enabled: boolean) => {
    setSchedules((current) => current.map((item) => item.id === id ? { ...item, enabled } : item));
    void window.dyworker?.setScheduleEnabled(id, enabled);
  };

  const deleteSchedule = (id: string) => {
    setSchedules((current) => current.filter((item) => item.id !== id));
    void window.dyworker?.deleteSchedule(id);
  };

  const triggerSchedule = (id: string) => {
    // 记下这次是手动触发的哪个计划：主进程回 schedules:run-started 时把这次运行的会话
    // 直接打开（用户点了「立即执行」就是要马上看到它在跑）
    manualRunScheduleRef.current = id;
    void window.dyworker?.triggerSchedule(id).then((result) => {
      if (!result?.ok) {
        manualRunScheduleRef.current = "";
        setError(result?.error || "无法执行");
      } else if (result.started === false) {
        // 忙碌守卫把这一轮推迟了（桌面任务在跑或已有后台任务）：明说"已排队"，
        // 别让用户以为点了没反应，也别谎报"已开始执行"
        manualRunScheduleRef.current = "";
        setNotice("当前有任务正在运行，这个计划已排队，等它结束后自动开始");
      } else {
        setNotice("计划已开始执行，正在打开这次运行的会话");
      }
    });
  };

  const hasModel = hasConfiguredModel(settings);
  // 输入框的合并胶囊：模型名 · 当前思考档位（模型没有可调档位时只显示模型名）
  const composerReasoningConfig = hasModel
    ? getModelReasoningConfig({ endpoint: settings.endpoint, model: settings.model, overrides: settings.reasoningOverrides })
    : null;
  const composerEffortValue = composerReasoningConfig?.efforts.length
    ? selectedReasoningEffort(composerReasoningConfig, settings.reasoningEffort)
    : "";
  const composerEffortLabel = composerEffortValue
    ? composerReasoningConfig?.labels[composerEffortValue] || composerEffortValue
    : "";
  const identitySetupOpen = ready && settings.identity === null;
  const activeApprovalMode = composerApprovalModes.find((option) => option.value === approvalMode) || composerApprovalModes[1];
  const ActiveApprovalIcon = activeApprovalMode.icon;
  const contextUsage = useMemo(() => {
    // 优先用服务返回的本轮完整上下文用量，并随会话、模型和服务地址保存；
    // 还没有实测数据时用与代理侧一致的轻量估算，避免把附件字节数直接当成标记数。
    if (activeSession?.contextTokens != null
      && activeSession.contextModel === settings.model
      && activeSession.contextEndpoint === settings.endpoint) {
      return {
        used: activeSession.contextTokens,
        limit: modelContextLimit(settings.model, settings.endpoint),
        exact: Boolean(activeSession.contextTokensExact),
      };
    }
    const tokens = estimateSessionTokens(activeSession?.messages || [], activeSession?.workingContext || "");
    return { used: tokens, limit: modelContextLimit(settings.model, settings.endpoint), exact: false };
  }, [
    activeSession?.messages,
    activeSession?.workingContext,
    activeSession?.contextTokens,
    activeSession?.contextTokensExact,
    activeSession?.contextModel,
    activeSession?.contextEndpoint,
    settings.model,
    settings.endpoint,
  ]);
  // 任务运行期间仍可发送：桌面版消息进入队列，等当前任务结束后自动执行
  // 例外一：挂起等待唤醒期间禁止发送（发送键变灰），必须先「立即继续」或「取消唤醒」
  const canSend = Boolean(
    (composer.trim() || attachments.length || activeSkills.length || composerPastes.length || annotations.length)
    && (!activeTaskRunning || Boolean(window.dyworker?.sendTask))
    && !activeSleeping
    && voiceState !== "transcribing",
  );
  const recentExpanded = workspaceGroupOpen.__recent__ !== false;
  const fileManagerLabel = platform === "darwin"
    ? "在 Finder 中显示"
    : platform === "win32"
      ? "在文件资源管理器中显示"
      : "在文件管理器中显示";

  const selectSession = (session: SessionRecord) => {
    // 先关插件页：点"当前已选中"的会话时 activeId 不变，
    // 只靠 activeId 变化的 effect 是关不掉的（这就是之前点了没反应的原因）。
    setPluginsPageOpen(false);
    setBotTeamPageOpen(false);
    setSessionMenuId(null);
    setActiveId(session.id);
    setEditingMessage(null);
    closeFilePanelTabs();
    const path = String(session.workspacePath || "").trim();
    setWorkspacePath(path);
    if (!path) {
      setWorkspaceEntries([]);
      return;
    }
    if (window.dyworker?.refreshWorkspace) {
      void window.dyworker.refreshWorkspace(path).then(setWorkspaceEntries).catch(() => setWorkspaceEntries([]));
    }
  };

  // 插件要求跳转会话（上下文仪表盘的会话卡片）：交给已有的 selectSession 走完整流程
  useEffect(() => window.dyworker?.onDshSessionCreated?.(({session}) => {
    if (session.runtime !== 'dsh') return;
    clientHost().acceptCreatedSession(session);
    setSessions(current => mergeCreatedDshTask(current,session));
  }), []);

  useEffect(() => window.dyworker?.onDshSessionRenamed?.(({sessionId,title}) => {
    updateSession(sessionId,session => session.runtime === 'dsh' ? {...session,title,titleCustom:true} : session);
  }), []);

  useEffect(() => onOpenSessionRequest((sessionId) => {
    const target = sessions.find((session) => String(session.id) === String(sessionId)) || clientHost().nativeSession(sessionId);
    if (target) {
      setSessions(current => current.some(row => row.id === target.id) ? current : [target, ...current]);
      selectSession(target);
    }
    else {
      const child = clientHost().subagent(sessionId);
      if (child) setDshChildHistory(child);
    }
  }), [sessions, selectSession]);

  const jumpToConversationTurn = (turnIndex: number) => {
    setHoveredTurnIndex(turnIndex);
    conversationTurnRefs.current[turnIndex]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // 「立即执行」后自动打开这次运行的会话：会话已在 run-started 时建好并进了 sessions，
  // 这里走和点侧栏列表项完全一样的切换流程（切工作区、刷新工作区文件），
  // 确保它真的出现在眼前，而不是落在别的分组的折叠里
  useEffect(() => {
    if (!pendingAutoOpenSessionId) return;
    const target = sessions.find((session) => session.id === pendingAutoOpenSessionId);
    if (!target) return;
    setPendingAutoOpenSessionId("");
    selectSession(target);
  }, [pendingAutoOpenSessionId, sessions]);

  const clearWorkspace = () => {
    if (!activeSession) return;
    setWorkspacePath("");
    setWorkspaceEntries([]);
    closeFilePanelTabs();
    updateSession(activeSession.id, (session) => ({ ...session, workspacePath: "" }));
    setNotice("已移除这个会话的工作目录，会话归入最近");
  };

  const copyMessage = async (message: ChatMessage) => {
    const text = messageVisibleText(message);
    // 复制按钮只复制文本：图文混排进剪贴板时，部分粘贴目标（如输入框）会只取到图片、
    // 丢掉文本。图片由缩略图上的复制按钮单独复制。
    const copied = await copyTextToClipboard(text);
    setNotice(copied ? "消息已复制" : "消息复制失败，请检查剪贴板权限");
  };

  // 朗读助手回复：主进程合成 wav → 渲染层 Blob 播放；再点一次停止。token 防止停止后旧合成结果继续播放
  const speakAudioRef = useRef<HTMLAudioElement | null>(null);
  const speakObjectUrlRef = useRef("");
  const speakTokenRef = useRef(0);

  const stopSpeakingMessage = () => {
    speakTokenRef.current += 1;
    if (speakAudioRef.current) {
      speakAudioRef.current.pause();
      speakAudioRef.current = null;
    }
    if (speakObjectUrlRef.current) {
      URL.revokeObjectURL(speakObjectUrlRef.current);
      speakObjectUrlRef.current = "";
    }
    setSpeakingMessageKey(null);
    setSpeakingLoadingKey(null);
  };


  const toggleSpeakMessage = async (message: ChatMessage) => {
    const key = speakMessageKey(message);
    if (speakingMessageKey === key || speakingLoadingKey === key) {
      stopSpeakingMessage();
      return;
    }
    // 已有合成进行中：先停掉，避免两条音频叠加
    stopSpeakingMessage();
    const text = messageVisibleText(message).trim();
    if (!text) {
      setNotice("这条消息没有可朗读的文本");
      return;
    }
    const token = speakTokenRef.current;
    setSpeakingLoadingKey(key);
    try {
      const result = await window.dyworker?.speakText({ text: text.slice(0, 2000) });
      if (token !== speakTokenRef.current) return;
      if (!result?.ok || !result.wav?.length) {
        setNotice(result?.error || "语音合成失败，请重试");
        return;
      }
      // IPC 结构化克隆拿到的是 Uint8Array<ArrayBufferLike>：拷贝成独立 ArrayBuffer 再建 Blob
      const wavBuffer = result.wav.buffer.slice(result.wav.byteOffset, result.wav.byteOffset + result.wav.byteLength) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([wavBuffer], { type: "audio/wav" }));
      const audio = new Audio(url);
      speakObjectUrlRef.current = url;
      speakAudioRef.current = audio;
      audio.onended = () => stopSpeakingMessage();
      audio.onerror = () => {
        setNotice("语音播放失败");
        stopSpeakingMessage();
      };
      setSpeakingMessageKey(key);
      await audio.play();
    } catch (error) {
      if (token === speakTokenRef.current) setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (token === speakTokenRef.current) setSpeakingLoadingKey(null);
    }
  };

  // 播放用户语音附件（QQ/微信渠道语音）
  const [playingVoicePath, setPlayingVoicePath] = useState<string | null>(null);
  const [voiceLoadingPath, setVoiceLoadingPath] = useState<string | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceObjectUrlRef = useRef("");

  const stopPlayingVoice = () => {
    if (voiceAudioRef.current) {
      voiceAudioRef.current.pause();
      voiceAudioRef.current = null;
    }
    if (voiceObjectUrlRef.current) {
      URL.revokeObjectURL(voiceObjectUrlRef.current);
      voiceObjectUrlRef.current = "";
    }
    setPlayingVoicePath(null);
    setVoiceLoadingPath(null);
  };

  const togglePlayVoice = async (attachment: Attachment) => {
    const pathKey = attachment.path || attachment.name;
    if (playingVoicePath === pathKey || voiceLoadingPath === pathKey) {
      stopPlayingVoice();
      return;
    }
    stopPlayingVoice();
    stopSpeakingMessage();
    if (!attachment.path) {
      setNotice("语音文件路径不存在");
      return;
    }
    setVoiceLoadingPath(pathKey);
    try {
      const result = await window.dyworker?.readAudioAttachment(attachment.path);
      if (!result?.ok || (!result.wav?.length && !result.bytes?.length)) {
        setNotice(result?.error || "语音文件无法读取或已清理");
        return;
      }
      const audioBuffer = result.wav ? result.wav : result.bytes!;
      const mimeType = result.wav ? "audio/wav" : (result.mimeType || "audio/mpeg");
      const bufferCopy = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([bufferCopy], { type: mimeType }));
      const audio = new Audio();
      audio.src = url;
      audio.preload = "auto";
      voiceObjectUrlRef.current = url;
      voiceAudioRef.current = audio;
      audio.onended = () => stopPlayingVoice();
      audio.onerror = () => {
        const errorMsg = audio.error?.message || "语音播放失败";
        setNotice(errorMsg.includes("supported source") ? "语音格式无法播放或文件已损坏" : "语音播放失败");
        stopPlayingVoice();
      };
      setPlayingVoicePath(pathKey);
      await audio.play();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      stopPlayingVoice();
    } finally {
      setVoiceLoadingPath(null);
    }
  };

  const startMessageEdit = (message: ChatMessage, messageIndex: number) => {
    if (!activeSession || message.role !== "user") return;
    // 任务运行期间只允许编辑排队中、尚未开始执行的消息
    if (activeTaskRunning && !(message.runId && queuedRunIds.has(message.runId))) return;
    const text = messageVisibleText(message);
    if (activeSession.runtime === 'dsh') {
      const editor = clientHost().inputEditor(activeSession.id);
      if (!editor || !clientHost().inputReady(activeSession.id)) { setNotice('本会话输入尚未就绪，请稍后重试'); return; }
      try { editor.restore({ text, references: message.pluginReferences || [] }); editor.refreshSources(); }
      catch (error) { setNotice(`无法恢复这条消息的引用：${error instanceof Error ? error.message : String(error)}`); return; }
    }
    setEditingMessage({ sessionId: activeSession.id, messageIndex, original: message });
    setComposer(text);
    setAttachments(message.attachments ? [...message.attachments] : []);
    setActiveSkills(message.skillsUsed?.length ? skills.filter((skill) => message.skillsUsed?.includes(skill.name)) : []);
    // 引用注释一并恢复进 composer，重发时按编辑后的版本重新编号拼进正文
    setAnnotations(message.annotations ? message.annotations.map((annotation) => ({ ...annotation })) : []);
    setMentionMenu(null);
    setNotice("已载入消息，修改后点击发送即可替换原消息并重新处理");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const cancelMessageEdit = () => {
    setEditingMessage(null);
    setComposer("");
    setAttachments([]);
    setActiveSkills([]);
    setAnnotations([]);
    setNotice("已取消编辑");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  // 从队列移除一条排队消息（同时移除它的空助手占位）
  const removeQueuedMessage = async (runId: string, messageIndex: number, notice = "已删除这条排队消息") => {
    if (!activeSession) return;
    const sessionId = activeSession.id;
    if (!runId || !queuedRunIds.has(runId)) return;
    if (window.dyworker?.removeQueuedTask) {
      const result = await window.dyworker.removeQueuedTask({ sessionId, runId });
      if (!result?.ok || result.removed === false) {
        // 队列项可能已开始执行或应用重启后已不存在，仍从会话中移除这条消息
      }
    }
    unmarkQueued(sessionId, runId);
    updateSession(sessionId, (session) => {
      const next = [...session.messages];
      next.splice(messageIndex, 1);
      // 同时移除紧随其后的空助手占位（排队消息尚未开始执行）
      const following = next[messageIndex];
      if (following?.role === "assistant" && following.runId === runId && !following.content) {
        next.splice(messageIndex, 1);
      }
      return { ...session, messages: next };
    });
    setNotice(notice);
  };

  const cancelQueuedMessage = async () => {
    if (!activeSession || !editingMessage) return;
    const runId = editingMessage.original.runId || "";
    await removeQueuedMessage(runId, editingMessage.messageIndex, "已取消这条排队消息");
    setEditingMessage(null);
    setComposer("");
    setAttachments([]);
    setActiveSkills([]);
  };

  // 立即执行：停下当前任务，这条排队消息插到队首马上运行
  // （主进程把它提到队首并取消当前任务，当前任务收尾时自动出队启动）
  const runQueuedMessageNow = async (entry: { message: ChatMessage; messageIndex: number }) => {
    if (!activeSession) return;
    const runId = entry.message.runId || "";
    // 用 ref 取最新排队状态，避免陈旧闭包导致点击被静默忽略
    if (!runId || !queuedRunsRef.current.get(activeSession.id)?.has(runId)) {
      setNotice("这条消息已不在排队中，无法立即执行");
      return;
    }
    // 先给即时反馈，避免主进程切换任务期间看起来像“没反应”
    setNotice("正在停下当前任务，马上执行这条消息…");
    try {
      const result = await window.dyworker?.runQueuedTaskNow({ sessionId: activeSession.id, runId });
      if (result?.ok) {
        setNotice("已停下当前任务，立即执行这条消息");
      } else {
        setNotice(result?.error || "这条消息已不在队列中");
      }
    } catch (error) {
      setNotice(`立即执行失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const beginPanelResize = (edge: "left" | "right", event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    panelResizeRef.current = {
      edge,
      startX: event.clientX,
      startWidth: edge === "left" ? appliedSidebarWidth : appliedToolPanelWidth,
    };
    document.body.classList.add("resizing-panels");
  };

  const messageRowActions = useStableHandlers({
    openReferencedFile, openImagePreview, handleMessageContextMenu, togglePlayVoice, toggleActivityCollapse,
    copyMessage, startMessageEdit, toggleSpeakMessage,
    openMessageSession(message: ChatMessage, title: string) {
      const reference = message.sessionRefs?.find(entry => entry.title === title);
      const target = reference && sessionsRef.current.some(session => session.id === reference.id)
        ? reference.id : sessionsRef.current.find(session => session.title === title && session.id !== activeIdRef.current)?.id;
      if (target) { setActiveId(target); setNotice("已切换到引用的会话"); }
      else setNotice(`会话「${title}」已不存在，可能已被删除`);
    },
    forkSessionAt(sessionId: string, index: number) {
      const session = sessionsRef.current.find(entry => entry.id === sessionId);
      if (session) forkSession(session, index);
    },
    openPluginReference(sessionId: string, reference: any) {
      try {
        if (!clientHost().openInputReference(sessionId, reference)) setNotice('此引用暂时不能打开，请确认对应插件已启用');
      } catch (error) { setError(String((error as any)?.message || error)); }
    },
    openReview(changes: NonNullable<ChatMessage["changes"]>) {
      setReviewFocusChanges(changes); setRightPanelOpen(true); openToolPanelTab("review");
    },
    bindMessageRow(node: HTMLDivElement | null, index: number, turnIndex: number, user: boolean) {
      messageRowRefs.current[index] = node;
      if (user) conversationTurnRefs.current[turnIndex] = node;
    },
  });

  const panelStyle = {
    "--sidebar-width": `${appliedSidebarWidth}px`,
    "--tool-panel-width": `${appliedToolPanelWidth}px`,
  } as CSSProperties;

  // 右侧面板菜单项（首页菜单页与 + 下拉菜单共用）。终端由内置插件在底部打开。
  const toolPanelMenuItems = [
    {
      key: "review",
      icon: <SquarePlus size={18} />,
      label: "审阅",
      shortcut: shortcutLabel("⌃⇧G", "Ctrl+Shift+G"),
      active: activeToolPanelKind === "review",
      visible: true,
      onClick: () => { setRightPanelOpen(true); openToolPanelTab("review"); },
    },
    {
      key: "terminal",
      icon: <SquareTerminal size={18} />,
      label: "终端",
      shortcut: shortcutLabel("⌘J", "Ctrl+J"),
      active: terminalOpen,
      visible: terminalAvailable,
      onClick: toggleTerminal,
    },
    {
      key: "browser",
      icon: <Globe size={18} />,
      label: "浏览器",
      shortcut: shortcutLabel("⌘T", "Ctrl+T"),
      active: activeToolPanelKind === "browser",
      visible: true,
      onClick: () => { setRightPanelOpen(true); openToolPanelTab("browser"); },
    },
    {
      key: "files",
      icon: <FolderOpen size={18} />,
      label: "文件",
      shortcut: shortcutLabel("⌘P", "Ctrl+P"),
      active: activeToolPanelKind === "files",
      visible: true,
      onClick: () => { setRightPanelOpen(true); openToolPanelTab("files"); },
    },
    {
      key: "side-chat",
      icon: <MessageSquarePlus size={18} />,
      label: "侧边聊天",
      shortcut: shortcutLabel("⌥⌘S", "Ctrl+Alt+S"),
      active: activeToolPanelKind === "chat",
      visible: true,
      onClick: () => { setRightPanelOpen(true); openToolPanelTab("chat"); },
    },
    {
      key: "tasks",
      icon: <ListTree size={18} />,
      label: "后台任务",
      shortcut: "",
      active: activeToolPanelKind === "tasks",
      visible: true,
      onClick: () => { setRightPanelOpen(true); openToolPanelTab("tasks"); },
    },
    ...pluginPanelChoices.map(panel => ({
      key: panel.id,
      icon: <SquarePlus size={18} />,
      label: panel.title,
      shortcut: "",
      active: activeToolPanelTabId === panel.id,
      visible: true,
      onClick: () => openPluginPanel({ pluginId: panel.pluginId, key: panel.pluginKey, label: panel.title }),
    })),
  ];

  const toolPanelMenu = (
    <div className="tool-panel-menu" role="menu">
      {toolPanelMenuItems.filter((item) => item.visible).map((item) => (
        <button
          role="menuitem"
          className={item.active ? "active" : ""}
          key={item.key}
          onClick={() => {
            // 终端在底部展开，右侧菜单保持可用。
            if (item.key !== "terminal") setToolPanelMenuOpen(false);
            item.onClick();
          }}
        >
          {item.icon}
          <span>{item.label}</span>
          {item.key === "review" && reviewChanges.length > 0 && <small className="tool-panel-count">{reviewChanges.length}</small>}
          <span className="tool-panel-shortcut">{item.shortcut}</span>
        </button>
      ))}
    </div>
  );

  // + 按钮的下拉菜单（对照 Codex：已打开为标签页的类型不再出现，终端始终可选）。
  // 浏览器例外：它支持多开，每次点都新开一个标签页，所以始终出现在列表里。
  const addMenuItems = toolPanelMenuItems.filter((item) => {
    if (item.key === "terminal") return true;
    if (item.key === "browser") return true;
    if (item.key.startsWith("plugin-")) return !toolPanelTabs.some(tab => tab.id === item.key);
    const kind = item.key === "side-chat" ? "chat" : item.key;
    return !toolPanelTabs.some((tab) => tab.kind === kind);
  });
  const toolPanelAddMenu = toolPanelAddMenuOpen && (
    <div className="session-menu tool-panel-add-menu" role="menu" data-menu-root>
      {(rightPanelOpen ? addMenuItems : toolPanelMenuItems.filter(item => item.visible)).map((item) => (
        <button
          role="menuitem"
          className={item.active ? "active" : ""}
          key={item.key}
          onClick={() => {
            setToolPanelAddMenuOpen(false);
            // 浏览器项在这里是「新开一个标签页」，与菜单页里的「打开浏览器」区分开
            if (item.key === "browser") {
              setRightPanelOpen(true);
              openBrowserTab();
              return;
            }
            item.onClick();
          }}
        >
          {item.icon}
          <span>{item.label}</span>
          <span className="tool-panel-shortcut">{item.shortcut}</span>
        </button>
      ))}
    </div>
  );

  // 导出会话为 Markdown：正文用 displayContent（引用技能/长粘贴折叠时与气泡一致），
  // 附件、技能标签与耗时一并带出，文件名含会话标题与日期
  const exportSessionMarkdown = (session: SessionRecord) => {
    const lines: string[] = [
      `# ${session.title}`,
      "",
      `> 导出自 DYWorker · ${new Date().toLocaleString()}`,
      "",
    ];
    for (const message of session.messages) {
      const body = message.displayContent || message.content;
      if (!body.trim()) continue;
      const time = message.createdAt ? new Date(message.createdAt).toLocaleString() : "";
      const header = message.role === "user" ? "🧑 用户" : message.role === "assistant" ? "🤖 助手" : "系统";
      lines.push(`## ${header}${time ? ` · ${time}` : ""}`, "");
      lines.push(body.trim(), "");
      // 折叠的长粘贴块导出原文（与气泡展开后看到的一致），避免导出文件丢失内容
      for (const [index, block] of (message.pasteBlocks || []).entries()) {
        lines.push("", `<details><summary>长文本 ${block.text.length} 字（第 ${index + 1} 段）</summary>`, "", block.text, "", "</details>");
      }
      if (message.skillsUsed?.length) lines.push(`（使用技能：${message.skillsUsed.join("、")}）`, "");
      if (message.attachments?.length) {
        lines.push(`**附件：** ${message.attachments.map((item) => item.name).join("、")}`, "");
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `${session.title.replace(/[\\/:*?"<>|]/g, "_")}-${stamp}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("已导出会话为 Markdown 文件");
  };

  // 总结为工作模板：把会话转录发给模型提炼草稿，弹可编辑对话框，确认后写入技能库
  const summarizeSessionToSkill = async (session: SessionRecord) => {
    if (skillSummarySessionId) return;
    if (buildSkillSummaryTranscript(session).length < 50) {
      setError("会话内容太少，还没有可总结的做法");
      return;
    }
    if (!window.dyworker?.completeChat) {
      setError("当前预览环境没有连接模型，无法提炼工作模板");
      return;
    }
    setSkillSummarySessionId(session.id);
    showSessionNotice(session.id, "正在提炼工作模板…");
    try {
      const messages = buildSkillSummaryMessages(session);
      let result = await window.dyworker.completeChat({ settings, messages });
      if (result.demo) {
        setError(result.content);
        return;
      }
      let draft = parseSkillDraft(result.content || "");
      if (!draft) {
        // 输出不是合法 JSON：追加强调后重试一次
        result = await window.dyworker.completeChat({
          settings,
          messages: [...messages, { role: "assistant" as const, content: result.content || "", createdAt: new Date().toISOString() }, { role: "user" as const, content: "上一次输出不是合法 JSON。请只输出一个 JSON 对象（name/description/instructions），不要用 Markdown 围栏，不要任何解释。", createdAt: new Date().toISOString() }],
        });
        if (result.demo) {
          setError(result.content);
          return;
        }
        draft = parseSkillDraft(result.content || "");
      }
      if (draft) {
        setSkillDraft(draft);
      } else {
        // 兜底：打开空草稿让用户手动填写，不让这次提炼白跑
        setSkillDraft({ name: session.title, description: "", instructions: "" });
        setNotice("模型没能生成初稿，请手动填写");
      }
    } catch (summaryError) {
      setError(`提炼失败：${summaryError instanceof Error ? summaryError.message : String(summaryError)}`);
    } finally {
      setSkillSummarySessionId(null);
    }
  };

  // Linux 与 Windows 的窗口都由应用自绘标题栏：品牌与侧栏同列、侧栏首行放新建任务与收件箱。
  // macOS 保留原生红绿灯，标题栏布局维持原样。
  const desktopToolbarLayout = (platform || "linux") !== "darwin";
  const newTaskButton = (
    <button className="new-task-button" onClick={() => createTask()}>
      <SquarePen size={18} />
      新建任务
    </button>
  );

  return (
    <>
    {/* 外观背景装饰层：背景色 → 背景图 → 遮罩，pointer-events/aria-hidden 保证不占交互 */}
    <PluginSlotView slot="shell.overlay" hideEmpty />
    {dshChildHistory && <DshChildHistory target={dshChildHistory} onClose={closeDshChildHistory} />}
    <div className="appearance-backdrop" aria-hidden="true" />
    <div
      ref={appShellRef}
      className={`app-shell reference-layout platform-${platform || "linux"} ${settingsOpen ? "settings-page-open" : ""} ${pluginConversationViews.length ? "has-conversation-views" : ""} ${sidebarOpen ? "" : "sidebar-collapsed"} ${rightPanelOpen ? "" : "right-panel-collapsed"}`}
      style={panelStyle}
    >
      <ShellChrome
        desktopToolbarLayout={desktopToolbarLayout}
        platform={platform}
        activeSession={activeSession}
        conversationSearchInputRef={conversationSearchInputRef}
        topMenuOpen={topMenuOpen}
        setTopMenuOpen={setTopMenuOpen}
        conversationToolsOpen={conversationToolsOpen}
        setConversationToolsOpen={setConversationToolsOpen}
        branchMenuOpen={branchMenuOpen}
        setBranchMenuOpen={setBranchMenuOpen}
        commitPanelOpen={commitPanelOpen}
        setCommitPanelOpen={setCommitPanelOpen}
        setToolPanelAddMenuOpen={setToolPanelAddMenuOpen}
        setRenamingId={setRenamingId}
        skillSummarySessionId={skillSummarySessionId}
        setPlanSeed={setPlanSeed}
        setSettingsTab={setSettingsTab}
        setSettingsOpen={setSettingsOpen}
        togglePin={togglePin}
        archiveSession={archiveSession}
        exportSessionMarkdown={exportSessionMarkdown}
        summarizeSessionToSkill={summarizeSessionToSkill}
        gitInfo={gitInfo}
        gitBusy={gitBusy}
        workspaceContext={workspaceContext}
        composerWorkspacePath={composerWorkspacePath}
        branchQuery={branchQuery}
        setBranchQuery={setBranchQuery}
        creatingBranch={creatingBranch}
        setCreatingBranch={setCreatingBranch}
        newBranchName={newBranchName}
        setNewBranchName={setNewBranchName}
        commitMessage={commitMessage}
        setCommitMessage={setCommitMessage}
        includeUnstaged={includeUnstaged}
        setIncludeUnstaged={setIncludeUnstaged}
        diffStats={diffStats}
        refreshGitInfo={refreshGitInfo}
        toggleBranchMenu={toggleBranchMenu}
        openCommitPanel={openCommitPanel}
        switchBranch={switchBranch}
        createBranch={createBranch}
        generateCommitMessage={generateCommitMessage}
        runCommit={runCommit}
        runPushOnly={runPushOnly}
        setConversationSearchOpen={setConversationSearchOpen}
        botTeamPageOpen={botTeamPageOpen}
        botTeamProvider={botTeamProvider}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        settingsOpen={settingsOpen}
        pluginsPageOpen={pluginsPageOpen}
        rightPanelOpen={rightPanelOpen}
        setRightPanelOpen={setRightPanelOpen}
        toolPanelTabs={toolPanelTabs}
        setToolPanelMenuOpen={setToolPanelMenuOpen}
        setPluginsPageOpen={setPluginsPageOpen}
        setBotTeamPageOpen={setBotTeamPageOpen}
        setConversationView={setConversationView}
        setRailMenuOpen={setRailMenuOpen}
        railMenuOpen={railMenuOpen}
        settingsTab={settingsTab}
        showArchived={showArchived}
        setShowArchived={setShowArchived}
        createTask={createTask}
        appUpdate={appUpdate}
        setAppUpdateDialogOpen={setAppUpdateDialogOpen}
        downloadAppUpdate={downloadAppUpdate}
      />
      <Sidebar
        desktopToolbarLayout={desktopToolbarLayout}
        newTaskButton={newTaskButton}
        platform={platform}
        inboxOpen={inboxOpen}
        setInboxOpen={setInboxOpen}
        setInboxItems={setInboxItems}
        inboxPendingCount={inboxPendingCount}
        systemMessagesUnread={systemMessagesUnread}
        query={query}
        setQuery={setQuery}
        workspaceGroupOpen={workspaceGroupOpen}
        setWorkspaceGroupOpen={setWorkspaceGroupOpen}
        workspaceSessionGroups={workspaceSessionGroups}
        workspacePath={workspacePath}
        activeId={activeId}
        workspaceSessionsExpanded={workspaceSessionsExpanded}
        setWorkspaceSessionsExpanded={setWorkspaceSessionsExpanded}
        workspaceMenuPath={workspaceMenuPath}
        setWorkspaceMenuPath={setWorkspaceMenuPath}
        sessionMenuId={sessionMenuId}
        setSessionMenuId={setSessionMenuId}
        renamingId={renamingId}
        setRenamingId={setRenamingId}
        pluginsPageOpen={pluginsPageOpen}
        botTeamPageOpen={botTeamPageOpen}
        setBotTeamPageOpen={setBotTeamPageOpen}
        setPluginsPageOpen={setPluginsPageOpen}
        botTeamAvailable={botTeamAvailable}
        botTeamProvider={botTeamProvider}
        setRightPanelOpen={setRightPanelOpen}
        setConversationView={setConversationView}
        setSettingsOpen={setSettingsOpen}
        setConversationSearchOpen={setConversationSearchOpen}
        setTerminalOpen={setTerminalOpen}
        recentExpanded={recentExpanded}
        showArchived={showArchived}
        setShowArchived={setShowArchived}
        sessions={sessions}
        runningSessionIds={runningSessionIds}
        sleepingSessions={sleepingSessions}
        skillSummarySessionId={skillSummarySessionId}
        fileManagerLabel={fileManagerLabel}
        selectSession={selectSession}
        createTask={createTask}
        renameSession={renameSession}
        togglePin={togglePin}
        archiveSession={archiveSession}
        unarchiveSession={unarchiveSession}
        deleteSession={deleteSession}
        exportSessionMarkdown={exportSessionMarkdown}
        summarizeSessionToSkill={summarizeSessionToSkill}
        toggleWorkspacePin={toggleWorkspacePin}
        openWorkspaceInFileManager={openWorkspaceInFileManager}
        sessionPendingInboxCount={sessionPendingInboxCount}
      />

      {sidebarOpen && (
        <div
          className="panel-resize-handle panel-resize-left"
          role="separator"
          aria-label="调整左侧面板宽度"
          aria-orientation="vertical"
          onPointerDown={(event) => beginPanelResize("left", event)}
        />
      )}

      <ConversationPane
        ConversationMessageRow={ConversationMessageRow}
        messageRowActions={messageRowActions}
        activeSession={activeSession}
        workspacePath={workspacePath}
        composerWorkspacePath={composerWorkspacePath}
        workspaceContext={workspaceContext}
        activeId={activeId}
        botTeamPageOpen={botTeamPageOpen}
        botTeamAvailable={botTeamAvailable}
        botTeamProvider={botTeamProvider}
        pluginsPageOpen={pluginsPageOpen}
        settingsOpen={settingsOpen}
        conversationView={conversationView}
        setConversationView={setConversationView}
        pluginConversationViews={pluginConversationViews}
        conversationSearchOpen={conversationSearchOpen}
        setConversationSearchOpen={setConversationSearchOpen}
        conversationSearchQuery={conversationSearchQuery}
        setConversationSearchQuery={setConversationSearchQuery}
        conversationSearchMatchIndex={conversationSearchMatchIndex}
        setConversationSearchMatchIndex={setConversationSearchMatchIndex}
        conversationMatchTotal={conversationMatchTotal}
        conversationSearchInputRef={conversationSearchInputRef}
        conversationIndex={conversationIndex}
        conversationTurns={conversationTurns}
        hoveredTurnIndex={hoveredTurnIndex}
        setHoveredTurnIndex={setHoveredTurnIndex}
        jumpToConversationTurn={jumpToConversationTurn}
        bindViewport={bindViewport}
        viewportRef={viewportRef}
        syncAtBottom={syncAtBottom}
        setSelectionQuote={setSelectionQuote}
        handleConversationMouseUp={handleConversationMouseUp}
        atBottom={atBottom}
        editingMessage={editingMessage}
        activeTaskRunning={activeTaskRunning}
        activeScheduledRun={activeScheduledRun}
        streamingAssistantIndex={streamingAssistantIndex}
        playingVoicePath={playingVoicePath}
        voiceLoadingPath={voiceLoadingPath}
        speakingMessageKey={speakingMessageKey}
        speakingLoadingKey={speakingLoadingKey}
        collapsedActivities={collapsedActivities}
        queuedRunIds={queuedRunIds}
        activeLoopState={activeLoopState}
        runningStartedAt={runningStartedAt}
        activeWaking={activeWaking}
        activePendingApproval={activePendingApproval}
        setPendingApprovals={setPendingApprovals}
        activePendingQuestion={activePendingQuestion}
        setPendingQuestions={setPendingQuestions}
        activeSessionPendingInboxApproval={activeSessionPendingInboxApproval}
        activeSessionPendingInboxQuestion={activeSessionPendingInboxQuestion}
        setInboxItems={setInboxItems}
        annotationMarkers={annotationMarkers}
        terminalMounted={terminalMounted}
        terminalAvailable={terminalAvailable}
        terminalOpen={terminalOpen}
        setTerminalOpen={setTerminalOpen}
        debugOpen={debugOpen}
        setDebugOpen={setDebugOpen}
        activeSessionTraceEvents={activeSessionTraceEvents}
        debugLogs={debugLogs}
        setDebugLogs={setDebugLogs}
        traceBuffer={traceBuffer}
        setTraceEvents={setTraceEvents}
        pendingDebugLogsRef={pendingDebugLogsRef}
        recentDebugLogsRef={recentDebugLogsRef}
        debugLogFlushTimerRef={debugLogFlushTimerRef}
        appendSessionTraces={appendSessionTraces}
        inboxOpen={inboxOpen}
        setInboxOpen={setInboxOpen}
        inboxItems={inboxItems}
        inboxTab={inboxTab}
        systemMessageFocusId={systemMessageFocusId}
        setSystemMessageFocusId={setSystemMessageFocusId}
        imagePreview={imagePreview}
        closeImagePreview={closeImagePreview}
        imagePreviewIndex={imagePreviewIndex}
        imagePreviewPeers={imagePreviewPeers}
        navigateImagePreview={navigateImagePreview}
        setNotice={setNotice}
        setError={setError}
        setComposerDockNode={setComposerDockNode}
        error={error}
        activeSessionError={activeSessionError}
        activeSessionNotice={activeSessionNotice}
        notice={notice}
        clearSessionError={clearSessionError}
        clearSessionNotice={clearSessionNotice}
        activeSleeping={activeSleeping}
        activeQueuedMessages={activeQueuedMessages}
        resumeSleepingTask={resumeSleepingTask}
        cancelSleepingTask={cancelSleepingTask}
        runQueuedMessageNow={runQueuedMessageNow}
        removeQueuedMessage={removeQueuedMessage}
        setQueueMenuRunId={setQueueMenuRunId}
        queueMenuRunId={queueMenuRunId}
        startMessageEdit={startMessageEdit}
        copyMessage={copyMessage}
        handleGoalAction={handleGoalAction}
        chooseWorkspace={chooseWorkspace}
        clearWorkspace={clearWorkspace}
        composerDragActive={composerDragActive}
        handleComposerDragOver={handleComposerDragOver}
        handleComposerDragLeave={handleComposerDragLeave}
        handleComposerDrop={handleComposerDrop}
        cancelQueuedMessage={cancelQueuedMessage}
        cancelMessageEdit={cancelMessageEdit}
        mentionMenu={mentionMenu}
        mentionItems={mentionItems}
        mentionIndex={mentionIndex}
        setMentionIndex={setMentionIndex}
        applyMention={applyMention}
        composerPastes={composerPastes}
        setComposerPastes={setComposerPastes}
        expandedPasteId={expandedPasteId}
        setExpandedPasteId={setExpandedPasteId}
        annotations={annotations}
        setAnnotations={setAnnotations}
        openAnnotationList={openAnnotationList}
        scheduleCloseAnnotationList={scheduleCloseAnnotationList}
        annotationListOpen={annotationListOpen}
        setAnnotationListOpen={setAnnotationListOpen}
        setAnnotationEditor={setAnnotationEditor}
        attachments={attachments}
        setAttachments={setAttachments}
        openImagePreview={openImagePreview}
        composerSessionId={composerSessionId}
        composer={composer}
        textareaRef={textareaRef}
        updateComposer={updateComposer}
        syncComposerDerivedState={syncComposerDerivedState}
        onComposerKeyDown={onComposerKeyDown}
        handleComposerContextMenu={handleComposerContextMenu}
        handleComposerPaste={handleComposerPaste}
        composingRef={composingRef}
        composerMirrorRef={composerMirrorRef}
        activeTokenNames={activeTokenNames}
        activeSkillNames={activeSkillNames}
        activeSessionTitles={activeSessionTitles}
        addMenuOpen={addMenuOpen}
        setAddMenuOpen={setAddMenuOpen}
        chooseAttachments={chooseAttachments}
        approvalMenuOpen={approvalMenuOpen}
        setApprovalMenuOpen={setApprovalMenuOpen}
        approvalMode={approvalMode}
        activeApprovalMode={activeApprovalMode}
        ActiveApprovalIcon={ActiveApprovalIcon}
        selectApprovalMode={selectApprovalMode}
        contextUsage={contextUsage}
        modelMenuOpen={modelMenuOpen}
        setModelMenuOpen={setModelMenuOpen}
        settings={settings}
        hasModel={hasModel}
        ensureComposerModels={ensureComposerModels}
        composerEffortLabel={composerEffortLabel}
        activateModelProfile={activateModelProfile}
        composerModelsLoading={composerModelsLoading}
        composerModels={composerModels}
        switchComposerModel={switchComposerModel}
        saveProviderSettings={saveProviderSettings}
        setSettingsTab={setSettingsTab}
        setSettingsOpen={setSettingsOpen}
        voiceState={voiceState}
        toggleVoiceInput={toggleVoiceInput}
        canSend={canSend}
        sendMessage={sendMessage}
        runningRunIdsRef={runningRunIdsRef}
      />

      {rightPanelOpen && (
        <div
          className="panel-resize-handle panel-resize-right"
          role="separator"
          aria-label="调整右侧面板宽度"
          aria-orientation="vertical"
          onPointerDown={(event) => beginPanelResize("right", event)}
        />
      )}

      <ToolPanel
        activeToolPanelKind={activeToolPanelKind}
        toolPanelTabs={toolPanelTabs}
        activeToolPanelTabId={activeToolPanelTabId}
        activeToolPanelTab={activeToolPanelTab}
        toolPanelTabOverflow={toolPanelTabOverflow}
        pristineMenuPage={pristineMenuPage}
        menuPageShown={menuPageShown}
        rightPanelOpen={rightPanelOpen}
        toolPanelAddMenuOpen={toolPanelAddMenuOpen}
        toolPanelMenu={toolPanelMenu}
        toolPanelAddMenu={toolPanelAddMenu}
        toolPanelTabStripRef={toolPanelTabStripRef}
        workspacePath={workspacePath}
        workspaceEntries={workspaceEntries}
        workspaceOpen={workspaceOpen}
        activeSession={activeSession}
        settings={settings}
        sideChatSeed={sideChatSeed}
        activeId={activeId}
        browserSuggestionsOpen={browserSuggestionsOpen}
        browserSuggestions={browserSuggestions}
        browserSuggestionIndex={browserSuggestionIndex}
        browserUrlDraft={browserUrlDraft}
        browserOpening={browserOpening}
        browserMoreOpen={browserMoreOpen}
        browserFind={browserFind}
        browserPasswordPrompt={browserPasswordPrompt}
        browserControlState={browserControlState}
        reviewChanges={reviewChanges}
        reviewFocusChanges={reviewFocusChanges}
        focusToolPanelTab={focusToolPanelTab}
        closeToolPanelTab={closeToolPanelTab}
        scrollToolPanelTabStrip={scrollToolPanelTabStrip}
        setToolPanelAddMenuOpen={setToolPanelAddMenuOpen}
        setConversationToolsOpen={setConversationToolsOpen}
        setBranchMenuOpen={setBranchMenuOpen}
        setCommitPanelOpen={setCommitPanelOpen}
        setRightPanelOpen={setRightPanelOpen}
        setBrowserSuggestionsOpen={setBrowserSuggestionsOpen}
        setBrowserSuggestionIndex={setBrowserSuggestionIndex}
        setBrowserUrlDraft={setBrowserUrlDraft}
        setBrowserFind={setBrowserFind}
        setBrowserMoreOpen={setBrowserMoreOpen}
        setBrowserSection={setBrowserSection}
        setBrowserPasswordsOpen={setBrowserPasswordsOpen}
        setImportDialogOpen={setImportDialogOpen}
        setError={setError}
        setNotice={setNotice}
        setToolPanelTabs={setToolPanelTabs}
        patchBrowserTab={patchBrowserTab}
        openBrowserUrl={openBrowserUrl}
        openBrowserTab={openBrowserTab}
        changeBrowserZoom={changeBrowserZoom}
        browserZoomPercent={browserZoomPercent}
        resetBrowserZoom={resetBrowserZoom}
        openBrowserFind={openBrowserFind}
        printBrowserPage={printBrowserPage}
        captureBrowserScreenshot={captureBrowserScreenshot}
        openBrowserExternal={openBrowserExternal}
        applyBrowserDevice={applyBrowserDevice}
        rotateBrowserDevice={rotateBrowserDevice}
        runBrowserFind={runBrowserFind}
        closeBrowserFind={closeBrowserFind}
        saveBrowserPasswordPrompt={saveBrowserPasswordPrompt}
        dismissBrowserPasswordPrompt={dismissBrowserPasswordPrompt}
        fillSavedPassword={fillSavedPassword}
        activeBrowserWebview={activeBrowserWebview}
        browserWebviewRefFor={browserWebviewRefFor}
        choosePreviewFile={choosePreviewFile}
        openFilePreview={openFilePreview}
        insertFileToken={insertFileToken}
        refreshWorkspace={refreshWorkspace}
        openToolPanelTab={openToolPanelTab}
        shortcutLabel={shortcutLabel}
      />

      {browserSection && (
        <BrowserSectionDialog title={{ history: "历史记录", downloads: "下载记录", clear: "清除浏览数据" }[browserSection]} onClose={() => { if (!browserClearing) setBrowserSection(null); }}>
{browserSection === "downloads" && (<div className="browser-more-downloads" role="group" aria-label="下载">
                        <div className="browser-more-history-head">
                          <span className="browser-more-label">下载</span>
                          {browserActiveDownloadCount > 0 && <span className="browser-more-history-url">{browserActiveDownloadCount} 个进行中</span>}
                        </div>
                        {browserDownloads.length ? (
                          <div className="browser-more-history-list">
                            {browserDownloads.map((entry) => {
                              const percent = entry.total > 0 ? Math.min(100, Math.round((entry.received / entry.total) * 100)) : 0;
                              return (
                                <div className="browser-download-row" key={entry.id}>
                                  <span className="browser-more-history-title" title={entry.path || entry.filename}>{entry.filename}</span>
                                  <span className="browser-more-history-url">
                                    {entry.state === "completed" ? "已完成"
                                      : entry.state === "cancelled" ? "已取消"
                                      : entry.state === "interrupted" ? "已中断"
                                      : entry.total > 0 ? `${percent}%` : "下载中…"}
                                  </span>
                                  <span className="browser-download-actions">
                                    {entry.state === "completed" && entry.path && (
                                      <>
                                        <button  onClick={() => void window.dyworker?.openPath?.(entry.path)}>打开</button>
                                        <button  onClick={() => void window.dyworker?.revealInFolder?.(entry.path)}>所在文件夹</button>
                                      </>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="browser-more-history-empty">本次运行还没有下载</p>
                        )}
                      </div>)}
{browserSection === "history" && (<div className="browser-more-history" role="group" aria-label="本次浏览历史">
                        <div className="browser-more-history-head">
                          <span className="browser-more-label">本次浏览历史</span>
                          {browserSessionHistory.length > 0 && (
                            <button  aria-label="清空历史" title="清空历史" onClick={clearBrowserSessionHistory}>清空</button>
                          )}
                        </div>
                        {browserSessionHistory.length ? (
                          <div className="browser-more-history-list">
                            {browserSessionHistory.map((entry) => (
                              <button
                                key={`${entry.at}-${entry.url}`}

                                title={entry.url}
                                onClick={() => { setBrowserSection(null); void openBrowserUrl(entry.url); }}
                              >
                                <span className="browser-more-history-title">{entry.title || entry.url}</span>
                                <span className="browser-more-history-url">{entry.url}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="browser-more-history-empty">还没有浏览记录</p>
                        )}
                      </div>)}
{browserSection === "clear" && (<div className="browser-more-clear" role="group" aria-label="清除浏览数据">
                        <span className="browser-more-label">清除浏览数据（内置浏览器）</span>
                        {([["cookies", "Cookie 和登录状态"], ["cache", "缓存的图片和文件"], ["siteData", "站点数据和网站设置"]] as const).map(([kind, label]) => (
                          <label className="browser-clear-kind" key={kind}>
                            <input
                              type="checkbox"
                              checked={browserClearKinds[kind]}
                              onChange={(event) => setBrowserClearKinds((current) => ({ ...current, [kind]: event.target.checked }))}
                            />
                            {label}
                          </label>
                        ))}
                        <button  className="browser-clear-button" disabled={browserClearing || !Object.values(browserClearKinds).some(Boolean)} onClick={() => void clearBrowserData()}>清除所选数据</button>
                      </div>)}
        </BrowserSectionDialog>
      )}

      {importDialogOpen && (
        <BrowserImportDialog
          onClose={() => setImportDialogOpen(false)}
          onDone={(message) => {
            setNotice(message);
            refreshImportedHistory();
            // 已打开的页面仍带着旧（未登录）状态，导入后刷新一次让新 Cookie 生效
            for (const webview of browserWebviewsRef.current.values()) webview.reload?.();
          }}
          onError={(message) => setError(message)}
        />
      )}

      {browserPasswordsOpen && (
        <BrowserPasswordsDialog
          activeOrigin={(() => {
            try {
              return new URL(activeToolPanelTab?.kind === "browser" ? activeToolPanelTab.url || "" : "").origin;
            } catch {
              return "";
            }
          })()}
          onFill={() => void fillSavedPassword()}
          onClose={() => setBrowserPasswordsOpen(false)}
        />
      )}

      {skillDraft && (
        <SkillDraftDialog
          initial={skillDraft}
          onClose={() => setSkillDraft(null)}
          onSaved={(item) => {
            setSkillDraft(null);
            void refreshSkills();
            setNotice(`工作模板「${item?.name || ""}」已保存`);
          }}
        />
      )}

      {creationKind && <ExtensionCreationDialog kind={creationKind} workspacePath={composerWorkspacePath}
        onClose={() => setCreationKind(null)} onPrepare={prepareExtensionCreation} />}

      {skillEdit && (
        <SkillEditDialog
          skill={skillEdit}
          onClose={() => setSkillEdit(null)}
          onSaved={() => {
            setSkillEdit(null);
            void refreshSkills();
            setNotice("工作模板已更新");
          }}
        />
      )}

      {memoryEdit && (
        <MemoryEditDialog
          row={memoryEdit}
          onClose={() => setMemoryEdit(null)}
          onSaved={() => {
            setMemoryEdit(null);
            void refreshMemories();
            setNotice("记忆已更新");
          }}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          onCreatePlugin={() => setCreationKind("plugin")}
          sessionId={activeSession?.id}
          sidebarWidth={appliedSidebarWidth}
          value={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={saveProviderSettings}
          saveErrorRef={settingsSaveErrorRef}
          memories={memories}
          onDeleteMemory={(id) => {
            setMemories((current) => current.map((page) => ({ ...page, rows: page.rows.filter((row) => row.id !== id) })));
            void window.dyworker?.deleteMemory(id);
          }}
          onEditMemory={(row) => setMemoryEdit(row)}
          onLintMemories={() => {
            if (!window.dyworker?.lintMemories) return;
            setMemoriesLinting(true);
            setMemoriesLintMessage("");
            void window.dyworker.lintMemories()
              .then(async (result) => {
                setMemoriesLintMessage(result?.ok ? "整理完成：重复与矛盾的记忆已合并修订。" : `整理失败：${result?.error || "未知原因"}`);
                if (window.dyworker?.listMemories) setMemories(await window.dyworker.listMemories());
              })
              .catch((error) => setMemoriesLintMessage(`整理失败：${String(error)}`))
              .finally(() => setMemoriesLinting(false));
          }}
          memoriesLinting={memoriesLinting}
          memoriesLintMessage={memoriesLintMessage}
          skills={skills}
          onToggleSkill={(id, enabled) => {
            setSkills((current) => current.map((item) => item.id === id ? { ...item, enabled } : item));
            setMentionSkills((current) => current.map((item) => item.id === id ? { ...item, enabled } : item));
            void window.dyworker?.setSkillEnabled(id, enabled, workspacePath);
          }}
          onDeleteSkill={(id) => {
            setSkills((current) => current.filter((item) => item.id !== id));
            setMentionSkills((current) => current.filter((item) => item.id !== id));
            void window.dyworker?.deleteSkill(id);
          }}
          onEditSkill={(skill) => setSkillEdit(skill)}
          onRefreshSkills={() => void refreshSkills(true)}
          onOpenSkill={(skill) => {
            if (skill.path) void window.dyworker?.openPath(skill.path);
          }}
          onCreateSkill={() => setCreationKind('skill')}
          schedules={schedules}
          workspaceReady={Boolean(workspacePath)}
          currentWorkspacePath={workspacePath}
          approvalMode={approvalMode}
          onSaveSchedule={saveSchedule}
          onToggleSchedule={toggleSchedule}
          onDeleteSchedule={deleteSchedule}
          onTriggerSchedule={triggerSchedule}
          onOpenScheduleSession={(sessionId) => {
            const target = sessions.find((session) => session.id === sessionId);
            if (!target) {
              setNotice("找不到该运行记录关联的会话，可能已被删除。");
              return;
            }
            setActiveId(sessionId);
            setSettingsOpen(false);
          }}
          usageRecords={usageStats}
          onClearUsage={() => {
            setUsageStats([]);
            void window.dyworker?.clearUsageStats();
          }}
          tab={settingsTab}
          onTabChange={setSettingsTab}
          planSeed={planSeed}
          appUpdate={appUpdate}
          onCheckUpdate={openAppUpdateDialog}
        />
      )}
      {appUpdateDialogOpen && (
        <AppUpdateDialog
          status={appUpdate}
          onClose={() => setAppUpdateDialogOpen(false)}
          onCheck={() => void checkAppUpdate()}
          onDownload={downloadAppUpdate}
          onInstall={installAppUpdate}
        />
      )}
      {fullAccessDialogOpen && (
        <FullAccessDialog
          onClose={() => setFullAccessDialogOpen(false)}
          onConfirm={confirmFullAccess}
        />
      )}
      {identitySetupOpen && <IdentitySetupDialog onChoose={chooseIdentity} />}
      {contextMenu && <ContextMenuPopup menu={contextMenu} onClose={closeContextMenu} />}
      {selectionQuote && (
        <SelectionQuoteBar
          quote={selectionQuote}
          onAddToComposer={addSelectionToComposer}
          onSendToSideChat={sendSelectionToSideChat}
          onClose={() => setSelectionQuote(null)}
        />
      )}
      {annotationEditor && (
        <AnnotationEditorCard
          editor={annotationEditor}
          annotation={annotations.find((item) => item.id === annotationEditor.id) ?? null}
          voiceState={voiceState}
          onVoiceStart={() => {
            voiceTargetRef.current = (text: string) => {
              setAnnotations((current) => current.map((item) => item.id === annotationEditor.id ? { ...item, comment: item.comment ? `${item.comment}\n${text}` : text } : item));
            };
            void toggleVoiceInput();
          }}
          onClose={() => setAnnotationEditor(null)}
          onSave={(comment) => {
            setAnnotations((current) => current.map((item) => item.id === annotationEditor.id ? { ...item, comment } : item));
            setAnnotationEditor(null);
          }}
          onDelete={() => {
            setAnnotations((current) => current.filter((item) => item.id !== annotationEditor.id));
            setAnnotationEditor(null);
          }}
        />
      )}
    </div>
    </>
  );
}

