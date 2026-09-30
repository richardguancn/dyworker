import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import type { SystemMessage } from "./types";

// 运营消息中心面板（方案 §6）：与审批收件箱共用入口，以「任务待办 / 系统消息」切换。
// 消息来自主进程本地存储（独立于任务收件箱，不使用 createInboxItem 的审批承诺语义）；
// 打开消息才记已读，点击白名单链接才记已点击。正文按纯文本渲染，不执行任何 HTML。

const CATEGORY_LABELS: Record<string, string> = {
  announcement: "公告",
  version: "版本提醒",
  maintenance: "维护通知",
  marketing: "活动",
};

function formatTime(value?: string) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
}

function isExpired(message: SystemMessage) {
  if (!message.expires_at) return false;
  const expires = Date.parse(message.expires_at);
  return Number.isFinite(expires) && expires <= Date.now();
}

function kindClass(message: SystemMessage) {
  if (message.revoked) return "expired";
  if (isExpired(message)) return "expired";
  if (message.category === "version") return "version";
  if (message.category === "maintenance") return "maintenance";
  return "";
}

export function SystemMessagesPanel({ focusMessageId, onFocusConsumed }: {
  focusMessageId?: string;
  onFocusConsumed?: () => void;
}) {
  const [messages, setMessages] = useState<SystemMessage[] | null>(null);
  const [openId, setOpenId] = useState("");
  // 回调存 ref：避免父组件每次渲染传入新函数导致定位效果反复执行
  const focusConsumedRef = useRef(onFocusConsumed);
  focusConsumedRef.current = onFocusConsumed;

  const reload = useCallback(() => {
    void window.dyworker?.listSystemMessages?.().then((items) => {
      setMessages(Array.isArray(items) ? items : []);
    });
  }, []);

  useEffect(() => {
    reload();
    return window.dyworker?.onSystemMessagesChanged?.(() => reload());
  }, [reload]);

  useEffect(() => {
    if (!focusMessageId) return;
    setOpenId(focusMessageId);
    void window.dyworker?.markSystemMessageRead?.(focusMessageId);
    focusConsumedRef.current?.();
    reload();
  }, [focusMessageId, reload]);

  const openMessage = (message: SystemMessage) => {
    const next = openId === message.message_id ? "" : message.message_id;
    setOpenId(next);
    // 只有用户实际打开对应消息才记「已读」
    if (next) void window.dyworker?.markSystemMessageRead?.(message.message_id);
    setMessages((current) => (current || []).map((item) =>
      item.message_id === message.message_id && next && !item.read_at
        ? { ...item, read_at: new Date().toISOString() }
        : item,
    ));
  };

  const openLink = (message: SystemMessage) => {
    // 跳转仅允许 https 地址（主进程 openBrowserExternal 二次校验）
    if (!/^https:\/\//i.test(message.link)) return;
    void window.dyworker?.markSystemMessageClicked?.(message.message_id)
      .then(() => window.dyworker?.openBrowserExternal?.(message.link));
  };

  if (!messages) {
    return <p className="panel-empty">正在加载系统消息…</p>;
  }
  if (!messages.length) {
    return (
      <p className="panel-empty">
        没有系统消息。开启「使用统计与消息」设置中的运营消息订阅后，公告、版本提醒与维护通知会出现在这里；
        应用退出期间发布的消息会在下次打开后补收。
      </p>
    );
  }

  return (
    <div className="system-messages-list">
      {messages.map((message) => {
        const open = openId === message.message_id;
        const dimmed = message.revoked || isExpired(message);
        return (
          <div className={`inbox-item ${dimmed ? "settled" : ""}`} key={message.message_id}>
            <button
              type="button"
              className="system-message-head"
              onClick={() => openMessage(message)}
              aria-expanded={open}
            >
              {!message.read_at && !message.revoked && <span className="system-message-dot" aria-label="未读" />}
              <span className={`inbox-kind ${kindClass(message)}`}>
                {message.revoked ? "已撤回" : isExpired(message) ? "已过期" : CATEGORY_LABELS[message.category] || "通知"}
              </span>
              <span className="inbox-title">{message.title || "无标题"}</span>
              <small>{formatTime(message.published_at || message.received_at)}</small>
              <ChevronRight size={14} className={`system-message-chevron ${open ? "open" : ""}`} />
            </button>
            {open && (
              <div className="system-message-body">
                {message.revoked
                  ? <p className="system-message-note">这条消息已被发布方撤回，内容仅供参考。</p>
                  : (
                    <pre className="system-message-text">{message.body}</pre>
                  )}
                {message.link && !message.revoked && (
                  <button type="button" className="button-secondary system-message-link" onClick={() => openLink(message)}>
                    <ExternalLink size={13} /> 打开链接
                  </button>
                )}
                <div className="system-message-meta">
                  <span>接收时间：{formatTime(message.received_at)}</span>
                  {message.read_at && <span>已读：{formatTime(message.read_at)}</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
