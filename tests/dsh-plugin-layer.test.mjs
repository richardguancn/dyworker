import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHost, disposeHost } from '../electron/host/context.mts';
import { parseTree, stringifyTree } from '../electron/host/plugin-host.mts';
import { readBundlePatch, composeRows } from '../electron/host/plugin-bundle.mts';
import { analyzePlugin } from '../electron/host/dsh-compat.mts';
import { orderClientModules } from '../electron/host/plugin-client.mts';
import { OfficialDshSession } from '../electron/host/dsh-runtime/full-session.mts';
import { ClientModuleLoader } from '../src/pluginRuntime/moduleLoader.ts';

async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-dsh-layer-')));
  const host = await createHost({ userDataDir: dir, mountPlugins: true });
  t.after(async () => { await disposeHost(host); await fs.rm(dir, { recursive: true, force: true }); });
  return { dir, host, profile: host.plugins.dir };
}
async function pkg(profile, name, fields, source) {
  const dir = path.join(profile, 'node_modules', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', ...fields }));
  if (source) await fs.writeFile(path.join(dir, 'index.mjs'), source);
  return dir;
}

test('官方多文件配置按声明顺序合成，入口相对各配置文件，重复合成不污染原层', async t => {
  const { host, profile } = await fixture(t);
  const dir = await pkg(profile, 'layer-bundle', { dyworker: { bundle: { patch: ['parts/one.yml', 'two.yml'] } } });
  await fs.mkdir(path.join(dir, 'parts'));
  await fs.writeFile(path.join(dir, 'parts', 'entry.mjs'), `export function apply(ctx,config){
    globalThis.__layerConfiguration=config;ctx.effect(()=>()=>{globalThis.__layerConfiguration=null})}`);
  await fs.writeFile(path.join(dir, 'parts', 'one.yml'), '- insert:\n    - id: layer-relative\n      name: ./entry.mjs\n      config: {value: 1}\n');
  await fs.writeFile(path.join(dir, 'two.yml'), '- id: layer-relative\n  config: {value: 2}\n');
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json')));
  const bundle = await readBundlePatch(dir, manifest);
  assert.equal(bundle.patchFiles.length, 2);
  assert.equal(bundle.patches[0].insert[0].name, pathToFileURL(path.join(dir, 'parts', 'entry.mjs')).href);
  const original = structuredClone(bundle.patches);
  assert.deepEqual(composeRows([], [bundle.patches])[0].config, { value: 2 });
  assert.deepEqual(composeRows([], [bundle.patches])[0].config, { value: 2 });
  assert.deepEqual(bundle.patches, original);
  const beforeInstall = await host.plugins.compatibility({ spec: 'layer-bundle' });
  assert.equal(beforeInstall.verdict, 'runnable');
  assert.equal(beforeInstall.hostHalf.metadataOnly, true);
  assert.equal(beforeInstall.hostHalf.importable, null);
  assert.equal((await host.plugins.install({ spec: 'layer-bundle' })).ok, true);
  const afterInstall = await host.plugins.compatibility({ spec: 'layer-bundle' });
  assert.equal(afterInstall.verdict, beforeInstall.verdict);
  assert.deepEqual(afterInstall.hostHalf, beforeInstall.hostHalf);
  assert.deepEqual(globalThis.__layerConfiguration, { value: 2 });
  assert.equal((await host.plugins.setEnabled('layer-bundle', false)).ok, true);
  assert.equal(globalThis.__layerConfiguration, null);
  assert.equal((await host.plugins.setEnabled('layer-bundle', true)).ok, true);
  assert.deepEqual(globalThis.__layerConfiguration, { value: 2 });
  await disposeHost(host);
  const restored = await createHost({ userDataDir: path.dirname(profile), mountPlugins: true });
  try { assert.deepEqual(globalThis.__layerConfiguration, { value: 2 });
    assert.equal((await restored.plugins.uninstall({ spec: 'layer-bundle' })).ok, true);
    assert.equal(globalThis.__layerConfiguration, null);
  } finally { await disposeHost(restored); }
});

test('无效或缺失的配置明确报错，空配置列表仍是已声明的包', async t => {
  const { profile } = await fixture(t);
  const dir = await pkg(profile, 'invalid-layer', {});
  for (const patch of [42, ['good.yml', null]]) {
    await assert.rejects(readBundlePatch(dir, { name: 'invalid-layer', dsh: { bundle: { patch } } }), /file path/);
  }
  await assert.rejects(readBundlePatch(dir, { name: 'invalid-layer', dsh: { bundle: { patch: 'absent.yml' } } }), /absent.yml/);
  await fs.writeFile(path.join(dir, 'bad.yml'), '- 7\n');
  await assert.rejects(readBundlePatch(dir, { name: 'invalid-layer', dsh: { bundle: { patch: 'bad.yml' } } }), /mapping/);
  assert.deepEqual((await readBundlePatch(dir, { name: 'empty', dsh: { bundle: { patch: [] } } })).patches, []);
});

test('配置表达式与分组、依赖声明保留原值；表达式交给官方加载器执行', async t => {
  const rows = parseTree('- id: expr\n  name: expression-plugin\n  disabled: !!js false\n  inject: {layerReady: null}\n');
  assert.deepEqual(parseTree(stringifyTree(rows)), rows);
  assert.deepEqual(parseTree('- id: g\n  name: cordis:group\n  group: true\n  config: [{id: c, name: c, disabled: false, inject: []}]\n')[0].config[0].disabled, false);
  const { host, profile } = await fixture(t);
  await pkg(profile, 'expression-plugin', { main: 'index.mjs' }, 'export function apply(){globalThis.__layerExpression=true}');
  await fs.writeFile(path.join(profile, 'dyworker.yml'), stringifyTree([{ ...rows[0], inject: [] }]));
  await host.plugins.reload();
  assert.equal(host.plugins.entries()[0].active, true);
  assert.equal(host.plugins.entries()[0].disabled, false);
  assert.equal(globalThis.__layerExpression, true);
});

test('条目额外依赖真正等待服务，服务出现后启动；分组子插件随组停用和恢复', async t => {
  const { host, profile } = await fixture(t);
  globalThis.__layerEvents = [];
  await pkg(profile, 'waiting-plugin', { main: 'index.mjs' }, `export function apply(ctx){
    globalThis.__layerEvents.push('start');ctx.effect(()=>()=>globalThis.__layerEvents.push('stop'))}`);
  const added = await host.plugins.add({ id: 'waiting', name: 'waiting-plugin', inject: ['layerReady'] });
  assert.equal(added.ok, true);
  assert.deepEqual(host.plugins.entries()[0].missingServices, ['layerReady']);
  assert.deepEqual(globalThis.__layerEvents, []);
  host.provide('layerReady', {}); await host.loader.await(); await host.loader.resolve('waiting').fiber.await();
  assert.deepEqual(globalThis.__layerEvents, ['start']);
  await host.plugins.remove('waiting');
  assert.equal((await host.plugins.add({ id: 'group', name: 'cordis:group', group: true, inject: ['loader'],
    config: [{ id: 'child', name: 'waiting-plugin', inject: ['layerReady'] }] })).ok, true);
  assert.equal(host.loader.resolve('child').fiber.state, 2);
  await host.plugins.setEnabled('group', false);
  assert.equal(host.loader.resolve('child').disabled, true);
  await host.plugins.setEnabled('group', true);
  await host.loader.resolve('child').fiber.await();
  assert.equal(host.loader.resolve('child').fiber.state, 2);
  assert.deepEqual(globalThis.__layerEvents, ['start', 'stop', 'start', 'stop', 'start']);
});

test('主机入口按 ESM 导出条件加载，包子路径与本地入口均可使用', async t => {
  const { host, profile } = await fixture(t);
  await pkg(profile, 'esm-only-plugin', { exports: { '.': { import: './index.mjs' }, './feature': { import: './index.mjs' } } },
    `export function apply(ctx){globalThis.__layerEsmCount=(globalThis.__layerEsmCount||0)+1}`);
  assert.equal((await host.plugins.add({ id: 'esm', name: 'esm-only-plugin' })).ok, true);
  await host.plugins.remove('esm');
  assert.equal((await host.plugins.add({ id: 'subpath', name: 'esm-only-plugin/feature' })).ok, true);
  await host.plugins.remove('subpath');
  assert.equal((await host.plugins.add({ id: 'local', name: './node_modules/esm-only-plugin/index.mjs' })).ok, true);
});

test('npm 别名可装载；显式禁止的子路径和缺失的 ESM 入口不能通过备用入口绕过', async t => {
  const { host, profile } = await fixture(t);
  const alias = await pkg(profile, 'aliased-plugin', { name: 'original-plugin', main: 'index.mjs' }, 'export function apply(){}');
  assert.equal(host.plugins.packageDirOf('aliased-plugin'), alias);
  assert.equal((await host.plugins.add({ id: 'alias', name: 'aliased-plugin' })).ok, true);
  await pkg(profile, 'blocked-plugin', { exports: { '.': './index.mjs', './blocked': null, './*': './index.mjs' } }, 'export function apply(){}');
  const blocked = await host.plugins.add({ id: 'blocked', name: 'blocked-plugin/blocked' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /exports/);
  await pkg(profile, 'missing-esm', { exports: { import: './absent.mjs', require: './index.mjs' } }, 'export function apply(){}');
  assert.equal((await host.plugins.add({ id: 'missing-esm', name: 'missing-esm' })).ok, false);
});

test('版本不匹配先拒绝，不执行入口；版本授权精确到插件版本和运行版本', async t => {
  const { profile } = await fixture(t);
  const dir = await pkg(profile, 'dsh-version-fixture', { main: 'index.mjs', peerDependencies: { '@deepseek-ai/dsh-session': '^9.0.0' } },
    'throw new Error("入口不应执行")');
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json')));
  const check = overrides => analyzePlugin(path.join(profile, 'package.json'), manifest.name, manifest, dir, overrides);
  const denied = await check();
  assert.equal(denied.verdict, 'unsupported');
  assert.match(denied.hostHalf.importError, /版本/);
  assert.equal(denied.versionIssue.exempted, false);
  assert.equal((await check({ versionExemptions: { 'dsh-version-fixture@0.9.0': ['0.2.1-alpha.1'] } })).versionIssue.exempted, false);
  const accepted = await check({ versionExemptions: { 'dsh-version-fixture@1.0.0': ['0.2.1-alpha.1'] } });
  assert.equal(accepted.versionIssue.exempted, true);
  assert.match(accepted.hostHalf.importError, /入口不应执行/);
});

test('插件名称无需 dsh 前缀，声明官方 DSH 依赖即可进入正确的运行环境', async t => {
  const { host, profile } = await fixture(t);
  await pkg(profile, 'acme-agent-extension', { main: 'index.mjs', peerDependencies: { '@deepseek-ai/dsh-agent': '0.2.1-alpha.1' } },
    'export const inject=["agents"];export function apply(ctx){if(!ctx.agents)throw new Error("需要官方服务")}');
  const installed = await host.plugins.install({ spec: 'acme-agent-extension' });
  assert.equal(installed.ok, true, installed.error);
  assert.equal(installed.analysis.runtime, 'dsh-session');
  assert.equal(host.plugins.entries()[0].state, 'session-required');
  assert.equal((await host.plugins.dshSessionPlugins())[0].id, 'acme-agent-extension');
});

test('客户端模块的 external 依赖递归加载，包括非 DeepSeek 模块和缺失项', () => {
  const graph = {
    top: { dir: '/top', manifest: { main: 'index.js', dsh: { client: { external: ['middle', 'absent'] } } } },
    middle: { dir: '/middle', manifest: { main: 'index.js', dsh: { client: { external: ['leaf'] } } } },
    leaf: { dir: '/leaf', manifest: { main: 'index.js' } },
  };
  const plan = orderClientModules(['top'], name => graph[name]);
  assert.deepEqual(plan.ordered.map(row => row.spec), ['leaf', 'middle', 'top']);
  assert.deepEqual(plan.missing, ['absent']);
  const loader = new ClientModuleLoader();
  const factories = { leaf: () => ({ value: 7 }), middle: require => ({ value: require('leaf').value + 1 }),
    top: require => ({ value: require('middle').value + 1 }) };
  for (const row of plan.ordered) loader.load({ id: row.spec, factory: factories[row.spec] });
  assert.equal(loader.require('top').value, 9);
});

test('允许安装的版本例外保存后可恢复，升级插件版本后不会沿用旧例外', async t => {
  const { host, profile, dir } = await fixture(t);
  const pluginDir = await pkg(profile, 'dsh-exact-version', { main: 'index.mjs', peerDependencies: { '@deepseek-ai/dsh-session': '^9.0.0' } },
    'export function apply(){}');
  assert.equal((await host.plugins.install({ spec: 'dsh-exact-version' })).ok, false);
  assert.equal((await host.plugins.install({ spec: 'dsh-exact-version', allowIncompatible: true })).ok, true);
  assert.equal(host.plugins.entries()[0].active, true);
  await disposeHost(host);
  const restored = await createHost({ userDataDir: dir, mountPlugins: true });
  try {
    assert.equal(restored.plugins.entries()[0].active, true);
    const session = new OfficialDshSession({ profileDir: profile, dataDir: path.join(dir, 'exempted-session'), workspacePath: dir,
      sessionId: 'exact-version-session', plugins: await restored.plugins.dshSessionPlugins(), approve: async () => true,
      async *generate() { throw new Error('版本检查不应调用模型'); } });
    try { await session.start(); } finally { await session.close(); }
    const manifestFile = path.join(pluginDir, 'package.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile)); manifest.version = '1.0.1';
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    await fs.appendFile(path.join(pluginDir, 'index.mjs'), '\n// 更新入口\n');
    await restored.plugins.reload();
    assert.equal(restored.plugins.entries()[0].active, false);
    assert.match(restored.plugins.entries()[0].error, /版本/);
  } finally { await disposeHost(restored); }
});

test('无效配置重载报告失败，已运行插件保留；修复后可再次重载', async t => {
  const { host, profile } = await fixture(t);
  await pkg(profile, 'reload-layer', { main: 'index.mjs' }, 'export function apply(){}');
  await host.plugins.add({ id: 'keep-running', name: 'reload-layer' });
  await fs.writeFile(path.join(profile, 'dyworker.yml'), 'bad: [\n');
  assert.equal((await host.plugins.reload()).ok, false);
  assert.equal(host.plugins.entries()[0].active, true);
  await fs.writeFile(path.join(profile, 'dyworker.yml'), stringifyTree([{ id: 'keep-running', name: 'reload-layer' }]));
  assert.equal((await host.plugins.reload()).ok, true);
  assert.equal(host.plugins.failures.has('<tree>'), false);
});

test('DSH 分组整体进入官方配置树，保留子插件额外依赖和待办工具', { timeout: 20000 }, async t => {
  const { host, profile, dir } = await fixture(t);
  const todo = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-tool-todo');
  await fs.mkdir(path.join(profile, 'node_modules', '@deepseek-ai'), { recursive: true });
  await fs.symlink(path.dirname(path.dirname(todo)), path.join(profile, 'node_modules', '@deepseek-ai', 'dsh-tool-todo'), 'dir');
  const added = await host.plugins.add({ id: 'official-group', name: 'cordis:group', group: true, inject: ['loader'],
    config: [{ id: 'official-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: false },
      inject: ['tools', 'sessions', 'agents', 'sessionProjections'] }] });
  assert.equal(added.ok, true, added.error);
  assert.equal(host.plugins.entries()[0].state, 'session-required');
  const plugins = await host.plugins.dshSessionPlugins();
  assert.equal(plugins[0].options.group, true);
  assert.deepEqual(plugins[0].options.config[0].inject, ['tools', 'sessions', 'agents', 'sessionProjections']);
  const runtime = new OfficialDshSession({ profileDir: profile, dataDir: path.join(dir, 'official-data'), workspacePath: dir,
    sessionId: 'layer-session', plugins, approve: async () => true,
    async *generate() { throw new Error('本检查不应发起模型请求'); } });
  t.after(() => runtime.close());
  const names = await runtime.start();
  assert.match(JSON.stringify(names), /todo/);
  await runtime.close();
  await host.plugins.setEnabled('official-group', false);
  assert.deepEqual(await host.plugins.dshSessionPlugins(), []);
});
