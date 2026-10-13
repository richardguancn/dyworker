import React, { useLayoutEffect, useRef, useState } from 'react';
import { memberMentionAt, memberCandidates, insertMemberMention, type MentionQuery, type TeamMember } from './mentions';

export function TeamComposer({ sessionId, name, isRoom, members, disabled, busy, running, onSend, onStop }: {
  sessionId: string; name: string; isRoom: boolean; members: TeamMember[];
  disabled: boolean; busy: boolean; running: boolean;
  onSend(text: string): Promise<void>; onStop(): Promise<void>;
}) {
  const storageKey = `dyworker-bot-draft:${sessionId}`;
  const [draft, setDraft] = useState(() => { try { return sessionStorage.getItem(storageKey) || ''; } catch { return ''; } });
  const draftRef = useRef(draft); draftRef.current = draft;
  const [mention, setMention] = useState<MentionQuery | null>(null), [index, setIndex] = useState(0);
  const [sending, setSending] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null), composing = useRef(false), locked = useRef(false);
  const dismissedMention = useRef<string | null>(null);
  const dismissMention = () => { dismissedMention.current = `${draftRef.current}\n${input.current?.selectionStart ?? draftRef.current.length}`; setMention(null); };
  const candidates = mention ? memberCandidates(members, mention.query) : [];
  const currentIndex = Math.min(index, Math.max(0, candidates.length - 1));
  const canSend = !disabled && !busy && !sending && Boolean(draft.trim());
  const update = (text: string, caret: number) => {
    dismissedMention.current = null; draftRef.current = text; setDraft(text);
    try { if (text) sessionStorage.setItem(storageKey, text); else sessionStorage.removeItem(storageKey); } catch { /* 浏览器禁止存储时保留当前输入 */ }
    setMention(isRoom ? memberMentionAt(text, caret) : null); setIndex(0);
  };
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = '60px';
    input.current.style.height = `${Math.min(220, Math.max(60, input.current.scrollHeight))}px`;
  }, [draft]);
  const pick = (member: TeamMember) => {
    if (!mention) return;
    const next = insertMemberMention(draft, mention, member);
    update(next.text, next.caret); setMention(null);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next.caret, next.caret); });
  };
  const send = async () => {
    if (!canSend || locked.current) return;
    locked.current = true; setSending(true); setError(''); setMention(null);
    const submitted = draftRef.current;
    try {
      await onSend(submitted.trim());
      if (draftRef.current === submitted) update('', 0);
      input.current?.focus();
    } catch (failure: any) { setError(String(failure?.message || failure)); }
    finally { locked.current = false; setSending(false); }
  };
  return <div className="composer-dock team-composer-dock">
    <form className="composer-card team-composer-card" onSubmit={event => { event.preventDefault(); void send(); }}>
      {mention && <div id="team-member-menu" className="team-mention-menu" role="listbox" aria-label="机器人团队成员">
        {candidates.length ? candidates.map((member, at) => <button type="button" role="option" id={`team-member-${at}`} key={member.id}
          aria-selected={at === currentIndex} onMouseDown={event => event.preventDefault()} onClick={() => pick(member)}>
          <span>@{member.name}</span>{member.role && <small>{member.role}</small>}
        </button>) : <p className="dy-bot-sub">没有匹配的团队成员</p>}
      </div>}
      <textarea ref={input} className="team-composer-input" aria-label="消息" placeholder={isRoom ? '向群聊发送消息，输入 @ 选择成员' : `给${name}发送消息…`}
        value={draft} disabled={disabled} rows={2} lang="zh-CN" spellCheck={false}
        aria-autocomplete={isRoom ? 'list' : undefined} aria-expanded={isRoom ? Boolean(mention) : undefined}
        aria-controls={mention ? 'team-member-menu' : undefined} aria-activedescendant={mention && candidates.length ? `team-member-${currentIndex}` : undefined}
        onChange={event => update(event.target.value, event.target.selectionStart)}
        onSelect={event => { const node = event.currentTarget; if (!composing.current && node.value === draftRef.current && node.selectionStart === node.selectionEnd) setMention(isRoom && dismissedMention.current !== `${node.value}\n${node.selectionStart}` ? memberMentionAt(node.value, node.selectionStart) : null); }}
        onBlur={() => setMention(null)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (mention) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex(candidates.length ? (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length : 0); return; }
            if (event.key === 'Escape') { event.preventDefault(); dismissMention(); return; }
            if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') { event.preventDefault(); if (candidates[currentIndex]) pick(candidates[currentIndex]); return; }
          }
          if (event.key === 'Escape' && running && !busy && !sending) { event.preventDefault(); void onStop(); return; }
          if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) { event.preventDefault(); void send(); }
        }} />
      <div className="composer-toolbar">
        <div className="composer-actions">{isRoom && <button className="team-mention-trigger" type="button" aria-label="选择机器人团队成员" disabled={disabled}
          onMouseDown={event => event.preventDefault()} onClick={() => {
            const caret = input.current?.selectionStart ?? draft.length;
            if (mention) { dismissMention(); return; }
            const token = caret > 0 && /[a-z0-9_.]/i.test(draft[caret - 1]) ? ' @' : '@';
            const nextCaret = caret + token.length;
            update(draft.slice(0, caret) + token + draft.slice(caret), nextCaret);
            requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(nextCaret, nextCaret); });
          }}>@</button>}<span className="dy-bot-sub">Enter 发送 · Shift+Enter 换行</span></div>
        <div className="composer-actions composer-send-actions">{running && !draft.trim() ? <button className="send-button stop" type="button" aria-label="停止当前任务" title="停止当前任务" disabled={busy || sending} onClick={() => void onStop()}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><rect x="2" y="2" width="10" height="10" rx="1" fill="currentColor" /></svg>
        </button> : <button className="send-button" type="submit" aria-label="发送" title="Enter 发送" disabled={!canSend}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
        </button>}</div>
      </div>
      {error && <p role="alert" className="dy-bot-error">{error}</p>}
    </form>
  </div>;
}
