import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BackgroundBrowserSurface, createBackgroundBrowserAgent } from '../electron/desktop/background-browser.mts';
import { TaskBrowserRouter } from '../electron/desktop/task-browser-router.mts';
import { BrowserControlManager } from '../electron/browser-control.mts';
import { BrowserAgent } from '../electron/browser.mts';
import { needsMainWindow, onlyBackgroundWindowsRemain } from '../electron/desktop/window-lifecycle.mts';
import { BackgroundBrowserHandoffs } from '../electron/desktop/background-browser-handoff.mts';
import { cookieMatchesHost, loadSiteSession, toCookieSetDetails } from '../electron/browser-import.mts';

function factory() {
  const windows = [];
  const sessions = new Map();
  const createWindow = options => {
    const debuggerApi = new EventEmitter();
    debuggerApi.attached = false;
    debuggerApi.commands = [];
    debuggerApi.attach = () => { debuggerApi.attached = true; };
    debuggerApi.isAttached = () => debuggerApi.attached;
    debuggerApi.detach = () => { debuggerApi.attached = false; debuggerApi.emit('detach', {}, 'test'); };
    debuggerApi.sendCommand = async (method, args, sessionId) => { debuggerApi.commands.push({ method, args, sessionId }); return method === 'DOM.resolveNode' ? { object: { objectId: 'file-object' } } : {}; };
    let browserSession = sessions.get(options.webPreferences.partition);
    if (!browserSession) {
      browserSession = new EventEmitter();
      browserSession.setPermissionCheckHandler = function(fn) { this.check = fn; };
      browserSession.setPermissionRequestHandler = function(fn) { this.request = fn; };
      browserSession.clearStorageData = async function() { this.storageCleared = true; };
      browserSession.clearCache = async function() { this.cacheCleared = true; };
      sessions.set(options.webPreferences.partition, browserSession);
    }
    const contents = new EventEmitter();
    Object.assign(contents, { id: windows.length + 1, debugger: debuggerApi, destroyed: false, url: '', title: '测试页',
      session: browserSession,
      isDestroyed() { return this.destroyed; }, getURL() { return this.url; }, getTitle() { return this.title; },
      async loadURL(url) { this.url = url; }, setWindowOpenHandler(fn) { this.openHandler = fn; },
    });
    let opacity = options.opacity, focusable = options.focusable, visible = false;
    const win = Object.assign(new EventEmitter(), { options, webContents: contents, isDestroyed: () => contents.destroyed,
      getOpacity: () => opacity, isFocusable: () => focusable, isVisible: () => visible,
      setOpacity(value) { opacity = value; }, setFocusable(value) { focusable = value; },
      show() { visible = true; this.emit('show'); }, hide() { visible = false; }, setIgnoreMouseEvents() {},
      destroy() { contents.destroyed = true; contents.emit('destroyed'); this.emit('closed'); } });
    windows.push(win);
    return win;
  };
  return { createWindow, windows };
}

test('后台浏览器使用独立临时分区，拒绝权限和弹窗并在关闭后释放窗口', async () => {
  const mock = factory();
  const surface = new BackgroundBrowserSurface({ ...mock, ownerSessionId: 'one', runId: 'r1' });
  const other = new BackgroundBrowserSurface({ ...mock, ownerSessionId: 'two', runId: 'r2' });
  assert.notEqual(surface.partition, other.partition);
  assert.ok(!surface.partition.startsWith('persist:'));
  const first = await surface.open('https://example.com');
  assert.equal(first.ok, true);
  const win = mock.windows[0], contents = win.webContents;
  assert.equal(onlyBackgroundWindowsRemain([win]), true);
  assert.equal(needsMainWindow(null), true);
  const mainWindow = { isDestroyed: () => false };
  assert.equal(needsMainWindow(mainWindow), false);
  assert.equal(onlyBackgroundWindowsRemain([win, mainWindow]), false);
  assert.equal(onlyBackgroundWindowsRemain([]), false);
  assert.equal(win.options.show, false);
  assert.equal(win.options.focusable, false);
  assert.equal(win.options.opacity, 0);
  assert.equal(win.options.webPreferences.partition, surface.partition);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(contents.session.check(), false);
  let granted;
  contents.session.request(null, 'media', value => { granted = value; });
  assert.equal(granted, false);
  const auth = { prevented: false, preventDefault() { this.prevented = true; } };
  let authCallback = false;
  contents.emit('login', auth, {}, {}, () => { authCallback = true; });
  assert.equal(auth.prevented, true);
  assert.equal(authCallback, true);
  assert.match(surface.takeNotices().join('\n'), /身份验证/);
  const certificate = { prevented: false, preventDefault() { this.prevented = true; } };
  let chosen = 'unset';
  contents.emit('select-client-certificate', certificate, '', [], value => { chosen = value; });
  assert.equal(certificate.prevented, true);
  assert.equal(chosen, null);
  assert.match(surface.takeNotices().join('\n'), /证书/);
  const download = { prevented: false, preventDefault() { this.prevented = true; } };
  contents.session.emit('will-download', download, {}, contents);
  assert.equal(download.prevented, true);
  assert.match(surface.takeNotices().join('\n'), /自动下载.*取消/);
  assert.ok(contents.debugger.commands.some(item => item.method === 'Page.setInterceptFileChooserDialog' && item.args.enabled));
  assert.ok(contents.debugger.commands.some(item => item.method === 'Page.addScriptToEvaluateOnNewDocument'));
  assert.ok(contents.debugger.commands.some(item => item.method === 'Target.setAutoAttach' && item.args.waitForDebuggerOnStart));
  contents.debugger.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'child-1', targetInfo: { type: 'iframe' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(contents.debugger.commands.some(item => item.method === 'Page.addScriptToEvaluateOnNewDocument' && item.sessionId === 'child-1'));
  assert.ok(contents.debugger.commands.some(item => item.method === 'Runtime.runIfWaitingForDebugger' && item.sessionId === 'child-1'));
  for (const [name, url, isMainFrame, blocked] of [
    ['will-frame-navigate', 'file:///private.txt', true, true],
    ['will-frame-navigate', 'fixture-app://outside', false, true],
    ['will-frame-navigate', 'https://example.com/embedded', false, false],
    ['will-frame-navigate', 'about:srcdoc', false, false],
    ['will-frame-navigate', 'data:text/html,embedded', false, false],
    ['will-frame-navigate', 'data:text/html,top-level', true, true],
    ['will-redirect', 'file:///private.txt', false, true],
    ['will-redirect', 'https://example.org/redirected', true, false],
  ]) {
    const navigation = { url, isMainFrame, prevented: false, preventDefault() { this.prevented = true; } };
    contents.emit(name, navigation);
    assert.equal(navigation.prevented, blocked, url);
  }
  assert.match(surface.takeNotices().join('\n'), /地址.*拦截/);
  assert.deepEqual(contents.openHandler(), { action: 'deny' });
  contents.debugger.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'confirm' });
  contents.debugger.emit('message', {}, 'Page.fileChooserOpened', { backendNodeId: 7 });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(contents.debugger.commands.some(item => item.method === 'Page.handleJavaScriptDialog' && item.args.accept === false));
  assert.ok(contents.debugger.commands.some(item => item.method === 'Runtime.callFunctionOn' && item.args.functionDeclaration.includes("'cancel'")));
  assert.ok(!contents.debugger.commands.some(item => item.method === 'DOM.setFileInputFiles'));
  assert.equal(surface.takeNotices().length, 3);
  const second = await surface.open('https://example.org');
  assert.equal(second.ok, true);
  assert.notEqual(first.tabId, second.tabId);
  assert.equal(surface.listTabs().length, 2);
  assert.equal(surface.activateTab(first.tabId).contents, first.contents);
  await surface.dispose();
  assert.equal(mock.windows.every(item => item.isDestroyed()), true);
  assert.equal(contents.session.storageCleared, true);
  assert.equal(contents.session.cacheCleared, true);
  assert.equal((await surface.open('https://example.com')).ok, false);
  await other.dispose();
});

