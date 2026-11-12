import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { discoverComputerUseServer, isComputerUseTool } from '../electron/computer-use.mts';
import { createComputerUseRuntime } from '../electron/desktop/computer-use-runtime.mts';
import { evaluateApproval } from '../electron/agent/permissions.mts';
import { planTaskApproval } from '../electron/agent/review.mts';

const prefix = 'mcp__computer-use__';
const scope = { sessionId: 'session', runId: 'run' };
const app = '123';
const idOf = result => result.result.match(/观察编号：([^\n]+)/)?.[1];

test('macOS、Linux 和 Windows 从安装包选取对应的本机程序', () => {
  const resourcesPath = path.resolve('test-resources');
  const mac = discoverComputerUseServer({ platform: 'darwin', arch: 'arm64', resourcesPath, pathExists: () => true });
  assert.equal(mac.command, path.join(resourcesPath, 'computer-use', 'Open Computer Use.app', 'Contents', 'MacOS', 'OpenComputerUse'));
  for (const [platform, dir, filename] of [
    ['linux', 'linux', 'open-computer-use'], ['win32', 'windows', 'open-computer-use.exe'],
  ]) {
    for (const [arch, nativeArch] of [['x64', 'amd64'], ['arm64', 'arm64']]) {
      const options = { platform, arch, resourcesPath, hostEnv: { OPEN_COMPUTER_USE_ALLOW_GLOBAL_POINTER_FALLBACKS: '1' } };
      const command = path.join(resourcesPath, 'computer-use', dir, nativeArch, filename);
      const server = discoverComputerUseServer({ ...options, pathExists: value => value === command });
      assert.equal(server.command, command);
      assert.deepEqual(server.args, ['mcp']);
      assert.equal(server.env.OPEN_COMPUTER_USE_ALLOW_GLOBAL_POINTER_FALLBACKS, '0');
      assert.equal(server.env.OPEN_COMPUTER_USE_ACTION_READ_BACK, '0');
      assert.equal(server.isolateProcessTree, true);
    }
  }
  assert.equal(discoverComputerUseServer({ platform: 'linux', arch: 'ia32', pathExists: () => true }), null);
  assert.equal(discoverComputerUseServer({ platform: 'win32', pathExists: () => false }), null);
  assert.equal(isComputerUseTool(prefix + 'click'), true);
});

function harness(platform = 'linux') {
  const clients = [];
  const tool = (name, fields, required) => ({
    name, inputSchema: { type: 'object', properties: Object.fromEntries(fields.map(name => [name, { type: 'string' }])), required },
  });
  const tools = [
    tool('list_apps', [], []),
    tool('get_app_state', ['app', 'include_screenshot'], ['app']),
    tool('click', ['app', 'element_index', 'x', 'y', 'click_method'], ['app']),
    tool('press_key', ['app', 'key', 'key_method'], ['app', 'key']),
    tool('set_value', ['app', 'element_index', 'value'], ['app', 'element_index', 'value']),
    tool('js', [], []),
  ];
  const calls = [];
  const fixture = { target: '保存' };
  const runtime = createComputerUseRuntime({ platform }, () => {
    const client = { tools, closed: false, connect: async () => {}, close: async () => { client.closed = true; },
      callTool: async (name, args) => {
        calls.push({ name, args, client });
        if (name === 'list_apps') return { text: '文本编辑 — com.example.editor [running]', images: [] };
        if (name === 'get_app_state') return {
          text: `App=com.example.editor (pid 123)\nWindow: "便笺", App: 文本编辑.\n0 button ${fixture.target}`,
          images: args.include_screenshot ? [{ mimeType: 'image/png', data: 'AAAA' }] : [],
        };
        return { text: 'ok', images: [] };
      } };
    clients.push(client);
    return client;
  });
  return { clients, calls, fixture, runtime, call: (name, args, context = scope) => runtime.call(prefix + name, args, context) };
}

