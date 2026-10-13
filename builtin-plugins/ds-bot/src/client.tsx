import React, { useEffect, useRef, useState } from 'react';
import { conversationMessages } from './messages';
import { TeamComposer } from './TeamComposer';
import { MarkdownText, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives';

async function call(endpoint: string, payload: any = {}, signal?: AbortSignal) {
  const response = await fetch('/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, payload }), signal });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error?.message || result.error || `请求失败（${response.status}）`);
  return result.value;
}

const css = `.plugin-slot-view[data-plugin="ds-bot"]{flex:1;min-height:0;padding:0;overflow:hidden}
.plugin-slot-view[data-plugin="ds-bot"]>.plugin-slot-item{display:flex;flex:1;min-height:0;overflow:hidden}
.dy-bots{flex:1;overflow:hidden;display:flex;flex-direction:column;gap:12px;padding:20px 28px;color:var(--ink);min-height:0;font-size:calc(13px * var(--font-ui-scale,1));box-sizing:border-box}
.dy-bots *{box-sizing:border-box}.dy-bots button:not(.send-button),.dy-bots select,.dy-bots input,.dy-bots textarea:not(.team-composer-input){font:inherit;color:inherit;border:1px solid var(--border,#ccc);border-radius:8px;background:var(--card,#fff);padding:8px}
.dy-bots button{cursor:pointer}.dy-bots button:disabled{opacity:.5;cursor:default}.dy-bots button:not(.send-button):hover:not(:disabled){background:var(--sidebar-hover,#eee)}
.dy-bots .dy-bot-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.dy-bots .dy-bot-row>select{flex:1;min-width:100px}.dy-bots h3,.dy-bots p{margin:0}
.dy-bots .dy-bot-sub{color:var(--muted,#777);font-size:12px;line-height:1.6}.dy-bots .dy-bot-alert{padding:10px;border-radius:8px;background:var(--sidebar-hover,#eee);line-height:1.6}
.dy-bots .dy-bot-error{color:#c33}.dy-bots .dy-bot-body{padding:20px max(0px,calc((100% - 940px)/2));flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:0}
.dy-bots form{display:flex;flex-direction:column;gap:10px}.dy-bots label{display:flex;flex-direction:column;gap:5px}.dy-bots textarea:not(.team-composer-input){resize:vertical;width:100%;min-height:78px;line-height:1.6}
.dy-bots .dy-bot-fields{flex:1;min-height:0;overflow:auto}.dy-bots .dy-bot-member{flex-direction:row;align-items:center}
.dy-bots .dy-bot-active{border-color:var(--accent,#497cff)}.dy-bots .dy-bot-empty{margin:auto;text-align:center;line-height:1.8;color:var(--muted,#777)}
.dy-bots .dy-bot-memory{padding:12px;border-bottom:1px solid var(--border,#ddd);white-space:pre-wrap;line-height:1.6}.dy-bots .dy-bot-memory button{display:block;margin-top:8px}
.dy-bots .dy-bot-approval{border:1px solid var(--accent,#497cff);line-height:1.6}.dy-bots .dy-bot-approval pre{margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;color:var(--muted,#777);max-height:180px;overflow:auto}
.bot-team-page{display:flex;flex:1;min-height:0;overflow:hidden}
.bot-team-page>.plugin-slot-view{display:flex;flex:1;min-width:0}
.bot-team-entry.active{background:var(--sidebar-active);color:var(--ink)}
.dy-bots .dy-bot-body>*{flex-shrink:0}
.dy-bots .dy-bot-author{display:block;color:var(--muted);margin-bottom:10px}
.dy-bots .message-actions button{padding:3px 5px;border:0;background:transparent}
.dy-bots .team-composer-dock{position:relative;inset:auto;padding:0 0 4px;flex-shrink:0}
.dy-bots .team-composer-card{width:min(940px,100%);position:relative;gap:0}
.dy-bots .team-composer-input{height:60px;min-height:60px;max-height:220px;resize:none}
.dy-bots .send-button{display:flex;align-items:center;justify-content:center;flex-shrink:0;border:0;padding:0;background:var(--ink);color:var(--card);border-radius:50%}
.dy-bots .send-button:disabled{background:var(--border);color:var(--muted)}
.dy-bots button.team-mention-trigger{border:0;background:transparent;padding:6px}
.dy-bots .team-mention-menu{position:absolute;bottom:calc(100% + 8px);left:0;width:min(360px,100%);max-height:260px;overflow:auto;padding:6px;border:1px solid var(--border);border-radius:12px;background:var(--card);box-shadow:var(--shadow-md);z-index:20}
.dy-bots .team-mention-menu button{display:flex;width:100%;gap:10px;text-align:left;border:0;background:transparent}
.dy-bots .team-mention-menu button[aria-selected=true]{background:var(--sidebar-hover)}
.dy-bots .team-mention-menu small{color:var(--muted);margin-left:auto}
@media(max-width:700px){.dy-bots{padding:14px}.dy-bots .dy-bot-body{padding:14px 0}}
`;

function TeamPanel({ visible = true }: { visible?: boolean }) {
  const [team, setTeam] = useState<any>(null), [selected, setSelected] = useState(() => { try { return sessionStorage.getItem('dyworker-bot-selected') || ''; } catch { return ''; } });
  const [error, setError] = useState(''), [connectionError, setConnectionError] = useState(''), [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<any>({ events: [] }), [view, setView] = useState('chat');
  const [form, setForm] = useState<any>(null), [memory, setMemory] = useState<any>(null), [memoryDraft, setMemoryDraft] = useState('');
  const [notice, setNotice] = useState(''), [confirmDelete, setConfirmDelete] = useState(false), [questionAnswer, setQuestionAnswer] = useState('');
  const [approvals, setApprovals] = useState<any[]>([]);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const bodyRef = useRef<HTMLDivElement>(null), pinned = useRef(true);
  const items = [...(team?.bots || []), ...(team?.rooms || [])];
  const entry = items.find(item => item.id === selected), isRoom = !!entry?.members;
  const sessionId = entry?.sessionId || entry?.id;
  const questionSessionId = [sessionId, ...(isRoom ? entry.parts || [] : [])].find(id => team?.questions?.[id]);
  const question = team?.questions?.[questionSessionId];
  const noModel = !team?.models?.length || (!isRoom && !entry?.model);
  const readOnly = !!team?.readOnly;
  // 机器人调用 DYWorker 的能力时，需要确认的会在这里问：按当前对话筛出待确认项。
  const pendingApproval = approvals.find(item => [sessionId, entry?.id, entry?.sessionId].includes(item.sessionId));

  const refresh = async (signal?: AbortSignal) => {
    const value = await call('state', { locale: 'zh-CN' }, signal);
    if (signal?.aborted) return;
    setTeam(value);
    const all = [...value.bots, ...value.rooms];
    const chosen = all.find(item => item.id === selectedRef.current) || all.find(item => item.id === value.mainBotId) || all[0];
    if (chosen) {
      selectedRef.current = chosen.id; setSelected(chosen.id);
      const conversationId = chosen.sessionId || chosen.id;
      const next = await call('dyworker-history', { sessionId: conversationId }, signal);
      if (!signal?.aborted && (!selectedRef.current || selectedRef.current === chosen.id)) setHistory(next);
      const pending = await call('dyworker-approvals', { sessionId: conversationId }, signal);
      if (!signal?.aborted && selectedRef.current === chosen.id) setApprovals(pending?.items || []);
    }
    if (!signal?.aborted) setConnectionError('');
  };
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController(); let timer: any;
    const loop = async () => {
      try { await refresh(controller.signal); }
      catch (failure: any) { if (!controller.signal.aborted) setConnectionError(String(failure.message || failure)); }
      if (!controller.signal.aborted) timer = setTimeout(loop, document.hidden ? 10000 : 1500);
    };
    void loop();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [visible]);
  useEffect(() => { try { if (selected) sessionStorage.setItem('dyworker-bot-selected', selected); } catch { /* 保留当前选择 */ } }, [selected]);
  useEffect(() => { setHistory({ events: [] }); setView('chat'); setMemory(null); setConfirmDelete(false); setNotice(''); setQuestionAnswer(''); pinned.current = true; }, [selected]);
  useEffect(() => {
    if (!selected || !visible) return;
    const controller = new AbortController();
    void refresh(controller.signal).catch(failure => { if (!controller.signal.aborted) setConnectionError(String(failure.message || failure)); });
    return () => controller.abort();
  }, [selected, visible]);
  useEffect(() => { if (pinned.current && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [history, question]);

  async function perform(action: () => Promise<any>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); await refresh(); }
    catch (failure: any) { setError(String(failure.message || failure)); }
    finally { setBusy(false); }
  }
  const edit = () => setForm({ ...entry, kind: isRoom ? 'room' : 'bot', mode: entry?.mode || 'admin', members: [...(entry?.members || [])] });
  const create = (kind: string) => setForm({ kind, name: '', role: '', instructions: '', model: team?.defaultModel || '', members: [], mode: 'admin' });
  const patch = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value, ...(key === 'members' && !value.includes(current.admin) ? { admin: value[0] || '' } : {}) }));
  const loadMemory = () => perform(async () => { setMemory(await call('memory-view', { botId: entry.id })); setView('memory'); });

  if (form) return <div className="dy-bots"><style>{css}</style><div className="dy-bot-row"><h3>{form.id ? '编辑' : '新建'}{form.kind === 'room' ? '群聊' : '机器人'}</h3><button onClick={() => setForm(null)} disabled={busy}>返回</button></div>
    {error && <p role="alert" className="dy-bot-error">{error}</p>}
    <form className="dy-bot-fields" onSubmit={event => { event.preventDefault(); void perform(async () => {
      const value = await call(`${form.id ? 'update' : 'create'}-${form.kind === 'room' ? 'room' : 'bot'}`, form);
      setForm(null); if (value?.id) { selectedRef.current = value.id; setSelected(value.id); }
    }); }}>
      <label>名称<input value={form.name} maxLength={40} required onChange={event => patch('name', event.target.value)} /></label>
      {form.kind === 'bot' ? <>
        <label>角色<input value={form.role} maxLength={24} onChange={event => patch('role', event.target.value)} placeholder="例如：写作助手" /></label>
        <label>工作说明<textarea value={form.instructions} onChange={event => patch('instructions', event.target.value)} placeholder="说明希望它负责什么、如何与你协作" /></label>
        <label>模型<select value={form.model || ''} onChange={event => patch('model', event.target.value)}><option value="">稍后选择</option>{(team?.models || []).map((model: any) => <option key={model.ref} value={model.ref}>{model.providerName} · {model.name}</option>)}</select></label>
      </> : <>
        <p>成员（至少选择两个）</p>{(team?.bots || []).map((bot: any) => <label className="dy-bot-member" key={bot.id}><input type="checkbox" checked={form.members.includes(bot.id)} onChange={event => patch('members', event.target.checked ? [...form.members, bot.id] : form.members.filter((id: string) => id !== bot.id))} />{bot.name}</label>)}
        {form.id && <><label>群公告<textarea value={form.notice || ''} onChange={event => patch('notice', event.target.value)} /></label>
          <label>回复方式<select value={form.mode} onChange={event => patch('mode', event.target.value)}><option value="admin">由管理员协调</option><option value="everyone">成员依次回复</option></select></label></>}
        <label>管理员<select value={form.admin || form.members[0] || ''} onChange={event => patch('admin', event.target.value)}>{form.members.map((id: string) => <option key={id} value={id}>{team.bots.find((bot: any) => bot.id === id)?.name}</option>)}</select></label>
      </>}
      <button type="submit" disabled={busy || readOnly || !form.name.trim() || (form.kind === 'room' && form.members.length < 2)}>{busy ? '正在保存…' : '保存'}</button>
    </form></div>;

  const messages = conversationMessages(history);
  return <div className="dy-bots"><style>{css}</style>
    <div className="dy-bot-row"><h3>机器人团队</h3><button disabled={busy || !team || readOnly} onClick={() => create('bot')}>新建机器人</button><button disabled={busy || (team?.bots?.length || 0) < 2 || readOnly} title={(team?.bots?.length || 0) < 2 ? '至少需要两个机器人' : undefined} onClick={() => create('room')}>新建群聊</button></div>
    <p className="dy-bot-sub">为机器人安排角色，单独交流或让它们在群聊中协作。机器人可以使用工作文件夹里的文件、命令和联网工具；需要确认的操作会在这里问你。</p>
    {approvals.length > 0 && !pendingApproval && <p role="status" className="dy-bot-sub">还有 {approvals.length} 项操作等待确认，请切换到对应的对话处理。</p>}
    {(error || connectionError) && <div role="alert" className="dy-bot-alert dy-bot-error">{error || connectionError}</div>}
    {team?.readOnly && <div className="dy-bot-alert">{team.readOnly}</div>}
    {!team ? <div className="dy-bot-empty">{error || connectionError ? <button onClick={() => void perform(async () => {})}>重试</button> : '正在打开机器人团队…'}</div> : <>
      <div className="dy-bot-row"><select aria-label="选择对话" value={selected} onChange={event => { selectedRef.current = event.target.value; setSelected(event.target.value); }}>{items.map(item => <option key={item.id} value={item.id}>{item.members ? '群聊：' : ''}{item.name}{team.mainBotIds.includes(item.id) ? '（总管）' : ''}</option>)}</select><button disabled={busy || !entry || readOnly} onClick={edit}>编辑</button></div>
      {entry && <>
        <div className="dy-bot-row"><button className={view === 'chat' ? 'dy-bot-active' : ''} onClick={() => setView('chat')}>对话</button>
          {!isRoom && <button disabled={busy} className={view === 'memory' ? 'dy-bot-active' : ''} onClick={() => void loadMemory()}>记忆</button>}
          <button disabled={busy} className={view === 'usage' ? 'dy-bot-active' : ''} onClick={() => void perform(async () => { setMemory(await call('usage', { timeZone: 'Asia/Shanghai' })); setView('usage'); })}>用量</button>
          {!isRoom && <button disabled={busy || readOnly} onClick={() => void perform(async () => { await call('set-main', { id: entry.id, main: !team.mainBotIds.includes(entry.id) }); })}>{team.mainBotIds.includes(entry.id) ? '取消总管' : '设为总管'}</button>}
          <button disabled={busy || readOnly} onClick={() => setConfirmDelete(!confirmDelete)}>删除</button></div>
        {confirmDelete && <div className="dy-bot-alert">删除“{entry.name}”后将从团队中移除。<div className="dy-bot-row"><button disabled={busy} onClick={() => void perform(async () => { await call(isRoom ? 'delete-room' : 'delete-bot', { id: entry.id }); setConfirmDelete(false); })}>确认删除</button><button onClick={() => setConfirmDelete(false)}>保留</button></div></div>}
        {notice && <p role="status" className="dy-bot-sub">{notice}</p>}
        {view === 'chat' ? <>
          {noModel && <div className="dy-bot-alert">{team.models.length ? '请点击“编辑”为此机器人选择模型。' : '请先在 DYWorker 的模型设置中添加一个可用模型。'}</div>}
          <div className="dy-bot-body" ref={bodyRef} onScroll={() => { const el = bodyRef.current; if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
            {!messages.length && <div className="dy-bot-empty">{isRoom ? (entry.mode === 'everyone' ? '向群聊发送消息，成员会依次回复。也可以用 @姓名 指定成员。' : '向群聊发送消息，管理员会协调成员回复。也可以用 @姓名 指定成员。') : `向${entry.name}发送消息，开始交流。`}</div>}
            {messages.map((message, index) => <div className={`message-row ${message.role}`} key={message.key || index}>
              <div className={message.role === 'user' ? 'user-message-stack' : 'assistant-message'}>
                {message.role !== 'user' && <small className="dy-bot-author">{message.who || entry.name}</small>}
                {message.role === 'user' ? <div className="user-bubble">{message.text}</div> : <MarkdownText content={message.text} />}
                <div className={`message-actions ${message.role}`}><button type="button" aria-label="复制消息" title="复制消息"
                  onClick={() => void Promise.resolve().then(() => writeClipboard(message.text)).then(() => setNotice('已复制消息')).catch(() => setError('复制失败，请重试'))}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4" /></svg></button></div>
              </div>
            </div>)}
            {history.running && <p role="status" className="dy-bot-sub">正在回复…</p>}
            {history.error && <p role="alert" className="dy-bot-error">{history.error}</p>}
            {pendingApproval && <div className="dy-bot-alert dy-bot-approval" data-approval={pendingApproval.id}><p><strong>需要你确认</strong></p><p>{pendingApproval.title}</p><pre>{pendingApproval.details}</pre><div className="dy-bot-row"><button disabled={busy || readOnly} onClick={() => void perform(async () => { await call('dyworker-approve', { id: pendingApproval.id, allow: true }); })}>允许</button><button disabled={busy || readOnly} onClick={() => void perform(async () => { await call('dyworker-approve', { id: pendingApproval.id, allow: false }); })}>拒绝</button></div></div>}
            {question && <div className="dy-bot-alert"><p>{question.question}</p>{question.detail && <p className="dy-bot-sub">{question.detail}</p>}<div className="dy-bot-row">{question.options?.map((option: any) => <button key={option.label} disabled={busy || readOnly} onClick={() => void perform(async () => { await call('answer-question', { sessionId: questionSessionId, questionId: question.id, answer: { selected: [option.label] } }); })}>{option.label}</button>)}</div><label>自行回答<input value={questionAnswer} onChange={event => setQuestionAnswer(event.target.value)} /></label><button disabled={busy || !questionAnswer.trim() || readOnly} onClick={() => void perform(async () => { await call('answer-question', { sessionId: questionSessionId, questionId: question.id, answer: { custom: questionAnswer } }); setQuestionAnswer(''); })}>提交回答</button></div>}
          </div>
          <TeamComposer key={sessionId} sessionId={sessionId} name={entry.name} isRoom={isRoom}
            members={(team.bots || []).filter((bot: any) => entry.members?.includes(bot.id))}
            disabled={readOnly || noModel} busy={busy} running={history.running}
            onSend={async text => { await call('send', { sessionId, text }); pinned.current = true; await refresh().catch(failure => setConnectionError(String(failure.message || failure))); }}
            onStop={() => perform(async () => { await call('dyworker-stop', { sessionId }); })} />
        </> : view === 'memory' ? <>
          <p className="dy-bot-sub">机器人记忆与团队共享记忆会用于后续交流。</p>
          <div className="dy-bot-body">{!memory?.entries?.length && <p className="dy-bot-empty">暂时没有记忆。可以在下方告诉它需要记住什么。</p>}{memory?.entries?.map((item: any, index: number) => <div key={index} className="dy-bot-memory"><small>{item.scope === 'team' ? '团队共享' : '此机器人'}</small><p>{item.text}</p><button disabled={busy || readOnly} onClick={() => void perform(async () => { setMemory(await call('memory-forget', { botId: entry.id, ...item })); })}>移除记忆</button></div>)}</div>
          <form onSubmit={event => { event.preventDefault(); void perform(async () => { const value = await call('memory-ask', { botId: entry.id, text: memoryDraft }); setMemory(value.view); setNotice(value.reply); setMemoryDraft(''); }); }}><textarea aria-label="记忆说明" value={memoryDraft} onChange={event => setMemoryDraft(event.target.value)} placeholder="告诉它要记住、修改或忘记什么…" /><button disabled={busy || noModel || !memoryDraft.trim() || readOnly}>提交</button></form>
        </> : <Usage value={memory} />}
      </>}
    </>}
  </div>;
}

function Usage({ value }: { value: any }) {
  const rows = value?.rows || [];
  const totals = rows.reduce((sum: number[], row: any[]) => sum.map((count, index) => count + Number(row[index + 4] || 0)), [0, 0, 0, 0, 0]);
  return <div className="dy-bot-body"><p>团队模型用量</p><p className="dy-bot-sub">累计用量来自机器人对话及记忆整理等模型请求，单位为 Token。</p>{rows.length ? <div className="dy-bot-alert">{['输入用量', '缓存读取', '缓存写入', '输出用量', '请求次数'].map((label, index) => <p key={label}>{label}：{totals[index].toLocaleString('zh-CN')}</p>)}</div> : <p>暂时没有用量记录。</p>}</div>;
}

export default {
  name: 'ds-bot-client', inject: ['slots'],
  apply(ctx: any) {
    ctx.slots.inject('workspace.page', () => ctx.slots.register({ name: 'workspace.page',
      id: 'bot-team', key: 'bot-team', order: 50, label: () => '机器人团队' }, TeamPanel));
  },
};
