import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { OfficialDshSession } from '../electron/host/dsh-runtime/full-session.mts';
import { DshSettingsBridge } from '../src/pluginRuntime/dshSettingsBridge.ts';
import { ClientPluginHost } from '../src/pluginRuntime/clientHost.ts';
const require = createRequire(import.meta.url);
async function ready(form) {
  if (form.getSnapshot().status === 'ready') return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { off(); reject(new Error('设置没有就绪')); }, 5000);
    const off = form.subscribe(() => { if (form.getSnapshot().status === 'ready') { clearTimeout(timeout); off(); resolve(); } });
  });
}
test('官方客户端表单实际保存到 DSH；连续修改按顺序提交，两个会话设置相互独立', async t => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-dsh-settings-client-')));
  const profileDir = path.join(dir, 'plugins'); const workspacePath = path.join(dir, 'work');
  await fs.mkdir(profileDir); await fs.mkdir(workspacePath);
  const options = { profileDir, workspacePath, plugins: [{ id: 'dsh-context', entryUrl: pathToFileURL(require.resolve('dsh-context')).href }] };
  const sessions = new Map(['one', 'two'].map(sessionId => [sessionId, new OfficialDshSession({ ...options, sessionId, dataDir: path.join(dir, sessionId) })]));
  const bridge = new DshSettingsBridge(async ({ sessionId, action, payload }) => {
    try { return { ok: true, value: await sessions.get(sessionId).request(action, payload) }; }
    catch (error) { return { ok: false, error: { message: error.message } }; }
  });
  t.after(async () => { await bridge.dispose(); await Promise.all([...sessions.values()].map(session => session.close())); await fs.rm(dir, { recursive: true, force: true }); });
  await Promise.all([...sessions.values()].map(session => session.start()));
  const form = bridge.get('dsh-context');
  assert.equal(form.getSnapshot().writable, false);
  bridge.setSession('one'); await ready(form);
  assert.deepEqual(await Promise.all([form.set('defaultGranularity', 'turn'), form.set('defaultGranularity', 'step'), form.set('defaultGranularity', 'turn')]), [true, true, true]);
  assert.equal(form.getSnapshot().value.defaultGranularity, 'turn');
  assert.equal(await form.set('undeclaredField', true), false);
  assert.equal(form.getSnapshot().value.defaultGranularity, 'turn');
  bridge.setSession('two'); await ready(form);
  assert.equal(form.getSnapshot().value.defaultGranularity, 'step');
  assert.equal(await form.set('defaultGranularity', 'turn'), true);
  bridge.setSession('one'); await ready(form);
  assert.equal(form.getSnapshot().value.defaultGranularity, 'turn');
  bridge.setSession(''); assert.equal(form.getSnapshot().writable, false);
  assert.equal(await form.set('defaultGranularity', 'step'), false);
});

test('异步出现的设置页面归属发起插件，停用只清理该插件的贡献', async t => {
  const host = new ClientPluginHost(); t.after(() => host.dispose());
  let release; const gate = new Promise(resolve => { release = resolve; });
  await host.load({ name: 'late', inject: ['slots'], apply(ctx) {
    let live = true; ctx.effect(() => () => { live = false; });
    void gate.then(() => { if (live) ctx.slots.register({ name: 'plugins.bundle.config', key: 'late' }, () => null); });
  } }, 'late');
  await host.load({ name: 'other', inject: ['slots'], apply(ctx) { ctx.slots.register({ name: 'conversation.view', key: 'other' }, () => null); } }, 'other');
  release(); await gate; await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(host.contributionsFor('plugins.bundle.config')[0]?.pluginId, 'late');
  await host.unload('late');
  assert.equal(host.contributionsFor('plugins.bundle.config').length, 0);
  assert.equal(host.contributionsFor('conversation.view')[0]?.pluginId, 'other');
});
