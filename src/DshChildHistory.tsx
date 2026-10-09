import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { MarkdownSnippet } from './InteractiveMessage';
import { clientHost } from './pluginRuntime/clientHostSingleton.ts';

export function DshChildHistory({ target, onClose }: {
  target: { id: string; rootSessionId: string; displayTitle: string }; onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<any>();
  const [error, setError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [draft, setDraft] = useState('');
  const [delivery, setDelivery] = useState<'queue' | 'steer'>('queue');
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const uploaded = useRef(new Map<File, any>());
  const operation = useRef<AbortController | undefined>(undefined);
  const requestId = useRef<string | undefined>(undefined);
  const identity = `${target.rootSessionId}:${target.id}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  useEffect(() => {
    let cancelled = false; setSnapshot(undefined); setError('');
    setDraft(''); setFiles([]); uploaded.current.clear(); requestId.current = undefined;
    setWorking(false); setOperationError(''); setNotice(''); setDelivery('queue');
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await window.dyworker?.dshOperation({ sessionId: target.rootSessionId, action: 'child-snapshot', payload: { childId: target.id } });
        if (cancelled) return;
        if (result?.ok) { setSnapshot(result.value); setError(''); }
        else setError(result?.error?.message || '无法读取子任务记录');
      } catch (reason: any) { if (!cancelled) setError(String(reason?.message || reason)); }
      finally { if (!cancelled) timer = setTimeout(refresh, 1000); }
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); operation.current?.abort(new Error('子任务窗口已关闭')); };
  }, [target.id, target.rootSessionId]);
  const control = snapshot?.control;
  const continuable = control?.mode === 'continuable';
  const available = continuable && control?.available === true;
  const lastEnd = [...(snapshot?.events || [])].reverse().find((event: any) => event.type === 'turn/end');
  const taskFailure = !control?.running && lastEnd?.data?.reason?.kind === 'error'
    ? lastEnd.data.reason.error?.message || '子任务执行失败，请查看记录后重试。' : '';
  const perform = async (action: 'child-prompt' | 'child-interrupt') => {
    if (working || !continuable || (action === 'child-interrupt' && !available)
      || (action === 'child-prompt' && !draft.trim() && !files.length)) return;
    const owner = identity;
    const text = draft;
    const selected = files;
    const controller = new AbortController(); operation.current = controller;
    setWorking(true); setOperationError(''); setNotice('');
    try {
      const content: any[] = text ? [{ type: 'text', text }] : [];
      if (action === 'child-prompt') for (const file of selected) {
        controller.signal.throwIfAborted();
        let part = uploaded.current.get(file);
        if (!part) {
          if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
            if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20 MB');
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = ''; for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
            part = { type: 'image', mediaType: file.type, data: btoa(binary), name: file.name };
          } else {
            const result = await (clientHost().ctx as any).fileUpload.upload(target.rootSessionId, file, file.name, controller.signal);
            if (!result.ok) throw new Error(result.error.message);
            part = { type: 'file', receiptId: result.value.receiptId };
          }
          controller.signal.throwIfAborted(); uploaded.current.set(file, part);
        }
        content.push(part);
      }
      controller.signal.throwIfAborted();
      const payload = { childSessionId: target.id, parentSessionId: control.parentSessionId, mode: 'continuable',
          ...(action === 'child-prompt' ? { requestId: requestId.current ??= crypto.randomUUID(), delivery, content,
            clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}) };
      const result = action === 'child-prompt' && !available
        ? await window.dyworker?.continueChildTask({sessionId:target.rootSessionId,runId:crypto.randomUUID(),prompt:payload})
        : await window.dyworker?.dshOperation({sessionId:target.rootSessionId,action,payload});
      if (identityRef.current !== owner) return;
      if (!result?.ok) throw new Error(result?.error?.message || '子任务操作失败');
      if (action === 'child-prompt') {
        if (typeof result.value?.messageId !== 'string') throw new Error('子任务没有确认接收');
        setDraft(previous => previous === text ? '' : previous); setFiles([]); uploaded.current.clear(); requestId.current = undefined;
        setNotice('子任务已接收，记录会自动更新。');
      } else {
        if (result.value?.accepted !== true) throw new Error('子任务没有确认停止请求');
        setNotice('已请求停止，请等待当前操作结束。');
      }
    } catch (reason: any) { if (identityRef.current === owner) setOperationError(String(reason?.message || reason)); }
    finally { if (identityRef.current === owner) setWorking(false); }
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    };
    document.addEventListener('keydown', close, true);
    return () => { document.removeEventListener('keydown', close, true); previous?.focus(); };
  }, [onClose]);
  const messages = (snapshot?.events || []).flatMap((event: any) => {
    const message = event.type === 'user/message' ? event.data : ['assistant/message', 'tool/result'].includes(event.type) ? event.data?.message : undefined;
    if (!message) return [];
    const text = (message.content || []).map((block: any) => block.type === 'text' ? block.text
      : block.type === 'tool-call' ? `${block.name}\n${block.arguments}`
      : block.type === 'file' ? `文件：${block.attachment?.name || '附件'}（${block.attachment?.bytes ?? '?'} 字节）`
      : block.type === 'image' ? `图片：${block.attachment?.name || '已提交图片'}` : `[${block.type}]`).join('\n');
    const context = event.type === 'user/message' && message.source?.kind !== 'user';
    return [{ key: event.seq, context, label: context ? '运行说明' : event.type === 'user/message' ? '任务要求' : event.type === 'tool/result' ? '操作结果' : '回复', text }];
  });
  return <div className="modal-backdrop stacked" onClick={onClose}>
    <section className="dsh-child-history" role="dialog" aria-modal="true" aria-label="子任务记录" onClick={event => event.stopPropagation()}>
      <header><div><h2>{target.displayTitle}</h2><p>子任务记录{control?.running ? ' · 正在工作' : ''}</p></div>
        <button type="button" className="icon-button" aria-label="关闭子任务记录" onClick={onClose} autoFocus><X size={18} /></button></header>
      <div className="dsh-child-history-body">
        {error && <p role="alert">{error}</p>}
        {taskFailure && <p role="alert">{taskFailure}</p>}
        {!snapshot ? !error && <p>正在读取子任务记录…</p>
          : !messages.length ? <p>此子任务还没有对话记录。</p>
          : messages.map((message: any) => <article key={message.key}>{message.context
            ? <details><summary>{message.label}</summary><MarkdownSnippet content={message.text} /></details>
            : <><h3>{message.label}</h3><MarkdownSnippet content={message.text} /></>}</article>)}
      </div>
      {continuable && <footer className="dsh-child-controls">
        {!available && <p>发送后将继续这个子任务，并使用当前模型和权限设置。</p>}
        <label>补充子任务要求<textarea value={draft} disabled={working} onChange={event => { setDraft(event.target.value); requestId.current = undefined; }} rows={3} /></label>
        <label>添加图片或文件<input type="file" multiple disabled={working} onChange={event => {
          setFiles(previous => [...previous, ...Array.from(event.target.files || [])]); requestId.current = undefined; event.target.value = '';
        }} /></label>
        {!!files.length && <ul>{files.map((file, index) => <li key={index}>{file.name} <button type="button" disabled={working}
          aria-label={`移除附件 ${file.name}`} onClick={() => { setFiles(previous => previous.filter((_, at) => at !== index)); uploaded.current.delete(file); requestId.current = undefined; }}>移除</button></li>)}</ul>}
        <div><label>处理方式 <select value={delivery} disabled={working} onChange={event => { setDelivery(event.target.value as 'queue' | 'steer'); requestId.current = undefined; }}>
          <option value="queue">排队处理</option><option value="steer">即时补充</option>
        </select></label>
          <button type="button" disabled={working || (!draft.trim() && !files.length)} onClick={() => void perform('child-prompt')}>{available ? '发送给子任务' : '继续子任务'}</button>
          <button type="button" disabled={!available || working || !control.running} onClick={() => void perform('child-interrupt')}>停止子任务</button></div>
        {operationError && <p role="alert">{operationError}</p>}
        {notice && <p role="status">{notice}</p>}
      </footer>}
    </section>
  </div>;
}
