// 会话区面板：从 App.tsx 抽出的 <main className={`main-panel`}> 整段（会话视图标签、会话搜索、
// 回合导航、消息流、终端/调试/收件箱浮层、输入区 dock 与发送区）。
// 机械搬运，不改类名/文案/aria；App 内部逻辑（sendMessage、updateComposer、beginPanelResize、
// 各种 useEffect 等）仍留在 App.tsx，这里只通过 props 接收状态与回调。
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, LoaderCircle, Search, Sparkles, X } from "lucide-react";
import type { ClipboardEvent, ComponentType, Dispatch, DragEvent, KeyboardEvent, MouseEvent, RefObject, SetStateAction } from "react";
import { composerApprovalModes } from "../plans/PlansPanel";
import { indexConversation } from "../../lib/text";
import { ApprovalCard, QuestionCard } from "../message/Cards";
import { ImageLightbox } from "../message/ImageLightbox";
import { RunningStatusLabel } from "../message/ProcessTimeline";
import type { SettingsTab } from "../settings/SettingsDialog";
import { InboxDialog } from "../inbox/InboxDialog";
import { TraceConsole } from "../../TraceConsole";
import { PluginSlotView } from "../../PluginSlotView";
import type { ComposerHandle } from "../../pluginRuntime/dshDraftEditor.ts";
import { ComposerDock } from "./ComposerDock";
import { AnnotationMarkerBubble } from "../annotations/SelectionOverlays";
import type { AnnotationMarker } from "../../annotations";
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
  ready: boolean;
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

  annotationMarkers: AnnotationMarker[];

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
  // 输入区 dock 相关 props 不再逐个解构：整体透传给 <ComposerDock {...props} />。
  const {
    ConversationMessageRow, messageRowActions,
    activeSession, workspacePath,
    botTeamPageOpen, botTeamAvailable, botTeamProvider, pluginsPageOpen, settingsOpen,
    conversationView, setConversationView, pluginConversationViews,
    conversationSearchOpen, setConversationSearchOpen, conversationSearchQuery, setConversationSearchQuery,
    conversationSearchMatchIndex, setConversationSearchMatchIndex, conversationMatchTotal, conversationSearchInputRef,
    conversationIndex, conversationTurns, hoveredTurnIndex, setHoveredTurnIndex, jumpToConversationTurn,
    bindViewport, syncAtBottom, setSelectionQuote, handleConversationMouseUp,
    editingMessage, activeTaskRunning, streamingAssistantIndex,
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
                <h1>{!props.ready ? "正在加载…" : props.error && !activeSession ? "暂时无法打开对话" : "我们要完成什么？"}</h1>
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
            <AnnotationMarkerBubble key={marker.id} marker={marker} />
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

        <ComposerDock {...props} />
        </>}
      </main>
  );
}
