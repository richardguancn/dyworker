// 右侧工具面板：从 App.tsx 抽出的 <aside className={`tool-panel ...`}> 整段（标签条、
// 菜单页、浏览器/文件/侧边聊天/后台任务/审阅/插件各标签内容）。
// 机械搬运，不改类名/文案/aria；App 内部逻辑（focusToolPanelTab、closeToolPanelTab、
// scrollToolPanelTabStrip、openToolPanelTab、浏览器工具函数、各种 useState/useEffect 等）
// 仍留在 App.tsx，这里只通过 props 接收状态与回调。
import { AlertTriangle, ArrowUpRight, ChevronLeft, ChevronRight, FileDiff, FileText, FolderOpen, Globe, History, KeyRound, MessageSquarePlus, Monitor, MoreVertical, Plus, RefreshCw, Search, SquarePlus, X } from "lucide-react";
import { createElement } from "react";
import type { CSSProperties, Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import { PanelRightIcon } from "../../app/icons";
import { PluginSlotView } from "../../PluginSlotView";
import { BrowserControlOverlay } from "../../BrowserControlOverlay";
import { FilePreviewPanel } from "../../FilePreviewPanel";
import { FilesSplitPanel } from "../files/FilesSplitPanel";
import { SideChatPanel } from "../sessions/SideChatPanel";
import { BackgroundTasksPanel } from "../../BackgroundTasksPanel";
import { GitReviewPanel } from "../review/GitReviewPanel";
import { ReviewPanel } from "../review/ReviewPanels";
import { BROWSER_DEVICE_PRESETS, BROWSER_START_LINKS, type BrowserWebviewElement } from "../browser/browserUtils";
import type { BrowserControlState, FileChange, ProviderSettings, SessionRecord, WorkspaceEntry } from "../../types";
import type { ToolPanelTab } from "../../state/layoutStore";

export interface ToolPanelProps {
  activeToolPanelKind: ToolPanelTab["kind"];
  toolPanelTabs: ToolPanelTab[];
  activeToolPanelTabId: string;
  activeToolPanelTab: ToolPanelTab | undefined;
  toolPanelTabOverflow: { start: boolean; end: boolean };
  pristineMenuPage: boolean;
  menuPageShown: boolean;
  rightPanelOpen: boolean;
  toolPanelAddMenuOpen: boolean;
  toolPanelMenu: ReactNode;
  toolPanelAddMenu: ReactNode;
  toolPanelTabStripRef: RefObject<HTMLDivElement | null>;

  workspacePath: string;
  workspaceEntries: WorkspaceEntry[];
  workspaceOpen: boolean;
  activeSession: SessionRecord | undefined;
  settings: ProviderSettings;
  sideChatSeed: { text: string; nonce: number } | null;
  activeId: string;

  browserSuggestionsOpen: boolean;
  browserSuggestions: Array<{ url: string; title: string }>;
  browserSuggestionIndex: number;
  browserUrlDraft: { tabId: string; value: string } | null;
  browserOpening: boolean;
  browserMoreOpen: boolean;
  browserFind: { tabId: string; text: string; matches: number; active: number } | null;
  browserPasswordPrompt: { tabId: string; origin: string; username: string; password: string } | null;
  browserControlState: BrowserControlState | null;

  reviewChanges: FileChange[];
  reviewFocusChanges: FileChange[] | null;

  focusToolPanelTab: (id: string) => void;
  closeToolPanelTab: (id: string) => void;
  scrollToolPanelTabStrip: (direction: -1 | 1) => void;

  setToolPanelAddMenuOpen: Dispatch<SetStateAction<boolean>>;
  setConversationToolsOpen: Dispatch<SetStateAction<boolean>>;
  setBranchMenuOpen: Dispatch<SetStateAction<boolean>>;
  setCommitPanelOpen: Dispatch<SetStateAction<boolean>>;
  setRightPanelOpen: Dispatch<SetStateAction<boolean>>;
  setBrowserSuggestionsOpen: Dispatch<SetStateAction<boolean>>;
  setBrowserSuggestionIndex: Dispatch<SetStateAction<number>>;
  setBrowserUrlDraft: Dispatch<SetStateAction<{ tabId: string; value: string } | null>>;
  setBrowserFind: Dispatch<SetStateAction<{ tabId: string; text: string; matches: number; active: number } | null>>;
  setBrowserMoreOpen: Dispatch<SetStateAction<boolean>>;
  setBrowserSection: Dispatch<SetStateAction<"history" | "downloads" | "clear" | null>>;
  setBrowserPasswordsOpen: Dispatch<SetStateAction<boolean>>;
  setImportDialogOpen: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setToolPanelTabs: Dispatch<SetStateAction<ToolPanelTab[]>>;

  patchBrowserTab: (tabId: string, patch: Partial<ToolPanelTab>) => void;
  openBrowserUrl: (rawOverride?: string) => Promise<void>;
  openBrowserTab: (initialUrl?: string, options?: { reuseBlank?: boolean }) => void;
  changeBrowserZoom: (delta: number) => void;
  browserZoomPercent: (tab: ToolPanelTab | undefined) => number;
  resetBrowserZoom: () => void;
  openBrowserFind: () => void;
  printBrowserPage: () => void;
  captureBrowserScreenshot: () => Promise<void>;
  openBrowserExternal: () => Promise<void>;
  applyBrowserDevice: (tab: ToolPanelTab, device: { name: string; width: number; height: number } | null) => Promise<void>;
  rotateBrowserDevice: () => void;
  runBrowserFind: (forward: boolean, findNext: boolean) => void;
  closeBrowserFind: () => void;
  saveBrowserPasswordPrompt: () => Promise<void>;
  dismissBrowserPasswordPrompt: () => void;
  fillSavedPassword: () => Promise<void>;
  activeBrowserWebview: () => BrowserWebviewElement | undefined;
  browserWebviewRefFor: (tabId: string) => (node: BrowserWebviewElement | null) => void;

  choosePreviewFile: () => Promise<void>;
  openFilePreview: (filePath: string, root: string) => void;
  insertFileToken: (file: WorkspaceEntry) => void;
  refreshWorkspace: () => Promise<void>;
  openToolPanelTab: (kind: ToolPanelTab["kind"], createNew?: boolean, initialUrl?: string) => void;
  shortcutLabel: (mac: string, other: string) => string;
}

export function ToolPanel(props: ToolPanelProps) {
  const {
    activeToolPanelKind, toolPanelTabs, activeToolPanelTabId, activeToolPanelTab, toolPanelTabOverflow,
    pristineMenuPage, menuPageShown, rightPanelOpen, toolPanelAddMenuOpen, toolPanelMenu, toolPanelAddMenu,
    toolPanelTabStripRef,
    workspacePath, workspaceEntries, workspaceOpen, activeSession, settings, sideChatSeed, activeId,
    browserSuggestionsOpen, browserSuggestions, browserSuggestionIndex, browserUrlDraft, browserOpening,
    browserMoreOpen, browserFind, browserPasswordPrompt, browserControlState,
    reviewChanges, reviewFocusChanges,
    focusToolPanelTab, closeToolPanelTab, scrollToolPanelTabStrip,
    setToolPanelAddMenuOpen, setConversationToolsOpen, setBranchMenuOpen, setCommitPanelOpen, setRightPanelOpen,
    setBrowserSuggestionsOpen, setBrowserSuggestionIndex, setBrowserUrlDraft, setBrowserFind, setBrowserMoreOpen,
    setBrowserSection, setBrowserPasswordsOpen, setImportDialogOpen, setError, setNotice, setToolPanelTabs,
    patchBrowserTab, openBrowserUrl, openBrowserTab, changeBrowserZoom, browserZoomPercent, resetBrowserZoom,
    openBrowserFind, printBrowserPage, captureBrowserScreenshot, openBrowserExternal, applyBrowserDevice,
    rotateBrowserDevice, runBrowserFind, closeBrowserFind, saveBrowserPasswordPrompt, dismissBrowserPasswordPrompt,
    fillSavedPassword, activeBrowserWebview, browserWebviewRefFor,
    choosePreviewFile, openFilePreview, insertFileToken, refreshWorkspace, openToolPanelTab, shortcutLabel,
  } = props;
  return (
      <aside className={`tool-panel ${activeToolPanelKind === "browser" ? "browser-mode" : ""}`} aria-label="右侧工具栏">
        <div className="tool-panel-tabs" role="tablist" aria-label="打开的文件和网页">
          <div className="tool-panel-tab-strip-wrap">
          <div
            className="tool-panel-tab-strip"
            ref={toolPanelTabStripRef}
            data-overflow-start={toolPanelTabOverflow.start ? "true" : "false"}
            data-overflow-end={toolPanelTabOverflow.end ? "true" : "false"}
          >
          {!pristineMenuPage && toolPanelTabs.map((tab) => (
            <div className={`tool-panel-tab ${tab.id === activeToolPanelTabId ? "active" : ""}`} key={tab.id} data-tool-panel-tab-id={tab.id} role="presentation">
              <button
                className="tool-panel-tab-main"
                role="tab"
                aria-selected={tab.id === activeToolPanelTabId}
                onClick={() => focusToolPanelTab(tab.id)}
                onFocus={(event) => event.currentTarget.closest<HTMLElement>(".tool-panel-tab")?.scrollIntoView({ block: "nearest", inline: "nearest" })}
                title={tab.title}
              >
                {tab.kind === "browser"
                  ? tab.loading
                    ? <span className="browser-tab-spinner" aria-hidden="true" />
                    : tab.favicon
                      ? <img className="browser-tab-favicon" src={tab.favicon} alt="" aria-hidden="true" />
                      : <Globe size={16} />
                  : tab.kind === "preview" ? <FileText size={16} /> : tab.kind === "review" ? <SquarePlus size={16} /> : tab.kind === "chat" ? <MessageSquarePlus size={16} /> : <FolderOpen size={16} />}
                <span>{tab.title}</span>
              </button>
              <button className="tool-panel-tab-close" aria-label={`关闭${tab.title}`} onClick={(event) => { event.stopPropagation(); closeToolPanelTab(tab.id); }}>
                <X size={14} />
              </button>
            </div>
          ))}
          </div>
          {!pristineMenuPage && toolPanelTabOverflow.start && (
            <button
              className="tool-panel-tab-scroll prev"
              aria-label="向前滚动标签页"
              title="向前滚动标签页"
              onClick={() => scrollToolPanelTabStrip(-1)}
            >
              <ChevronLeft size={16} />
            </button>
          )}
          {!pristineMenuPage && toolPanelTabOverflow.end && (
            <button
              className="tool-panel-tab-scroll next"
              aria-label="向后滚动标签页"
              title="向后滚动标签页"
              onClick={() => scrollToolPanelTabStrip(1)}
            >
              <ChevronRight size={16} />
            </button>
          )}
          </div>
          {rightPanelOpen && !pristineMenuPage && toolPanelAddMenu}
          <div className="tool-panel-header-actions tool-panel-tabs-actions" data-menu-root>
            {!pristineMenuPage && (
              <button
                className={`tool-panel-new-tab ${toolPanelAddMenuOpen ? "active" : ""}`}
                aria-label="打开侧边操作"
                title="打开侧边操作"
                aria-expanded={toolPanelAddMenuOpen}
                onClick={() => { setToolPanelAddMenuOpen((value) => !value); setConversationToolsOpen(false); setBranchMenuOpen(false); setCommitPanelOpen(false); }}
              >
                <Plus size={18} />
              </button>
            )}
            <button
              className="icon-button subtle"
              aria-label="收起右侧工具栏"
              title="收起右侧工具栏"
              onClick={() => { setRightPanelOpen(false); setToolPanelAddMenuOpen(false); }}
            >
              <PanelRightIcon size={18} />
            </button>
          </div>
        </div>
        <div className={`tool-panel-scroll ${activeToolPanelKind === "browser" && !menuPageShown ? "browser-scroll" : ""}`}>
          {menuPageShown && <div className="tool-panel-menu-page" data-menu-root>{toolPanelMenu}</div>}
          {!menuPageShown && activeToolPanelTab && activeToolPanelKind === "plugin" && (
            <section className="plugin-slot-panel">
              {/* 面板里的插件视图同样要拿得到当前会话：轨迹/上下文这类视图都是会话级的 */}
              <PluginSlotView
                pluginId={activeToolPanelTab.pluginId}
                pluginKey={activeToolPanelTab.pluginKey}
                sessionId={activeSession?.id}
                session={activeSession}
              />
            </section>
          )}
          {!menuPageShown && activeToolPanelTab && activeToolPanelKind === "browser" && (
            <section className="browser-panel">
              <div className="browser-toolbar">
                <button
                  className="browser-toolbar-button"
                  aria-label="后退"
                  title="后退"
                  onClick={() => activeBrowserWebview()?.goBack?.()}
                  disabled={!activeToolPanelTab.canGoBack}
                >
                  <ChevronRight size={17} className="browser-back-icon" />
                </button>
                <button
                  className="browser-toolbar-button"
                  aria-label="前进"
                  title="前进"
                  onClick={() => activeBrowserWebview()?.goForward?.()}
                  disabled={!activeToolPanelTab.canGoForward}
                >
                  <ChevronRight size={17} />
                </button>
                {activeToolPanelTab.loading ? (
                  <button
                    className="browser-toolbar-button"
                    aria-label="停止加载"
                    title="停止加载"
                    onClick={() => activeBrowserWebview()?.stop?.()}
                  >
                    <X size={16} />
                  </button>
                ) : (
                  <button
                    className="browser-toolbar-button"
                    aria-label="刷新"
                    title="刷新"
                    onClick={() => activeBrowserWebview()?.reload?.()}
                    disabled={!activeToolPanelTab.loadedUrl}
                  >
                    <RefreshCw size={16} />
                  </button>
                )}
                <div className="browser-url-wrap">
                  {activeToolPanelTab.favicon && activeToolPanelTab.loadedUrl && (
                    <img className="browser-url-favicon" src={activeToolPanelTab.favicon} alt="" aria-hidden="true" />
                  )}
                  <input
                    className="browser-url-input"
                    placeholder="输入 URL 或搜索词"
                    aria-label="网页地址"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={browserSuggestionsOpen && browserSuggestions.length > 0}
                    aria-controls="browser-history-suggestions"
                    aria-activedescendant={browserSuggestionsOpen && browserSuggestions[browserSuggestionIndex] ? `browser-suggestion-${browserSuggestionIndex}` : undefined}
                    autoComplete="off"
                    value={browserUrlDraft?.tabId === activeToolPanelTab.id ? browserUrlDraft.value : activeToolPanelTab.url || ""}
                    onChange={(event) => { setBrowserUrlDraft({ tabId: activeToolPanelTab.id, value: event.target.value }); setBrowserSuggestionsOpen(true); setBrowserSuggestionIndex(-1); }}
                    onFocus={(event) => { event.currentTarget.select(); setBrowserSuggestionsOpen(true); }}
                    onBlur={() => setBrowserSuggestionsOpen(false)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault(); setBrowserSuggestionsOpen(true);
                        setBrowserSuggestionIndex((current) => browserSuggestions.length ? (current + (event.key === "ArrowDown" ? 1 : -1) + browserSuggestions.length) % browserSuggestions.length : -1);
                      }
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void openBrowserUrl(browserSuggestionsOpen && browserSuggestionIndex >= 0 ? browserSuggestions[browserSuggestionIndex]?.url : undefined); }
                      if (event.key === "Escape") {
                        setBrowserUrlDraft(null);
                        event.currentTarget.blur();
                      }
                    }}
                    disabled={browserOpening}
                  />
                  {browserSuggestionsOpen && browserSuggestions.length > 0 && (
                    <div id="browser-history-suggestions" className="browser-suggestions" role="listbox" aria-label="地址建议">
                      {browserSuggestions.map((entry, index) => <button type="button" role="option" id={`browser-suggestion-${index}`} aria-selected={index === browserSuggestionIndex} key={entry.url}
                        onMouseDown={(event) => event.preventDefault()} onClick={() => void openBrowserUrl(entry.url)} title={entry.url}>
                        <History size={15} /><span><strong>{entry.title || entry.url}</strong><small>{entry.url}</small></span>
                      </button>)}
                    </div>
                  )}
                  <button
                    className="browser-url-submit"
                    aria-label="打开网页"
                    title="打开网页"
                    onClick={() => void openBrowserUrl()}
                    disabled={browserOpening}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </div>
                <button
                  className="browser-toolbar-button"
                  aria-label="新建标签页"
                  title={shortcutLabel("新建标签页（⌘T）", "新建标签页（Ctrl+T）")}
                  onClick={() => openBrowserTab()}
                >
                  <Plus size={17} />
                </button>
                <div className="browser-more-wrap" data-menu-root>
                  <button
                    className={`browser-toolbar-more ${browserMoreOpen ? "active" : ""}`}
                    aria-label="浏览器更多操作"
                    title="更多操作"
                    aria-expanded={browserMoreOpen}
                    onClick={() => setBrowserMoreOpen((value) => !value)}
                  >
                    <MoreVertical size={16} />
                  </button>
                  {browserMoreOpen && (
                    <div className="session-menu browser-more-menu" role="menu">
                      <div className="browser-more-zoom" aria-label="缩放">
                        <span className="browser-more-label">缩放</span>
                        <span className="browser-more-zoom-controls">
                          <button role="menuitem" aria-label="缩小" title="缩小" onClick={() => changeBrowserZoom(-1)}>−</button>
                          <span>{browserZoomPercent(activeToolPanelTab)}%</span>
                          <button role="menuitem" aria-label="放大" title="放大" onClick={() => changeBrowserZoom(1)}>＋</button>
                          <button role="menuitem" aria-label="重置缩放" title="重置缩放" disabled={(activeToolPanelTab.zoom ?? 0) === 0} onClick={resetBrowserZoom}>重置</button>
                        </span>
                      </div>
                      <button role="menuitem" disabled={!activeToolPanelTab.loadedUrl} onClick={() => { setBrowserMoreOpen(false); openBrowserFind(); }}>在页面中查找…</button>
                      <button role="menuitem" disabled={!activeToolPanelTab.loadedUrl} onClick={() => { setBrowserMoreOpen(false); printBrowserPage(); }}>打印…</button>
                      <button role="menuitem" disabled={!activeToolPanelTab.loadedUrl} onClick={() => { setBrowserMoreOpen(false); void captureBrowserScreenshot(); }}>截取屏幕截图</button>
                      <button role="menuitem" disabled={!activeToolPanelTab.url} onClick={() => { setBrowserMoreOpen(false); void openBrowserExternal(); }}>在系统浏览器打开</button>
                      <div className="browser-more-sep" />
                      <div className="browser-more-zoom" aria-label="设备工具栏">
                        <span className="browser-more-label">设备视图</span>
                        <span className="browser-more-zoom-controls">
                          {BROWSER_DEVICE_PRESETS.map((preset) => (
                            <button
                              key={preset.name}
                              role="menuitem"
                              className={activeToolPanelTab.device?.name === preset.name ? "active" : ""}
                              title={`${preset.name}视图（${preset.width}×${preset.height}）`}
                              onClick={() => {
                                setBrowserMoreOpen(false);
                                void applyBrowserDevice(activeToolPanelTab, activeToolPanelTab.device?.name === preset.name ? null : preset);
                              }}
                            >{preset.name}</button>
                          ))}
                        </span>
                      </div>
                      <div className="browser-more-sep" />
                      {([["history", "历史记录"], ["downloads", "下载记录"], ["clear", "清除浏览数据"]] as const).map(([section, label]) => (
                        <button role="menuitem" key={section} onClick={() => { setBrowserMoreOpen(false); setBrowserSection(section); }}>
                          <span>{label}</span><ChevronRight size={14} />
                        </button>
                      ))}
                      <div className="browser-more-sep" />
                      <button role="menuitem" onClick={() => { setBrowserMoreOpen(false); setBrowserPasswordsOpen(true); }}>密码和自动填充…</button>
                      <button role="menuitem" onClick={() => { setBrowserMoreOpen(false); setImportDialogOpen(true); }}>导入 Cookie 和密码…</button>
                    </div>
                  )}
                </div>
              </div>
              {browserFind && browserFind.tabId === activeToolPanelTab.id && (
                <div className="browser-find-bar">
                  <Search size={13} />
                  <input
                    autoFocus
                    className="browser-find-input"
                    placeholder="在页面中查找"
                    aria-label="在页面中查找"
                    value={browserFind.text}
                    onChange={(event) => setBrowserFind({ ...browserFind, text: event.target.value, matches: 0, active: 0 })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        runBrowserFind(!event.shiftKey, true);
                      }
                      if (event.key === "Escape") closeBrowserFind();
                    }}
                  />
                  <span className="browser-find-count" aria-live="polite">
                    {browserFind.text ? (browserFind.matches ? `${browserFind.active}/${browserFind.matches}` : "无结果") : ""}
                  </span>
                  <button aria-label="上一个" title="上一个（Shift+Enter）" onClick={() => runBrowserFind(false, true)}><ChevronRight size={14} className="browser-back-icon" /></button>
                  <button aria-label="下一个" title="下一个（Enter）" onClick={() => runBrowserFind(true, true)}><ChevronRight size={14} /></button>
                  <button aria-label="关闭查找" title="关闭（Esc）" onClick={closeBrowserFind}><X size={14} /></button>
                </div>
              )}
              {activeToolPanelTab.device && (
                <div className="browser-device-bar">
                  <Monitor size={13} />
                  <span>{activeToolPanelTab.device.name}视图 · {activeToolPanelTab.device.width}×{activeToolPanelTab.device.height}</span>
                  <button onClick={rotateBrowserDevice} title="横竖屏切换">旋转</button>
                  <button onClick={() => void applyBrowserDevice(activeToolPanelTab, null)} title="退出设备视图">退出</button>
                </div>
              )}
              {activeToolPanelTab.loading && <div className="browser-progress" aria-hidden="true" />}
              {browserPasswordPrompt && browserPasswordPrompt.tabId === activeToolPanelTab.id && (
                <div className="browser-password-bar">
                  <KeyRound size={14} />
                  <span className="browser-password-bar-text">
                    保存 <strong>{browserPasswordPrompt.origin.replace(/^https?:\/\//i, "")}</strong> 的密码{browserPasswordPrompt.username ? `（${browserPasswordPrompt.username}）` : ""}？
                  </span>
                  <button className="primary" onClick={() => void saveBrowserPasswordPrompt()}>保存</button>
                  <button onClick={dismissBrowserPasswordPrompt}>不保存</button>
                </div>
              )}
              <div className="browser-content">
                <BrowserControlOverlay
                  controlState={browserControlState}
                  activeTabId={activeToolPanelTabId}
                />
                {activeToolPanelTab.fillHint && !activeToolPanelTab.loading && activeToolPanelTab.loadedUrl && (
                  <button className="browser-fill-chip" onClick={() => void fillSavedPassword()} title="自动填写此站点已保存的用户名和密码">
                    <KeyRound size={12} />
                    填充已保存的密码（{activeToolPanelTab.fillHint}）
                  </button>
                )}
                {toolPanelTabs.filter((tab) => tab.kind === "browser").map((tab) => {
                  const isActive = tab.id === activeToolPanelTabId;
                  if (!tab.loadedUrl) {
                    // 未打开过网页的标签页显示起始页；非激活的空标签页无需渲染
                    return isActive ? (
                      <div className="browser-start-page" key={tab.id}>
                        <Globe size={40} />
                        <strong>开始浏览</strong>
                        {BROWSER_START_LINKS.length > 0 && (
                          <div className="browser-start-links">
                            {BROWSER_START_LINKS.map((link) => (
                              <button key={link.name} onClick={() => void openBrowserUrl(link.url)}>{link.name}</button>
                            ))}
                          </div>
                        )}
                        <span>在上方地址栏输入网址，或让助手用浏览器工具打开页面</span>
                      </div>
                    ) : null;
                  }
                  return (
                    <div
                      key={tab.id}
                      className={`browser-tab-page${isActive ? " active" : ""}${tab.device ? " emulated" : ""}`}
                      aria-hidden={!isActive}
                      style={tab.device ? { "--device-width": `${tab.device.width}px`, "--device-height": `${tab.device.height}px` } as CSSProperties : undefined}
                    >
                      {createElement("webview", {
                        key: tab.id,
                        ref: browserWebviewRefFor(tab.id),
                        className: "browser-webview",
                        src: tab.loadedUrl,
                        partition: "persist:dyworker-browser",
                        title: tab.title,
                        // 页面里 target=_blank / window.open 的链接要交给我们处理成
                        // 面板内的新标签页（主进程 setWindowOpenHandler 一律 deny，
                        // 不会真的弹原生窗口）：不允许弹窗时这些请求根本不会上报，
                        // 表现就是点了没反应的链接。React 对未知标签只认字符串属性，
                        // 传布尔 true 不会落到 DOM 属性上（实测拿不到），故用空串。
                        allowpopups: "",
                      })}
                      {isActive && tab.loadError && (
                        <div className="browser-error-state">
                          <AlertTriangle size={34} />
                          <strong>{tab.loadError}</strong>
                          <span>请检查网址是否正确，或稍后重试</span>
                          <div className="browser-error-actions">
                            <button onClick={() => { patchBrowserTab(tab.id, { loadError: "" }); activeBrowserWebview()?.reload?.(); }}>重新加载</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {!activeToolPanelTab.loadedUrl && !toolPanelTabs.some((tab) => tab.kind === "browser" && tab.id === activeToolPanelTabId) && (
                  <div className="browser-empty-state">
                    <Globe size={46} />
                    <strong>开始浏览</strong>
                    <span>输入 URL 以打开页面</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {!menuPageShown && activeToolPanelKind === "preview" && activeToolPanelTab?.filePath && (
            <FilePreviewPanel key={`${activeId}:${activeToolPanelTab.id}:${activeToolPanelTab.previewRevision || 0}`} path={activeToolPanelTab.filePath} workspacePath={activeToolPanelTab.previewWorkspacePath || workspacePath} onChooseFile={() => void choosePreviewFile()} onPathChange={path => setToolPanelTabs(current => current.map(tab => tab.id === activeToolPanelTab.id ? { ...tab, filePath: path, title: path.split(/[\\/]/).pop() || "文件预览" } : tab))} />
          )}

          {!menuPageShown && activeToolPanelKind === "files" && (
            <section className="tool-file-browser file-split-panel">
              <FilesSplitPanel
                onPreviewFile={(path) => openFilePreview(path, workspacePath)}
                onChoosePreviewFile={() => void choosePreviewFile()}
                workspacePath={workspacePath}
                workspaceEntries={workspaceEntries}
                workspaceOpen={workspaceOpen}
                onRefresh={() => void refreshWorkspace()}
                onError={setError}
                onInsertFile={insertFileToken}
              />
            </section>
          )}

          {!menuPageShown && activeToolPanelKind === "chat" && (
            <SideChatPanel settings={settings} session={activeSession} seed={sideChatSeed} />
          )}

          {!menuPageShown && activeToolPanelKind === "tasks" && (
            <section className="tool-panel-tasks">
              <BackgroundTasksPanel
                sessionId={activeSession?.id}
                workspacePath={activeSession?.workspacePath || workspacePath}
                onOpenUrl={(url) => {
                  setRightPanelOpen(true);
                  openToolPanelTab("browser", false, url);
                  if (window.dyworker?.openBrowser) {
                    void window.dyworker.openBrowser({ url, workspacePath: activeSession?.workspacePath || workspacePath });
                  }
                }}
                onNotice={setNotice}
                onError={setError}
              />
            </section>
          )}

          {!menuPageShown && activeToolPanelKind === "review" && (
            <section className="review-panel">
              {(activeSession?.workspacePath || workspacePath) ? (
                <GitReviewPanel
                  workspacePath={activeSession?.workspacePath || workspacePath}
                  fallbackChanges={reviewFocusChanges || reviewChanges}
                />
              ) : (reviewFocusChanges || reviewChanges).length ? (
                <ReviewPanel
                  key={`${(reviewFocusChanges || reviewChanges).length}-${(reviewFocusChanges || reviewChanges)[0].path}`}
                  changes={reviewFocusChanges || reviewChanges}
                  workspacePath=""
                />
              ) : (
                <div className="browser-empty-state">
                  <FileDiff size={46} />
                  <strong>审阅改动</strong>
                  <span>选择工作文件夹后，在这里按 Git 基线逐文件审阅改动</span>
                </div>
              )}
            </section>
          )}
        </div>
      </aside>
  );
}
