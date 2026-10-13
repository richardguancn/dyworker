import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, X } from 'lucide-react';
import {
  findReasoningOverride, getModelReasoningConfig, selectedReasoningEffort,
} from '../electron/model-reasoning.ts';
import type { ReasoningKind, ReasoningOverride } from '../electron/model-reasoning.ts';
import './reasoningControl.css';

const kindNames: Record<ReasoningKind, string> = {
  standard: '通用兼容方式', deepseek: 'DeepSeek 方式', kimi: 'Kimi 方式', glm: '智谱 GLM 方式',
  qwen: '千问百炼方式', 'qwen-local': '千问本地部署方式', minimax: 'MiniMax 方式', doubao: '豆包方式',
};

export function ReasoningControl({ endpoint, model, effort, overrides, onChange, onConfigure }: {
  endpoint: string; model: string; effort?: string; overrides?: ReasoningOverride[];
  onChange: (effort: string) => void;
  onConfigure: (override: ReasoningOverride | null) => Promise<boolean>;
}) {
  const [managing, setManaging] = useState(false);
  const config = getModelReasoningConfig({ endpoint, model, overrides });
  const selected = selectedReasoningEffort(config, effort);
  // 没有配置默认档位时补一个「默认」选项，表示交回模型自己决定
  const options = [
    ...(!config.defaultEffort ? [{ value: '', label: '默认' }] : []),
    ...config.efforts.map(value => ({ value, label: config.labels[value] || value })),
  ];
  return <>
    <div className="model-menu-effort">
      <div className="model-menu-effort-head">
        <span>思考</span>
        <button type="button" className="effort-manage" onClick={() => setManaging(true)}>管理档位…</button>
      </div>
      {config.efforts.length ? (
        <div className="effort-segmented" role="radiogroup" aria-label="思考强度" title={config.description}>
          {options.map(option => {
            const active = option.value === selected;
            return <button key={option.value || ':default:'} type="button" role="radio" aria-checked={active}
              className={active ? 'active' : ''} onClick={() => onChange(option.value)}>{option.label}</button>;
          })}
        </div>
      ) : (
        <p className="model-menu-hint effort-empty">{config.description}</p>
      )}
    </div>
    {managing && <ReasoningManager key={`${endpoint}\n${model}`} endpoint={endpoint} model={model}
      overrides={overrides} onClose={() => setManaging(false)} onSave={onConfigure} />}
  </>;
}

