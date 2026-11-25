import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, X } from 'lucide-react';
import type { AuthoringKind } from '../electron/authoring-skills';
import { CREATION_MODE_EXAMPLES } from './lib/creationExamples';

export type ExtensionCreationPlacement = "auto" | "workspace.page" | "sidebar.right.pane.tab" | "tools";

export interface ExtensionCreationRequest {
  kind: AuthoringKind;
  requirement: string;
  workspacePath: string;
  placement?: ExtensionCreationPlacement;
}

const PLACEMENT_OPTIONS: Array<{ value: ExtensionCreationPlacement; label: string }> = [
  { value: "auto", label: "让助手决定（推荐）" },
  { value: "workspace.page", label: "左侧独立页面" },
  { value: "sidebar.right.pane.tab", label: "右侧随手工具" },
  { value: "tools", label: "仅增强助手能力" },
];

export function ExtensionCreationDialog({ kind, workspacePath, onClose, onPrepare }: {
  kind: AuthoringKind;
  workspacePath: string;
  onClose: () => void;
  onPrepare: (request: ExtensionCreationRequest) => void;
}) {
  const [requirement, setRequirement] = useState('');
  const [placement, setPlacement] = useState<ExtensionCreationPlacement>('auto');
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
      onPrepare({ kind, requirement: requirement.trim(), workspacePath: directory, ...(kind === 'plugin' ? { placement } : {}) });
    }}>
      <div className="extension-creation-heading"><h3>创建{kindName}</h3><button type="button" className="icon-button subtle" onClick={onClose} disabled={choosing} aria-label="关闭制作窗口"><X size={16} /></button></div>
      <p className="dialog-note">{kind === 'plugin' ? '用平时的话描述想要什么看板、页面或小工具（也可进对话后直接拖入 Excel/CSV 报表或截图让助手照着做）。' : '描述需要重复完成的工作，内置制作技能会帮助整理并保存为可复用技能。'}</p>
      <label className="skill-draft-field"><span>制作需求</span><textarea ref={inputRef} rows={6} value={requirement} onChange={event => { setRequirement(event.target.value); setError(''); }} placeholder={kind === 'plugin' ? '例如：我每周从系统导出 Excel 报表，帮我做一个能看核心数字、对比上周涨跌和画近几周趋势图的独立看板页面。' : '例如：每周读取工作记录，按完成事项、遇到的问题和下周计划整理周报。'} /></label>
      {kind === 'plugin' && (
        <>
          <div className="creation-dialog-placement" role="group" aria-label="希望放置位置">
            <span className="creation-dialog-placement-label">希望放在哪里：</span>
            <div className="creation-dialog-placement-options">
              {PLACEMENT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={placement === option.value}
                  className={`creation-dialog-place-btn${placement === option.value ? " active" : ""}`}
                  disabled={choosing}
                  onClick={() => setPlacement(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="creation-dialog-examples" aria-label="快速灵感示例">
          <span className="creation-dialog-examples-label">示例模板：</span>
          {CREATION_MODE_EXAMPLES.slice(0, 4).map((example) => (
            <button
              key={example.id}
              type="button"
              className="creation-dialog-chip"
              disabled={choosing}
              onClick={() => {
                setRequirement(example.prompt);
                setError('');
                window.setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              <span>{example.title}</span>
              <small>{example.slotLabel}</small>
            </button>
          ))}
        </div>
        </>
      )}
      <div className="extension-creation-folder"><div><strong>工作文件夹（可选）</strong><small>{directory || (kind === 'skill' ? '简单技能可直接保存到技能列表' : '未选择时自动保存在应用受管插件目录')}</small></div><button type="button" className="button-secondary" onClick={() => void chooseFolder()} disabled={choosing}><FolderOpen size={14} />{choosing ? '选择中…' : '选择文件夹'}</button></div>
      <p className="dialog-note">将在新对话中准备制作需求，发送后开始。制作使用你已配置的模型。</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="skill-draft-actions"><button type="button" className="button-secondary" onClick={onClose} disabled={choosing}>取消</button><button type="submit" className="button-primary" disabled={choosing}>进入制作对话</button></div>
    </form>
  </div>, document.body);
}
