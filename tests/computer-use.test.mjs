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
    tool('query', ['app', 'role'], ['app']),
    tool('js', [], []),
  ];
  const calls = [];
  const fixture = { target: '保存' };
  const runtime = createComputerUseRuntime({ platform }, () => {
    const client = { tools, closed: false, connect: async () => {}, close: async () => { client.closed = true; },
      callTool: async (name, args) => {
        calls.push({ name, args, client });
        if (name === 'list_apps') return { text: fixture.apps ?? '文本编辑 — com.example.editor [running]', images: [] };
        if (name === 'get_app_state') return {
          text: fixture.snapshot ?? `App=com.example.editor (pid 123)\nWindow: "便笺", App: 文本编辑.\n0 button ${fixture.target}`,
          images: args.include_screenshot ? [{ mimeType: 'image/png', data: 'AAAA' }] : [],
        };
        if (fixture.handleAction) return fixture.handleAction(name, args);
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

const safari = 'com.apple.Safari';
const fill = 'fill_form';
const safariFields = [
  { element_index: '93', value: '한국어 홍보 문구' },
  { element_index: '101', value: '한국어 설명\n\n둘째 줄' },
  { element_index: '119', value: '' },
];

async function browserForm(t, { afterAction, duplicate = false, directWrite = false, chromium = false } = {}) {
  const { calls, fixture, runtime, call } = harness('darwin');
  t.after(() => runtime.stopAll());
  const app = chromium ? 'com.example.chromium' : safari;
  const appName = chromium ? 'Chromium Browser' : 'Safari浏览器';
  fixture.apps = `${appName} — ${app} [running]`;
  const labels = ['推广文本', '描述', '关键词'];
  const form = { values: ['旧推广文本', '旧描述\n第二行', '旧关键词'], indexes: ['93', '101', '119'],
    language: '韩语', focused: -1, selected: false, showFocus: true, windowId: 4321 };
  const render = () => {
    const value = text => text.replaceAll('\n', '\\n');
    fixture.snapshot = [
      `App=${app} (pid 1306)`,
      `Window: "App Store Connect", App: ${appName}.`,
      chromium ? '0 standard window App Store Connect, Secondary Actions: Raise'
        : '0 标准窗口 App Store Connect ID: SafariWindow?IsSecure=true&UUID=test-window, Secondary Actions: Raise',
      `\t6 ${chromium ? 'HTML content' : 'HTML内容'} App Store Connect, URL: https://appstoreconnect.apple.com/test`,
      '\t\t71 标题 产品页面信息 Value: 3',
      `\t\t74 弹出式按钮 ${form.language}`,
      ...labels.map((label, i) => {
        const kind = chromium ? (i === 2 ? 'text field' : 'text entry area') : (i === 2 ? '文本栏' : '文本输入区');
        const separator = chromium && i < 2 ? ' ' : ' Value: ';
        return `\t\t${form.indexes[i]} ${kind} (settable, string) ${label}${form.values[i] ? separator + value(form.values[i]) : ''}`;
      }),
      ...(duplicate ? ['\t\t121 文本栏 (settable, string) 关键词 Value: 另一个关键词'] : []),
      '\t\t130 按钮 保存',
      '\t211 标签 App Store Connect ID: TabBarTab?isActive=true, Value: on',
      ...(form.focused < 0 || !form.showFocus ? [] : [`The focused UI element is ${form.indexes[form.focused]} editable.`]),
      ...(form.selected ? [`Selected text: [${value(form.values[form.focused])}]`] : []),
    ].join('\n');
  };
  fixture.handleAction = (name, args) => {
    assert.equal(args.app, app);
    if (name === 'query') {
      const matches = args.role === 'AXWebArea' ? [{ title: 'App Store Connect' }]
        : labels.slice(0, 2).map((title, index) => ({ title, value: form.values[index] }));
      return { text: JSON.stringify({ window_id: form.windowId, truncated: false, matches }), images: [] };
    }
    if (name === 'click') {
      assert.equal(args.click_method, 'sky_click');
      form.focused = form.indexes.indexOf(args.element_index);
      form.selected = false;
    } else if (name === 'set_value') {
      if (!directWrite) return { isError: true, text: 'set_value could not verify', images: [] };
      form.values[form.indexes.indexOf(args.element_index)] = args.value;
    } else if (name === 'press_key' && args.key === 'cmd+a') {
      assert.equal(args.key_method, 'sky_key');
      form.selected = true;
    } else if (name === 'type_text' || (name === 'press_key' && args.key === 'backspace')) {
      assert.equal(args.key_method, 'sky_key');
      form.values[form.focused] = args.text ?? '';
      form.selected = false;
      // A changed character counter can shift the rest of the tree.
      form.indexes = form.indexes.map(index => String(Number(index) + 1));
    } else assert.fail(`Unexpected form action: ${name}`);
    afterAction?.(form, name, args);
    render();
    return { text: 'ok', images: [] };
  };
  render();
  const observation = await call('get_app_state', { app, include_screenshot: false });
  assert.equal(observation.ok, true, observation.result);
  return {
    call, calls, form, render, runtime,
    args: { app, observation_id: idOf(observation), fields: safariFields },
    mutations: () => calls.filter(({ name }) => ['click', 'press_key', 'type_text', 'set_value'].includes(name)),
  };
}

test('Safari 一次填写三项，核对韩语、换行、清空和变动后的控件编号', async t => {
  const { call, args, calls, form, mutations, runtime } = await browserForm(t);
  const tool = (await runtime.definitions()).find(tool => tool.function.name === prefix + fill);
  assert.deepEqual(tool.function.parameters.required, ['app', 'fields', 'observation_id']);
  assert.equal(evaluateApproval({ approvalMode: 'deny-changes', name: prefix + fill, args }), 'deny');
  const review = await readReviewObservation({
    name: prefix + fill, args, availableNames: [prefix + 'get_app_state'],
    execute: (name, input, context) => runtime.call(name, input, { ...scope, ...context }),
  });
  assert.equal(review.available, true, review.text);
  assert.match(review.text, /推广文本[\s\S]*描述[\s\S]*关键词/);
  assert.match(review.text, /弹出式按钮 韩语/);
  assert.deepEqual(mutations(), []);
  const result = await call(fill, args);
  assert.equal(result.ok, true, result.result);
  assert.match(result.result, /已核对 3 个输入框：推广文本、描述、关键词/);
  assert.deepEqual(form.values, safariFields.map(field => field.value));
  assert.deepEqual(mutations().filter(({ name }) => name === 'click').map(({ args }) => args.element_index), ['93', '102', '121']);
  assert.ok(calls.filter(({ name }) => name === 'get_app_state').every(({ args }) => !args.include_screenshot));
  assert.equal((await call(fill, args)).ok, false);
});

test('同一个批量工具可填 Chromium 控件，并能区分同名窗口', async t => {
  const { call, args, form, mutations } = await browserForm(t, { chromium: true, directWrite: true });
  form.windowId++;
  const refused = await call(fill, args);
  assert.match(refused.result, /无法核对当前浏览器窗口和表单/);
  assert.deepEqual(mutations(), []);
  form.windowId--;
  const result = await call(fill, args);
  assert.equal(result.ok, true, result.result);
  assert.deepEqual(form.values, safariFields.map(field => field.value));
});

test('网页表单观察直接交给批量填写，拦截逐字段键入及无焦点的全选', async t => {
  const { call, args, calls, form, mutations } = await browserForm(t, { directWrite: true });
  const { app } = args;
  const observed = await call('get_app_state', { app, form_only: true, text_limit: 20, max_tree_depth: 3, max_tree_nodes: 10 });
  assert.equal(observed.ok, true, observed.result);
  assert.match(observed.result, /韩语[\s\S]*93 多行输入框「推广文本」[\s\S]*101 多行输入框「描述」[\s\S]*119 单行输入框「关键词」[\s\S]*fill_form/);
  assert.doesNotMatch(observed.result, /旧推广文本|旧描述|旧关键词/);
  const nativeRead = calls.findLast(call => call.name === 'get_app_state').args;
  assert.deepEqual([nativeRead.text_limit, nativeRead.max_tree_depth, nativeRead.max_tree_nodes, nativeRead.include_screenshot], ['max', 96, 2400, false]);
  const target = { app, observation_id: idOf(observed) };
  assert.match((await call('set_value', { ...target, element_index: '101', value: '法语长描述' })).result, /fill_form/);
  assert.match((await call('press_key', { ...target, key: 'cmd+a' })).result, /fill_form/);
  assert.match((await call('type_text', { ...target, text: '法语长描述' })).result, /fill_form/);
  assert.deepEqual(mutations(), []);
  const result = await call(fill, { ...target, fields: args.fields });
  assert.equal(result.ok, true, result.result);
  assert.deepEqual(form.values, args.fields.map(field => field.value));
});

test('网页只返回浅层快照且焦点未知时，拦截会写入旧焦点的键入', async t => {
  const { call, args, calls, mutations } = await browserForm(t);
  const client = calls.findLast(call => call.name === 'get_app_state').client;
  const invoke = client.callTool;
  client.callTool = (name, input) => name === 'get_app_state' ? Promise.resolve({
    text: [
      `App=${args.app} (pid 1306)`,
      'Window: "P — App Store Connect", App: Safari浏览器.',
      '0 标准窗口 P — App Store Connect ID: SafariWindow?IsSecure=true&UUID=test-window, Secondary Actions: Raise',
      '\t1 分离组',
      '[Accessibility tree truncated: prioritized visible controls; some nodes were omitted.]',
    ].join('\n'), images: [],
  }) : invoke(name, input);
  const observed = await call('get_app_state', { app: args.app, max_tree_depth: 3 });
  assert.match(observed.result, /form_only=true/);
  assert.match((await call('type_text', { app: args.app, observation_id: idOf(observed), text: '法语长描述' })).result, /无法核对文字输入的目标/);
  assert.deepEqual(mutations(), []);
});

test('网页打开时仍可向已经核对焦点的浏览器地址栏输入', async t => {
  const { call, args, calls } = await browserForm(t, { chromium: true });
  const client = calls.findLast(call => call.name === 'get_app_state').client;
  const invoke = client.callTool;
  client.callTool = async (name, input) => {
    if (name === 'type_text') return { text: 'ok', images: [] };
    const result = await invoke(name, input);
    return name === 'get_app_state' ? {
      ...result, text: result.text + '\n\t200 text field (settable, string) Address and search bar\nThe focused UI element is 200 text field.',
    } : result;
  };
  const observed = await call('get_app_state', { app: args.app, include_screenshot: false });
  const result = await call('type_text', { app: args.app, observation_id: idOf(observed), text: 'https://example.com' });
  assert.equal(result.ok, true, result.result);
});

test('Safari 表单切换语言、字段重名或请求重复时，批量填写不会开始', async t => {
  await t.test('同一网址切换语言', async t => {
    const { call, args, form, render, mutations } = await browserForm(t);
    form.language = '法语';
    render();
    assert.match((await call(fill, args)).result, /无法核对当前浏览器窗口和表单/);
    assert.deepEqual(mutations(), []);
  });
  await t.test('重名字段', async t => {
    const { call, args, mutations } = await browserForm(t, { duplicate: true });
    assert.match((await call(fill, args)).result, /无法唯一核对输入框 119/);
    assert.deepEqual(mutations(), []);
  });
  await t.test('重复编号', async t => {
    const { call, args, mutations } = await browserForm(t);
    assert.equal((await call(fill, { ...args, fields: [safariFields[0], safariFields[0]] })).ok, false);
    assert.deepEqual(mutations(), []);
  });
});

test('Safari 焦点跑到已填字段时停止，保留明确的进度', async t => {
  const { call, args, form, mutations } = await browserForm(t, {
    afterAction(state, name) {
      if (name === 'click' && state.focused === 1) state.focused = 0;
    },
  });
  const result = await call(fill, args);
  assert.equal(result.ok, false);
  assert.match(result.result, /未能确认「描述」的写入结果或焦点[\s\S]*已核对：推广文本/);
  assert.deepEqual(mutations().map(action => action.name), ['click', 'set_value', 'press_key', 'type_text', 'click', 'set_value']);
  assert.deepEqual(form.values, ['한국어 홍보 문구', '旧描述\n第二行', '旧关键词']);
});

test('Safari 后台未报告焦点时，按控件写入并读回，不发送键盘输入', async t => {
  const { call, args, form, mutations } = await browserForm(t, {
    directWrite: true,
    afterAction(state) { state.focused = 0; state.showFocus = false; },
  });
  const result = await call(fill, args);
  assert.equal(result.ok, true, result.result);
  assert.deepEqual(form.values, safariFields.map(field => field.value));
  assert.deepEqual(mutations().map(action => action.name), [
    'click', 'set_value', 'click', 'set_value', 'click', 'set_value',
  ]);
});

test('Safari 填写过程中换了语言，停在已经核对的字段', async t => {
  const { call, args, mutations } = await browserForm(t, {
    directWrite: true,
    afterAction(state, name) { if (name === 'click' && state.focused === 1) state.language = '法语'; },
  });
  const result = await call(fill, args);
  assert.equal(result.ok, false);
  assert.match(result.result, /点击「描述」后无法核对原表单[\s\S]*已核对：推广文本/);
  assert.deepEqual(mutations().map(action => action.name), ['click', 'set_value', 'click']);
});

test('Safari 未全选时不输入，网页截断新值时不填写后续字段', async t => {
  await t.test('选区失效', async t => {
    const { call, args, mutations } = await browserForm(t, {
      afterAction(state, name) { if (name === 'press_key') state.selected = false; },
    });
    assert.match((await call(fill, args)).result, /原文已完整选中/);
    assert.deepEqual(mutations().map(action => action.name), ['click', 'set_value', 'press_key']);
  });
  await t.test('新值只写入一部分', async t => {
    const { call, args, mutations } = await browserForm(t, {
      afterAction(state, name) { if (name === 'type_text') state.values[0] = state.values[0].slice(0, 2); },
    });
    const result = await call(fill, args);
    assert.equal(result.ok, false);
    assert.match(result.result, /已核对：无[\s\S]*「推广文本」可能已变化/);
    assert.deepEqual(mutations().map(action => action.name), ['click', 'set_value', 'press_key', 'type_text']);
  });
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
