import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, Copy, FileSearch, FolderOpen, MoreHorizontal, Monitor, Terminal, WrapText } from 'lucide-react';

type Props = {
  path?: string; workspacePath: string; content?: string; textReady?: boolean;
  wrap: boolean; onToggleWrap: () => void; treeVisible?: boolean; onToggleTree?: () => void;
  onChooseFile?: () => void; onToggleSource?: () => void; showSource?: boolean;
  onRefresh?: () => void; status?: ReactNode; beforeOpen?: () => Promise<void>;
};

export function FileBrowserToolbar({ path, workspacePath, content, textReady, wrap, onToggleWrap, treeVisible, onToggleTree, onChooseFile, onToggleSource, showSource, onRefresh, status, beforeOpen }: Props) {
  const [menu, setMenu] = useState<'paths' | 'more' | 'open' | null>(null);
  const [pathKind, setPathKind] = useState<'absolute' | 'projectRelative' | 'repositoryRelative'>('absolute');
  const [paths, setPaths] = useState<{ absolute?: string; projectRelative?: string; repositoryRelative?: string }>({});
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [appIcon, setAppIcon] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!menu) return;
    const position = () => {
      const anchor = host.current?.querySelector('[aria-expanded="true"]')?.getBoundingClientRect();
      const bounds = host.current?.getBoundingClientRect();
      if (!anchor || !bounds) return;
      // 菜单按内容自适应宽度：先量内容宽度（临时清掉上一轮的行内宽度），再贴齐触发按钮
      const node = menuRef.current;
      const applied = node?.style.width || '';
      if (node) node.style.width = 'auto';
      const natural = node?.getBoundingClientRect().width || 0;
      if (node) node.style.width = applied;
      const width = Math.max(132, Math.min(natural || 234, window.innerWidth - 24));
      const left = Math.max(12, Math.min(Math.max(bounds.left + 8, anchor.right - width), bounds.right - width - 8, window.innerWidth - width - 12));
      const height = node?.getBoundingClientRect().height || 180;
      setMenuStyle({ position: 'fixed', left, right: 'auto', top: Math.max(12, Math.min(anchor.bottom + 6, window.innerHeight - height - 12)), width, zIndex: 2000 });
    };
    position(); window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    const observer = new ResizeObserver(position); if (host.current) observer.observe(host.current);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [menu]);
  const dropdown = (label: string, children: ReactNode) => createPortal(<div ref={menuRef} style={menuStyle} className="file-browser-menu" role="menu" aria-label={label}>{children}</div>, document.body);
  useEffect(() => {
    let cancelled = false;
    setPaths({}); setMenu(null); setError(''); setFeedback('');
    if (path) void window.dyworker?.fileBrowserPaths?.(workspacePath, path).then(result => { if (!cancelled && result.ok) setPaths(result); }).catch(() => {});
    return () => { cancelled = true; };
  }, [path, workspacePath]);
  // 「打开」显示文件默认应用的图标；取不到时回退到通用图标
  useEffect(() => {
    let cancelled = false;
    setAppIcon('');
    if (!path) return;
    void window.dyworker?.fileAppIcon?.(workspacePath, path).then(result => { if (!cancelled && result?.ok && result.data) setAppIcon(result.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [path, workspacePath]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenu(null); host.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
        if (!items.length) return;
        event.preventDefault(); const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', keys); };
  }, [menu]);
  useEffect(() => { if (!feedback) return; const timer = window.setTimeout(() => setFeedback(''), 2200); return () => window.clearTimeout(timer); }, [feedback]);
  const toggle = (next: typeof menu) => { setError(''); setMenu(value => value === next ? null : next); };
  const absolute = paths.absolute || (path && (/^(?:\/|[A-Za-z]:[\\/])/.test(path) ? path : `${workspacePath.replace(/[\\/]+$/, '')}/${path}`));
  const copy = async (value?: string) => {
    setMenu(null); setError('');
    if (value === undefined) { setError('当前文件没有可复制的内容或路径'); return; }
    try {
      if (window.dyworker?.writeClipboardText) { if (!(await window.dyworker.writeClipboardText(value)).ok) throw new Error('复制失败'); }
      else await navigator.clipboard.writeText(value);
      setFeedback('已复制');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const act = async (action: 'default' | 'terminal' | 'folder' | 'save') => {
    if (!path || !absolute || opening) return;
    setMenu(null); setError(''); setOpening(true);
    try {
      if (action !== 'save') await beforeOpen?.();
      const bridge = window.dyworker;
      const result = action === 'terminal' ? await bridge?.openFileTerminal?.(workspacePath, path)
        : action === 'save' ? await bridge?.saveFileAs?.(workspacePath, path, textReady ? content : undefined)
        : action === 'folder' ? await bridge?.revealInFolder(absolute) : await bridge?.openPath(absolute);
      if (!result?.ok) throw new Error(result?.error || '当前环境无法执行此操作');
      if (action === 'save' && !('canceled' in result && result.canceled)) setFeedback('已另存为');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setOpening(false); }
  };
  const rootName = workspacePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '文件';
  const AppMark = appIcon
    ? <img className="file-browser-app-icon" src={appIcon} alt="" aria-hidden="true" />
    : <Monitor size={17} aria-hidden="true" />;
  const relative = paths.projectRelative || (path?.startsWith(`${workspacePath}/`) ? path.slice(workspacePath.length + 1) : path?.split(/[\\/]/).pop());
  const segments = [rootName, ...(relative ? relative.split(/[\\/]/) : [])];
  return <div className="file-browser-header" ref={host}>
    <div className="file-browser-toolbar">
      <button className="file-browser-breadcrumb" title={absolute || workspacePath} onClick={onChooseFile} disabled={!onChooseFile} aria-label={onChooseFile ? '选择文件' : '文件路径'}>
        {segments.map((segment, i) => <span className={i === segments.length - 1 && path ? 'current' : ''} key={i}>{i > 0 && <ChevronRight size={14} />}<span>{segment}</span></span>)}
      </button>
      <div className="file-browser-actions">
        {status}
        <div className="file-browser-menu-anchor">
          <div className="file-browser-pill split">
            <button aria-label="复制路径" title="复制路径" disabled={!path} onClick={() => void copy(pathKind === 'absolute' ? absolute : paths[pathKind])}><Copy size={17} /></button>
            <button aria-label="路径复制方式" aria-haspopup="menu" aria-expanded={menu === 'paths'} disabled={!path} onClick={() => toggle('paths')}><ChevronDown size={14} /></button>
          </div>
          {menu === 'paths' && dropdown('路径复制方式', <>
            {([['absolute', '绝对路径'], ['projectRelative', '相对于项目的路径'], ['repositoryRelative', '相对于仓库根目录']] as const).map(([kind, label]) => <button role="menuitemradio" aria-checked={pathKind === kind} key={kind} disabled={kind === 'repositoryRelative' && paths.repositoryRelative === undefined} title={kind === 'repositoryRelative' && paths.repositoryRelative === undefined ? '当前文件不在 Git 仓库中' : undefined} onClick={() => { setPathKind(kind); void copy(kind === 'absolute' ? absolute : paths[kind]); }}><span>{label}</span>{pathKind === kind && <Check size={14} />}</button>)}
          </>)}
        </div>
        <div className="file-browser-menu-anchor">
          <button className="file-browser-pill icon" aria-label="更多文件操作" aria-haspopup="menu" aria-expanded={menu === 'more'} disabled={!path} onClick={() => toggle('more')}><MoreHorizontal size={19} /></button>
          {menu === 'more' && dropdown('更多文件操作', <>
            <button role="menuitem" onClick={() => void copy(pathKind === 'absolute' ? absolute : paths[pathKind])}><Copy size={17} />复制路径</button>
            <button role="menuitem" disabled={!textReady} onClick={() => void copy(content)}><Copy size={17} />复制文件内容</button>
            <button role="menuitem" disabled={!textReady} onClick={() => { onToggleWrap(); setMenu(null); }}><WrapText size={17} />{wrap ? '禁用自动换行' : '启用自动换行'}</button>
            {onToggleSource && <button role="menuitem" onClick={() => { onToggleSource(); setMenu(null); }}><FileSearch size={17} />{showSource ? '查看预览' : '查看源代码'}</button>}
            {onRefresh && <><hr /><button role="menuitem" onClick={() => { onRefresh(); setMenu(null); }}>刷新文件列表</button></>}
          </>)}
        </div>
        <div className="file-browser-menu-anchor">
          <div className="file-browser-pill split file-browser-open">
            <button disabled={!path || opening} onClick={() => void act('default')}>{AppMark}打开</button>
            <button aria-label="打开方式" aria-haspopup="menu" aria-expanded={menu === 'open'} disabled={!path || opening} onClick={() => toggle('open')}><ChevronDown size={14} /></button>
          </div>
          {menu === 'open' && dropdown('打开方式', <>
            <button role="menuitem" onClick={() => void act('default')}>{AppMark}默认应用</button>
            <button role="menuitem" onClick={() => void act('terminal')}><Terminal size={17} />终端</button>
            <hr /><button role="menuitem" onClick={() => void act('folder')}>打开所在文件夹</button>
            <button role="menuitem" onClick={() => void act('save')}>另存为…</button>
          </>)}
        </div>
        {onToggleTree && <button className="file-browser-pill icon file-browser-tree-toggle" aria-label={treeVisible ? '隐藏文件树' : '显示文件树'} aria-pressed={treeVisible} onClick={onToggleTree}><FolderOpen size={20} /></button>}
      </div>
    </div>
    {feedback && <span className="file-browser-feedback" role="status">{feedback}</span>}
    {error && <p className="file-browser-action-error" role="alert">{error}</p>}
  </div>;
}
