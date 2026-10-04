import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, Puzzle, RefreshCw, Search, Sparkles, Star, Trash2 } from "lucide-react";
import { AddPluginDialog } from "./AddPluginDialog";
import { CATALOG_CATEGORIES, CATALOG_SNAPSHOT_DATE, filterCatalog, isInstalled } from "./pluginCatalog";
import { loadBundleScript } from "./pluginRuntime/index.ts";
import { clientHost } from "./pluginRuntime/clientHostSingleton.ts";
import { requestPluginPanels } from "./PluginSlotView";
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
  const [addOpen, setAddOpen] = useState(false);
  // 客户端半边试跑结果：记录"能加载吗、缺哪些模块、它要哪些客户端服务"
  const [clientRuns, setClientRuns] = useState<Record<string, { state: "loading" | "ok" | "error"; text: string }>>({});
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  // 插件市场：搜索词、分类、以及点「安装」时预填给添加向导的规格
  const [marketQuery, setMarketQuery] = useState("");
  const [marketCategory, setMarketCategory] = useState("");
  const [marketSpec, setMarketSpec] = useState("");

  const bridge = typeof window !== "undefined" ? window.dyworker : undefined;

  const refresh = useCallback(async () => {
    if (!bridge?.listPlugins) return;
    try {
      setData(await bridge.listPlugins());
      setError("");
    } catch (refreshError: any) {
      setError(String(refreshError?.message || refreshError));
    }
  }, [bridge]);

  useEffect(() => { void refresh(); }, [refresh]);

  /**
   * 加载插件的客户端半边（实验）。
   * 第 1 步只验证"能不能被加载器加载起来"——bundle 会执行并注册，但界面上还不会出现
   * 它贡献的面板（那需要第 2 步把宿主已有的面板注册成 dsh-client-* 服务）。
   */
  const loadClientHalf = async (entry: PluginEntryRecord, bundle: PluginBundleRecord | undefined) => {
    const key = entry.id;
    setClientRuns((current) => ({ ...current, [key]: { state: "loading", text: "正在加载客户端 bundle…" } }));
    try {
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
          const loaded = await loadBundleScript(moduleRef.url);
          moduleNotes.push(`${moduleRef.spec}${loaded.error ? "（失败）" : ""}`);
        } catch (error: any) {
          moduleNotes.push(`${moduleRef.spec}（${String(error?.message || error).slice(0, 40)}）`);
        }
      }
      const record = await loadBundleScript(primary.url);
      if (record.error) {
        setClientRuns((current) => ({ ...current, [key]: { state: "error", text: `bundle 执行失败：${record.error}` } }));
        return;
      }
      // 交给客户端插件宿主：它是 cordis 插件，由容器提供 slots/locale 等服务后 apply
      const pluginRecord = await clientHost().load(record.exports, record.id);
      if (!pluginRecord.ok) {
        setClientRuns((current) => ({ ...current, [key]: { state: "error", text: `插件 apply 失败：${pluginRecord.error}` } }));
        return;
      }
      // 它登记进宿主插槽的界面贡献：右侧面板标签会被壳层接进已有工具面板
      const panels = requestPluginPanels(record.id, pluginRecord.slots);
      const missing = record.missing.length ? `；缺模块 ${[...new Set(record.missing)].join("、")}` : "";
      const slots = pluginRecord.slots.length ? `；登记插槽 ${pluginRecord.slots.join("、")}` : "；没有登记界面位置";
      const pending = pluginRecord.missingCalls.length ? `；未实现调用 ${[...new Set(pluginRecord.missingCalls)].slice(0, 4).join("、")}` : "";
      const opened = panels.length ? `；已开右侧面板 ${panels.map((panel) => panel.label).join("、")}` : "";
      const modules = moduleNotes.length ? `；客户端模块 ${moduleNotes.length} 个（${moduleNotes.slice(0, 3).join("、")}${moduleNotes.length > 3 ? "…" : ""}）` : "";
      const missingModules = info.missingModules?.length ? `；模块未安装 ${info.missingModules.slice(0, 2).join("、")}` : "";
      setClientRuns((current) => ({
        ...current,
        [key]: { state: "ok", text: `已加载并 apply ${record.id}${modules}${slots}${opened}${missingModules}${missing}${pending}` },
      }));
    } catch (error: any) {
      setClientRuns((current) => ({ ...current, [key]: { state: "error", text: String(error?.message || error) } }));
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

  const toggle = (entry: PluginEntryRecord) => run(entry.active ? "已停用" : "已启用", () =>
    (entry.active ? bridge!.disablePlugin(entry.id) : bridge!.enablePlugin(entry.id)));

  return (
    <section className="plugins-page">
      {addOpen && <AddPluginDialog onClose={() => setAddOpen(false)} onInstalled={() => void refresh()} />}
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
          <p>安装、启用和配置插件</p>
        </div>
        <div className="plugins-page-actions">
          <button className="icon-button subtle" onClick={() => void refresh()} disabled={Boolean(busy)} aria-label="刷新" title="刷新">
            {busy === "刷新" ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          </button>
          <button className="plugins-add-button" onClick={() => setAddOpen(true)}>
            <Plus size={15} /> 添加插件
          </button>
        </div>
      </header>

      {error && <div className="plugins-message bad"><AlertTriangle size={14} /> <span>{error}</span></div>}
      {notice && !error && <div className="plugins-message ok"><Check size={14} /> <span>{notice}</span></div>}
      {data?.warnings?.length ? (
        <div className="plugins-message warn">{data.warnings.slice(0, 3).map((line) => <div key={line}>{line}</div>)}</div>
      ) : null}

      <div className="plugins-group">
        <div className="plugins-group-title">
          <span>插件市场</span>
          <span className="plugins-group-count">
            精选 {filterCatalog(marketQuery, marketCategory).length} 个 · 办公 / 政务
          </span>
        </div>
        <div className="plugins-market-toolbar">
          <label className="plugins-market-search">
            <Search size={14} />
            <input
              value={marketQuery}
              onChange={(event) => setMarketQuery(event.target.value)}
              placeholder="搜索插件：公文、发票、Excel、PDF…"
            />
          </label>
          <div className="plugins-market-categories">
            <button
              className={`plugin-category-chip ${marketCategory ? "" : "on"}`}
              onClick={() => setMarketCategory("")}
            >全部</button>
            {CATALOG_CATEGORIES.map((category) => (
              <button
                key={category}
                className={`plugin-category-chip ${marketCategory === category ? "on" : ""}`}
                onClick={() => setMarketCategory(category)}
              >{category}</button>
            ))}
          </div>
        </div>
        {filterCatalog(marketQuery, marketCategory).map((plugin) => {
          const installed = isInstalled(plugin, entries);
          return (
            <div className="plugin-card market" key={plugin.id}>
              <div className="plugin-card-icon" style={{ "--plugin-tile": tileColor(plugin.repo) } as React.CSSProperties}>
                <Puzzle size={18} />
              </div>
              <div className="plugin-card-body">
                <div className="plugin-card-title">
                  <strong>{plugin.repo}</strong>
                  <span className="plugin-tag"><Star size={11} /> {plugin.stars}</span>
                  <span className="plugin-tag">{plugin.category}</span>
                  {plugin.verified ? <span className="plugin-tag ok">本机已验证</span> : null}
                  {installed ? <span className="plugin-tag">已安装</span> : null}
                </div>
                <p className="plugin-card-desc">{plugin.summary}</p>
                <div className="plugin-card-tools">
                  {plugin.tags.map((tag) => <span className="plugin-market-tag" key={tag}>{tag}</span>)}
                  <button
                    className="plugins-text-button"
                    disabled={Boolean(busy) || installed}
                    onClick={() => setMarketSpec(plugin.install)}
                    title={installed ? "已经装过了" : `安装 ${plugin.packageName}`}
                  >
                    {installed ? <Check size={13} /> : <Plus size={13} />} {installed ? "已安装" : "安装"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {filterCatalog(marketQuery, marketCategory).length === 0 ? (
          <p className="plugins-empty">没有匹配的插件，换个关键词试试。</p>
        ) : null}
        <p className="plugins-hint">
          star 数为 {CATALOG_SNAPSHOT_DATE} 的快照（非实时）。点「安装」会带规格打开添加向导，
          先跑兼容性判定再决定装不装——市场只负责发现，不跳过检查。
        </p>
      </div>

      <div className="plugins-group">
        <div className="plugins-group-title">
          <span>已安装</span>
          <span className="plugins-group-count">{entries.length}</span>
        </div>

        {entries.length === 0 && (
          <p className="plugins-empty">
            还没有安装插件。点右上角「添加插件」，填入包名后先「检查兼容性」，确认能跑再安装。
          </p>
        )}

        {entries.map((entry) => {
          const bundle = bundleOf.get(entry.name);
          const description = bundle?.description || entry.description || "";
          // 手工加进 dyworker.yml 的插件没有 bundle 记录，客户端半边信息在条目上
          const clientHalf = bundle?.client || entry.client || null;
          return (
            <div className="plugin-card" key={entry.id}>
              <div className="plugin-card-icon" style={{ "--plugin-tile": tileColor(entry.name) } as React.CSSProperties}>
                <Puzzle size={18} />
              </div>
              <div className="plugin-card-body">
                <div className="plugin-card-title">
                  <strong>{entry.id}</strong>
                  {bundle?.version ? <span className="plugin-tag">v{bundle.version}</span> : null}
                  {bundle && !bundle.declared ? <span className="plugin-tag">单条目</span> : null}
                  {entry.disabled ? <span className="plugin-tag">已停用</span> : null}
                  {bundle?.drift ? <span className="plugin-tag warn">版本漂移：{bundle.drift}</span> : null}
                </div>
                {description ? <p className="plugin-card-desc">{description}</p> : <p className="plugin-card-desc muted">{entry.name}</p>}
                {entry.error ? <div className="plugin-row-error"><AlertTriangle size={12} /> {entry.error}</div> : null}
                {clientHalf ? (
                  <div className="plugin-card-client">
                    <span className="plugin-tag">界面半边</span>
                    <span className="plugin-card-client-meta">
                      {clientHalf.platform || "web"}
                      {clientHalf.inject?.length ? ` · 声明依赖 ${clientHalf.inject.length} 个客户端服务` : ""}
                    </span>
                    <button
                      className="plugins-text-button"
                      disabled={clientRuns[entry.id]?.state === "loading"}
                      onClick={() => void loadClientHalf(entry, bundle)}
                    >
                      {clientRuns[entry.id]?.state === "loading" ? <Loader2 size={13} className="spin" /> : null}
                      加载界面半边（实验）
                    </button>
                    {clientRuns[entry.id] && clientRuns[entry.id].state !== "loading" ? (
                      <div className={`plugin-client-result ${clientRuns[entry.id].state}`}>
                        {clientRuns[entry.id].state === "ok" ? <Check size={12} /> : <AlertTriangle size={12} />}
                        <span>{clientRuns[entry.id].text}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="plugin-card-tools">
                  <button className="plugins-text-button" onClick={() => setEditing(editing?.id === entry.id ? null : { id: entry.id, text: JSON.stringify(entry.config ?? {}, null, 2) })}>
                    配置
                  </button>
                  <button className="plugins-text-button danger" disabled={Boolean(busy)} onClick={() => run("已卸载", () => bridge!.uninstallPlugin(bundle?.name || entry.id))}>
                    <Trash2 size={13} /> 卸载
                  </button>
                </div>
                {editing?.id === entry.id && (
                  <div className="plugin-config-editor">
                    <textarea value={editing.text} onChange={(event) => setEditing({ id: entry.id, text: event.target.value })} spellCheck={false} rows={4} />
                    <div className="plugin-config-actions">
                      <button className="plugins-text-button" onClick={() => run("已保存配置", async () => {
                        try {
                          return await bridge!.configurePlugin({ id: entry.id, config: JSON.parse(editing.text) });
                        } catch {
                          return { ok: false, error: "配置必须是合法 JSON" };
                        }
                      })}>保存</button>
                      <button className="plugins-text-button" onClick={() => setEditing(null)}>取消</button>
                    </div>
                  </div>
                )}
              </div>
              <button
                className={`plugin-switch ${entry.active ? "on" : ""}`}
                role="switch"
                aria-checked={entry.active}
                aria-label={`${entry.active ? "停用" : "启用"} ${entry.id}`}
                disabled={Boolean(busy)}
                onClick={() => void toggle(entry)}
              >
                <span className="plugin-switch-knob" />
              </button>
            </div>
          );
        })}
      </div>

      <footer className="plugins-page-footer">
        <span>插件目录：{data?.status?.dir || "—"}</span>
        {data?.status?.failed ? <span className="bad">{data.status.failed} 个失败</span> : null}
        <button className="plugins-text-button" onClick={() => run("已重新载入清单", () => bridge!.reloadPlugins())} disabled={Boolean(busy)}>
          重新载入清单
        </button>
        <span className="plugins-hint"><Sparkles size={12} /> 插件工具与内置工具走同一套审批与审计</span>
      </footer>
    </section>
  );
}
