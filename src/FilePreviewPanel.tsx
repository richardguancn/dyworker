import { useEffect, useState } from "react";
import { FileText, FolderOpen, Minus, Plus, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FilePreviewResult } from "./types";

export function FilePreviewPanel({ path, workspacePath }: { path: string; workspacePath: string }) {
  const [result, setResult] = useState<FilePreviewResult | null>(null);
  const [resourceUrl, setResourceUrl] = useState("");
  const [revision, setRevision] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const [imageError, setImageError] = useState(false);
  const [actionError, setActionError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let url = "";
    setResult(null); setResourceUrl(""); setZoom(null); setImageError(false); setActionError("");
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
    <div className="file-preview-toolbar">
      <span className="file-preview-path" title={path}>{path.split(/[\\/]/).pop()}</span>
      <button className="icon-button subtle tiny" title="重新读取文件" aria-label="重新读取文件" onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} /></button>
      <button className="code-open-external" onClick={() => void openExternal()}>系统应用打开</button>
      <button className="icon-button subtle tiny" title="在文件夹中显示" aria-label="在文件夹中显示" onClick={() => void window.dyworker?.revealInFolder(path)}><FolderOpen size={15} /></button>
    </div>
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
        {result.kind === "markdown" && <div className="file-preview-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span>{alt ? `[图片：${alt}]` : "[图片]"}</span> }}>{result.content || "（空文件）"}</ReactMarkdown></div>}
        {result.kind === "text" && <pre className="file-preview-text">{result.content || "（空文件）"}</pre>}
        {result.kind === "unsupported" && <div className="browser-empty-state"><FileText size={40} /><strong>此格式暂不支持预览</strong><button className="code-open-external" onClick={() => void openExternal()}>系统应用打开</button></div>}
      </>}
  </section>;
}