test('后台页面保护通道断开或请求取消时不会继续导航', async () => {
  const mock = factory();
  const surface = new BackgroundBrowserSurface({ ...mock, ownerSessionId: 'one', runId: 'r1' });
  assert.equal((await surface.open('https://example.com', '', { validate: () => false })).ok, false);
  assert.equal(mock.windows.length, 0);
  const opened = await surface.open('https://example.com');
  opened.contents.debugger.emit('detach', {}, 'unexpected');
  assert.equal(opened.contents.isDestroyed(), true);
  assert.match(surface.takeNotices().join('\n'), /保护通道已断开/);
  await surface.dispose();
});

test('后台拦截新窗口后提供可继续打开的网址，并拒绝不安全或过长的目标', async () => {
  const mock = factory();
  const surface = new BackgroundBrowserSurface({ ...mock, ownerSessionId: 'one', runId: 'r1' });
  const opened = await surface.open('https://example.com');
  assert.deepEqual(opened.contents.openHandler({ url: 'https://example.org/path?q=1' }), { action: 'deny' });
  assert.match(surface.takeNotices().join('\n'), /https:\/\/example\.org\/path\?q=1/);
  assert.deepEqual(opened.contents.openHandler({ url: 'file:///private.txt' }), { action: 'deny' });
  assert.match(surface.takeNotices().join('\n'), /不受支持/);
  assert.deepEqual(opened.contents.openHandler({ url: `https://example.org/${'x'.repeat(5000)}` }), { action: 'deny' });
  assert.match(surface.takeNotices().join('\n'), /过长/);
  assert.equal(surface.listTabs().length, 1);
  await surface.dispose();
});

test('保护通道初始化卡住时关闭窗口且不访问目标网址', async () => {
  const mock = factory();
  const surface = new BackgroundBrowserSurface({ ownerSessionId: 'one', runId: 'r1', setupTimeoutMs: 30, createWindow: options => {
    const win = mock.createWindow(options);
    win.webContents.debugger.sendCommand = () => new Promise(() => {});
    return win;
  } });
  const result = await surface.open('https://example.com');
  assert.equal(result.ok, false);
  assert.match(result.result, /启动超时/);
  assert.equal(mock.windows[0].webContents.url, 'about:blank');
  assert.equal(mock.windows[0].isDestroyed(), true);
  await surface.dispose();
});

test('系统无法确认窗口透明时停止创建后台页面', async () => {
  const mock = factory();
  const surface = new BackgroundBrowserSurface({ ownerSessionId: 'one', runId: 'r1', createWindow: options => {
    const win = mock.createWindow(options);
    win.getOpacity = () => 1;
    return win;
  } });
  const result = await surface.open('https://example.com');
  assert.equal(result.ok, false);
  assert.match(result.result, /无法确认后台窗口透明/);
  assert.equal(mock.windows[0].webContents.url, '');
  assert.equal(mock.windows[0].isDestroyed(), true);
  await surface.dispose();
});

