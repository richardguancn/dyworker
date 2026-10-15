import { useEffect, useRef, useState } from "react";
import type { MarkdownLiveEditorHandle } from "../../markdownLiveEditor";

// Codex 式即时渲染编辑面板：整篇文档作为 markdown 源码交给 CodeMirror，
// 光标停在行首时该行显示原始源码，其余行隐藏语法标记按渲染样式展示，可直接编辑
export function MarkdownLiveEditorPane({
  path,
  name,
  value,
  plainSource,
  wrap,
  onChange,
  onSaveRequest,
}: {
  path: string;
  name: string;
  value: string;
  plainSource: boolean;
  wrap: boolean;
  onChange: (value: string) => void;
  onSaveRequest: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MarkdownLiveEditorHandle | null>(null);
  const [editorError, setEditorError] = useState("");
  const optionsRef = useRef({ value, plainSource, wrap });
  optionsRef.current = { value, plainSource, wrap };

  useEffect(() => {
    let disposed = false;
    let handle: MarkdownLiveEditorHandle | null = null;
    // 编辑器按需异步加载（CodeMirror 约几百 KB），首包不引入
    void import("../../markdownLiveEditor").then(({ createMarkdownLiveEditor }) => {
      if (disposed || !hostRef.current) return;
      handle = createMarkdownLiveEditor(hostRef.current, {
        value: optionsRef.current.value,
        plainSource: optionsRef.current.plainSource,
        wrap: optionsRef.current.wrap,
        placeholderText: "点击输入 Markdown…",
        onChange,
        onSaveRequest,
      });
      editorRef.current = handle;
    }).catch(error => { if (!disposed) setEditorError(`文档编辑器加载失败：${error instanceof Error ? error.message : String(error)}`); });
    return () => {
      disposed = true;
      handle?.destroy();
      editorRef.current = null;
    };
    // key={path} 已按文件重挂载；仅挂载时创建一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // 「查看源代码」切换：同一编辑器开关装饰渲染
  useEffect(() => {
    editorRef.current?.setPlainSource(plainSource);
  }, [plainSource]);

  useEffect(() => { editorRef.current?.setWrap(wrap); }, [wrap]);

  // 外部内容同步（草稿恢复、落盘后回读）；编辑中不回写
  useEffect(() => {
    editorRef.current?.setValue(value);
  }, [value]);

  return (
    <div
      className={`markdown-live-editor${plainSource ? " plain-source" : ""}`}
      ref={hostRef}
      aria-label={`编辑 ${name}`}
    >{editorError && <p role="alert" className="panel-empty error-text">{editorError}</p>}</div>
  );
}