function ReasoningManager({ endpoint, model, overrides, onClose, onSave }: {
  endpoint: string; model: string; overrides?: ReasoningOverride[]; onClose: () => void;
  onSave: (override: ReasoningOverride | null) => Promise<boolean>;
}) {
  const config = getModelReasoningConfig({ endpoint, model, overrides });
  const saved = findReasoningOverride(overrides, endpoint, model);
  const [options, setOptions] = useState<ReasoningOverride['options']>(() => saved?.options
    || config.efforts.map(value => ({ value, label: config.labels[value] || value })));
  const [kind, setKind] = useState<ReasoningKind>(config.kind);
  const [defaultEffort, setDefaultEffort] = useState(config.defaultEffort);
  const [disabled, setDisabled] = useState(Boolean(saved && !saved.options.length));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);

  const persist = async (override: ReasoningOverride | null) => {
    setSaving(true);
    setError('');
    try {
      if (await onSave(override)) onClose();
      else setError('保存失败，修改已保留在此窗口，请重试。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
    } finally { setSaving(false); }
  };
  const submit = () => {
    const trimmed = options.map(option => ({ value: option.value.trim(), label: option.label.trim() }));
    if (!disabled) {
      if (!trimmed.length) { setError('请添加至少一个档位，或勾选“不支持调整思考强度”。'); return; }
      if (trimmed.some(option => !option.label || option.label.length > 80)) { setError('请为每个档位填写名称，最多 80 个字。'); return; }
      if (trimmed.some(option => !/^[a-zA-Z0-9_.-]{1,80}$/.test(option.value))) {
        setError('请按服务说明填写档位值，只能使用英文字母、数字、点、下划线或短横线，最多 80 个字符。'); return;
      }
      if (new Set(trimmed.map(option => option.value)).size !== trimmed.length) { setError('档位值不能重复，请修改或删除重复的档位。'); return; }
    }
    void persist({ endpoint, model, kind, options: disabled ? [] : trimmed,
      defaultEffort: !disabled && trimmed.some(option => option.value === defaultEffort.trim()) ? defaultEffort.trim() : '' });
  };

  return createPortal(<dialog ref={dialogRef} className="reasoning-manager" aria-labelledby="reasoning-manager-title"
    onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !saving) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    } }}>
    <form onSubmit={event => { event.preventDefault(); submit(); }}>
      <header><h2 id="reasoning-manager-title">管理思考档位</h2>
        <button type="button" className="reasoning-icon-button" aria-label="关闭档位管理" disabled={saving} onClick={onClose}><X size={18} /></button>
      </header>
      <p className="reasoning-model-name" title={model}>{model}</p>
      <p className="reasoning-endpoint">{endpoint}</p>
      <p className="reasoning-help">仅应用于这个接入地址和模型。请按服务说明填写支持的档位；留在“默认”时由模型决定。</p>
      <fieldset disabled={saving}>
        <label className="reasoning-disabled"><input type="checkbox" checked={disabled} onChange={event => { setDisabled(event.target.checked); setError(''); }} />不支持调整思考强度</label>
        {!disabled && <>
          <div className="reasoning-option-head" aria-hidden="true"><span>显示名称</span><span>服务要求的档位值</span><span /></div>
          <div className="reasoning-options">
            {options.map((option, index) => <div className="reasoning-option-row" key={index}>
              <input aria-label={`档位 ${index + 1} 名称`} value={option.label} maxLength={80} placeholder="例如：最高"
                onChange={event => { setOptions(items => items.map((item, i) => i === index ? { ...item, label: event.target.value } : item)); setError(''); }} />
              <input aria-label={`档位 ${index + 1} 值`} value={option.value} maxLength={80} placeholder="例如：max" list="reasoning-value-suggestions"
                onChange={event => {
                  const value = event.target.value;
                  setOptions(items => items.map((item, i) => i === index ? { ...item, value } : item));
                  if (defaultEffort && defaultEffort === option.value.trim()) setDefaultEffort(value.trim());
                  setError('');
                }} />
              <button type="button" className="reasoning-icon-button" aria-label={`删除档位 ${index + 1}`} onClick={() => {
                setOptions(items => items.filter((_, i) => i !== index));
                if (defaultEffort === option.value.trim()) setDefaultEffort('');
                setError('');
              }}><Trash2 size={16} /></button>
            </div>)}
          </div>
          {!options.length && <p className="reasoning-help">尚未配置档位。添加后，输入框下方会显示你填写的选项。</p>}
          <datalist id="reasoning-value-suggestions">{['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'off', 'on', 'auto', 'adaptive'].map(value => <option key={value} value={value} />)}</datalist>
          <button type="button" className="reasoning-add" disabled={options.length >= 32} onClick={() => { setOptions(items => [...items, { value: '', label: '' }]); setError(''); }}><Plus size={15} />添加档位</button>
          <label className="reasoning-default">默认选择
            <select value={defaultEffort} onChange={event => setDefaultEffort(event.target.value)}>
              <option value="">默认（由模型决定）</option>
              {options.filter(option => option.value.trim() && option.label.trim()).map((option, index) => <option key={index} value={option.value.trim()}>{option.label}</option>)}
            </select>
          </label>
          <details className="reasoning-advanced"><summary>接入方式</summary>
            <label>按模型服务说明选择
              <select value={kind} onChange={event => setKind(event.target.value as ReasoningKind)}>
                {Object.entries(kindNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
              </select>
            </label>
            <p className="reasoning-help">转接服务可能使用不同方式。关闭、开启可填写 off、on；其他值按服务说明填写。这里保存的是你的配置，不代表已确认服务支持。</p>
          </details>
        </>}
      </fieldset>
      {error && <p className="reasoning-error" role="alert">{error}</p>}
      <footer>
        {saved && <button type="button" className="reasoning-reset" disabled={saving} onClick={() => void persist(null)}>恢复自动识别</button>}
        <span />
        <button type="button" disabled={saving} onClick={onClose}>取消</button>
        <button type="submit" className="reasoning-save" disabled={saving}>{saving ? '保存中…' : '保存'}</button>
      </footer>
    </form>
  </dialog>, document.body);
}
