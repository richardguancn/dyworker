import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pluginModuleUrl, refreshPluginModules, registerPluginModules } from '../electron/host/plugin-module-cache.mts';

test('先检查失败，再补装依赖，同一进程内重新检查和加载成功', async (t) => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-import-cache-'));
  const dispose = registerPluginModules(profile);
  t.after(async () => { dispose(); await fs.rm(profile, { recursive: true, force: true }); });
  const entry = path.join(profile, 'node_modules/demo/lib/index.js');
  const dir = path.dirname(path.dirname(entry));
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', type: 'module', main: 'lib/index.js' }));
  await fs.writeFile(entry, "import { value } from 'cache-dep'; export { value }; export const inject=['example'];");
  // 残缺包目录存在但清单和入口未下载，正是 Electron 中的负缓存触发条件。
  const dep = path.join(profile, 'node_modules/cache-dep');
  await fs.mkdir(dep);
  const require = createRequire(entry);
  assert.throws(() => require.resolve('cache-dep'));
  await assert.rejects(import(pluginModuleUrl(entry, profile)), /Cannot find/);
  await fs.mkdir(path.join(dep, 'lib'));
  await fs.writeFile(path.join(dep, 'package.json'), JSON.stringify({ name: 'cache-dep', type: 'module', exports: { '.': { default: './lib/index.js' }, './feature': './lib/feature.js' } }));
  await fs.writeFile(path.join(dep, 'lib/index.js'), "export { value } from './feature.js';");
  await fs.writeFile(path.join(dep, 'lib/feature.js'), "export const value=42;");
  refreshPluginModules(profile);
  assert.equal(require.resolve('cache-dep'), await fs.realpath(path.join(dep, 'lib/index.js')));
  const loaded = await import(pluginModuleUrl(entry, profile));
  assert.equal(loaded.value, 42);
  assert.deepEqual(loaded.inject, ['example']);
  assert.throws(() => require.resolve('cache-dep/not-exported'), /not defined|not exported/);
  // 已成功加载的间接文件更新后，也要读取新内容，而不是复用旧模块。
  await fs.writeFile(path.join(dep, 'lib/feature.js'), "export const value=43;");
  refreshPluginModules(profile);
  assert.equal((await import(pluginModuleUrl(entry, profile))).value, 43);
});

test('共享宿主 Cordis 仍然是同一个模块，加载结束后注销解析刷新', async (t) => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-shared-cache-'));
  t.after(() => fs.rm(profile, { recursive: true, force: true }));
  const dir = path.join(profile, 'node_modules/@deepseek-ai');
  await fs.mkdir(dir, { recursive: true });
  const hostRequire = createRequire(import.meta.url);
  await fs.symlink(path.dirname(hostRequire.resolve('@deepseek-ai/cordis/package.json')), path.join(dir, 'cordis'), 'dir');
  const entry = path.join(profile, 'index.mjs');
  await fs.writeFile(entry, "export { Context } from '@deepseek-ai/cordis';");
  const dispose = registerPluginModules(profile);
  try {
    const host = await import('@deepseek-ai/cordis');
    assert.equal((await import(pluginModuleUrl(entry, profile))).Context, host.Context);
    refreshPluginModules(profile);
    assert.equal((await import(pluginModuleUrl(entry, profile))).Context, host.Context);
  } finally { dispose(); }
  assert.equal(pluginModuleUrl(entry, profile).includes('dyworker-runtime'), false);
});
