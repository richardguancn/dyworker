import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, Puzzle, RefreshCw, Search, Trash2 } from "lucide-react";
import { AddPluginDialog } from "./AddPluginDialog";
import { filterCatalog, isInstalled, isVerifiedEntry } from "./pluginCatalog";
import type {CatalogPlugin} from "./pluginCatalog";
import {BUILTIN_PLUGIN_LABELS} from './pluginLabels';
import { PluginDetailPage } from './PluginDetailPage';
import { loadBundleScript, loadedBundle, clientRuntime } from "./pluginRuntime/index.ts";
import { clientHost } from "./pluginRuntime/clientHostSingleton.ts";
import { requestPluginPanels, PluginSlotView } from "./PluginSlotView";
import type { PluginBundleRecord, PluginEntryRecord, PluginListResult } from "./types";

// 插件页（整页，不是弹窗）：安装、启用、配置、卸载 + 兼容性判定。
//
// 版式对齐 DSH 的插件页：标题 + 说明 + 右上操作；列表按"分组标题 + 行"排布，
// 每行是 [图标] [名称 + 标签] [描述] …… [开关]。
//
// 设计取态：**不把"装上了"当成"能用"**。DSH 插件的 inject 只按服务名判定，
// 名字缺失就永不 apply、界面只表现为"什么都没发生"。所以安装前先跑兼容性判定
// 并把结论摊开：runnable 可装 · partial 语义不同（需显式放行）· unsupported 跑不了（附原因）。

/** 插件图标底色：按名字散列取一个稳定的柔和色，视觉上区分不同插件 */
const TILE_COLORS = ["#e8eefc", "#e9f5ea", "#fdf1e3", "#f3e9fb", "#e6f3f7", "#fdecec"];
function tileColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  return TILE_COLORS[hash % TILE_COLORS.length];
}

