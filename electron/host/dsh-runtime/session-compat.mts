import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnPluginProcess, terminatePluginProcess } from './process.mts';

export async function probeDshSessionPlugin({ profileDir, packageDir, entryUrl, config, timeoutMs = 20_000 }: any) {
  profileDir = await fs.realpath(profileDir);
  const originalUrl = new URL(entryUrl);
  const canonicalUrl = pathToFileURL(await fs.realpath(fileURLToPath(originalUrl)));
  canonicalUrl.search = originalUrl.search; entryUrl = canonicalUrl.href;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-dsh-session-probe-'));
  await fs.mkdir(path.join(dir, 'data')); await fs.mkdir(path.join(dir, 'work'));
  const dataDir = await fs.realpath(path.join(dir, 'data')); const workspacePath = await fs.realpath(path.join(dir, 'work'));
  let child: any;
  try {
    child = spawnPluginProcess('session-probe', { profileDir, packageDir, dataDir, workspacePath });
    return await new Promise<any>(resolve => {
      let settled = false; let stderr = '';
      const finish = (result: any) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
      const timer = setTimeout(() => finish({ ok: false, error: 'DSH 会话兼容检查超时' }), timeoutMs);
      child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
      child.once('message', finish);
      child.once('error', error => finish({ ok: false, error: error.message }));
      child.once('exit', code => finish({ ok: false, error: `DSH 会话检查退出（${code}）：${stderr}` }));
      child.send({ profileDir, entryUrl, config, dataDir, workspacePath });
    });
  } finally {
    await terminatePluginProcess(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
}
