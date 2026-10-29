import {
ClipboardPaste,
Copy,
FolderOpen,
Globe,
ListTree,
MessageSquarePlus,
Scissors,
SquarePen,
SquarePlus,
SquareTerminal
} from "lucide-react";
import { CSSProperties,KeyboardEvent,MouseEvent,useCallback,useEffect,useLayoutEffect,useMemo,useRef } from "react";
import { hasConfiguredModel } from "../electron/host/dsh-runtime/model-settings.mts";
import { getModelReasoningConfig,selectedReasoningEffort } from '../electron/model-reasoning.ts';
import { resolvePanelShortcut,type PanelShortcut } from "../electron/panel-shortcuts";
import { settingsForSession } from "../electron/session-model.mts";
import { AppDialogs } from "./app/AppDialogs";
import { ShellChrome } from "./app/ShellLayout";
import { Sidebar } from "./app/Sidebar";
import type { ChannelStreamRef,ChannelStreamRuns } from "./channelStream";
import { estimateSessionTokens } from "./contextUsage";
import { DshChildHistory } from './DshChildHistory';
import { mergeCreatedDshTask } from './dshTurns';
import { browserTabTitleOf } from "./features/browser/browserUtils";
import { ConversationPane } from "./features/conversation/ConversationPane";
import { FilesSplitPanel } from "./features/files/FilesSplitPanel";
import { ConversationMessageRow } from "./features/message/ConversationMessageRow";
import { composerApprovalModes } from "./features/plans/PlansPanel";
import { ToolPanel } from "./features/toolpanel/ToolPanel";
import { playCompletionSound } from "./lib/completionSound";
import { formatMessageTime } from "./lib/format";
import {
FILE_TOKEN_REGEX,
SESSION_TOKEN_REGEX,
copyTextToClipboard,
indexConversation,
skillTokensInText
} from "./lib/text";
import { useStableHandlers } from "./lib/useStableHandlers";
import { clientHost,onOpenSessionRequest } from "./pluginRuntime/clientHostSingleton.ts";
import type { RegisteredInputCandidate } from './pluginRuntime/inputTriggers.ts';
import { detectTrigger } from './pluginRuntime/vendor/dsh-input-controller/index.js';
import { PluginSlotView } from "./PluginSlotView";
import { modelContextLimit } from "./providers";
import { useAnnotationRuntime } from "./state/annotationRuntime";
import { activateBrowserTabById,activeBrowserWebview,applyBrowserDevice,browserWebviewRefFor,browserZoomPercent,captureBrowserScreenshot,changeBrowserZoom,closeBrowserFind,closeBrowserTabById,dismissBrowserPasswordPrompt,fillSavedPassword,openBrowserExternal,openBrowserFind,openBrowserTab,openBrowserUrl,patchBrowserTab,printBrowserPage,reportActiveBrowserContents,reportBrowserTabState,resetBrowserZoom,rotateBrowserDevice,runBrowserFind,saveBrowserPasswordPrompt } from "./state/browserActions";
import { useBrowserStore } from "./state/browserStore";
import { applyMention,chooseAttachments,chooseWorkspace,handleComposerDragLeave,handleComposerDragOver,handleComposerDrop,handleComposerPaste,handleConversationMouseUp,handleMessageContextMenu,insertFileToken,openContextMenu,openReferencedFile,pasteComposerText,resolveTokenFile,resolveTokenSession } from "./state/composerActions";
import { useComposerStore } from "./state/composerStore";
import { createBranch,generateCommitMessage,openCommitPanel,refreshGitInfo,runCommit,runPushOnly,switchBranch,toggleBranchMenu } from "./state/gitActions";
import { useInboxStore } from "./state/inboxStore";
import { useLayoutStore } from "./state/layoutStore";
import { cancelMessageEdit,closeImagePreview,copyMessage,navigateImagePreview,openImagePreview,startMessageEdit,togglePlayVoice,toggleSpeakMessage,toggleVoiceInput } from "./state/messageActions";
import { refreshImportedHistory,refreshMemories,refreshSkills,refreshWorkspace,syncAtBottom } from "./state/panelActions";
import { usePanelStore } from "./state/panelStore";
import { usePluginInputRuntime } from "./state/pluginInputRuntime";
import { usePluginInputSubscriptions } from "./state/pluginInputSubscriptions";
import { usePluginSessionRuntime } from "./state/pluginSessionRuntime";
import { cancelQueuedMessage,removeQueuedMessage,runQueuedMessageNow,sendMessage } from "./state/sendMessageActions";
import { archiveSession,cancelSleepingTask,clearSessionError,clearSessionNotice,deleteSession,openWorkspaceInFileManager,patchWakingSleepNote,refreshPendingWakes,renameSession,resumeSleepingTask,showSessionNotice,togglePin,toggleWorkspacePin,unarchiveSession,updateSession } from "./state/sessionActions";
import { useSessionIpcRuntime } from "./state/sessionIpcRuntime";
import { useSessionStore } from "./state/sessionStore";
import { useSessionStreamRuntime } from "./state/sessionStreamRuntime";
import { activateModelProfile,downloadAppUpdate,ensureComposerModels,saveProviderSettings,selectApprovalMode,switchComposerModel } from "./state/settingsActions";
import { useSettingsStore } from "./state/settingsStore";
import { activeIdRef,activeToolPanelTabIdRef,appShellRef,appendSessionTracesRef,bootstrapFailedRef,browserPanelCommandsRef,browserResumeGuardRef,conversationSearchInputRef,conversationTurnRefs,createTaskRef,debugLogFlushTimerRef,dismissedPluginMention,handleGoalActionRef,manualRunScheduleRef,mentionItemsRef,messageRowRefs,openFilePreviewRef,panelGeometryRef,panelResizeRef,pendingDebugLogsRef,queueDebugLogRef,recentDebugLogsRef,refreshMemoriesRef,refreshSkillsRef,runningRunIdsRef,selectSessionRef,sessionsRef,textareaRef,toolPanelTabsRef,tracePublishTimerRef,viewportRef,wakingSessionsRef,workspaceFilesRef } from "./state/sharedRefs";
import { useStartupRuntime } from "./state/startupRuntime";
import { clearWorkspace,closeFilePanelTabs,createTask,exportProjectPackage,exportSessionMarkdown,exportSessionPackage,forkSession,handleGoalAction,importSessionPackage,jumpToConversationTurn,openAnnotationList,scheduleCloseAnnotationList,sessionPendingInboxCount,summarizeSessionToSkill,toggleTerminal } from "./state/taskActions";
import { choosePreviewFile,closeToolPanelTab,focusToolPanelTab,openFilePreview,openToolPanelTab } from "./state/toolPanelActions";
import { useToolPanelOverflow } from "./state/toolPanelOverflow";
import { useViewStore } from "./state/viewStore";
import { createTraceBuffer,trimRecentText } from "./traceBuffer";
import type { ChatMessage,DebugLogEntry,SessionRecord,SkillRecord,TraceEvent,WorkspaceEntry } from "./types";

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
    botTeamAvailable, setBotTeamAvailable,
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
  useAnnotationRuntime({ activeSession });


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
  usePluginInputSubscriptions({ activeSession, syncComposerDerivedState: (value, caret) => syncComposerDerivedState(value, caret) });


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
      if (matched.kind === 'slash' && dismissed && dismissed.sessionId === activeSession?.id && dismissed.text === value
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
  const { openPluginPanel } = usePluginSessionRuntime({ activeSession });


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
  const { scrollToolPanelTabStrip } = useToolPanelOverflow({ toolPanelTabStripRef, pristineMenuPage, appliedToolPanelWidth });

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
  usePluginInputRuntime();


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
  const identitySetupOpen = ready && !bootstrapFailedRef.current && settings.identity === null;
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
    ready && !bootstrapFailedRef.current && activeSession
    && (composer.trim() || attachments.length || activeSkills.length || composerPastes.length || annotations.length)
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
        ready={ready}
        ConversationMessageRow={ConversationMessageRow}
        messageRowActions={messageRowActions}
        activeSession={activeSession}
        workspacePath={workspacePath}
        composerWorkspacePath={composerWorkspacePath}
        workspaceContext={workspaceContext}
        activeId={activeId}
        botTeamPageOpen={botTeamPageOpen}
        botTeamAvailable={botTeamAvailable}
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


      <AppDialogs browserActiveDownloadCount={browserActiveDownloadCount} activeToolPanelTab={activeToolPanelTab} composerWorkspacePath={composerWorkspacePath} activeSession={activeSession} appliedSidebarWidth={appliedSidebarWidth} identitySetupOpen={identitySetupOpen} />
    </div>
    </>
  );
}

