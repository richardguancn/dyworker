// 会话区面板：从 App.tsx 抽出的 <main className={`main-panel`}> 整段（会话视图标签、会话搜索、
// 回合导航、消息流、终端/调试/收件箱浮层、输入区 dock 与发送区）。
// 机械搬运，不改类名/文案/aria；App 内部逻辑（sendMessage、updateComposer、beginPanelResize、
// 各种 useEffect 等）仍留在 App.tsx，这里只通过 props 接收状态与回调。
import { ArrowDown, ArrowUp, AtSign, Check, ChevronDown, ChevronUp, CornerUpLeft, FileCode2, FileText, Folder, FolderOpen, GitBranch, LoaderCircle, MessageSquare, Mic, Moon, MoreHorizontal, Paperclip, Pencil, Play, Plus, Search, Settings, Slash, Sparkles, Square, Trash2, X } from "lucide-react";
import type { ClipboardEvent, ComponentType, Dispatch, DragEvent, KeyboardEvent, MouseEvent, RefObject, SetStateAction } from "react";
import { ContextRing } from "../usage/UsagePanels";
import { composerApprovalModes } from "../plans/PlansPanel";
import { displayWorkspace, indexConversation, messageVisibleText, shortTitle } from "../../lib/text";
import { ApprovalCard, QuestionCard } from "../message/Cards";
import { ImageLightbox } from "../message/ImageLightbox";
import { RunningStatusLabel } from "../message/ProcessTimeline";
import { renderInlineTokens } from "../message/ClampedText";
import type { SettingsTab } from "../settings/SettingsDialog";
import { InboxDialog } from "../inbox/InboxDialog";
import { DshComposer } from "../../DshComposer";
import { TraceConsole } from "../../TraceConsole";
import { GoalBanner } from "../../GoalBanner";
import { PlanProgress } from "../../PlanProgress";
import { ModsPanelView } from "../../ModsPluginsPage";
import { ReasoningControl } from "../../ReasoningControl";
import { ImageAttachmentThumb } from "../../ImageAttachment";
import { PluginSlotView } from "../../PluginSlotView";
import { formatWakeTime } from "../../wakeNote";
import { clientHost } from "../../pluginRuntime/clientHostSingleton.ts";
import type { ComposerHandle } from "../../pluginRuntime/dshDraftEditor.ts";
import { getModelReasoningConfig, reasoningModelKey, updateReasoningOverride } from "../../../electron/model-reasoning.ts";
import type { ApprovalAction, ApprovalMode, Attachment, ChatMessage, DebugLogEntry, InboxItem, MessageAnnotation, ModelProfile, PendingWakeRecord, ProviderSettings, QuestionRequest, SessionRecord, TraceEvent, WorkspaceContext } from "../../types";

type WakingSessionEntry = { wakeAt: string; manual?: boolean; marker: string; done: string };

type ConversationComposerPaste = { id: string; text: string };

type MessageRowActions = {
  openReferencedFile: (...args: never[]) => unknown;
  openImagePreview: (...args: never[]) => unknown;
  handleMessageContextMenu: (...args: never[]) => unknown;
  togglePlayVoice: (...args: never[]) => unknown;
  toggleActivityCollapse: (...args: never[]) => unknown;
  copyMessage: (...args: never[]) => unknown;
  startMessageEdit: (...args: never[]) => unknown;
  toggleSpeakMessage: (...args: never[]) => unknown;
  openMessageSession: (...args: never[]) => unknown;
  forkSessionAt: (...args: never[]) => unknown;
  openPluginReference: (...args: never[]) => unknown;
  openReview: (...args: never[]) => unknown;
  bindMessageRow: (...args: never[]) => unknown;
};

interface MessageRowProps {
  message: ChatMessage;
  index: number;
  turnIndex: number;
  sessionId: string;
  workspacePath: string;
  isEditing: boolean;
  activeTaskRunning: boolean;
  isStreamingMessage: boolean;
  playingVoicePath: string | null;
  voiceLoadingPath: string | null;
  speakingMessageKey: string | null;
  speakingLoadingKey: string | null;
  collapsedActivities: Set<string>;
  actions: MessageRowActions;
}

export interface ConversationPaneProps {
  ConversationMessageRow: ComponentType<MessageRowProps>;
  messageRowActions: MessageRowActions;

  activeSession: SessionRecord;
  workspacePath: string;
  composerWorkspacePath: string;
  workspaceContext: WorkspaceContext | null;
  activeId: string;

  botTeamPageOpen: boolean;
  botTeamAvailable: boolean;
  botTeamProvider: string;
  pluginsPageOpen: boolean;
  settingsOpen: boolean;

  conversationView: string;
  setConversationView: Dispatch<SetStateAction<string>>;
  pluginConversationViews: Array<{ key: string; label: string }>;

  conversationSearchOpen: boolean;
  setConversationSearchOpen: Dispatch<SetStateAction<boolean>>;
  conversationSearchQuery: string;
  setConversationSearchQuery: Dispatch<SetStateAction<string>>;
  conversationSearchMatchIndex: number;
  setConversationSearchMatchIndex: Dispatch<SetStateAction<number>>;
  conversationMatchTotal: number;
  conversationSearchInputRef: RefObject<HTMLInputElement | null>;

  conversationIndex: ReturnType<typeof indexConversation>;
  conversationTurns: ReturnType<typeof indexConversation>["turns"];
  hoveredTurnIndex: number | null;
  setHoveredTurnIndex: Dispatch<SetStateAction<number | null>>;
  jumpToConversationTurn: (turnIndex: number) => void;

  bindViewport: (node: HTMLDivElement | null) => void;
  viewportRef: RefObject<HTMLDivElement | null>;
  syncAtBottom: () => void;
  setSelectionQuote: Dispatch<SetStateAction<{ text: string; x: number; y: number } | null>>;
  handleConversationMouseUp: () => void;
  atBottom: boolean;

  editingMessage: { sessionId: string; messageIndex: number; original: ChatMessage } | null;
  activeTaskRunning: boolean;
  activeScheduledRun: boolean;
  streamingAssistantIndex: number;
  playingVoicePath: string | null;
  voiceLoadingPath: string | null;
  speakingMessageKey: string | null;
  speakingLoadingKey: string | null;
  collapsedActivities: Set<string>;
  queuedRunIds: Set<string>;

  activeLoopState: { iteration: number; maximum: number; status: string } | null;
  runningStartedAt: Record<string, number>;
  activeWaking: WakingSessionEntry | undefined;

  activePendingApproval: ApprovalAction | null;
  setPendingApprovals: Dispatch<SetStateAction<Record<string, ApprovalAction>>>;
  activePendingQuestion: QuestionRequest | null;
  setPendingQuestions: Dispatch<SetStateAction<Record<string, QuestionRequest>>>;
  activeSessionPendingInboxApproval: InboxItem | null;
  activeSessionPendingInboxQuestion: InboxItem | null;
  setInboxItems: Dispatch<SetStateAction<InboxItem[]>>;

