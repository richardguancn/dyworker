// macOS 内置本机应用操作服务的单元测试。
// 真实图形会话端到端测试仅在 darwin 且设置 DYWORKER_CU_E2E=1 时运行。
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  desktopToolDefinitions,
  captureMacosWindow,
  parsePngDimensions,
  resolveMacosCaptureWindow,
  runMacosChild,
  requestMacosChildStop,
  unpackedResourcePath,
} from "../electron/macos-computer-use-server.mts";
import { McpClient } from "../electron/mcp.mts";
import { toolSummary } from "../electron/agent/tool-summary.mts";

function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test("macOS 工具清单包含权限检查、只读界面读取与受窗口保护的变更操作", () => {
  const tools = desktopToolDefinitions();
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes("check_permissions"));
  assert.ok(names.includes("list_apps"));
  assert.ok(names.includes("get_app_state"));
  assert.ok(names.includes("click"));
  assert.ok(names.includes("hover"));
  assert.ok(names.includes("insert_text"));
  assert.ok(names.includes("set_value"));
  assert.ok(names.includes("press_key"));

  const readOnly = (name) => tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint;
  assert.equal(readOnly("check_permissions"), true);
  assert.equal(readOnly("list_apps"), true);
  assert.equal(readOnly("get_app_state"), true);
  assert.equal(readOnly("click"), false);

  const click = tools.find((tool) => tool.name === "click");
  assert.deepEqual(click.inputSchema.required, ["app", "window_id", "window_title"]);
  const clickProperties = click.inputSchema.properties;
  assert.ok(clickProperties.x && clickProperties.y && clickProperties.element_index);
  for (const name of ['click', 'set_value', 'select_text', 'perform_secondary_action', 'scroll']) {
    assert.equal(tools.find(tool => tool.name === name).inputSchema.properties.observation_id.type, 'string');
  }

  const state = tools.find((tool) => tool.name === "get_app_state");
  const scroll = tools.find((tool) => tool.name === "scroll");
  assert.deepEqual(scroll.inputSchema.required, ["app", "window_id", "window_title", "direction"]);
  assert.ok(scroll.inputSchema.properties.x && scroll.inputSchema.properties.y);
  assert.deepEqual(state.inputSchema.required, ["app"]);
  assert.deepEqual(state.inputSchema.properties.window_id.type, "string");
});

test("解析 PNG 文件头得到截图像素尺寸", () => {
  assert.deepEqual(parsePngDimensions(pngHeader(1920, 1080)), { width: 1920, height: 1080 });
  assert.deepEqual(parsePngDimensions(pngHeader(200, 100)), { width: 200, height: 100 });
  assert.equal(parsePngDimensions(Buffer.alloc(10)), null);
  assert.equal(parsePngDimensions(Buffer.from("not a png header at all!")), null);
});

test("只为进程、标题和位置均吻合的唯一窗口生成截图目标", () => {
  const candidate = { id: 123, pid: 42, title: '目标', x: 100, y: 50, width: 800, height: 600 };
  const identity = { pid: 42, title: '目标', bounds: { x: 100, y: 50, width: 800, height: 600 }, candidates: [candidate] };
  assert.equal(resolveMacosCaptureWindow(identity), candidate);
  assert.equal(resolveMacosCaptureWindow({ ...identity, candidates: [{ ...candidate, pid: 43 }] }), null);
  assert.equal(resolveMacosCaptureWindow({ ...identity, candidates: [{ ...candidate, title: '其他' }] }), null);
  assert.equal(resolveMacosCaptureWindow({ ...identity, candidates: [{ ...candidate, x: 103 }] }), null);
  assert.equal(resolveMacosCaptureWindow({ ...identity, candidates: [candidate, { ...candidate, id: 124 }] }), null);
  assert.equal(resolveMacosCaptureWindow({ ...identity, bounds: { ...identity.bounds, width: NaN } }), null);
  assert.equal(resolveMacosCaptureWindow(null), null);
});

test('截图只请求目标窗口，身份变化或匹配不唯一时不返回画面', async () => {
  const candidate = { id: 123, pid: 42, title: '目标', x: 100, y: 50, width: 800, height: 600 };
  const identity = { pid: 42, title: '目标', bounds: { x: 100, y: 50, width: 800, height: 600 }, candidates: [candidate] };
  let calls = 0;
  const executeCapture = async (_program, args) => {
    calls++;
    assert.ok(args.includes('-l123'));
    assert.ok(!args.includes('-R'));
    await fs.writeFile(args.at(-1), pngHeader(1600, 1200));
    return { code: 0 };
  };
  let fresh = identity;
  const queryIdentity = async () => ({ capture_identity: fresh });
  const capture = await captureMacosWindow(identity, { app: '目标', window_id: '1', window_title: '目标' }, { executeCapture, queryIdentity });
  assert.equal(capture.width, 1600);
  assert.equal(capture.scale, 2);
  fresh = { ...identity, candidates: [{ ...candidate, id: 124 }] };
  assert.equal((await captureMacosWindow(identity, {}, { executeCapture, queryIdentity })).data, '');
  fresh = { ...identity, bounds: { ...identity.bounds, x: 120 }, candidates: [{ ...candidate, x: 120 }] };
  assert.equal((await captureMacosWindow(identity, {}, { executeCapture, queryIdentity })).data, '');
  assert.equal((await captureMacosWindow({ ...identity, candidates: [] }, {}, { executeCapture, queryIdentity })).data, '');
  assert.equal(calls, 3, '无法唯一确定窗口时不得尝试截图');
});