test('打开过程中任务停止会关闭窗口，迟到结果不能重新启用页面', async () => {
  const mock = factory();
  let release, started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const surface = new BackgroundBrowserSurface({ ownerSessionId: 'one', runId: 'r1', createWindow: options => {
    const win = mock.createWindow(options);
    const load = win.webContents.loadURL.bind(win.webContents);
    win.webContents.loadURL = async url => {
      if (url === 'about:blank') return load(url);
      started();
      await new Promise(resolve => { release = resolve; });
      if (win.isDestroyed()) throw new Error('closed');
      return load(url);
    };
    return win;
  } });
  const opening = surface.open('https://example.com');
  await startedPromise;
  const cleanup = surface.dispose();
  release();
  const result = await opening;
  await cleanup;
  assert.equal(result.ok, false);
  assert.equal(surface.getContents(), null);
  assert.equal(mock.windows[0].isDestroyed(), true);
});

test('后台模式独立路由并拒绝隐式切换、伪造接管和停止后的操作', async () => {
  const mock = factory();
  const visibleCalls = [];
  const visible = { controlManager: { session: { ownerSessionId: 'other', runId: 'other' }, pause() { throw new Error('不能暂停其他任务'); } },
    async handle(name) { visibleCalls.push(name); return { ok: true, result: 'visible' }; }, dispose() {} };
  let created;
  const router = new TaskBrowserRouter({ visible, ownerSessionId: 'one', runId: 'r1', createBackground: () => {
    created = createBackgroundBrowserAgent({ ownerSessionId: 'one', runId: 'r1', workspacePath: '/tmp', createWindow: mock.createWindow });
    // 真实页面观察另有 Electron 测试；此处只模拟打开后的观察。
    created.agent.controlManager.observe = async () => ({ ok: true, result: '测试快照', data: {} });
    return created;
  } });
  const open = await router.handle('browser__open', { url: 'https://example.com', background: true });
  assert.equal(open.ok, true, open.result);
  assert.match(open.result, /后台浏览器/);
  assert.equal(created.agent.controlManager.session.tabId, created.surface.activeId);
  const firstContents = mock.windows[0].webContents;
  const second = await router.handle('browser__tabs', { action: 'open', url: 'https://example.org' });
  assert.equal(second.ok, true, second.result);
  assert.equal(created.agent.downloadContentsId, mock.windows[1].webContents.id);
  assert.equal(firstContents.debugger.isAttached(), true);
  const wrongDownload = { prevented: false, preventDefault() { this.prevented = true; } };
  firstContents.session.emit('will-download', wrongDownload, {}, firstContents);
  assert.equal(wrongDownload.prevented, true);
  assert.equal((await router.handle('browser__open', { url: 'https://example.org', background: false })).errorCode, 'BROWSER_MODE_BUSY');
  assert.equal((await router.handle('browser__handoff', { reason: '登录' })).errorCode, 'HANDOFF_UNAVAILABLE');
  assert.deepEqual(visibleCalls, []);
  router.abort();
  assert.equal(mock.windows.every(win => win.isDestroyed()), true);
  assert.equal((await router.handle('browser__open', { url: 'https://example.org', background: true })).errorCode, 'TASK_STOPPED');
  await router.dispose();
});

test('首次打开默认使用后台，并阻止打开期间并发切换到可见页面', async () => {
  let finishOpen;
  const calls = [];
  const background = {
    agent: { handle: async name => { calls.push(`background:${name}`); await new Promise(resolve => { finishOpen = resolve; }); return { ok: true }; }, dispose() {} },
    surface: { listTabs: () => [], takeNotices: () => [], dispose() {} },
  };
  const visible = { handle: async name => { calls.push(`visible:${name}`); return { ok: true }; }, dispose() {} };
  const router = new TaskBrowserRouter({ visible, ownerSessionId: 'one', runId: 'r1', createBackground: () => background });
  const opening = router.handle('browser__open', { url: 'https://example.com' });
  assert.equal((await router.handle('browser__open', { url: 'https://example.org', background: false })).errorCode, 'BROWSER_BUSY');
  assert.deepEqual(calls, ['background:browser__open']);
  finishOpen();
  assert.equal((await opening).ok, true);
  assert.equal((await router.handle('browser__open', { url: 'https://example.org', background: false })).errorCode, 'BROWSER_MODE_BUSY');
  await router.dispose();
});

test('后台页面打开后观察异常时仍保留模式，避免切换并留下页面', async () => {
  let tabs = [];
  const background = {
    agent: { async handle() { tabs = [{ id: 'one' }]; throw new Error('观察失败'); }, dispose() {} },
    surface: { listTabs: () => tabs, takeNotices: () => [], dispose() {} },
  };
  const visible = { async handle() { throw new Error('不应打开可见页面'); }, dispose() {} };
  const router = new TaskBrowserRouter({ visible, ownerSessionId: 'one', runId: 'r1', createBackground: () => background });
  await assert.rejects(router.handle('browser__open', { url: 'https://example.com' }), /观察失败/);
  assert.equal((await router.handle('browser__open', { url: 'https://example.org', background: false })).errorCode, 'BROWSER_MODE_BUSY');
  tabs = [];
  await router.dispose();
});

