import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { INLINE_TOKEN_REGEX, SESSION_TOKEN_REGEX } from "../../lib/text";
import type { ChatMessage } from "../../types";

// 长消息折叠（Codex 风格“显示更多/收起”）：内容过长时默认收起，
// 折叠状态下测量是否真的超出，避免短消息出现多余按钮。
export const LONG_TEXT_GATE = 300;

export function useClampToggle<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!active || expanded) return;
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(check);
    };
    schedule();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(el);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [active, expanded]);

  // 内容变短后复位展开状态，避免残留“收起”按钮
  useEffect(() => {
    if (!active) {
      setExpanded(false);
      setOverflowing(false);
    }
  }, [active]);

  return { ref, overflowing, expanded, setExpanded };
}

export function ShowMoreToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="show-more-toggle"
      onClick={onToggle}
      aria-expanded={expanded}
    >
      {expanded ? (
        <>收起<ChevronUp size={13} /></>
      ) : (
        <>显示更多<ChevronDown size={13} /></>
      )}
    </button>
  );
}

export function ClampedUserText({
  text,
  tokenNames,
  skillNames,
  onFileToken,
  sessionTitles,
  onSessionToken,
  pluginReferences,
  onPluginReference,
}: {
  text: string;
  tokenNames?: Set<string>;
  skillNames?: Set<string>;
  onFileToken?: (name: string) => void;
  sessionTitles?: Set<string>;
  onSessionToken?: (title: string) => void;
  pluginReferences?: ChatMessage['pluginReferences'];
  onPluginReference?: (reference: NonNullable<ChatMessage['pluginReferences']>[number]) => void;
}) {
  const active = text.length > LONG_TEXT_GATE;
  const { ref, overflowing, expanded, setExpanded } = useClampToggle<HTMLSpanElement>(active);
  return (
    <>
      <span
        ref={ref}
        className={`user-message-text${active && !expanded ? " clamped" : ""}${expanded ? " expanded" : ""}`}
      >
        {pluginReferences?.length ? (() => {
          const pieces: ReactNode[] = []; let cursor = 0;
          for (const [index, ref] of pluginReferences.entries()) {
            if (ref.offset < cursor || ref.offset + ref.length > text.length || text.slice(ref.offset, ref.offset + ref.length) !== ref.clipboardText) return text;
            pieces.push(renderInlineTokens(text.slice(cursor, ref.offset), tokenNames ?? new Set<string>(), skillNames ?? new Set<string>(), { keyPrefix: `bubble-before-ref:${index}`, onFileToken, sessionTitles, onSessionToken }));
            pieces.push(<button key={`plugin-ref:${index}`} className="message-plugin-reference" type="button" title={ref.label}
              onClick={() => onPluginReference?.(ref)}>{ref.label}</button>);
            cursor = ref.offset + ref.length;
          }
          pieces.push(renderInlineTokens(text.slice(cursor), tokenNames ?? new Set<string>(), skillNames ?? new Set<string>(), { keyPrefix: 'bubble-after-refs', onFileToken, sessionTitles, onSessionToken })); return pieces;
        })() : renderInlineTokens(text, tokenNames ?? new Set<string>(), skillNames ?? new Set<string>(), { keyPrefix: "bubble", onFileToken, sessionTitles, onSessionToken })}
      </span>
      {overflowing && (
        <ShowMoreToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
      )}
    </>
  );
}

// 把文本中的 @文件名、@「会话标题」 与 /技能名 token 渲染成内联高亮（输入框镜像与用户气泡共用）：
// 引用文件/技能/会话按输入顺序随正文展示，而不是单独堆成一排 chip
export function renderInlineTokens(
  text: string,
  fileNames: Set<string>,
  skillNames: Set<string>,
  options?: {
    keyPrefix?: string;
    onFileToken?: (name: string) => void;
    sessionTitles?: Set<string>;
    onSessionToken?: (title: string) => void;
  },
): ReactNode {
  if (!text) return null;
  const { keyPrefix = "", onFileToken, sessionTitles, onSessionToken } = options || {};
  if (!fileNames.size && !skillNames.size && !sessionTitles?.size) return text;
  const parts: ReactNode[] = [];
  let index = 0;

  // 普通片段：沿用 @文件 / /技能 的正则扫描，只在 [from,to) 窗口内取 token
  const emitPlain = (from: number, to: number) => {
    INLINE_TOKEN_REGEX.lastIndex = from;
    let match: RegExpExecArray | null;
    while ((match = INLINE_TOKEN_REGEX.exec(text)) && match.index < to) {
      const token = match[0];
      const name = token.slice(1);
      const isFile = token.startsWith("@") && fileNames.has(name);
      const isSkill = token.startsWith("/") && skillNames.has(name);
      if (!isFile && !isSkill) continue;
      if (match.index > from) parts.push(text.slice(from, match.index));
      if (isFile) {
        parts.push(
          <span
            className={`file-token${onFileToken ? " clickable" : ""}`}
            key={`${keyPrefix}-${index++}`}
            title={onFileToken ? `打开 ${name}` : undefined}
            onClick={onFileToken ? () => onFileToken(name) : undefined}
          >@{name}</span>,
        );
      } else {
        parts.push(<span className="skill-token" key={`${keyPrefix}-${index++}`}>/{name}</span>);
      }
      from = match.index + token.length;
    }
    if (from < to) parts.push(text.slice(from, to));
  };

  // 会话 token 用括号定界单独扫；命中区间交给 emitPlain 之外的分支渲染，
  // 避免 @「标题」 被 @文件 正则截成半截（标题里的空格同样不受影响）
  if (sessionTitles?.size) {
    let last = 0;
    SESSION_TOKEN_REGEX.lastIndex = 0;
    let sessionMatch: RegExpExecArray | null;
    while ((sessionMatch = SESSION_TOKEN_REGEX.exec(text))) {
      const title = sessionMatch[1];
      if (!sessionTitles.has(title)) continue;
      emitPlain(last, sessionMatch.index);
      parts.push(
        <span
          className={`session-token${onSessionToken ? " clickable" : ""}`}
          key={`${keyPrefix}-${index++}`}
          title={onSessionToken ? `打开会话 ${title}` : undefined}
          onClick={onSessionToken ? () => onSessionToken(title) : undefined}
        >@「{title}」</span>,
      );
      last = sessionMatch.index + sessionMatch[0].length;
    }
    emitPlain(last, text.length);
  } else {
    emitPlain(0, text.length);
  }
  return parts;
}
