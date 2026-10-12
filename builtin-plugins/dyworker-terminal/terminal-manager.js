import * as pty from 'node-pty';
import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';

const BUFFER_LIMIT = 1024 * 1024;
const size = (value, fallback, max) => Number.isFinite(value) ? Math.min(max, Math.max(2, Math.round(value))) : fallback;

function terminate(terminal, inspectProcesses) {
  const stopShell = () => {
    try { if (process.platform !== 'win32') process.kill(-terminal.pid, 'SIGHUP'); } catch {}
    try { terminal.kill(); } catch {}
  };
  if (process.platform === 'win32') { stopShell(); return; }
  // Interactive shells put jobs in separate process groups. Find descendants
  // before stopping the shell, while their parent relationship still exists.
  const stopDescendants = (error, stdout) => {
    if (!error) {
      const children = new Map();
      for (const line of stdout.trim().split('\n')) {
        const [pid, parent] = line.trim().split(/\s+/).map(Number);
        if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(parent)) continue;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(pid);
      }
      const descendants = [terminal.pid];
      const seen = new Set(descendants);
      for (let index = 0; index < descendants.length; index++) {
        for (const pid of children.get(descendants[index]) || []) {
          if (!seen.has(pid)) { seen.add(pid); descendants.push(pid); }
        }
      }
      for (const pid of descendants.slice(1).reverse()) {
        try { process.kill(pid, 'SIGHUP'); } catch {}
      }
    }
    stopShell();
  };
  try {
    inspectProcesses('/bin/ps', ['-axo', 'pid=,ppid='], { timeout: 1000, maxBuffer: 4 * 1024 * 1024 }, stopDescendants);
  } catch { stopShell(); }
}

/** Sessions are owned by their renderer, including output replay and teardown. */
export function createTerminalManager({ spawn = pty.spawn, execFile: inspectProcesses = execFile } = {}) {
  const sessions = new Map();
  const owners = new Map();
  let disposed = false;
  const close = (row) => {
    sessions.delete(row.id);
    row.dataListener?.dispose();
    row.exitListener?.dispose();
    if (!row.exited) terminate(row.pty, inspectProcesses);
  };
  const closeOwner = (sender) => {
    for (const row of sessions.values()) if (row.owner === sender.id) close(row);
  };
  const get = (sender, id) => {
    const row = sessions.get(String(id));
    if (!row || row.owner !== sender.id) throw new Error('终端已关闭，请新建终端。');
    return row;
  };
  const send = (row, event) => {
    if (!row.sender.isDestroyed()) row.sender.send('terminal:event', { id: row.id, ...event });
  };
  return {
    async create(sender, payload) {
      if (disposed) throw new Error('终端插件已停用。');
      if ([...sessions.values()].filter(row => row.owner === sender.id).length >= 20) throw new Error('最多打开 20 个终端，请先关闭一些。');
      const cwd = path.resolve(String(payload.workspacePath || process.cwd()));
      if (!(await stat(cwd)).isDirectory()) throw new Error('工作文件夹不存在，请重新选择。');
      if (disposed) throw new Error('终端插件已停用。');
      if (sender.isDestroyed()) throw new Error('终端窗口已关闭。');
      // Check again after the asynchronous directory lookup, including concurrent creates.
      if ([...sessions.values()].filter(row => row.owner === sender.id).length >= 20) throw new Error('最多打开 20 个终端，请先关闭一些。');
      const shell = process.platform === 'win32' ? process.env.COMSPEC || 'powershell.exe' : process.env.SHELL || '/bin/sh';
      const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.NODE_OPTIONS;
      const terminal = spawn(shell, process.platform === 'win32' ? [] : ['-l'], {
        name: 'xterm-256color', cwd, env, cols: size(payload.cols, 80, 500), rows: size(payload.rows, 24, 300),
      });
      const row = { id: randomUUID(), owner: sender.id, sender, pty: terminal, cwd, chunks: [], bytes: 0, seq: 0, exited: false, exitCode: null };
      sessions.set(row.id, row);
      if (!owners.has(sender.id)) {
        const cleanup = () => closeOwner(sender);
        const navigation = (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) cleanup(); };
        sender.on('destroyed', cleanup);
        sender.on('render-process-gone', cleanup);
        sender.on('did-start-navigation', navigation);
        owners.set(sender.id, () => {
          sender.removeListener('destroyed', cleanup);
          sender.removeListener('render-process-gone', cleanup);
          sender.removeListener('did-start-navigation', navigation);
        });
      }
      row.dataListener = terminal.onData(data => {
        const chunk = { seq: ++row.seq, data };
        row.chunks.push(chunk);
        row.bytes += Buffer.byteLength(data);
        while (row.bytes > BUFFER_LIMIT && row.chunks.length > 1) row.bytes -= Buffer.byteLength(row.chunks.shift().data);
        send(row, chunk);
      });
      row.exitListener = terminal.onExit(({ exitCode }) => {
        row.exited = true;
        row.exitCode = exitCode;
        send(row, { exited: true, exitCode });
      });
      return { id: row.id, cwd, pid: terminal.pid };
    },
    read(sender, { id }) {
      const row = get(sender, id);
      return { chunks: row.chunks, seq: row.seq, exited: row.exited, exitCode: row.exitCode };
    },
    write(sender, { id, data }) {
      const row = get(sender, id);
      if (row.exited) throw new Error('终端已退出，请新建终端。');
      if (typeof data !== 'string' || data.length > 65536) throw new Error('输入内容过长，请分段粘贴。');
      row.pty.write(data);
      return {};
    },
    resize(sender, { id, cols, rows }) {
      const row = get(sender, id);
      if (!row.exited) row.pty.resize(size(cols, 80, 500), size(rows, 24, 300));
      return {};
    },
    close(sender, { id }) { close(get(sender, id)); return {}; },
    dispose() {
      disposed = true;
      for (const row of sessions.values()) close(row);
      for (const cleanup of owners.values()) cleanup();
      owners.clear();
    },
  };
}
