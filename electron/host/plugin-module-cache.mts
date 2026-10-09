// 插件目录会在进程存活期间由 npm 更新。Node 24 会缓存不存在的 package.json，
// 只给顶层 import 加查询参数仍会命中旧的包解析结果，因此只在插件目录内刷新解析。
import * as nodeModule from 'node:module';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const revisions = new Map<string, { refs: number; revision: number }>();
let hooks: any;
const REVISION = 'dyworker-runtime';
const canonical = (file: string) => { try { return realpathSync(file); } catch { return path.resolve(file); } };
const inside = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};
function profileOf(file: string) {
  return [...revisions.keys()].find(root => inside(root, canonical(file)));
}
function targetOf(value: any, conditions: Set<string>): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const candidate of value) { const result = targetOf(candidate, conditions); if (result) return result; }
  } else if (value && typeof value === 'object') {
    for (const [key, candidate] of Object.entries(value)) {
      if (key === 'default' || conditions.has(key)) { const result = targetOf(candidate, conditions); if (result) return result; }
    }
  }
  return null;
}
function packageEntry(spec: string, parent: string, conditions: Set<string>) {
  const parts = spec.split('/');
  const size = spec.startsWith('@') ? 2 : 1;
  const name = parts.slice(0, size).join('/');
  const subpath = parts.length > size ? './' + parts.slice(size).join('/') : '.';
  let base = path.dirname(parent);
  while (true) {
    const dir = path.join(base, 'node_modules', name);
    let manifest: any;
    try { manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')); }
    catch { /* 上层可能还有共享包 */ }
    if (manifest) {
      let target: string | null;
      if (manifest.exports != null) {
        const exports = manifest.exports;
        const map = exports && typeof exports === 'object' && !Array.isArray(exports)
          && Object.keys(exports).some(key => key.startsWith('.'));
        target = targetOf(map ? exports[subpath] : subpath === '.' ? exports : null, conditions);
        if (!target && map) {
          for (const key of Object.keys(exports).sort((a, b) => b.length - a.length)) {
            if (!key.includes('*')) continue;
            const [prefix, suffix] = key.split('*');
            if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
            const match = subpath.slice(prefix.length, suffix ? -suffix.length : undefined);
            target = targetOf(exports[key], conditions)?.replaceAll('*', match) || null;
            if (target) break;
          }
        }
        if (!target || !target.startsWith('./')) {
          const error: any = new Error(`Package subpath '${subpath}' is not defined by exports in ${dir}`);
          error.code = 'ERR_PACKAGE_PATH_NOT_EXPORTED';
          throw error; // 不能让缓存过旧的标准解析器重新放行未导出的子路径。
        }
      } else target = subpath === '.' ? manifest.main || './index.js' : subpath;
      const file = path.resolve(dir, target!);
      if (!inside(dir, file)) return null;
      try { if (statSync(file).isFile()) return realpathSync(file); } catch {}
      return null; // 缺文件交给标准解析器报错，不隐藏安装问题。
    }
    const up = path.dirname(base);
    if (up === base) return null;
    base = up;
  }
}
function formatOf(file: string): string | undefined {
  if (file.endsWith('.mjs')) return 'module';
  if (file.endsWith('.cjs')) return 'commonjs';
  if (file.endsWith('.json')) return 'json';
  if (!file.endsWith('.js')) return undefined;
  let dir = path.dirname(file);
  while (true) {
    try { return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).type === 'module' ? 'module' : 'commonjs'; }
    catch {}
    const up = path.dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}
export function pluginModuleUrl(file: string, profile: string): string {
  const url = pathToFileURL(file);
  const current = revisions.get(canonical(profile));
  if (current) url.searchParams.set(REVISION, String(current.revision));
  return url.href;
}
export function refreshPluginModules(profile: string): void {
  const current = revisions.get(canonical(profile));
  if (current) current.revision += 1;
}
export function registerPluginModules(profile: string): () => void {
  const root = canonical(profile);
  const current = revisions.get(root) || { refs: 0, revision: 0 };
  current.refs += 1;
  revisions.set(root, current);
  if (!hooks) hooks = (nodeModule as any).registerHooks({
    resolve(spec: string, context: any, nextResolve: any) {
      const parent = context.parentURL?.startsWith('file:') ? new URL(context.parentURL) : null;
      const from = parent ? fileURLToPath(parent) : '';
      const root = from ? profileOf(from) : undefined;
      let file: string | null = null;
      if (root && !spec.startsWith('.') && !spec.startsWith('/') && !spec.includes(':') && !spec.startsWith('#') && !nodeModule.isBuiltin(spec)) {
        file = packageEntry(spec, from, new Set(context.conditions));
      } else if (spec.startsWith('file:')) file = fileURLToPath(spec);
      else if (root && spec.startsWith('.')) file = fileURLToPath(new URL(spec, parent!));
      if (!file) return nextResolve(spec, context);
      const owner = profileOf(file);
      // 公共库软链 realpath 落在宿主目录，始终保持原 URL，避免创建第二份 Cordis。
      if (!owner) return nextResolve(context.conditions?.includes('require') ? file : pathToFileURL(file).href, context);
      try { if (!statSync(file).isFile()) return nextResolve(spec, context); }
      catch { return nextResolve(spec, context); }
      const url = spec.startsWith('file:') ? new URL(spec) : pathToFileURL(file);
      const revision = url.searchParams.get(REVISION) ?? parent?.searchParams.get(REVISION) ?? String(revisions.get(owner)!.revision);
      url.searchParams.set(REVISION, revision);
      return { url: url.href, format: formatOf(file), shortCircuit: true };
    },
  });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (--current.refs === 0) revisions.delete(root);
    if (!revisions.size) { hooks?.deregister(); hooks = undefined; }
  };
}
