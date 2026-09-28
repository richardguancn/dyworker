import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function harness() {
  const timers = new Map(); let timerId = 0; let reset;
  const pending = [];
  const root = { dataset: {}, style: { setProperty() {}, removeProperty() {} } };
  const effective = { ok: true, applied: 'vibrancy' };
  const bridge = {
    getAppearance: async () => ({ ok: true, settings: { glass: { enabled: true, systemBackdrop: true } }, effective,
      capabilities: { systemBackdrop: { available: true }, backdropFilter: true } }),
    onAppearanceReset: fn => { reset = fn; },
    previewAppearance: settings => new Promise(resolve => pending.push({ settings, resolve })),
    cancelAppearancePreview: async () => ({ ok: true, effective }),
  };
  const modules = {};
  function load(name) {
    const exports = {}; modules[name] = exports;
    const js = ts.transpileModule(fs.readFileSync(new URL(`../src/appearance/${name}.ts`, import.meta.url), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(js, { exports,
      require: id => id === './tokens' ? (modules.tokens || load('tokens')) : { useSyncExternalStore: (_subscribe, read) => read() },
      document: { documentElement: root },
      window: { dyworker: bridge, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id), dispatchEvent() {} },
      requestAnimationFrame: fn => { timers.set(++timerId, fn); return timerId; }, Event, URL, Blob, Uint8Array, console,
    }); return exports;
  }
  const controller = load('controller');
  return { controller, pending, root,
    flush() { const tasks = [...timers.values()]; timers.clear(); tasks.forEach(fn => fn()); },
    reset() { reset({ ok: true, settings: controller.defaultAppearance(), effective: { ok: true, applied: 'none' }, revision: 2 }); },
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('关闭玻璃后取消，恢复已保存的透明效果；重复进入不污染保存基准', async () => {
  const h = harness(), c = h.controller; await c.bootstrapAppearance(); c.beginSession();
  c.updateDraft(s => ({ ...s, glass: { ...s.glass, enabled: false } })); h.flush();
  h.pending[0].resolve({ effective: { ok: true, applied: 'none' } }); await settle(); h.flush();
  assert.equal(h.root.dataset.systemBackdrop, 'false');
  c.beginSession(); c.discardSession(); await settle();
  assert.equal(h.root.dataset.systemBackdrop, 'true');
});

test('应急恢复清除待发预览，并拒绝恢复前已发出的回复', async () => {
  const h = harness(), c = h.controller; await c.bootstrapAppearance(); c.beginSession();
  c.updateDraft(s => ({ ...s, theme: 'dark' })); h.reset(); h.flush();
  assert.equal(h.pending.length, 0);
  c.updateDraft(s => ({ ...s, theme: 'dark' })); h.flush(); h.reset();
  h.pending[0].resolve({ effective: { ok: true, applied: 'vibrancy' } }); await settle();
  assert.equal(c.useAppearanceStore().effective.applied, 'none');
});

test('连续预览乱序返回时只接受最后一次选择', async () => {
  const h = harness(), c = h.controller; await c.bootstrapAppearance(); c.beginSession();
  c.updateDraft(s => ({ ...s, theme: 'dark' })); h.flush();
  c.updateDraft(s => ({ ...s, glass: { ...s.glass, enabled: false } })); h.flush();
  h.pending[1].resolve({ effective: { ok: true, applied: 'none' } }); await settle();
  h.pending[0].resolve({ effective: { ok: true, applied: 'vibrancy' } }); await settle();
  assert.equal(c.useAppearanceStore().effective.applied, 'none');
});

test('恢复默认草稿后忽略之前已发出的预览回复', async () => {
  const h = harness(), c = h.controller; await c.bootstrapAppearance(); c.beginSession();
  c.updateDraft(s => ({ ...s, theme: 'dark' })); h.flush(); c.resetDraft(); h.flush();
  h.pending[1].resolve({ effective: { ok: true, applied: 'none' } }); await settle();
  h.pending[0].resolve({ effective: { ok: true, applied: 'vibrancy' } }); await settle();
  assert.equal(c.useAppearanceStore().effective.applied, 'none');
});
