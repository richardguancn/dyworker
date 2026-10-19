// 启动 / 布局运行时：把 App.tsx 前半段的一批 useEffect（会话切换回聊天、视口与面板尺寸、
// 草稿与镜像 ref 同步、面板布局持久化、图片预览 / 会话内搜索、菜单失焦、初始化加载、
// 会话保存队列、贴底跟随、提示条清理、设置相关拉取、应用更新订阅等）整块按原有先后顺序
// 原样搬入本 hook。语句文本、注释、effect 注册与 cleanup 顺序、行为均保持不变；
// App 本地的 ref 经 sharedRefs import 共享同一实例，派生值 / 本地函数经 deps 注入，
// state 读写改为在 hook 顶部解构对应 store。
import { useEffect, useMemo } from "react";
import { clientHost } from "../pluginRuntime/clientHostSingleton.ts";
import { createSessionSaveQueue } from "../sessionSaveQueue";
import { createTraceBuffer, trimRecentText } from "../traceBuffer";
import { goalElapsed, startGoal } from "../goal";
import { displayWorkspace } from "../lib/text";
import { makeSession, refreshPendingWakes } from "./sessionActions";
import { bindSessionModel } from "../../electron/session-model.mts";
import { closeImagePreview, navigateImagePreview } from "./messageActions";
import { refreshGitInfo } from "./gitActions";
import { syncAtBottom } from "./panelActions";
import type { ApprovalMode, SessionRecord } from "../types";
import type { ToolPanelTab } from "./layoutStore";
import {
  activeIdRef, sessionsRef, sessionDraftsRef, attachmentsRef, shouldScrollToBottomRef, viewportRef,
  toolPanelTabsRef, toolPanelTabSequenceRef, recorderRef, microphoneStreamRef, agentUnsubscribeRefs,
  sessionNoticeTimersRef, sessionErrorTimersRef, bootstrapFailedRef,
  pendingDebugLogsRef, recentDebugLogsRef, debugLogFlushTimerRef, tracePublishTimerRef,
  sessionSaveMountedRef, sessionSaveRetryRef, messageRowRefs, conversationSearchInputRef,
  searchMatchRangesRef, searchScrollKeyRef, appShellRef, panelGeometryRef, panelResizeRef,
  composerRef, composerPastesRef, annotationsRef, lastActiveIdRef, browserPanelCommandsRef,
} from "./sharedRefs";
import { useLayoutStore } from "./layoutStore";
import { useSettingsStore } from "./settingsStore";
import { useComposerStore } from "./composerStore";
import { useSessionStore } from "./sessionStore";
import { useBrowserStore } from "./browserStore";
import { useViewStore } from "./viewStore";
import { usePanelStore } from "./panelStore";

export interface StartupRuntimeDeps {
  activeSession: SessionRecord | undefined;
  traceBuffer: ReturnType<typeof createTraceBuffer>;
}

// 工作台布局按会话持久化的 localStorage 键前缀与保留条数上限
const PANEL_LAYOUT_PREFIX = "dyworker:panel-layout:v1:";
const PANEL_LAYOUT_MAX = 30;

// 任务运行中的会话快照兜底保存间隔：流式输出让 sessions 状态以分片频率
// 变化，常规 180ms 防抖保存会把整份存档（大档几十 MB）以秒级频率整档
// 写盘 + IPC 克隆，曾在 Linux 上打出 194MB/s 磁盘写入并把进程拖死；
// 任务期间只按此间隔低频兜底，任务结束后常规保存立即恢复。
const SESSION_STREAMING_SAVE_INTERVAL_MS = 30000;

function keepSingleUnstartedSession(items: SessionRecord[]) {
  let kept = false;
  return items.filter((session) => {
    if (session.runtime === 'dsh' || session.archived || session.messages.length > 0) return true;
    if (kept) return false;
    kept = true;
    return true;
  });
}