test("打包后把 JXA 助手解析到 app.asar.unpacked 路径", () => {
  const packed = "/Applications/DYWorker.app/Contents/Resources/app.asar/electron/scripts/macos_computer_use.js";
  assert.equal(
    unpackedResourcePath(packed),
    "/Applications/DYWorker.app/Contents/Resources/app.asar.unpacked/electron/scripts/macos_computer_use.js",
  );
  assert.equal(
    unpackedResourcePath("C:\\DYWorker\\resources\\app.asar\\electron\\scripts\\macos_computer_use.js"),
    "C:\\DYWorker\\resources\\app.asar.unpacked\\electron\\scripts\\macos_computer_use.js",
  );
  assert.equal(unpackedResourcePath("/tmp/plain/path.js"), "/tmp/plain/path.js");
});

test("JXA 助手文件存在且包含系统接口调用", async () => {
  const helper = fileURLToPath(new URL("../electron/scripts/macos_computer_use.js", import.meta.url));
  const content = await fs.readFile(helper, "utf8");
  assert.match(content, /AXIsProcessTrusted/);
  assert.match(content, /CGEventCreateMouseEvent/);
  assert.match(content, /DYWORKER_CU_PAYLOAD/);
  assert.ok(path.basename(helper) === "macos_computer_use.js");
});

test('Mac 同名窗口顺序变化后不能沿用旧窗口观察', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const context = vm.createContext({ ObjC: { import() {} } });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, '\nglobalThis.matchWindowForTest = windowIdentityMatches;'), context);
  const bounds = { x: 1, y: 2, width: 800, height: 600 };
  const candidate = { id: 123, pid: 42, title: '同名文档', ...bounds };
  const identity = { pid: 42, title: '同名文档', bounds, candidates: [candidate], sameTitleCount: 2 };
  assert.equal(context.matchWindowForTest(identity, identity), true);
  assert.equal(context.matchWindowForTest(identity, { ...identity, candidates: [{ ...candidate, id: 124 }] }), false);
  assert.equal(context.matchWindowForTest(identity, { ...identity, pid: 43 }), false);
  assert.equal(context.matchWindowForTest(identity, { ...identity, bounds: { ...bounds, x: 9 } }), false);
  const noScreenAccess = { ...identity, candidates: [], sameTitleCount: 1 };
  assert.equal(context.matchWindowForTest(noScreenAccess, noScreenAccess), true);
  assert.equal(context.matchWindowForTest(noScreenAccess, { ...noScreenAccess, sameTitleCount: 2 }), false);
  assert.equal(context.matchWindowForTest({ ...noScreenAccess, sameTitleCount: 2 }, noScreenAccess), false);
});

test('Mac 同名应用按进程编号查询，不使用有歧义的名称枚举', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const target = { unixId: () => 42 };
  const applications = () => { throw new Error('不应按名称枚举'); };
  applications.unixId = () => [12, 42];
  applications[1] = target;
  const context = vm.createContext({ ObjC: { import() {} }, Application: () => ({ applicationProcesses: applications }) });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, '\nglobalThis.findProcessForTest = seProcessFor;'), context);
  assert.equal(context.findProcessForTest({ pid: 42, name: 'Electron' }), target);
  assert.equal(context.findProcessForTest({ pid: 99, name: 'Electron' }), null);
});

test('Mac 多个同名应用或窗口不能按枚举顺序猜测目标', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const context = vm.createContext({ ObjC: { import() {} } });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, `
    runningApps = () => [
      { name: '编辑器', bundleId: 'test.editor', path: '/App', pid: 101 },
      { name: '编辑器', bundleId: 'test.editor', path: '/App', pid: 202 },
    ];
    processWindows = process => process.testWindows;
    globalThis.resolveForTest = resolveApp;
    globalThis.selectWindowForTest = selectWindow;
  `), context);
  assert.throws(() => context.resolveForTest('编辑器'), /pid:101.*pid:202/);
  assert.equal(context.resolveForTest('pid:202').pid, 202);
  const process = { testWindows: [{ index: 1, title: '文档甲' }, { index: 2, title: '文档乙' }] };
  assert.throws(() => context.selectWindowForTest(process, 'test.editor', '', ''), /多个窗口/);
  assert.throws(() => context.selectWindowForTest(process, '文档甲', '', ''), /多个窗口/);
  assert.equal(context.selectWindowForTest(process, 'test.editor', '', '文档甲').title, '文档甲');
  assert.throws(() => context.selectWindowForTest(process, 'test.editor', '', '其他文档'), /没有找到标题/);
  assert.equal(context.selectWindowForTest(process, 'test.editor', '2', '文档乙').title, '文档乙');
  assert.equal(context.selectWindowForTest({ testWindows: [process.testWindows[0]] }, 'test.editor', '', '').title, '文档甲');
});