export function PluginsPage() {
  const [data, setData] = useState<PluginListResult | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // 客户端半边试跑结果：记录"能加载吗、缺哪些模块、它要哪些客户端服务"
  const [clientRuns, setClientRuns] = useState<Record<string, { state: "loading" | "ok" | "error"; text: string }>>({});
  const loadingClients = useRef(new Set<string>());
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  // 插件市场：搜索词、分类、以及点「安装」时预填给添加向导的规格
  const [catalog,setCatalog]=useState<CatalogPlugin[]>([]);
  const [catalogMeta,setCatalogMeta]=useState({source:'bundled',publishedAt:'',notice:''});
  const [catalogLoading,setCatalogLoading]=useState(true);
  const [view,setView]=useState<'installed'|'available'>('installed');
  const refreshGeneration=useRef(0);
  const [marketQuery, setMarketQuery] = useState("");
  const [marketCategory, setMarketCategory] = useState("");
  const [marketSpec, setMarketSpec] = useState("");
  const [detailSelection, setDetailSelection] = useState<{ entryId?: string; catalogId?: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const bridge = typeof window !== "undefined" ? window.dyworker : undefined;

  const refresh = useCallback(async (force=false) => {
    if (!bridge?.listPlugins) return;
    const generation=++refreshGeneration.current;
    setCatalogLoading(true);
    try {
      const [installed,directory]=await Promise.all([bridge.listPlugins(),bridge.pluginCatalog({force})]);
      if(generation!==refreshGeneration.current)return;
      setData(installed);setCatalog(directory.plugins);setCatalogMeta(directory);
      setRefreshKey(value => value + 1);setError('');
    } catch (refreshError: any) {
      if(generation===refreshGeneration.current)setError(String(refreshError?.message || refreshError));
    } finally {if(generation===refreshGeneration.current)setCatalogLoading(false);}
  }, [bridge]);

  useEffect(() => { void refresh();return ()=>{refreshGeneration.current++;}; }, [refresh]);
  const [, updateSlots] = useState(0);
  useEffect(() => clientHost().subscribe(() => updateSlots(value => value + 1)), []);

  /**
   * 加载插件的客户端半边（实验）。
   * 第 1 步只验证"能不能被加载器加载起来"——bundle 会执行并注册，但界面上还不会出现
   * 它贡献的面板（那需要第 2 步把宿主已有的面板注册成 dsh-client-* 服务）。
   */
  const loadClientHalf = async (entry: PluginEntryRecord, bundle: PluginBundleRecord | undefined) => {
    const key = entry.id;
    if (loadingClients.current.has(key)) return;
    loadingClients.current.add(key);
    setClientRuns((current) => ({ ...current, [key]: { state: "loading", text: "正在加载客户端 bundle…" } }));
    try {
      await clientHost().unload(entry.id);
      clientRuntime().loader.invalidate(bundle?.name || entry.name || entry.id);
      const info = await bridge!.pluginClientBundles(bundle?.name || entry.id);
      if (!info?.ok) {
        setClientRuns((current) => ({ ...current, [key]: { state: "error", text: info?.error || "没有可加载的客户端入口" } }));
        return;
      }
      const primary = info.entries?.find((item) => item.primary) || info.entries?.[0];
      if (!primary) {
        setClientRuns((current) => ({ ...current, [key]: { state: "error", text: "没有可加载的客户端入口" } }));
        return;
      }
      // 先按依赖顺序加载它声明的客户端模块（slots/locale/settings 这些服务由它们提供），
      // 再加载插件本身——否则插件 inject 的服务还没人提供，apply 会静默降级
      const moduleNotes: string[] = [];
      for (const moduleRef of info.modules || []) {
        try {
          const loaded = loadedBundle(moduleRef.spec) || await loadBundleScript(moduleRef.url);
          moduleNotes.push(`${moduleRef.spec}${loaded.error ? "（失败）" : ""}`);
        } catch (error: any) {
          moduleNotes.push(`${moduleRef.spec}（${String(error?.message || error).slice(0, 40)}）`);
        }
      }
      // 可能已作为依赖模块加载过：按包名复用（同一个 bundle 加载两次应当幂等）
      let record = loadedBundle(bundle?.name || entry.name || entry.id);
      if (!record) {
        try {
          record = await loadBundleScript(primary.url);
        } catch (error: any) {
          record = loadedBundle(bundle?.name || entry.name || entry.id);
          if (!record) {
            setClientRuns((current) => ({ ...current, [key]: { state: "error", text: String(error?.message || error) } }));
            return;
          }
        }
      }
      if (record.error) {
        setClientRuns((current) => ({ ...current, [key]: { state: "error", text: `bundle 执行失败：${record.error}` } }));
        return;
      }
      // 交给客户端插件宿主：它是 cordis 插件，由容器提供 slots/locale 等服务后 apply
      const pluginRecord = await clientHost().load(record.exports, entry.id);
      if (!pluginRecord.ok) {
        setClientRuns((current) => ({ ...current, [key]: { state: "error", text: `插件 apply 失败：${pluginRecord.error}` } }));
        return;
      }
      // 它登记进宿主插槽的界面贡献：右侧面板标签会被壳层接进已有工具面板
      const panels = requestPluginPanels(entry.id, pluginRecord.slots);
      const missing = record.missing.length ? `；缺模块 ${[...new Set(record.missing)].join("、")}` : "";
      const slots = pluginRecord.slots.length ? `；登记插槽 ${pluginRecord.slots.join("、")}` : "；没有登记界面位置";
      const pending = pluginRecord.missingCalls.length ? `；未实现调用 ${[...new Set(pluginRecord.missingCalls)].slice(0, 4).join("、")}` : "";
      const opened = panels.length ? `；已开右侧面板 ${panels.map((panel) => panel.label).join("、")}` : "";
      const modules = moduleNotes.length ? `；客户端模块 ${moduleNotes.length} 个（${moduleNotes.slice(0, 3).join("、")}${moduleNotes.length > 3 ? "…" : ""}）` : "";
      const missingModules = info.missingModules?.length ? `；模块未安装 ${info.missingModules.slice(0, 2).join("、")}` : "";
      setClientRuns((current) => ({
        ...current,
        [key]: { state: "ok", text: `插件界面已加载：${record.id}${modules}${slots}${opened}${missingModules}${missing}${pending}` },
      }));
    } catch (error: any) {
      setClientRuns((current) => ({ ...current, [key]: { state: "error", text: String(error?.message || error) } }));
    } finally {
      loadingClients.current.delete(key);
    }
  };

  const run = useCallback(async (label: string, job: () => Promise<{ ok?: boolean; error?: string } | void>) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const result = await job();
      if (result && result.ok === false) setError(result.error || "操作失败");
      else setNotice(label);
      await refresh();
    } catch (jobError: any) {
      setError(String(jobError?.message || jobError));
    } finally {
      setBusy("");
    }
  }, [refresh]);

  const entries = data?.entries || [];
  const bundleOf = useMemo(() => {
    const map = new Map<string, PluginBundleRecord>();
    for (const bundle of data?.bundles || []) map.set(bundle.name, bundle);
    return map;
  }, [data]);

  const toggle = (entry: PluginEntryRecord) => run(entry.disabled ? "已启用" : "已停用", async () => {
    if (!entry.disabled) {
      const result = await bridge!.disablePlugin(entry.id);
      // 停用同时把已经加载的界面半边收回来：否则它登记的标签/面板还挂在界面上
      await clientHost().unload(entry.id);
      clientRuntime().loader.invalidate(entry.name || entry.id);
      return result;
    }
    const result = await bridge!.enablePlugin(entry.id);
    if (result?.ok === false) return result;
    await clientHost().dshSettings.refresh();
    // 重新启用：把界面半边装回去（与开机自动加载同一条路径）
    // 内置插件在 profile 里没有 bundle 记录，所以这里不能要求 bundle 存在
    const bundle = bundleOf.get(entry.id) || bundleOf.get(entry.name);
    if (entry.client || bundle?.client) await loadClientHalf(entry, bundle);
    return result;
  });

  const configurationFor = (entry: PluginEntryRecord) => <div className="plugin-config-editor">
    {clientHost().contributionsFor('plugins.bundle.config').some(row => row.pluginId === entry.id) ? (
      <div><p>以下设置保存到当前 DSH 插件会话。</p><PluginSlotView slot="plugins.bundle.config" pluginId={entry.id} sessionId={clientHost().dshSettings.sessionId()} /></div>
    ) : <p>此插件没有提供当前会话的设置表单。</p>}
    <details><summary>插件默认设置（高级）</summary><p>会话单独保存的设置优先使用。</p>
      <textarea aria-label={`${entry.id} 默认设置`} value={editing?.id === entry.id ? editing.text : JSON.stringify(entry.config ?? {}, null, 2)}
        onChange={event => setEditing({ id: entry.id, text: event.target.value })} spellCheck={false} rows={4} />
      <div className="plugin-config-actions"><button className="plugins-text-button" disabled={Boolean(busy)} onClick={() => run('已保存配置', async () => {
        let config;
        try { config = JSON.parse(editing?.id === entry.id ? editing.text : JSON.stringify(entry.config ?? {})); }
        catch { return { ok: false, error: '配置必须是合法 JSON' }; }
        return await bridge!.configurePlugin({ id: entry.id, config });
      })}>保存</button><button className="plugins-text-button" disabled={Boolean(busy)} onClick={() => setEditing(null)}>取消</button></div>
    </details>
  </div>;
  const verifiedEntries=entries.filter(entry=>isVerifiedEntry(entry,bundleOf.get(entry.name)?.version,catalog));
  const shownEntries=verifiedEntries.filter(entry=>{
    const approved=catalog.find(plugin=>isInstalled(plugin,[entry]));
    const builtin=entry.builtin?BUILTIN_PLUGIN_LABELS[entry.name]:undefined;
    return !marketQuery.trim()||[entry.id,entry.name,entry.description,bundleOf.get(entry.name)?.description,approved?.displayName,builtin?.name,builtin?.summary,...(approved?.tags||[])].join(' ').toLowerCase().includes(marketQuery.trim().toLowerCase());
  });
  const available=filterCatalog(marketQuery,marketCategory,catalog);
  const detailCatalog = catalog.find(plugin => plugin.id === detailSelection?.catalogId);
  const detailEntry = verifiedEntries.find(entry => entry.id === detailSelection?.entryId)
    || (detailCatalog ? entries.find(entry => isInstalled(detailCatalog, [entry])) : undefined);
  if (detailSelection && (detailEntry||detailCatalog)) return <>
    {marketSpec && <AddPluginDialog initialSpec={marketSpec} onClose={() => setMarketSpec('')} onInstalled={() => void refresh()} />}
    <PluginDetailPage entry={detailEntry} bundle={detailEntry ? bundleOf.get(detailEntry.name) : undefined} catalog={detailCatalog || catalog.find(plugin => plugin.packageName === detailEntry?.name)}
      busy={Boolean(busy)} error={error} notice={notice} refreshKey={refreshKey} configuration={detailEntry ? configurationFor(detailEntry) : undefined}
      onBack={() => { setDetailSelection(null); setEditing(null); }} onToggle={() => { if (detailEntry) void toggle(detailEntry); }}
      onUninstall={() => { if (detailEntry) void run('已卸载', async () => {
        const result = await bridge!.uninstallPlugin(bundleOf.get(detailEntry.name)?.name || detailEntry.id);
        if (result?.ok !== false) { await clientHost().unload(detailEntry.id); setDetailSelection(null); setEditing(null); }
        return result;
      }); }} onInstall={() => {
        const approved=detailCatalog||catalog.find(plugin=>plugin.packageName===detailEntry?.name);
        if(approved)setMarketSpec(approved.install);
      }}
      onLoadClient={() => { if (detailEntry) void loadClientHalf(detailEntry, bundleOf.get(detailEntry.name)); }}
      clientResult={detailEntry ? clientRuns[detailEntry.id]?.text : undefined} />
  </>;

  return (
    <section className="plugins-page">
      {marketSpec ? (
        <AddPluginDialog
          initialSpec={marketSpec}
          onClose={() => setMarketSpec("")}
          onInstalled={() => void refresh()}
        />
      ) : null}
      <header className="plugins-page-header">
        <div className="plugins-page-heading">
          <h1>插件</h1>
          <p>管理已安装插件，按需添加已验证的功能。</p>
        </div>
        <div className="plugins-page-actions">
          <button className="icon-button subtle" onClick={() => void refresh(true)} disabled={Boolean(busy)||catalogLoading} aria-label="刷新插件清单" title="刷新插件清单">
            {catalogLoading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          </button>
          <button className="plugins-add-button" onClick={() => {setView('available');setMarketQuery('');setMarketCategory('');}}>
            <Plus size={15} /> 添加插件
          </button>
        </div>
      </header>

      {error && <div className="plugins-message bad"><AlertTriangle size={14} /> <span>{error}</span></div>}
      {notice && !error && <div className="plugins-message ok"><Check size={14} /> <span>{notice}</span></div>}
      {data?.warnings?.length ? (
        <div className="plugins-message warn">{data.warnings.slice(0, 3).map((line) => <div key={line}>{line}</div>)}</div>
      ) : null}

      <div className="plugins-navigation" role="tablist" aria-label="插件列表">
        <button role="tab" aria-selected={view==='installed'} className={view==='installed'?'active':''} onClick={()=>{setView('installed');setMarketQuery('');}}>已安装 <span>{verifiedEntries.length}</span></button>
        <button role="tab" aria-selected={view==='available'} className={view==='available'?'active':''} onClick={()=>{setView('available');setMarketQuery('');}}>可安装 <span>{catalog.length}</span></button>
      </div>
      <div className="plugins-list-toolbar">
        <label className="plugins-market-search"><Search size={15}/><input aria-label="搜索插件" value={marketQuery} onChange={event=>setMarketQuery(event.target.value)} placeholder="搜索插件名称或功能"/></label>
        <span className="plugins-catalog-status" role="status">{catalogLoading?'正在更新清单…':catalogMeta.source==='platform'?'清单已从平台更新':catalogMeta.source==='cache'?'使用已保存清单':'随应用提供的清单'}</span>
      </div>
      {catalogMeta.notice&&<p className="plugins-catalog-notice">{catalogMeta.notice}</p>}
      {view==='available'&&<div className="plugins-group" role="tabpanel" aria-label="可安装插件">
        <div className="plugins-list-heading"><h2>可安装插件</h2><span>仅展示已验证的版本</span></div>
        <div className="plugins-market-categories">
          {['',...new Set(catalog.map(plugin=>plugin.category))].map(category=><button key={category} className={`plugin-category-chip ${marketCategory===category?'on':''}`} aria-pressed={marketCategory===category} onClick={()=>setMarketCategory(category)}>{category||'全部'}</button>)}
        </div>
        {available.map(plugin=>{
          const existing=entries.find(entry=>isInstalled(plugin,[entry]));
          const installed=existing&&bundleOf.get(existing.name)?.version===plugin.support.version;
          return <div className="plugin-card market" key={plugin.id}>
            <div className="plugin-card-icon" style={{'--plugin-tile':tileColor(plugin.packageName)} as React.CSSProperties}><Puzzle size={20}/></div>
            <div className="plugin-card-body">
              <div className="plugin-card-title"><button className="plugin-name-button" onClick={()=>{setError('');setNotice('');setDetailSelection({catalogId:plugin.id});}}>{plugin.displayName}</button><span className="plugin-tag ok"><Check size={11}/>已验证</span></div>
              <p className="plugin-card-desc">{plugin.summary}</p>
              <p className="plugin-row-meta">{plugin.category}<span>·</span>v{plugin.support.version}<span>·</span>{plugin.packageName}</p>
            </div>
            <button className="plugins-install-action" disabled={Boolean(busy)||catalogLoading||Boolean(installed)} onClick={()=>setMarketSpec(plugin.install)}>{installed?<><Check size={14}/>已安装</>:<><Plus size={14}/>{existing?'安装已验证版本':'安装'}</>}</button>
          </div>;
        })}
        {!catalogLoading&&!available.length&&<p className="plugins-empty">{marketQuery||marketCategory?'没有找到匹配的插件。':'当前没有适用于此版本和系统的已验证插件。'}</p>}
      </div>}

      {view==='installed'&&<div className="plugins-group" role="tabpanel" aria-label="已安装插件">
        <div className="plugins-list-heading"><h2>已安装插件</h2><span>启用后在适用任务中使用</span></div>

        {!catalogLoading&&shownEntries.length === 0 && (
          <p className="plugins-empty">
            {marketQuery?'没有找到匹配的插件。':'还没有安装已验证的插件，可在“可安装”中选择。'}
          </p>
        )}

        {shownEntries.map((entry) => {
          const bundle = bundleOf.get(entry.name);
          const builtin=entry.builtin?BUILTIN_PLUGIN_LABELS[entry.name]:undefined;
          const approved=catalog.find(plugin=>plugin.packageName===entry.name);
          const description = builtin?.summary||approved?.summary||bundle?.description || entry.description || "";
          return (
            <div className="plugin-card" key={entry.id}>
              <div className="plugin-card-icon" style={{ "--plugin-tile": tileColor(entry.name) } as React.CSSProperties}>
                <Puzzle size={18} />
              </div>
              <div className="plugin-card-body">
                <div className="plugin-card-title">
                  <span data-plugin-package={bundle?.name || entry.name}>
                    <button className="plugin-name-button" onClick={() => { setError(''); setNotice(''); setDetailSelection({ entryId: entry.id }); }}>{builtin?.name||approved?.displayName||entry.id}</button>
                  </span>
                  {bundle?.version ? <span className="plugin-tag">v{bundle.version}</span> : null}

                  <span className={`plugin-tag ${entry.active ? "ok" : ""}`}>{entry.disabled ? "已停用" : entry.active ? "已启动" : entry.state === "session-required" ? "用于 DSH 插件会话" : entry.state === "loading" ? "启动中" : entry.state === "failed" ? "启动失败" : "等待所需能力"}</span>
                  {bundle?.drift ? <span className="plugin-tag warn">版本漂移：{bundle.drift}</span> : null}
                  {/* 内置插件：随应用分发、开机自动加载，可停用但不能卸载（说明收进悬浮） */}
                  {entry.builtin ? (
                    <span className="plugin-tag" title="随应用分发，开机自动加载；可停用，但不能卸载">
                      内置
                    </span>
                  ) : null}
                </div>
                {description ? <p className="plugin-card-desc">{description}</p> : <p className="plugin-card-desc muted">{entry.name}</p>}
                {entry.error ? <div className="plugin-row-error"><AlertTriangle size={12} /> {entry.error}</div> : null}
                <div className="plugin-card-tools">
                  <button className="plugins-text-button" aria-label={`查看 ${entry.id} 详情`} onClick={() => { setError(''); setNotice(''); setDetailSelection({ entryId: entry.id }); }}>详情</button>
                  <button className="plugins-text-button" onClick={() => setDetailSelection({entryId:entry.id})}>
                    设置
                  </button>
                  {entry.builtin ? null : (
                    <button className="plugins-text-button danger" disabled={Boolean(busy)} onClick={() => run("已卸载", async () => {
                      const result=await bridge!.uninstallPlugin(bundle?.name||entry.id);
                      if(result?.ok!==false)await clientHost().unload(entry.id);
                      return result;
                    })}>
                      <Trash2 size={13} /> 卸载
                    </button>
                  )}
                </div>
                {editing?.id === entry.id && (
                  configurationFor(entry)
                )}
              </div>
              <button
                className={`plugin-switch ${entry.disabled ? "" : "on"}`}
                role="switch"
                aria-checked={!entry.disabled}
                aria-label={`${entry.disabled ? "启用" : "停用"} ${entry.id}`}
                disabled={Boolean(busy)}
                onClick={() => void toggle(entry)}
              >
                <span className="plugin-switch-knob" />
              </button>
            </div>
          );
        })}
      </div>}

      <footer className="plugins-page-footer">
        <span><Check size={13}/>清单更新不会自动升级已安装的插件</span>
        {catalogMeta.publishedAt&&<span>清单发布于 {new Date(catalogMeta.publishedAt).toLocaleDateString('zh-CN')}</span>}
        <details className="plugins-advanced"><summary>高级管理</summary><div>
          <span>插件目录：{data?.status?.dir||'—'}</span>
          <button className="plugins-text-button" onClick={()=>run('已重新载入清单',()=>bridge!.reloadPlugins())} disabled={Boolean(busy)}>重新载入清单</button>
        </div></details>
      </footer>
    </section>
  );
}