test('关闭整个可见浏览器后可以重新选择后台浏览器', async () => {
  const calls = [];
  const visible = { async handle(name) { calls.push(`visible:${name}`); return { ok: true }; }, dispose() {} };
  const background = { agent: { async handle(name) { calls.push(`background:${name}`); return { ok: true }; }, dispose() {} },
    surface: { listTabs: () => [], takeNotices: () => [], dispose() {} } };
  const router = new TaskBrowserRouter({ visible, ownerSessionId: 'one', runId: 'r1', createBackground: () => background });
  assert.equal((await router.handle('browser__open', { background: false })).ok, true);
  assert.equal((await router.handle('browser__tabs', { action: 'close' })).ok, true);
  assert.equal((await router.handle('browser__open', { background: true })).ok, true);
  assert.deepEqual(calls, ['visible:browser__open', 'visible:browser__tabs', 'background:browser__open']);
  await router.dispose();
});

test('取消和结束只撤销本任务尚未完成的可见页面打开请求', async () => {
  const manager = new BrowserControlManager();
  const visible = { controlManager: manager, dispose() {} };
  const router = new TaskBrowserRouter({ visible, ownerSessionId: 'one', runId: 'r1', createBackground() { throw new Error('不应创建后台页面'); } });
  const own = manager.reserveOpen({ ownerSessionId: 'one', runId: 'r1' });
  router.abort();
  assert.equal(manager.isOpenReservationValid(own.token), false);
  const next = manager.reserveOpen({ ownerSessionId: 'one', runId: 'r2' });
  await router.dispose();
  assert.equal(manager.isOpenReservationValid(next.token), true);
  manager.dispose();
});

test('取消可见页面打开后，迟到的打开请求不会发起导航', async () => {
  const manager = new BrowserControlManager();
  let resumeOpen, started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  let navigated = false;
  const visible = new BrowserAgent({ controlManager: manager, openPanel: async (_url, _tab, credential) => {
    started();
    await new Promise(resolve => { resumeOpen = resolve; });
    if (!manager.isOpenReservationValid(credential.token)) return { ok: false, result: '打开请求已取消' };
    navigated = true;
    return { ok: false, result: '不应导航' };
  } });
  visible.setContext({ ownerSessionId: 'one', runId: 'r1' });
  const router = new TaskBrowserRouter({ visible, ownerSessionId: 'one', runId: 'r1' });
  const opening = router.handle('browser__open', { url: 'https://example.com', background: false });
  await startedPromise;
  router.abort();
  resumeOpen();
  assert.equal((await opening).ok, false);
  assert.equal(navigated, false);
  await router.dispose();
  manager.dispose();
});

test('任务取消和结束不撤销用户对可见页面的接管', async () => {
  const mock = factory();
  const win = mock.createWindow({ opacity: 0, focusable: false, webPreferences: { partition: 'takeover-test' } });
  const manager = new BrowserControlManager();
  await manager.acquireControl({ ownerSessionId: 'one', runId: 'r1', webContents: win.webContents });
  manager.takeover();
  const agent = { controlManager: manager, dispose() {} };
  const router = new TaskBrowserRouter({ visible: agent, ownerSessionId: 'one', runId: 'r1' });
  router.abort();
  await router.dispose();
  assert.equal(manager.session.status, 'human_control');
  assert.equal(win.isDestroyed(), false);
  manager.dispose();
});

test('后台页面交接只在用户操作时显示，原页面在新任务中恢复', async () => {
  const mock = factory();
  const updates = [];
  const handoffs = new BackgroundBrowserHandoffs({ notify: entries => updates.push(entries) });
  const visible = { dispose() {} };
  let background;
  const router = new TaskBrowserRouter({ visible, ownerSessionId: 'one', runId: 'r1', handoffs, allowHandoff: true,
    createBackground: () => {
      background = createBackgroundBrowserAgent({ ownerSessionId: 'one', runId: 'r1', workspacePath: '/tmp', createWindow: mock.createWindow });
      background.agent.controlManager.observe = async () => ({ ok: true, result: '测试快照', data: {} });
      return background;
    } });
  assert.equal((await router.handle('browser__open', { url: 'https://example.com' })).ok, true);
  const contents = background.surface.getContents();
  const request = await router.handle('browser__handoff', { reason: '人工验证' });
  assert.equal(request.ok, true, request.result);
  assert.equal(background.agent.controlManager.session.status, 'human_control');
  assert.equal(mock.windows[0].isVisible(), false);
  router.abort({ preserveHandoff: true });
  await router.dispose();
  assert.equal(contents.isDestroyed(), false);
  const item = handoffs.list()[0];
  assert.equal((await handoffs.ready(item.id)).ok, false);
  assert.equal((await handoffs.show(item.id)).ok, true);
  assert.equal(mock.windows[0].isVisible(), true);
  assert.equal(onlyBackgroundWindowsRemain([mock.windows[0]]), false, '人工接管窗口是可见窗口');
  const ready = await handoffs.ready(item.id);
  assert.equal(ready.ok, true);
  assert.equal(mock.windows[0].isVisible(), false);
  assert.equal(mock.windows[0].getOpacity(), 0);
  assert.equal(mock.windows[0].isFocusable(), false);
  assert.equal(onlyBackgroundWindowsRemain([mock.windows[0]]), true);
  assert.equal(handoffs.claim('other', ready.runId, '/tmp'), null);
  assert.throws(() => handoffs.claim('one', ready.runId, '/other'), /原工作文件夹/);
  const resumed = handoffs.claim('one', ready.runId, '/tmp');
  assert.equal(resumed, background);
  assert.equal(resumed.surface.getContents(), contents);
  assert.equal(resumed.agent.controlManager.session.runId, ready.runId);
  assert.equal(resumed.agent.controlManager.session.status, 'running');
  assert.equal(handoffs.list().length, 0);
  assert.ok(updates.some(items => items[0]?.state === 'human'));
  await resumed.surface.dispose();
});

