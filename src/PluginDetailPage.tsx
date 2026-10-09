import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, AlertTriangle, ExternalLink, Loader2, Puzzle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CatalogPlugin } from './pluginCatalog';
import {BUILTIN_PLUGIN_LABELS} from './pluginLabels';
import type { PluginCompatibility, PluginDetailRecord, PluginEntryRecord, PluginBundleRecord } from './types';

export function pluginStateLabel(entry: PluginEntryRecord) {
  return entry.disabled ? '已停用' : entry.active ? '已启动' : entry.state === 'session-required' ? '用于 DSH 插件会话'
    : entry.state === 'loading' ? '启动中' : entry.state === 'stopping' ? '正在停用' : entry.state === 'failed' ? '启动失败' : '等待所需能力';
}

/** 插件提供的链接与说明均作为资料展示，不执行 HTML，也不自动加载图片。 */
export function pluginDocumentLink(value: string) {
  try {
    const url = new URL(value.replace(/^git\+https:/, 'https:'));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

type Props = {
  entry?: PluginEntryRecord; bundle?: PluginBundleRecord; catalog?: CatalogPlugin;
  busy: boolean; error: string; notice: string; configuration?: ReactNode;
  onBack: () => void; onToggle: () => void; onUninstall: () => void; onInstall: () => void; onLoadClient: () => void;
  clientResult?: string; refreshKey: number;
};

export function PluginDetailPage({ entry, bundle, catalog, busy, error, notice, configuration, onBack, onToggle,
  onUninstall, onInstall, onLoadClient, clientResult, refreshKey }: Props) {
  const [detail, setDetail] = useState<PluginDetailRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [compatibility, setCompatibility] = useState<PluginCompatibility | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const checkGeneration = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [entry?.id, catalog?.id]);
  useEffect(() => {
    let current = true;
    setDetail(null); setDetailError(''); setCompatibility(null); setCheckError(''); setChecking(false); checkGeneration.current++;
    if (!entry) { setLoading(false); return; }
    if (!window.dyworker?.pluginDetails) { setLoading(false); setDetailError('当前环境没有插件资料读取入口'); return; }
    setLoading(true);
    void window.dyworker.pluginDetails(entry.id).then(value => { if (current) setDetail(value); })
      .catch(error => { if (current) setDetailError(String(error?.message || error)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; checkGeneration.current++; };
  }, [entry?.id, refreshKey]);
  const check = async () => {
    if (!entry || entry.builtin || checking || busy) return;
    if (!window.dyworker?.checkPluginCompatibility) { setCheckError('当前环境没有兼容检查入口'); return; }
    const generation = ++checkGeneration.current;
    setChecking(true); setCheckError(''); setCompatibility(null);
    try {
      const value = await window.dyworker.checkPluginCompatibility(bundle?.packageName || entry.name);
      if (checkGeneration.current === generation) setCompatibility(value);
    } catch (error: any) { if (checkGeneration.current === generation) setCheckError(String(error?.message || error)); }
    finally { if (checkGeneration.current === generation) setChecking(false); }
  };
  const metadata = detail?.metadata;
  const builtin=entry?.builtin?BUILTIN_PLUGIN_LABELS[entry.name]:undefined;
  const title = builtin?.name||catalog?.displayName || entry?.id || '插件详情';
  const version = metadata?.version || bundle?.version;
  const client = bundle?.client || entry?.client;
  const source = bundle?.source;
  const links = [metadata?.homepage ? { label: '项目主页', url: pluginDocumentLink(metadata.homepage) } : null,
    metadata?.repository ? { label: '源码仓库', url: pluginDocumentLink(metadata.repository) } : null,
    catalog ? { label: '市场来源', url: `https://github.com/${catalog.repo}` } : null].filter(Boolean);
  return <section className="plugins-page plugin-detail-page" aria-label="插件详情">
    <button className="plugins-text-button plugin-detail-back" onClick={onBack}><ArrowLeft size={15} /> 返回插件列表</button>
    <header className="plugin-detail-header">
      <div className="plugin-detail-icon"><Puzzle size={27} /></div>
      <div className="plugin-detail-heading"><h1 ref={heading} tabIndex={-1}>{title}</h1>
        <div className="plugin-detail-tags">{version && <span className="plugin-tag">v{version}</span>}
          <span className="plugin-tag">{entry ? pluginStateLabel(entry) : '尚未安装'}</span>
          {entry?.builtin && <span className="plugin-tag">内置</span>}{catalog && <span className="plugin-tag">{catalog.category}</span>}</div>
      </div>
      <div className="plugin-detail-actions">{entry ? <>
        <button className="plugins-add-button" disabled={busy || checking} onClick={onToggle}>{entry.disabled ? '启用插件' : '停用插件'}</button>
        {!entry.builtin && <button className="plugins-text-button danger" disabled={busy || checking} onClick={onUninstall}>卸载插件</button>}
      </> : <button className="plugins-add-button" disabled={busy} onClick={onInstall}>安装插件</button>}</div>
    </header>
    <p className="plugin-detail-description">{builtin?.summary||catalog?.summary || metadata?.description || bundle?.description || entry?.description || '插件未提供说明。'}</p>
    {catalog&&entry&&!entry.builtin&&version!==catalog.support.version&&<div className="plugins-message warn">当前安装的版本不在已验证清单中。<button className="plugins-text-button" disabled={busy} onClick={onInstall}>安装已验证版本</button></div>}
    {error || detailError ? <div className="plugins-message bad" role="alert"><AlertTriangle size={14} /> {error || detailError}</div> : notice ? <div className="plugins-message ok" role="status">{notice}</div> : null}
    {entry?.error && <div className="plugins-message bad" role="alert">{entry.error}</div>}
    {bundle?.drift && <div className="plugins-message warn">版本与安装记录不一致：{bundle.drift}</div>}
    <section className="plugin-detail-section"><h2>使用方式</h2>
      {entry?.state === 'session-required' ? <p>在任务中选择“DSH 插件会话”使用。会话中的设置单独保存。</p>
        : entry?.disabled ? <p>插件已停用。启用后可在适用的任务中使用。</p>
        : entry ? <p>{entry.active ? '插件已启动，可在适用的任务中使用。' : '插件尚未启动，请查看上方状态和原因。'}</p>
        : <p>安装时会检查所选版本是否可用。</p>}
      {catalog?.support && <p>已验证 {catalog.support.version}（DYWorker {catalog.support.hostVersion}，{catalog.support.date}）：{catalog.support.scope}。此结论仅适用于记录的版本和范围。</p>}
      {client && <p>提供界面，适用平台：{client.platform || 'web'}。</p>}
      {client && entry && <button className="plugins-text-button" disabled={busy || entry.disabled} onClick={onLoadClient}>重新加载插件界面</button>}
      {clientResult && <p role="status">{clientResult}</p>}
    </section>
    <section className="plugin-detail-section"><h2>兼容情况</h2>
      {entry?.builtin ? <p>此插件随应用提供。其状态以上方实际运行结果为准。</p> : entry ? <>
        <p>检查会在临时目录实际启动插件。检查通过仅说明当前已提供的能力可用，使用中的操作仍按任务权限执行。</p>
        <button className="plugins-text-button" disabled={checking || busy} onClick={() => void check()}>{checking && <Loader2 size={13} className="spin" />}{checking ? '正在检查' : '检查当前版本'}</button>
      </> : <p>尚未检查当前安装版本。安装前会展示检查结果。</p>}
      {checkError && <p className="plugin-row-error" role="alert">{checkError}</p>}
      {compatibility && <div className="plugin-detail-compatibility"><p><strong>{compatibility.verdict === 'runnable' ? '当前能力检查通过' : compatibility.verdict === 'partial' ? '部分能力尚不匹配' : compatibility.verdict === 'pending' ? '尚未下载检查' : '当前无法运行'}</strong>
        {compatibility.runtime === 'dsh-session' && ' · 使用 DSH 插件会话'}</p>
        <ul>{compatibility.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
        {compatibility.services.length > 0 && <div className="plugin-detail-table"><table><thead><tr><th>所需能力</th><th>检查结果</th><th>说明</th></tr></thead><tbody>
          {compatibility.services.map(service => <tr key={service.name}><td>{service.name}</td><td>{service.state === 'fulfilled' ? '已提供' : service.state === 'name-only' ? '尚不完全匹配' : '未提供'}</td><td>{service.reason}</td></tr>)}</tbody></table></div>}
      </div>}
      {entry?.missingServices?.length ? <p>当前等待：{entry.missingServices.join('、')}</p> : null}
    </section>
    {entry && <section className="plugin-detail-section"><h2>设置</h2>{configuration}</section>}
    <section className="plugin-detail-section"><h2>插件资料</h2>
      {loading && <p role="status">正在读取已安装插件的资料…</p>}
      {detail?.metadataError && <p className="plugin-row-error">部分资料无法读取：{detail.metadataError}</p>}
      <dl className="plugin-detail-facts"><dt>包名</dt><dd>{metadata?.name || bundle?.packageName || entry?.name || catalog?.packageName || '未提供'}</dd>
        <dt>作者</dt><dd>{metadata?.author || '未提供'}</dd><dt>许可证</dt><dd>{metadata?.license || '未提供'}</dd>
        <dt>来源</dt><dd>{entry?.builtin ? '随应用提供' : source?.input || source?.source || catalog?.install || (entry ? '本地插件清单' : '未提供')}</dd>
        {catalog && <><dt>验证记录</dt><dd>{catalog.support.date} · v{catalog.support.version}</dd></>}</dl>
      <div className="plugin-detail-links">{links.map((link: any) => link.url ? <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer">{link.label}<ExternalLink size={12} /></a> : <span key={link.label}>{link.label}未提供可打开的安全地址</span>)}</div>
      {metadata?.engines.length ? <p>声明的运行要求：{metadata.engines.map(item => `${item.name} ${item.version}`).join('；')}</p> : null}
      {(metadata?.dependencies.length || metadata?.peerDependencies.length || client?.inject?.length) ? <details className="plugin-detail-dependencies"><summary>查看声明的依赖</summary>
        <p>以下内容来自插件声明，不能代替实际兼容检查。</p>
        {client?.inject?.length ? <p>界面所需能力：{client.inject.join('、')}</p> : null}
        {metadata?.dependencies.map(item => <p key={item.name}>{item.name}：{item.version}</p>)}
        {metadata?.peerDependencies.map(item => <p key={`peer:${item.name}`}>{item.name}：{item.version}（共同依赖）</p>)}</details> : null}
    </section>
    <section className="plugin-detail-section"><h2>插件说明</h2>
      {detail?.readme ? <div className="plugin-detail-readme"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={value => pluginDocumentLink(value) || ''}
        components={{ img: () => <span>（说明中的图片未自动加载）</span>, a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span> }}>{detail.readme}</ReactMarkdown>
        {detail.readmeTruncated && <p>说明较长，仅显示前 64 KB。完整说明请查看插件主页。</p>}</div>
        : <p>{entry ? '已安装的插件包未提供可展示的说明。' : '安装后可读取包内说明，也可以查看上方市场来源。'}</p>}
    </section>
  </section>;
}
