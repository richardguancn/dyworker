import React, { useEffect, useState } from 'react';

async function call(action: string, signal?: AbortSignal) {
  const response = await fetch('/api/qwenpaw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }), signal });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'QwenPaw 无法连接');
  return result.value;
}
const css = `.plugin-slot-view[data-plugin="qwenpaw"]{display:flex;flex:1;min-width:0;min-height:0;padding:0;overflow:hidden}.plugin-slot-view[data-plugin="qwenpaw"]>.plugin-slot-item{display:flex;flex:1;min-height:0;min-width:0}.qwenpaw-page{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;color:var(--ink)}.qwenpaw-toolbar{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border);font-size:12px;flex-wrap:wrap}.qwenpaw-toolbar span{flex:1;color:var(--muted)}.qwenpaw-toolbar button,.qwenpaw-start button{font:inherit;padding:7px 12px;border:1px solid var(--border);background:var(--card);color:var(--ink);border-radius:8px;cursor:pointer}.qwenpaw-page iframe{border:0;flex:1;width:100%;min-height:0;background:var(--card)}.qwenpaw-start{margin:auto;padding:28px;max-width:580px;line-height:1.8}.qwenpaw-start [role=alert]{color:#c33;overflow-wrap:anywhere}`;
function QwenPawPage({ visible = true }: { visible?: boolean }) {
  const [state, setState] = useState<any>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const embedded = typeof document !== 'undefined' && (document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || '').includes('http://127.0.0.1:18888');
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    const refresh = async () => { try { setState(await call('status', abort.signal)); } catch (e: any) { if (!abort.signal.aborted) setError(e.message); } };
    void refresh(); const timer = setInterval(refresh, 3000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [visible]);
  async function perform(action: string) {
    setBusy(true); setError('');
    try { setState(await call(action)); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function openAssistant() {
    try {
      const result = await (window as any).dyworker?.openBrowserExternal?.(state.url);
      if (!result?.ok) throw new Error(result?.error || '无法打开助手页面');
    } catch (e: any) { setError(e.message); }
  }
  return <div className="qwenpaw-page"><style>{css}</style>
    {state?.running ? <><div className="qwenpaw-toolbar"><strong>QwenPaw</strong><span>聊天和记忆独立保存；模型和操作确认在助手页面设置。</span><button onClick={() => void openAssistant()}>打开助手</button><button disabled={busy} onClick={() => void perform('stop')}>关闭 QwenPaw</button></div>
      {embedded ? <iframe title="QwenPaw 助手" src={state.url} allow="clipboard-read; clipboard-write" /> : <div className="qwenpaw-start"><h2>QwenPaw 已启动</h2><p>点击“打开助手”，进入 QwenPaw 原版页面。聊天和记忆会在本机保留。</p><button onClick={() => void openAssistant()}>打开助手</button>{error && <p role="alert">{error}</p>}</div>}</>
      : <div className="qwenpaw-start"><h2>QwenPaw 助手</h2><p>使用 QwenPaw 原版界面创建助手、管理记忆和安排工作。首次启动后，请在页面中配置模型。</p><p>DeepSeek-Bot 的聊天和记忆仍保留，两个插件的数据不会混在一起。</p>
      {(error || state?.error) && <p role="alert">{error || state.error}</p>}<button disabled={busy || state?.starting} onClick={() => void perform('start')}>{busy || state?.starting ? '正在启动…' : '启动 QwenPaw'}</button></div>}
  </div>;
}
export default { name: 'qwenpaw-client', inject: ['slots'], apply(ctx: any) {
  ctx.slots.inject('workspace.page', () => ctx.slots.register({ name: 'workspace.page', id: 'qwenpaw', key: 'qwenpaw', order: 50, label: () => 'QwenPaw 助手' }, QwenPawPage));
  // 已安装的旧版 DYWorker 通过会话工具入口打开；新版同时提供侧栏入口。
  ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'qwenpaw', key: 'qwenpaw', order: 50, label: () => 'QwenPaw 助手' }, QwenPawPage));
} };
