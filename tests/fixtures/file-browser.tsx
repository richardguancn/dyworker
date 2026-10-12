import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FilesSplitPanel } from '../../src/App';
import { FilePreviewPanel } from '../../src/FilePreviewPanel';
import type { DyworkerBridge, WorkspaceEntry } from '../../src/types';
import '../../src/styles.css';
import '../../src/layout.css';
import '../../src/fileBrowser.css';

const root = (window.dyworker as unknown as { fileBrowserTestRoot?: string })?.fileBrowserTestRoot || '/workspace/mp';
const contents: Record<string, string> = {
  '.gitignore': '# 临时文件\ntmp/\n.tmp-*/\n\n# Python\n__pycache__/\n*.py[cod]\n*.egg-info/\n.venv/\n\n# 长行\n' + '长行测试内容 '.repeat(45),
  '说明.md': '# 文件说明\n\n**中文正文**与表格。\n\n| 项目 | 数量 |\n| --- | --- |\n| 示例 | 2 |\n',
  '慢文件.txt': '慢文件内容', '快文件.txt': '快文件内容',
};
const entries: WorkspaceEntry[] = [
  ...['.factcheck-oconnor', '.tmp-pavlov', '下载', '专题考证', 'data_analysis'].map(name => ({ name, path: `${root}/${name}`, kind: 'directory' as const, children: [] })),
  ...Object.keys(contents).map(name => ({ name, path: `${root}/${name}`, kind: 'file' as const })),
  { name: '图片.png', path: `${root}/图片.png`, kind: 'file' },
];
const report = (kind: string, value: string) => { const output = document.querySelector('#result'); if (output) output.textContent = `${kind}：${value}`; };
let fail = false;
const appIcon = 'data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='#2f7ff5'/><path d='M11 9l12 7-12 7z' fill='#fff'/></svg>");
const read = async (_root: string, path: string) => { const name = path.split('/').pop()!; if (name === '慢文件.txt') await new Promise(resolve => setTimeout(resolve, 700)); return { ok: true, content: contents[name] ?? '' }; };
if (!window.dyworker) window.dyworker = {
  platform: 'darwin', refreshWorkspace: async () => entries,
  fileBrowserPaths: async (_root: string, path: string) => ({ ok: true, absolute: path, projectRelative: path.slice(root.length + 1), repositoryRelative: `mp/${path.slice(root.length + 1)}` }),
  readWorkspaceFile: read, readWorkspaceMarkdown: read,
  readFilePreview: async (_root: string, path: string) => path.endsWith('.png') ? { ok: true, path, name: '图片.png', kind: 'image', mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2hZkAAAAASUVORK5CYII=' } : ({ ...await read(_root, path), path, name: path.split('/').pop(), kind: path.endsWith('.md') ? 'markdown' : 'text' }),
  fileAppIcon: async () => ({ ok: true, data: appIcon }),
  writeWorkspaceFile: async (_root: string, path: string, content: string) => { contents[path.split('/').pop()!] = content; report('已保存', content); return { ok: true }; },
  writeClipboardText: async (text: string) => { report('复制结果', text); return { ok: true }; },
  openPath: async (path: string) => { report('默认应用', path); return fail ? { ok: false, error: '测试：应用无法打开' } : { ok: true }; },
  revealInFolder: async (path: string) => { report('所在文件夹', path); return { ok: true }; },
  openFileTerminal: async (_root: string, path: string) => { report('终端', path); return { ok: true }; },
  saveFileAs: async (_root: string, path: string, content?: string) => { report('另存为', content ?? path); return { ok: true }; },
} as unknown as DyworkerBridge;
function Fixture() {
  const [mode, setMode] = useState('split'); const [preview, setPreview] = useState(`${root}/.gitignore`);
  const [narrow, setNarrow] = useState(false); const [reference, setReference] = useState(false);
  return <><style>{`body {display:block;overflow:auto;background:var(--surface);padding:20px} .fixture-controls{display:flex;gap:12px;padding-bottom:12px} .fixture-controls button{color:var(--ink)} html .reference-layout.fixture-panel{padding:0;background:var(--surface);height:660px;width:${reference ? 465 : narrow ? 370 : 760}px;border:1px solid var(--border);border-radius:14px;overflow:hidden} #result{white-space:pre-wrap;color:var(--ink);font-size:12px;max-width:760px}`}</style>
    <nav className="fixture-controls"><button onClick={() => setMode('split')}>文件浏览页</button><button onClick={() => setMode('preview')}>独立预览页</button><button onClick={() => { setReference(false); setNarrow(value => !value); }}>切换窄面板</button><button onClick={() => setReference(true)}>参考宽度</button><button onClick={() => { fail = !fail; }}>切换打开失败</button><button onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; }}>切换明暗</button></nav>
    <div className="reference-layout fixture-panel">{mode === 'split' ? <FilesSplitPanel workspacePath={root} workspaceEntries={entries} workspaceOpen onRefresh={() => report('刷新', '完成')} onError={error => report('错误', error)} onChoosePreviewFile={() => { setPreview(`${root}/.gitignore`); setMode('preview'); }} onPreviewFile={path => { setPreview(path); setMode('preview'); }} /> : <FilePreviewPanel path={preview} workspacePath={root} onChooseFile={() => setMode('split')} onPathChange={setPreview} />}</div><pre id="result" role="status">等待操作</pre>
  </>;
}
createRoot(document.querySelector('#root')!).render(<Fixture />);
