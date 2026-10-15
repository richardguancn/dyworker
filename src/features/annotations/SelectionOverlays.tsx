import { LoaderCircle, MessageSquare, MessageSquarePlus, MessagesSquare, Mic, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MessageAnnotation } from "../../types";

// 注释列表弹层宽度（与 .annotation-list-popup 的 width 保持一致），fixed 定位时用于水平钳制
const ANNOTATION_POPUP_WIDTH = 360;

// 在容器文本节点里定位引用文本的起点：把所有文本节点拼成一个归一化长串（记录每个字符
// 对应的原始节点与偏移），做多级匹配后映射回 DOM。拼接匹配让跨元素边界的引用（加粗/链接
// 把一段文字切成多个文本节点）也能命中。只返回 Range 用于量位置，不改动消息 DOM。
export function findQuoteRange(root: ParentNode | null, quote: string): Range | null {
  if (!root || !quote) return null;
  const needles = [quote, quote.slice(0, 24), quote.slice(0, 12), quote.slice(0, 6)]
    .filter((needle, index, all) => needle.length >= 6 && all.indexOf(needle) === index);
  // 前缀全部失配时（引用起点恰好落在元素边界上），退而找引用里最长的一段连续文字
  const anchor = quote.split(/[\s，。；：、（）()"“”'‘’「」]+/).sort((a, b) => b.length - a.length)[0] || "";
  if (anchor.length >= 6 && !needles.includes(anchor)) needles.push(anchor);
  if (!needles.length) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let normalized = "";
  const origin: Array<{ node: Text; offset: number }> = [];
  let pendingSpace = false;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const raw = node.data;
    for (let i = 0; i < raw.length; i++) {
      if (/\s/.test(raw[i])) {
        pendingSpace = normalized.length > 0;
        continue;
      }
      if (pendingSpace) {
        normalized += " ";
        origin.push({ node, offset: i });
        pendingSpace = false;
      }
      normalized += raw[i];
      origin.push({ node, offset: i });
    }
    node = walker.nextNode() as Text | null;
  }
  for (const needle of needles) {
    const hit = normalized.indexOf(needle);
    if (hit < 0) continue;
    const { node: hitNode, offset } = origin[hit];
    const range = document.createRange();
    range.setStart(hitNode, offset);
    range.setEnd(hitNode, Math.min(hitNode.length, offset + 1));
    return range;
  }
  return null;
}

// 气泡里的「x 条注释」chip：hover 显示只读注释列表。
// 弹层 portal 到 body：消息行有 content-visibility:auto（长会话虚拟化），其绘制裁剪会把
// 任何超出消息行边界的子元素（含 fixed 定位）裁掉，弹层只有移出消息行 DOM 才能完整显示。
export function MessageAnnotationChip({ annotations }: { annotations: MessageAnnotation[] }) {
  const chipRef = useRef<HTMLDivElement>(null);
  // 延迟关闭：mouseleave 后留宽限，鼠标斜向移入弹层时不闪关
  const closeTimerRef = useRef(0);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);

  const computePos = () => {
    const rect = chipRef.current?.getBoundingClientRect();
    if (!rect) return null;
    // chip 滚出视口时直接关掉，弹层不悬空
    if (rect.bottom < 0 || rect.top > window.innerHeight) return null;
    const left = Math.max(8, Math.min(rect.right - ANNOTATION_POPUP_WIDTH, window.innerWidth - ANNOTATION_POPUP_WIDTH - 8));
    // 下方空间不足时翻转到 chip 上方（bottom 锚定贴住 chip）
    return rect.bottom + 6 + 270 <= window.innerHeight
      ? { top: rect.bottom + 6, left }
      : { bottom: window.innerHeight - rect.top + 6, left };
  };
  const handleEnter = () => {
    window.clearTimeout(closeTimerRef.current);
    setPos(computePos());
  };
  const handleLeave = () => {
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setPos(null), 200);
  };
  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);
  // 弹层是 fixed 定位，不随会话内容滚动：滚动/缩放时跟随 chip 重定位
  useEffect(() => {
    if (!pos) return;
    const reposition = () => setPos(computePos());
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
    // computePos 只读 DOM 实时值，无需入依赖；仅在开关状态变化时挂监听
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(pos)]);

  return (
    <div
      ref={chipRef}
      className="message-annotation-chip"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <span className="message-annotation-chip-label">
        <MessageSquare size={12} />
        <span>{annotations.length} 条注释</span>
      </span>
      {pos && createPortal(
        <div
          className="annotation-list-popup floating readonly"
          role="list"
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          {annotations.map((annotation, index) => (
            <div className="annotation-list-item" key={annotation.id} role="listitem">
              <span className="annotation-index">{index + 1}。</span>
              <div className="annotation-item-main">
                <span className="annotation-field-label">所选文本：</span>
                <span className="annotation-quote" title={annotation.quote}>{annotation.quote}</span>
                {annotation.comment.trim() && (
                  <>
                    <span className="annotation-field-label">用户评论：</span>
                    <span className="annotation-comment" title={annotation.comment}>{annotation.comment}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export type ContextMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
};

// 选区浮动条：选中会话内容后弹出，固定在选区上方（水平居中 + 边缘钳制）
export function SelectionQuoteBar({
  quote,
  onAddToComposer,
  onSendToSideChat,
  onClose,
}: {
  quote: { text: string; x: number; y: number };
  onAddToComposer: () => void;
  onSendToSideChat: () => void;
  onClose: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const BAR_WIDTH = 180;
  const left = Math.max(8, Math.min(quote.x - BAR_WIDTH / 2, window.innerWidth - BAR_WIDTH - 8));
  const top = Math.max(8, quote.y - 34);

  return (
    <div
      ref={barRef}
      className="selection-quote-bar"
      role="toolbar"
      aria-label="选中文字操作"
      style={{ left, top }}
    >
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onAddToComposer}
        title={quote.text}
      >
        <MessageSquarePlus size={12} />
        <span>添加到对话</span>
      </button>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSendToSideChat}
      >
        <MessagesSquare size={12} />
        <span>侧边聊天</span>
      </button>
    </div>
  );
}

// 评论编辑卡：锚点坐标 + 视口钳制；取消=仅关闭，垃圾桶=删除注释，保存=写回评论
export function AnnotationEditorCard({
  editor,
  annotation,
  voiceState,
  onVoiceStart,
  onClose,
  onSave,
  onDelete,
}: {
  editor: { id: string; x: number; y: number };
  annotation: MessageAnnotation | null;
  voiceState: "idle" | "recording" | "transcribing";
  onVoiceStart: () => void;
  onClose: () => void;
  onSave: (comment: string) => void;
  onDelete: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [comment, setComment] = useState(annotation?.comment ?? "");

  useEffect(() => {
    setComment(annotation?.comment ?? "");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
    // 卡片按 id 打开：同一注释再次打开时重置为已存评论
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotation?.id]);

  // 语音转写直接写进注释本体（卡片外触发）：打开期间同步进编辑框，避免保存时盖掉转写结果
  useEffect(() => {
    setComment(annotation?.comment ?? "");
  }, [annotation?.comment]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  if (!annotation) return null;

  const CARD_WIDTH = 320;
  const left = Math.max(8, Math.min(editor.x, window.innerWidth - CARD_WIDTH - 8));
  const top = Math.max(8, editor.y);

  return (
    <div ref={cardRef} className="annotation-editor-card" style={{ left, top }}>
      <div className="annotation-editor-quote" title={annotation.quote}>{annotation.quote}</div>
      <textarea
        ref={textareaRef}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="添加可选评论…"
        rows={3}
        lang="zh-CN"
      />
      <div className="annotation-editor-actions">
        <button type="button" className="annotation-editor-icon" onClick={onDelete} aria-label="删除该注释" title="删除该注释">
          <Trash2 size={15} />
        </button>
        <span className="annotation-editor-spacer" />
        <button
          type="button"
          className={`annotation-editor-icon${voiceState === "recording" ? " recording" : ""}`}
          onClick={onVoiceStart}
          disabled={voiceState === "transcribing"}
          aria-label={voiceState === "recording" ? "结束录音" : "语音输入评论"}
          title={voiceState === "recording" ? "正在录音，再次点击结束" : "语音输入评论"}
        >
          {voiceState === "transcribing" ? <LoaderCircle size={15} className="spin" /> : <Mic size={15} />}
        </button>
        <button type="button" className="annotation-editor-cancel" onClick={onClose}>取消</button>
        <button type="button" className="annotation-editor-save" onClick={() => onSave(comment.trim())}>保存</button>
      </div>
    </div>
  );
}

// 全局右键菜单：点击外部、滚动、失焦或按 Esc 时关闭，位置自动贴边
export function ContextMenuPopup({
  menu,
  onClose,
}: {
  menu: { x: number; y: number; items: ContextMenuItem[] };
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    const onDismiss = () => onClose();
    window.addEventListener("wheel", onDismiss, { passive: true });
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onDismiss);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onClose]);

  const MENU_WIDTH = 176;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8));
  const estimatedHeight = 40 + menu.items.length * 34;
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - estimatedHeight - 8));

  return (
    <div
      ref={popupRef}
      className="context-menu"
      role="menu"
      style={{ left, top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.items.map((item) => (
        <button
          type="button"
          key={item.key}
          role="menuitem"
          className="context-menu-item"
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
