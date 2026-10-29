// 应用外壳：从 App.tsx 抽出的标题栏（含会话顶栏、任务菜单、会话工具）与窗口控制、主导航。
// 机械搬运，不改类名/文案/aria；App 内部逻辑（selectSession、createTask、git 处理等）仍留在 App.tsx，
// 这里只通过 props 接收状态与回调。
import { AlarmClock, Bot, Check, ChevronRight, Folder, GitBranch, GitCommitHorizontal, History, House, Info, Minus, MoreHorizontal, Plus, Search, Settings, Sparkles, Square, SquarePen, Upload, UserRound, X } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { AppLogo } from "../AppLogo";
import { PluginIcon } from "../PluginIcon";
import { ConversationToolsIcon, PanelLeftIcon, PanelRightIcon } from "./icons";
import { AppUpdateAction } from "../features/settings/SettingsSubPanels";
import type { SettingsTab } from "../features/settings/SettingsDialog";
import { displayWorkspace } from "../lib/text";
import type { AppUpdateStatus, GitBranchesInfo, GitDiffStats, SessionRecord, WorkspaceContext } from "../types";

export interface ShellChromeProps {
  desktopToolbarLayout: boolean;
  platform: string;
  activeSession: SessionRecord | undefined;
  conversationSearchInputRef: RefObject<HTMLInputElement | null>;
  topMenuOpen: boolean;
  setTopMenuOpen: Dispatch<SetStateAction<boolean>>;
  conversationToolsOpen: boolean;
  setConversationToolsOpen: Dispatch<SetStateAction<boolean>>;
  branchMenuOpen: boolean;
  setBranchMenuOpen: Dispatch<SetStateAction<boolean>>;
  commitPanelOpen: boolean;
  setCommitPanelOpen: Dispatch<SetStateAction<boolean>>;
  setToolPanelAddMenuOpen: Dispatch<SetStateAction<boolean>>;
  setRenamingId: Dispatch<SetStateAction<string | null>>;
  skillSummarySessionId: string | null;
  setPlanSeed: Dispatch<SetStateAction<{ name: string; prompt: string } | null>>;
  setSettingsTab: Dispatch<SetStateAction<SettingsTab>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  togglePin: (id: string) => void;
  archiveSession: (id: string) => void;
  exportSessionMarkdown: (session: SessionRecord) => void;
  exportSessionPackage: (session: SessionRecord) => Promise<void>;
  summarizeSessionToSkill: (session: SessionRecord) => Promise<void>;
  gitInfo: GitBranchesInfo | null;
  gitBusy: "" | "switch" | "commit" | "commit-push" | "push" | "generate";
  workspaceContext: WorkspaceContext | null;
  composerWorkspacePath: string;
  branchQuery: string;
  setBranchQuery: Dispatch<SetStateAction<string>>;
  creatingBranch: boolean;
  setCreatingBranch: Dispatch<SetStateAction<boolean>>;
  newBranchName: string;
  setNewBranchName: Dispatch<SetStateAction<string>>;
  commitMessage: string;
  setCommitMessage: Dispatch<SetStateAction<string>>;
  includeUnstaged: boolean;
  setIncludeUnstaged: Dispatch<SetStateAction<boolean>>;
  diffStats: GitDiffStats | null;
  refreshGitInfo: () => Promise<void>;
  toggleBranchMenu: () => void;
  openCommitPanel: () => void;
  switchBranch: (name: string) => Promise<void>;
  createBranch: () => Promise<void>;
  generateCommitMessage: () => Promise<void>;
  runCommit: (push: boolean) => Promise<void>;
  runPushOnly: () => Promise<void>;
  setConversationSearchOpen: Dispatch<SetStateAction<boolean>>;
  botTeamPageOpen: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  settingsOpen: boolean;
  pluginsPageOpen: boolean;
  rightPanelOpen: boolean;
  setRightPanelOpen: Dispatch<SetStateAction<boolean>>;
  toolPanelTabs: readonly unknown[];
  setToolPanelMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPluginsPageOpen: Dispatch<SetStateAction<boolean>>;
  setBotTeamPageOpen: Dispatch<SetStateAction<boolean>>;
  setConversationView: Dispatch<SetStateAction<string>>;
  setRailMenuOpen: Dispatch<SetStateAction<boolean>>;
  railMenuOpen: boolean;
  settingsTab: SettingsTab;
  showArchived: boolean;
  setShowArchived: Dispatch<SetStateAction<boolean>>;
  createTask: (targetWorkspacePath?: string) => void;
  appUpdate: AppUpdateStatus;
  setAppUpdateDialogOpen: Dispatch<SetStateAction<boolean>>;
  downloadAppUpdate: () => void;
}

