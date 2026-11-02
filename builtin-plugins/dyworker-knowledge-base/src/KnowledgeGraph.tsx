import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { GraphChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { Search, RefreshCw, RotateCcw, ZoomIn, ZoomOut, Maximize2, X, Network, History, Link2, Unlink, LoaderCircle, Download } from 'lucide-react';

echarts.use([GraphChart, TooltipComponent, CanvasRenderer]);

interface Origin { id: string; name?: string; content: string; originSessionId?: string; createdAt?: string }
interface Node {
  id: string; memoryId?: string; name: string; kind: 'memory' | 'document'; category: string;
  content: string; source: string; scope: string; workspacePath: string; color: string; topicId: string;
  truncated?: boolean; origins: Origin[]; chunks?: number;
}
interface Link { source: string; target: string; kind: 'manual' | 'similar'; label: string; reason?: string }
interface Topic { id: string; label: string; color: string; count: number }
interface Graph { nodes: Node[]; links: Link[]; topics: Topic[] }
interface HistoryRow {
  id: string; createdAt: string; merged: number; canUndo: boolean; undone: boolean; message: string;
  merges: { targetId: string; reason: string; before: Origin[]; after: Origin }[];
  conflicts: { reason: string; memories: Origin[] }[];
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || '操作失败，请稍后重试');
  return data;
}

