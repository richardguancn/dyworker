// 会话内卡片：向用户提问的回答卡。原先内联在 App.tsx 的收件箱对话框文件里，
// 会话消息区与收件箱都要渲染它，因此独立成消息卡片模块。
import { ArrowUpRight, ChevronDown, ChevronRight, ChevronUp, FileCode2, FolderOpen, MessageCircleQuestion, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { MarkdownSnippet } from "../../InteractiveMessage";
import type { ApprovalAction, FileChange, QuestionRequest } from "../../types";

export function QuestionCard({ request, onResolve }: { request: QuestionRequest; onResolve: (answer: string) => void }) {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { setText(''); setSelected([]); }, [request.id]);
  const submit = (answer: string) => {
    const trimmed = answer.trim();
    if (request.answerFormat === 'dsh') {
      if (!trimmed && !selected.length) return;
      onResolve(JSON.stringify({ format: 'dsh-question-answer-v1', selected: request.multiSelect ? selected : [],
        ...(trimmed ? { custom: trimmed } : {}) }));
    } else if (trimmed) onResolve(trimmed);
  };
  return (
    <div className="approval-card question-card">
      <div className="approval-card-header">
        <MessageCircleQuestion size={15} />
        <strong>{request.header || '助手向你提问'}</strong>
      </div>
      <p className="question-text">{request.question}</p>
      {request.detail && <div className="question-text"><MarkdownSnippet content={request.detail} /></div>}
      {request.multiSelect && <p className="question-text">可以选择多项，再点击“提交回答”。</p>}
      {request.options.length > 0 && (
        <div className="question-options">
          {request.options.map((option, index) => (
            <div key={option}>
              <button className="button-secondary" aria-pressed={request.multiSelect ? selected.includes(option) : undefined}
                onClick={() => {
                  if (request.multiSelect) setSelected(current => current.includes(option) ? current.filter(item => item !== option) : [...current, option]);
                  else if (request.answerFormat === 'dsh') onResolve(JSON.stringify({ format: 'dsh-question-answer-v1', selected: [option] }));
                  else submit(option);
                }}>{option}</button>
              {request.optionDescriptions?.[index] && <small className="question-option-description">{request.optionDescriptions[index]}</small>}
            </div>
          ))}
        </div>
      )}
      <form
        className="question-input-row"
        onSubmit={(event) => {
          event.preventDefault();
          submit(text);
        }}
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="输入你的回答…"
          autoFocus={!request.options.length}
        />
        <button type="submit" className="button-primary" disabled={!text.trim() && !selected.length}>提交回答</button>
      </form>
    </div>
  );
}