test('人工接手前等待先前输入释放，无法确认时关闭页面', async () => {
  for (const releaseOK of [true, false]) {
    const mock = factory();
    const handoffs = new BackgroundBrowserHandoffs();
    const background = createBackgroundBrowserAgent({ ownerSessionId: 'one', runId: 'r1', workspacePath: '/tmp', createWindow: mock.createWindow });
    background.agent.controlManager.observe = async () => ({ ok: true, result: '', data: {} });
    await background.agent.handle('browser__open', { url: 'https://example.com' });
    assert.equal(handoffs.request({ ownerSessionId: 'one', runId: 'r1', background }).ok, true);
    let finishRelease;
    background.agent.controlManager.session.adapter.waitForInputRelease = () => new Promise(resolve => { finishRelease = resolve; });
    const opening = handoffs.show(handoffs.list()[0].id);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(mock.windows[0].isVisible(), false);
    finishRelease(releaseOK);
    const result = await opening;
    assert.equal(result.ok, releaseOK);
    if (releaseOK) assert.equal(mock.windows[0].isVisible(), true);
    else { assert.equal(mock.windows[0].isDestroyed(), true); assert.equal(handoffs.list().length, 0); }
    await handoffs.dispose();
  }
});

test('接手时文件选择必须由用户发起，选择期间不能交还后台', async () => {
  const mock = factory();
  let finishDialog, calls = 0, options;
  const handoffs = new BackgroundBrowserHandoffs({ openFileDialog: value => { calls++; options = value; return new Promise(resolve => { finishDialog = resolve; }); } });
  const background = createBackgroundBrowserAgent({ ownerSessionId: 'one', runId: 'r1', workspacePath: '/tmp', createWindow: mock.createWindow });
  background.agent.controlManager.observe = async () => ({ ok: true, result: '', data: {} });
  await background.agent.handle('browser__open', { url: 'https://example.com' });
  assert.equal(handoffs.request({ ownerSessionId: 'one', runId: 'r1', background }).ok, true);
  const id = handoffs.list()[0].id;
  await handoffs.show(id);
  const debug = background.surface.getContents().debugger;
  const send = debug.sendCommand;
  debug.sendCommand = async (method, args, sessionId) => {
    if (method === 'DOM.describeNode') return { node: { nodeName: 'INPUT', attributes: ['type', 'file', 'multiple', ''] } };
    return send(method, args, sessionId);
  };
  debug.emit('message', {}, 'Page.fileChooserOpened', { backendNodeId: 7, mode: 'selectMultiple' }, 'child-1');
  assert.equal(handoffs.list()[0].filePending, true);
  assert.equal(calls, 0);
  const choosing = handoffs.chooseFile(id);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.deepEqual(options.properties, ['openFile', 'multiSelections']);
  assert.equal((await handoffs.ready(id)).ok, false);
  assert.equal((await handoffs.discard(id)).ok, false);
  assert.equal((await handoffs.show(id)).ok, false);
  finishDialog({ canceled: false, filePaths: ['/tmp/a.txt', '/tmp/b.txt'] });
  assert.equal((await choosing).ok, true);
  assert.ok(debug.commands.some(item => item.method === 'DOM.setFileInputFiles' && item.sessionId === 'child-1' && item.args.files.length === 2));
  assert.equal(handoffs.list()[0].filePending, false);
  assert.equal((await handoffs.ready(id)).ok, true);
  assert.ok(debug.commands.filter(item => item.method === 'Page.setInterceptFileChooserDialog').every(item => item.args.enabled));
  await handoffs.dispose();
});

test('取消选择或页面切换后不会向失效页面填入文件', async () => {
  const mock = factory();
  let finishDialog;
  const handoffs = new BackgroundBrowserHandoffs({ openFileDialog: () => new Promise(resolve => { finishDialog = resolve; }) });
  const background = createBackgroundBrowserAgent({ ownerSessionId: 'one', runId: 'r1', workspacePath: '/tmp', createWindow: mock.createWindow });
  background.agent.controlManager.observe = async () => ({ ok: true, result: '', data: {} });
  await background.agent.handle('browser__open', { url: 'https://example.com' });
  handoffs.request({ ownerSessionId: 'one', runId: 'r1', background });
  const id = handoffs.list()[0].id;
  await handoffs.show(id);
  const contents = background.surface.getContents(), debug = contents.debugger;
  const send = debug.sendCommand;
  debug.sendCommand = async (method, args, sessionId) => {
    if (method === 'DOM.describeNode') return { node: { nodeName: 'INPUT', attributes: ['type', 'file'] } };
    if (method === 'DOM.resolveNode') return { object: { objectId: 'file-object' } };
    return send(method, args, sessionId);
  };
  debug.emit('message', {}, 'Page.fileChooserOpened', { backendNodeId: 7, mode: 'selectSingle' });
  let choosing = handoffs.chooseFile(id);
  await new Promise(resolve => setImmediate(resolve));
  finishDialog({ canceled: true, filePaths: [] });
  assert.equal((await choosing).ok, true);
  assert.equal(handoffs.list()[0].filePending, false);
  assert.equal(debug.commands.some(item => item.method === 'DOM.setFileInputFiles'), false);
  assert.ok(debug.commands.some(item => item.method === 'Runtime.callFunctionOn' && item.args.functionDeclaration.includes("'cancel'")));
  debug.emit('message', {}, 'Page.fileChooserOpened', { backendNodeId: 8, mode: 'selectSingle' });
  choosing = handoffs.chooseFile(id);
  await new Promise(resolve => setImmediate(resolve));
  contents.emit('did-start-navigation', {}, 'https://example.com/other', false, true);
  finishDialog({ canceled: false, filePaths: ['/tmp/a.txt'] });
  assert.equal((await choosing).ok, false);
  assert.equal(debug.commands.some(item => item.method === 'DOM.setFileInputFiles'), false);
  await handoffs.dispose();
});

