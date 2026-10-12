import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

export function FileTextEditor({ value, name, wrap, readOnly = false, onChange, onSave }: { value: string; name: string; wrap: boolean; readOnly?: boolean; onChange?: (value: string) => void; onSave?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const wrapping = useRef(new Compartment());
  const callbacks = useRef({ onChange, onSave }); callbacks.current = { onChange, onSave };
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({ parent: host.current, state: EditorState.create({ doc: value, extensions: [
      lineNumbers(), history(), EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
      EditorView.contentAttributes.of({ 'aria-label': `${readOnly ? '预览' : '编辑'} ${name}`, spellcheck: 'false' }),
      wrapping.current.of(wrap ? EditorView.lineWrapping : []),
      keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave?.(); return true; } }, ...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of(update => { if (update.docChanged) callbacks.current.onChange?.(update.state.doc.toString()); }),
    ] }) });
    view.current = editor;
    return () => { view.current = null; editor.destroy(); };
    // 文件切换使用 key 重挂载，编辑回调使用最新引用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, readOnly]);
  useEffect(() => { view.current?.dispatch({ effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []) }); }, [wrap]);
  useEffect(() => {
    const editor = view.current;
    if (editor && value !== editor.state.doc.toString()) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  return <div className="file-text-editor" ref={host} />;
}
