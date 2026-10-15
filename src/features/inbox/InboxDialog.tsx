import { Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import { MarkdownSnippet } from "../../InteractiveMessage";
import { SystemMessagesPanel } from "../../SystemMessagesPanel";
import { QuestionCard } from "../message/Cards";
import type { InboxItem } from "../../types";

export function InboxDialog({ items, onClose, onResolve, onDismiss, initialTab = "inbox", focusMessageId = "", onFocusConsumed }: {
  items: InboxItem[];
  onClose: () => void;
  onResolve: (item: InboxItem, resolution: { approved?: boolean; answer?: string }) => void;
  onDismiss: (id: string) => void;
  initialTab?: "inbox" | "messages";
  focusMessageId?: string;
  onFocusConsumed?: () => void;
}) {
  const [tab, setTab] = useState<"inbox" | "messages">(initialTab);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const itemText = (item: InboxItem) => item.kind === "question" ? item.question || "" : item.title || "";
  // 完整列表：待处理全量、已处理按时间倒序全量；搜索同时匹配标题、详情与处理结果
  const queryText = query.trim().toLowerCase();
  const matches = (item: InboxItem) => {
    if (!queryText) return true;
    return [itemText(item), item.details, item.resolution, item.tool]
      .some((value) => String(value || "").toLowerCase().includes(queryText));
  };
  const pending = items.filter((item) => item.status === "pending" && matches(item));
  const settled = items
    .filter((item) => item.status !== "pending" && matches(item))
    .sort((a, b) => String(b.resolvedAt || b.createdAt).localeCompare(String(a.resolvedAt || a.createdAt)));
  const formatTime = (value?: string) => value
    ? new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  const resolve = async (item: InboxItem, resolution: { approved?: boolean; answer?: string }) => {
    const result = await window.dyworker?.resolveInbox({ id: item.id, ...resolution });
    if (result && !result.ok) setErrors((current) => ({ ...current, [item.id]: result.error || "处理失败" }));
    // 无论成败都刷新：事项若已在别处处理/失效，卡片会随之移入“最近已处理”，不留钉子户
    onResolve(item, resolution);
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="settings-dialog inbox-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <span className="dialog-kicker">收件箱</span>
            <h2>{tab === "messages" ? "系统消息" : "审批收件箱"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="inbox-toolbar">
          <div className="inbox-tabs" role="tablist" aria-label="收件箱分类">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "inbox"}
              className={`inbox-tab ${tab === "inbox" ? "active" : ""}`}
              onClick={() => setTab("inbox")}
            >任务待办</button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "messages"}
              className={`inbox-tab ${tab === "messages" ? "active" : ""}`}
              onClick={() => setTab("messages")}
            >系统消息</button>
          </div>
          {tab === "inbox" && (
          <div className="inbox-search">
            <Search size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、详情或处理结果"
              aria-label="搜索收件箱"
            />
            {query && (
              <button type="button" className="icon-button subtle tiny" onClick={() => setQuery("")} aria-label="清空搜索">
                <X size={12} />
              </button>
            )}
          </div>
          )}
        </div>
        <div className="inbox-dialog-body">
          {tab === "messages" ? (
            <SystemMessagesPanel focusMessageId={focusMessageId} onFocusConsumed={onFocusConsumed} />
          ) : (
          <>
          {!pending.length && (
            <p className="panel-empty">
              {queryText
                ? "没有匹配的待处理事项。"
                : "没有待处理的事项。无人值守的定时任务需要确认或向你提问时，会出现在这里。"}
            </p>
          )}
          {pending.map((item) => (
            <div className="inbox-item" key={item.id}>
              <div className="inbox-item-head">
                <span className={`inbox-kind ${item.kind}`}>{item.kind === "question" ? "提问" : "审批"}</span>
                <span className="inbox-title">{itemText(item)}</span>
              </div>
              <div className="inbox-item-meta">
                <span>请求时间：{formatTime(item.createdAt)}</span>
              </div>
              {item.details && <pre className="approval-details">{item.details}</pre>}
              {item.impact && (
                <div className="approval-impact">
                  <strong>操作影响</strong>
                  <MarkdownSnippet content={item.impact} />
                </div>
              )}
              {item.kind === 'question' && item.questionPresentation && <QuestionCard
                request={{ ...item.questionPresentation, id: item.id, question: item.question || '', options: item.options || [] }}
                onResolve={answer => void resolve(item, { answer })} />}
              {item.kind === "question" && !item.questionPresentation && item.options && item.options.length > 0 && (
                <div className="question-options">
                  {item.options.map((option) => (
                    <button key={option} className="button-secondary" onClick={() => void resolve(item, { answer: option })}>{option}</button>
                  ))}
                </div>
              )}
              {item.kind === "question" && !item.questionPresentation && (
                <div className="question-input-row">
                  <input
                    value={answers[item.id] || ""}
                    onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.value }))}
                    placeholder="输入你的回答…"
                  />
                  <button
                    className="button-primary"
                    disabled={!(answers[item.id] || "").trim()}
                    onClick={() => void resolve(item, { answer: answers[item.id] || "" })}
                  >提交回答</button>
                </div>
              )}
              {item.kind === "approval" && (
                <div className="approval-actions">
                  <button className="button-secondary" onClick={() => void resolve(item, { approved: false })}>拒绝</button>
                  <button className="button-primary" onClick={() => void resolve(item, { approved: true })}>允许执行</button>
                </div>
              )}
              {errors[item.id] && <p className="approval-rule-hint error">{errors[item.id]}</p>}
            </div>
          ))}
          {settled.length > 0 && (
            <>
              <div className="dialog-section-title">已处理（{settled.length}）</div>
              {settled.map((item) => (
                <div className="inbox-item settled" key={item.id}>
                  <div className="inbox-item-head">
                    <span className={`inbox-kind ${item.status === "expired" ? "expired" : item.kind}`}>
                      {item.status === "expired" ? "已失效" : item.kind === "question" ? "提问" : "审批"}
                    </span>
                    <span className="inbox-title">{itemText(item)}</span>
                    <button className="icon-button subtle tiny" onClick={() => onDismiss(item.id)} aria-label="移除这条记录">
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="inbox-item-meta">
                    <span>请求时间：{formatTime(item.createdAt)}</span>
                    {item.resolvedAt && <span>处理时间：{formatTime(item.resolvedAt)}</span>}
                  </div>
                  {item.resolution && <small className="inbox-resolution">{item.resolution}</small>}
                </div>
              ))}
            </>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
