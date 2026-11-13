import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { discoverComputerUseServer, isComputerUseTool } from '../electron/computer-use.mts';
import { createComputerUseRuntime } from '../electron/desktop/computer-use-runtime.mts';
import { evaluateApproval } from '../electron/agent/permissions.mts';
import { planTaskApproval } from '../electron/agent/review.mts';
import { readReviewObservation } from '../electron/approval-context.mts';

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
    tool('get_app_state', ['app', 'include_screenshot', 'text_limit'], ['app']),
    tool('click', ['app', 'element_index', 'x', 'y', 'click_method'], ['app']),
    tool('press_key', ['app', 'key', 'key_method'], ['app', 'key']),
    tool('type_text', ['app', 'text', 'key_method'], ['app', 'text']),
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
          text: fixture.snapshot ?? `App=com.example.editor (pid 123)\nWindow: "便笺", App: 文本编辑.\n0 button ${fixture.target}`,
          images: args.include_screenshot ? [{ mimeType: 'image/png', data: 'AAAA' }] : [],
        };
        return fixture.actionResult ?? { text: 'ok', images: [] };
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

test('键盘动作只回报已发送，重新读取才返回完整界面和新观察编号', async t => {
  const { calls, fixture, runtime, call } = harness('darwin');
  t.after(() => runtime.stopAll());
  const app = 'com.example.editor';
  const before = await call('get_app_state', { app, text_limit: '2000' });
  assert.equal(calls.at(-1).args.text_limit, 2000);
  fixture.actionResult = {
    text: 'App=com.example.editor (pid 123)\nWindow: "便笺", App: 文本编辑.\n0 text entry area 刚输入的内容',
    images: [{ mimeType: 'image/png', data: 'AAAA' }],
  };
  const args = { app, observation_id: idOf(before), key: 'Return' };
  const sent = await call('press_key', args);
  assert.equal(sent.ok, true);
  assert.match(sent.result, /已发送[\s\S]*便笺[\s\S]*重新读取/);
  assert.doesNotMatch(sent.result, /刚输入的内容|观察编号/);
  assert.deepEqual(sent.images, []);
  assert.match((await call('press_key', args)).result, /观察已失效/);
  fixture.snapshot = fixture.actionResult.text;
  const after = await call('get_app_state', { app, text_limit: 'max' });
  assert.equal(calls.at(-1).args.text_limit, 'max');
  assert.match(after.result, /刚输入的内容/);
  assert.notEqual(idOf(after), idOf(before));
  assert.equal(after.images.length, 1);
  fixture.actionResult = { ...fixture.actionResult, isError: true };
  const failed = await call('press_key', { ...args, observation_id: idOf(after) });
  assert.equal(failed.ok, false);
  assert.equal(failed.result, fixture.actionResult.text);
  fixture.actionResult.isError = false;
  const inputState = await call('get_app_state', { app, include_screenshot: false });
  const typed = await call('type_text', { app, observation_id: idOf(inputState), text: '测试输入' });
  assert.equal(calls.at(-1).args.text, '测试输入');
  assert.deepEqual(typed, sent);
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

const macApp = 'com.example.editor';
const macState = prefix + 'get_app_state';
const saveDialog = (fileRow = 'row Help: Files', filename = 'New_6.txt', directory = '/', pid = '123') => [
  `App=${macApp} (pid ${pid})`,
  'Window: "保存文件 New_6", App: 文本编辑.',
  '0 dialog 保存文件 New_6',
  `\t2 menu button ${directory}`,
  '\t9 split group',
  '\t\t10 list Files',
  `\t\t\t11 ${fileRow}`,
  `\t20 text field (settable, string) 文件名称 Value: ${filename}`,
  '\t21 button 保存(S), Secondary Actions: Raise',
  'Selected text: [New_6.txt]',
].join('\n');

test('保存面板的列表加载不阻断文件名输入和确认；审核只使用控件文字', async t => {
  const { calls, fixture, runtime, call } = harness('darwin');
  t.after(() => runtime.stopAll());
  fixture.snapshot = saveDialog();
  const original = await call('get_app_state', { app: macApp });
  const args = { app: macApp, element_index: '20', observation_id: idOf(original), value: '/tmp/New_6.txt' };
  fixture.snapshot = saveDialog('row Applications Help: Files');
  const review = await readReviewObservation({
    name: prefix + 'set_value', args, availableNames: [macState],
    execute: (name, input, context) => runtime.call(name, input, { ...scope, ...context }),
  });
  assert.equal(review.available, true, review.text);
  assert.match(review.text, /文件名称 Value: New_6\.txt/);
  assert.deepEqual(review.images, []);
  assert.equal(calls.at(-1).args.include_screenshot, false);
  assert.equal((await call('set_value', args)).ok, true);
  assert.deepEqual(calls.at(-1).args, { app: macApp, element_index: '20', value: '/tmp/New_6.txt' });

  const filled = await call('get_app_state', { app: macApp });
  fixture.snapshot = saveDialog();
  const saved = await call('click', { app: macApp, element_index: '21', observation_id: idOf(filled) });
  assert.equal(saved.ok, true, saved.result);
});

test('保存路径、选中文件、进程或目标按钮变化时停止', async t => {
  const { calls, fixture, runtime, call } = harness('darwin');
  t.after(() => runtime.stopAll());
  for (const changed of [
    saveDialog('row Help: Files', 'Other.txt'),
    saveDialog('row Help: Files', 'New_6.txt', '/Applications'),
    saveDialog('row (selected) Other.txt Help: Files'),
    saveDialog('row Help: Files', 'New_6.txt', '/', '124'),
    saveDialog().replace('21 button 保存(S)', '21 button 删除'),
  ]) {
    fixture.snapshot = saveDialog();
    const original = await call('get_app_state', { app: macApp });
    fixture.snapshot = changed;
    const result = await call('click', { app: macApp, element_index: '21', observation_id: idOf(original) });
    assert.equal(result.ok, false);
    assert.match(result.result, /已发生变化/);
  }
  assert.ok(!calls.some(call => call.name === 'click'));
});

test('替换完成的短暂提示消失后仍能关闭原浮窗，替换条件变化时停止', async t => {
  const { fixture, runtime, call } = harness('darwin');
  t.after(() => runtime.stopAll());
  const replaceDialog = [
    `App=${macApp} (pid 123)`,
    'Window: "文本编辑", App: 文本编辑.',
    '0 floating window Secondary Actions: Raise',
    '\t3 text field (settable, string) Value: 待替换',
    '\t6 text field (settable, string) Value: 已通过',
    '\t18 button 在当前文件中替换(A)',
    '\t21 button 关闭',
    '\t28 text 替换完成，一共 1 处替换！',
    '\t\t29 grow area',
  ].join('\n');
  fixture.snapshot = replaceDialog;
  const before = await call('get_app_state', { app: macApp });
  fixture.snapshot = replaceDialog.replace(' 替换完成，一共 1 处替换！', '');
  assert.equal((await call('click', { app: macApp, element_index: '21', observation_id: idOf(before) })).ok, true);
  const beforeReplace = await call('get_app_state', { app: macApp });
  fixture.snapshot = fixture.snapshot.replace('Value: 待替换', 'Value: 其他词');
  assert.equal((await call('click', { app: macApp, element_index: '18', observation_id: idOf(beforeReplace) })).ok, false);
});

test('导航观察及其审批不返回其他标签的正文、选区或截图', async t => {
  const { calls, fixture, runtime, call } = harness('darwin');
  t.after(() => runtime.stopAll());
  fixture.snapshot = [
    `App=${macApp} (pid 123)`,
    'Window: "New 4", App: 文本编辑.',
    '0 standard window New 4',
    '\t1 text entry area (settable, string) 其他文档的测试密钥',
    '\t2 container New 4',
    '\t\t3 radio button New 6',
    'Selected text: [其他文档的测试密钥]',
  ].join('\n');
  const observation = await call('get_app_state', { app: macApp, controls_only: true, include_screenshot: true });
  assert.equal(calls.at(-1).args.include_screenshot, false);
  assert.deepEqual(observation.images, []);
  assert.match(observation.result, /3 radio button New 6/);
  assert.doesNotMatch(observation.result, /测试密钥|Selected text/);
  const args = { app: macApp, observation_id: idOf(observation), element_index: '3' };
  const review = await call('get_app_state', args, { ...scope, review: true, reviewAction: { name: 'click', args } });
  assert.doesNotMatch(review.result, /测试密钥|Selected text/);
  const write = await call('set_value', { ...args, element_index: '1', value: 'other' });
  assert.equal(write.ok, false);
  assert.equal((await call('click', args)).ok, true);
  assert.equal(calls.at(-1).args.click_method, 'accessibility');
});

test('坐标点击仍需要原图一致', async t => {
  const { clients, calls, fixture, runtime, call } = harness('darwin');
  t.after(() => runtime.stopAll());
  fixture.snapshot = saveDialog();
  const observation = await call('get_app_state', { app: macApp });
  const client = clients.at(-1);
  const invoke = client.callTool;
  client.callTool = async (name, args, opts) => {
    const value = await invoke(name, args, opts);
    if (name === 'get_app_state') value.images[0].data = 'BBBB';
    return value;
  };
  const action = { app: macApp, observation_id: idOf(observation), x: 5, y: 5 };
  const result = await call('click', action);
  assert.equal(result.ok, false);
  assert.ok(!calls.some(call => call.name === 'click'));
});

test('Notepad-- 一次审批后用应用内替换，保留原文引号并复读', async t => {
  const { clients, runtime } = harness('darwin');
  t.after(() => runtime.stopAll());
  const app = 'www.itdp.cn';
  const header = `App=${app} (pid 123)`;
  const document = (body, tab = 'New 6') => [
    header, `Window: "${tab} [文本模式]", App: Notepad--.`, `0 standard window ${tab}`,
    `\t1 text entry area (settable, string) ${body}, Secondary Actions: Raise`,
    `\t\t7 radio button ${tab}`,
    '\t14 checkbox Description: 周期自动保存, Value: on, Secondary Actions: Raise',
    '\t19 button 替换, Secondary Actions: Raise',
  ].join('\n');
  let body = '「待替换」';
  let tab = 'New 6';
  let dialog = false, closing = false, normal = false, matchCase = false, wholeWord = true;
  let find = '', replacement = '';
  const calls = [];
  const tool = prefix + 'replace_document_text';
  const load = await runtime.definitions();
  assert.ok(load.some(x => x.function.name === tool));
  const call = (name, args, context = scope) => runtime.call(prefix + name, args, context);
  // Open the run with an app-list call, then attach a model of the observed Qt controls.
  await call('list_apps', {});
  clients.at(-1).callTool = async (name, args) => {
    calls.push([name, args]);
    if (name === 'list_apps') return { text: `Notepad-- — ${app} [running]`, images: [] };
    if (name === 'get_app_state') {
      if (!dialog) return { text: document(body, tab), images: [] };
      if (closing) dialog = closing = false;
      return { text: [
        header, 'Window: "Notepad--", App: Notepad--.', '0 floating window Secondary Actions: Raise',
        '\t1 text 查找目标：', '\t2 combo box', `\t\t3 text field (settable, string)${find ? ' Value: ' + find : ''}, Secondary Actions: Raise`,
        '\t4 text 替换为：', '\t5 combo box', `\t\t6 text field (settable, string)${replacement ? ' Value: ' + replacement : ''}, Secondary Actions: Raise`,
        `\t8 checkbox 全词匹配 Value: ${wholeWord ? 'on' : 'off'}`,
        `\t9 checkbox 匹配大小写 Value: ${matchCase ? 'on' : 'off'}`,
        '\t11 container 查找模式',
        `\t\t12 radio button 普通 Value: ${normal ? 'on' : 'off'}, Secondary Actions: Raise`,
        '\t18 button 在当前文件中替换(A), Secondary Actions: Raise', '\t21 button 关闭, Secondary Actions: Raise',
      ].join('\n'), images: [] };
    }
    if (name === 'set_value') {
      assert.ok(dialog);
      if (args.element_index === '3') find = args.value;
      else if (args.element_index === '6') replacement = args.value;
      else assert.fail('不能直接写正文');
    } else if (name === 'click') {
      assert.equal(args.click_method, 'accessibility');
      switch (args.element_index) {
        case '19': dialog = true; break;
        case '8': wholeWord = false; break;
        case '9': matchCase = true; break;
        case '12': normal = true; break;
        case '18': assert.ok(normal && matchCase && !wholeWord); body = body.replaceAll(find, replacement); break;
        case '21': closing = true; break;
        default: assert.fail('不能点击保存或其他文档');
      }
    } else assert.fail(`意外工具：${name}`);
    return { text: 'ok', images: [] };
  };

  const state = await call('get_app_state', { app });
  const args = { app, observation_id: idOf(state), old_text: '待替换', new_text: '已通过' };
  const review = await readReviewObservation({
    name: tool, args, availableNames: [macState], execute: (name, input, context) => runtime.call(name, input, { ...scope, ...context }),
  });
  assert.equal(review.available, true, review.text);
  assert.equal(review.images.length, 0);
  assert.ok(!calls.some(([name]) => name === 'click' || name === 'set_value'));
  const result = await call('replace_document_text', args);
  assert.equal(result.ok, true, result.result);
  assert.equal(body, '「已通过」');
  assert.equal(dialog, false);
  assert.equal(calls.filter(([name, args]) => name === 'click' && args.element_index === '18').length, 1);

  body = '待替换，待替换';
  const ambiguous = await call('get_app_state', { app });
  assert.match((await call('replace_document_text', { ...args, observation_id: idOf(ambiguous) })).result, /唯一匹配/);
  body = '「待替换」';
  const stale = await call('get_app_state', { app });
  tab = '另一份文件';
  assert.match((await call('replace_document_text', { ...args, observation_id: idOf(stale) })).result, /刚才读取的文档/);
  const autoSave = await call('get_app_state', { app });
  assert.match((await call('replace_document_text', { ...args, observation_id: idOf(autoSave) })).result, /周期自动保存/);
  assert.equal(calls.filter(([name, args]) => name === 'click' && args.element_index === '18').length, 1);
});
