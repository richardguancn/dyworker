import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as echarts from 'echarts/core';
import { GraphChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { Search, RefreshCw, RotateCcw, ZoomIn, ZoomOut, Maximize2, X, Network, History, Link2, Unlink, LoaderCircle, Download } from 'lucide-react';

function t(key: string, fallback: string): string {
  if (typeof window !== 'undefined') {
    return (window as any).__dyworker_i18n__?.t(key, fallback) ?? fallback;
  }
  return fallback;
}

echarts.use([GraphChart, TooltipComponent, CanvasRenderer]);

interface Origin { id: string; name?: string; content: string; originSessionId?: string; createdAt?: string }
interface Node {
  id: string; memoryId?: string; name: string; kind: 'memory' | 'document'; category: string;
  content: string; source: string; scope: string; workspacePath: string; color: string; topicId: string;
  truncated?: boolean; origins: Origin[]; chunks?: number; nextOffset?: number; previousOffset?: number;
}
interface Link { source: string; target: string; kind: 'manual' | 'similar'; label: string; reason?: string }
interface Topic { id: string; label: string; color: string; count: number }
interface Graph { nodes: Node[]; links: Link[]; topics: Topic[] }
interface HistoryRow {
  id: string; createdAt: string; merged: number; canUndo: boolean; undone: boolean; message: string;
  merges: { targetId: string; reason: string; before: Origin[]; after: Origin }[];
  conflicts: { reason: string; memories: Origin[] }[];
}

async function api<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, body === undefined ? { signal } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || '操作失败，请稍后重试');
  return data;
}

function topicPositions(nodes: Node[]) {
  const groups = new Map<string, Node[]>();
  for (const node of nodes) {
    const group = groups.get(node.topicId);
    if (group) group.push(node);
    else groups.set(node.topicId, [node]);
  }
  const clusters = [...groups.values()].map(nodes => ({ nodes, size: 30 + 22 * Math.sqrt(nodes.length) }))
    .sort((a, b) => b.size - a.size);
  const width = Math.max(clusters[0]?.size ?? 0, 1.3 * Math.sqrt(clusters.reduce((area, { size }) => area + size * size, 0)));
  const positions = new Map<string, { x: number; y: number }>();
  let x = 0, y = 0, height = 0;
  for (const { nodes, size } of clusters) {
    if (x && x + size > width) { y += height; x = 0; height = 0; }
    nodes.forEach((node, index) => {
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const radius = 10 * Math.sqrt(index);
      positions.set(node.id, { x: x + size / 2 + radius * Math.cos(angle), y: y + size / 2 + radius * Math.sin(angle) });
    });
    x += size;
    height = Math.max(height, size);
  }
  return positions;
}

