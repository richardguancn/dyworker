import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent, MouseEvent, MutableRefObject } from 'react';
import { clientHost } from './pluginRuntime/clientHostSingleton.ts';
import type { ComposerHandle, DshDraftEditor } from './pluginRuntime/dshDraftEditor.ts';
import { DecoratorPortals, draftEditorStyles, type InputState } from './pluginRuntime/vendor/dsh-draft-editor/index.js';
import { COMMAND_PRIORITY_CRITICAL, KEY_DOWN_COMMAND, PASTE_COMMAND } from 'lexical';

function DshInputQueue({sessionId,items}: {sessionId:string;items:readonly any[]}) {
  const [editing,setEditing] = useState<string>();const [text,setText] = useState('');
  const [busy,setBusy] = useState<string>();const [error,setError] = useState('');
  const update = async (itemId:string,action:any) => {
    if (busy) return;setBusy(itemId);setError('');
    try { await (clientHost().ctx as any).sessions.scope(sessionId).conversation.updateQueue(itemId,action);setEditing(undefined); }
    catch(error:any) {setError(String(error?.message || error));}
    finally {setBusy(undefined);}
  };
  if (!items.length) return null;
  return <div className="dsh-input-queue" aria-label="等待处理的插件消息">
    {items.map(item => <div key={item.id} className="dsh-input-queue-item">
      {editing === item.id ? <>
        <textarea aria-label="编辑等待消息" value={text} onChange={event => setText(event.target.value)} disabled={Boolean(busy)} />
        <button type="button" disabled={Boolean(busy)||!text.trim()} onClick={() => void update(item.id,{kind:'edit',content:[{type:'text',text}]})}>保存修改</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => setEditing(undefined)}>取消修改</button>
      </> : <>
        <span>{item.content.filter((part:any) => part.type === 'text').map((part:any) => part.text).join('\n') || '附件消息'}</span>
        <button type="button" disabled={Boolean(busy)} onClick={() => {setEditing(item.id);setText(item.content.filter((part:any) => part.type === 'text').map((part:any) => part.text).join('\n'));}}>编辑消息</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void update(item.id,{kind:'remove'})}>移除消息</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void update(item.id,{kind:'steer'})}>现在处理</button>
      </>}
    </div>)}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function DshComposer(props: {
  sessionId: string; value: string; inputRef: MutableRefObject<ComposerHandle | null>;
  onChange(value: string, caret: number): void; onSelect(value: string, caret: number): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void; onContextMenu(event: MouseEvent<HTMLElement>): void;
  onPaste(event: ClipboardEvent<HTMLElement>): void;
  onCompositionStart(): void; onCompositionEnd(): void;
}) {
  const [draft, setDraft] = useState<DshDraftEditor>();
  const [empty, setEmpty] = useState(true);
  const [inputState, setInputState] = useState<InputState>();
  const [inputNotice, setInputNotice] = useState<{level:'info'|'error';text:string;seq:number}|null>(null);
  const [uploadRevision, setUploadRevision] = useState(0);
  const [block, setBlock] = useState<{reason:string}>();
  const frozen = inputState?.phase === 'adjudicating' || inputState?.phase === 'submitting';
  const rootRef = useRef<HTMLDivElement>(null); const current = useRef(props); current.current = props;
  const emitted = useRef<string | undefined>(undefined); const adopted = useRef(false);
  useEffect(() => {
    let alive = true; let initializing = false; let editor: DshDraftEditor | undefined; let off = () => {}; let offState = () => {}; let offNotice = () => {}; let offUploads = () => {}; let offBlock = () => {};
    let previous = '';
    const publish = () => {
      if (!alive || !editor) return;
      const p = editor.projection;
      setEmpty(p.clipboardText === '');
      if (p.clipboardText !== current.current.value) {
        emitted.current = p.clipboardText;
        current.current.onChange(p.clipboardText, editor.handle.selectionStart);
      }
      const key = JSON.stringify([p.detectText, p.caret, p.selection]);
      if (key !== previous && !editor.editor.isComposing() && p.selection?.start === p.selection?.end) {
        previous = key; current.current.onSelect(p.clipboardText, editor.handle.selectionStart);
      }
    };
    const initialize = () => {
      if (!alive || editor || initializing) return;
      initializing = true;
      try { editor = clientHost().mountInputEditor(props.sessionId, current.current.value); }
      catch { return; } // 等父组件登记真实会话，不能用空会话替身。
      finally { initializing = false; }
      off = editor.subscribe(publish);
      const input = clientHost().sessionInput((clientHost().ctx as any).sessions.scope(props.sessionId));
      const updateState = () => { setInputState(input.state.getSnapshot()); };
      const updateNotice = () => { setInputNotice(input.notices.getSnapshot()); };
      offState = input.state.subscribe(updateState); offNotice = input.notices.subscribe(updateNotice);
      const blocks = clientHost().conversation.blocks.storeFor(props.sessionId);
      const updateBlock = () => setBlock(blocks.getSnapshot()); offBlock = blocks.subscribe(updateBlock); updateBlock();
      offUploads = clientHost().conversation.fileUploads.subscribe(() => setUploadRevision(value => value + 1));
      updateState(); updateNotice();
      current.current.inputRef.current = editor.handle;
      emitted.current = editor.projection.clipboardText;
      current.current.onChange(editor.projection.clipboardText, editor.handle.selectionStart);
      setDraft(editor); setEmpty(editor.projection.clipboardText === '');
    };
    const offHost = clientHost().subscribe(initialize);
    queueMicrotask(initialize);
    const save = () => editor?.flush(); window.addEventListener('beforeunload', save); window.addEventListener('pagehide', save);
    return () => {
      alive = false; off(); offState(); offNotice(); offUploads(); offBlock(); offHost(); save(); clientHost().unmountInputEditor(props.sessionId);
      if (current.current.inputRef.current === editor?.handle) current.current.inputRef.current = null;
      window.removeEventListener('beforeunload', save); window.removeEventListener('pagehide', save);
    };
  }, [props.sessionId]);
  useLayoutEffect(() => {
    if (!draft || !rootRef.current) return;
    draft.editor.setRootElement(rootRef.current);
    const off = draft.editor.registerCommand(KEY_DOWN_COMMAND, event => event.defaultPrevented, COMMAND_PRIORITY_CRITICAL);
    const offPaste = draft.editor.registerCommand(PASTE_COMMAND, event => Boolean(event?.defaultPrevented), COMMAND_PRIORITY_CRITICAL);
    return () => { off(); offPaste(); draft.editor.setRootElement(null); };
  }, [draft]);
  useLayoutEffect(() => { if (draft) draft.editor.setEditable(!frozen && !block); }, [draft, frozen, block]);
  useLayoutEffect(() => {
    if (!draft) return;
    if (!adopted.current) {
      if (props.value === emitted.current) adopted.current = true;
      else return;
    }
    if (props.value !== draft.projection.clipboardText) {
      if (props.value === '') draft.clearCommitted(); else draft.adoptProjection(props.value);
    }
  }, [props.value, draft]);
  const draftFiles = clientHost().conversation.resolveDraftAttachments(inputState?.attachmentIds ?? []);
  const uploads = clientHost().conversation.fileUploads.getSnapshot(); void uploadRevision;
  return <div className="dsh-composer">
    <style>{draftEditorStyles}</style>
    <DshInputQueue key={props.sessionId} sessionId={props.sessionId} items={inputState?.queue ?? []} />
    {draftFiles.length > 0 && <div className="dsh-browser-attachment-rail" aria-label="插件添加的附件">
      {draftFiles.map(file => <span className="attachment-chip" key={file.id}>
        {file.kind === 'image' && <img src={file.previewUrl} alt={file.file.name || '附件图片'} width={42} height={42} />}
        <span>{file.file.name || '未命名附件'}</span>
        {file.kind === 'file' && <span role="status">{uploads[file.id]?.status === 'ready' ? '已上传' : uploads[file.id]?.status === 'error' ? '上传失败' : '正在上传'}</span>}
        {uploads[file.id]?.status === 'error' && <button type="button" disabled={frozen} onClick={() => clientHost().conversation.retryFileUpload(props.sessionId, file.id)}>重新上传</button>}
        <button type="button" disabled={frozen} aria-label={`移除插件附件 ${file.file.name}`} onClick={() => {
          const input = clientHost().sessionInput((clientHost().ctx as any).sessions.scope(props.sessionId));
          if (input.removeAttachment(file.id)) clientHost().conversation.releaseDraftAttachment(file.id);
        }}>移除</button>
      </span>)}
    </div>}
    {block && <p className="dsh-composer-notice" role="status">{block.reason}</p>}
    {inputNotice && <p className="dsh-composer-notice" role={inputNotice.level === 'error' ? 'alert' : 'status'} key={inputNotice.seq}>{inputNotice.text}</p>}
    {frozen && <button type="button" onClick={() => clientHost().cancelPublicInput(props.sessionId)}>取消插件输入</button>}
    <div className="dsh-composer-surface">
      <div ref={rootRef} className="dsh-composer-input" role="textbox" aria-label="描述要完成的工作" aria-multiline="true"
        aria-busy={!draft || frozen || undefined} data-placeholder="描述要完成的工作" data-dsh-composer
        contentEditable={Boolean(draft) && !frozen && !block} suppressContentEditableWarning lang="zh-CN" spellCheck={false}
        onKeyDownCapture={props.onKeyDown} onContextMenu={props.onContextMenu}
        onPasteCapture={event => { props.onPaste(event); if (!event.defaultPrevented && draft) {
          const text = event.clipboardData.getData('text/plain'); if (text) { event.preventDefault(); draft.runtime.paste(text); }
        } }} onCompositionStart={props.onCompositionStart} onCompositionEnd={props.onCompositionEnd} />
      {empty && <span className="dsh-composer-placeholder" aria-hidden>描述要完成的工作</span>}
      <DecoratorPortals editor={draft?.editor || null} />
    </div>
    {clientHost().inputEditorError(props.sessionId) && <p className="dsh-composer-error" role="alert">{clientHost().inputEditorError(props.sessionId)}</p>}
  </div>;
}
