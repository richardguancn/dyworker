import { useEffect, useRef } from "react";
import { Terminal, Trash2, X } from "lucide-react";
import { formatLogTime } from "../lib/format";
import type { DebugLogEntry } from "../types";

// 控制台：展示模型请求/响应与工具调用的内部细节，便于理解 agent 的执行逻辑
const debugKindLabels: Record<DebugLogEntry["kind"], string> = {
  "model-request": "模型请求",
  "model-response": "模型响应",
  "tool-call": "工具调用",
  "tool-result": "工具结果",
};

export function DebugConsole({ logs, onClear, onClose }: { logs: DebugLogEntry[]; onClear: () => void; onClose: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [logs.length]);
  return (
    <div className="debug-console">
      <div className="debug-console-header">
        <Terminal size={14} />
        <strong>控制台</strong>
        <span className="debug-console-count">{logs.length} 条</span>
        <span className="debug-console-spacer" />
        <button className="icon-button subtle tiny" aria-label="清空控制台" onClick={onClear}><Trash2 size={13} /></button>
        <button className="icon-button subtle tiny" aria-label="关闭控制台" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="debug-console-body" ref={bodyRef}>
        {logs.length === 0 ? (
          <div className="debug-console-empty">暂无日志。发起任务后，这里会显示每一轮模型请求的消息内容、响应（SSE 流式或 JSON）以及每次工具调用的参数与结果。</div>
        ) : logs.map((entry) => (
          <details className={`debug-entry debug-${entry.kind}`} key={entry.id}>
            <summary>
              <span className="debug-entry-kind">{debugKindLabels[entry.kind]}</span>
              <span className="debug-entry-time">{formatLogTime(entry.time)}</span>
              <span className="debug-entry-title">{entry.title}</span>
            </summary>
            <pre>{entry.content}</pre>
          </details>
        ))}
      </div>
    </div>
  );
}