test('macOS MCP 服务支持排队请求取消，取消的请求不执行', async () => {
  const { handleMessage } = await import('../electron/macos-computer-use-server.mts');
  // 先发取消通知（未激活状态下的排队取消）
  const cancelRes = await handleMessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 999 } });
  assert.equal(cancelRes, null);
  // 排队轮到该请求时
  const response = await handleMessage({ jsonrpc: '2.0', id: 999, method: 'tools/call', params: { name: 'list_apps', arguments: {} } });
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /任务已停止/);
});

test('默认后台模式拒绝需要前台输入的动作及坐标点击', async () => {
  const serverPath = fileURLToPath(new URL('../electron/macos-computer-use-server.mts', import.meta.url));
  const client = new McpClient({ command: process.execPath, args: [serverPath], env: { ...process.env }, requestTimeoutMs: 10000 });
  try {
    await client.connect();
    const target = { app: 'test', window_id: '1', window_title: 'test' };
    for (const [name, args] of [['hover', { x: 10, y: 10 }], ['press_key', { key: 'Return' }], ['type_text', { text: 'example' }], ['scroll', { direction: 'down', x: 10, y: 10 }], ['drag', { from_x: 1, from_y: 1, to_x: 2, to_y: 2 }]]) {
      const result = await client.callTool(name, { ...target, ...args });
      assert.equal(result.isError, true);
      assert.match(result.text, /不支持后台/);
    }
    const click = await client.callTool('click', { ...target, x: 1, y: 1 });
    assert.equal(click.isError, true);
    assert.match(click.text, /后台点击仅支持/);
    for (const action of ['AXShowMenu', ' axshowmenu ', 'AXRaise', 'AXFocus']) {
      const result = await client.callTool('perform_secondary_action', { ...target, element_index: 'e1', action });
      assert.equal(result.isError, true);
      assert.match(result.text, /不能在后台/);
    }
  } finally { await client.close(); }
});

test('前台操作的确认摘要说明会占用用户输入', () => {
  assert.match(toolSummary('mcp__computer-use__click', { app: '测试应用', background: false }), /切换前台并占用鼠标键盘/);
  assert.doesNotMatch(toolSummary('mcp__computer-use__click', { app: '测试应用' }), /占用鼠标键盘/);
});

test('后台局部替换只接受唯一且未变化的原文', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  assert.match(source, /\nmain\(\);\s*$/);
  const context = vm.createContext({ ObjC: { import() {} } });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, '\nglobalThis.replaceForTest = replaceElementTextInBackground;'), context);
  let value = '前😀中间😀后';
  let writable = true;
  const element = { role: () => 'AXTextField' };
  Object.defineProperty(element, 'value', { get: () => () => value, set: next => { if (writable) value = next; } });
  const payload = { old_text: '😀', new_text: '星', expected_element: { raw_value: value } };
  assert.throws(() => context.replaceForTest(element, payload), /多处匹配/);
  assert.equal(value, '前😀中间😀后');
  context.replaceForTest(element, { ...payload, prefix: '前' });
  assert.equal(value, '前星中间😀后');
  assert.throws(() => context.replaceForTest(element, payload), /已变化/);
  value = '前  中间';
  assert.throws(() => context.replaceForTest(element, { old_text: '中间', new_text: '后', expected_element: { raw_value: '前 中间' } }), /已变化/);
  value = '前星中间😀后';
  context.replaceForTest(element, { old_text: '中间', new_text: '', expected_element: { raw_value: value } });
  assert.equal(value, '前星😀后');
  writable = false;
  assert.throws(() => context.replaceForTest(element, { old_text: '前', new_text: '后', expected_element: { raw_value: value } }), /未确认/);
  assert.throws(() => context.replaceForTest({ role: () => 'AXSecureTextField' }, payload), /密码/);
});

test('Mac 在已观察的光标或选区处直接插入，原文或选区变化时停止', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const context = vm.createContext({ ObjC: { import() {} } });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, '\nglobalThis.insertForTest = insertSelectedTextInBackground; globalThis.infoForTest = elementInfo;'), context);
  let value = 'A😀B', range = [2, 3], writes = 0, writable = true;
  const selected = {};
  Object.defineProperty(selected, 'value', { set(text) { writes++; if (writable) value = value.slice(0, range[0] - 1) + text + value.slice(range[1]); } });
  const element = { role: () => 'AXTextField', value: () => value,
    attributes: { byName: name => name === 'AXSelectedTextRange' ? { value: () => range } : selected } };
  const observe = () => ({ raw_value: value, selected_range: [...range] });
  assert.deepEqual(Array.from(context.infoForTest(element).selected_range), [2, 3]);
  context.insertForTest(element, { text: '中', expected_element: observe() });
  assert.equal(value, 'A中B');
  range = [2, 1];
  context.insertForTest(element, { text: '新', expected_element: observe() });
  assert.equal(value, 'A新中B');
  const stale = observe();
  range = [3, 2];
  assert.throws(() => context.insertForTest(element, { text: '误', expected_element: stale }), /选区已变化/);
  assert.throws(() => context.insertForTest(element, { text: '误', expected_element: { ...observe(), raw_value: '旧内容' } }), /原文已变化/);
  value = 'A😀B'; range = [3, 3];
  assert.throws(() => context.insertForTest(element, { text: '误', expected_element: observe() }), /字符内部/);
  range = [2, 3]; writable = false;
  assert.throws(() => context.insertForTest(element, { text: '新', expected_element: observe() }), /未能确认/);
  assert.equal(writes, 3);
  let secretRead = false;
  const secret = { role: () => 'AXSecureTextField', value: () => { secretRead = true; return 'secret'; }, get attributes() { secretRead = true; throw new Error('不得读取'); } };
  assert.throws(() => context.insertForTest(secret, { text: 'x', expected_element: {} }), /密码/);
  context.infoForTest(secret);
  assert.equal(secretRead, false);
});

