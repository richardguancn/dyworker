import { resolvePanelShortcut, type PanelShortcut } from "../electron/panel-shortcuts";
import { createTraceBuffer, trimRecentText } from "./traceBuffer";
import { createSessionSaveQueue } from "./sessionSaveQueue";
import { formatMessageTime } from "./lib/format";
import {
  FILE_TOKEN_REGEX,
  INLINE_TOKEN_REGEX,
  SESSION_TOKEN_REGEX,
  copyTextToClipboard,
  displayWorkspace,
  formatSessionReference,
  indexConversation,
  latestWorkingContext,
  messageVisibleText,
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
import { ContextRing } from "./features/usage/UsagePanels";
import { AppUpdateAction, AppUpdateDialog, FullAccessDialog, IdentitySetupDialog } from "./features/settings/SettingsSubPanels";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import type { SettingsTab } from "./features/settings/SettingsDialog";
import { ConversationToolsIcon, ForkBranchIcon, PanelLeftIcon, PanelRightIcon } from "./app/icons";
import { useLayoutStore } from "./state/layoutStore";
import type { ToolPanelTab } from "./state/layoutStore";
import { useSettingsStore } from "./state/settingsStore";
import { useBrowserStore } from "./state/browserStore";
import { useComposerStore } from "./state/composerStore";
import { useSessionStore } from "./state/sessionStore";
import { refreshPendingWakes, updateSession, patchWakingSleepNote, clearSessionNotice, clearSessionError, showSessionNotice, makeSession, deleteSession, resumeSleepingTask, cancelSleepingTask, unarchiveSession, togglePin, toggleWorkspacePin, openWorkspaceInFileManager, archiveSession, renameSession } from "./state/sessionActions";
import { refreshGitInfo, toggleBranchMenu, openCommitPanel, switchBranch, createBranch, generateCommitMessage, runCommit, runPushOnly } from "./state/gitActions";
import { updateToolPanelTab, focusToolPanelTab, openToolPanelTab, openFilePreview, choosePreviewFile, closeToolPanelTab } from "./state/toolPanelActions";
import { resolveTokenFile, resolveTokenSession, openReferencedFile, insertFileToken, handleComposerDragOver, handleComposerDragLeave, handleComposerDrop, handleComposerPaste, openContextMenu, closeContextMenu, handleConversationMouseUp, addSelectionToComposer, sendSelectionToSideChat, updateAnnotationMarkers, handleMessageContextMenu, pasteComposerText, applyMention, chooseWorkspace, chooseAttachments } from "./state/composerActions";
import { openImagePreview, closeImagePreview, navigateImagePreview, toggleVoiceInput, copyMessage, toggleSpeakMessage, togglePlayVoice, startMessageEdit, cancelMessageEdit, speakMessageKey } from "./state/messageActions";
import { openBrowserTab, activateBrowserTabById, closeBrowserTabById, reportBrowserTabState, patchBrowserTab, readWebviewNavState, reportActiveBrowserContents, prepareGuestPage, bindBrowserWebview, browserWebviewRefFor, openBrowserUrl, activeBrowserWebview, openBrowserFind, runBrowserFind, closeBrowserFind, browserZoomPercent, changeBrowserZoom, resetBrowserZoom, captureBrowserScreenshot, openBrowserExternal, clearBrowserSessionHistory, dismissBrowserPasswordPrompt, saveBrowserPasswordPrompt, fillSavedPassword, printBrowserPage, applyBrowserDevice, rotateBrowserDevice, clearBrowserData } from "./state/browserActions";
import { pluginPanelPreferences } from "./state/pluginPreferences";
import { sendMessage, removeQueuedMessage, cancelQueuedMessage, runQueuedMessageNow } from "./state/sendMessageActions";
import { createTask, forkSession, applyWorkspaceSelection, closeFilePanelTabs, prepareExtensionCreation, handleGoalAction, sessionPendingInboxCount, jumpToConversationTurn, clearWorkspace, exportSessionMarkdown, exportSessionPackage, exportProjectPackage, importSessionPackage, summarizeSessionToSkill, openAnnotationList, scheduleCloseAnnotationList, toggleTerminal } from "./state/taskActions";
import { wakingSessionsRef, sessionNoticeTimersRef, sessionErrorTimersRef, sessionsRef, sessionDraftsRef, activeIdRef, activeToolPanelTabIdRef, browserResumeGuardRef, browserWebviewRefCallbacks, browserWebviewsRef, closeToolPanelTabRef, openFilePreviewRef, toolPanelTabSequenceRef, toolPanelTabsRef, textareaRef, viewportRef, mentionTokenPathsRef, sessionTokenIdsRef, annotationQuotesRef, dismissedPluginMention, workspaceFilesRef, mentionItemsRef, createTaskRef, selectSessionRef, conversationTurnRefs, recorderRef, microphoneStreamRef, voiceTargetRef, queuedRunsRef, agentUnsubscribeRefs, runningRunIdsRef, shouldScrollToBottomRef, attachmentsRef, handleGoalActionRef, refreshMemoriesRef, refreshSkillsRef, queueDebugLogRef, appendSessionTracesRef, playCompletionSoundRef, bootstrapFailedRef, settingsSaveErrorRef, composerModelsKeyRef, manualRunScheduleRef, pendingDebugLogsRef, recentDebugLogsRef, debugLogFlushTimerRef, tracePublishTimerRef, sessionSaveMountedRef, sessionSaveRetryRef, messageRowRefs, conversationSearchInputRef, searchMatchRangesRef, searchScrollKeyRef, appShellRef, panelGeometryRef, panelResizeRef, composerRef, composerPastesRef, annotationsRef, lastActiveIdRef, browserPanelCommandsRef } from "./state/sharedRefs";
import { saveProviderSettings, checkAppUpdate, openAppUpdateDialog, downloadAppUpdate, installAppUpdate, chooseIdentity, selectApprovalMode, confirmFullAccess, activateModelProfile, ensureComposerModels, switchComposerModel } from "./state/settingsActions";
import { saveSchedule, toggleSchedule, deleteSchedule, triggerSchedule } from "./state/scheduleActions";
import { refreshMemories, refreshSkills, refreshImportedHistory, syncAtBottom, refreshWorkspace } from "./state/panelActions";
import { useInboxStore } from "./state/inboxStore";
import { usePanelStore } from "./state/panelStore";
import { useViewStore } from "./state/viewStore";
import { useSessionIpcRuntime } from "./state/sessionIpcRuntime";
import { useSessionStreamRuntime } from "./state/sessionStreamRuntime";
import { useStartupRuntime } from "./state/startupRuntime";
import { previewSessions } from "./state/previewData";
import { Sidebar } from "./app/Sidebar";
import { ShellChrome } from "./app/ShellLayout";
import { ConversationPane } from "./features/conversation/ConversationPane";
import { ToolPanel } from "./features/toolpanel/ToolPanel";
import { defaultSettings } from "./lib/settings";
import { settingsForSession } from "../electron/session-model.mts";
import { ArchivedPlan, PlanProgress } from "./PlanProgress";
import { GoalBanner } from "./GoalBanner";
import { AppLogo } from "./AppLogo";
import { goalElapsed, startGoal } from "./goal";
import { FilePreviewPanel } from "./FilePreviewPanel";
import { FileBrowserToolbar } from "./FileBrowserToolbar";
import { FileTextEditor } from "./FileTextEditor";
import { ExtensionCreationDialog } from './ExtensionCreationDialog';
import { getModelReasoningConfig, reasoningModelKey, selectedReasoningEffort, updateReasoningOverride } from '../electron/model-reasoning.ts';
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
import { availablePluginPanels, pluginPanelTab } from "./pluginPanelTabs";
import type { PluginPanelTab } from "./pluginPanelTabs";
import { clientHost, onOpenSessionRequest } from "./pluginRuntime/clientHostSingleton.ts";
import type { RegisteredInputCandidate } from './pluginRuntime/inputTriggers.ts';
import { detectTrigger } from './pluginRuntime/vendor/dsh-input-controller/index.js';
import { DshChildHistory } from './DshChildHistory';
import { reconcileDshTurns, patchDshAssistant, mergeCreatedDshTask } from './dshTurns';
import { DshComposer } from './DshComposer';
import type { ComposerHandle } from './pluginRuntime/dshDraftEditor.ts';
import { loadEnabledClientHalves } from "./pluginRuntime/builtinPlugins.ts";
import { copyImageToClipboard, ImageAttachmentThumb, ImageAttachmentView, rememberLocalImageData } from "./ImageAttachment";
import { contextUsageSummary, estimateSessionTokens, formatTokenCount } from "./contextUsage";
import { InteractiveMessage, MarkdownSnippet } from "./InteractiveMessage";
import { TokenActivity } from "./TokenActivityPanel";
import type { MarkdownLiveEditorHandle } from "./markdownLiveEditor";
import { TraceConsole } from "./TraceConsole";
import { BackgroundTasksPanel } from "./BackgroundTasksPanel";
import { SystemMessagesPanel } from "./SystemMessagesPanel";
import { BrowserControlOverlay } from "./BrowserControlOverlay";
import type { ChannelStreamRef, ChannelStreamRuns } from "./channelStream";
import type { ActivityRecord, AgentResult, AppUpdateStatus, ApprovalAction, ApprovalMode, Attachment, BrowserControlState, BrowserImportKinds, BrowserImportSource, ChannelConnectionStatus, ChannelsConfig, ChannelsStatusMap, ChatMessage, DebugLogEntry, FileChange, GitBranchesInfo, GitDiffStats, GitReviewFile, GitReviewOverview, HookRule, ImportedHistoryEntry, InboxItem, MessageAnnotation, QuestionRequest, ReviewerLocalStatus, ScheduleRecord, SessionRecord,  SkillLibraryConfig, SkillLibrarySearchResult, SkillRecord, StandingRule, TelemetrySettings, TelemetryStatus, TtsLocalStatus, TraceEvent, UsageRecord, VoiceLocalStatus, WikiMemoryPage, WikiMemoryRow, WorkspaceContext, WorkspaceEntry } from "./types";
import { formatAnnotationsForPrompt, normalizeQuote, type AnnotationQuote } from "./annotations";
import { isGlmNativeVisionModel, modelContextLimit, usesResponsesApi } from "./providers";
import { ReasoningControl } from "./ReasoningControl";
import { hasConfiguredModel, isLocalModelEndpoint } from "../electron/host/dsh-runtime/model-settings.mts";
import { recordTaskFailure } from './taskFailure.ts';
import { assistantImageAttachments } from './assistantImages.ts';
import { beginSession, discardSession } from "./appearance/controller";
import { formatWakeTime, wakingNoteTexts } from "./wakeNote";
import { contentEchoesProcessCommentary, messageWithDeliveryContent, processActivitiesWithCommentary } from "./processCommentary.ts";
import { ClampedUserText, renderInlineTokens } from "./features/message/ClampedText";
import { isVoiceAttachment, isVoiceMessage, VoiceMessageBubble } from "./features/message/VoiceMessage";
import { ProcessTimeline, RunningStatusLabel } from "./features/message/ProcessTimeline";

// 兼容既有引用（tests/fixtures/file-browser.tsx 等）从 App 引入文件面板
export { FilesSplitPanel };

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
playCompletionSoundRef.current = playCompletionSound;

// ===== Codex 风格右侧面板:文本文件判断 / 代码查看 / 审阅 diff =====

// ===== 浏览器「导入 Cookie 和密码」对话框（对照 Codex 浏览器更多菜单） =====

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
  // 只有长文块或注释入口时，由入口本身承载内容，不再套一层气泡。
  const bubbleBare = message.role === "user"
    && Boolean(message.annotations?.length || message.pasteBlocks?.length)
    && !isVoiceMessage(message)
    && !messageVisibleText(message).trim()
    && !legacySkillChips.length
    && !message.attachments?.some((attachment) => !attachment.isImage && !attachment.inlineRef && !isVoiceAttachment(attachment))
    && !message.dshAttachmentNames?.length;
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
  // 输入区 / 语音 / 标注类状态已迁到 zustand store（字段名与 setter 与原先的 useState 一致）。
  const {
    composer, setComposer, composerPastes, setComposerPastes, expandedPasteId, setExpandedPasteId,
    annotations, setAnnotations, selectionQuote, setSelectionQuote, annotationEditor, setAnnotationEditor,
    annotationListOpen, setAnnotationListOpen, annotationMarkers, setAnnotationMarkers,
    sideChatSeed, setSideChatSeed, attachments, setAttachments, composerDragActive, setComposerDragActive,
    voiceState, setVoiceState, composerModels, setComposerModels, composerModelsLoading, setComposerModelsLoading,
    mentionMenu, setMentionMenu, mentionIndex, setMentionIndex, mentionSkills, setMentionSkills,
    pluginInputCandidates, setPluginInputCandidates, pluginInputRevision, setPluginInputRevision,
    activeSkills, setActiveSkills, speakingMessageKey, setSpeakingMessageKey, speakingLoadingKey, setSpeakingLoadingKey,
    playingVoicePath, setPlayingVoicePath, voiceLoadingPath, setVoiceLoadingPath,
  } = useComposerStore();
  // 会话 / 工作区 / Git / 运行态 state 已迁到 zustand store（字段名与 setter 与原先的 useState 一致）。
  const {
    sessions, setSessions, newTaskDraft, setNewTaskDraft, activeId, setActiveId,
    workspacePath, setWorkspacePath, workspaceContext, setWorkspaceContext,
    gitInfo, setGitInfo, branchMenuOpen, setBranchMenuOpen, branchQuery, setBranchQuery,
    creatingBranch, setCreatingBranch, newBranchName, setNewBranchName,
    commitPanelOpen, setCommitPanelOpen, commitMessage, setCommitMessage,
    includeUnstaged, setIncludeUnstaged, diffStats, setDiffStats, gitBusy, setGitBusy,
    workspaceEntries, setWorkspaceEntries, pinnedWorkspacePaths, setPinnedWorkspacePaths,
    query, setQuery, composerSessionId, setComposerSessionId,
    runningSessionIds, setRunningSessionIds, sleepingSessions, setSleepingSessions,
    wakingSessions, setWakingSessions, runningStartedAt, setRunningStartedAt,
    scheduledRunSessions, setScheduledRunSessions, pendingAutoOpenSessionId, setPendingAutoOpenSessionId,
    sessionErrors, setSessionErrors, sessionNotices, setSessionNotices,
    pendingApprovals, setPendingApprovals, pendingQuestions, setPendingQuestions,
    skillSummarySessionId, setSkillSummarySessionId, loopStates, setLoopStates,
    dshChildHistory, setDshChildHistory,
  } = useSessionStore();
  // 收件箱 / 系统消息 / 导入记录类状态已迁到 zustand store（字段名与 setter 与原先的 useState 一致）。
  const {
    inboxItems, setInboxItems, inboxOpen, setInboxOpen, inboxTab, setInboxTab,
    systemMessageFocusId, setSystemMessageFocusId, systemMessagesUnread, setSystemMessagesUnread,
    importedHistory, setImportedHistory, fullAccessDialogOpen, setFullAccessDialogOpen,
  } = useInboxStore();
  // 右侧面板 / 记忆 / 技能 / 计划 / 调试诊断类状态已迁到 zustand store（字段名与 setter 与原先的 useState 一致）。
  const {
    memories, setMemories, memoriesLinting, setMemoriesLinting, memoriesLintMessage, setMemoriesLintMessage,
    skills, setSkills, schedules, setSchedules, usageStats, setUsageStats,
    debugLogs, setDebugLogs, traceEvents, setTraceEvents, planSeed, setPlanSeed,
    skillDraft, setSkillDraft, creationKind, setCreationKind, memoryEdit, setMemoryEdit,
    skillEdit, setSkillEdit, pluginPanelChoices, setPluginPanelChoices,
  } = usePanelStore();
  // 视图 / 提示 / 搜索 / 交互浮层类状态已迁到 zustand store（字段名与 setter 与原先的 useState 一致）。
  const {
    error, setError, notice, setNotice, ready, setReady,
    hoveredTurnIndex, setHoveredTurnIndex, atBottom, setAtBottom,
    collapsedActivities, setCollapsedActivities, editingMessage, setEditingMessage,
    imagePreview, setImagePreview, imagePreviewPeers, setImagePreviewPeers,
    reviewFocusChanges, setReviewFocusChanges, conversationSearchOpen, setConversationSearchOpen,
    conversationSearchQuery, setConversationSearchQuery, conversationSearchMatchIndex, setConversationSearchMatchIndex,
    conversationMatchTotal, setConversationMatchTotal, queuedRunIds, setQueuedRunIds,
    queueMenuRunId, setQueueMenuRunId, contextMenu, setContextMenu,
    viewportNode, setViewportNode, composerDockNode, setComposerDockNode,
  } = useViewStore();
  const activeSession = newTaskDraft?.id === activeId ? newTaskDraft : sessions.find((session) => session.id === activeId) || sessions[0];

  // 面板关闭时仅保存最近记录，不触发主界面更新；历史在控制台打开后按需读取。
  const traceBuffer = useMemo(() => createTraceBuffer(), []);

  // 启动 / 布局 / 订阅类 effect 已整块搬到 startupRuntime（保持 effect 相对顺序不变）
  useStartupRuntime({ activeSession, traceBuffer });
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
  // 平台标识初始值同步取自 preload（process.platform），首帧就能渲染正确布局，
  // 不会先按未知平台画出自绘标题栏再闪改（mac 红绿灯会盖到 DYWorker 文字上）
  const closeDshChildHistory = useCallback(() => setDshChildHistory(null), []);
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
  const debugOpenRef = useRef(debugOpen);
  debugOpenRef.current = debugOpen;
  // debug-log 事件频率与模型流式对齐，逐条 setState 会让整个 App 高频重渲染；
  // 先进 ref 缓冲，1 秒合并刷入一次（TraceConsole 是诊断视图，秒级延迟无感知）
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
  queueDebugLogRef.current = queueDebugLog;
  const appendSessionTraces = useCallback((records: TraceEvent[]) => {
    if (!traceBuffer.append(records) || !debugOpenRef.current || tracePublishTimerRef.current !== null) return;
    tracePublishTimerRef.current = window.setTimeout(() => {
      tracePublishTimerRef.current = null;
      if (debugOpenRef.current) setTraceEvents(traceBuffer.snapshot());
    }, 100);
  }, [traceBuffer]);
  appendSessionTracesRef.current = appendSessionTraces;
  const imagePreviewIndex = imagePreview
    ? imagePreviewPeers.findIndex((peer) => (peer.path || peer.previewUrl || "") === (imagePreview.path || imagePreview.url))
    : -1;
  // 对话区在机器人团队页/设置页之间会被整棵卸载重挂（App 主区域的条件分支），
  // 用 state 承载节点，让依赖它们的 effect 在重挂后重新绑定
  // 必须是稳定引用：内联箭头每次渲染都会先 ref(null) 再 ref(node)，
  // 会让依赖 viewportNode 的贴底跟随 effect 每次渲染都重建并强制滚到底部
  const bindViewport = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    setViewportNode(node);
  }, []);
  // @引用高亮镜像层：与 textarea 同步滚动，保持 token 背景对齐
  const composerMirrorRef = useRef<HTMLDivElement>(null);
  panelGeometryRef.current = { rightPanelOpen, sidebarOpen, appliedSidebarWidth, appliedToolPanelWidth };
  const composingRef = useRef(false);


  // 渠道流式气泡登记（跨两个长期存活的监听器共享）：
  // sessionId → 占位消息 id（实时事件归约用）；runId → 占位位置（收尾 append 原位替换用）。
  // 定时计划运行（scheduleRun 打标）复用同一套登记：它的占位气泡同样按会话清理。
  const channelStreamIdsRef = useRef<Map<string, string>>(new Map());
  const channelStreamRunsRef: { current: ChannelStreamRuns } = useRef(new Map<string, ChannelStreamRef>());

  // 所有平台共用应用工具栏；最大化状态在首帧绘制前同步。
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("window-maximized", windowMaximized);
  }, [windowMaximized]);

  useSessionIpcRuntime({
    channelStreamRunsRef, channelStreamIdsRef, runningRunIdsRef, manualRunScheduleRef, activeIdRef, wakingSessionsRef,
    refreshPendingWakes, showSessionNotice, patchWakingSleepNote,
  });

  // 渠道（QQ/微信）/定时计划会话实时进度：主进程在任务运行期间把关键 agent 事件
  // （活动流、正文流式、计划、循环状态、任务结束）通过 agent:event 转发过来（渠道信封带
  // channelRun: true，计划运行带 scheduleRun: true），这里归约进对应会话的消息，让它们在
  // 界面上边跑边显示，而不是等全部结束才一次性落库。与 runTask 内的监听器互不干扰：
  // 它只处理 taskSessionId+taskRunId，不碰这两类会话；这里只认显式打标的信封，
  // 桌面端在渠道会话里发起的运行（无标记）不会被重复渲染成第二个气泡。
  // 两类运行共用同一套占位气泡归约：计划会话的占位气泡在 schedules:run-started 时就已建好，
  // ensureChannelAssistant 只是兜底（信封先到、run-started 后到的极端时序）。
  useSessionStreamRuntime({
    channelStreamIdsRef, channelStreamRunsRef, runningRunIdsRef, sessionsRef,
    updateSession, showSessionNotice, refreshPendingWakes, playCompletionSound,
  });

  refreshMemoriesRef.current = refreshMemories;
  refreshSkillsRef.current = refreshSkills;

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
  const activePendingApproval = activeSession?.id ? pendingApprovals[activeSession.id] || null : null;
  const activePendingQuestion = activeSession?.id ? pendingQuestions[activeSession.id] || null : null;
  const activeLoopState = activeSession?.id ? loopStates[activeSession.id] || null : null;
  const inboxPendingCount = inboxItems.filter((item) => item.status === "pending").length;
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

  // 注册 createTask 给 composerActions：applyMention 触发内置 /new 时调用
  createTaskRef.current = createTask;

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
  // 刷新 @token 解析用的文件列表镜像：composerActions 读 workspaceFilesRef.current
  workspaceFilesRef.current = workspaceFiles;

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

  // 注释增删、编辑、切换会话或消息变化时更新引用列表
  useEffect(() => {
    const quotes: AnnotationQuote[] = [
      ...annotations.map((annotation, index) => ({ ...annotation, n: index + 1 })),
      ...(activeSession?.messages ?? []).flatMap((message, messageIndex) =>
        (message.annotations ?? []).map((annotation, index) => ({
          id: `${message.id ?? messageIndex}-${annotation.id}`,
          n: index + 1,
          quote: annotation.quote,
          comment: annotation.comment,
        }))),
    ];
    annotationQuotesRef.current = quotes;
    // 等正文完成布局后统一定位，避免同一轮消息更新重复测量。
    const frame = requestAnimationFrame(updateAnnotationMarkers);
    return () => cancelAnimationFrame(frame);
  }, [annotations, activeId, activeSession?.messages]);
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
  // 刷新 @// 候选镜像：composerActions 的 applyMention 读 mentionItemsRef.current
  mentionItemsRef.current = mentionItems;

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

  // 右侧面板快捷键（Codex 风格）：macOS 显示 ⌘/⌥/⌃，Windows/Linux 用 Ctrl/Alt 组合
  const isMacPlatform = platform === "darwin";
  const shortcutLabel = (mac: string, other: string) => (isMacPlatform ? mac : other);

  // 处理器经 ref 读取最新状态，effect 只在挂载时挂一次监听；
  // 此前无依赖数组，流式期间每个 token 都 remove+add 一次 window keydown
  const panelShortcutHandlerRef = useRef<(action: PanelShortcut) => void>(() => {});
  panelShortcutHandlerRef.current = (action) => {
    // 模态窗口内保留当前输入；普通输入框和终端仍能使用面板快捷键。
    if (document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return;
    setToolPanelAddMenuOpen(false);
    if (action === "terminal") { toggleTerminal(); return; }
    setRightPanelOpen(true);
    if (action === "browser") openBrowserTab();
    else openToolPanelTab(action);
  };
  const keydownHandlerRef = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  keydownHandlerRef.current = (event) => {
    if (event.defaultPrevented) return;
    const action = resolvePanelShortcut(event, platform);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) panelShortcutHandlerRef.current(action);
  };
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => keydownHandlerRef.current(event);
    window.addEventListener("keydown", onKeyDown, true);
    const unsubscribe = window.dyworker?.onPanelShortcut?.(action => panelShortcutHandlerRef.current(action));
    return () => { window.removeEventListener("keydown", onKeyDown, true); unsubscribe?.(); };
  }, []);

  const activeToolPanelTab = toolPanelTabs.find((tab) => tab.id === activeToolPanelTabId) || toolPanelTabs[0];
  const activeToolPanelKind = activeToolPanelTab?.kind || "browser";

  // 每次渲染刷新镜像：ref 回调与 webview 事件闭包里读最新值
  activeToolPanelTabIdRef.current = activeToolPanelTabId;
  toolPanelTabsRef.current = toolPanelTabs;

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

  useEffect(() => { setReviewFocusChanges(null); }, [activeId]);

  const activeBrowserUrl = activeToolPanelTab?.kind === "browser" ? activeToolPanelTab.url || "" : "";

  // 加载已导入的浏览记录（地址栏联想）；导入成功后由对话框回调刷新
  useEffect(refreshImportedHistory, []);

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

  handleGoalActionRef.current = handleGoalAction;

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

  const composerSettings = settingsForSession(settings, activeSession);
  const hasModel = hasConfiguredModel(composerSettings);
  // 输入框的合并胶囊：模型名 · 当前思考档位（模型没有可调档位时只显示模型名）
  const composerReasoningConfig = hasModel
    ? getModelReasoningConfig({ endpoint: composerSettings.endpoint, model: composerSettings.model, overrides: settings.reasoningOverrides })
    : null;
  const composerEffortValue = composerReasoningConfig?.efforts.length
    ? selectedReasoningEffort(composerReasoningConfig, composerSettings.reasoningEffort)
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
      && activeSession.contextModel === composerSettings.model
      && activeSession.contextEndpoint === composerSettings.endpoint) {
      return {
        used: activeSession.contextTokens,
        limit: modelContextLimit(composerSettings.model, composerSettings.endpoint),
        exact: Boolean(activeSession.contextTokensExact),
      };
    }
    const tokens = estimateSessionTokens(activeSession?.messages || [], activeSession?.workingContext || "");
    return { used: tokens, limit: modelContextLimit(composerSettings.model, composerSettings.endpoint), exact: false };
  }, [
    activeSession?.messages,
    activeSession?.workingContext,
    activeSession?.contextTokens,
    activeSession?.contextTokensExact,
    activeSession?.contextModel,
    activeSession?.contextEndpoint,
    composerSettings.model,
    composerSettings.endpoint,
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
  // 注册 selectSession 给 forkSession：分叉出新任务后走与点侧栏列表项一致的切换流程
  selectSessionRef.current = selectSession;

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
      active: activeToolPanelTab?.kind === "review",
      visible: true,
      onClick: () => { setRightPanelOpen(true); openToolPanelTab("review"); },
    },
    {
      key: "terminal",
      icon: <SquareTerminal size={18} />,
      label: "终端",
      shortcut: shortcutLabel("⌃`", "Ctrl+`"),
      active: terminalOpen,
      visible: terminalAvailable,
      onClick: toggleTerminal,
    },
    {
      key: "browser",
      icon: <Globe size={18} />,
      label: "浏览器",
      shortcut: shortcutLabel("⌘T", "Ctrl+T"),
      active: activeToolPanelTab?.kind === "browser",
      visible: true,
      onClick: () => { setRightPanelOpen(true); openToolPanelTab("browser"); },
    },
    {
      key: "files",
      icon: <FolderOpen size={18} />,
      label: "文件",
      shortcut: shortcutLabel("⌘P", "Ctrl+P"),
      active: activeToolPanelTab?.kind === "files",
      visible: true,
      onClick: () => { setRightPanelOpen(true); openToolPanelTab("files"); },
    },
    {
      key: "side-chat",
      icon: <MessageSquarePlus size={18} />,
      label: "侧边聊天",
      shortcut: shortcutLabel("⌥⌘S", "Ctrl+Alt+S"),
      active: activeToolPanelTab?.kind === "chat",
      visible: true,
      onClick: () => { setRightPanelOpen(true); openToolPanelTab("chat"); },
    },
    {
      key: "tasks",
      icon: <ListTree size={18} />,
      label: "后台任务",
      shortcut: "",
      active: activeToolPanelTab?.kind === "tasks",
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

  const onToolPanelMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  const toolPanelMenu = (
    <div className="tool-panel-menu" role="menu" aria-label="右侧工具" onKeyDown={onToolPanelMenuKeyDown}>
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
          {item.shortcut && <kbd className="tool-panel-shortcut">{item.shortcut}</kbd>}
        </button>
      ))}
    </div>
  );

  // + 按钮的下拉菜单（对照 Codex：已打开为标签页的类型不再出现，终端始终可选）。
  // 浏览器例外：它支持多开，每次点都新开一个标签页，所以始终出现在列表里。
  const addMenuItems = toolPanelMenuItems.filter((item) => {
    if (!item.visible) return false;
    if (item.key === "terminal") return true;
    if (item.key === "browser") return true;
    if (item.key.startsWith("plugin-")) return !toolPanelTabs.some(tab => tab.id === item.key);
    const kind = item.key === "side-chat" ? "chat" : item.key;
    return !toolPanelTabs.some((tab) => tab.kind === kind);
  });
  const toolPanelAddMenu = toolPanelAddMenuOpen && (
    <div className="session-menu tool-panel-add-menu" role="menu" aria-label="添加右侧工具" onKeyDown={onToolPanelMenuKeyDown} data-menu-root>
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
          {item.key === "review" && reviewChanges.length > 0 && <small className="tool-panel-count">{reviewChanges.length}</small>}
          {item.shortcut && <kbd className="tool-panel-shortcut">{item.shortcut}</kbd>}
        </button>
      ))}
    </div>
  );

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
        exportSessionPackage={exportSessionPackage}
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
        exportSessionPackage={exportSessionPackage}
        exportProjectPackage={exportProjectPackage}
        importSessionPackage={importSessionPackage}
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
        settings={composerSettings}
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

