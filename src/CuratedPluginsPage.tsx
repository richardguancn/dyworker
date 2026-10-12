import { useCallback, useEffect, useRef, useState } from 'react';
import { Puzzle, RefreshCw, Search } from 'lucide-react';
import type { CuratedPluginRecord } from './types';

export function CuratedPluginsPage({ onSkillsChanged }: { onSkillsChanged?: () => void }) {
  const [plugins, setPlugins] = useState<CuratedPluginRecord[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const mutation = useRef(false);
  const bridge = window.dyworker;
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      if (!bridge?.listCuratedPlugins) throw new Error('请使用桌面应用查看内置插件');
      const rows = await bridge.listCuratedPlugins();
      if (current === generation.current) { setPlugins(rows); setError(''); }
    } catch (cause) {
      if (current === generation.current) setError(String(cause instanceof Error ? cause.message : cause));
    } finally { if (current === generation.current) setLoading(false); }
  }, [bridge]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);

  async function toggle(plugin: CuratedPluginRecord) {
    if (!bridge || mutation.current) return;
    mutation.current = true;
    setBusy(plugin.id); setError('');
    try {
      const result = await bridge.setCuratedPluginEnabled(plugin.id, !plugin.enabled);
      if (!result.ok) throw new Error(result.error || '设置未保存');
      await refresh();
      onSkillsChanged?.();
    } catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)); }
    finally { mutation.current = false; setBusy(''); }
  }
  const needle = query.trim().toLowerCase();
  const shown = plugins.filter(plugin => [plugin.name, plugin.originalName, plugin.id, plugin.summary,
    ...plugin.skills.map(skill => `${skill.name} ${skill.description}`)].join(' ').toLowerCase().includes(needle));
  return <section className="curated-plugins">
    <header className="plugins-page-header"><div className="plugins-page-heading"><h1>内置精选</h1><p>随应用提供的 OpenAI 插件内容，启用后可在适用任务中使用。</p></div>
      <button className="plugins-text-button" disabled={loading || Boolean(busy)} onClick={() => void refresh()}><RefreshCw size={14} />刷新</button></header>
    <div className="plugins-list-toolbar"><label className="plugins-market-search"><Search size={15} />
      <input aria-label="搜索内置插件" placeholder="搜索插件名称或工作方法" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <span className="plugins-catalog-status" role="status">{loading ? '正在读取…' : `${plugins.length} 种插件 · ${plugins.reduce((count, plugin) => count + plugin.skills.length, 0)} 个工作方法`}</span></div>
    {error && <p className="plugin-row-error" role="alert">{error}</p>}
    <p className="plugins-catalog-notice">内置工作方法可直接启用。“制作插件”和“管理插件”适用于 DYWorker 本地插件，无需连接账号服务。</p>
    {shown.map(plugin => <article className="plugin-card" key={plugin.id} data-curated-plugin={plugin.id}>
      <div className="plugin-card-icon"><Puzzle size={20} /></div><div className="plugin-card-body">
        <div className="plugin-card-title"><strong>{plugin.name}</strong><span className="plugin-tag">内置</span>
          <span className="plugin-tag">{plugin.local ? plugin.enabled ? '已启用' : '已停用' : '需要连接服务'}</span></div>
        <p className="plugin-card-desc">{plugin.summary}</p>
        <p className="plugin-row-meta">{plugin.originalName} · v{plugin.version} · {plugin.skills.length} 个工作方法</p>
        <details><summary>内容和使用说明</summary><p>{plugin.scope}</p>
          {plugin.connections.length > 0 && <p>原插件涉及的服务：{[...new Set(plugin.connections.map(name => name.startsWith('app-') ? '其他服务' : name))].join('、')}</p>}
          <p>作者：{plugin.author || '原插件作者'} · 许可：{plugin.license}</p>
          {plugin.homepage && <a href={plugin.homepage} target="_blank" rel="noreferrer">查看作者网站</a>}
          <ul>{plugin.skills.map(skill => <li key={skill.id}><strong>{skill.name}</strong><p>{skill.description}</p></li>)}</ul>
          <button className="plugins-text-button" onClick={() => void bridge?.openPath(plugin.directory)}>打开插件资料</button>
        </details>
      </div><button className={`plugin-switch ${plugin.enabled ? 'on' : ''}`} role="switch" aria-checked={plugin.enabled}
        aria-label={`${plugin.enabled ? '停用' : '启用'} ${plugin.name}`} disabled={!plugin.local || Boolean(busy) || loading}
        onClick={() => void toggle(plugin)}><span className="plugin-switch-knob" /></button>
    </article>)}
    {!loading && !shown.length && !error && <p className="plugins-empty">没有找到匹配的插件。</p>}
  </section>;
}
