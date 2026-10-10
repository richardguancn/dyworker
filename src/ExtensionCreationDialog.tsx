import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, X } from 'lucide-react';
import type { AuthoringKind } from '../electron/authoring-skills';

export interface ExtensionCreationRequest {
  kind: AuthoringKind;
  requirement: string;
  workspacePath: string;
}

export function ExtensionCreationDialog({ kind, workspacePath, onClose, onPrepare }: {
  kind: AuthoringKind;
  workspacePath: string;
  onClose: () => void;
  onPrepare: (request: ExtensionCreationRequest) => void;
}) {
  const [requirement, setRequirement] = useState('');
  const [directory, setDirectory] = useState(workspacePath);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef(onClose);
  const choosingRef = useRef(choosing);
  closeRef.current = onClose;
  choosingRef.current = choosing;
  const kindName = kind === 'plugin' ? '插件' : '技能';
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !choosingRef.current) { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const controls = Array.from(inputRef.current?.closest('form')?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea') || []);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); previous?.focus(); };
  }, []);

  const chooseFolder = async () => {
    setError('');
    if (!window.dyworker?.chooseWorkspace) { setError('请在桌面应用中选择工作文件夹。'); return; }
    setChoosing(true);
    try {
      const picked = await window.dyworker.chooseWorkspace();
      if (!picked.canceled && picked.path) setDirectory(picked.path);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setChoosing(false); }
  };

  return createPortal(<div className="dialog-overlay extension-creation-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !choosing) onClose(); }}>
    <form className="extension-creation-dialog" role="dialog" aria-modal="true" aria-label={`创建${kindName}`} onSubmit={event => {
      event.preventDefault();
      if (!requirement.trim()) { setError(`请描述希望${kindName}完成什么工作。`); inputRef.current?.focus(); return; }
      if (kind === 'plugin' && !directory.trim()) { setError('请先选择保存插件的工作文件夹。'); return; }
      onPrepare({ kind, requirement: requirement.trim(), workspacePath: directory });
    }}>
      <div className="extension-creation-heading"><h3>创建{kindName}</h3><button type="button" className="icon-button subtle" onClick={onClose} disabled={choosing} aria-label="关闭制作窗口"><X size={16} /></button></div>
      <p className="dialog-note">{kind === 'plugin' ? '描述想增加的功能，内置制作技能会帮助生成插件文件并检查。' : '描述需要重复完成的工作，内置制作技能会帮助整理并保存为可复用技能。'}</p>
      <label className="skill-draft-field"><span>制作需求</span><textarea ref={inputRef} rows={6} value={requirement} onChange={event => { setRequirement(event.target.value); setError(''); }} placeholder={kind === 'plugin' ? '例如：增加一个工具，检查文件夹中的文件名是否符合命名规则，并列出需要修改的文件。' : '例如：每周读取工作记录，按完成事项、遇到的问题和下周计划整理周报。'} /></label>
      <div className="extension-creation-folder"><div><strong>工作文件夹{kind === 'skill' ? '（可选）' : ''}</strong><small>{directory || (kind === 'skill' ? '简单技能可直接保存到技能列表' : '用于保存制作出的插件文件')}</small></div><button type="button" className="button-secondary" onClick={() => void chooseFolder()} disabled={choosing}><FolderOpen size={14} />{choosing ? '选择中…' : '选择文件夹'}</button></div>
      <p className="dialog-note">将在新对话中准备制作需求，发送后开始。制作使用你已配置的模型。</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="skill-draft-actions"><button type="button" className="button-secondary" onClick={onClose} disabled={choosing}>取消</button><button type="submit" className="button-primary" disabled={choosing}>进入制作对话</button></div>
    </form>
  </div>, document.body);
}
