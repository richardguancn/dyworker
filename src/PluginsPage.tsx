import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, Puzzle, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { AddPluginDialog } from "./AddPluginDialog";
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
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

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
          return (
            <div className="plugin-card" key={entry.id}>
              <div className="plugin-card-icon" style={{ background: tileColor(entry.name) }}>
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
