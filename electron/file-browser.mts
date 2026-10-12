import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolvePreviewFile } from './file-preview.mts';

const run = (command, args, options = {}) => new Promise<string>((resolve, reject) => {
  execFile(command, args, { timeout: 5000, windowsHide: true, ...options }, (error, stdout) => error ? reject(error) : resolve(String(stdout).trim()));
});
const launch = (command, args, options = {}) => new Promise<string>((resolve, reject) => {
  const child = spawn(command, args, { ...options, detached: true, stdio: 'ignore' });
  child.once('error', reject);
  child.once('spawn', () => { child.unref(); resolve(''); });
});

export async function fileBrowserPaths(workspacePath, filePath) {
  try {
    const file = await resolvePreviewFile(workspacePath, filePath, false);
    const root = await fs.realpath(workspacePath);
    let repositoryRoot = '';
    try { repositoryRoot = await run('git', ['-C', path.dirname(file.path), 'rev-parse', '--show-toplevel']); } catch { /* 非 Git 目录没有仓库相对路径 */ }
    return { ok: true, absolute: file.path, projectRelative: path.relative(root, file.path), repositoryRelative: repositoryRoot ? path.relative(repositoryRoot, file.path) : undefined };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

// 参数通过 execFile 独立传递；目录名绝不拼入 shell 命令。
export async function openFileTerminal(workspacePath, filePath, platform = process.platform, execute = platform === 'linux' ? launch : run) {
  try {
    const file = await resolvePreviewFile(workspacePath, filePath, false);
    const cwd = path.dirname(file.path);
    if (platform === 'darwin') await execute('open', ['-a', 'Terminal', cwd]);
    else if (platform === 'win32') await execute('cmd.exe', ['/c', 'start', '""', 'cmd.exe'], { cwd });
    else {
      let opened = false;
      for (const [command, args] of [['x-terminal-emulator', []], ['gnome-terminal', [`--working-directory=${cwd}`]], ['konsole', ['--workdir', cwd]], ['xterm', []]] as Array<[string, string[]]>) {
        try { await execute(command, args, { cwd }); opened = true; break; } catch { /* 尝试可用的终端 */ }
      }
      if (!opened) throw new Error('未找到可用的终端应用');
    }
    return { ok: true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

export async function saveFileAs(workspacePath, filePath, { dialog, parent, content }) {
  try {
    const file = await resolvePreviewFile(workspacePath, filePath, false);
    const choice = await dialog.showSaveDialog(parent, { title: '另存为', defaultPath: file.path, properties: ['showOverwriteConfirmation', 'createDirectory'] });
    if (choice.canceled || !choice.filePath) return { ok: true, canceled: true };
    // 编辑页导出当前内容；图片、PDF 等按原始字节复制。
    if (typeof content === 'string') await fs.writeFile(choice.filePath, content, 'utf8');
    else if (path.resolve(choice.filePath) !== file.path) await fs.copyFile(file.path, choice.filePath);
    return { ok: true, path: choice.filePath };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

// 文件默认应用图标：与参考界面一致，「打开」按钮和「默认应用」菜单项显示实际会用哪个应用打开。
// 图标按文件类型缓存（同扩展名共用）；无扩展名按文件名缓存，避免 Makefile 和 LICENSE 串味。
const appIconCache = new Map();
export async function fileAppIcon(app, workspacePath, filePath) {
  try {
    const file = await resolvePreviewFile(workspacePath, filePath, false);
    const extension = path.extname(file.path).toLowerCase();
    const key = extension || file.name;
    if (appIconCache.has(key)) {
      const cached = appIconCache.get(key);
      return cached ? { ok: true, data: cached } : { ok: false, error: "系统没有提供该文件类型的应用图标" };
    }
    const image = await app.getFileIcon(file.path, { size: "normal" });
    const data = image && !image.isEmpty() ? String(image.toDataURL()) : "";
    appIconCache.set(key, data);
    return data ? { ok: true, data } : { ok: false, error: "系统没有提供该文件类型的应用图标" };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
