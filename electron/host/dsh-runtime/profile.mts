import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import ConfigEditor from '@deepseek-ai/dsh-config-editor';
import Settings from '@deepseek-ai/dsh-settings';
import { mountRootInclude, readProfilePatches, readProfileVersionExemptions, PROFILE_COMPATIBILITY_FILENAME } from '@deepseek-ai/dsh-app-boot';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import { createRequire } from 'node:module';

// include 的 YAML 方言必须与其自身解析器配对；宿主另有 js-yaml 5，不能混用 schema。
const yaml = createRequire(import.meta.resolve('@deepseek-ai/cordis-plugin-include'))('js-yaml');

function stablePluginName(name: string) {
  try {
    const url = new URL(name);
    if (url.protocol === 'file:') url.searchParams.delete('dyworker-runtime');
    return url.href;
  } catch { return name; }
}

function profileEntries(plugins: any[]) {
  const stable = (row: any): any => ({ ...row, name: stablePluginName(row.name),
    ...(row.group && Array.isArray(row.config) ? { config: row.config.map(stable) } : {}) });
  return plugins.map(item => stable(item.options || { id: item.id, name: item.entryUrl, config: item.config ?? {} }));
}

function flatEntries(rows: any[]): any[] {
  return rows.flatMap(row => [row, ...(row.group && Array.isArray(row.config) ? flatEntries(row.config) : [])]);
}

async function restoreStablePatchNames(file: string, plugins: any[]) {
  let source: string;
  try { source = await fs.readFile(file, 'utf8'); }
  catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
  const patches = yaml.load(source, { schema: entryListSchema });
  if (!Array.isArray(patches)) return;
  const names = new Map(flatEntries(profileEntries(plugins)).map(item => [item.id, item.name]));
  let changed = false;
  for (const row of patches) {
    if (row && typeof row.name === 'string' && row.name !== names.get(row.id)
      && stablePluginName(row.name) === names.get(row.id)) {
      row.name = names.get(row.id); changed = true;
    }
  }
  if (!changed) return;
  const temporary = `${file}.dyworker-stable-name.tmp`;
  await fs.writeFile(temporary, yaml.dump(patches, { schema: entryListSchema }));
  await fs.rename(temporary, file);
}

/** 官方配置树只写入此 DSH 会话的数据目录；不会读取用户的 ~/.dsh。 */
export async function mountDshProfile(ctx: any, input: any) {
  const dir = path.join(input.dataDir, 'profile');
  const home = path.join(input.dataDir, 'home');
  await fs.mkdir(dir, { recursive: true }); await fs.mkdir(home, { recursive: true });
  const manifest = path.join(dir, 'package.json');
  const bundleName = 'dyworker-dsh-approved-plugins';
  await fs.writeFile(manifest, JSON.stringify({ name: 'dyworker-dsh-session', private: true,
    dsh: { profile: { bundles: [bundleName] } } }));
  const bundleDir = path.join(dir, 'node_modules', bundleName);
  await fs.mkdir(bundleDir, { recursive: true });
  await fs.writeFile(path.join(bundleDir, 'package.json'), JSON.stringify({ name: bundleName, version: '1.0.0',
    dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  const configPath = path.join(dir, 'cordis.yml');
  // 基础条目来自宿主批准的清单；用户设置在官方 patch 文件中独立保留。
  await fs.writeFile(configPath, '[]');
  // 会话继承插件目录中已经明确允许的精确版本；不自行增加或延续旧授权。
  await fs.writeFile(path.join(dir, PROFILE_COMPATIBILITY_FILENAME), JSON.stringify(readProfileVersionExemptions(input.profileDir)), { mode: 0o600 });
  // 缓存代次属于进程装载，不是设置身份；重装不能让官方 name 匹配失效。
  await restoreStablePatchNames(path.join(dir, 'cordis.patch.yml'), input.plugins || []);
  const rows = profileEntries(input.plugins || []);
  await fs.writeFile(path.join(bundleDir, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }], null, 2));
  ctx.provide('profileContext', { name: 'dyworker-session', dir, home, cwd: input.workspacePath,
    patchPath: path.join(dir, 'cordis.patch.yml'), installAnchor: manifest, startedBundles: [], overlays: [], telemetryDisabledEnv: '1' });
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(configPath).href });
  await ctx.plugin(ConfigEditor); await ctx.plugin(Settings);
  await mountRootInclude(ctx, configPath, readProfilePatches('dyworker-dsh', ctx.profileContext));
  await ctx.loader.await(); await ctx.fiber.await();
  for (const item of flatEntries(rows)) {
    const entry = [...ctx.loader.entries()].find((entry: any) => entry.options.id === item.id);
    if (entry?.disabled) continue;
    await entry?.fiber?.await();
    if (!entry?.fiber || entry.fiber.state !== 2) {
      const missing = Object.keys(entry?.fiber?.inject || {}).filter(name => !entry.fiber.ctx.get(name));
      throw new Error(`插件 ${item.id} 未在官方配置树中启动${missing.length ? `：缺少服务 ${missing.join('、')}` : ''}`);
    }
  }
  await ctx.fiber.await();
}
