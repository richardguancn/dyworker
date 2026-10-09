import fs from 'node:fs/promises';
import path from 'node:path';

/** 手工放入 profile 并已登记的插件也属于已安装组合，不能被 npm 当成多余目录删除。 */
export async function collectProfilePackages(dir: string, names: string[]) {
  const saved = new Map<string, string>();
  const queue = [...names];
  while (queue.length) {
    const name = queue.shift();
    if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name || '') || saved.has(name)) continue;
    const source = path.join(dir, 'node_modules', name);
    let manifest: any;
    try { manifest = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8')); }
    catch { continue; } // 原本缺失的包不会被伪造为有效包。
    if (manifest.name !== name) continue;
    saved.set(name, source);
    queue.push(...Object.keys(manifest.dependencies || {}), ...Object.keys(manifest.peerDependencies || {}));
    for (const client of [manifest.dsh?.client, manifest.dyworker?.client]) {
      const inject = client?.inject;
      queue.push(...(Array.isArray(inject) ? inject.filter(item => typeof item === 'string')
        : inject && typeof inject === 'object' ? Object.keys(inject) : []));
    }
  }
  return saved;
}

export async function restoreMissingProfilePackages(stage: string, saved: Map<string, string>, updating?: string) {
  const restored: string[] = [];
  for (const [name, source] of saved) {
    if (name === updating) continue;
    const target = path.join(stage, 'node_modules', name);
    try { await fs.lstat(target); continue; } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(source, target, { recursive: true, dereference: false });
    restored.push(name);
  }
  return restored;
}
