import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createHost, disposeHost } from '../electron/host/context.mts';
import { composeRows, pluginConfigDefaults } from '../electron/host/plugin-bundle.mts';
import { DshPluginBridge } from '../electron/host/dsh-runtime/bridge.mts';

const name = '@deepseek-ai/dsh-tool-todo';
const source = path.dirname(createRequire(import.meta.url).resolve(`${name}/package.json`));
async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-todo-install-')));
  const host = await createHost({ userDataDir: dir, mountPlugins: true });
  t.after(async () => { await disposeHost(host); await fs.rm(dir, { recursive: true, force: true }); });
  await fs.mkdir(path.join(host.plugins.dir, 'node_modules', '@deepseek-ai'), { recursive: true });
  await fs.symlink(source, path.join(host.plugins.dir, 'node_modules', name), 'dir');
  assert.deepEqual((await host.plugins.ensureRuntimePeers(name)).failed, []);
  return { dir, host, profile: host.plugins.dir };
}
const tasks = [
  { content: '核对资料', status: 'in_progress' },
  { content: '整理附件', status: 'in_progress' },
];
async function write(host, dir, sessionId, todos = tasks) {
  const result = await host.tools.execute('plugin__dsh_tool_todo__todo_write', { todos },
    { sessionId, runId: 'todo-check', workspacePath: dir, source: 'agent' });
  assert.equal(result.ok, true, result.error);
  const file = path.join(host.plugins.dir, 'data', 'dsh-sessions', createHash('sha256').update(sessionId).digest('hex') + '.json');
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(state.events.filter(event => event.type === 'todo/write').at(-1).data.todos, todos);
}

test('待办默认配置只补缺项，保留显式值、其他插件和分组配置，不修改原始记录', () => {
  const rows = [{ id: 'group', name: 'cordis:group', group: true, config: [
    { id: 'todo', name }, { id: 'single', name, config: { allowParallelInProgress: false } },
    { id: 'invalid', name, config: { allowParallelInProgress: 'false' } },
    { id: 'other', name: 'other', config: { value: 4 } },
  ] }];
  const original = structuredClone(rows);
  const [group] = composeRows(rows, []);
  assert.deepEqual(group.config.map(row => row.config), [
    { allowParallelInProgress: true }, { allowParallelInProgress: false },
    { allowParallelInProgress: 'false' }, { value: 4 },
  ]);
  assert.deepEqual(rows, original);
  assert.equal(pluginConfigDefaults(name, 'invalid'), 'invalid');
  assert.deepEqual(pluginConfigDefaults(name, { allowParallelInProgress: null }), { allowParallelInProgress: null });
});

test('真实待办发布包：复现缺配置失败，直接安装后写入、会话隔离、启停和重启可用', { timeout: 30000 }, async t => {
  const { dir, host, profile } = await fixture(t);
  const bridge = new DshPluginBridge({ profileDir: profile, packageDir: source,
    entryUrl: host.plugins.resolveSpecifier(name), config: {} });
  try { await assert.rejects(bridge.discover(), /allowParallelInProgress.*missing required value/); }
  finally { await bridge.dispose(); }
  const compat = await host.plugins.compatibility({ spec: name });
  assert.equal(compat.verdict, 'runnable', compat.reasons.join('；'));
  const installed = await host.plugins.install({ spec: name });
  assert.equal(installed.ok, true, installed.error);
  assert.deepEqual(host.plugins.entries()[0].config, { allowParallelInProgress: true });
  await write(host, dir, 'first');
  await write(host, dir, 'second', [{ content: '另一项工作', status: 'pending' }]);
  assert.equal((await host.plugins.setEnabled(name, false)).ok, true);
  assert.equal(host.tools.owns('plugin__dsh_tool_todo__todo_write'), false);
  assert.equal((await host.plugins.setEnabled(name, true)).ok, true);
  await disposeHost(host);
  const restored = await createHost({ userDataDir: dir, mountPlugins: true });
  try {
    assert.equal(restored.plugins.entries()[0].active, true);
    await write(restored, dir, 'first', [{ content: '核对资料', status: 'completed' }]);
  } finally { await disposeHost(restored); }
});

test('待办从安装事务进入真实运行环境，重新安装保留单项进行设置且继续执行限制', { timeout: 30000 }, async t => {
  const { dir, host } = await fixture(t);
  // 下载替身仅提供未经修改的已发布包，检查与激活仍运行真实插件。
  const run = async (_command, args, options) => {
    assert.ok(args.includes(`${name}@0.2.1-alpha.1`));
    const target = path.join(options.cwd, 'node_modules', name);
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(source, target, { recursive: true });
    const manifestFile = path.join(options.cwd, 'package.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile));
    manifest.dependencies = { ...manifest.dependencies, [name]: '0.2.1-alpha.1' };
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    return { code: 0, stdout: '', stderr: '' };
  };
  const install = () => host.plugins.installPackage({ input: `${name}@0.2.1-alpha.1`, run });
  let result = await install();
  assert.equal(result.ok, true, result.error);
  await write(host, dir, 'transaction');
  await host.plugins.configure(name, { allowParallelInProgress: false });
  result = await install();
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(host.plugins.entries()[0].config, { allowParallelInProgress: false });
  const rejected = await host.tools.execute('plugin__dsh_tool_todo__todo_write', { todos: tasks },
    { sessionId: 'transaction', runId: 'single-only', workspacePath: dir, source: 'agent' });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /at most one/);
  await write(host, dir, 'transaction', [tasks[0]]);
});

test('旧待办记录缺少必填设置时自动恢复，错误类型仍明确失败', { timeout: 30000 }, async t => {
  const { host, profile } = await fixture(t);
  await fs.writeFile(path.join(profile, 'dyworker.yml'), `- id: dsh-tool-todo\n  name: ${JSON.stringify(name)}\n`);
  assert.equal((await host.plugins.reload()).ok, true);
  assert.equal(host.plugins.entries()[0].active, true);
  await host.plugins.configure('dsh-tool-todo', { allowParallelInProgress: {} });
  assert.equal(host.plugins.entries()[0].active, false);
  assert.match(host.plugins.entries()[0].error, /allowParallelInProgress/);
  await host.plugins.configure('dsh-tool-todo', {});
  assert.equal(host.plugins.entries()[0].active, true);
});
