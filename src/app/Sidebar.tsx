// 任务侧栏：从 App.tsx 抽出的 <aside className="sidebar"> 整段与其中的会话项渲染闭包。
// 机械搬运，不改类名/文案/aria；App 内部逻辑（selectSession、createTask 等）仍留在 App.tsx，
// 这里只通过 props 接收状态与回调。
import { Bell, Bot, ChevronDown, ChevronRight, Folder, FolderOpen, LoaderCircle, Moon, MoreHorizontal, Pin, Search, SquarePen, X } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { AppLogo } from "../AppLogo";
import { PluginSlotView } from "../PluginSlotView";
import { WORKSPACE_SESSION_LIMIT, displayWorkspace } from "../lib/text";
import type { InboxItem, PendingWakeRecord, SessionRecord } from "../types";

type WorkspaceSessionGroups = {
  workspaces: Array<{ path: string; sessions: SessionRecord[]; pinned: boolean }>;
  recent: SessionRecord[];
};

export interface SidebarProps {
  desktopToolbarLayout: boolean;
  newTaskButton: ReactNode;
  platform: string;
  inboxOpen: boolean;
  setInboxOpen: Dispatch<SetStateAction<boolean>>;
  setInboxItems: Dispatch<SetStateAction<InboxItem[]>>;
  inboxPendingCount: number;
  systemMessagesUnread: number;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  workspaceGroupOpen: Record<string, boolean>;
  setWorkspaceGroupOpen: Dispatch<SetStateAction<Record<string, boolean>>>;
  workspaceSessionGroups: WorkspaceSessionGroups;
  workspacePath: string;
  activeId: string;
  workspaceSessionsExpanded: Record<string, boolean>;
  setWorkspaceSessionsExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  workspaceMenuPath: string | null;
  setWorkspaceMenuPath: Dispatch<SetStateAction<string | null>>;
  sessionMenuId: string | null;
  setSessionMenuId: Dispatch<SetStateAction<string | null>>;
  renamingId: string | null;
  setRenamingId: Dispatch<SetStateAction<string | null>>;
  pluginsPageOpen: boolean;
  botTeamPageOpen: boolean;
  setBotTeamPageOpen: Dispatch<SetStateAction<boolean>>;
  setPluginsPageOpen: Dispatch<SetStateAction<boolean>>;
  botTeamAvailable: boolean;
  botTeamProvider: string;
  setRightPanelOpen: Dispatch<SetStateAction<boolean>>;
  setConversationView: Dispatch<SetStateAction<string>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setConversationSearchOpen: Dispatch<SetStateAction<boolean>>;
  setTerminalOpen: Dispatch<SetStateAction<boolean>>;
  recentExpanded: boolean;
  showArchived: boolean;
  setShowArchived: Dispatch<SetStateAction<boolean>>;
  sessions: SessionRecord[];
  runningSessionIds: Set<string>;
  sleepingSessions: Record<string, PendingWakeRecord>;
  skillSummarySessionId: string | null;
  fileManagerLabel: string;
  selectSession: (session: SessionRecord) => void;
  createTask: (targetWorkspacePath?: string) => void;
  renameSession: (id: string, title: string) => void;
  togglePin: (id: string) => void;
  archiveSession: (id: string) => void;
  unarchiveSession: (id: string) => void;
  deleteSession: (id: string) => void;
  exportSessionMarkdown: (session: SessionRecord) => void;
  summarizeSessionToSkill: (session: SessionRecord) => Promise<void>;
  toggleWorkspacePin: (targetWorkspacePath: string) => void;
  openWorkspaceInFileManager: (targetWorkspacePath: string) => Promise<void>;
  sessionPendingInboxCount: (sessionId: string) => number;
}

