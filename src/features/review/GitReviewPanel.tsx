import { ArrowUp, Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, FileDiff, GitCommitHorizontal, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buildReviewTree } from "../../lib/files";
import type { FileChange, GitReviewOverview } from "../../types";
import { ReviewDirNode, ReviewFileDiffSection, ReviewFileRow, ReviewPanel } from "./ReviewPanels";

// Git 仓库走基线对比视图；非 Git 仓库回退到“上一轮改动”审阅
export function GitReviewPanel({ workspacePath, fallbackChanges }: { workspacePath: string; fallbackChanges: FileChange[] }) {
  const [overview, setOverview] = useState<GitReviewOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [base, setBase] = useState("HEAD");
  const [baseMenuOpen, setBaseMenuOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const [filter, setFilter] = useState("");
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const diffPaneRef = useRef<HTMLDivElement | null>(null);

  const load = async (targetBase: string) => {
    if (!window.dyworker?.gitReviewOverview) {
      // 预览环境没有桌面桥接：按非 Git 仓库处理，回退到上一轮改动审阅
      setOverview({ isRepo: false, current: "", upstream: "", base: "", files: [], totals: { added: 0, removed: 0 } });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await window.dyworker.gitReviewOverview({ workspacePath, base: targetBase });
      setOverview(result);
      setErrorText("");
    } catch {
      // 不把底层 IPC 错误原文抛给用户，友好提示并可重试
      setErrorText("读取 Git 状态失败，请点击右上角刷新重试");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setOverview(null);
    setBase("HEAD");
    setFilter("");
    setSelectedPath("");
    setCollapsedPaths(new Set());
    setActionError("");
    setCommitOpen(false);
    setCommitMessage("");
    void load("HEAD");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  // 工作台 Git 写操作：暂存 / 放弃（破坏性，先人工确认）/ 提交 / 推送（破坏性，先人工确认）
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [gitBusy, setGitBusy] = useState("");
  const [actionError, setActionError] = useState("");

  const runGitAction = async (kind: "stage" | "discard", path: string) => {
    if (gitBusy) return;
    if (kind === "discard" && !window.confirm(`放弃「${path}」的全部改动？已跟踪文件将恢复到最近提交，未跟踪文件将被删除。此操作不可恢复。`)) return;
    setGitBusy(`${kind}:${path}`);
    setActionError("");
    try {
      if (!window.dyworker?.gitStage || !window.dyworker?.gitDiscard) {
        setActionError("当前环境没有连接 Git 通道");
        return;
      }
      const result = kind === "stage"
        ? await window.dyworker.gitStage(workspacePath, [path])
        : await window.dyworker.gitDiscard(workspacePath, [path]);
      if (!result.ok) setActionError(result.error || (kind === "stage" ? "暂存失败" : "放弃失败"));
      else void load(base);
    } catch {
      setActionError(kind === "stage" ? "暂存失败" : "放弃失败");
    } finally {
      setGitBusy("");
    }
  };

  // AI 生成提交信息（独立按钮触发，写入输入框供用户确认或修改）
  const generateCommitMessage = async () => {
    if (gitBusy) return;
    setGitBusy("generate");
    setActionError("");
    try {
      if (!window.dyworker?.gitSuggestCommitMessage) {
        setActionError("当前环境没有连接 Git 通道");
        return;
      }
      const result = await window.dyworker.gitSuggestCommitMessage(workspacePath);
      if (!result.ok || !result.message) setActionError(result.error || "生成提交信息失败");
      else setCommitMessage(result.message);
    } catch {
      setActionError("生成提交信息失败");
    } finally {
      setGitBusy("");
    }
  };

  const commitAll = async () => {
    if (gitBusy) return;
    setGitBusy("commit");
    setActionError("");
    try {
      if (!window.dyworker?.gitCommit) {
        setActionError("当前环境没有连接 Git 通道");
        return;
      }
      const result = await window.dyworker.gitCommit({ workspacePath, message: commitMessage.trim(), includeUnstaged: true });
      if (!result.ok) setActionError(result.error || "提交失败");
      else {
        setCommitMessage("");
        setCommitOpen(false);
        void load(base);
      }
    } catch {
      setActionError("提交失败");
    } finally {
      setGitBusy("");
    }
  };

  const pushAll = async () => {
    if (gitBusy) return;
    if (!window.confirm("推送到远程仓库？所有未推送的提交将上传到远端，请确认内容无误。")) return;
    setGitBusy("push");
    setActionError("");
    try {
      if (!window.dyworker?.gitPush) {
        setActionError("当前环境没有连接 Git 通道");
        return;
      }
      const result = await window.dyworker.gitPush(workspacePath);
      if (!result.ok) setActionError(result.error || "推送失败");
      else void load(base);
    } catch {
      setActionError("推送失败");
    } finally {
      setGitBusy("");
    }
  };

  // 点击右侧文件树：左栏滚动到对应文件的 diff 区块（对照 Codex）
  const scrollToFile = (path: string) => {
    setSelectedPath(path);
    diffPaneRef.current
      ?.querySelector(`[data-review-path="${CSS.escape(path)}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  if (!loading && overview && !overview.isRepo) {
    return fallbackChanges.length ? (
      <ReviewPanel changes={fallbackChanges} workspacePath={workspacePath} />
    ) : (
      <div className="browser-empty-state">
        <FileDiff size={46} />
        <strong>审阅改动</strong>
        <span>当前工作区不是 Git 仓库；助手修改文件后，可在这里审阅上一轮改动</span>
      </div>
    );
  }

  const filteredFiles = (overview?.files || []).filter((file) => !filter.trim() || file.path.toLowerCase().includes(filter.trim().toLowerCase()));
  const tree = buildReviewTree(filteredFiles);
  const totals = overview?.totals || { added: 0, removed: 0 };

  // 折叠/展开全部差异（对照 Codex 审阅头部工具按钮）
  const allCollapsed = filteredFiles.length > 0 && filteredFiles.every((file) => collapsedPaths.has(file.path));
  const toggleCollapseAll = () => {
    setCollapsedPaths(allCollapsed ? new Set() : new Set(filteredFiles.map((file) => file.path)));
  };
  const toggleCollapse = (path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="review-panel-body git-review">
      <div className="review-header">
        <div className="review-base-row" data-menu-root>
          <button
            className={`review-base-select ${baseMenuOpen ? "active" : ""}`}
            onClick={() => setBaseMenuOpen((value) => !value)}
            aria-expanded={baseMenuOpen}
            title="选择对比基线"
          >
            <span>{base === "HEAD" ? "HEAD（未提交改动）" : base}</span>
            <ChevronDown size={13} />
          </button>
          {baseMenuOpen && (
            <div className="session-menu review-base-menu" role="menu">
              <button role="menuitemradio" aria-checked={base === "HEAD"} onClick={() => { setBase("HEAD"); setBaseMenuOpen(false); void load("HEAD"); }}>
                <span>HEAD（未提交改动）</span>
                {base === "HEAD" && <Check size={14} />}
              </button>
              {overview?.upstream && (
                <button role="menuitemradio" aria-checked={base === overview.upstream} onClick={() => { setBase(overview.upstream); setBaseMenuOpen(false); void load(overview.upstream); }}>
                  <span>{overview.upstream}（含未推送提交）</span>
                  {base === overview.upstream && <Check size={14} />}
                </button>
              )}
            </div>
          )}
        </div>
        <span className="review-totals"><b>+{totals.added.toLocaleString()}</b> <em>-{totals.removed.toLocaleString()}</em></span>
        <span className="review-header-spacer" />
        <button
          className="icon-button subtle tiny"
          onClick={toggleCollapseAll}
          aria-label={allCollapsed ? "展开全部差异" : "折叠全部差异"}
          title={allCollapsed ? "展开全部差异" : "折叠全部差异"}
        >
          {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
        </button>
        <button className="icon-button subtle tiny" onClick={() => void load(base)} aria-label="刷新改动列表" title="刷新改动列表">
          <RefreshCw size={13} />
        </button>
        <button className="code-open-external review-commit-toggle" onClick={() => setCommitOpen((value) => !value)} disabled={Boolean(gitBusy)} title="提交改动（提交信息留空时按文件自动生成）">
          <GitCommitHorizontal size={13} />
          提交
        </button>
        <button className="code-open-external review-push-toggle" onClick={() => void pushAll()} disabled={Boolean(gitBusy)} title="推送到远程仓库">
          <ArrowUp size={13} />
          推送
        </button>
      </div>
      {commitOpen && (
        <div className="review-commit-box">
          <input
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void commitAll(); }}
            placeholder="提交信息（留空按文件名自动生成）"
            aria-label="提交信息"
          />
          <button className="button-secondary review-commit-go" onClick={() => void generateCommitMessage()} disabled={Boolean(gitBusy)} title="用当前模型按改动生成提交信息">
            <Sparkles size={13} />
            {gitBusy === "generate" ? "生成中…" : "AI 生成"}
          </button>
          <button className="button-secondary review-commit-go" onClick={() => void commitAll()} disabled={gitBusy === "commit"} title="Ctrl/Cmd+Enter 提交">
            {gitBusy === "commit" ? "提交中…" : "提交"}
          </button>
        </div>
      )}
      {actionError && <p className="panel-empty error-text">{actionError}</p>}
      {errorText && <p className="panel-empty error-text">{errorText}</p>}
      {loading && !overview ? (
        <p className="panel-empty">正在读取 Git 改动…</p>
      ) : overview && !overview.files.length ? (
        <div className="browser-empty-state">
          <FileDiff size={46} />
          <strong>没有待审阅的改动</strong>
          <span>{base === "HEAD" ? "工作区是干净的，助手修改文件后会出现在这里" : `与 ${base} 没有差异`}</span>
        </div>
      ) : (
        <div className="review-split">
          <div className="review-diff-pane" ref={diffPaneRef}>
            {filteredFiles.map((file) => (
              <ReviewFileDiffSection
                key={`${overview?.base}-${file.path}`}
                workspacePath={workspacePath}
                base={overview?.base || "HEAD"}
                file={file}
                active={file.path === selectedPath}
                collapsed={collapsedPaths.has(file.path)}
                onToggleCollapse={toggleCollapse}
                onStage={(path) => void runGitAction("stage", path)}
                onDiscard={(path) => void runGitAction("discard", path)}
                busy={Boolean(gitBusy)}
              />
            ))}
          </div>
          <div className="review-files-pane">
            <div className="tool-file-filter">
              <Search size={14} />
              <input
                placeholder="筛选文件…"
                aria-label="筛选改动文件"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              {filter.trim() && (
                <button className="icon-button subtle tiny" aria-label="清除筛选" title="清除筛选" onClick={() => setFilter("")}>
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="review-tree">
              {tree.dirs.map((dir) => <ReviewDirNode dir={dir} depth={0} key={dir.path} selectedPath={selectedPath} onSelect={scrollToFile} />)}
              {tree.files.map((file) => <ReviewFileRow file={file} depth={0} key={file.path} selected={file.path === selectedPath} onSelect={scrollToFile} />)}
              {!filteredFiles.length && <p className="panel-empty">没有匹配「{filter.trim()}」的文件。</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
