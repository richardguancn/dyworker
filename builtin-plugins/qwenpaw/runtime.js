import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

export const PORT = 18888;
export const URL = `http://127.0.0.1:${PORT}`;

async function checkPort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}

export function createRuntime({ root, python, port = PORT, launch = spawn, probe, timeoutMs = 120000 }) {
  let child = null, starting = null, generation = 0, error = '', ready = false;
  const url = `http://127.0.0.1:${port}`;
  const status = () => ({ running: ready && !!child, starting: !!starting && !ready, url, error });
  const health = probe || (async () => {
    const response = await fetch(`${url}/api/agents`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  });
  const stop = async () => {
    generation++; ready = false;
    const worker = child; child = null;
    if (!worker || worker.exitCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => { worker.kill('SIGKILL'); }, 5000);
      worker.once('exit', () => { clearTimeout(timer); resolve(); });
      worker.kill('SIGTERM');
    });
  };
  const start = async () => {
    if (ready && child) return status();
    if (starting) return starting;
    const token = ++generation;
    starting = (async () => {
      error = '';
      try {
        await fs.access(python);
        await fs.mkdir(root, { recursive: true });
        await checkPort(port);
        if (token !== generation) throw new Error('启动已取消');
        const handle = await fs.open(path.join(root, 'runtime.log'), 'a');
        let worker;
        try {
          worker = launch(python, ['-m', 'qwenpaw', 'app', '--host', '127.0.0.1', '--port', String(port)], {
            cwd: root, env: { ...process.env, QWENPAW_WORKING_DIR: path.join(root, 'data'),
              QWENPAW_TELEMETRY_DISABLED: '1', PYTHONUNBUFFERED: '1' },
            stdio: ['ignore', handle.fd, handle.fd], windowsHide: true,
          });
          child = worker;
          worker.once('error', failure => { if (child === worker) { error = failure.message; child = null; ready = false; } });
          worker.once('exit', code => { if (child === worker) { child = null; ready = false; if (code) error = `QwenPaw 启动失败，请查看 ${path.join(root, 'runtime.log')}`; } });
        } finally { await handle.close(); }
        const deadline = Date.now() + timeoutMs;
        while (token === generation && child === worker && Date.now() < deadline) {
          if (await health().catch(() => false)) {
            if (token !== generation || child !== worker) break;
            ready = true; return status();
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        throw new Error(error || (token !== generation ? '启动已取消' : `QwenPaw 未能启动，请查看 ${path.join(root, 'runtime.log')}`));
      } catch (failure) {
        error = failure.code === 'ENOENT' ? '尚未安装 QwenPaw 运行环境，请先运行项目中的安装脚本。'
          : failure.code === 'EADDRINUSE' ? `QwenPaw 端口 ${port} 已被占用，请关闭占用它的程序后重试。` : String(failure.message || failure);
        await stop(); throw new Error(error);
      } finally { starting = null; }
    })();
    return starting;
  };
  return { status, start, stop };
}