const styles = `
.kg{color:var(--ink, #353d48);font-size:13px;container-type:inline-size;--kg-border:var(--border, #e8ebef);--kg-muted:var(--muted, #818997);--kg-accent:var(--accent, #2f6fed)}
.kg button,.kg input,.kg select{font:inherit}.kg button{cursor:pointer}.kg button:disabled{cursor:wait;opacity:.5}
.kg button:focus-visible,.kg input:focus-visible,.kg select:focus-visible{outline:2px solid var(--accent, #2f6fed);outline-offset:3px}
.kg-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:16px 18px;border-bottom:1px solid var(--kg-border)}
.kg-search{display:flex;align-items:center;gap:8px;flex:1;min-width:180px;max-width:340px;color:var(--kg-muted);border:1px solid var(--kg-border);border-radius:8px;padding:8px 10px;background:var(--surface, #fafbfc)}
.kg-search input{border:0;outline:none;background:transparent;min-width:0;width:100%;color:var(--ink, #353d48)}
.kg-select{border:1px solid var(--kg-border);border-radius:7px;background:var(--card, white);color:var(--ink, #596271);padding:8px;max-width:210px}
.kg-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--kg-border);border-radius:7px;padding:7px 10px;background:var(--card, white);color:var(--ink, #596271);white-space:nowrap}
.kg-btn:hover{background:var(--sidebar-hover, #f5f8f6);border-color:var(--border-strong, #c3d5cc)}.kg-btn.active{background:var(--sidebar-active, #edf5f0);color:var(--ink, #386852);border-color:var(--border-strong, #bfd6c9)}
.kg-note{padding:10px 18px;background:var(--sidebar-active, #f4f8f5);line-height:1.7;border-bottom:1px solid var(--kg-border)}
.kg-error{color:#a33d37;background:var(--surface, #fff6f4)}.kg-body{display:flex;min-height:590px;position:relative}
.kg-stage{flex:1;min-width:0;position:relative;background:var(--card, #fff)}.kg-canvas{height:clamp(510px,67vh,820px);min-height:510px;width:100%;-webkit-app-region:no-drag;touch-action:none}
.kg-meta{position:absolute;top:17px;left:20px;color:var(--kg-muted);pointer-events:none;font-size:12px;z-index:1}
.kg-tools{position:absolute;left:16px;bottom:17px;display:flex;gap:4px;padding:4px;border:1px solid var(--kg-border);border-radius:8px;background:var(--card, #fff);z-index:1}
.kg-tools button{border:0;padding:7px;background:transparent;color:var(--muted, #687383);border-radius:5px;display:flex}.kg-tools button:hover{background:var(--sidebar-hover, #f0f4f2)}
.kg-hint{position:absolute;right:18px;bottom:26px;color:var(--muted, #99a0aa);font-size:11px;pointer-events:none}
.kg-side{width:292px;flex-shrink:0;border-left:1px solid var(--kg-border);padding:20px;max-height:clamp(590px,75vh,900px);overflow:auto;background:var(--surface, #fcfdfc);box-sizing:border-box}
.kg-side h3{margin:0 0 12px;font-size:15px;line-height:1.6;font-weight:600;overflow-wrap:anywhere}.kg-side h4{font-size:12px;color:var(--muted, #858e9a);font-weight:500;margin:24px 0 10px}
.kg-muted{color:var(--kg-muted);font-size:12px;line-height:1.7}.kg-content{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9;margin:16px 0}
.kg-tag{display:inline-block;padding:3px 7px;border-radius:5px;background:var(--sidebar-active, #edf2ef);font-size:11px;color:var(--ink, #658070);margin:0 5px 5px 0;max-width:100%;overflow-wrap:anywhere}
.kg-topics{display:flex;flex-direction:column;gap:4px}.kg-topic{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:transparent;border-radius:6px;padding:8px 7px;color:var(--ink, #596271)}
.kg-topic:hover,.kg-topic.active{background:var(--sidebar-active, #eef3ef)}.kg-dot{width:9px;height:9px;display:inline-block;border-radius:50%;flex-shrink:0}.kg-topic-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.kg-count{font-size:11px;color:var(--muted, #9ba2aa)}
.kg-link{border-top:1px solid var(--kg-border);padding:11px 0;display:flex;gap:7px;align-items:flex-start}.kg-link-open{flex:1;min-width:0;border:0;text-align:left;background:transparent;padding:0;color:var(--ink, #465e52);line-height:1.6;overflow-wrap:anywhere}.kg-link-open:hover{text-decoration:underline}
.kg-empty{position:absolute;inset:60px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--muted, #929ba6);text-align:center;line-height:1.8;pointer-events:none}.kg-empty strong{font-size:15px;font-weight:500;color:var(--ink, #596271)}
.kg-history{border-top:1px solid var(--kg-border);padding:20px;background:var(--surface, #fcfdfc);max-height:540px;overflow:auto}.kg-history details{padding:12px 0;border-bottom:1px solid var(--kg-border)}.kg-history summary{cursor:pointer;line-height:1.8}.kg-history-item{padding:12px 14px;border:1px solid var(--kg-border);border-radius:7px;background:var(--card, white);margin:10px 0;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.kg-before{color:var(--muted, #7d8490)}.kg-after{color:var(--ink, #386852)}
.kg-spin{animation:kg-spin 1s linear infinite}@keyframes kg-spin{to{transform:rotate(360deg)}}
@container(max-width:850px){.kg-side{width:250px;padding:15px}.kg-hint{display:none}.kg-toolbar{gap:8px;padding:12px}.kg-search{max-width:none}.kg-select{max-width:170px}}
@container(max-width:620px){.kg-body{flex-direction:column}.kg-side{width:100%;max-height:380px;border-left:0;border-top:1px solid var(--kg-border)}.kg-canvas{height:470px;min-height:470px}.kg-toolbar .kg-btn{flex:1}.kg-search{flex-basis:100%}.kg-select{flex:1;max-width:100%}}
`;