export function ShellChrome(props: ShellChromeProps) {
  const {
    desktopToolbarLayout,
    platform,
    activeSession,
    conversationSearchInputRef,
    topMenuOpen,
    setTopMenuOpen,
    conversationToolsOpen,
    setConversationToolsOpen,
    branchMenuOpen,
    setBranchMenuOpen,
    commitPanelOpen,
    setCommitPanelOpen,
    setToolPanelAddMenuOpen,
    setRenamingId,
    skillSummarySessionId,
    setPlanSeed,
    setSettingsTab,
    setSettingsOpen,
    togglePin,
    archiveSession,
    exportSessionMarkdown,
    exportSessionPackage,
    summarizeSessionToSkill,
    gitInfo,
    gitBusy,
    workspaceContext,
    composerWorkspacePath,
    branchQuery,
    setBranchQuery,
    creatingBranch,
    setCreatingBranch,
    newBranchName,
    setNewBranchName,
    commitMessage,
    setCommitMessage,
    includeUnstaged,
    setIncludeUnstaged,
    diffStats,
    refreshGitInfo,
    toggleBranchMenu,
    openCommitPanel,
    switchBranch,
    createBranch,
    generateCommitMessage,
    runCommit,
    runPushOnly,
    setConversationSearchOpen,
    botTeamPageOpen,
    sidebarOpen,
    setSidebarOpen,
    settingsOpen,
    pluginsPageOpen,
    rightPanelOpen,
    setRightPanelOpen,
    toolPanelTabs,
    setToolPanelMenuOpen,
    setPluginsPageOpen,
    setBotTeamPageOpen,
    setConversationView,
    setRailMenuOpen,
    railMenuOpen,
    settingsTab,
    showArchived,
    setShowArchived,
    createTask,
    appUpdate,
    setAppUpdateDialogOpen,
    downloadAppUpdate,
  } = props;

  const taskMenu = (
    <div className="topbar-menu-wrap" data-menu-root>
      <button
        className="icon-button subtle"
        aria-label="任务操作"
        title="任务操作"
        onClick={() => { setTopMenuOpen((value) => !value); setConversationToolsOpen(false); setBranchMenuOpen(false); setCommitPanelOpen(false); setToolPanelAddMenuOpen(false); }}
      >
        <MoreHorizontal size={17} />
      </button>
      {topMenuOpen && activeSession && (
        <div className="session-menu topbar-menu" role="menu">
          <button role="menuitem" onClick={() => { setTopMenuOpen(false); setRenamingId(activeSession.id); }}>重命名任务</button>
          <button role="menuitem" onClick={() => togglePin(activeSession.id)}>
            {activeSession.pinned ? "取消置顶" : "置顶任务"}
          </button>
          <button role="menuitem" onClick={() => archiveSession(activeSession.id)}>归档任务</button>
          <button role="menuitem" onClick={() => { setTopMenuOpen(false); exportSessionMarkdown(activeSession); }}>导出为 Markdown</button>
          <button role="menuitem" onClick={() => { setTopMenuOpen(false); void exportSessionPackage(activeSession); }}>导出任务文件…</button>
          <button
            role="menuitem"
            disabled={skillSummarySessionId === activeSession.id}
            onClick={() => { setTopMenuOpen(false); void summarizeSessionToSkill(activeSession); }}
          >总结为工作模板</button>
          <button role="menuitem" onClick={() => {
            setTopMenuOpen(false);
            setPlanSeed({ name: activeSession.title, prompt: "" });
            setSettingsTab("plans");
            setSettingsOpen(true);
          }}>添加计划任务</button>
        </div>
      )}
    </div>
  );

  const conversationTools = (
    <div className="conversation-tools-wrap" data-menu-root>
      <button
        className={`icon-button subtle conversation-tools-toggle ${conversationToolsOpen || branchMenuOpen || commitPanelOpen ? "active" : ""}`}
        aria-label="会话工具"
        title="会话工具"
        aria-haspopup="menu"
        aria-expanded={conversationToolsOpen || branchMenuOpen || commitPanelOpen}
        onClick={() => {
          setConversationToolsOpen(value => !value);
          setBranchMenuOpen(false);
          setCommitPanelOpen(false);
          setTopMenuOpen(false);
          setToolPanelAddMenuOpen(false);
          void refreshGitInfo();
        }}
      >
        <ConversationToolsIcon size={19} />
      </button>
      {conversationToolsOpen && (
        <div className="session-menu conversation-tools-menu" role="menu" aria-label="会话工具">
          {gitInfo && (
            <button role="menuitem" className="conversation-tools-git" aria-label="Git 信息" onClick={() => {
              setConversationToolsOpen(false);
              toggleBranchMenu();
            }}>
              <GitBranch size={16} />
              <span>Git 信息</span>
              <small title={gitInfo.current}>{gitInfo.current}</small>
              <ChevronRight size={14} />
            </button>
          )}
          <button role="menuitem" onClick={() => {
            setConversationToolsOpen(false);
            setConversationSearchOpen(true);
            requestAnimationFrame(() => conversationSearchInputRef.current?.select());
          }}>
            <Search size={16} />
            <span>搜索会话内容</span>
            <kbd>{platform === "darwin" ? "⌘F" : "Ctrl+F"}</kbd>
          </button>
        </div>
      )}
      {gitInfo && (<>
                {branchMenuOpen && (
                  <div className="branch-menu" role="menu" aria-label="分支管理">
                    <button className="branch-menu-action" role="menuitem" onClick={openCommitPanel}>
                      <GitCommitHorizontal size={16} />
                      <span>提交或推送</span>
                      {gitInfo.uncommitted > 0 && <small className="tool-panel-count">{gitInfo.uncommitted}</small>}
                    </button>
                    <div className="branch-search">
                      <Search size={14} />
                      <input
                        aria-label="搜索分支"
                        placeholder={`搜索 ${workspaceContext?.name || displayWorkspace(composerWorkspacePath)} 分支`}
                        value={branchQuery}
                        onChange={(event) => setBranchQuery(event.target.value)}
                      />
                    </div>
                    <div className="branch-list">
                      {gitInfo.branches
                        .filter((name) => !branchQuery.trim() || name.toLowerCase().includes(branchQuery.trim().toLowerCase()))
                        .map((name) => (
                          <button
                            className={`branch-item ${name === gitInfo.current ? "current" : ""}`}
                            role="menuitemradio"
                            aria-checked={name === gitInfo.current}
                            key={name}
                            disabled={gitBusy === "switch"}
                            onClick={() => void switchBranch(name)}
                          >
                            <GitBranch size={14} />
                            <span className="branch-item-name">{name}</span>
                            {name === gitInfo.current && (
                              <span className="branch-item-meta">未提交：{gitInfo.uncommitted} 个文件</span>
                            )}
                            {name === gitInfo.current && <Check size={15} />}
                          </button>
                        ))}
                      {gitInfo.branches.filter((name) => !branchQuery.trim() || name.toLowerCase().includes(branchQuery.trim().toLowerCase())).length === 0 && (
                        <div className="branch-empty">没有匹配的分支</div>
                      )}
                    </div>
                    {creatingBranch ? (
                      <div className="branch-create">
                        <input
                          autoFocus
                          aria-label="新分支名称"
                          placeholder="新分支名称，Enter 确认"
                          value={newBranchName}
                          onChange={(event) => setNewBranchName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void createBranch();
                            if (event.key === "Escape") { setCreatingBranch(false); setNewBranchName(""); }
                          }}
                        />
                        <button disabled={!newBranchName.trim() || gitBusy === "switch"} onClick={() => void createBranch()}>创建</button>
                      </div>
                    ) : (
                      <button className="branch-create-toggle" role="menuitem" onClick={() => setCreatingBranch(true)}>
                        <Plus size={14} />
                        <span>创建并检出新分支…</span>
                      </button>
                    )}
                  </div>
                )}
                {commitPanelOpen && (
                  <div className="commit-panel" role="dialog" aria-label="提交或推送">
                    <div className="commit-panel-branch">
                      <GitBranch size={15} />
                      <span>{gitInfo.current}</span>
                    </div>
                    <textarea
                      className="commit-message-input"
                      aria-label="提交信息"
                      placeholder="提交信息（留空按文件名自动生成）"
                      rows={3}
                      value={commitMessage}
                      onChange={(event) => setCommitMessage(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void runCommit(true);
                      }}
                    />
                    <div className="commit-ai-row">
                      <button type="button" onClick={() => void generateCommitMessage()} disabled={Boolean(gitBusy)} title="用当前模型按改动生成提交信息">
                        <Sparkles size={14} />
                        <span>{gitBusy === "generate" ? "生成中…" : "AI 生成提交信息"}</span>
                      </button>
                    </div>
                    <label className="commit-include-row">
                      <span className="commit-include-label">
                        <input
                          type="checkbox"
                          checked={includeUnstaged}
                          onChange={(event) => setIncludeUnstaged(event.target.checked)}
                        />
                        <span>包含未暂存的更改</span>
                      </span>
                      {diffStats && (diffStats.added > 0 || diffStats.removed > 0) && (
                        <span className="commit-diff-stats">
                          <span className="diff-added">+{diffStats.added.toLocaleString()}</span>
                          <span className="diff-removed">-{diffStats.removed.toLocaleString()}</span>
                        </span>
                      )}
                    </label>
                    <div className="commit-actions">
                      <button disabled={Boolean(gitBusy)} onClick={() => void runCommit(false)}>
                        <GitCommitHorizontal size={15} />
                        <span>{gitBusy === "commit" ? "提交中…" : "提交"}</span>
                      </button>
                      <button className="commit-primary" disabled={Boolean(gitBusy)} onClick={() => void runCommit(true)}>
                        <Upload size={15} />
                        <span>{gitBusy === "commit-push" ? "提交并推送中…" : "提交并推送"}</span>
                        <kbd>{platform === "darwin" ? "⌘↩" : "Ctrl+↩"}</kbd>
                      </button>
                      <button disabled={Boolean(gitBusy) || !gitInfo.hasRemote} title={gitInfo.hasRemote ? "推送当前分支到远程" : "当前仓库没有配置远程"} onClick={() => void runPushOnly()}>
                        <Upload size={15} />
                        <span>{gitBusy === "push" ? "推送中…" : "推送"}</span>
                      </button>
                    </div>
                  </div>
                )}
      </>)}
    </div>
  );

  const conversationHeader = (
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button subtle sidebar-toggle"
              aria-label="展开侧栏"
              title="展开侧栏"
              onClick={() => setSidebarOpen(true)}
            >
              {/* 与侧栏里的「收起侧栏」用同一个图标：收起/展开不换图（用户口径） */}
              <PanelLeftIcon size={18} />
            </button>
            {botTeamPageOpen ? <Bot size={18} /> : Boolean(activeSession?.messages.length) && <Folder size={18} />}
            <strong>{botTeamPageOpen ? "机器人团队" : activeSession?.title || "新任务"}</strong>
          </div>
          {!botTeamPageOpen && Boolean(activeSession?.messages.length) && <div className="topbar-right no-drag">
            {taskMenu}
            {conversationTools}
          </div>}
        </header>
  );

  return (
    <>
      <header className="titlebar" aria-label="标题栏">
        {desktopToolbarLayout && <span className="titlebar-app-logo"><AppLogo /></span>}
        <div className="titlebar-left">
          {desktopToolbarLayout && <span className="titlebar-brand"><span>DYWorker</span></span>}
          <button className="icon-button subtle" aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"}
            title={sidebarOpen ? "收起侧栏" : "展开侧栏"} aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(open => !open)}><PanelLeftIcon size={18} /></button>
        </div>
        {!settingsOpen && !pluginsPageOpen && (
          <div className="titlebar-conversation">{conversationHeader}</div>
        )}
        <div className="titlebar-right">
            {!rightPanelOpen && !settingsOpen && !pluginsPageOpen && (
              <div className="titlebar-panel-actions">
                <button
                  className="icon-button subtle tool-panel-toggle"
                  aria-label="展开右侧工具栏"
                  title="展开右侧工具栏"
                  onClick={() => {
                    setRightPanelOpen(true);
                    // 还没有任何标签页时展示菜单页，由用户决定打开什么（对照 Codex）
                    setToolPanelMenuOpen(toolPanelTabs.length === 0);
                  }}
                >
                  <PanelRightIcon size={18} />
                </button>
              </div>
            )}
        </div>
      </header>
      <div className="window-controls" aria-label="窗口控制">
        <button type="button" onClick={() => void window.dyworker?.minimize()} aria-label="最小化窗口" title="最小化">
          <Minus size={15} />
        </button>
        <button type="button" onClick={() => void window.dyworker?.toggleMaximize()} aria-label="最大化或还原窗口" title="最大化或还原">
          <Square size={11} />
        </button>
        <button type="button" className="window-close" onClick={() => void window.dyworker?.close()} aria-label="关闭窗口" title="关闭">
          <X size={15} />
        </button>
      </div>
      <nav className="navigation-rail" aria-label="主导航">
        <button className={`rail-button ${!pluginsPageOpen && !settingsOpen && !botTeamPageOpen ? "active" : ""}`}
          aria-label="首页" title="首页" aria-current={!pluginsPageOpen && !settingsOpen && !botTeamPageOpen ? "page" : undefined}
          onClick={() => { setPluginsPageOpen(false); setBotTeamPageOpen(false); setSettingsOpen(false); setConversationView("chat"); setRailMenuOpen(false); }}>
          <House size={21} />
        </button>
        <button className={`rail-button ${settingsOpen && settingsTab === "plans" ? "active" : ""}`}
          aria-label="计划任务" title="计划任务" onClick={() => { setSettingsTab("plans"); setSettingsOpen(true); setRailMenuOpen(false); }}>
          <AlarmClock size={20} />
        </button>
        <button className={`rail-button sidebar-plugins-button ${settingsOpen && settingsTab === "plugins" ? "active" : ""}`}
          onClick={() => { setPluginsPageOpen(false); setBotTeamPageOpen(false); setSettingsTab("plugins"); setSettingsOpen(true); setRailMenuOpen(false); }}
          aria-label="插件" title="插件" aria-current={settingsOpen && settingsTab === "plugins" ? "page" : undefined}>
          <PluginIcon size={20} />
        </button>
        <div className="rail-more-wrap" data-menu-root>
          <button className={`rail-button ${railMenuOpen ? "active" : ""}`} aria-label="更多菜单" title="更多"
            aria-haspopup="menu" aria-expanded={railMenuOpen} onClick={() => setRailMenuOpen(open => !open)}><MoreHorizontal size={21} /></button>
          {railMenuOpen && <div className="session-menu rail-menu" role="menu">
            <button role="menuitem" onClick={() => { setRailMenuOpen(false); createTask(); }}><SquarePen size={16} />新建任务</button>
            <button role="menuitem" onClick={() => { setRailMenuOpen(false); setSettingsOpen(true); }}><Settings size={16} />设置</button>
            <button role="menuitem" onClick={() => { setRailMenuOpen(false); setSettingsTab("about"); setSettingsOpen(true); }}><Info size={16} />关于</button>
            <button role="menuitem" onClick={() => { setRailMenuOpen(false); setSidebarOpen(true); setShowArchived(value => !value); }}><History size={16} />{showArchived ? "隐藏归档任务" : "显示归档任务"}</button>
          </div>}
        </div>
        <div className="rail-footer">
          <AppUpdateAction status={appUpdate} onOpen={() => setAppUpdateDialogOpen(true)}
            onDownload={downloadAppUpdate} onInstall={() => setAppUpdateDialogOpen(true)} />
          <button className="rail-profile" aria-label="设置" title="设置" onClick={() => { setRailMenuOpen(false); setSettingsOpen(true); }}>
            <span className="avatar" data-auth-status="logged-out"><UserRound size={15} /></span>
          </button>
        </div>
      </nav>
    </>
  );
}
