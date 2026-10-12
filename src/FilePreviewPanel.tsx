import { useEffect, useState } from "react";
import { ChevronRight, FileText, Folder, Minus, Plus } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileBrowserToolbar } from "./FileBrowserToolbar";
import { FileTextEditor } from "./FileTextEditor";
import type { WorkspaceEntry, FilePreviewResult } from "./types";

export function FilePreviewPanel({ path: initialPath, workspacePath, onChooseFile, onPathChange }: { path: string; workspacePath: string; onChooseFile?: () => void; onPathChange?: (path: string) => void }) {
  const [path, setPath] = useState(initialPath);
  const [revision, setRevision] = useState(0);
  const [wrap, setWrap] = useState(true);
  const [showSource, setShowSource] = useState(false);
  const [treeVisible, setTreeVisible] = useState(true);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [treeError, setTreeError] = useState('');
  useEffect(() => { setPath(initialPath); }, [initialPath]);
  useEffect(() => {
    let cancelled = false;
    void window.dyworker?.refreshWorkspace(workspacePath).then(next => { if (!cancelled) { setEntries(next); setTreeError(''); } }).catch(() => { if (!cancelled) setTreeError('文件列表读取失败，请刷新重试'); });
    return () => { cancelled = true; };
  }, [workspacePath, revision]);
  const [result, setResult] = useState<FilePreviewResult | null>(null);
  const [resourceUrl, setResourceUrl] = useState("");
  const [zoom, setZoom] = useState<number | null>(null);
  const [imageError, setImageError] = useState(false);
  const [actionError, setActionError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let url = "";
    setResult(null); setResourceUrl(""); setZoom(null); setImageError(false); setActionError(""); setShowSource(false);
    void (async () => {
      try {
        if (!window.dyworker?.readFilePreview) throw new Error("当前环境无法读取本地文件");
        const next = await window.dyworker.readFilePreview(workspacePath, path);
        if (cancelled) return;
        if (next.ok && next.data && next.mime) {
          const bytes = Uint8Array.from(atob(next.data), (character) => character.charCodeAt(0));
          url = URL.createObjectURL(new Blob([bytes], { type: next.mime }));
          setResourceUrl(url);
        }
        setResult({ ...next, data: undefined });
      } catch (error) {
        if (!cancelled) setResult({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [path, workspacePath, revision]);

  const openExternal = async () => {
    try {
      const opened = await window.dyworker?.openPath(path);
      if (!opened?.ok) setActionError(opened?.error || "无法使用系统应用打开");
    } catch (error) { setActionError(String(error)); }
  };
  return <section className="file-preview-panel" aria-label="文件预览">
    <FileBrowserToolbar path={path} workspacePath={workspacePath} content={result?.content}
      textReady={Boolean(result?.ok && (result.kind === "text" || result.kind === "markdown"))}
      wrap={wrap} onToggleWrap={() => setWrap(value => !value)}
      treeVisible={treeVisible} onToggleTree={() => setTreeVisible(value => !value)} onChooseFile={onChooseFile}
      onToggleSource={result?.kind === "markdown" ? () => setShowSource(value => !value) : undefined} showSource={showSource}
      onRefresh={() => setRevision(value => value + 1)} />
    <div className={`file-preview-body ${treeVisible ? "" : "tree-hidden"}`}><div className="file-preview-content">
    {result?.ok && result.kind === "image" && <div className="file-preview-image-tools">
      <button aria-label="缩小图片" disabled={zoom === 0.25} onClick={() => setZoom(value => Math.max(0.25, (value ?? 1) - 0.25))}><Minus size={14} /></button>
      <button aria-label="按原始大小显示图片" onClick={() => setZoom(1)}>{zoom === null ? "原始大小" : `${Math.round(zoom * 100)}%`}</button>
      <button aria-label="放大图片" disabled={zoom === 4} onClick={() => setZoom(value => Math.min(4, (value ?? 1) + 0.25))}><Plus size={14} /></button>
      <button onClick={() => setZoom(null)}>适应窗口</button>
    </div>}
    {actionError && <p role="alert" className="panel-empty error-text">{actionError}</p>}
    {!result ? <p className="panel-empty" role="status">正在读取文件…</p> : !result.ok ?
      <div className="browser-empty-state"><FileText size={40} /><strong>无法预览文件</strong><span role="alert">{result.error}</span></div> : <>
        {result.note && <p className="file-preview-note">{result.note}</p>}
        {result.kind === "image" && (imageError ? <p role="alert" className="panel-empty">图片无法解码，请使用系统应用打开。</p> : <div className={`file-preview-image ${zoom === null ? "fit" : ""}`}>
          <img src={resourceUrl} alt={result.name || path} onError={() => setImageError(true)} style={zoom === null ? undefined : { zoom }} />
        </div>)}
        {result.kind === "pdf" && resourceUrl && <iframe className="file-preview-pdf" title={`PDF 预览：${result.name}`} src={resourceUrl} />}
        {result.kind === "markdown" && !showSource && <div className={`file-preview-markdown ${wrap ? "" : "no-wrap"}`}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span>{alt ? `[图片：${alt}]` : "[图片]"}</span> }}>{result.content || "（空文件）"}</ReactMarkdown></div>}
        {(result.kind === "text" || (result.kind === "markdown" && showSource)) && <FileTextEditor key={path} name={result.name || path} value={result.content || ""} wrap={wrap} readOnly />}
        {result.kind === "unsupported" && <div className="browser-empty-state"><FileText size={40} /><strong>此格式暂不支持预览</strong><button className="code-open-external" onClick={() => void openExternal()}>系统应用打开</button></div>}
      </>}
    </div>{treeVisible && <aside className="file-preview-tree" aria-label="文件树">
      <div className="tool-file-filter"><input placeholder="筛选文件…" aria-label="筛选文件" value={filter} onChange={event => setFilter(event.target.value)} /></div>
      {treeError && <p role="alert" className="panel-empty">{treeError}</p>}
      <PreviewTree entries={entries} filter={filter} selected={path} onSelect={next => { setPath(next); onPathChange?.(next); }} />
    </aside>}</div>
  </section>;
}

function PreviewTree({ entries, filter, selected, onSelect, depth = 0 }: { entries: WorkspaceEntry[]; filter: string; selected: string; onSelect: (path: string) => void; depth?: number }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const matches = (entry: WorkspaceEntry): boolean => !filter.trim() || entry.name.toLowerCase().includes(filter.trim().toLowerCase()) || Boolean(entry.children?.some(matches));
  const visible = entries.filter(matches);
  return <div className="workspace-tree">{visible.map(entry => <div key={entry.path}>
    <button className={`preview-tree-row ${selected === entry.path ? "selected" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} aria-expanded={entry.kind === "directory" ? expanded.has(entry.path) || Boolean(filter.trim()) : undefined} onClick={() => entry.kind === "file" ? onSelect(entry.path) : setExpanded(current => { const next = new Set(current); next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path); return next; })}>
      {entry.kind === "directory" ? <><ChevronRight size={14} className={expanded.has(entry.path) || filter.trim() ? "expanded" : ""} /><Folder size={16} /></> : <FileText size={16} />}<span>{entry.name}</span>
    </button>
    {entry.kind === "directory" && (expanded.has(entry.path) || filter.trim()) && <PreviewTree entries={entry.children || []} filter={filter} selected={selected} onSelect={onSelect} depth={depth + 1} />}
  </div>)}{!visible.length && depth === 0 && <p className="panel-empty">{filter.trim() ? "没有匹配的文件。" : "这个文件夹是空的。"}</p>}</div>;
}
