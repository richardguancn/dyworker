// 会话内卡片：向用户提问的回答卡。原先内联在 App.tsx 的收件箱对话框文件里，
// 会话消息区与收件箱都要渲染它，因此独立成消息卡片模块。
import { MessageCircleQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { MarkdownSnippet } from "../../InteractiveMessage";
import type { QuestionRequest } from "../../types";

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