test('Mac 普通文字角色下的密码框不会读取内容或接受文字操作', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const context = vm.createContext({ ObjC: { import() {} } });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, `
    globalThis.inspectForTest = elementInfo;
    globalThis.editForTest = (element) => {
      ensureTarget = () => ({ windowElement: {} });
      elementAt = () => element;
      activateWindow = () => { throw new Error('不应激活窗口'); };
      return command => dispatch({ command, background: false });
    };
  `), context);
  for (const direct of [true, false]) {
    let sensitiveAccesses = 0;
    const field = {
      role: () => 'AXTextField',
      subrole() { if (direct) return 'AXSecureTextField'; throw new Error('子类型属性不可用'); },
      attributes: { byName(name) {
        if (name === 'AXSubrole') return { value: () => 'AXSecureTextField' };
        sensitiveAccesses++;
        throw new Error('不应访问选区');
      } },
    };
    Object.defineProperty(field, 'value', {
      get() { sensitiveAccesses++; return () => '虚构密码'; },
      set() { sensitiveAccesses++; },
    });
    const info = context.inspectForTest(field);
    assert.equal(info.protected_text, true);
    assert.equal(info.raw_value, null);
    assert.equal(info.selected_range, null);
    const edit = context.editForTest(field);
    for (const command of ['set_value', 'select_text', 'replace_text', 'insert_text']) {
      assert.throws(() => edit(command), /密码控件/);
    }
    assert.equal(sensitiveAccesses, 0);
  }
});