function PageList<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const [page, setPage] = useState(0);
  const size = 40;
  const pages = Math.ceil(items.length / size);
  const current = Math.min(page, Math.max(0, pages - 1));
  return <>{items.slice(current * size, (current + 1) * size).map(render)}
    {pages > 1 && <div className="kg-pages"><button className="kg-btn" disabled={!current} onClick={() => setPage(current - 1)}>上一页</button><span>{current + 1} / {pages}</span><button className="kg-btn" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页</button></div>}
  </>;
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
.kg-pages{display:flex;align-items:center;justify-content:center;gap:7px;margin:8px 0;color:var(--kg-muted);font-size:12px}.kg-pages button{padding:4px 6px}
@container(max-width:850px){.kg-side{width:250px;padding:15px}.kg-hint{display:none}.kg-toolbar{gap:8px;padding:12px}.kg-search{max-width:none}.kg-select{max-width:170px}}
@container(max-width:620px){.kg-body{flex-direction:column}.kg-side{width:100%;max-height:380px;border-left:0;border-top:1px solid var(--kg-border)}.kg-canvas{height:470px;min-height:470px}.kg-toolbar .kg-btn{flex:1}.kg-search{flex-basis:100%}.kg-select{flex:1;max-width:100%}}
`;

export function KnowledgeGraph() {
  const [graph, setGraph] = useState<Graph>({ nodes: [], links: [], topics: [] });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [scope, setScope] = useState('all'), [kind, setKind] = useState('all');
  const [documentMatches, setDocumentMatches] = useState<{ keyword: string; ids: Set<string> }>();
  const [topic, setTopic] = useState(''), [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<Node | null>(null), [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false), [relationOpen, setRelationOpen] = useState(false);
  const [neighborsOnly, setNeighborsOnly] = useState(false), [showLinks, setShowLinks] = useState(true);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false), [history, setHistory] = useState<HistoryRow[]>([]);
  const [linkTarget, setLinkTarget] = useState(''), [linkLabel, setLinkLabel] = useState('相关');
  const [themeVersion, setThemeVersion] = useState(0);
  const [, setLocaleTick] = useState(0);
  useEffect(() => {
    const handler = () => setLocaleTick(v => v + 1);
    window.addEventListener('dyworker:locale-change', handler);
    return () => window.removeEventListener('dyworker:locale-change', handler);
  }, []);
  const canvas = useRef<HTMLDivElement>(null), chart = useRef<echarts.ECharts | null>(null);
  const renderedIds = useRef('');
  const detailRequest = useRef(0);
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
      const data = await api<Graph>('/api/kb/graph');
      setGraph(data);
      setSelectedId(id => data.nodes.some(node => node.id === id) ? id : '');
      setTopic(id => data.topics.some(item => item.id === id) ? id : '');
    } catch (error) { setError(String(error instanceof Error ? error.message : error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!historyOpen) return;
    let active = true;
    api<{ rows: HistoryRow[] }>('/api/kb/memory-history').then(({ rows }) => { if (active) setHistory(rows); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [historyOpen, graph]);
  const loadDetail = useCallback(async (id: string, offset = 0) => {
    const request = ++detailRequest.current;
    setDetailError(''); setDetailLoading(true);
    try {
      const data = await api<Node>(`/api/kb/graph/detail?${new URLSearchParams({ id, offset: String(offset) })}`);
      if (request === detailRequest.current) setDetail(data);
    } catch (error) { if (request === detailRequest.current) setDetailError(error instanceof Error ? error.message : String(error)); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  }, []);
  useEffect(() => {
    setDetail(null); setLinkTarget(''); setRelationOpen(false);
    if (selectedId) void loadDetail(selectedId);
    else { setDetailError(''); setDetailLoading(false); }
    return () => { detailRequest.current++; };
  }, [selectedId, graph, loadDetail]);

  const byId = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph]);
  const selected = byId.get(selectedId);
  const selectedLinks = useMemo(() => graph.links.filter(link => link.source === selectedId || link.target === selectedId), [graph, selectedId]);
  const focusedId = neighborsOnly ? selectedId : '';
  const focusedNodes = useMemo(() => focusedId ? new Set([focusedId, ...selectedLinks.flatMap(link => [link.source, link.target])]) : null, [focusedId, focusedId ? selectedLinks : null]);
  const keyword = useDeferredValue(query).trim().toLowerCase();
  useEffect(() => {
    if (!keyword || kind === 'memory') return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<{ ids: string[] }>(`/api/kb/graph/search?q=${encodeURIComponent(keyword)}`, undefined, controller.signal)
        .then(({ ids }) => {
          if (controller.signal.aborted) return;
          setDocumentMatches(previous => ids.length ? { keyword, ids: new Set(ids) } : previous?.keyword === keyword ? undefined : previous);
        })
        .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    }, 160);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [keyword, kind, graph]);
  const visible = useMemo(() => {
    return graph.nodes.filter(node => (scope === 'all' || (scope === 'global' ? node.scope === 'global' : node.workspacePath === scope))
      && (kind === 'all' || node.kind === kind) && (!topic || node.topicId === topic)
      && (!keyword || `${node.name} ${node.content} ${node.category}`.toLowerCase().includes(keyword)
        || (documentMatches?.keyword === keyword && documentMatches.ids.has(node.id)))
      && (!focusedNodes || focusedNodes.has(node.id)));
  }, [graph, scope, kind, topic, keyword, focusedNodes, documentMatches]);
  const visibleIds = useMemo(() => new Set(visible.map(node => node.id)), [visible]);
  const links = useMemo(() => graph.links.filter(link => visibleIds.has(link.source) && visibleIds.has(link.target)), [graph, visibleIds]);
  const workspaces = useMemo(() => [...new Set(graph.nodes.map(node => node.workspacePath).filter(Boolean))], [graph]);
  const dense = visible.length > 120 || links.length > 300;
  const positions = useMemo(() => dense ? topicPositions(visible) : null, [dense, visible]);

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
    const sameNodes = renderedIds.current === ids; renderedIds.current = ids;
    const previous = sameNodes ? (chart.current?.getOption() as any)?.series?.[0] : undefined;
    chart.current?.setOption({
      animation: !dense, animationDurationUpdate: 250,
      tooltip: { trigger: 'item', renderMode: 'richText', formatter: (event: any) => event.dataType === 'node' ? event.data.name : event.data.reason || event.data.label },
      series: [{ type: 'graph', id: 'knowledge', layout: dense ? 'none' : 'force', roam: true, roamTrigger: 'global', draggable: true,
        nodeScaleRatio: dense ? .65 : .6,
        scaleLimit: { min: .15, max: 6 }, left: '10%', right: '12%', top: '14%', bottom: '15%',
        zoom: sameNodes ? previous?.zoom || .9 : dense ? .92 : visible.length > 35
          ? Math.max(.15, .55 * widthFactor * Math.sqrt(35 / visible.length))
          : Math.max(.15, Math.min(.9, .9 * widthFactor * Math.sqrt(25 / Math.max(1, visible.length)))),
        ...(sameNodes && previous?.center ? { center: previous.center } : {}),
        force: { initLayout: 'circular', repulsion: 160, edgeLength: 100, gravity: .07, friction: .6, layoutAnimation: false },
        label: { show: visible.length <= 35, position: 'bottom', distance: 7, color: textColor, fontSize: 12, width: 145, overflow: 'truncate' },
        labelLayout: { hideOverlap: !dense },
        emphasis: dense ? { disabled: true } : { focus: 'adjacency', scale: 1.4, label: { show: true, color: inkColor }, lineStyle: { width: 2, opacity: .85 } },
        blur: { itemStyle: { opacity: .18 }, lineStyle: { opacity: .05 }, label: { opacity: .25 } },
        data: visible.map(node => {
          return { id: node.id, name: node.name, value: 1, ...positions?.get(node.id), symbolSize: node.id === selectedId ? 18 : dense ? 6 : 11,
            itemStyle: { color: node.color, borderColor: node.id === selectedId ? inkColor : surfaceColor, borderWidth: node.id === selectedId ? 2 : 1.5 },
            label: { show: visible.length <= 35 || node.id === selectedId, fontWeight: node.id === selectedId ? 600 : 400 },
          };
        }),
        links: showLinks ? links.map(link => ({ ...link, lineStyle: {
          color: '#aebdb5', type: link.kind === 'manual' ? 'solid' : 'dashed', width: link.kind === 'manual' ? 1.25 : .8,
          opacity: selectedId && link.source !== selectedId && link.target !== selectedId ? .12 : dense && link.kind !== 'manual' ? .26 : .5,
        } })) : [],
      }],
    }, { notMerge: true });
  }, [visible, links, selectedId, showLinks, themeVersion, dense, positions]);

  const perform = async (operation: () => Promise<{ message?: string }>) => {
    setBusy(true); setError(''); setNotice('');
    try { const result = await operation(); setNotice(result.message || '已保存'); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const clearFilters = () => { setQuery(''); setScope('all'); setKind('all'); setTopic(''); setNeighborsOnly(false); };
  const zoom = (factor: number) => {
    const instance = chart.current;
    if (instance) instance.dispatchAction({ type: 'graphRoam', seriesId: 'knowledge', zoom: factor,
      originX: instance.getWidth() / 2, originY: instance.getHeight() / 2 });
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
      <label className="kg-search"><Search size={15} /><input aria-label={t("kg.searchPlaceholder", "搜索图谱")} placeholder={t("kg.searchPlaceholder", "搜索记忆或资料…")} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select className="kg-select" aria-label={t("kg.scopeLabel", "图谱范围")} value={scope} onChange={event => setScope(event.target.value)}>
        <option value="all">{t("kg.scopeAll", "全部范围")}</option><option value="global">{t("kg.scopeGlobal", "个人与通用资料")}</option>
        {workspaces.map(value => <option key={value} value={value}>{t("kg.scopeProjectPrefix", "项目：")}{value.split(/[\\/]/).filter(Boolean).pop()}</option>)}
      </select>
      <select className="kg-select" aria-label={t("kg.kindLabel", "内容类型")} value={kind} onChange={event => setKind(event.target.value)}><option value="all">{t("kg.kindAll", "全部内容")}</option><option value="memory">{t("kg.kindMemory", "仅记忆")}</option><option value="document">{t("kg.kindDoc", "仅资料")}</option></select>
      <button className="kg-btn" disabled={busy || loading} onClick={() => void perform(() => api('/api/kb/organize-memories', {}))}>{busy ? <LoaderCircle size={14} className="kg-spin" /> : <Network size={14} />}{t("kg.organizeMemories", "整理记忆")}</button>
      <button className={`kg-btn ${historyOpen ? 'active' : ''}`} onClick={() => setHistoryOpen(value => !value)}><History size={14} />{t("kg.organizeHistory", "整理记录")}</button>
      <button className="kg-btn" disabled={busy || loading} onClick={() => void exportGraph('graph')} title={t("kg.exportFullGraphTip", "导出完整图谱，包含所有节点和关联")}><Download size={14} />{t("kg.exportFullGraph", "导出完整图谱")}</button>
      <button className="kg-btn" disabled={busy || loading} onClick={() => void exportGraph('image')} title={t("kg.exportCurrentImgTip", "导出当前筛选和缩放下的图谱画面")}><Download size={14} />{t("kg.exportCurrentImg", "导出当前图片")}</button>
      <button className="kg-btn" aria-label={t("kg.refreshGraph", "刷新图谱")} disabled={loading || busy} onClick={() => void refresh()}><RefreshCw size={14} className={loading ? 'kg-spin' : ''} /></button>
    </div>
    {(notice || error) && <div role={error ? 'alert' : 'status'} className={`kg-note ${error ? 'kg-error' : ''}`}>{error || notice}{error && <button className="kg-btn" style={{ marginLeft: 10 }} disabled={loading || busy} onClick={() => void refresh()}>{t("kg.retry", "重试")}</button>}</div>}
    <div className="kg-body">
      <div className="kg-stage">
        <div className="kg-meta" aria-live="polite">{loading ? t("kg.readingKnowledge", "正在读取知识…") : `${t("kg.metaInfo", "{nodes} 个节点 · {links} 条关联").replace("{nodes}", String(visible.length)).replace("{links}", String(links.length))}${topic ? ' · ' + t("kg.filteredByTopic", "已按主题筛选") : ''}`}</div>
        <div ref={canvas} className="kg-canvas" role="img" aria-label={t("kg.canvasAria", "知识关系图谱，相近内容以相同颜色显示。也可通过右侧列表选择内容。")} />
        {!loading && !visible.length && <div className="kg-empty"><Network size={30} strokeWidth={1.2} /><strong>{graph.nodes.length ? t("kg.emptyFiltered", "没有符合条件的内容") : t("kg.emptyTotal", "你的知识，会在这里慢慢连接起来")}</strong><span>{graph.nodes.length ? t("kg.emptyFilteredHint", "清除搜索或调整筛选条件后重试。") : t("kg.emptyTotalHint", "导入资料，或让助手记住有用的信息，再来看看。")}</span></div>}
        <div className="kg-tools"><button title={t("kg.zoomIn", "放大")} aria-label={t("kg.zoomIn", "放大图谱")} onClick={() => zoom(1.3)}><ZoomIn size={16} /></button><button title={t("kg.zoomOut", "缩小")} aria-label={t("kg.zoomOut", "缩小图谱")} onClick={() => zoom(1 / 1.3)}><ZoomOut size={16} /></button><button title={t("kg.resetView", "重置视图和筛选")} aria-label={t("kg.resetView", "重置图谱")} onClick={() => { clearFilters(); setSelectedId(''); chart.current?.dispatchAction({ type: 'restore' }); }}><Maximize2 size={16} /></button><button className={showLinks ? 'active' : ''} title={showLinks ? t("kg.hideLinks", "隐藏连线") : t("kg.showLinks", "显示连线")} aria-label={showLinks ? t("kg.hideLinks", "隐藏连线") : t("kg.showLinks", "显示连线")} aria-pressed={showLinks} onClick={() => setShowLinks(value => !value)}><Link2 size={16} /></button></div>
        <span className="kg-hint">{visible.length > 35 ? t("kg.hintHover", "内容较多，悬停节点显示名称 · ") : ''}{t("kg.canvasHint", "滚轮缩放 · 拖动画布 · 点击节点查看")}</span>
      </div>
      <aside className="kg-side" aria-label={t("kg.sideAria", "图谱详情")}>
        {selected ? <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><h3>{selected.name}</h3><button className="kg-btn" aria-label={t("kg.closeDetail", "关闭详情")} style={{ alignSelf: 'start', padding: 4 }} onClick={() => { setSelectedId(''); setNeighborsOnly(false); }}><X size={14} /></button></div>
          <span className="kg-tag">{selected.kind === 'memory' ? t("kg.tagMemory", "记忆") : t("kg.tagDocument", "资料")}</span><span className="kg-tag">{selected.category || t("kg.tagUncategorized", "未分类")}</span>
          <div className="kg-muted">{selected.scope === 'workspace' ? `${t("kg.scopeProjectOnly", "仅用于项目：")}${selected.workspacePath}` : t("kg.scopeGeneral", "个人与通用知识")}{selected.chunks ? ` · ${selected.chunks} ${t("kg.chunksCount", "段内容")}` : ''}</div>
          {detailLoading ? <p className="kg-muted">{t("kg.loadingContent", "正在读取正文…")}</p> : detailError ? <p role="alert">{detailError}</p> : <div className="kg-content">{detail?.content || selected.content}</div>}
          {(detail?.previousOffset !== undefined || detail?.nextOffset !== undefined) && <div className="kg-pages"><button className="kg-btn" disabled={detailLoading || detail.previousOffset === undefined} onClick={() => void loadDetail(selectedId, detail.previousOffset)}>上一段正文</button><button className="kg-btn" disabled={detailLoading || detail.nextOffset === undefined} onClick={() => void loadDetail(selectedId, detail.nextOffset)}>下一段正文</button></div>}
          {selected.kind === 'memory' && <p className="kg-muted">{t("kg.editMemoryTip", "可在设置中的「记忆」修改内容。")}</p>}
          {!!detail?.origins?.length && <details><summary className="kg-muted" style={{ cursor: 'pointer' }}>{t("kg.originsTitle", "来源与原文")}（{detail.origins.length}）</summary>{detail.origins.map(origin => <div className="kg-history-item" key={origin.id}>{origin.name && <strong>{origin.name}<br /></strong>}{origin.content}{origin.createdAt && <div className="kg-muted">{new Date(origin.createdAt).toLocaleString()}</div>}{origin.originSessionId && <div className="kg-muted">{t("kg.originSessionPrefix", "来自任务：")}{origin.originSessionId}</div>}</div>)}</details>}
          <h4>{t("kg.relationsTitle", "关联内容")}</h4>
          <label className="kg-muted" style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={neighborsOnly} onChange={event => setNeighborsOnly(event.target.checked)} />{t("kg.neighborsOnly", "只看这条内容及其关联")}</label>
          <PageList key={selectedId} items={selectedLinks} render={link => {
            const other = byId.get(link.source === selectedId ? link.target : link.source);
            return other && <div className="kg-link" key={`${link.source}:${link.target}`}><span className="kg-dot" style={{ background: other.color, marginTop: 5 }} /><button className="kg-link-open" onClick={() => setSelectedId(other.id)}>{other.name}<div className="kg-muted">{link.label} · {link.kind === 'manual' ? t("kg.linkManual", "已确认") : t("kg.linkAuto", "自动发现")}</div>{link.reason && <div className="kg-muted">{link.reason}</div>}</button><button className="kg-btn" style={{ padding: 4 }} aria-label={`${t("kg.unlinkPrefix", "解除与")}${other.name}${t("kg.unlinkSuffix", "的关联")}`} disabled={busy} onClick={() => void perform(() => api('/api/kb/graph/relation', { source: selectedId, target: other.id, remove: true }))}><Unlink size={12} /></button></div>;
          }} />
          {!selectedLinks.length && <p className="kg-muted">{t("kg.noNeighbors", "暂未发现关联，可以手动连接相关内容。")}</p>}
          <details open={relationOpen} onToggle={event => setRelationOpen(event.currentTarget.open)} style={{ marginTop: 18 }}>
            <summary className="kg-muted" style={{ cursor: 'pointer' }}>{t("kg.addRelationTitle", "添加关联")}</summary>
            {relationOpen && <div style={{ paddingTop: 8 }}>
          <select className="kg-select" style={{ width: '100%', maxWidth: '100%' }} aria-label={t("kg.chooseTargetAria", "选择要关联的内容")} value={linkTarget} onChange={event => setLinkTarget(event.target.value)}><option value="">{t("kg.chooseAnother", "选择另一条内容…")}</option>{graph.nodes.filter(node => node.id !== selectedId && !(node.scope === 'workspace' && selected.scope === 'workspace' && node.workspacePath !== selected.workspacePath)).map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select>
          <input className="kg-select" style={{ width: '100%', boxSizing: 'border-box', margin: '8px 0', maxWidth: '100%' }} aria-label={t("kg.relationNoteAria", "关联说明")} placeholder={t("kg.relationNotePlaceholder", "关联说明，如：补充说明")} value={linkLabel} maxLength={80} onChange={event => setLinkLabel(event.target.value)} />
          <button className="kg-btn" disabled={!linkTarget || busy} onClick={() => void perform(() => api('/api/kb/graph/relation', { source: selectedId, target: linkTarget, label: linkLabel }))}><Link2 size={13} />{t("kg.saveRelation", "保存关联")}</button>
            </div>}
          </details>
        </> : <>
          <h3>{t("kg.sideHeading", "内容的联系，一眼可见")}</h3><p className="kg-muted">{t("kg.sideDesc", "相近内容使用相同颜色。点击节点查看正文，沿着连线发现相关知识。")}</p>
          <div className="kg-muted">{t("kg.sideSolidLine", "实线：手动确认的关联")}<br />{t("kg.sideDashedLine", "虚线：依据共同内容自动发现")}</div>
          <h4>{t("kg.sideTopics", "内容主题 · {count}").replace("{count}", String(graph.topics.length))}</h4>
          <div className="kg-topics"><button className={`kg-topic ${!topic ? 'active' : ''}`} onClick={() => setTopic('')}><span className="kg-topic-name">{t("kg.sideAllTopics", "全部主题")}</span><span className="kg-count">{graph.nodes.length}</span></button><PageList items={graph.topics} render={item => <button key={item.id} className={`kg-topic ${topic === item.id ? 'active' : ''}`} onClick={() => setTopic(value => value === item.id ? '' : item.id)}><span className="kg-dot" style={{ background: item.color }} /><span className="kg-topic-name">{item.label}</span><span className="kg-count">{item.count}</span></button>} /></div>
        </>}
        <details style={{ marginTop: 22 }} onToggle={event => setBrowseOpen(event.currentTarget.open)}><summary className="kg-muted" style={{ cursor: 'pointer' }}>{t("kg.sideBrowseCurrent", "浏览当前内容（{count}）").replace("{count}", String(visible.length))}</summary>{browseOpen && <PageList key={JSON.stringify([scope, kind, topic, keyword, focusedId])} items={visible} render={node => <button key={node.id} className="kg-topic" onClick={() => setSelectedId(node.id)}><span className="kg-dot" style={{ background: node.color }} /><span className="kg-topic-name">{node.name}</span></button>} />}</details>
        {(query || scope !== 'all' || kind !== 'all' || topic || neighborsOnly) && <button className="kg-btn" style={{ marginTop: 18 }} onClick={clearFilters}>{t("kg.sideClearFilters", "清除筛选")}</button>}
      </aside>
    </div>
    {historyOpen && <section className="kg-history" aria-label={t("kg.organizeHistory", "记忆整理记录")}><h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{t("kg.organizeHistory", "整理记录")}</h3><p className="kg-muted">{t("kg.historyDesc", "保留最近 10 次整理，可对照合并前后的内容。")}</p>{!history.length && <p className="kg-muted">{t("kg.noHistory", "还没有整理记录。")}</p>}{history.map(record => <details key={record.id}><summary>{new Date(record.createdAt).toLocaleString()} · {record.undone ? t("kg.undoneStatus", "已撤销") : `${t("kg.mergedPrefix", "合并 ")}${record.merged} ${t("kg.countSuffix", "条")}`}{record.conflicts.length ? ` · ${record.conflicts.length} ${t("kg.conflictCount", "组待确认")}` : ''}</summary><p className="kg-muted">{record.message}</p>{record.merges.map((merge, index) => <div className="kg-history-item" key={index}><div className="kg-muted">{merge.reason}</div><div className="kg-before">{t("kg.beforeMerge", "合并前：")}{merge.before.map(item => item.content).join('\n')}</div><div className="kg-after">{t("kg.afterMerge", "合并后：")}{merge.after?.content}</div></div>)}{record.conflicts.map((conflict, index) => <div className="kg-history-item" key={`conflict:${index}`}><strong>{t("kg.pendingConfirm", "待确认：")}{conflict.reason}</strong>{conflict.memories.map(item => <div key={item.id}>{item.content}</div>)}</div>)}{record.canUndo && <button className="kg-btn" disabled={busy} onClick={() => void perform(() => api('/api/kb/undo-memory-organization', { id: record.id }))}><RotateCcw size={13} />{t("kg.undoOrganize", "恢复整理前的记忆")}</button>}</details>)}</section>}
  </div>;
}
