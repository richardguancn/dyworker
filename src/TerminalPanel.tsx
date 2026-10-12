import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Maximize2, Minimize2, PanelBottomClose, Plus, SquareTerminal, X } from 'lucide-react';

type Tab = { key: string; scope: string; title: string };
type TerminalEvent = { id: string; seq?: number; data?: string; exited?: boolean; exitCode?: number };

function TerminalScreen({ active, tab, onError, onDirectory }: { active: boolean; tab: Tab; onError: (error: string) => void; onDirectory: (key: string, cwd: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const fitRef = useRef<() => void>(() => {});
  const focusRef = useRef<() => void>(() => {});
  const [exited, setExited] = useState(false);
  useEffect(() => {
    const bridge = window.dyworker;
    if (!bridge || !container.current) { onError('请在桌面应用中打开终端。'); return; }
    let cancelled = false;
    let id = '';
    let replayed = false;
    let lastSeq = 0;
    let pending: TerminalEvent[] = [];
    let writeQueue = Promise.resolve();
    const element = container.current;
    const terminal = new Terminal({
      cursorBlink: true, cursorStyle: 'bar', fontSize: 15,
      fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      lineHeight: 1.35, scrollback: 10000, allowProposedApi: false,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    const report = (result: { ok: boolean; error?: string }) => { if (!result.ok && !cancelled) onError(result.error || '终端操作失败。'); };
    const fitNow = () => {
      if (cancelled || !element.offsetWidth || !element.offsetHeight) return;
      fit.fit();
      if (id) void bridge.resizeTerminal({ id, cols: terminal.cols, rows: terminal.rows }).then(report).catch(error => onError(String(error)));
    };
    fitRef.current = fitNow;
    focusRef.current = () => terminal.focus();
    const observer = new ResizeObserver(fitNow);
    observer.observe(element);
    const updateTheme = () => {
      const style = getComputedStyle(element);
      terminal.options.theme = {
        background: style.backgroundColor, foreground: style.color,
        cursor: style.color, selectionBackground: '#7f94b866',
      };
    };
    updateTheme();
    const themeObserver = new MutationObserver(updateTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', updateTheme);
    terminal.attachCustomKeyEventHandler(event => {
      if (event.type === 'keydown' && event.metaKey && event.key.toLowerCase() === 'c' && terminal.hasSelection()) {
        void bridge.writeClipboardText(terminal.getSelection());
        return false;
      }
      if ((event.metaKey || (bridge.platform !== 'darwin' && event.ctrlKey)) && event.key.toLowerCase() === 'j') return false;
      return true;
    });
    const input = terminal.onData(data => {
      if (!id || cancelled) return;
      // Large pastes remain ordered and within the bridge's per-message size limit.
      for (let offset = 0; offset < data.length; offset += 32768) {
        const part = data.slice(offset, offset + 32768);
        writeQueue = writeQueue.then(async () => {
          if (!cancelled) report(await bridge.writeTerminal({ id, data: part }));
        }).catch(error => { if (!cancelled) onError(String(error)); });
      }
    });
    const consume = (event: TerminalEvent) => {
      if (event.seq && event.seq > lastSeq) {
        lastSeq = event.seq;
        terminal.write(event.data || '');
      }
      if (event.exited) setExited(true);
    };
    const off = bridge.onTerminalEvent(event => {
      if (cancelled) return;
      if (!replayed) { pending.push(event); return; }
      if (event.id === id) consume(event);
    });
    void (async () => {
      try {
        fitNow();
        const result = await bridge.createTerminal({ workspacePath: tab.scope, cols: terminal.cols, rows: terminal.rows });
        if (!result.ok || !result.id) { report(result); return; }
        id = result.id;
        if (cancelled) { await bridge.closeTerminal({ id }); return; }
        if (result.cwd) onDirectory(tab.key, result.cwd);
        const snapshot = await bridge.readTerminal({ id });
        if (cancelled) return;
        report(snapshot);
        for (const chunk of snapshot.chunks || []) consume({ id, ...chunk });
        if (snapshot.exited) setExited(true);
        for (const event of pending) if (event.id === id) consume(event);
        pending = [];
        replayed = true;
        fitNow();
        if (element.offsetWidth) terminal.focus();
      } catch (error) { if (!cancelled) onError(String(error)); }
    })();
    return () => {
      cancelled = true;
      off(); observer.disconnect(); themeObserver.disconnect(); scheme.removeEventListener('change', updateTheme);
      input.dispose(); terminal.dispose();
      if (id) void bridge.closeTerminal({ id }).catch(() => {});
    };
  }, [tab.key, tab.scope]);
  useEffect(() => { if (active) { fitRef.current(); focusRef.current(); } }, [active]);
  return <div className="terminal-screen-wrap" hidden={!active}>
    <div ref={container} className="terminal-screen" aria-label={`终端 ${tab.title}`} />
    {exited && <div className="terminal-exit" role="status">终端已退出，可以新建终端。</div>}
  </div>;
}

export function TerminalPanel({ workspacePath = '', visible = true, onClose }: { workspacePath?: string; visible?: boolean; onClose?: () => void }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeKeys, setActiveKeys] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const scope = workspacePath;
  const scopedTabs = tabs.filter(tab => tab.scope === scope);
  const activeKey = activeKeys[scope] || scopedTabs.at(-1)?.key;
  const title = scope.split(/[\\/]/).filter(Boolean).at(-1) || '终端';
  const create = () => {
    const tab = { key: crypto.randomUUID(), scope, title };
    setTabs(current => [...current, tab]);
    setActiveKeys(current => ({ ...current, [scope]: tab.key }));
    setError('');
  };
  useEffect(() => {
    if (!visible) return;
    // Functional update prevents StrictMode from opening a second default tab.
    setTabs(current => current.some(tab => tab.scope === scope) ? current : [...current, { key: crypto.randomUUID(), scope, title }]);
    setError('');
  }, [scope, visible]);
  const close = (key: string) => {
    const remaining = scopedTabs.filter(tab => tab.key !== key);
    setTabs(current => current.filter(tab => tab.key !== key));
    if (activeKey === key) setActiveKeys(current => ({ ...current, [scope]: remaining.at(-1)?.key || '' }));
    if (!remaining.length) onClose?.();
  };
  return <section className={`terminal-panel${expanded ? ' expanded' : ''}`} aria-label="终端面板">
    <header className="terminal-header">
      <div className="terminal-tabs" role="tablist" aria-label="终端标签">
        {scopedTabs.map((tab, index) => <div key={tab.key} className={`terminal-tab${activeKey === tab.key ? ' active' : ''}`}>
          <button role="tab" aria-selected={activeKey === tab.key} title={scope || '应用启动目录'} onClick={() => setActiveKeys(current => ({ ...current, [scope]: tab.key }))}>
            <SquareTerminal size={16} /><span>{tab.title}{index > 0 ? ` ${index + 1}` : ''}</span>
          </button>
          <button className="terminal-tab-close" aria-label={`关闭终端 ${index + 1}`} onClick={() => close(tab.key)}><X size={14} /></button>
        </div>)}
      </div>
      <button className="terminal-control" aria-label="新建终端" title="新建终端" onClick={create}><Plus size={19} /></button>
      <div className="terminal-header-space" />
      <button className="terminal-control" aria-label={expanded ? '还原终端' : '放大终端'} title={expanded ? '还原终端' : '放大终端'} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      <button className="terminal-control" aria-label="收起终端" title="收起终端" onClick={onClose}><PanelBottomClose size={18} /></button>
    </header>
    {error && <p className="terminal-error" role="alert">{error}</p>}
    <div className="terminal-body">
      {tabs.map(tab => <TerminalScreen key={tab.key} tab={tab} active={visible && tab.scope === scope && tab.key === activeKey} onError={setError}
        onDirectory={(key, cwd) => setTabs(current => current.map(item => item.key === key ? { ...item, title: cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd } : item))} />)}
    </div>
  </section>;
}