// Codex 风格的文件变更摘要卡片：数据来自 agent 的 file-change 事件（真实 +N/-M 统计，可展开 unified diff）
function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="diff-view">
      {diff.split("\n").map((line, index) => (
        <span
          key={index}
          className={
            line.startsWith("+++") || line.startsWith("---")
              ? "diff-file"
              : line.startsWith("+")
                ? "diff-add"
                : line.startsWith("-")
                  ? "diff-del"
                  : line.startsWith("@@")
                    ? "diff-hunk"
                    : ""
          }
        >
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

export function ChangesSummary({ changes, workspacePath, onOpenReview }: { changes: FileChange[]; workspacePath: string; onOpenReview?: (changes: FileChange[]) => void }) {
  // 默认展开显示前 3 个修改文件，超过 3 个时出「再显示 xx 个文件」（对照 Codex）
  const [showAll, setShowAll] = useState(false);
  const [diffPath, setDiffPath] = useState("");
  const totals = changes.reduce(
    (accumulator, change) => ({ added: accumulator.added + change.added, removed: accumulator.removed + change.removed }),
    { added: 0, removed: 0 },
  );
  const openFile = (change: FileChange) => {
    if (!window.dyworker || !workspacePath) return;
    void window.dyworker.openPath(`${workspacePath.replace(/[\\/]+$/, "")}/${change.path}`);
  };
  const visibleChanges = showAll ? changes : changes.slice(0, 3);
  const hiddenCount = changes.length - visibleChanges.length;
  return (
    <div className="tool-summary">
      <div className="tool-summary-header changes-card">
        <FileCode2 size={16} />
        <span className="changes-card-text">
          <strong>已修改 {changes.length} 个文件</strong>
          {onOpenReview && (
            <button className="changes-review-link" onClick={() => onOpenReview(changes)}>
              查看更改 <ArrowUpRight size={12} />
            </button>
          )}
        </span>
        <span className="tool-summary-side changes-card-totals">
          <b>+{totals.added}</b> <em>-{totals.removed}</em>
        </span>
      </div>
      {visibleChanges.map((change) => (
        <div className="tool-file-block" key={change.path}>
          <div className={`tool-file-row ${change.diff ? "clickable" : ""}`}>
            <button
              className="tool-file-main"
              onClick={() => change.diff && setDiffPath((current) => current === change.path ? "" : change.path)}
              disabled={!change.diff}
              aria-expanded={change.diff ? diffPath === change.path : undefined}
              title={change.diff ? "点击查看修改内容" : change.path}
            >
              <span>{change.path}</span>
              <span className="tool-summary-side">
                <b>+{change.added}</b> <em>-{change.removed}</em>
                {change.diff ? (diffPath === change.path ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
              </span>
            </button>
            <button
              className="icon-button subtle tiny"
              onClick={() => openFile(change)}
              disabled={!workspacePath}
              aria-label={`打开 ${change.path}`}
              title="打开文件"
            >
              <FolderOpen size={13} />
            </button>
          </div>
          {diffPath === change.path && change.diff && <DiffView diff={change.diff} />}
        </div>
      ))}
      {hiddenCount > 0 && (
        <button className="changes-more" onClick={() => setShowAll(true)}>
          再显示 {hiddenCount} 个文件 <ChevronDown size={13} />
        </button>
      )}
      {showAll && changes.length > 3 && (
        <button className="changes-more" onClick={() => setShowAll(false)}>
          收起文件列表 <ChevronUp size={13} />
        </button>
      )}
    </div>
  );
}

export function ApprovalCard({ action, onResolve }: { action: ApprovalAction; onResolve: (approved: boolean) => void }) {
  const [ruleError, setRuleError] = useState("");
  const allowAlways = async () => {
    if (!action.suggestedRule) return;
    const result = await window.dyworker?.addRule(action.suggestedRule);
    if (result && !result.ok) {
      setRuleError(result.error || "规则保存失败");
      return;
    }
    onResolve(true);
  };
  return (
    <div className="approval-card">
      <div className="approval-card-header">
        <ShieldAlert size={15} />
        <strong>操作需要确认</strong>
        <span>{action.title}</span>
      </div>
      {action.details && <pre className="approval-details">{action.details}</pre>}
      {action.impact && (
        <div className="approval-impact">
          <strong>操作影响</strong>
          <MarkdownSnippet content={action.impact} />
        </div>
      )}
      <div className="approval-actions">
        <button className="button-secondary" onClick={() => onResolve(false)}>拒绝</button>
        <button className="button-primary" onClick={() => onResolve(true)}>允许执行</button>
        {action.suggestedRule && (
          <button className="button-secondary" title={action.suggestedRule.label} onClick={() => void allowAlways()}>
            始终允许
          </button>
        )}
      </div>
      {action.suggestedRule && <p className="approval-rule-hint">{action.suggestedRule.label}</p>}
      {action.suggestedRule && !String(action.details || "").includes("工作区外路径") && (
        <p className="approval-rule-hint">允许后本次任务内同类操作自动放行；「始终允许」则长期生效。</p>
      )}
      {ruleError && <p className="approval-rule-hint error">{ruleError}</p>}
    </div>
  );
}

// 已发送消息里的折叠长粘贴块：默认收起（显示字数），点击展开查看原文
export function MessagePasteBlocks({ blocks }: { blocks: Array<{ id: string; text: string }> }) {
  const [expandedId, setExpandedId] = useState("");
  return (
    <div className="message-paste-blocks">
      {blocks.map((block, index) => {
        const expanded = expandedId === block.id;
        return (
          <div className="message-paste-block" key={block.id}>
            <button
              type="button"
              className="message-paste-toggle"
              onClick={() => setExpandedId(expanded ? "" : block.id)}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              长文本 {block.text.length} 字（第 {index + 1} 段）· {expanded ? "收起" : "点击查看"}
            </button>
            {expanded && <pre className="message-paste-content">{block.text}</pre>}
          </div>
        );
      })}
    </div>
  );
}
