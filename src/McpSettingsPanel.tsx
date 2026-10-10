import { useEffect, useState } from "react";
import { ArrowLeft, Pencil, Plus, Trash2, Upload } from "lucide-react";
import type { McpServerConfig, ProviderSettings } from "./types";

type Pair = [string, string];
const blank = (): McpServerConfig => ({ id: crypto.randomUUID(), name: "", command: "", args: [], enabled: true, transport: "stdio" });
function PairFields({ title, value, onChange, addLabel }: { title: string; value: Pair[]; onChange: (v: Pair[]) => void; addLabel: string }) {
  return <div className="mcp-field"><span>{title}</span>{value.map(([key, val], index) => <div className="mcp-pair" key={index}>
    <input aria-label={`${title}键 ${index + 1}`} placeholder="键" value={key} onChange={e => onChange(value.map((row, i) => i === index ? [e.target.value, val] : row))} />
    <input aria-label={`${title}值 ${index + 1}`} placeholder="值" value={val} onChange={e => onChange(value.map((row, i) => i === index ? [key, e.target.value] : row))} />
    <button type="button" className="icon-button subtle" aria-label={`删除${title} ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={14}/></button>
  </div>)}<button type="button" className="mcp-add-row" onClick={() => onChange([...value, ["", ""]])}><Plus size={14}/>{addLabel}</button></div>;
}
function ListFields({ title, value, onChange, addLabel }: { title: string; value: string[]; onChange: (v: string[]) => void; addLabel: string }) {
  return <div className="mcp-field"><span>{title}</span>{value.map((val, index) => <div className="mcp-list-row" key={index}>
    <input aria-label={`${title} ${index + 1}`} value={val} onChange={e => onChange(value.map((row, i) => i === index ? e.target.value : row))}/>
    <button type="button" className="icon-button subtle" aria-label={`删除${title} ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={14}/></button>
  </div>)}<button type="button" className="mcp-add-row" onClick={() => onChange([...value, ""])}><Plus size={14}/>{addLabel}</button></div>;
}
export function McpSettingsPanel({ value, onSave }: { value: ProviderSettings; onSave: (v: ProviderSettings, message?: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState<McpServerConfig | null>(null);
  const [pairs, setPairs] = useState<{env: Pair[]; headers: Pair[]; envHeaders: Pair[]}>({env: [], headers: [], envHeaders: []});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!draft) return;
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopImmediatePropagation(); setDraft(null); setError(''); } };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  }, [draft, busy]);
  const edit = (server: McpServerConfig) => { setError(""); setDraft(structuredClone(server)); setPairs({env: Object.entries(server.env || {}), headers: Object.entries(server.headers || {}), envHeaders: Object.entries(server.envHeaders || {})}); };
  const persist = async (servers: McpServerConfig[], message: string) => {
    setBusy(true); setError("");
    try { const saved = await onSave({...value, mcpServers: servers}, message); if (!saved) setError("保存失败，请重试。"); return saved; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!draft || busy) return;
    try {
      if (!draft.name.trim()) throw new Error("请填写名称。");
      if (draft.transport === "http") { const url = new URL(draft.url || ""); if (!['https:', 'http:'].includes(url.protocol)) throw new Error("URL 需要以 http:// 或 https:// 开头。"); }
      else if (!draft.command.trim()) throw new Error("请填写启动命令。");
      for (const rows of Object.values(pairs)) { const keys = rows.map(([key]) => key.trim()).filter(Boolean); if (new Set(keys).size !== keys.length) throw new Error("同一组不能填写重复的键。"); if (rows.some(([key, val]) => !key.trim() && val)) throw new Error("请补齐键名称。"); }
      for (const [key, field] of Object.entries(draft.bundle?.manifest.user_config || {}) as [string, any][]) {
        const val = draft.bundle?.userConfig[key];
        if (field.required && (val == null || val === "" || (Array.isArray(val) && !val.length))) throw new Error(`请填写${field.title || key}。`);
        if (field.type === 'number' && val != null && val !== '' && (!Number.isFinite(Number(val)) || (field.min != null && Number(val) < field.min) || (field.max != null && Number(val) > field.max))) throw new Error(`${field.title || key}超出允许范围。`);
      }
      const record = {...draft, name: draft.name.trim(), command: draft.command.trim(), ...Object.fromEntries(Object.entries(pairs).map(([key, rows]) => [key, Object.fromEntries(rows.filter(([name]) => name.trim()).map(([name, val]) => [name.trim(), val]))]))};
      const servers = value.mcpServers.some(row => row.id === record.id) ? value.mcpServers.map(row => row.id === record.id ? record : row) : [...value.mcpServers, record];
      if (await persist(servers, `已保存「${record.name}」`)) setDraft(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const importBundle = async () => {
    setBusy(true); setError("");
    try { const result = await window.dyworker?.importMcpBundle(); if (result?.server) edit(result.server); else if (result?.error) setError(result.error); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <div className="mcp-settings-panel">
    {draft ? <>
      <button type="button" className="plugins-text-button" disabled={busy} onClick={() => {setDraft(null); setError("");}}><ArrowLeft size={14}/>返回 MCP</button>
      <h3>{value.mcpServers.some(row => row.id === draft.id) ? "编辑自定义 MCP" : "连接至自定义 MCP"}</h3>
      <a className="mcp-doc-link" href="https://modelcontextprotocol.io/docs/develop/connect-local-servers" target="_blank" rel="noreferrer">文档 ↗</a>
      <fieldset disabled={busy} className="mcp-editor-fields">
      <div className="mcp-form-card">
        <label className="mcp-field">名称<input placeholder="MCP server name" value={draft.name} onChange={e => setDraft({...draft, name: e.target.value})}/></label>
        <div className="mcp-type-row"><span>类型</span><div role="tablist" aria-label="MCP 连接类型">{(['stdio', 'http'] as const).map(type => <button type="button" role="tab" aria-selected={(draft.transport || 'stdio') === type} key={type} onClick={() => setDraft({...draft, transport: type})}>{type === 'stdio' ? 'STDIO' : '流式 HTTP'}</button>)}</div></div>
      </div>
      <div className="mcp-form-card">
      {draft.transport === 'http' ? <>
        <label className="mcp-field">URL<input placeholder="https://mcp.example.com/mcp" value={draft.url || ''} onChange={e => setDraft({...draft, url: e.target.value})}/></label>
        <label className="mcp-field">Bearer 令牌环境变量<input placeholder="MCP_BEARER_TOKEN" value={draft.bearerTokenEnvVar || ''} onChange={e => setDraft({...draft, bearerTokenEnvVar: e.target.value})}/></label>
        <PairFields title="标头" value={pairs.headers} onChange={headers => setPairs({...pairs, headers})} addLabel="添加标头"/>
        <PairFields title="来自环境变量的标头" value={pairs.envHeaders} onChange={envHeaders => setPairs({...pairs, envHeaders})} addLabel="添加变量"/>
      </> : <>
        <label className="mcp-field">启动命令<input placeholder="openai-dev-mcp" value={draft.command} onChange={e => setDraft({...draft, command: e.target.value})}/></label>
        <ListFields title="参数" value={draft.args} onChange={args => setDraft({...draft, args})} addLabel="添加参数"/>
        <PairFields title="环境变量" value={pairs.env} onChange={env => setPairs({...pairs, env})} addLabel="添加环境变量"/>
        <ListFields title="环境变量传递" value={draft.envPassthrough || []} onChange={envPassthrough => setDraft({...draft, envPassthrough})} addLabel="添加变量"/>
        <label className="mcp-field">工作目录<input placeholder="~/code" value={draft.cwd || ''} onChange={e => setDraft({...draft, cwd: e.target.value})}/></label>
      </>}
      </div>
      {draft.bundle && <div className="mcp-form-card"><h4>文件所需设置</h4>{Object.entries(draft.bundle.manifest.user_config || {}).map(([key, field]: [string, any]) => <label className="mcp-field" key={key}>{field.title || key}{field.required ? ' *' : ''}<small>{field.description}</small>
        {field.multiple ? <textarea rows={3} value={(draft.bundle!.userConfig[key] || []).join?.('\n') || ''} placeholder="每行填写一个值" onChange={e => setDraft({...draft, bundle: {...draft.bundle!, userConfig: {...draft.bundle!.userConfig, [key]: e.target.value.split('\n').filter(Boolean)}}})}/> : field.type === 'boolean' ? <input type="checkbox" checked={draft.bundle!.userConfig[key] === true} onChange={e => setDraft({...draft, bundle: {...draft.bundle!, userConfig: {...draft.bundle!.userConfig, [key]: e.target.checked}}})}/> : <input type={field.sensitive ? 'password' : field.type === 'number' ? 'number' : 'text'} value={Array.isArray(draft.bundle!.userConfig[key]) ? draft.bundle!.userConfig[key].join('\n') : draft.bundle!.userConfig[key] ?? ''} placeholder={field.multiple ? '多个值用换行分隔' : ''} onChange={e => setDraft({...draft, bundle: {...draft.bundle!, userConfig: {...draft.bundle!.userConfig, [key]: field.multiple ? e.target.value.split('\n') : field.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value}}})}/>}
      </label>)}</div>}
      </fieldset>
      <div className="mcp-editor-actions"><button type="button" className="plugins-add-button" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</button></div>
    </> : <>
      <header className="mcp-list-heading"><h3>MCP</h3><div><button type="button" className="plugins-text-button" disabled={busy} onClick={() => void importBundle()}><Upload size={14}/>导入 .mcpb</button><button type="button" className="plugins-add-button" disabled={busy} onClick={() => edit(blank())}><Plus size={14}/>添加 MCP</button></div></header>
      <p className="dialog-note">连接本地或网络上的工具服务。</p>
      {value.mcpServers.length === 0 && <p className="dialog-note">还没有添加 MCP。</p>}
      {value.mcpServers.map(server => <div className="mcp-server-row" key={server.id}>
        <span className="mcp-server-name"><strong>{server.name}</strong><small>{server.configUnavailable ? '暂时无法读取已保存的连接设置' : server.bundle ? `.mcpb · ${server.bundle.manifest.version}` : server.transport === 'http' ? server.url : [server.command, ...server.args].join(' ')}</small></span>
        <button type="button" className="icon-button subtle" disabled={busy || server.configUnavailable} aria-label={`编辑 ${server.name}`} onClick={() => edit(server)}><Pencil size={15}/></button>
        <button type="button" className="icon-button subtle" disabled={busy} aria-label={`删除 ${server.name}`} onClick={() => void persist(value.mcpServers.filter(row => row.id !== server.id), `已删除「${server.name}」`)}><Trash2 size={15}/></button>
        <label className="skill-switch"><input aria-label={`启用 ${server.name}`} disabled={busy} type="checkbox" checked={server.enabled} onChange={e => void persist(value.mcpServers.map(row => row.id === server.id ? {...row, enabled: e.target.checked} : row), e.target.checked ? '已启用' : '已停用')}/></label>
      </div>)}
    </>}
    {error && <p className="plugins-message bad" role="alert">{error}</p>}
  </div>;
}