export function Sidebar(props: SidebarProps) {
  const {
    desktopToolbarLayout, newTaskButton, platform,
    inboxOpen, setInboxOpen, setInboxItems, inboxPendingCount, systemMessagesUnread,
    query, setQuery,
    workspaceGroupOpen, setWorkspaceGroupOpen, workspaceSessionGroups, workspacePath,
    activeId, workspaceSessionsExpanded, setWorkspaceSessionsExpanded,
    workspaceMenuPath, setWorkspaceMenuPath, sessionMenuId, setSessionMenuId,
    renamingId, setRenamingId,
    pluginsPageOpen, botTeamPageOpen, setBotTeamPageOpen, setPluginsPageOpen,
    botTeamAvailable, botTeamProvider, setRightPanelOpen, setConversationView,
    setSettingsOpen, setConversationSearchOpen, setTerminalOpen,
    recentExpanded, showArchived, setShowArchived, sessions,
    runningSessionIds, sleepingSessions, skillSummarySessionId, fileManagerLabel,
    selectSession, createTask, renameSession, togglePin, archiveSession, unarchiveSession,
    deleteSession, exportSessionMarkdown, summarizeSessionToSkill, toggleWorkspacePin,
    openWorkspaceInFileManager, sessionPendingInboxCount,
  } = props;

  const renderSessionItem = (session: SessionRecord) => {
    // 插件页打开时主内容区不是会话，会话列表就**不该再显示"当前选中"高亮**——
    // 否则用户会以为这个会话仍可点击选中（实际点了没反应：activeId 没变）。
    const selected = session.id === activeId && !pluginsPageOpen && !botTeamPageOpen;
    return (
    <div className={`session-item-wrap ${selected ? "active" : ""} ${session.pinned ? "pinned" : ""} ${session.archived ? "archived" : ""}`} key={session.id} data-menu-root>
      {renamingId === session.id ? (
        <input
          className="session-rename-input"
          autoFocus
          defaultValue={session.title}
          onKeyDown={(event) => {
            if (event.key === "Enter") renameSession(session.id, event.currentTarget.value);
            if (event.key === "Escape") setRenamingId(null);
          }}
          onBlur={(event) => renameSession(session.id, event.target.value)}
        />
      ) : (
        <button className={`session-item ${selected ? "active" : ""}`} onClick={() => selectSession(session)} title={session.title}>
          {session.pinned && <Pin size={12} className="pin-icon" />}
          {session.channel && (
            <span className={`session-channel-badge ${session.channel}`}>{session.channel === "qq" ? "QQ" : "微信"}</span>
          )}
          <span>{session.title}</span>
          {session.unread && <span className="session-unread-dot" role="status" aria-label="有新的完成结果" title="有新的完成结果" />}
          {sessionPendingInboxCount(session.id) > 0 && (
            <span className="session-pending-dot" role="status" aria-label="有待审批事项" title="该任务有待确认的审批或提问" />
          )}
          {runningSessionIds.has(session.id) && <LoaderCircle className="spin session-running-icon" size={15} />}
          {/* 挂起等待唤醒：列表里给出可见标记，否则用户不知道这个会话为什么发不出消息 */}
          {!runningSessionIds.has(session.id) && sleepingSessions[session.id] && (
            <Moon
              className="session-sleeping-icon"
              size={14}
              aria-label="任务已挂起，等待自动唤醒"
            />
          )}
        </button>
      )}
      <button
        className="icon-button subtle tiny session-menu-button"
        aria-label="任务操作"
        onClick={(event) => {
          event.stopPropagation();
          setWorkspaceMenuPath(null);
          setSessionMenuId(sessionMenuId === session.id ? null : session.id);
        }}
      >
        <MoreHorizontal size={14} />
      </button>
      {sessionMenuId === session.id && (
        <div className="session-menu" role="menu">
          <button role="menuitem" onClick={() => { setSessionMenuId(null); setRenamingId(session.id); }}>重命名</button>
          <button role="menuitem" onClick={() => { setSessionMenuId(null); togglePin(session.id); }}>
            {session.pinned ? "取消置顶" : "置顶"}
          </button>
          {session.archived ? (
            <button role="menuitem" onClick={() => unarchiveSession(session.id)}>取消归档</button>
          ) : (
            <button role="menuitem" onClick={() => { setSessionMenuId(null); archiveSession(session.id); }}>归档</button>
          )}
          <button role="menuitem" onClick={() => { setSessionMenuId(null); exportSessionMarkdown(session); }}>导出为 Markdown</button>
          <button
            role="menuitem"
            disabled={skillSummarySessionId === session.id}
            onClick={() => { setSessionMenuId(null); void summarizeSessionToSkill(session); }}
          >总结为工作模板</button>
          <button role="menuitem" className="danger" onClick={() => deleteSession(session.id)}>删除</button>
        </div>
      )}
    </div>
    );
  };

  return (
      <aside className="sidebar" aria-label="任务侧栏">
        <div className="native-controls-space" />
        <div className={desktopToolbarLayout ? "sidebar-primary-row" : "sidebar-brand-row"}>
          {desktopToolbarLayout ? newTaskButton : <span className="brand-button" aria-label="DYWorker">
            {platform !== "darwin" && <AppLogo />}
            <span>DYWorker</span>
          </span>}
          <div className="sidebar-brand-actions">
            <button
              className={`icon-button subtle inbox-button ${inboxOpen ? "active" : ""}`}
              aria-label="收件箱"
              title="收件箱：任务待办的审批与提问、系统消息（公告/版本提醒/维护通知）"
              onClick={() => {
                setInboxOpen(true);
                // 打开时重新拉取：主进程会顺带把孤儿 pending 条目判为失效，过期卡片不再滞留待处理区
                void window.dyworker?.listInbox?.().then(setInboxItems);
              }}
            >
              <Bell size={17} />
              {(inboxPendingCount > 0 || systemMessagesUnread > 0) && (
                <span className="inbox-badge">
                  {(inboxPendingCount + systemMessagesUnread) > 9 ? "9+" : (inboxPendingCount + systemMessagesUnread)}
                </span>
              )}
            </button>

            <button className="icon-button subtle" aria-label="搜索任务" onClick={() => setQuery((value) => value ? "" : " ")}>
              <Search size={18} />
            </button>

          </div>
        </div>

        {!desktopToolbarLayout && newTaskButton}

        {query !== "" && (
          <div className="sidebar-search-wrap">
            <Search size={15} />
            <input autoFocus value={query.trimStart()} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务" />
            <button className="bare-button" onClick={() => setQuery("")} aria-label="关闭搜索"><X size={14} /></button>
          </div>
        )}

        <div className="sidebar-scroll">
          <section className="sidebar-section workspace-session-section">
            <button className="recent-section-toggle" aria-expanded={workspaceGroupOpen.__projects__ !== false}
              onClick={() => setWorkspaceGroupOpen(current => ({ ...current, __projects__: current.__projects__ === false }))}>
              <span>项目</span>{workspaceGroupOpen.__projects__ === false ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
            {workspaceGroupOpen.__projects__ !== false && <div className="workspace-session-list">
                {workspaceSessionGroups.workspaces.map((group) => {
                  const expanded = workspaceGroupOpen[group.path] ?? group.path === workspacePath;
                  const isSearching = query.trim() !== "";
                  const totalSessions = group.sessions.length;
                  const hasActiveHiddenSession = group.sessions.slice(WORKSPACE_SESSION_LIMIT).some((session) => session.id === activeId);
                  const isSessionsExpanded = isSearching || (workspaceSessionsExpanded[group.path] ?? (hasActiveHiddenSession ? true : false));
                  const visibleGroupSessions = isSessionsExpanded || totalSessions <= WORKSPACE_SESSION_LIMIT
                    ? group.sessions
                    : group.sessions.slice(0, WORKSPACE_SESSION_LIMIT);
                  const showToggle = totalSessions > WORKSPACE_SESSION_LIMIT && !isSearching;
                  return (
                    <div className={`workspace-session-group ${expanded ? "expanded" : ""} ${group.pinned ? "pinned" : ""}`} key={group.path} data-menu-root>
                      <div className="workspace-session-row">
                        <button
                          className="workspace-session-heading"
                          onClick={() => setWorkspaceGroupOpen((current) => ({ ...current, [group.path]: !expanded }))}
                          aria-expanded={expanded}
                          title={group.path}
                        >
                          {expanded ? <FolderOpen size={16} /> : <Folder size={16} />}
                          <span>{displayWorkspace(group.path)}</span>
                          {group.pinned && <Pin size={12} className="workspace-pin-indicator" aria-label="已置顶" />}
                        </button>
                        <div className="workspace-session-actions">
                          <button
                            className="icon-button subtle tiny"
                            aria-label={`${displayWorkspace(group.path)} 更多操作`}
                            title="更多操作"
                            aria-expanded={workspaceMenuPath === group.path}
                            onClick={() => {
                              setSessionMenuId(null);
                              setWorkspaceMenuPath((current) => current === group.path ? null : group.path);
                            }}
                          >
                            <MoreHorizontal size={15} />
                          </button>
                          <button
                            className="icon-button subtle tiny"
                            aria-label={`在 ${displayWorkspace(group.path)} 中新建对话`}
                            title="新建对话"
                            onClick={() => createTask(group.path)}
                          >
                            <SquarePen size={15} />
                          </button>
                        </div>
                      </div>
                      {workspaceMenuPath === group.path && (
                        <div className="session-menu workspace-menu" role="menu">
                          <button role="menuitem" onClick={() => toggleWorkspacePin(group.path)}>
                            <Pin size={15} />
                            <span>{group.pinned ? "取消置顶项目" : "置顶项目"}</span>
                          </button>
                          <button role="menuitem" onClick={() => void openWorkspaceInFileManager(group.path)}>
                            <FolderOpen size={15} />
                            <span>{fileManagerLabel}</span>
                          </button>
                        </div>
                      )}
                      {expanded && (
                        <div className="session-list workspace-session-items">
                          {visibleGroupSessions.map(renderSessionItem)}
                          {showToggle && (
                            <button
                              type="button"
                              className="workspace-sessions-toggle"
                              onClick={() => {
                                setWorkspaceSessionsExpanded((current) => ({
                                  ...current,
                                  [group.path]: !isSessionsExpanded,
                                }));
                              }}
                            >
                              {isSessionsExpanded ? "收起显示" : "展开显示"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>}
            </section>

          {botTeamAvailable && <section className="sidebar-section bot-team-section">
            <button className={`recent-section-toggle bot-team-entry ${botTeamPageOpen ? "active" : ""}`}
              aria-label={botTeamProvider === "qwenpaw" ? "QwenPaw 助手" : "机器人团队"} aria-current={botTeamPageOpen ? "page" : undefined}
              onClick={() => { setBotTeamPageOpen(true); setRightPanelOpen(false); setPluginsPageOpen(false); setConversationView("chat"); setSettingsOpen(false); setConversationSearchOpen(false); setTerminalOpen(false); }}>
              <Bot size={16} /><span>{botTeamProvider === "qwenpaw" ? "QwenPaw 助手" : "机器人团队"}</span><ChevronRight size={13} />
            </button>
          </section>}

          <section className="sidebar-section recent-section">
            <button
              className="recent-section-toggle"
              onClick={() => setWorkspaceGroupOpen((current) => ({ ...current, __recent__: !recentExpanded }))}
              aria-expanded={recentExpanded}
            >
              <span>最近</span>
              {recentExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            {recentExpanded && workspaceSessionGroups.recent.length ? (
              <div className="session-list">{workspaceSessionGroups.recent.map(renderSessionItem)}</div>
            ) : null}
            {sessions.some((session) => session.archived) && (
              <button className="archived-toggle" onClick={() => setShowArchived((value) => !value)}>
                {showArchived ? "隐藏归档任务" : `显示归档任务（${sessions.filter((session) => session.archived).length}）`}
              </button>
            )}
          </section>
        </div>

        <div className="sidebar-plugin-actions"><PluginSlotView slot="sidebar.footer.action" wide hideEmpty /></div>
      </aside>
  );
}
