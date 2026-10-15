import { ChevronDown, ChevronRight, File, FileCode2, FolderOpen, RotateCcw, Square, SquarePen, SquarePlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { parseReviewDiff } from "../../lib/files";
import type { ReviewTreeDir } from "../../lib/files";
import type { FileChange, GitReviewFile } from "../../types";

export function ReviewDiffView({ diff }: { diff: string }) {
  const rows = useMemo(() => parseReviewDiff(diff), [diff]);
  if (!rows.length) return <p className="panel-empty">暂无可展示的修改内容。</p>;
  return (
    <div className="review-diff">
      {rows.map((row, index) => row.type === "gap" ? (
        <div className="review-diff-gap" key={index}>{row.count} unmodified lines</div>
      ) : (
        <div className={`review-diff-row ${row.type}`} key={index}>
          <span className="review-diff-no">{row.type !== "add" ? row.oldNo : ""}</span>
          <span className="review-diff-no">{row.type !== "del" ? row.newNo : ""}</span>
          <code className="review-diff-text">{row.text}</code>
        </div>
      ))}
    </div>
  );
}

// Codex 风格的审阅面板:上一轮改动汇总 + 文件列表 + 选中文件的内联 diff
export function ReviewPanel({ changes, workspacePath }: { changes: FileChange[]; workspacePath: string }) {
  const [selectedPath, setSelectedPath] = useState(changes[0]?.path || "");
  const totals = changes.reduce(
    (accumulator, change) => ({ added: accumulator.added + change.added, removed: accumulator.removed + change.removed }),
    { added: 0, removed: 0 },
  );
  const selected = changes.find((change) => change.path === selectedPath) || changes[0];
  const openExternal = (change: FileChange) => {
    if (!workspacePath) return;
    void window.dyworker?.openPath(`${workspacePath.replace(/[\\/]+$/, "")}/${change.path}`);
  };
  return (
    <div className="review-panel-body">
      <div className="review-header">
        <span className="review-round">上一轮</span>
        <span className="review-totals"><b>+{totals.added}</b> <em>-{totals.removed}</em></span>
      </div>
      <div className="review-file-list">
        {changes.map((change) => (
          <div className={`review-file-row ${selected && change.path === selected.path ? "active" : ""}`} key={change.path}>
            <button className="review-file-main" onClick={() => setSelectedPath(change.path)} title={change.path}>
              <FileCode2 size={15} />
              <span className="review-file-path">{change.path}</span>
              <span className="tool-summary-side"><b>+{change.added}</b> <em>-{change.removed}</em></span>
            </button>
            <button
              className="icon-button subtle tiny"
              onClick={() => openExternal(change)}
              disabled={!workspacePath}
              aria-label={`打开 ${change.path}`}
              title="打开文件"
            >
              <FolderOpen size={13} />
            </button>
          </div>
        ))}
      </div>
      {selected && (selected.diff
        ? <ReviewDiffView diff={selected.diff} />
        : <p className="panel-empty">文件较大,仅显示变更统计。</p>)}
    </div>
  );
}

// ===== Codex 风格审阅视图:Git 工作区改动 vs 基线,左 diff 右文件树 =====

export const reviewStatusLabels: Record<GitReviewFile["status"], string> = { M: "已修改", A: "新增", D: "已删除", U: "未跟踪" };

// 文件类型图标：按扩展名给彩色小方块（对照 Codex 审阅页的 JS/TS/{ } 图标）
export const FILE_TYPE_STYLES: [RegExp, string, string][] = [
  [/\.tsx?$/i, "TS", "#3178c6"],
  [/\.jsx?$/i, "JS", "#c9a227"],
  [/\.mjs$/i, "JS", "#c9a227"],
  [/\.cjs$/i, "JS", "#c9a227"],
  [/\.jsonc?$/i, "{}", "#c9842d"],
  [/\.s?css$/i, "CSS", "#7c5cd6"],
  [/\.less$/i, "CSS", "#7c5cd6"],
  [/\.html?$/i, "<>", "#d1543a"],
  [/\.mdx?$/i, "MD", "#5f8a4b"],
  [/\.py$/i, "PY", "#3572a5"],
  [/\.go$/i, "GO", "#00add8"],
  [/\.rs$/i, "RS", "#b7410e"],
  [/\.java$/i, "JV", "#b07219"],
  [/\.ya?ml$/i, "YML", "#6d8086"],
  [/\.toml$/i, "TOML", "#6d8086"],
  [/\.sh$/i, "SH", "#4eaa25"],
  [/\.svg$/i, "SVG", "#d0881c"],
  [/\.png$/i, "IMG", "#8a6d3b"],
  [/\.jpe?g$/i, "IMG", "#8a6d3b"],
  [/\.gif$/i, "IMG", "#8a6d3b"],
];

export function FileTypeIcon({ path, size = 15 }: { path: string; size?: number }) {
  const match = FILE_TYPE_STYLES.find(([pattern]) => pattern.test(path));
  if (!match) return <File size={size} className="file-type-icon-fallback" />;
  const [, label, color] = match;
  return (
    <span className="file-type-icon" style={{ color, width: size + 3, height: size + 1, fontSize: Math.max(7, size - 7) }} aria-hidden="true">
      {label}
    </span>
  );
}

// 状态徽标（对照 Codex：新增绿色 ⊕、修改橙点、删除红色 −）
export function ReviewStatusIcon({ status }: { status: GitReviewFile["status"] }) {
  const className = `review-status-icon status-${status.toLowerCase()}`;
  if (status === "A" || status === "U") return <SquarePlus size={15} className={className} />;
  if (status === "D") return <Square size={15} className={className} />;
  return <SquarePen size={15} className={className} />;
}

export function ReviewFileRow({ file, depth, selected, onSelect }: { file: GitReviewFile; depth: number; selected: boolean; onSelect: (path: string) => void }) {
  const name = file.path.split("/").pop() || file.path;
  return (
    <button
      className={`review-tree-row file ${selected ? "active" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onSelect(file.path)}
      title={`${file.path}（${reviewStatusLabels[file.status]}）`}
    >
      <FileTypeIcon path={file.path} size={14} />
      <span className="review-tree-name">{name}</span>
      <ReviewStatusIcon status={file.status} />
    </button>
  );
}

export function ReviewDirNode({ dir, depth, selectedPath, onSelect }: { dir: ReviewTreeDir; depth: number; selectedPath: string; onSelect: (path: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="review-tree-dir">
      <button className="review-tree-row dir" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="review-tree-name">{dir.name}</span>
      </button>
      {expanded && (
        <>
          {dir.dirs.map((child) => <ReviewDirNode dir={child} depth={depth + 1} key={child.path} selectedPath={selectedPath} onSelect={onSelect} />)}
          {dir.files.map((file) => <ReviewFileRow file={file} depth={depth + 1} key={file.path} selected={file.path === selectedPath} onSelect={onSelect} />)}
        </>
      )}
    </div>
  );
}

// 单个文件的 diff 区块（堆叠在左栏；对照 Codex：所有文件的 diff 上下排列滚动浏览，可单独折叠）
export function ReviewFileDiffSection({ workspacePath, base, file, active, collapsed, onToggleCollapse, onStage, onDiscard, busy }: {
  workspacePath: string;
  base: string;
  file: GitReviewFile;
  active: boolean;
  collapsed: boolean;
  onToggleCollapse: (path: string) => void;
  onStage?: (path: string) => void;
  onDiscard?: (path: string) => void;
  busy?: boolean;
}) {
  const [diff, setDiff] = useState<{ text: string; binary?: boolean; truncated?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (collapsed) return; // 折叠时不加载，展开后再拉取
    if (!window.dyworker?.gitFileDiff) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void window.dyworker.gitFileDiff({ workspacePath, base, path: file.path, untracked: file.status === "U" })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setDiff({ text: result.diff || "", binary: result.binary, truncated: result.truncated });
        else setDiff(null);
      })
      .catch(() => { if (!cancelled) setDiff(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspacePath, base, file.path, file.status, collapsed]);

  return (
    <section className={`review-file-section ${active ? "active" : ""} ${collapsed ? "collapsed" : ""}`} data-review-path={file.path}>
      <div className="review-diff-filebar-wrap">
        <button
          className="review-diff-filebar"
          title={`${file.path}（${collapsed ? "展开差异" : "折叠差异"}）`}
          aria-expanded={!collapsed}
          onClick={() => onToggleCollapse(file.path)}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <FileTypeIcon path={file.path} />
          <span className="review-diff-filepath">{file.path}</span>
          <span className="tool-summary-side"><b>+{file.added}</b> <em>-{file.removed}</em></span>
        </button>
        {(onStage || onDiscard) && (
          <div className="review-file-actions">
            {onStage && (
              <button
                type="button"
                className="icon-button subtle tiny"
                title={`暂存 ${file.path}`}
                aria-label={`暂存 ${file.path}`}
                disabled={busy}
                onClick={() => onStage(file.path)}
              >
                <SquarePlus size={13} />
              </button>
            )}
            {onDiscard && (
              <button
                type="button"
                className="icon-button subtle tiny"
                title={`放弃 ${file.path} 的全部改动`}
                aria-label={`放弃 ${file.path} 的改动`}
                disabled={busy}
                onClick={() => onDiscard(file.path)}
              >
                <RotateCcw size={13} />
              </button>
            )}
          </div>
        )}
      </div>
      {!collapsed && (loading ? (
        <p className="panel-empty">正在生成对比…</p>
      ) : diff?.binary ? (
        <p className="panel-empty">二进制文件无法展示对比。</p>
      ) : diff && diff.text ? (
        <>
          <ReviewDiffView diff={diff.text} />
          {diff.truncated && <p className="panel-empty">对比内容过大，仅显示前 400 KB。</p>}
        </>
      ) : (
        <p className="panel-empty">暂无可展示的修改内容。</p>
      ))}
    </section>
  );
}