test('取消任务或用户关闭交接窗口会释放后台页面', async () => {
  for (const closeByUser of [false, true]) {
    const mock = factory();
    const handoffs = new BackgroundBrowserHandoffs();
    let background;
    const router = new TaskBrowserRouter({ visible: { dispose() {} }, ownerSessionId: 'one', runId: 'r1', handoffs, allowHandoff: true,
      createBackground: () => {
        background = createBackgroundBrowserAgent({ ownerSessionId: 'one', runId: 'r1', workspacePath: '/tmp', createWindow: mock.createWindow });
        background.agent.controlManager.observe = async () => ({ ok: true, result: '', data: {} });
        return background;
      } });
    await router.handle('browser__open', { url: 'https://example.com' });
    assert.equal((await router.handle('browser__handoff', { reason: '处理' })).ok, true);
    if (closeByUser) {
      const id = handoffs.list()[0].id;
      assert.equal((await handoffs.show(id)).ok, true);
      mock.windows[0].destroy();
      await new Promise(resolve => setImmediate(resolve));
    } else router.abort();
    await router.dispose();
    assert.equal(handoffs.list().length, 0);
    assert.equal(mock.windows[0].isDestroyed(), true);
    await handoffs.dispose();
  }
});

test('删除所属会话只清理该会话等待处理的页面', async () => {
  const mock = factory();
  const handoffs = new BackgroundBrowserHandoffs();
  const backgrounds = [];
  for (const ownerSessionId of ['one', 'two']) {
    const background = createBackgroundBrowserAgent({ ownerSessionId, runId: 'run', workspacePath: '/tmp', createWindow: mock.createWindow });
    background.agent.controlManager.observe = async () => ({ ok: true, result: '', data: {} });
    await background.agent.handle('browser__open', { url: 'https://example.com' });
    assert.equal(handoffs.request({ ownerSessionId, runId: 'run', background }).ok, true);
    backgrounds.push(background);
  }
  await handoffs.discardOwner('one');
  assert.equal(mock.windows[0].isDestroyed(), true);
  assert.equal(mock.windows[1].isDestroyed(), false);
  assert.deepEqual(handoffs.list().map(item => item.ownerSessionId), ['two']);
  await handoffs.dispose();
});

test('人工处理后继续失败时保留原页面供用户重试', async () => {
  const mock = factory();
  const handoffs = new BackgroundBrowserHandoffs();
  const background = createBackgroundBrowserAgent({ ownerSessionId: 'one', runId: 'r1', workspacePath: '/tmp', createWindow: mock.createWindow });
  background.agent.controlManager.observe = async () => ({ ok: true, result: '', data: {} });
  await background.agent.handle('browser__open', { url: 'https://example.com' });
  const contents = background.surface.getContents();
  assert.equal(handoffs.request({ ownerSessionId: 'one', runId: 'r1', background }).ok, true);
  const first = handoffs.list()[0];
  assert.equal((await handoffs.show(first.id)).ok, true);
  const ready = await handoffs.ready(first.id);
  const claimed = handoffs.claim('one', ready.runId, '/tmp');
  const router = new TaskBrowserRouter({ visible: { dispose() {} }, ownerSessionId: 'one', runId: ready.runId,
    handoffs, claimedBackground: claimed });
  router.abort({ recoverClaim: true });
  await router.dispose();
  assert.equal(contents.isDestroyed(), false);
  const saved = handoffs.list()[0];
  assert.equal(saved.state, 'ready');
  const retry = await handoffs.ready(saved.id);
  assert.notEqual(retry.runId, ready.runId);
  assert.equal(handoffs.claim('one', retry.runId, '/tmp').surface.getContents(), contents);
  await background.surface.dispose();
});

test('系统未显示人工接手窗口时不报告成功，也不能继续任务', async () => {
  const mock = factory();
  const handoffs = new BackgroundBrowserHandoffs();
  const background = createBackgroundBrowserAgent({ ownerSessionId: 'one', runId: 'r1', workspacePath: '/tmp', createWindow: options => {
    const win = mock.createWindow(options);
    win.show = () => {};
    return win;
  } });
  background.surface.showTimeoutMs = 40;
  background.agent.controlManager.observe = async () => ({ ok: true, result: '', data: {} });
  await background.agent.handle('browser__open', { url: 'https://example.com' });
  assert.equal(handoffs.request({ ownerSessionId: 'one', runId: 'r1', background }).ok, true);
  const id = handoffs.list()[0].id;
  const opening = handoffs.show(id);
  assert.equal((await handoffs.show(id)).ok, false);
  const result = await opening;
  assert.equal(result.ok, false);
  assert.match(result.result, /未能打开/);
  assert.equal(handoffs.list()[0].state, 'waiting');
  assert.equal((await handoffs.ready(id)).ok, false);
  assert.equal(mock.windows[0].getOpacity(), 0);
  assert.equal(mock.windows[0].isFocusable(), false);
  assert.equal(onlyBackgroundWindowsRemain(mock.windows), true);
  await handoffs.dispose();
});