test('Mac 系统脚本可在模拟选区插入混排文字', { skip: process.platform !== 'darwin' }, async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const script = source.replace(/^#![^\n]*\n/, '').replace(/\nmain\(\);\s*$/, `
    let textValue = '前😀后'; const rangeValue = [2, 3];
    const selected = {}; Object.defineProperty(selected, 'value', { set(text) { textValue = textValue.slice(0, 1) + text + textValue.slice(3); } });
    const field = { role: () => 'AXTextField', value: () => textValue,
      attributes: { byName: name => name === 'AXSelectedTextRange' ? { value: () => rangeValue } : selected } };
    const observed = elementInfo(field);
    insertSelectedTextInBackground(field, { text: '中', expected_element: observed });
    console.log(JSON.stringify({ value: textValue }));
  `);
  const result = await runMacosChild('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { timeoutMs: 5000 });
  assert.equal(result.code, 0, result.stderr);
  const line = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).find(item => item.startsWith('{'));
  assert.deepEqual(JSON.parse(line || 'null'), { value: '前中后' });
});

test('Mac 原生无窗口文本控件支持在选区和光标处插入', { skip: process.platform !== 'darwin' }, async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const script = source.replace(/^#![^\n]*\n/, '').replace(/\nmain\(\);\s*$/, `
    const app = $.NSApplication.sharedApplication; app.setActivationPolicy(2);
    const view = $.NSTextView.alloc.initWithFrame($.NSMakeRect(0, 0, 200, 100));
    view.setString($('A😀B')); view.setSelectedRange($.NSMakeRange(1, 2));
    const selected = {}; Object.defineProperty(selected, 'value', { set(text) { view.setAccessibilitySelectedText($(text)); } });
    const field = { role: () => 'AXTextArea', value: () => ObjC.unwrap(view.string), attributes: { byName: name => {
      if (name !== 'AXSelectedTextRange') return selected;
      return { value: () => { const range = view.selectedRange; return [Number(range.location) + 1, Number(range.location) + Number(range.length)]; } };
    } } };
    insertSelectedTextInBackground(field, { text: '中', expected_element: elementInfo(field) });
    view.setSelectedRange($.NSMakeRange(2, 0));
    insertSelectedTextInBackground(field, { text: '新', expected_element: elementInfo(field) });
    let visible = 0; for (let i = 0; i < Number(app.windows.count); i++) if (app.windows.objectAtIndex(i).isVisible) visible++;
    console.log(JSON.stringify({ value: ObjC.unwrap(view.string), visible, active: Boolean(app.isActive) }));
  `);
  const result = await runMacosChild('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { timeoutMs: 20000 });
  assert.equal(result.code, 0, result.stderr);
  const line = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).find(item => item.startsWith('{'));
  assert.deepEqual(JSON.parse(line || 'null'), { value: 'A中新B', visible: 0, active: false });
});

test('Mac 控件右键和双击准确传递按键与次数，越过窗口时停止', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const context = vm.createContext({ ObjC: { import() {} }, calls: [] });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, `
    ensureTarget = () => ({ process: { frontmost: () => true }, windowElement: {} });
    elementAt = () => ({});
    activateWindow = () => calls.push('activate');
    elementBounds = () => ({ center: { x: 120, y: 130 } });
    confirmForegroundWindow = process => {
      confirmPointerApp(process);
      return { x: 100, y: 100, width: 80, height: 80 };
    };
    clickAt = (x, y, button, count) => calls.push([x, y, button, count]);
    globalThis.dispatchForTest = dispatch;
    globalThis.setOutside = () => { elementBounds = () => ({ center: { x: 200, y: 130 } }); };
    globalThis.setUnfocused = () => { elementBounds = () => ({ center: { x: 120, y: 130 } }); ensureTarget = () => ({ process: { frontmost: () => false }, windowElement: {} }); };
  `), context);
  const payload = { command: 'click_element', background: false, element_index: 'e1', mouse_button: 'right', click_count: 2 };
  context.dispatchForTest(payload);
  assert.deepEqual(JSON.parse(JSON.stringify(context.calls)), ['activate', [120, 130, 'right', 2]]);
  context.setOutside();
  assert.throws(() => context.dispatchForTest(payload), /不在目标窗口/);
  context.setUnfocused();
  assert.throws(() => context.dispatchForTest(payload), /不在前台/);
  assert.throws(() => context.dispatchForTest({ ...payload, background: true }), /后台点击仅支持/);
});

test('Mac 双击事件包含正确的点击次数', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const events = [];
  const context = vm.createContext({ ObjC: { import() {} }, delay() {}, $: {
    kCGMouseEventClickState: 1, kCGHIDEventTap: 2, CGPointMake: (x, y) => ({ x, y }), CGEventSourceCreate: () => ({}),
    CGEventCreateMouseEvent: (_source, type) => ({ type }), CGEventSetIntegerValueField: (event, _field, count) => { event.count = count; },
    CGEventPost: (_tap, event) => events.push(event),
  } });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, '\nglobalThis.clickForTest = clickAt;'), context);
  context.clickForTest(10, 20, 'left', 2);
  assert.deepEqual(events.filter(event => event.count).map(event => event.count), [1, 1, 2, 2]);
});

test('Mac 鼠标动作异常时释放已按下的按键，不在按下之前额外释放', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const calls = [];
  let failType = -1;
  const context = vm.createContext({ ObjC: { import() {} }, delay() {}, calls, shouldFail: type => {
    if (type !== failType) return false;
    failType = -1;
    return true;
  } });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, `
    mouseEvent = (type, x, y, button) => { calls.push([type, x, y, button]); if (shouldFail(type)) throw new Error('模拟发送失败'); };
    globalThis.dragForTest = dragAt;
    globalThis.clickForTest = clickAt;
  `), context);
  failType = 5;
  assert.throws(() => context.dragForTest(10, 20, 22, 32), /模拟发送失败/);
  assert.deepEqual(calls.map(call => call[0]), [5]);
  calls.length = 0; failType = 1;
  assert.throws(() => context.dragForTest(10, 20, 22, 32), /模拟发送失败/);
  assert.deepEqual(calls.map(call => call[0]), [5, 1, 2]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), [2, 10, 20, 0]);
  calls.length = 0; failType = 6;
  assert.throws(() => context.dragForTest(10, 20, 22, 32), /模拟发送失败/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), [2, 11, 21, 0]);
  calls.length = 0; failType = 4;
  assert.throws(() => context.clickForTest(10, 20, 'right', 1), /模拟发送失败/);
  assert.deepEqual(calls.map(call => call[0]), [5, 3, 4, 4]);
  calls.length = 0;
  context.dragForTest(10, 20, 22, 32);
  assert.equal(calls.filter(call => call[0] === 2).length, 1);
});

test('Mac 停止进行中的拖拽会先释放已按下的鼠标', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const calls = [];
  let cancelled = false, cancelOnPress = true;
  const context = vm.createContext({ ObjC: { import() {} }, delay() {}, calls, isCancelled: () => cancelled,
    cancelNow: () => { if (cancelOnPress) cancelled = true; } });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, `
    cancellationRequested = () => isCancelled();
    mouseEvent = (type, x, y) => { calls.push([type, x, y]); if (type === 1) cancelNow(); };
    globalThis.dragForTest = dragAt;
  `), context);
  assert.throws(() => context.dragForTest(10, 20, 22, 32), /任务已停止/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[5, 10, 20], [1, 10, 20], [2, 10, 20]]);
  calls.length = 0;
  cancelled = false;
  cancelOnPress = false;
  assert.throws(() => context.dragForTest(10, 20, 22, 32, () => {
    if (calls.some(([type]) => type === 1)) throw new Error('目标应用已不在前台');
  }), /不在前台/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[5, 10, 20], [1, 10, 20], [2, 10, 20]]);
});

test('Mac 不把快捷键发送给同一应用的其他窗口或切换后的前台应用', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const calls = [];
  const bounds = { x: 20, y: 30, width: 200, height: 200 };
  const expected = { pid: 1, title: '原窗口', bounds, sameTitleCount: 1 };
  let focusedTitle = '原窗口', frontmost = true;
  const focused = { attributes: { byName: () => ({ value: () => focusedTitle }) } };
  const process = { frontmost: () => frontmost, attributes: { byName: () => ({ value: () => focused }) } };
  const context = vm.createContext({ ObjC: { import() {} }, targetProcess: process, bounds, calls });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, `
    ensureTarget = () => ({ process: targetProcess, windowElement: {} });
    activateWindow = () => {};
    windowIdentity = (_process, { title }) => ({ pid: 1, title, bounds, sameTitleCount: 1 });
    pressKey = key => calls.push(key);
    globalThis.dispatchForTest = dispatch;
  `), context);
  const payload = { command: 'press_key', background: false, expected_window: expected, key: 'command+s' };
  context.dispatchForTest(payload);
  focusedTitle = '另一个窗口';
  assert.throws(() => context.dispatchForTest(payload), /无法确认目标窗口/);
  focusedTitle = '原窗口';
  frontmost = false;
  assert.throws(() => context.dispatchForTest(payload), /无法确认目标窗口/);
  assert.deepEqual(calls, ['command+s']);
});

test('Mac 控件编辑仅在焦点和内容均可确认时使用键盘', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const calls = [];
  let focused = true, value = '原文', selected = '', selectAllWorks = true, loseFocusOnArrow = false;
  const process = { frontmost: () => true };
  const element = {
    role: () => 'AXTextField',
    get value() { return () => value; },
    set value(_value) { throw new Error('不支持直接设置'); },
    attributes: { byName: name => ({ value: () => name === 'AXFocused' ? focused : name === 'AXSelectedText' ? selected : '' }) },
  };
  const context = vm.createContext({ ObjC: { import() {} }, calls, target: { process },
    send: key => {
      calls.push(key);
      if (key === 'a' && selectAllWorks) selected = value;
      if (key === 126 && loseFocusOnArrow) focused = false;
    },
    paste: text => { calls.push('paste'); value = text; },
  });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, `
    confirmForegroundWindow = () => {};
    systemEvents = () => ({ keystroke: send, keyCode: send });
    typeText = (text, confirm) => { confirm(); paste(text); };
    globalThis.setForTest = (element, payload) => setElementValue(target, element, payload);
    globalThis.selectForTest = (element, payload) => selectElementText(target, element, payload);
  `), context);
  const payload = { value: '新内容', expected_element: { raw_value: '原文' } };
  focused = false;
  assert.throws(() => context.setForTest(element, payload), /无法确认目标控件/);
  assert.deepEqual(calls, []);
  focused = true;
  assert.throws(() => context.setForTest(element, { ...payload, expected_element: { raw_value: '过期原文' } }), /无法确认控件原文/);
  selectAllWorks = false;
  assert.throws(() => context.setForTest(element, payload), /无法确认原文已全部选中/);
  assert.deepEqual(calls, ['a']);
  selectAllWorks = true;
  context.setForTest(element, payload);
  assert.equal(value, '新内容');
  assert.deepEqual(calls, ['a', 'a', 'paste']);
  calls.length = 0;
  loseFocusOnArrow = true;
  assert.throws(() => context.selectForTest(element, { text: '内容', expected_element: { raw_value: value } }), /无法确认目标控件/);
  assert.deepEqual(calls, [126]);
  calls.length = 0;
  focused = true;
  loseFocusOnArrow = false;
  selected = '内容';
  context.selectForTest(element, { text: '内容', expected_element: { raw_value: value }, selection: 'cursor_after' });
  assert.deepEqual(calls, [126, 123, 124, 124, 124, 124]);
});

test('Mac 粘贴取消或切换窗口会恢复原剪贴板，但保留用户后来复制的内容', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  for (const interruption of ['cancel', 'user-copy', 'focus']) {
    let cancelled = false, pastes = 0;
    const board = { value: '原内容', changeCount: 0,
      get pasteboardItems() { const old = this.value; return { count: 1, objectAtIndex: () => ({ types: { count: 1, objectAtIndex: () => 'text' }, dataForType: () => old }) }; },
      get clearContents() { this.value = ''; this.changeCount++; return true; },
      setStringForType(value) { this.value = value; this.changeCount++; return true; },
      writeObjects(saved) { this.value = saved.items[0].data; this.changeCount++; return true; } };
    const objc = value => value;
    objc.NSPasteboard = { generalPasteboard: board };
    objc.NSPasteboardTypeString = 'text';
    objc.NSMutableArray = { alloc: { get init() { return { items: [], get count() { return this.items.length; }, addObject(value) { this.items.push(value); } }; } } };
    objc.NSPasteboardItem = { alloc: { get init() { return { data: '', setDataForType(value) { this.data = value; } }; } } };
    const context = vm.createContext({ ObjC: { import() {} }, $: objc, isCancelled: () => cancelled, paste: () => { pastes++; },
      delay() { cancelled = true; if (interruption === 'user-copy') { board.value = '用户的新内容'; board.changeCount++; } } });
    vm.runInContext(source.replace(/\nmain\(\);\s*$/, `
      cancellationRequested = () => isCancelled();
      systemEvents = () => ({ keystroke: paste });
      globalThis.typeForTest = typeText;
    `), context);
    const confirm = () => { if (interruption === 'focus' && board.value === '临时内容') throw new Error('目标窗口已变化'); };
    assert.throws(() => context.typeForTest('临时内容', confirm), interruption === 'focus' ? /目标窗口已变化/ : /任务已停止/);
    assert.equal(pastes, interruption === 'focus' ? 0 : 1);
    assert.equal(board.value, interruption === 'user-copy' ? '用户的新内容' : '原内容');
  }
});

test('Mac 还未修改剪贴板时停止，不触碰用户剪贴板', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  let checks = 0, clearCount = 0;
  const board = { value: '用户的新内容', changeCount: 3, pasteboardItems: { count: 0 },
    get clearContents() { clearCount++; return true; } };
  const objc = value => value;
  objc.NSPasteboard = { generalPasteboard: board };
  objc.NSMutableArray = { alloc: { init: { count: 0, addObject() {} } } };
  const context = vm.createContext({ ObjC: { import() {} }, $: objc, isCancelled: () => ++checks > 1 });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, `
    cancellationRequested = () => isCancelled();
    globalThis.typeForTest = typeText;
  `), context);
  assert.throws(() => context.typeForTest('临时内容'), /任务已停止/);
  assert.equal(clearCount, 0);
  assert.equal(board.value, '用户的新内容');
});

test('Mac 准备输入时剪贴板被用户更新，不覆盖新内容', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  let clearCount = 0;
  const board = { value: '原内容', changeCount: 0,
    get pasteboardItems() { this.value = '用户的新内容'; this.changeCount++; return { count: 0 }; },
    get clearContents() { clearCount++; return true; } };
  const objc = value => value;
  objc.NSPasteboard = { generalPasteboard: board };
  objc.NSMutableArray = { alloc: { init: { count: 0, addObject() {} } } };
  const context = vm.createContext({ ObjC: { import() {} }, $: objc });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, '\nglobalThis.typeForTest = typeText;'), context);
  assert.throws(() => context.typeForTest('临时内容'), /剪贴板内容已变化/);
  assert.equal(clearCount, 0);
  assert.equal(board.value, '用户的新内容');
});

test('Mac 系统脚本能读取协作停止信号', { skip: process.platform !== 'darwin' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-jxa-cancel-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cancelFile = path.join(root, 'cancel');
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const helpers = source.slice(source.indexOf('function cancellationRequested()'), source.indexOf('function systemEvents()'));
  const script = `ObjC.import('Foundation'); ${helpers} cancellationRequested() ? 'cancelled' : 'running'`;
  const probe = () => runMacosChild('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { env: { DYWORKER_CU_CANCEL_FILE: cancelFile }, timeoutMs: 5000 });
  assert.equal((await probe()).stdout.trim(), 'running');
  await fs.writeFile(cancelFile, 'cancelled');
  assert.equal((await probe()).stdout.trim(), 'cancelled');
});

test('Mac 系统脚本收到停止信号后释放模拟拖拽再退出', { skip: process.platform !== 'darwin' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-jxa-drag-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cancelFile = path.join(root, 'cancel'), readyFile = path.join(root, 'pressed');
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const script = source.replace(/^#![^\n]*\n/, '').replace(/\nmain\(\);\s*$/, `
    const fakeEvents = [];
    mouseEvent = type => { fakeEvents.push(type); if (type === 1) { $('ready').dataUsingEncoding($.NSUTF8StringEncoding).writeToFileAtomically($(${JSON.stringify(readyFile)}), true); delay(0.4); } };
    try { dragAt(10, 20, 30, 40); } catch (error) { console.log(JSON.stringify({ events: fakeEvents, error: String(error.message || error) })); }
  `);
  let child;
  const running = runMacosChild('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {
    env: { DYWORKER_CU_CANCEL_FILE: cancelFile }, cooperativeCancelFile: cancelFile, timeoutMs: 6000, onSpawn: value => { child = value; },
  });
  let early;
  void running.then(result => { early = result; });
  for (let i = 0; i < 150 && !early && !await fs.stat(readyFile).catch(() => null); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(await fs.stat(readyFile).catch(() => null), early ? JSON.stringify(early) : '系统脚本未报告开始');
  requestMacosChildStop(child);
  const result = await running;
  assert.equal(result.code, 0);
  const payload = JSON.parse(`${result.stdout}\n${result.stderr}`.split(/\r?\n/).find(line => line.startsWith('{')) || 'null');
  assert.deepEqual(payload.events, [5, 1, 2]);
  assert.match(payload.error, /任务已停止/);
});

test('停止协作进程时等待清理，完成后才结束请求', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-cancel-child-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cancelFile = path.join(root, 'cancel'), readyFile = path.join(root, 'ready'), cleanupFile = path.join(root, 'cleaned');
  const script = `const fs=require('node:fs'); fs.writeFileSync(process.argv[1],'ready'); const timer=setInterval(()=>{if(fs.existsSync(process.argv[2])){clearInterval(timer);fs.writeFileSync(process.argv[3],'cleaned');process.exit(0)}},10);`;
  let child;
  const running = runMacosChild(process.execPath, ['-e', script, readyFile, cancelFile, cleanupFile], { timeoutMs: 5000, cooperativeCancelFile: cancelFile, onSpawn: value => { child = value; } });
  for (let i = 0; i < 100; i++) { if (await fs.stat(readyFile).catch(() => null)) break; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.ok(await fs.stat(readyFile).catch(() => null));
  requestMacosChildStop(child);
  const result = await running;
  assert.equal(result.code, 0);
  assert.equal(await fs.readFile(cleanupFile, 'utf8'), 'cleaned');
});

test('协作进程无响应时停止请求不会无限等待', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-cancel-stuck-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cancelFile = path.join(root, 'cancel');
  let child;
  const running = runMacosChild(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 10000, cooperativeCancelFile: cancelFile, onSpawn: value => { child = value; } });
  requestMacosChildStop(child);
  const result = await running;
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(await fs.readFile(cancelFile, 'utf8'), 'cancelled');
});

test('Mac 悬停校验目标和位置，后台模式不移动鼠标', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const context = vm.createContext({ ObjC: { import() {} }, calls: [] });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, `
    ensureTarget = () => ({ process: { frontmost: () => true }, windowElement: {} });
    elementAt = () => ({});
    activateWindow = () => calls.push('activate');
    elementBounds = () => ({ center: { x: 120, y: 130 } });
    confirmForegroundWindow = () => ({ x: 100, y: 100, width: 80, height: 80 });
    mouseEvent = (type, x, y) => calls.push([type, x, y]);
    globalThis.dispatchForTest = dispatch;
  `), context);
  context.dispatchForTest({ command: 'hover_element', background: false, element_index: 'e1' });
  context.dispatchForTest({ command: 'hover_at', background: false, x: 40, y: 60, scale: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.calls)), ['activate', [5, 120, 130], 'activate', [5, 120, 130]]);
  assert.throws(() => context.dispatchForTest({ command: 'hover_at', background: false, x: 200, y: 0, scale: 2 }), /不在目标窗口/);
  assert.throws(() => context.dispatchForTest({ command: 'hover_element', element_index: 'e1' }), /不支持后台/);
});

test('Mac 截图坐标操作在激活后核对目标窗口，并检查拖动的两个端点', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../electron/scripts/macos_computer_use.js', import.meta.url)), 'utf8');
  const calls = [];
  const bounds = { x: 100, y: 200, width: 80, height: 60, center: { x: 140, y: 230 } };
  const expected = { pid: 1, title: '目标', bounds, sameTitleCount: 1 };
  let activeTitle = '目标', activated = false;
  const focused = { attributes: { byName: () => ({ value: () => activeTitle }) } };
  const process = { frontmost: () => activated, attributes: { byName: () => ({ value: () => focused }) } };
  const context = vm.createContext({ ObjC: { import() {} }, targetProcess: process, bounds, calls, activate: () => { activated = true; } });
  vm.runInContext(source.replace(/\nmain\(\);\s*$/, `
    ensureTarget = () => ({ process: targetProcess, windowElement: {} });
    activateWindow = activate;
    windowIdentity = (_process, { title }) => ({ pid: 1, title, bounds, sameTitleCount: 1 });
    clickAt = (x, y) => calls.push(['click', x, y]);
    scrollAt = (x, y) => calls.push(['scroll', x, y]);
    dragAt = (x, y, toX, toY) => calls.push(['drag', x, y, toX, toY]);
    globalThis.dispatchForTest = dispatch;
  `), context);
  const target = { background: false, expected_window: expected, scale: 2 };
  const click = { ...target, command: 'click_at', x: 159, y: 119 };
  const scroll = { ...target, command: 'scroll', direction: 'down' };
  const drag = { ...target, command: 'drag', from_x: 0, from_y: 2, to_x: 159, to_y: 119 };
  for (const payload of [click, scroll, drag]) {
    activated = false;
    context.dispatchForTest(payload);
  }
  assert.throws(() => context.dispatchForTest({ ...drag, to_x: 160 }), /不在目标窗口/);
  activeTitle = '同一应用的另一个窗口';
  for (const payload of [click, scroll, drag]) assert.throws(() => context.dispatchForTest(payload), /无法确认目标窗口/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['click', 179, 259], ['scroll', 140, 230], ['drag', 100, 201, 179, 259]]);
});

const e2e = process.platform === "darwin" && process.env.DYWORKER_CU_E2E === "1";
test("macOS 真实图形会话：内置服务完成握手、权限检查、列应用与读取界面", { skip: !e2e }, async () => {
  const serverPath = fileURLToPath(new URL("../electron/macos-computer-use-server.mts", import.meta.url));
  const client = new McpClient({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env },
    requestTimeoutMs: 60_000,
  });
  try {
    await client.connect();
    const names = client.tools.map((tool) => tool.name);
    assert.ok(names.includes("check_permissions"));

    const permissions = await client.callTool("check_permissions", {});
    assert.match(permissions.text, /辅助功能权限/);

    const apps = await client.callTool("list_apps", {});
    assert.ok(apps.text.trim().length > 0);

    const state = await client.callTool("get_app_state", { app: "com.apple.finder" });
    assert.match(state.text, /窗口编号：\d+/);
    assert.ok(state.images.length > 0, "应返回窗口截图");
  } finally {
    await client.close().catch(() => {});
  }
});