export function KnowledgeGraph() {
  const [graph, setGraph] = useState<Graph>({ nodes: [], links: [], topics: [] });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [scope, setScope] = useState('all'), [kind, setKind] = useState('all');
  const [topic, setTopic] = useState(''), [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<Node | null>(null), [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState('');
  const [neighborsOnly, setNeighborsOnly] = useState(false), [showLinks, setShowLinks] = useState(true);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false), [history, setHistory] = useState<HistoryRow[]>([]);
  const [linkTarget, setLinkTarget] = useState(''), [linkLabel, setLinkLabel] = useState('相关');
  const [themeVersion, setThemeVersion] = useState(0);
  const canvas = useRef<HTMLDivElement>(null), chart = useRef<echarts.ECharts | null>(null);
  const renderedIds = useRef('');
  const onSelect = useRef(setSelectedId);
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion(version => version + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setThemeVersion(version => version + 1);
    media.addEventListener('change', update);
    return () => { observer.disconnect(); media.removeEventListener('change', update); };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [data, records] = await Promise.all([api<Graph>('/api/kb/graph'), api<{ rows: HistoryRow[] }>('/api/kb/memory-history')]);
      setGraph(data); setHistory(records.rows);
      setSelectedId(id => data.nodes.some(node => node.id === id) ? id : '');
      setTopic(id => data.topics.some(item => item.id === id) ? id : '');
    } catch (error) { setError(String(error instanceof Error ? error.message : error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); setDetailError(''); setDetailLoading(false); return; }
    let active = true; setDetail(null); setDetailError(''); setDetailLoading(true); setLinkTarget('');
    api<Node>(`/api/kb/graph/detail?id=${encodeURIComponent(selectedId)}`).then(data => { if (active) setDetail(data); })
      .catch(error => { if (active) setDetailError(error.message); }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId, graph]);

  const selected = graph.nodes.find(node => node.id === selectedId);
  const neighbors = useMemo(() => new Set(graph.links.filter(link => link.source === selectedId || link.target === selectedId)
    .flatMap(link => [link.source, link.target])), [graph, selectedId]);
  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return graph.nodes.filter(node => (scope === 'all' || (scope === 'global' ? node.scope === 'global' : node.workspacePath === scope))
      && (kind === 'all' || node.kind === kind) && (!topic || node.topicId === topic)
      && (!keyword || `${node.name} ${node.content} ${node.category}`.toLowerCase().includes(keyword))
      && (!neighborsOnly || !selectedId || node.id === selectedId || neighbors.has(node.id)));
  }, [graph, scope, kind, topic, query, neighborsOnly, selectedId, neighbors]);
  const visibleIds = useMemo(() => new Set(visible.map(node => node.id)), [visible]);
  const links = useMemo(() => graph.links.filter(link => visibleIds.has(link.source) && visibleIds.has(link.target)), [graph, visibleIds]);
  const workspaces = [...new Set(graph.nodes.map(node => node.workspacePath).filter(Boolean))];

  useEffect(() => {
    if (!canvas.current) return;
    const instance = echarts.init(canvas.current, undefined, { renderer: 'canvas' }); chart.current = instance;
    instance.on('click', (event: any) => { if (event.dataType === 'node') onSelect.current(event.data.id); });
    const observer = new ResizeObserver(() => instance.resize()); observer.observe(canvas.current);
    return () => { observer.disconnect(); instance.dispose(); chart.current = null; };
  }, []);
  useEffect(() => {
    const ids = visible.map(node => node.id).join('|');
    const widthFactor = Math.min(1, Math.max(.35, (canvas.current?.clientWidth || 600) / 600));
    const theme = getComputedStyle(document.documentElement);
    const textColor = theme.getPropertyValue('--muted').trim() || '#646d79';
    const inkColor = theme.getPropertyValue('--ink').trim() || '#253d32';
    const surfaceColor = theme.getPropertyValue('--card').trim() || '#fff';
    const previous = (chart.current?.getOption() as any)?.series?.[0];
    const sameNodes = renderedIds.current === ids; renderedIds.current = ids;
    chart.current?.setOption({
      animationDurationUpdate: 250,
      tooltip: { trigger: 'item', renderMode: 'richText', formatter: (event: any) => event.dataType === 'node' ? event.data.name : event.data.reason || event.data.label },
      series: [{ type: 'graph', layout: 'force', roam: true, roamTrigger: 'global', draggable: true,
        scaleLimit: { min: .15, max: 6 }, left: '10%', right: '12%', top: '14%', bottom: '15%',
        zoom: sameNodes ? previous?.zoom || .9 : visible.length > 35
          ? Math.max(.15, .55 * widthFactor * Math.sqrt(35 / visible.length))
          : Math.max(.15, Math.min(.9, .9 * widthFactor * Math.sqrt(25 / Math.max(1, visible.length)))),
        ...(sameNodes && previous?.center ? { center: previous.center } : {}),
        force: { initLayout: 'circular', repulsion: 160, edgeLength: 100, gravity: .07, friction: .6, layoutAnimation: false },
        label: { show: visible.length <= 35, position: 'bottom', distance: 7, color: textColor, fontSize: 12, width: 145, overflow: 'truncate' },
        labelLayout: { hideOverlap: true },
        emphasis: { focus: 'adjacency', scale: 1.4, label: { show: true, color: inkColor }, lineStyle: { width: 2, opacity: .85 } },
        blur: { itemStyle: { opacity: .18 }, lineStyle: { opacity: .05 }, label: { opacity: .25 } },
        data: visible.map(node => {
          return { id: node.id, name: node.name, value: 1, symbolSize: node.id === selectedId ? 18 : 11,
            itemStyle: { color: node.color, borderColor: node.id === selectedId ? inkColor : surfaceColor, borderWidth: node.id === selectedId ? 2 : 1.5 },
            label: { show: visible.length <= 35 || node.id === selectedId, fontWeight: node.id === selectedId ? 600 : 400 },
          };
        }),
        links: showLinks ? links.map(link => ({ ...link, lineStyle: {
          color: '#aebdb5', type: link.kind === 'manual' ? 'solid' : 'dashed', width: link.kind === 'manual' ? 1.25 : .8,
          opacity: selectedId && link.source !== selectedId && link.target !== selectedId ? .12 : .5,
        } })) : [],
      }],
    }, { notMerge: true });
  }, [visible, links, selectedId, showLinks, themeVersion]);

  const perform = async (operation: () => Promise<{ message?: string }>) => {
    setBusy(true); setError(''); setNotice('');
    try { const result = await operation(); setNotice(result.message || '已保存'); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const clearFilters = () => { setQuery(''); setScope('all'); setKind('all'); setTopic(''); setNeighborsOnly(false); };
  const zoom = (factor: number) => {
    const option = chart.current?.getOption() as any;
    const series = option?.series?.[0];
    if (series) chart.current?.setOption({ series: [{ zoom: Math.min(6, Math.max(.15, (series.zoom || 1) * factor)) }] });
  };
  const exportGraph = async (kind: 'graph' | 'image') => {
    setError(''); setNotice(''); setBusy(true);
    try {
      if (!window.dyworker?.exportKnowledge) throw new Error('当前环境不支持导出');
      const image = kind === 'image' ? chart.current?.getDataURL({ type: 'png', pixelRatio: 2,
        backgroundColor: getComputedStyle(canvas.current!.parentElement!).backgroundColor }) : undefined;
      if (kind === 'image' && !image) throw new Error('图谱尚未加载完成');
      const result = await window.dyworker.exportKnowledge({ kind, image });
      if (!result.ok) throw new Error(result.error || '导出失败');
      if (!result.canceled) setNotice(`已导出到 ${result.path}`);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return <div className="kg">
    <style>{styles}</style>
    <div className="kg-toolbar">
      <label className="kg-search"><Search size={15} /><input aria-label="搜索图谱" placeholder="搜索记忆或资料…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select className="kg-select" aria-label="图谱范围" value={scope} onChange={event => setScope(event.target.value)}>
        <option value="all">全部范围</option><option value="global">个人与通用资料</option>
        {workspaces.map(value => <option key={value} value={value}>项目：{value.split(/[\\/]/).filter(Boolean).pop()}</option>)}
      </select>
      <select className="kg-select" aria-label="内容类型" value={kind} onChange={event => setKind(event.target.value)}><option value="all">全部内容</option><option value="memory">仅记忆</option><option value="document">仅资料</option></select>
      <button className="kg-btn" disabled={busy || loading} onClick={() => void perform(() => api('/api/kb/organize-memories', {}))}>{busy ? <LoaderCircle size={14} className="kg-spin" /> : <Network size={14} />}整理记忆</button>
      <button className={`kg-btn ${historyOpen ? 'active' : ''}`} onClick={() => setHistoryOpen(value => !value)}><History size={14} />整理记录</button>
      <button className="kg-btn" disabled={busy || loading} onClick={() => void exportGraph('graph')} title="导出完整图谱，包含所有节点和关联"><Download size={14} />导出完整图谱</button>
      <button className="kg-btn" disabled={busy || loading} onClick={() => void exportGraph('image')} title="导出当前筛选和缩放下的图谱画面"><Download size={14} />导出当前图片</button>
      <button className="kg-btn" aria-label="刷新图谱" disabled={loading || busy} onClick={() => void refresh()}><RefreshCw size={14} className={loading ? 'kg-spin' : ''} /></button>
    </div>
    {(notice || error) && <div role={error ? 'alert' : 'status'} className={`kg-note ${error ? 'kg-error' : ''}`}>{error || notice}{error && <button className="kg-btn" style={{ marginLeft: 10 }} disabled={loading || busy} onClick={() => void refresh()}>重试</button>}</div>}
    <div className="kg-body">
      <div className="kg-stage">
        <div className="kg-meta" aria-live="polite">{loading ? '正在读取知识…' : `${visible.length} 个节点 · ${links.length} 条关联${topic ? ' · 已按主题筛选' : ''}`}</div>
        <div ref={canvas} className="kg-canvas" role="img" aria-label="知识关系图谱，相近内容以相同颜色显示。也可通过右侧列表选择内容。" />
        {!loading && !visible.length && <div className="kg-empty"><Network size={30} strokeWidth={1.2} /><strong>{graph.nodes.length ? '没有符合条件的内容' : '你的知识，会在这里慢慢连接起来'}</strong><span>{graph.nodes.length ? '清除搜索或调整筛选条件后重试。' : '导入资料，或让助手记住有用的信息，再来看看。'}</span></div>}
        <div className="kg-tools"><button title="放大" aria-label="放大图谱" onClick={() => zoom(1.3)}><ZoomIn size={16} /></button><button title="缩小" aria-label="缩小图谱" onClick={() => zoom(1 / 1.3)}><ZoomOut size={16} /></button><button title="重置视图和筛选" aria-label="重置图谱" onClick={() => { clearFilters(); setSelectedId(''); chart.current?.dispatchAction({ type: 'restore' }); }}><Maximize2 size={16} /></button><button className={showLinks ? 'active' : ''} title={showLinks ? '隐藏连线' : '显示连线'} aria-label={showLinks ? '隐藏连线' : '显示连线'} aria-pressed={showLinks} onClick={() => setShowLinks(value => !value)}><Link2 size={16} /></button></div>
        <span className="kg-hint">{visible.length > 35 ? '内容较多，悬停节点显示名称 · ' : ''}滚轮缩放 · 拖动画布 · 点击节点查看</span>
      </div>
      <aside className="kg-side" aria-label="图谱详情">
        {selected ? <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><h3>{selected.name}</h3><button className="kg-btn" aria-label="关闭详情" style={{ alignSelf: 'start', padding: 4 }} onClick={() => { setSelectedId(''); setNeighborsOnly(false); }}><X size={14} /></button></div>
          <span className="kg-tag">{selected.kind === 'memory' ? '记忆' : '资料'}</span><span className="kg-tag">{selected.category || '未分类'}</span>
          <div className="kg-muted">{selected.scope === 'workspace' ? `仅用于项目：${selected.workspacePath}` : '个人与通用知识'}{selected.chunks ? ` · ${selected.chunks} 段内容` : ''}</div>
          {detailLoading ? <p className="kg-muted">正在读取正文…</p> : detailError ? <p role="alert">{detailError}</p> : <div className="kg-content">{detail?.content || selected.content}</div>}
          {selected.kind === 'memory' && <p className="kg-muted">可在设置中的「记忆」修改内容。</p>}
          {!!detail?.origins?.length && <details><summary className="kg-muted" style={{ cursor: 'pointer' }}>来源与原文（{detail.origins.length}）</summary>{detail.origins.map(origin => <div className="kg-history-item" key={origin.id}>{origin.name && <strong>{origin.name}<br /></strong>}{origin.content}{origin.createdAt && <div className="kg-muted">{new Date(origin.createdAt).toLocaleString('zh-CN')}</div>}{origin.originSessionId && <div className="kg-muted">来自任务：{origin.originSessionId}</div>}</div>)}</details>}
          <h4>关联内容</h4>
          <label className="kg-muted" style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={neighborsOnly} onChange={event => setNeighborsOnly(event.target.checked)} />只看这条内容及其关联</label>
          {graph.links.filter(link => link.source === selectedId || link.target === selectedId).map(link => {
            const other = graph.nodes.find(node => node.id === (link.source === selectedId ? link.target : link.source));
            return other && <div className="kg-link" key={`${link.source}:${link.target}`}><span className="kg-dot" style={{ background: other.color, marginTop: 5 }} /><button className="kg-link-open" onClick={() => setSelectedId(other.id)}>{other.name}<div className="kg-muted">{link.label} · {link.kind === 'manual' ? '已确认' : '自动发现'}</div>{link.reason && <div className="kg-muted">{link.reason}</div>}</button><button className="kg-btn" style={{ padding: 4 }} aria-label={`解除与${other.name}的关联`} disabled={busy} onClick={() => void perform(() => api('/api/kb/graph/relation', { source: selectedId, target: other.id, remove: true }))}><Unlink size={12} /></button></div>;
          })}
          {!neighbors.size && <p className="kg-muted">暂未发现关联，可以手动连接相关内容。</p>}
          <h4>添加关联</h4>
          <select className="kg-select" style={{ width: '100%', maxWidth: '100%' }} aria-label="选择要关联的内容" value={linkTarget} onChange={event => setLinkTarget(event.target.value)}><option value="">选择另一条内容…</option>{graph.nodes.filter(node => node.id !== selectedId && !(node.scope === 'workspace' && selected.scope === 'workspace' && node.workspacePath !== selected.workspacePath)).map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select>
          <input className="kg-select" style={{ width: '100%', boxSizing: 'border-box', margin: '8px 0', maxWidth: '100%' }} aria-label="关联说明" placeholder="关联说明，如：补充说明" value={linkLabel} maxLength={80} onChange={event => setLinkLabel(event.target.value)} />
          <button className="kg-btn" disabled={!linkTarget || busy} onClick={() => void perform(() => api('/api/kb/graph/relation', { source: selectedId, target: linkTarget, label: linkLabel }))}><Link2 size={13} />保存关联</button>
        </> : <>
          <h3>内容的联系，一眼可见</h3><p className="kg-muted">相近内容使用相同颜色。点击节点查看正文，沿着连线发现相关知识。</p>
          <div className="kg-muted">实线：手动确认的关联<br />虚线：依据共同内容自动发现</div>
          <h4>内容主题 · {graph.topics.length}</h4>
          <div className="kg-topics"><button className={`kg-topic ${!topic ? 'active' : ''}`} onClick={() => setTopic('')}><span className="kg-topic-name">全部主题</span><span className="kg-count">{graph.nodes.length}</span></button>{graph.topics.map(item => <button key={item.id} className={`kg-topic ${topic === item.id ? 'active' : ''}`} onClick={() => setTopic(value => value === item.id ? '' : item.id)}><span className="kg-dot" style={{ background: item.color }} /><span className="kg-topic-name">{item.label}</span><span className="kg-count">{item.count}</span></button>)}</div>
        </>}
        <details style={{ marginTop: 22 }}><summary className="kg-muted" style={{ cursor: 'pointer' }}>浏览当前内容（{visible.length}）</summary>{visible.map(node => <button key={node.id} className="kg-topic" onClick={() => setSelectedId(node.id)}><span className="kg-dot" style={{ background: node.color }} /><span className="kg-topic-name">{node.name}</span></button>)}</details>
        {(query || scope !== 'all' || kind !== 'all' || topic || neighborsOnly) && <button className="kg-btn" style={{ marginTop: 18 }} onClick={clearFilters}>清除筛选</button>}
      </aside>
    </div>
    {historyOpen && <section className="kg-history" aria-label="记忆整理记录"><h3 style={{ margin: '0 0 8px', fontSize: 15 }}>整理记录</h3><p className="kg-muted">保留最近 10 次整理，可对照合并前后的内容。整理后已有新增或修改时，恢复入口会关闭，避免丢失后来的内容。</p>{!history.length && <p className="kg-muted">还没有整理记录。</p>}{history.map(record => <details key={record.id}><summary>{new Date(record.createdAt).toLocaleString('zh-CN')} · {record.undone ? '已撤销' : `合并 ${record.merged} 条`}{record.conflicts.length ? ` · ${record.conflicts.length} 组待确认` : ''}</summary><p className="kg-muted">{record.message}</p>{record.merges.map((merge, index) => <div className="kg-history-item" key={index}><div className="kg-muted">{merge.reason}</div><div className="kg-before">合并前：{merge.before.map(item => item.content).join('\n')}</div><div className="kg-after">合并后：{merge.after?.content}</div></div>)}{record.conflicts.map((conflict, index) => <div className="kg-history-item" key={`conflict:${index}`}><strong>待确认：{conflict.reason}</strong>{conflict.memories.map(item => <div key={item.id}>{item.content}</div>)}</div>)}{record.canUndo && <button className="kg-btn" disabled={busy} onClick={() => void perform(() => api('/api/kb/undo-memory-organization', { id: record.id }))}><RotateCcw size={13} />恢复整理前的记忆</button>}</details>)}</section>}
  </div>;
}