test('后台浏览器按目标站点只读载入登录态，无关域名不写入且加载后移除本地存储脚本', async () => {
  const base = factory();
  const written = [];
  const mock = { ...base, createWindow: options => {
    const win = base.createWindow(options);
    win.webContents.session.cookies = { set: async (details) => { written.push(details); } };
    const send = win.webContents.debugger.sendCommand;
    win.webContents.debugger.sendCommand = async (method, args, sessionId) => {
      const value = await send(method, args, sessionId);
      return method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: 'seed-script' } : value;
    };
    return win;
  } };
  const requests = [];
  const surface = new BackgroundBrowserSurface({ ...mock, ownerSessionId: 'one', runId: 'r1', loadSiteSession: async (options) => {
    requests.push(options);
    return { ok: true, sourceLabel: 'Firefox（default-release）', warnings: [],
      cookies: [
        { host: '.example.com', name: 'sid', value: 'a', path: '/', secure: true, httpOnly: true, sameSite: 1, expires: 0 },
        { host: 'app.example.com', name: 'host', value: 'b', path: '/', secure: true, httpOnly: false, sameSite: -1, expires: 0 },
        { host: '.other.com', name: 'leak', value: 'x', path: '/', secure: true, httpOnly: true, sameSite: 1, expires: 0 },
      ],
      localStorage: { 'https://app.example.com': { token: 't' }, 'https://other.com': { leak: 'x' } } };
  } });
  const result = await surface.open('https://app.example.com/inbox', '', { sessionSource: 'firefox', profileId: 'default-release' });
  assert.equal(result.ok, true);
  assert.deepEqual(requests, [{ url: 'https://app.example.com/inbox', source: 'firefox', profileId: 'default-release' }]);
  assert.deepEqual(written.map(item => item.name), ['sid', 'host']);
  assert.equal(written[0].domain, '.example.com');
  assert.equal(written[1].domain, undefined);
  assert.equal(written[0].sameSite, 'lax');
  const commands = base.windows[0].webContents.debugger.commands;
  const added = commands.filter(item => item.method === 'Page.addScriptToEvaluateOnNewDocument' && item.args.source.includes('"token"'));
  assert.equal(added.length, 1);
  assert.doesNotMatch(added[0].args.source, /leak/);
  assert.ok(commands.some(item => item.method === 'Page.removeScriptToEvaluateOnNewDocument' && item.args.identifier === 'seed-script'));
  assert.match(surface.takeNotices().join('\n'), /Firefox.*2 条 Cookie.*1 项本地存储/);
  // 同一来源同一站点不重复读取
  assert.equal((await surface.open('https://app.example.com/other', '', { sessionSource: 'firefox', profileId: 'default-release' })).ok, true);
  assert.equal(requests.length, 1);
  await surface.dispose();
});

test('读取登录态失败时不打开页面，右侧面板拒绝外部浏览器来源', async () => {
  const mock = factory();
  const surface = new BackgroundBrowserSurface({ ...mock, ownerSessionId: 'one', runId: 'r1', loadSiteSession: async () => ({ ok: false, error: '没有找到浏览器「netscape」的数据目录' }) });
  const result = await surface.open('https://example.com', '', { sessionSource: 'netscape' });
  assert.equal(result.ok, false);
  assert.match(result.result, /netscape/);
  assert.equal(surface.listTabs().length, 0);
  const isolated = await new BackgroundBrowserSurface({ ...mock, ownerSessionId: 'one', runId: 'r2' }).open('https://example.com');
  assert.equal(isolated.ok, true);
  const router = new TaskBrowserRouter({ visible: { handle: async () => ({ ok: true }) }, ownerSessionId: 's', runId: 'r', createBackground: () => { throw new Error('不应创建'); } });
  assert.equal((await router.handle('browser__open', { url: 'https://example.com', background: false, sessionSource: 'chrome' })).errorCode, 'INVALID_ARGUMENT');
  assert.equal((await router.handle('browser__open', { url: 'https://example.com', background: false, sessionSource: 'builtin' })).ok, true);
});

test('登录数据准备后取消时移除临时脚本，并在重试时重新准备', async () => {
  const mock = factory();
  let finishLoad, requests = 0, valid = true;
  const surface = new BackgroundBrowserSurface({ ...mock, ownerSessionId: 'one', runId: 'r1', loadSiteSession: async () => {
    requests++;
    if (requests === 1) await new Promise(resolve => { finishLoad = resolve; });
    return { ok: true, cookies: [], localStorage: { 'https://example.com': { token: 'example' } } };
  } });
  const first = await surface.open('https://other.example/');
  const contents = mock.windows[0].webContents;
  const send = contents.debugger.sendCommand;
  contents.debugger.sendCommand = async (method, args, sessionId) => {
    const result = await send(method, args, sessionId);
    if (method === 'Page.addScriptToEvaluateOnNewDocument') {
      if (requests === 1) valid = false;
      return { identifier: 'temporary-seed' };
    }
    return result;
  };
  const opening = surface.open('https://example.com/', first.tabId, { sessionSource: 'firefox', validate: () => valid });
  while (!finishLoad) await new Promise(resolve => setImmediate(resolve));
  finishLoad();
  assert.equal((await opening).ok, false);
  assert.equal(contents.getURL(), 'https://other.example/');
  assert.ok(contents.debugger.commands.some(item => item.method === 'Page.removeScriptToEvaluateOnNewDocument' && item.args.identifier === 'temporary-seed'));
  valid = true;
  assert.equal((await surface.open('https://example.com/', first.tabId, { sessionSource: 'firefox', validate: () => valid })).ok, true);
  assert.equal(requests, 2);
  await surface.dispose();
});

