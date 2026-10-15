import { ArrowUp, LoaderCircle, MessageSquarePlus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { InteractiveMessage } from "../../InteractiveMessage";
import type { ChatMessage, ProviderSettings, SessionRecord } from "../../types";

// ===== 侧边聊天：临时问答（不持久化，关闭应用后消失；对照 Codex 侧边聊天页） =====
// 当前会话作为工具数据随请求传给主进程（payload.session）：
// 模型在回答前可按需 search/read 这一个会话，而不是把会话正文注入上下文

export function SideChatPanel({ settings, session, seed }: { settings: ProviderSettings; session?: SessionRecord; seed?: { text: string; nonce: number } | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 会话内容里选中文字「侧边聊天」：seed 变化时把选中文本填进草稿并聚焦
  useEffect(() => {
    if (!seed) return;
    setDraft((current) => (current.trim() ? `${current}\n${seed.text}` : seed.text));
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [seed]);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, sending]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text, createdAt: new Date().toISOString() }];
    setMessages(next);
    setDraft("");
    setSending(true);
    try {
      if (!window.dyworker?.completeChat) {
        setMessages([...next, { role: "assistant", content: "当前预览环境没有连接模型，这里只是界面演示。", createdAt: new Date().toISOString() }]);
        return;
      }
      // 当前会话随请求传给主进程：模型用它按需检索（search/read_current_session），不进气泡
      const result = await window.dyworker.completeChat({ settings, messages: next, session });
      setMessages([...next, { role: "assistant", content: result.content || "（空回复）", createdAt: new Date().toISOString() }]);
    } catch (sendError) {
      setMessages([...next, { role: "assistant", content: `发送失败：${sendError instanceof Error ? sendError.message : String(sendError)}`, createdAt: new Date().toISOString() }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="side-chat-panel">
      <div className="side-chat-messages" ref={listRef}>
        {!messages.length ? (
          <div className="browser-empty-state side-chat-empty">
            <MessageSquarePlus size={46} />
            <strong>侧边聊天</strong>
            <span>临时聊天，关闭应用后会消失{session?.messages.length ? "；就当前会话提问时会按需检索会话内容。" : "。"}</span>
          </div>
        ) : (
          messages.map((message, index) => (
            <div className={`side-chat-message ${message.role}`} key={index}>
              {message.role === "user" ? (
                <span className="side-chat-bubble">{message.content}</span>
              ) : (
                <InteractiveMessage content={message.content} />
              )}
            </div>
          ))
        )}
        {sending && (
          <div className="side-chat-message assistant">
            <LoaderCircle className="spin" size={15} />
          </div>
        )}
      </div>
      <div className="side-chat-composer">
        <textarea
          ref={textareaRef}
          placeholder="随心输入"
          aria-label="侧边聊天输入"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="side-chat-composer-bar">
          <button className="icon-button subtle" disabled title="附件暂未支持" aria-label="添加附件（暂未支持）">
            <Plus size={16} />
          </button>
          <span className="side-chat-model" title={settings.model ? `当前模型：${settings.model}` : "还没有配置模型"}>
            {settings.model || "未配置模型"}
          </span>
          <button
            className="side-chat-send"
            onClick={() => void send()}
            disabled={!draft.trim() || sending}
            aria-label="发送"
            title="发送"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