  annotationMarkers: Array<{ id: string; n: number; top: number; left: number }>;

  terminalMounted: boolean;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  setTerminalOpen: Dispatch<SetStateAction<boolean>>;

  debugOpen: boolean;
  setDebugOpen: Dispatch<SetStateAction<boolean>>;
  activeSessionTraceEvents: TraceEvent[];
  debugLogs: DebugLogEntry[];
  setDebugLogs: Dispatch<SetStateAction<DebugLogEntry[]>>;
  traceBuffer: { clear: () => void };
  setTraceEvents: Dispatch<SetStateAction<TraceEvent[]>>;
  pendingDebugLogsRef: RefObject<DebugLogEntry[]>;
  recentDebugLogsRef: RefObject<DebugLogEntry[]>;
  debugLogFlushTimerRef: RefObject<number | null>;
  appendSessionTraces: (records: TraceEvent[]) => void;

  inboxOpen: boolean;
  setInboxOpen: Dispatch<SetStateAction<boolean>>;
  inboxItems: InboxItem[];
  inboxTab: "inbox" | "messages";
  systemMessageFocusId: string;
  setSystemMessageFocusId: Dispatch<SetStateAction<string>>;

  imagePreview: { url: string; name: string; path?: string } | null;
  closeImagePreview: () => void;
  imagePreviewIndex: number;
  imagePreviewPeers: Array<Pick<Attachment, "path" | "previewUrl" | "name">>;
  navigateImagePreview: (direction: -1 | 1) => void;
  setNotice: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;

  setComposerDockNode: Dispatch<SetStateAction<HTMLDivElement | null>>;
  error: string;
  activeSessionError: string;
  activeSessionNotice: string;
  notice: string;
  clearSessionError: (sessionId: string) => void;
  clearSessionNotice: (sessionId: string) => void;

  activeSleeping: PendingWakeRecord | undefined;
  activeQueuedMessages: Array<{ message: ChatMessage; messageIndex: number }>;
  resumeSleepingTask: (sessionId: string) => void;
  cancelSleepingTask: (sessionId: string) => void;
  runQueuedMessageNow: (entry: { message: ChatMessage; messageIndex: number }) => void;
  removeQueuedMessage: (runId: string, messageIndex: number, notice?: string) => void;
  setQueueMenuRunId: Dispatch<SetStateAction<string | null>>;
  queueMenuRunId: string | null;
  startMessageEdit: (message: ChatMessage, messageIndex: number) => void;
  copyMessage: (message: ChatMessage) => void;

  handleGoalAction: (sessionId: string, action: "pause" | "resume" | "remove" | "complete") => Promise<void>;
  chooseWorkspace: () => void;
  clearWorkspace: () => void;

  composerDragActive: boolean;
  handleComposerDragOver: (event: DragEvent<HTMLDivElement>) => void;
  handleComposerDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  handleComposerDrop: (event: DragEvent<HTMLDivElement>) => void;

  cancelQueuedMessage: () => void;
  cancelMessageEdit: () => void;
  mentionMenu: { kind: "slash" | "at"; query: string; start: number; end?: number; programmatic?: boolean } | null;
  mentionItems: Array<{ id: string; title: string; detail: string }>;
  mentionIndex: number;
  setMentionIndex: Dispatch<SetStateAction<number>>;
  applyMention: (index: number, action?: "pick" | "drill") => void;

  composerPastes: ConversationComposerPaste[];
  setComposerPastes: Dispatch<SetStateAction<ConversationComposerPaste[]>>;
  expandedPasteId: string;
  setExpandedPasteId: Dispatch<SetStateAction<string>>;

  annotations: MessageAnnotation[];
  setAnnotations: Dispatch<SetStateAction<MessageAnnotation[]>>;
  openAnnotationList: () => void;
  scheduleCloseAnnotationList: () => void;
  annotationListOpen: boolean;
  setAnnotationListOpen: Dispatch<SetStateAction<boolean>>;
  setAnnotationEditor: Dispatch<SetStateAction<{ id: string; x: number; y: number } | null>>;

  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  openImagePreview: (payload: { url: string; name: string; path?: string }, peers?: Array<Pick<Attachment, "path" | "previewUrl" | "name">>) => void;

  composerSessionId: string;
  composer: string;
  textareaRef: RefObject<ComposerHandle | null>;
  updateComposer: (value: string, caret?: number) => void;
  syncComposerDerivedState: (value: string, caret?: number) => void;
  onComposerKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  handleComposerContextMenu: (event: MouseEvent<HTMLElement>) => void;
  handleComposerPaste: (event: ClipboardEvent<HTMLElement>) => void;
  composingRef: RefObject<boolean>;
  composerMirrorRef: RefObject<HTMLDivElement | null>;
  activeTokenNames: Set<string>;
  activeSkillNames: Set<string>;
  activeSessionTitles: Set<string>;

  addMenuOpen: boolean;
  setAddMenuOpen: Dispatch<SetStateAction<boolean>>;
  chooseAttachments: () => void;

  approvalMenuOpen: boolean;
  setApprovalMenuOpen: Dispatch<SetStateAction<boolean>>;
  approvalMode: ApprovalMode;
  activeApprovalMode: (typeof composerApprovalModes)[number];
  ActiveApprovalIcon: (typeof composerApprovalModes)[number]["icon"];
  selectApprovalMode: (nextMode: ApprovalMode) => void;

  contextUsage: { used: number; limit: number; exact: boolean };

  modelMenuOpen: boolean;
  setModelMenuOpen: Dispatch<SetStateAction<boolean>>;
  settings: ProviderSettings;
  hasModel: boolean;
  ensureComposerModels: () => void;
  composerEffortLabel: string;
  activateModelProfile: (profile: ModelProfile) => void;
  composerModelsLoading: boolean;
  composerModels: Array<{ id: string; contextLimit?: number }> | null;
  switchComposerModel: (modelId: string) => void;
  saveProviderSettings: (nextSettings: ProviderSettings, successMessage?: string) => Promise<boolean>;
  setSettingsTab: Dispatch<SetStateAction<SettingsTab>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;

  voiceState: "idle" | "recording" | "transcribing";
  toggleVoiceInput: () => void;

  canSend: boolean;
  sendMessage: () => void;
  runningRunIdsRef: RefObject<Map<string, string>>;
}