test('Linux 默认只读控件，只派发明确的后台点击，变更界面后拒绝旧观察', async t => {
  const { calls, fixture, runtime, call } = harness();
  t.after(() => runtime.stopAll());
  const definitions = await runtime.definitions();
  assert.ok(definitions.some(tool => tool.function.name === prefix + 'get_shared_app_state'));
  assert.ok(!definitions.some(tool => tool.function.name === prefix + 'js'));
  const before = await call('get_app_state', { app });
  assert.equal(before.images.length, 0);
  assert.equal(calls.at(-1).args.include_screenshot, false);
  const args = { app, observation_id: idOf(before), element_index: '0', click_method: 'global' };
  assert.equal((await call('press_key', { ...args, key: 'Return' })).ok, false);
  assert.ok(!(await call('click', args, { ...scope, runId: 'another' })).ok);
  assert.equal((await call('get_app_state', args, { ...scope, review: true })).ok, true);
  assert.equal((await call('click', args)).ok, true);
  assert.equal(calls.at(-1).args.click_method, 'accessibility');
  assert.equal((await call('click', args)).ok, false);
  const next = await call('get_app_state', { app });
  fixture.target = '删除';
  assert.match((await call('click', { ...args, observation_id: idOf(next) })).result, /已发生变化/);
  assert.equal(calls.filter(call => call.name === 'click').length, 1);
});

test('macOS 按运行中的应用标识定位，用新观察核对进程后定向输入', async t => {
  const { calls, runtime, call } = harness('darwin');
  t.after(() => runtime.stopAll());
  assert.match((await call('get_app_state', { app: 'com.example.not-open' })).result, /打开目标应用/);
  const observation = await call('get_app_state', { app: 'com.example.editor' });
  assert.equal(observation.ok, true);
  assert.equal(observation.images.length, 1);
  const result = await call('press_key', { app: 'com.example.editor', observation_id: idOf(observation), key: 'Return' });
  assert.equal(result.ok, true);
  assert.equal(calls.at(-1).args.key_method, 'sky_key');
});

test('共享桌面截图和键鼠操作需要人工确认', () => {
  for (const approvalMode of ['interactive', 'reviewer', 'full-access', 'auto']) {
    for (const [action, args] of [['get_shared_app_state', {}], ['press_key', { background: false }]]) {
      assert.equal(evaluateApproval({ approvalMode, name: prefix + action, args }), 'ask');
      assert.equal(planTaskApproval({ approvalMode, name: prefix + action, args }), 'confirm');
    }
  }
});

test('本机发布版能走 DYWorker 自己的入口启动并读取工具', async t => {
  const server = discoverComputerUseServer();
  assert.ok(server, 'npm 安装应带有本机运行程序');
  const runtime = createComputerUseRuntime(server);
  t.after(() => runtime.stopAll());
  const tools = await runtime.definitions();
  assert.ok(tools.some(tool => tool.function.name === prefix + 'get_app_state'));
  assert.ok(tools.some(tool => tool.function.name === prefix + 'set_value'));
  if (process.platform === 'darwin') {
    const listed = await runtime.call(prefix + 'list_apps', {}, scope);
    assert.equal(listed.ok, true, listed.result);
    if (listed.result.includes(" — ")) assert.match(listed.result, / — .*\[(?:frontmost, )?running(?:,|\])/);
    const permission = await runtime.call(prefix + 'check_permissions', {}, scope);
    assert.equal(permission.ok, true, permission.result);
    assert.match(permission.result, /辅助功能和屏幕录制/);
  }
  const refused = await runtime.call(prefix + 'click', { app: process.platform === 'darwin' ? 'com.example.editor' : app, element_index: '0' }, scope);
  assert.match(refused.result, /最新观察编号/);
  await runtime.stopRun(scope.sessionId, scope.runId);
});

test('停止任务会关闭本机连接并跳过仍在等待的动作', async t => {
  const controller = new AbortController();
  const context = { ...scope, signal: controller.signal };
  const { clients, calls, runtime, call } = harness('win32');
  t.after(() => runtime.stopAll());
  const observation = await call('get_app_state', { app }, context);
  const client = clients.at(-1);
  const invoke = client.callTool;
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  let end;
  client.callTool = (name, args, options) => {
    if (name !== 'get_app_state') return invoke(name, args, options);
    return new Promise(resolve => { end = resolve; started(); });
  };
  const input = { app, observation_id: idOf(observation), element_index: '0' };
  const pending = call('click', input, context);
  await waiting;
  const queued = call('click', input, context);
  controller.abort();
  end({ text: 'App=com.example.editor (pid 123)\nWindow: "便笺", App: 文本编辑.\n0 button 保存', images: [] });
  const results = await Promise.all([pending, queued]);
  assert.ok(results.every(result => !result.ok));
  assert.equal(client.closed, true);
  assert.ok(!calls.some(call => call.name === 'click'));
});
