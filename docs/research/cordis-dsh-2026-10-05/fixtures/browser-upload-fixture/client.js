window.__ModuleLoader__.load({ id: 'browser-upload-fixture', factory(require) {
  const React = require('react');
  return { inject: ['fileUpload', 'slots', 'sessions', 'conversation', 'inputTriggers'], apply(ctx) {
    const rows = new Map(), listeners = new Set();
    const row = id => { if (!rows.has(id)) rows.set(id, { text: '尚未上传浏览器文件' }); return rows.get(id); };
    const publish = () => { for (const listener of listeners) listener(); };
    const claim = id => ({ name: 'browser-upload-read', token: '/browser-upload-read ', attachments: true,
      hint: '实际读回浏览器文件', submit: async (_args, actx, attachments, signal) => {
        if (actx !== ctx.sessions.scope(id)) return { kind: 'error', text: '附件所属会话不符' };
        const response = await fetch('/api/browser-upload-fixture/read?sessionId=' + encodeURIComponent(id), {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal,
          body: JSON.stringify({ sessionId: id, attachments }) });
        const actual = await response.json();
        if (!response.ok || actual.kind !== 'success') return { kind: 'error', text: actual.text || actual.error || '附件未读回' };
        row(id).text = actual.text; publish(); return { kind: 'success', text: '已实际读回浏览器附件' };
      } });
    ctx.effect(() => ctx.inputTriggers.registerSource({ name: 'browser-upload-command', trigger: '/', order: -110,
      candidates: async (_session, req) => 'browser-upload-read'.includes(req.query || '') ? [{ name: 'browser-upload-read', label: '实际读回浏览器附件' }] : [],
      onPick: pick => ({ claim: claim(pick.session.sessionId) }),
      matchEnter: async (session, line) => /^\/browser-upload-read(?:\s|$)/.test(line) ? { claim: claim(session.sessionId) } : undefined }));

    ctx.effect(() => () => { for (const value of rows.values()) value.abort?.abort(); });
    ctx.slots.register({ name: 'conversation.input.overlay', id: 'browser-upload-proof', inject: id => ({ sessionId: id }) }, function Proof(props) {
      const id = props.sessionId, selected = React.useRef(null);
      const text = React.useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => row(id).text);
      const upload = async slow => {
        const state = row(id); if (!selected.current || state.abort) return;
        const file = selected.current, abort = new AbortController(); state.abort = abort; state.text = '正在上传 ' + file.name; publish();
        let source = file;
        if (slow) {
          const reader = file.stream().getReader();
          source = new ReadableStream({ async pull(target) {
            await new Promise(resolve => setTimeout(resolve, 2500));
            const next = await reader.read(); if (next.done) target.close(); else target.enqueue(next.value);
          }, cancel(reason) { return reader.cancel(reason); } });
        }
        try {
          const result = await ctx.fileUpload.upload(id, source, file.name, abort.signal, progress => {
            state.text = '上传进度 ' + progress.loaded + (progress.total === undefined ? '' : '/' + progress.total); publish();
          });
          if (!result.ok) throw result.error;
          const response = await fetch('/api/browser-upload-fixture/read?sessionId=' + encodeURIComponent(id), { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: id, attachments: [{ type: 'file', receiptId: result.value.receiptId }] }) });
          const actual = await response.json(); if (!response.ok || actual.kind !== 'success') throw new Error(actual.text || actual.error);
          state.text = actual.text;
        } catch (error) { state.text = abort.signal.aborted ? '已取消，原文件仍可重试' : '上传失败：' + error.message; }
        finally { state.abort = undefined; publish(); }
      };
      return React.createElement('div', { style: { padding: '6px 12px', fontSize: 12 } },
        React.createElement('input', { type: 'file', 'aria-label': '选择浏览器验收文件', onChange: event => { selected.current = event.target.files[0]; row(id).text = '已选择 ' + (selected.current?.name || ''); publish(); } }),
        React.createElement('button', { type: 'button', onClick: () => void upload(false) }, '上传并读回浏览器文件'),
        React.createElement('button', { type: 'button', onClick: () => void upload(true) }, '缓慢上传验收取消'),
        React.createElement('button', { type: 'button', onClick: () => row(id).abort?.abort(new Error('窗口取消上传')) }, '取消浏览器上传'),
        React.createElement('button', {type:'button',onClick:()=>{
          if (!selected.current) return;
          const drafts=ctx.conversation.createDrafts(id,[selected.current]);
          const input=ctx.conversation.input.for(ctx.sessions.scope(id));
          if (!input.addAttachments(drafts.map(draft=>draft.id))) ctx.conversation.releaseDraftAttachments(drafts);
        }},'将文件加入插件输入'),
        React.createElement('button', {type:'button',onClick:()=>ctx.conversation.input.for(ctx.sessions.scope(id)).setDraft('/browser-upload-read')},'填写读取附件命令'),
        React.createElement('button', {type:'button',onClick:()=>ctx.conversation.input.for(ctx.sessions.scope(id)).submit('queue','click')},'通过插件输入发送'),
        React.createElement('p', { 'data-browser-upload-proof': 'true', style: { maxHeight: 100, overflow: 'auto', margin: '4px 0' } }, text));
    });
  } };
} });