export function useStartupRuntime(deps: StartupRuntimeDeps) {
  const { activeSession, traceBuffer } = deps;
  const {
    setPluginsPageOpen, setBotTeamPageOpen, setViewportWidth, setSidebarOpen,
    setTerminalAvailable, setTerminalOpen, debugOpen,
    toolPanelTabs, setToolPanelTabs, activeToolPanelTabId, setActiveToolPanelTabId,
    toolPanelWidth, setToolPanelWidth, setSidebarWidth, rightPanelOpen, setRightPanelOpen,
    setSessionMenuId, setWorkspaceMenuPath, setTopMenuOpen, setConversationToolsOpen,
    setRailMenuOpen, setAddMenuOpen, setModelMenuOpen, setApprovalMenuOpen,
    setToolPanelMenuOpen, setToolPanelAddMenuOpen, settingsOpen,
    appUpdateDialogOpen, setAppUpdateDialogOpen,
    railMenuOpen, sessionMenuId, workspaceMenuPath, topMenuOpen, conversationToolsOpen,
    addMenuOpen, modelMenuOpen, approvalMenuOpen, toolPanelMenuOpen, toolPanelAddMenuOpen,
  } = useLayoutStore();
  const { settings, settingsTab, setSettings, setPlatform, setWindowMaximized, setApprovalMode, setAppUpdate } = useSettingsStore();
  const { browserMoreOpen, setBrowserMoreOpen } = useBrowserStore();
  const {
    composer, setComposer, composerPastes, setComposerPastes, setExpandedPasteId,
    annotations, setAnnotations, attachments, setAttachments, setMentionSkills,
  } = useComposerStore();
  const {
    sessions, setSessions, setNewTaskDraft, activeId, setActiveId,
    workspacePath, setWorkspacePath, setWorkspaceEntries, setWorkspaceContext,
    pinnedWorkspacePaths, setPinnedWorkspacePaths, setComposerSessionId,
    runningSessionIds,
    branchMenuOpen, setBranchMenuOpen, commitPanelOpen, setCommitPanelOpen,
  } = useSessionStore();
  const {
    error, setError, notice, setNotice, ready, setReady,
    setHoveredTurnIndex, setAtBottom, collapsedActivities,
    imagePreview, imagePreviewPeers,
    conversationSearchOpen, setConversationSearchOpen, conversationSearchQuery, setConversationSearchQuery,
    conversationSearchMatchIndex, setConversationSearchMatchIndex, setConversationMatchTotal,
    queueMenuRunId, setQueueMenuRunId, viewportNode, composerDockNode,
  } = useViewStore();
  const { setTraceEvents, setDebugLogs, setSkills, setUsageStats, setMemories, setSchedules } = usePanelStore();

  // 保存队列负责串行、合并和成功确认；失败后用最新状态重试，不漏报未保存的会话。
  const sessionSaveQueue = useMemo(() => createSessionSaveQueue(
    async payload => {
      const result = await window.dyworker!.saveSessions(payload);
      if (result?.ok && clientHost().dshSettings.sessionId()) void clientHost().dshSettings.refresh();
      return result;
    },
    session => session.goalState?.status === "active" ? { ...session, goalState: { ...session.goalState, elapsedMs: goalElapsed(session), activeSince: Date.now() } } : session,
  ), []);
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

  // 会话区视图标签：对话 / 轨迹 / 插件贡献的视图（DSH 的 conversation.view 插槽）
  // 切换到任意会话（含新建任务）时回到聊天：插件页是主内容区的临时视图，不是常驻模式
  useEffect(() => {
    if (!activeId) return;
    setPluginsPageOpen(false);
    setBotTeamPageOpen(false);
    setModelMenuOpen(false);
    setApprovalMenuOpen(false);
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
  useEffect(() => () => {
    if (debugLogFlushTimerRef.current !== null) window.clearTimeout(debugLogFlushTimerRef.current);
  }, []);
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
  useEffect(() => {
    sessionSaveMountedRef.current = true;
    return () => {
      sessionSaveMountedRef.current = false;
      if (sessionSaveRetryRef.current !== null) window.clearTimeout(sessionSaveRetryRef.current);
    };
  }, []);
  // 输入区高度随内容（编辑条、附件、提示条）变化，把实际高度写入 CSS 变量，
  // 对话列表底部 padding 据此预留空间，避免最后一条消息被输入框遮挡。
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // 会话草稿：切换会话时保留各自输入框内容、折叠的长文本块与引用注释（对照 Codex 的 per-session 草稿）。
  // composer/composerPastes/annotations 的最新值经 ref 读取，避免 activeId 变化的同一次提交里闭包取到旧值。
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
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // 工作台布局持久化：面板 Tab、分栏比例按会话保存到 localStorage，切换会话恢复、重启不丢。
  // 恢复先于保存执行，避免启动时用空状态覆盖已保存布局；没有自定义过布局（无 Tab）的会话不落盘。
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
        setSettings(state.settings);
        const loaded = keepSingleUnstartedSession(state.sessions);
        const initialDraft = loaded.length ? null : makeSession(state.workspacePath);
        setNewTaskDraft(initialDraft);
        setSessions(loaded.map(session => bindSessionModel(session, state.settings)).map(session => session.goal && !session.goalState
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

  useEffect(() => {
    if (!window.dyworker) return;
    const unsubscribe = window.dyworker.onWindowStateChange?.((maximized) =>
      setWindowMaximized(Boolean(maximized)),
    );
    return () => unsubscribe?.();
  }, []);

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
    syncAtBottom();
  }, [sessions, runningSessionIds, activeId]);

  // 点开会话即视为已读，清掉未读小绿点
  useEffect(() => {
    setSessions((current) => current.some((session) => session.id === activeId && session.unread)
      ? current.map((session) => session.id === activeId ? { ...session, unread: false } : session)
      : current);
  }, [activeId, sessions]);

  // 输入区展示的工作目录以当前会话为准，全局值仅作兜底（老会话可能保存了自己的目录）
  const composerWorkspacePath = String(activeSession?.workspacePath || workspacePath || "").trim();
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
  useEffect(() => {
    setBranchMenuOpen(false);
    setCommitPanelOpen(false);
    setConversationToolsOpen(false);
    void refreshGitInfo();
  }, [ready, composerWorkspacePath]);
}