test('无法确认清理登录脚本时关闭后台页面且不报告成功', async () => {
  const base = factory();
  const surface = new BackgroundBrowserSurface({ ...base, ownerSessionId: 'one', runId: 'r1', loadSiteSession: async () => ({
    ok: true, cookies: [], localStorage: { 'https://example.com': { token: 'example' } }
  }), createWindow: options => {
    const win = base.createWindow(options), send = win.webContents.debugger.sendCommand;
    win.webContents.debugger.sendCommand = async (method, args, sessionId) => {
      if (method === 'Page.removeScriptToEvaluateOnNewDocument') throw new Error('清理失败');
      const result = await send(method, args, sessionId);
      return method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: 'temporary-seed' } : result;
    };
    return win;
  } });
  const result = await surface.open('https://example.com/', '', { sessionSource: 'firefox' });
  assert.equal(result.ok, false);
  assert.match(result.result, /无法清理/);
  assert.equal(surface.listTabs().length, 0);
  assert.equal(surface.seededSites.size, 0);
  await surface.dispose();
});

test('后台同站及共享登录域名不能混用不同浏览器账号，互不关联的网站可分别使用', async () => {
  const base = factory(), written = [];
  const surface = new BackgroundBrowserSurface({ ...base, ownerSessionId: 'one', runId: 'r1',
    createWindow: options => { const win = base.createWindow(options); win.webContents.session.cookies = { set: async item => written.push(item) }; return win; },
    loadSiteSession: async ({ url, source, profileId }) => ({ ok: true, sourceIdentity: JSON.stringify([source, profileId]),
      cookies: [{ host: new URL(url).hostname.endsWith('.example.com') ? '.example.com' : new URL(url).hostname,
        name: 'sid', value: source, path: '/', secure: true, expires: 0 }], localStorage: {} }) });
  assert.equal((await surface.open('https://app.example.com/', '', { sessionSource: 'firefox', profileId: 'one' })).ok, true);
  const before = written.length;
  for (const [url, source, profileId] of [
    ['https://app.example.com/', 'chrome', 'one'],
    ['https://app.example.com/', 'firefox', 'two'],
    ['https://mail.example.com/', 'chrome', 'one'],
  ]) {
    const result = await surface.open(url, '', { sessionSource: source, profileId });
    assert.equal(result.ok, false);
    assert.match(result.result, /混用账号/);
  }
  assert.equal(written.length, before);
  assert.equal((await surface.open('https://unrelated.org/', '', { sessionSource: 'chrome', profileId: 'one' })).ok, true);
  await surface.dispose();
});

test('不同名称指向同一浏览器画像时保留同一来源身份', async () => {
  const listBrowsers = async () => [{ id: 'firefox', name: 'Firefox', profiles: [{ id: 'p1', name: 'Personal' }] }];
  const importData = async () => ({ ok: true, cookies: [], localStorage: {}, warnings: [] });
  const byId = await loadSiteSession({ url: 'https://example.com', source: 'firefox', profileId: 'p1', listBrowsers, importData });
  const byName = await loadSiteSession({ url: 'https://example.com', source: 'Firefox', profileId: 'Personal', listBrowsers, importData });
  assert.equal(byId.sourceIdentity, byName.sourceIdentity);
  const builtin = await loadSiteSession({ url: 'https://example.com', source: 'builtin', builtinSession: { cookies: { get: async () => [] } } });
  assert.equal(builtin.sourceIdentity, 'builtin');
});

test('读取子网站登录状态时排除父网站专用 Cookie，保留明确共享的 Cookie', async () => {
  assert.equal(cookieMatchesHost('example.com', 'app.example.com'), false);
  assert.equal(cookieMatchesHost('.example.com', 'app.example.com'), true);
  assert.equal(cookieMatchesHost('.example.com', 'app.example.com', true), false);
  assert.equal(cookieMatchesHost('example.com', 'app.example.com', false), true);
  assert.equal(toCookieSetDetails({ host: 'example.com', hostOnly: false, name: 'shared' }).domain, 'example.com');
  const builtinSession = { cookies: { get: async () => [
    { domain: 'example.com', hostOnly: true, name: 'parent', value: 'a' },
    { domain: '.example.com', hostOnly: false, name: 'shared', value: 'b' },
    { domain: 'app.example.com', hostOnly: true, name: 'exact', value: 'c' },
    { domain: 'other.example.com', hostOnly: true, name: 'other', value: 'd' },
  ] } };
  const loaded = await loadSiteSession({ url: 'https://app.example.com/', source: 'builtin', builtinSession });
  assert.deepEqual(loaded.cookies.map(cookie => cookie.name), ['shared', 'exact']);
  const base = factory(), written = [];
  const surface = new BackgroundBrowserSurface({ ...base, ownerSessionId: 'one', runId: 'run',
    createWindow: options => { const win = base.createWindow(options); win.webContents.session.cookies = { set: async details => written.push(details) }; return win; },
    loadSiteSession: async () => ({ ok: true, cookies: await builtinSession.cookies.get(), localStorage: {} }) });
  assert.equal((await surface.open('https://app.example.com/', '', { sessionSource: 'builtin' })).ok, true);
  assert.deepEqual(written.map(cookie => cookie.name), ['shared', 'exact']);
  await surface.dispose();
});
