import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHost, disposeHost } from '../electron/host/context.mts';
import { PluginHostService } from '../electron/host/plugin-host.mts';
import { fileURLToPath } from 'node:url';

test('随应用分发的插件仅 Linux 电脑操作在 Linux 默认开启', () => {
  const service = Object.assign(Object.create(PluginHostService.prototype), {
    builtinDir: fileURLToPath(new URL('../builtin-plugins/', import.meta.url)),
    baseRows: [], bundles: [], overrides: {},
  });
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    for (const platform of ['linux', 'darwin', 'win32']) {
      Object.defineProperty(process, 'platform', { ...original, value: platform });
      const entries = service.compose();
      assert.ok(entries.length >= 6);
      assert.deepEqual(entries.filter(row => !row.disabled).map(row => row.id),
        platform === 'linux' ? ['dyworker-linux-computer-use'] : []);
    }
  } finally { Object.defineProperty(process, 'platform', original); }
});

test('内置插件不支持当前系统时，即使旧设置曾启用也不会启动', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-plugin-platform-'));
  const builtins = path.join(root, 'builtins');
  const plugin = path.join(builtins, 'platform-only');
  const profile = path.join(root, 'data', 'plugins');
  await fs.mkdir(plugin, { recursive: true }); await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(path.join(plugin, 'package.json'), JSON.stringify({ name: 'platform-only', type: 'module', main: 'index.js',
    dyworker: { builtin: true, supportedPlatforms: ['another-platform'] } }));
  await fs.writeFile(path.join(plugin, 'index.js'), 'export const name="platform-only"; export function apply(){throw Error("不应启动")}');
  await fs.writeFile(path.join(profile, 'dyworker.bundles.json'), JSON.stringify({ version: 1, bundles: [], overrides: { 'platform-only': { disabled: false } } }));
  const host = await createHost({ userDataDir: path.join(root, 'data'), builtinPluginsDir: builtins, mountPlugins: true });
  t.after(async () => { await disposeHost(host); await fs.rm(root, { recursive: true, force: true }); });
  const entry = host.plugins.entries().find(item => item.id === 'platform-only');
  assert.equal(entry.disabled, true); assert.equal(entry.active, false);
  assert.match(entry.unsupportedReason, /当前系统无法使用/);
  const result = await host.plugins.setEnabled('platform-only', true);
  assert.equal(result.ok, false); assert.match(result.error, /当前系统无法使用/);
  assert.equal(host.plugins.entries()[0].state, 'disabled');
  await host.plugins.reload();
  assert.equal(host.plugins.entries()[0].disabled, true);
});

test('内置插件默认停用，手动启用和停用在重启后保留', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-plugin-supported-'));
  const plugin = path.join(root, 'builtins', 'supported');
  await fs.mkdir(plugin, { recursive: true });
  await fs.writeFile(path.join(plugin, 'package.json'), JSON.stringify({ name: 'supported', type: 'module', main: 'index.js',
    dyworker: { builtin: true, supportedPlatforms: [process.platform] } }));
  await fs.writeFile(path.join(plugin, 'index.js'), 'export const name="supported"; export function apply(){}');
  const options = { userDataDir: path.join(root, 'data'), builtinPluginsDir: path.join(root, 'builtins'), mountPlugins: true };
  let host = await createHost(options);
  t.after(async () => { await disposeHost(host); await fs.rm(root, { recursive: true, force: true }); });
  const entry = host.plugins.entries()[0];
  assert.equal(entry.disabled, true); assert.equal(entry.active, false); assert.equal(entry.unsupportedReason, null);
  assert.equal((await host.plugins.setEnabled('supported', true)).ok, true);
  assert.equal(host.plugins.entries()[0].active, true);
  await disposeHost(host); host = await createHost(options);
  assert.equal(host.plugins.entries()[0].disabled, false);
  assert.equal(host.plugins.entries()[0].active, true);
  await host.plugins.setEnabled('supported', false);
  await disposeHost(host); host = await createHost(options);
  assert.equal(host.plugins.entries()[0].disabled, true);
  assert.equal(host.plugins.entries()[0].active, false);
});