export function ConversationPane(props: ConversationPaneProps) {
  const {
    ConversationMessageRow, messageRowActions,
    activeSession, workspacePath, composerWorkspacePath, workspaceContext, activeId,
    botTeamPageOpen, botTeamAvailable, botTeamProvider, pluginsPageOpen, settingsOpen,
    conversationView, setConversationView, pluginConversationViews,
    conversationSearchOpen, setConversationSearchOpen, conversationSearchQuery, setConversationSearchQuery,
    conversationSearchMatchIndex, setConversationSearchMatchIndex, conversationMatchTotal, conversationSearchInputRef,
    conversationIndex, conversationTurns, hoveredTurnIndex, setHoveredTurnIndex, jumpToConversationTurn,
    bindViewport, viewportRef, syncAtBottom, setSelectionQuote, handleConversationMouseUp, atBottom,
    editingMessage, activeTaskRunning, activeScheduledRun, streamingAssistantIndex,
    playingVoicePath, voiceLoadingPath, speakingMessageKey, speakingLoadingKey, collapsedActivities, queuedRunIds,
    activeLoopState, runningStartedAt, activeWaking,
    activePendingApproval, setPendingApprovals, activePendingQuestion, setPendingQuestions,
    activeSessionPendingInboxApproval, activeSessionPendingInboxQuestion, setInboxItems,
    annotationMarkers,
    terminalMounted, terminalAvailable, terminalOpen, setTerminalOpen,
    debugOpen, setDebugOpen, activeSessionTraceEvents, debugLogs, setDebugLogs, traceBuffer, setTraceEvents,
    pendingDebugLogsRef, recentDebugLogsRef, debugLogFlushTimerRef, appendSessionTraces,
    inboxOpen, setInboxOpen, inboxItems, inboxTab, systemMessageFocusId, setSystemMessageFocusId,
    imagePreview, closeImagePreview, imagePreviewIndex, imagePreviewPeers, navigateImagePreview, setNotice, setError,
    setComposerDockNode, error, activeSessionError, activeSessionNotice, notice,
    clearSessionError, clearSessionNotice,
    activeSleeping, activeQueuedMessages, resumeSleepingTask, cancelSleepingTask,
    runQueuedMessageNow, removeQueuedMessage, setQueueMenuRunId, queueMenuRunId,
    startMessageEdit, copyMessage,
    handleGoalAction, chooseWorkspace, clearWorkspace,
    composerDragActive, handleComposerDragOver, handleComposerDragLeave, handleComposerDrop,
    cancelQueuedMessage, cancelMessageEdit, mentionMenu, mentionItems, mentionIndex, setMentionIndex, applyMention,
    composerPastes, setComposerPastes, expandedPasteId, setExpandedPasteId,
    annotations, setAnnotations, openAnnotationList, scheduleCloseAnnotationList, annotationListOpen, setAnnotationListOpen,
    setAnnotationEditor,
    attachments, setAttachments, openImagePreview,
    composerSessionId, composer, textareaRef, updateComposer, syncComposerDerivedState,
    onComposerKeyDown, handleComposerContextMenu, handleComposerPaste, composingRef, composerMirrorRef,
    activeTokenNames, activeSkillNames, activeSessionTitles,
    addMenuOpen, setAddMenuOpen, chooseAttachments,
    approvalMenuOpen, setApprovalMenuOpen, approvalMode, activeApprovalMode, ActiveApprovalIcon, selectApprovalMode,
    contextUsage,
    modelMenuOpen, setModelMenuOpen, settings, hasModel, ensureComposerModels, composerEffortLabel,
    activateModelProfile, composerModelsLoading, composerModels, switchComposerModel, saveProviderSettings, setSettingsTab, setSettingsOpen,
    voiceState, toggleVoiceInput,
    canSend, sendMessage, runningRunIdsRef,
  } = props;
  return (
      <main className={`main-panel ${!activeSession?.messages.length ? "empty-session" : ""} ${botTeamPageOpen ? "bot-team-page-open" : ""} ${pluginsPageOpen ? "plugins-page-open" : ""} ${!botTeamPageOpen && conversationView !== "chat" ? "conversation-view-open" : ""} ${terminalOpen ? "terminal-open" : ""}`}>
        {botTeamPageOpen && botTeamAvailable ? <section className="bot-team-page" aria-label={botTeamProvider === "qwenpaw" ? "QwenPaw 助手页面" : "机器人团队页面"}>
          <PluginSlotView slot="workspace.page" pluginId={botTeamProvider} pluginKey={botTeamProvider === "qwenpaw" ? "qwenpaw" : "bot-team"} visible={!settingsOpen} />
        </section> : <>
        {/* 会话区视图标签（对照 DSH 的「对话 / 轨迹」）：插件注册进 conversation.view 插槽的
            视图也在这里成为一个标签页，点开即在会话区渲染插件组件。 */}
        <div className="conversation-tabs" role="tablist" aria-label="会话视图">
          <button
            role="tab"
            aria-selected={conversationView === "chat"}
            className={`conversation-tab ${conversationView === "chat" ? "active" : ""}`}
            onClick={() => setConversationView("chat")}
          >对话</button>
          {/* 「轨迹」不再硬编码在这里：它由内置插件 dyworker-trajectory 注册进
              conversation.view 插槽（与官方 DSH 的轨迹插件同一套契约），
              视图代码仍是 src/TraceView，插件负责注册与按会话取 trace。 */}
          {pluginConversationViews.map((view) => (
            <button
              key={view.key}
              role="tab"
              aria-selected={conversationView === view.key}
              className={`conversation-tab ${conversationView === view.key ? "active" : ""}`}
              onClick={() => setConversationView(view.key)}
            >{view.label}</button>
          ))}
        </div>

        {conversationView !== "chat" && (
          <section className="conversation-view-panel">
            {/* 会话区视图一律由插件贡献（conversation.view 插槽）：轨迹、上下文都是插件 */}
            <PluginSlotView slot="conversation.view" pluginKey={conversationView} sessionId={activeSession?.id} session={activeSession} />
          </section>
        )}

        {conversationSearchOpen && (
          <div className="conversation-search" role="search" aria-label="搜索会话内容">
            <Search size={13} />
            <input
              ref={conversationSearchInputRef}
              type="search"
              placeholder="搜索本会话对话内容…"
              value={conversationSearchQuery}
              aria-label="搜索本会话对话内容"
              onChange={(event) => {
                setConversationSearchQuery(event.target.value);
                setConversationSearchMatchIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!conversationMatchTotal) return;
                  const delta = event.shiftKey ? -1 : 1;
                  setConversationSearchMatchIndex((current) => (current + delta + conversationMatchTotal) % conversationMatchTotal);
                } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (!conversationMatchTotal) return;
                  const delta = event.key === "ArrowDown" ? 1 : -1;
                  setConversationSearchMatchIndex((current) => (current + delta + conversationMatchTotal) % conversationMatchTotal);
                } else if (event.key === "Escape") {
                  event.stopPropagation();
                  setConversationSearchOpen(false);
                  setConversationSearchQuery("");
                }
              }}
            />
            <span className="conversation-search-count">
              {conversationSearchQuery.trim()
                ? conversationMatchTotal
                  ? `${Math.min(conversationSearchMatchIndex, conversationMatchTotal - 1) + 1} / ${conversationMatchTotal}`
                  : "无匹配"
                : ""}
            </span>
            <button
              type="button"
              className="icon-button subtle tiny"
              aria-label="上一个匹配"
              title="上一个匹配（Shift+Enter）"
              disabled={!conversationMatchTotal}
              onClick={() => setConversationSearchMatchIndex((current) => (current - 1 + conversationMatchTotal) % conversationMatchTotal)}
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              className="icon-button subtle tiny"
              aria-label="下一个匹配"
              title="下一个匹配（Enter）"
              disabled={!conversationMatchTotal}
              onClick={() => setConversationSearchMatchIndex((current) => (current + 1) % conversationMatchTotal)}
            >
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              className="icon-button subtle tiny"
              aria-label="关闭搜索"
              title="关闭搜索（Esc）"
              onClick={() => {
                setConversationSearchOpen(false);
                setConversationSearchQuery("");
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {conversationTurns.length > 5 && (
          <nav className="conversation-turn-rail" aria-label="对话回合导航">
            {conversationTurns.map((turn, turnIndex) => {
              const turnActive = turnIndex === hoveredTurnIndex
                || (hoveredTurnIndex === null && turnIndex === conversationTurns.length - 1);
              const waveDistance = hoveredTurnIndex === null
                ? null
                : Math.abs(turnIndex - hoveredTurnIndex);
              return (
                <div className="conversation-turn-marker-wrap" key={`${turn.messageIndex}-${turnIndex}`}>
                  <button
                    type="button"
                    className={`conversation-turn-marker${waveDistance === null ? "" : ` wave-distance-${waveDistance}`}`}
                    aria-label={`第 ${turnIndex + 1} 轮对话：${turn.preview.title}`}
                    aria-current={turnActive ? "step" : undefined}
                    aria-describedby={hoveredTurnIndex === turnIndex ? `conversation-turn-preview-${turnIndex}` : undefined}
                    onClick={() => jumpToConversationTurn(turnIndex)}
                    onMouseEnter={() => setHoveredTurnIndex(turnIndex)}
                    onMouseLeave={() => setHoveredTurnIndex(null)}
                    onFocus={() => setHoveredTurnIndex(turnIndex)}
                    onBlur={() => setHoveredTurnIndex(null)}
                  />
                  {hoveredTurnIndex === turnIndex && (
                    <div
                      id={`conversation-turn-preview-${turnIndex}`}
                      className="conversation-turn-preview"
                      role="tooltip"
                    >
                      <strong>{turn.preview.title}</strong>
                      <span>{turn.preview.detail}</span>
                      <small>第 {turnIndex + 1} 轮对话</small>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        )}

        <div
          className="conversation-viewport"
          ref={bindViewport}
          onScroll={() => {
            syncAtBottom();
            // 选区随滚动漂移，浮动条位置不再对准选区，直接收起
            setSelectionQuote(null);
          }}
          onMouseUp={handleConversationMouseUp}
        >
          <div className="conversation-column" key={activeSession?.id}>
            {!activeSession?.messages.length ? (
              <div className="empty-conversation">
                <span className="empty-mark"><Sparkles size={44} strokeWidth={1.3} /></span>
                <h1>我们要完成什么？</h1>
              </div>
            ) : (
              activeSession.messages.map((message, index) => {
                // 排队消息不渲染在对话流里，继续展示在输入框上方的队列中。
                if (message.runId && queuedRunIds.has(message.runId)) return null;
                return <ConversationMessageRow
                  key={`${message.role}:${message.id || `${message.createdAt}-${index}`}`}
                  message={message} index={index} turnIndex={conversationIndex.byMessageIndex.get(index) ?? -1}
                  sessionId={activeSession.id} workspacePath={activeSession.workspacePath || workspacePath}
                  isEditing={editingMessage?.sessionId === activeSession.id && editingMessage.messageIndex === index}
                  activeTaskRunning={message.role === "user" ? activeTaskRunning : index === streamingAssistantIndex} isStreamingMessage={index === streamingAssistantIndex}
                  playingVoicePath={playingVoicePath} voiceLoadingPath={voiceLoadingPath}
                  speakingMessageKey={speakingMessageKey} speakingLoadingKey={speakingLoadingKey}
                  collapsedActivities={collapsedActivities} actions={messageRowActions}
                />;
              })
            )}

            {activeTaskRunning && (
              <div className="message-row assistant">
                <div className={`assistant-working ${activeWaking ? "waking" : ""}`}>
                  <LoaderCircle className="spin" size={17} />
                  <RunningStatusLabel
                    loopState={activeLoopState}
                    startedAt={activeSession?.id ? runningStartedAt[activeSession.id] : undefined}
                    waking={activeWaking}
                  />
                </div>
              </div>
            )}

            {activePendingApproval && (
              <div className="message-row assistant">
                <ApprovalCard
                  action={activePendingApproval}
                  onResolve={(approved) => {
                    if (!activeSession) return;
                    void window.dyworker?.resolveApproval(activeSession.id, activePendingApproval.id, approved);
                    setPendingApprovals((current) => {
                      const next = { ...current };
                      delete next[activeSession.id];
                      return next;
                    });
                  }}
                />
              </div>
            )}

            {activePendingQuestion && (
              <div className="message-row assistant">
                <QuestionCard
                  request={activePendingQuestion}
                  onResolve={(answer) => {
                    if (!activeSession) return;
                    void window.dyworker?.resolveQuestion(activeSession.id, activePendingQuestion.id, answer);
                    setPendingQuestions((current) => {
                      const next = { ...current };
                      delete next[activeSession.id];
                      return next;
                    });
                  }}
                />
              </div>
            )}

            {activeSessionPendingInboxApproval && !activePendingApproval && (
              <div className="message-row assistant">
                <ApprovalCard
                  action={{
                    id: activeSessionPendingInboxApproval.id,
                    kind: activeSessionPendingInboxApproval.tool || "run_command",
                    title: activeSessionPendingInboxApproval.title || "自动续跑任务申请操作",
                    details: activeSessionPendingInboxApproval.details || "",
                    impact: activeSessionPendingInboxApproval.impact,
                  }}
                  onResolve={(approved) => {
                    void window.dyworker?.resolveInbox({ id: activeSessionPendingInboxApproval.id, approved }).then(() => {
                      void window.dyworker?.listInbox().then(setInboxItems);
                    });
                  }}
                />
              </div>
            )}

            {activeSessionPendingInboxQuestion && !activePendingQuestion && (
              <div className="message-row assistant">
                <QuestionCard
                  request={{
                    ...activeSessionPendingInboxQuestion.questionPresentation,
                    id: activeSessionPendingInboxQuestion.id,
                    question: activeSessionPendingInboxQuestion.question || "请回答任务提问",
                    options: activeSessionPendingInboxQuestion.options || [],
                  }}
                  onResolve={(answer) => {
                    void window.dyworker?.resolveInbox({ id: activeSessionPendingInboxQuestion.id, answer }).then(() => {
                      void window.dyworker?.listInbox().then(setInboxItems);
                    });
                  }}
                />
              </div>
            )}
          </div>
          {/* 注释编号小气泡：钉在引用文本起点上方，随内容滚动（定位用内容坐标） */}
          {annotationMarkers.map((marker) => (
            <span key={marker.id} className="annotation-marker" style={{ top: marker.top, left: marker.left }}>{marker.n}</span>
          ))}
        </div>

        {terminalMounted && terminalAvailable && (
          <div className="terminal-dock" hidden={!terminalOpen}>
            <PluginSlotView slot="workspace.terminal" pluginId="dyworker-terminal" pluginKey="terminal"
              workspacePath={activeSession?.workspacePath || workspacePath} visible={terminalOpen}
              onClose={() => setTerminalOpen(false)} />
          </div>
        )}

        {debugOpen && (
          <TraceConsole
            traces={activeSessionTraceEvents}
            logs={debugLogs}
            sessionId={activeSession?.id}
            onClear={() => {
              traceBuffer.clear();
              setTraceEvents([]);
              pendingDebugLogsRef.current = [];
              recentDebugLogsRef.current = [];
              if (debugLogFlushTimerRef.current !== null) {
                window.clearTimeout(debugLogFlushTimerRef.current);
                debugLogFlushTimerRef.current = null;
              }
              setDebugLogs([]);
            }}
            onClose={() => setDebugOpen(false)}
            onAppendTraces={appendSessionTraces}
          />
        )}

        {inboxOpen && (
          <InboxDialog
            items={inboxItems}
            onClose={() => setInboxOpen(false)}
            onResolve={() => void window.dyworker?.listInbox?.().then(setInboxItems)}
            onDismiss={(id) => {
              void window.dyworker?.dismissInbox(id).then(() => window.dyworker?.listInbox().then(setInboxItems));
            }}
            initialTab={inboxTab}
            focusMessageId={systemMessageFocusId}
            onFocusConsumed={() => setSystemMessageFocusId("")}
          />
        )}

        {imagePreview && (
          <ImageLightbox
            preview={imagePreview}
            onClose={closeImagePreview}
            navigation={{ index: Math.max(imagePreviewIndex, 0), count: imagePreviewPeers.length, onNavigate: navigateImagePreview }}
            onCopied={(copied) => {
              if (copied) setNotice("图片已复制到剪贴板");
              else setError("图片复制失败，请重试");
            }}
          />
        )}

        <div className="composer-dock" ref={setComposerDockNode}>
          {(error || activeSessionError) && (
            <div className="status-toast error" role="alert">
              <span className="status-toast-text">{error || activeSessionError}</span>
              <button
                type="button"
                className="status-toast-dismiss"
                onClick={() => {
                  setError("");
                  if (activeSession?.id) clearSessionError(activeSession.id);
                }}
                title="关闭提示"
                aria-label="关闭提示"
              >
                ×
              </button>
            </div>
          )}
          {(notice || activeSessionNotice) && (
            <div className="status-toast" role="status">
              <span className="status-toast-text">{notice || activeSessionNotice}</span>
              <button
                type="button"
                className="status-toast-dismiss"
                onClick={() => {
                  setNotice("");
                  if (activeSession?.id) clearSessionNotice(activeSession.id);
                }}
                title="关闭提示"
                aria-label="关闭提示"
              >
                ×
              </button>
            </div>
          )}
          {/* 待发送列表：排队消息与挂起唤醒提示都独立成卡，统一收在输入框上方。
              输入框只负责正在编辑的这一条，不再和它们挤在同一张卡片里（对照 Codex） */}
          {(activeSleeping || (activeTaskRunning && activeQueuedMessages.length > 0)) && (
            <div className="composer-pending" aria-label="待发送列表">
              {activeSleeping && (
                <div className="sleep-card" role="status" aria-label="任务已挂起">
                  <Moon size={14} className="sleep-card-icon" />
                  <span className="sleep-card-text">
                    任务已挂起，将于 <strong>{formatWakeTime(activeSleeping.wakeAt)}</strong> 自动唤醒继续
                    {activeSleeping.reason ? `（原因：${activeSleeping.reason}）` : ""}；期间不再接收新消息
                  </span>
                  <span className="sleep-card-actions">
                    <button
                      type="button"
                      className="sleep-card-button primary"
                      onClick={() => activeSession && void resumeSleepingTask(activeSession.id)}
                    >
                      立即继续
                    </button>
                    <button
                      type="button"
                      className="sleep-card-button"
                      onClick={() => activeSession && void cancelSleepingTask(activeSession.id)}
                    >
                      取消唤醒
                    </button>
                  </span>
                </div>
              )}
              {activeTaskRunning && activeQueuedMessages.length > 0 && (
                <div className="queue-card" role="status" aria-label="待发送的消息">
                  <div className="queue-card-head">
                    <span className="queue-card-title">待发送</span>
                    <span className="queue-card-count">{activeQueuedMessages.length} 条</span>
                    <span className="queue-card-hint">当前任务结束后依次执行</span>
                  </div>
                  {activeQueuedMessages.map((entry) => (
                    <div className="queue-card-row" key={entry.message.runId}>
                      <CornerUpLeft size={14} className="queue-card-icon" />
                      <span className="queue-card-text" title={messageVisibleText(entry.message)}>
                        {messageVisibleText(entry.message)}
                      </span>
                      <span className="queue-card-actions">
                        <button
                          type="button"
                          className="queue-card-steer"
                          onClick={() => void runQueuedMessageNow(entry)}
                          title="停下当前任务，立即执行这条消息"
                        >
                          <Play size={13} />
                          立即执行
                        </button>
                        <button
                          type="button"
                          className="icon-button subtle tiny"
                          onClick={() => void removeQueuedMessage(entry.message.runId || "", entry.messageIndex)}
                          aria-label="删除这条排队消息"
                          title="删除这条排队消息"
                        >
                          <Trash2 size={14} />
                        </button>
                        <span className="queue-card-more-wrap" data-menu-root>
                          <button
                            type="button"
                            className="icon-button subtle tiny"
                            onClick={() => setQueueMenuRunId((current) => current === entry.message.runId ? null : entry.message.runId || null)}
                            aria-label="排队消息更多操作"
                            title="更多操作"
                            aria-expanded={queueMenuRunId === entry.message.runId}
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          {queueMenuRunId === entry.message.runId && (
                            <div className="session-menu queue-card-menu" role="menu">
                              <button
                                role="menuitem"
                                onClick={() => {
                                  setQueueMenuRunId(null);
                                  // 原地编辑：保持排队位置，开始执行时按新内容运行
                                  startMessageEdit(entry.message, entry.messageIndex);
                                }}
                              >
                                编辑内容（保持排队位置）
                              </button>
                              <button
                                role="menuitem"
                                onClick={() => {
                                  setQueueMenuRunId(null);
                                  void copyMessage(entry.message);
                                }}
                              >
                                复制内容
                              </button>
                            </div>
                          )}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {activeSession?.goal && <GoalBanner key={`${activeSession.id}:${activeSession.goalState?.id || 'legacy'}`}
            session={activeSession} busy={activeTaskRunning} onAction={(action) => handleGoalAction(activeSession.id, action)} />}
          {!activeSession?.messages.length && <div className="composer-project-bar" aria-label="当前工作上下文">
            <div className="composer-project-selection">
              <button type="button" className="composer-project-button" onClick={() => void chooseWorkspace()}
                title={composerWorkspacePath || "选择工作文件夹"}>
                <Folder size={16} /><span>{composerWorkspacePath ? workspaceContext?.name || displayWorkspace(composerWorkspacePath) : "选择项目"}</span>
              </button>
              {composerWorkspacePath && <button type="button" className="icon-button subtle tiny" onClick={clearWorkspace}
                aria-label="移除当前工作目录" title="不在项目中工作"><X size={13} /></button>}
            </div>
            {workspaceContext?.branch && <span className="composer-context-item composer-project-branch"><GitBranch size={15} /><span>{workspaceContext.branch}</span></span>}
          </div>}
          <PlanProgress running={activeTaskRunning} message={activeSession?.messages[streamingAssistantIndex]} />
          <div
            className={`composer-card ${composerDragActive ? "drag-over" : ""}`}
            onDragOver={handleComposerDragOver}
            onDragLeave={handleComposerDragLeave}
            onDrop={handleComposerDrop}
          >
            {editingMessage?.sessionId === activeSession?.id && (
              <div className="message-editing-banner" role="status">
                <Pencil size={13} />
                <span>正在编辑：{shortTitle(messageVisibleText(editingMessage.original))}</span>
                {editingMessage.original.runId && queuedRunIds.has(editingMessage.original.runId) && (
                  <button type="button" className="danger" onClick={() => void cancelQueuedMessage()}>取消排队</button>
                )}
                <button type="button" onClick={cancelMessageEdit}>取消编辑</button>
              </div>
            )}
            {mentionMenu && (
              <div className="mention-menu" role="listbox">
                {activeSession?.runtime === 'dsh' && clientHost().inputHeaders(activeSession.id).map(crumb => (
                  <button key={`${crumb.source}:${crumb.index}`} type="button" className="plugin-input-crumb" disabled={crumb.current}
                    aria-label={`返回 ${crumb.label}`} onClick={() => clientHost().pickInputCrumb(activeSession.id, crumb.source, crumb.index)}>{crumb.label}</button>
                ))}
                {mentionItems.length ? mentionItems.map((item, index) => (
                  <button
                    key={item.id}
                    role="option"
                    aria-selected={index === mentionIndex}
                    className={index === mentionIndex ? "active" : ""}
                    onMouseEnter={() => setMentionIndex(index)}
                    onClick={() => applyMention(index)}
                  >
                    <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                  </button>
                )) : (
                  <p className="mention-empty">{mentionMenu.kind === "slash" ? "没有匹配的技能" : "没有匹配的会话或文件"}</p>
                )}
              </div>
            )}
            {activeSession?.runtime === 'dsh' && clientHost().inputClaim(activeSession.id) && (
              <p className="plugin-input-claim" role="status">命令：{clientHost().inputClaim(activeSession.id)?.name}
                {clientHost().inputClaim(activeSession.id)?.invalid ? ' · 插件已停用，请重新选择' : clientHost().inputClaim(activeSession.id)?.hint ? ` · ${clientHost().inputClaim(activeSession.id)?.hint}` : ''}</p>
            )}
            {composerPastes.length > 0 && (
              <div className="composer-paste-folds">
                {composerPastes.map((block) => {
                  const expanded = expandedPasteId === block.id;
                  return (
                    <div className={`paste-fold${expanded ? " expanded" : ""}`} key={block.id}>
                      <div className="paste-fold-header">
                        <FileText size={14} />
                        <button
                          type="button"
                          className="paste-fold-toggle"
                          onClick={() => setExpandedPasteId(expanded ? "" : block.id)}
                          aria-expanded={expanded}
                        >
                          已折叠长文本 · {block.text.length.toLocaleString()} 字 · {expanded ? "收起" : "展开查看"}
                        </button>
                        <button
                          type="button"
                          className="paste-fold-remove"
                          onClick={() => setComposerPastes((current) => current.filter((item) => item.id !== block.id))}
                          aria-label="移除长文本"
                        >
                          <X size={13} />
                        </button>
                      </div>
                      {expanded && <pre className="paste-fold-preview">{block.text}</pre>}
                    </div>
                  );
                })}
              </div>
            )}
            {annotations.length > 0 && (
              <div
                className="annotation-strip"
                onMouseEnter={openAnnotationList}
                onMouseLeave={scheduleCloseAnnotationList}
              >
                <span className="annotation-chip">
                  <MessageSquare size={13} />
                  <span>{annotations.length} 条注释</span>
                  <button
                    type="button"
                    onClick={() => {
                      setAnnotations([]);
                      setAnnotationListOpen(false);
                      setAnnotationEditor(null);
                    }}
                    aria-label="清空全部注释"
                    title="清空全部注释"
                  >
                    <X size={13} />
                  </button>
                </span>
                {annotationListOpen && (
                  <div className="annotation-list-popup" role="list">
                    {annotations.map((annotation, index) => (
                      <div className="annotation-list-item" key={annotation.id} role="listitem">
                        <span className="annotation-index">{index + 1}。</span>
                        <div className="annotation-item-main">
                          <div className="annotation-item-head">
                            <span className="annotation-field-label">所选文本：</span>
                            <span className="annotation-list-actions">
                              <button
                                type="button"
                                aria-label="编辑评论"
                                title="编辑评论"
                                onClick={(event) => {
                                  setAnnotationListOpen(false);
                                  setAnnotationEditor({ id: annotation.id, x: event.clientX, y: event.clientY });
                                }}
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                aria-label="删除该注释"
                                title="删除该注释"
                                onClick={() => {
                                  setAnnotations((current) => current.filter((item) => item.id !== annotation.id));
                                  setAnnotationEditor((current) => current?.id === annotation.id ? null : current);
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </span>
                          </div>
                          <span className="annotation-quote" title={annotation.quote}>{annotation.quote}</span>
                          {annotation.comment.trim() && (
                            <>
                              <span className="annotation-field-label">用户评论：</span>
                              <span className="annotation-comment" title={annotation.comment}>{annotation.comment}</span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div
              className={`attachment-strip${attachments.length ? " has-refs" : ""}`}
              aria-label={attachments.length ? `已选择 ${attachments.length} 项` : undefined}
            >
              {/* 技能引用以 /技能名 内联 token 留在正文里（删 token 即移除），不再单独占一行 chip */}
              {attachments.map((attachment) => (
                <span
                  className={`attachment-chip${attachment.isImage ? " image-attachment-chip" : " ref-attachment-chip"}`}
                  key={attachment.path}
                >
                  {attachment.isImage
                    ? (
                      <ImageAttachmentThumb
                        attachment={attachment}
                        onPreview={(payload) => openImagePreview(payload, attachments.filter((item) => item.isImage))}
                      />
                    )
                    : /\.[cm]?[jt]sx?$/i.test(attachment.name) ? <FileCode2 size={14} /> : <FileText size={14} />}
                  {!attachment.isImage && (
                    <span title={attachment.path}>{attachment.isImage ? "图片" : attachment.name}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((item) => item.path !== attachment.path))}
                    aria-label={`移除附件 ${attachment.name}`}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
              {activeSession && <ModsPanelView sessionId={activeSession.id} />}
              {activeSession?.runtime === 'dsh' && <div className="dsh-input-overlay">
                <PluginSlotView key={activeSession.id} slot="conversation.input.overlay"
                  sessionId={activeSession.id} session={activeSession} hideEmpty />
              </div>}
              <div className="composer-input-wrap">
                {activeSession?.runtime === 'dsh' && composerSessionId !== activeId ? <p role="status">正在恢复本会话输入…</p> : activeSession?.runtime === 'dsh' ? <DshComposer key={activeSession.id} sessionId={activeSession.id}
                  value={composer} inputRef={textareaRef} onChange={updateComposer} onSelect={syncComposerDerivedState}
                  onKeyDown={onComposerKeyDown} onContextMenu={handleComposerContextMenu}
                  onPaste={event => void handleComposerPaste(event)}
                  onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} /> : <>
                {/* 镜像层：渲染在 textarea 之下，给正文里的 @文件/@「会话」token 画内联高亮底色 */}
                <div className="composer-mirror" ref={composerMirrorRef} aria-hidden>
                  {renderInlineTokens(composer, activeTokenNames, activeSkillNames, { keyPrefix: "mirror", sessionTitles: activeSessionTitles })}
                </div>
                <textarea
                  ref={node => { textareaRef.current = node; }}
                  value={composer}
                  onChange={(event) => updateComposer(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                  onPaste={(event) => void handleComposerPaste(event)}
                  onSelect={(event) => {
                    // 光标点击/移动时同步候选菜单：点回 @token//token 后面可重新唤起，移开即关闭。
                    // 这里只同步菜单、不写 composer：React 会把 onSelect 合成到 keydown/keyup，
                    // 而这两个事件派发在 DOM 更新之前，照抄 DOM 会把刚清空的正文写回去
                    // （实测 bug：回车发送后消息已发出、输入框内容还在）
                    if (composingRef.current) return;
                    const target = event.currentTarget;
                    if (target.selectionStart !== target.selectionEnd) return;
                    syncComposerDerivedState(target.value, target.selectionStart ?? target.value.length);
                  }}
                  onContextMenu={handleComposerContextMenu}
                  onKeyDown={onComposerKeyDown}
                  onScroll={(event) => {
                    if (composerMirrorRef.current) composerMirrorRef.current.scrollTop = event.currentTarget.scrollTop;
                  }}
                  onCompositionStart={() => { composingRef.current = true; }}
                  onCompositionEnd={() => { composingRef.current = false; }}
                  placeholder="描述要完成的工作"
                  lang="zh-CN"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  rows={2}
                />
                </>}
              </div>
            </div>
            <div className="composer-toolbar">
              <div className="composer-actions">
                <div className="add-menu-wrap" data-menu-root>
                  <button
                    className={`icon-button ${addMenuOpen ? "active" : ""}`}
                    onMouseDown={event => { if (activeSession?.runtime === 'dsh') event.preventDefault(); }}
                    onClick={() => setAddMenuOpen((value) => !value)}
                    aria-label="添加内容"
                    aria-expanded={addMenuOpen}
                  >
                    <Plus size={19} />
                  </button>
                  {addMenuOpen && (
                    <div className="add-menu" role="menu">
                      <button role="menuitem" onClick={() => void chooseWorkspace()}>
                        <FolderOpen size={16} />
                        <span><strong>{workspacePath ? "更换工作文件夹" : "选择工作文件夹"}</strong><small>让 DYWorker 读取项目文件</small></span>
                      </button>
                      <button role="menuitem" onClick={() => void chooseAttachments()}>
                        <Paperclip size={16} />
                        <span><strong>添加附件</strong><small>支持文本、代码和图片</small></span>
                      </button>
                      {activeSession?.runtime === 'dsh' && clientHost().inputSourcesForLaunch().map(source =>
                        <button role="menuitem" key={`input-source:${source.trigger}:${source.name}`}
                          onMouseDown={event => event.preventDefault()} onClick={() => {
                          setAddMenuOpen(false);
                          try { clientHost().toggleInputSource(activeSession.id, source.name, source.trigger); }
                          catch (error) { setNotice(String((error as any)?.message || error)); }
                        }}>
                          {source.trigger === '/' ? <Slash size={16} /> : <AtSign size={16} />}
                          <span><strong>{source.name}</strong><small>{source.trigger === '/' ? '选择插件命令' : '插入插件引用'}</small></span>
                        </button>)}
                    </div>
                  )}
                </div>
                <div className="approval-mode-wrap" data-menu-root>
                  <button
                    type="button"
                    className={`approval-mode-button ${approvalMenuOpen ? "active" : ""} ${approvalMode === "full-access" ? "warning" : ""}`}
                    onClick={() => setApprovalMenuOpen((value) => !value)}
                    aria-haspopup="menu"
                    aria-expanded={approvalMenuOpen}
                    aria-label={activeApprovalMode.label}
                    title={activeApprovalMode.description}
                  >
                    <ActiveApprovalIcon size={15} />
                    <span>{activeApprovalMode.label}</span>
                  </button>
                  {approvalMenuOpen && (
                    <div className="approval-mode-menu" role="menu">
                      <div className="approval-mode-menu-title">应如何批准 DYWorker 操作？</div>
                      {composerApprovalModes.map((option) => {
                        const OptionIcon = option.icon;
                        const selected = option.value === approvalMode;
                        return (
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={`${selected ? "selected" : ""} ${option.warning ? "warning" : ""}`}
                            key={option.value}
                            onClick={() => selectApprovalMode(option.value)}
                          >
                            <OptionIcon size={19} />
                            <span>
                              <strong>{option.label}</strong>
                              <small>{option.description}</small>
                            </span>
                            {selected && <Check size={16} className="approval-mode-check" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <ContextRing used={contextUsage.used} limit={contextUsage.limit} exact={contextUsage.exact} stats={activeSession?.tokenStats} />
              </div>
              <div className="composer-actions composer-send-actions">
                <div className="model-menu-wrap" data-menu-root>
                  <button
                    className={`composer-mode ${modelMenuOpen ? "active" : ""}`}
                    title={hasModel ? settings.model : "配置模型"}
                    onClick={() => {
                      if (settings.profiles?.length || settings.endpoint) {
                        setModelMenuOpen((value) => {
                          const next = !value;
                          if (next) ensureComposerModels();
                          return next;
                        });
                      } else {
                        setSettingsTab("model");
                        setSettingsOpen(true);
                      }
                    }}
                    aria-expanded={modelMenuOpen}
                  >
                    <span>{hasModel ? `${settings.model}${composerEffortLabel ? ` · ${composerEffortLabel}` : ""}` : "配置模型"}</span>
                    {hasModel && <ChevronDown size={13} />}
                  </button>
                  {modelMenuOpen && (
                    <div className="model-menu" role="menu">
                      {(settings.profiles || []).length ? (<>
                        <div className="model-menu-title">已保存的模型</div>
                        {(settings.profiles || []).map((profile) => {
                          const active = profile.endpoint === settings.endpoint && profile.model === settings.model;
                          return (
                            <button
                              key={profile.id}
                              type="button"
                              role="menuitem"
                              className={active ? "active" : ""}
                              onClick={() => void activateModelProfile(profile)}
                            >
                              <span>
                                <strong>{profile.name}</strong>
                                <small>{profile.model}</small>
                              </span>
                              {active && <Check size={14} />}
                            </button>
                          );
                        })}
                      </>) : null}
                      {composerModelsLoading ? (
                        <div className="model-menu-title">
                          <LoaderCircle className="spin" size={12} />
                          正在获取此密钥可用的模型…
                        </div>
                      ) : composerModels?.length ? (<>
                        <div className="model-menu-title">此密钥可用的模型</div>
                        {composerModels
                          .filter((item) => !(settings.profiles || []).some((profile) => profile.endpoint === settings.endpoint && profile.model === item.id))
                          .map((item) => {
                            const active = settings.model === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                role="menuitem"
                                className={active ? "active" : ""}
                                onClick={() => void switchComposerModel(item.id)}
                              >
                                <span>
                                  <strong>{item.id}</strong>
                                  {item.contextLimit
                                    ? <small>{item.contextLimit >= 1048576 ? `${Math.round(item.contextLimit / 1048576)}M` : `${Math.round(item.contextLimit / 1024)}K`} 上下文</small>
                                    : null}
                                </span>
                                {active && <Check size={14} />}
                              </button>
                            );
                          })}
                      </>) : null}
                      {hasModel && <>
                        <ReasoningControl key={reasoningModelKey(settings.endpoint, settings.model)}
                          endpoint={settings.endpoint} model={settings.model} effort={settings.reasoningEffort} overrides={settings.reasoningOverrides}
                          onChange={reasoningEffort => void saveProviderSettings({
                            ...settings, reasoningEffort,
                            profiles: settings.profiles.map(profile => profile.endpoint === settings.endpoint && profile.model === settings.model
                              ? { ...profile, reasoningEffort } : profile),
                          }, "思考强度已更新")}
                          onConfigure={async override => {
                            const reasoningOverrides = updateReasoningOverride(settings.reasoningOverrides, settings.endpoint, settings.model, override);
                            const config = getModelReasoningConfig({ endpoint: settings.endpoint, model: settings.model, overrides: reasoningOverrides });
                            const reasoningEffort = config.efforts.includes(settings.reasoningEffort) ? settings.reasoningEffort : "";
                            return saveProviderSettings({ ...settings, reasoningOverrides, reasoningEffort,
                              profiles: settings.profiles.map(profile => reasoningModelKey(profile.endpoint, profile.model) === reasoningModelKey(settings.endpoint, settings.model)
                                ? { ...profile, reasoningEffort } : profile),
                            }, override ? "思考档位已保存" : "已恢复自动识别思考档位");
                          }} />
                        <p className="model-menu-hint">切换模型或思考强度会使已有的提示词缓存失效；介意额外的 token 消耗时，建议新建会话。</p>
                      </>}
                      <button
                        type="button"
                        role="menuitem"
                        className="manage-models"
                        onClick={() => {
                          setModelMenuOpen(false);
                          setSettingsTab("model");
                          setSettingsOpen(true);
                        }}
                      >
                        <Settings size={14} />
                        管理模型配置
                      </button>
                    </div>
                  )}
                </div>

                {/* 语音输入开关：点击开始录音，再次点击结束并转写进输入框 */}
                <button
                  type="button"
                  className={`icon-button voice-button ${voiceState === "recording" ? "recording" : ""} ${voiceState === "transcribing" ? "transcribing" : ""}`}
                  onClick={() => void toggleVoiceInput()}
                  disabled={voiceState === "transcribing"}
                  aria-label={voiceState === "recording" ? "结束录音" : "语音输入"}
                  title={voiceState === "recording" ? "正在录音，再次点击结束" : "语音输入"}
                >
                  {voiceState === "transcribing" ? <LoaderCircle size={19} className="spin" /> : <Mic size={19} />}
                </button>
                {/* 所有入口都登记可取消的运行标识；没有输入时停止，有输入时提交追加要求。 */}
                {activeTaskRunning && !canSend ? (
                    <button
                      className="send-button stop"
                      onClick={() => {
                        if (!activeSession) return;
                        const runId = runningRunIdsRef.current.get(activeSession.id);
                        if (runId) void window.dyworker?.cancelTask(activeSession.id, runId);
                      }}
                      aria-label="停止当前任务"
                      title={activeScheduledRun ? "停止当前计划任务（排队中的消息仍会继续执行）" : "停止当前任务（排队中的消息仍会继续执行）"}
                    >
                      <Square size={14} fill="currentColor" />
                    </button>
                ) : (
                  <button
                    className="send-button"
                    onClick={() => void sendMessage()}
                    disabled={!canSend}
                    aria-label={editingMessage ? "重新发送" : "发送"}
                    title={activeSleeping ? "任务已挂起，请先点【立即继续】或【取消唤醒】" : "Enter 发送"}
                  >
                    <ArrowUp size={19} />
                  </button>
                )}
              </div>
            </div>
          </div>
          {!atBottom && (
            <button className="jump-bottom" onClick={() => viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "smooth" })} aria-label="滚动到底部">
              <ArrowDown size={18} />
            </button>
          )}
        </div>
        </>}
      </main>
  );
}
