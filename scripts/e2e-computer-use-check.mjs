// 真实 Electron 页面验收；npm run build:electron 后用 electron 启动本脚本。
// 只访问本机测试站，使用虚构资料，不修改用户账号或招聘网站。
import { app, BrowserWindow, clipboard, protocol } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { BrowserAgent, browserToolDefinitions } from '../dist/electron/browser.mjs';
import { createBackgroundBrowserAgent } from '../dist/electron/desktop/background-browser.mjs';
import { BackgroundBrowserHandoffs } from '../dist/electron/desktop/background-browser-handoff.mjs';
import { TaskBrowserRouter } from '../dist/electron/desktop/task-browser-router.mjs';
import { needsMainWindow, onlyBackgroundWindowsRemain } from '../dist/electron/desktop/window-lifecycle.mjs';
import { readReviewObservation } from '../dist/electron/approval-context.mjs';
import { McpClient } from '../dist/electron/mcp.mjs';
import { fileURLToPath } from 'node:url';

async function main() {
console.log('开始真实浏览器验收');
const productBackground = process.env.DYWORKER_CU_PRODUCT_BACKGROUND_E2E === '1';
const hidden = productBackground || process.env.DYWORKER_CU_HIDDEN_E2E === '1';
if (productBackground) protocol.registerSchemesAsPrivileged([{ scheme: 'dyw-fixture', privileges: { standard: true, secure: true } }]);
app.on('window-all-closed', () => {}); // 清理窗口后由验收结果决定退出码。
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-cu-e2e-')));
app.setPath('userData', path.join(root, 'profile'));
app.commandLine.appendSwitch('force-renderer-accessibility');
const evidence = path.resolve('output/computer-use-check');
await fs.mkdir(evidence, { recursive: true });
const bytes = Buffer.from('%PDF-1.4\n虚构验收简历：张测试，产品经理。\n%%EOF');
await fs.writeFile(path.join(root, '简历.pdf'), bytes);
let saved = null, submissions = 0, childRequests = 0, childConfirmResults = [], window, taskRouter, background, exitCode = 0;
const html = () => `<!doctype html><meta charset="utf-8"><title>简历更新验收</title>
<style>body{font:18px system-ui;padding:30px;max-width:760px}input,textarea,button{font:inherit;margin:8px;padding:8px}label{display:block}#status{padding:20px;background:#e9f6ee}</style>
<h1>简历更新验收（虚构资料）</h1><div id="status">${saved ? `已保存：${saved.name} / ${saved.role} / ${saved.filename}` : '尚未保存'}</div>
<form id="resume"><label>姓名<input name="name" aria-label="姓名"></label><label>求职方向<input name="role" aria-label="求职方向"></label>
<label>自我介绍<textarea name="intro" aria-label="自我介绍"></textarea></label><label>简历附件<input id="file" name="resume" type="file" accept=".pdf" hidden></label><button type="submit">保存简历</button></form>
<input id="sensitive" type="text" autocomplete="current-password" value="fixture-secret-input"><textarea autocomplete="new-password" hidden>fixture-secret-textarea</textarea>
<a href="/other">查看下一页</a><button id="popup" onclick="window.open('/other','_blank')">新窗口测试</button><button id="right" oncontextmenu="event.preventDefault();this.textContent='右键已收到'">右键测试</button>
<button id="dialog" onclick="this.dataset.answer=String(confirm('测试确认'))">弹窗测试</button><button id="choose" onclick="document.querySelector('#file').click()">文件选择测试</button>
<a href="/download" download="fixture.txt">下载测试文件</a>
<div id="shadow"></div><div style="margin-top:700px">${Array.from({ length: 145 }, (_, i) => `<button>后续项目 ${i}</button>`).join('')}</div>
${productBackground ? `<iframe title="跨来源测试" src="http://localhost:${server.address().port}/child"></iframe>` : ''}
<script>
const shadow=document.querySelector('#shadow').attachShadow({mode:'open'});shadow.innerHTML='<input type="file" id="shadowFile" aria-label="影子附件" hidden>';
document.querySelector('form').onsubmit=async event=>{event.preventDefault();const res=await fetch('/save',{method:'POST',body:new FormData(event.target)});document.querySelector('#status').textContent=await res.text();};
</script>`;
const server = http.createServer(async (request, response) => {
  try {
    if (request.url === '/save') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const data = await new Request('http://localhost/save', { method: 'POST', headers: request.headers, body: Buffer.concat(chunks) }).formData();
      const file = data.get('resume');
      saved = { name: data.get('name'), role: data.get('role'), filename: file.name, hash: createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex') };
      submissions++;
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); response.end(`已保存：${saved.name} / ${saved.role} / ${saved.filename}`);
    } else if (request.url === '/child') {
      childRequests++;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<title>跨来源页面</title><script>fetch("/child-result?answer="+String(confirm("子页面测试")))</script>');
    } else if (request.url?.startsWith('/child-result?')) {
      childConfirmResults.push(new URL(request.url, 'http://localhost').searchParams.get('answer'));
      response.writeHead(204); response.end();
    } else if (request.url === '/protected') {
      response.writeHead(401, { 'www-authenticate': 'Basic realm="fixture"', 'content-type': 'text/plain' });
      response.end('需要身份验证');
    } else if (request.url === '/download') {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="fixture.txt"' });
      response.end('后台下载验证');
    } else {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(request.url === '/other' ? '<meta charset="utf-8"><title>第二页</title><h1>第二页已打开</h1>' : html());
    }
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const checks = [];
try {
  await app.whenReady();
  if (hidden && process.platform === 'darwin') app.setActivationPolicy('prohibited');
  app.setAccessibilitySupportEnabled(true);
  console.log('Electron 已就绪');
  let agent;
  let phase = '打开页面';
  let shownCount = 0, focusedCount = 0;
  if (productBackground) {
    background = createBackgroundBrowserAgent({ ownerSessionId: 'resume-e2e', runId: 'run', workspacePath: root, createWindow: options => {
      const win = new BrowserWindow(options);
      win.on('show', () => { shownCount++; console.log(`测试窗口显示：${phase}`); });
      win.on('focus', () => { focusedCount++; console.log(`测试窗口获得焦点：${phase}`); });
      return win;
    } });
    taskRouter = new TaskBrowserRouter({ visible: new BrowserAgent(), ownerSessionId: 'resume-e2e', runId: 'run', createBackground: () => background });
    agent = { handle: (name, args) => taskRouter.handle(name, args), get controlManager() { return background.agent.controlManager; }, dispose: () => taskRouter.dispose() };
    console.log('准备打开后台测试页面');
    const opened = await agent.handle('browser__open', { url });
    assert.equal(opened.ok, true, opened.result);
    assert.ok(childRequests > 0, '跨来源子页面应已加载');
    for (let attempt = 0; !childConfirmResults.length && attempt < 30; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(childConfirmResults[0], 'false', '跨来源子页面的确认弹窗应被取消');
    checks.push('跨来源子页面的确认弹窗已取消');
    console.log('后台测试页面已打开');
    window = background.surface.tabs.get(background.surface.activeId).win;
    assert.equal(window.isVisible(), false, '打开后后台页面不得显示窗口');
    let unsupportedRequests = 0;
    window.webContents.session.protocol.handle('dyw-fixture', () => {
      unsupportedRequests++;
      return new Response('should never load');
    });
    await window.webContents.executeJavaScript(`new Promise(resolve => {
      const frame = document.createElement('iframe');
      frame.srcdoc = '<p>内嵌内容</p>';
      frame.onload = () => resolve(frame.contentDocument.body.textContent);
      frame.id = 'navigation-guard-fixture';
      document.body.append(frame);
    })`).then(value => assert.equal(value, '内嵌内容'));
    const blockedNavigation = new Promise(resolve => {
      window.webContents.on('will-frame-navigate', function verify(event) {
        if (event.url !== 'dyw-fixture://embedded/outside') return;
        window.webContents.removeListener('will-frame-navigate', verify);
        resolve({ prevented: event.defaultPrevented, mainFrame: event.isMainFrame });
      });
    });
    await window.webContents.executeJavaScript(`(() => {
      const frame = document.querySelector('#navigation-guard-fixture');
      frame.src = 'dyw-fixture://embedded/outside';
      frame.removeAttribute('srcdoc');
    })()`);
    const frameResult = await Promise.race([blockedNavigation, new Promise(resolve => {
      setTimeout(() => resolve(null), 3000).unref();
    })]);
    assert.deepEqual(frameResult, { prevented: true, mainFrame: false });
    assert.equal(unsupportedRequests, 0);
    await window.webContents.executeJavaScript("document.querySelector('#navigation-guard-fixture').remove()");
    checks.push('网页内嵌内容正常加载，子页面尝试打开非网页地址时被拦截');
    assert.equal(onlyBackgroundWindowsRemain(BrowserWindow.getAllWindows()), true);
    assert.equal(needsMainWindow(null), true, '后台窗口不能阻止重建主窗口');
    const dummyMain = new BrowserWindow({ show: false, opacity: 0, focusable: false });
    dummyMain.setIgnoreMouseEvents(true);
    assert.equal(needsMainWindow(dummyMain), false);
    assert.equal(onlyBackgroundWindowsRemain(BrowserWindow.getAllWindows()), false);
    dummyMain.destroy();
    checks.push('后台页面不会被误认为应用主窗口');
  } else {
    window = new BrowserWindow({ width: 1100, height: 850, show: !hidden, webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
    await window.loadURL(url);
    agent = new BrowserAgent({ openPanel: async () => ({ ok: true, contents: window.webContents }), getContents: () => window.webContents });
    agent.setContext({ ownerSessionId: 'resume-e2e', runId: 'run', tabId: 'tab' }); agent.setWorkspace(root);
  }
  let observation = await agent.handle('browser__observe', {}), sequence = 0;
  const observe = async (args = {}) => { observation = await agent.handle('browser__observe', args); assert.equal(observation.ok, true, observation.result); return observation; };
  const ref = name => { const target = observation.data.elements.find(el => el.name === name); assert.ok(target, `应找到 ${name}`); return target.ref; };
  const act = async (action, actionId = `action-${++sequence}`) => {
    phase = `${action.type}:${action.ref ?? action.key ?? ''}`;
    if (hidden) assert.equal(window.isFocused(), false, '后台页面操作前不得获得系统焦点');
    const args = { observationId: observation.data.observationId, actionId, action };
    const reviewed = await readReviewObservation({ name: 'browser__act', args, availableNames: browserToolDefinitions().map(tool => tool.function.name), execute: (name, input) => agent.handle(name, input) });
    assert.equal(reviewed.available, true);
    assert.equal(agent.controlManager.session.adapter.currentObservation.observationId, args.observationId, '审核不得作废操作观察');
    const result = await agent.handle('browser__act', args); assert.equal(result.ok, true, result.result);
    if (hidden) assert.equal(window.isVisible(), false, `后台页面在 ${phase} 后不得显示窗口`);
    if (productBackground) for (const record of background.surface.tabs.values()) {
      assert.equal(record.win.isVisible(), false, '所有后台标签页均不得显示窗口');
      assert.equal(record.win.isFocused(), false, '所有后台标签页均不得获得焦点');
    }
    if (hidden) assert.equal(window.isFocused(), false, '后台页面操作后不得获得系统焦点');
    if (result.data) observation = result;
    return { args, result };
  };
  await observe({ offset: 120 }); assert.ok(observation.data.elements.some(el => el.name === '后续项目 140')); checks.push('长页面分段查看');
  await window.webContents.executeJavaScript("document.querySelector('div[style*=margin-top]').remove()");
  await observe();
  if (productBackground) {
    await window.webContents.executeJavaScript(`(() => { const el = document.querySelector('#sensitive'); const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); window.fixtureSecretReads = 0; Object.defineProperty(el, 'value', { configurable: true, get() { window.fixtureSecretReads++; return value.get.call(this); }, set(v) { value.set.call(this, v); } }); })()`);
    await observe();
    assert.ok(!observation.result.includes('fixture-secret-input'));
    const sensitive = await act({ type: 'click', ref: ref('密码输入框') });
    assert.ok(!sensitive.result.result.includes('fixture-secret-input'));
    assert.equal(await window.webContents.executeJavaScript('window.fixtureSecretReads'), 0, '观察和目标核对不得读取密码值');
    const readable = await agent.handle('browser__read', {});
    assert.equal(readable.ok, true, readable.result);
    assert.ok(!readable.result.includes('fixture-secret-textarea'));
    checks.push('特殊密码字段不会在观察和核对中读取或返回内容');
  }
  if (productBackground) {
    const originalTab = background.surface.activeId;
    const popup = await act({ type: 'click', ref: ref('新窗口测试') });
    assert.match(popup.result.result, /后台页面请求打开新窗口，已拦截/);
    assert.ok(popup.result.result.includes(`${url}/other`), '应返回实际目标网址');
    assert.equal(background.surface.listTabs().length, 1, '网站请求不能直接显示新窗口');
    const openedPopup = await agent.handle('browser__tabs', { action: 'open', url: `${url}/other` });
    assert.equal(openedPopup.ok, true, openedPopup.result);
    const popupPage = await agent.handle('browser__read', {});
    assert.equal(popupPage.ok, true, popupPage.result);
    assert.match(popupPage.result, /第二页已打开/);
    const popupTab = background.surface.activeId;
    assert.equal((await agent.handle('browser__tabs', { action: 'close', tabId: popupTab })).ok, true);
    const restored = await agent.handle('browser__tabs', { action: 'activate', tabId: originalTab });
    assert.equal(restored.ok, true, restored.result);
    observation = restored;
    checks.push('新窗口目标可在独立后台标签页打开，原页面保持可用');
  }
  if (process.env.DYWORKER_CU_NATIVE_E2E === '1' && process.platform === 'darwin') {
    const client = new McpClient({ command: process.execPath, args: [fileURLToPath(new URL('../dist/electron/macos-computer-use-server.mjs', import.meta.url))], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, requestTimeoutMs: 60000 });
    try {
      await client.connect();
      const state = await client.callTool('get_app_state', { app: process.execPath });
      assert.equal(state.isError, false, state.text); assert.ok(state.images.length);
      const target = { app: process.execPath, window_id: /窗口编号：(\d+)/.exec(state.text)[1], window_title: /窗口：(.*)/.exec(state.text)[1] };
      const foreground = { ...target, background: false };
      const scale = Number(/缩放比例：([\d.]+)/.exec(state.text)[1]);
      const rect = await window.webContents.executeJavaScript("JSON.stringify((()=>{const r=document.querySelector('[name=name]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})())");
      const point = JSON.parse(rect), bounds = window.getBounds(), content = window.getContentBounds();
      const clicked = await client.callTool('click', { ...foreground, x: (point.x + content.x - bounds.x) * scale, y: (point.y + content.y - bounds.y) * scale }); assert.equal(clicked.isError, false, clicked.text);
      await client.callTool('get_app_state', target);
      const clipboardBefore = clipboard.readText();
      const typed = await client.callTool('type_text', { ...foreground, text: '桌面中文输入验收' }); assert.equal(typed.isError, false, typed.text);
      assert.equal(await window.webContents.executeJavaScript("document.querySelector('[name=name]').value"), '桌面中文输入验收');
      assert.equal(clipboard.readText(), clipboardBefore, '不改变用户原剪贴板文字');
      const editState = await client.callTool('get_app_state', target);
      await fs.writeFile(path.join(evidence, 'native-test-state.txt'), editState.text);
      const line = editState.text.split('\n').find(line => line.includes('value=桌面中文输入验收'));
      assert.ok(line, '应能从原生控件树找到填写后的输入框');
      const element_index = /\[(e\d+)\]/.exec(line)[1];
      const observation_id = /观察编号：([^\s]+)/.exec(editState.text)[1];
      await window.webContents.executeJavaScript("document.querySelector('[name=name]').value='界面已变化'");
      const stale = await client.callTool('select_text', { ...foreground, observation_id, element_index, text: '中文' });
      assert.equal(stale.isError, true, '界面变化后不得继续操作原编号');
      assert.match(stale.text, /控件.*已变化/);
      assert.equal(await window.webContents.executeJavaScript("document.querySelector('[name=name]').value"), '界面已变化');
      await window.webContents.executeJavaScript("document.querySelector('[name=name]').value='桌面中文输入验收'");
      const refreshed = await client.callTool('get_app_state', target);
      const freshLine = refreshed.text.split('\n').find(row => row.includes('value=桌面中文输入验收'));
      const selected = await client.callTool('select_text', { ...foreground, observation_id: /观察编号：([^\s]+)/.exec(refreshed.text)[1], element_index: /\[(e\d+)\]/.exec(freshLine)[1], text: '中文', prefix: '桌面', suffix: '输入验收' });
      assert.equal(selected.isError, false, selected.text);
      const replaced = await client.callTool('type_text', { ...foreground, text: '字符' }); assert.equal(replaced.isError, false, replaced.text);
      assert.equal(await window.webContents.executeJavaScript("document.querySelector('[name=name]').value"), '桌面字符输入验收');
      checks.push('Mac 精确选择原文并局部替换');
      checks.push('Mac 界面变化后拒绝使用过期控件编号');
      checks.push('Mac 原生窗口截图、Retina 坐标点击及中文输入');
    } finally { await client.close(); }
    await observe();
  }
  if (hidden) {
    const clipboardHash = () => createHash('sha256').update(clipboard.readText()).digest('hex');
    await act({ type: 'type', ref: ref('姓名'), text: '任务内复制的文字' });
    await act({ type: 'keypress', key: 'ControlOrMeta+a' });
    const beforeCopy = clipboardHash();
    await act({ type: 'keypress', key: 'ControlOrMeta+c' });
    assert.equal(clipboardHash(), beforeCopy, '复制不能更改系统剪贴板');
    await act({ type: 'type', ref: ref('求职方向'), text: '' });
    await act({ type: 'keypress', key: 'ControlOrMeta+v' });
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('[name=role]').value"), '任务内复制的文字');
    await act({ type: 'keypress', key: 'ControlOrMeta+a' });
    const beforeCut = clipboardHash();
    await act({ type: 'keypress', key: 'ControlOrMeta+x' });
    assert.equal(clipboardHash(), beforeCut, '剪切不能更改系统剪贴板');
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('[name=role]').value"), '');
    await act({ type: 'keypress', key: 'ControlOrMeta+v' });
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('[name=role]').value"), '任务内复制的文字');
    checks.push('复制、剪切、粘贴使用任务内文字且未改变系统剪贴板文本');
  }
  await act({ type: 'type', ref: ref('姓名'), text: '' });
  for (const key of ['/', '+', 'Shift+1', 'Shift+Comma']) await act({ type: 'keypress', key });
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('[name=name]').value"), '/+!<');
  await window.webContents.executeJavaScript("document.querySelector('[name=name]').addEventListener('keydown', e => { if (e.ctrlKey && e.key === '/') { e.preventDefault(); e.target.dataset.shortcut = e.code; } })");
  await act({ type: 'keypress', key: 'Control+/' });
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('[name=name]').dataset.shortcut"), 'Slash');
  checks.push('标点输入和常见组合键在后台页面生效');
  await act({ type: 'type', ref: ref('姓名'), text: '待替换姓名' });
  await act({ type: 'keypress', key: 'ControlOrMeta+a' });
  await act({ type: 'type', text: '张测试' });
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('[name=name]').value"), '张测试'); checks.push('全选快捷键与键入替换');
  await act({ type: 'type', ref: ref('求职方向'), text: '产品经理（中文验收）' }); checks.push('中文表单及审核后继续操作');
  await act({ type: 'type', ref: ref('自我介绍'), text: '第一行' });
  await act({ type: 'keypress', key: 'Enter' });
  await act({ type: 'type', text: '第二行' });
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('textarea').value"), '第一行\n第二行'); checks.push('文本区回车及多行内容');
  await act({ type: 'upload', ref: ref('影子附件'), files: ['简历.pdf'] });
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#shadow').shadowRoot.querySelector('input').files[0].name"), '简历.pdf'); checks.push('Shadow DOM 隐藏文件输入框');
  await act({ type: 'upload', ref: ref('简历附件'), files: ['简历.pdf'] });
  const submit = await act({ type: 'click', ref: ref('保存简历') }, 'submit-once');
  const waited = await agent.handle('browser__wait', { type: 'text_present', value: '已保存：张测试', timeoutMs: 5000 }); assert.equal(waited.ok, true, waited.result); observation = waited;
  const elementWait = await agent.handle('browser__wait', { type: 'element_present', selector: '#status', timeoutMs: 3000 });
  assert.equal(elementWait.ok, true, elementWait.result); observation = elementWait;
  const invalidWait = await agent.handle('browser__wait', { type: 'element_present', selector: '[', timeoutMs: 3000 });
  assert.equal(invalidWait.errorCode, 'INVALID_SELECTOR');
  checks.push('等待文字和元素后重新观察，无效选择器明确报错');
  assert.equal(saved.name, '张测试'); assert.equal(saved.role, '产品经理（中文验收）'); assert.equal(saved.filename, '简历.pdf');
  assert.equal(saved.hash, createHash('sha256').update(bytes).digest('hex')); checks.push('本地文件真实字节上传并保存');
  assert.equal((await agent.handle('browser__act', submit.args)).ok, true); assert.equal(submissions, 1); checks.push('相同提交不重复发送');
  await observe(); await act({ type: 'reload' });
  const reloaded = await agent.handle('browser__wait', { type: 'text_present', value: '已保存：张测试', timeoutMs: 5000 }); assert.equal(reloaded.ok, true, reloaded.result); observation = reloaded; checks.push('刷新后确认保存结果');
  await act({ type: 'right_click', ref: ref('右键测试') }); assert.ok((await agent.handle('browser__read')).result.includes('右键已收到')); checks.push('真实右键事件');
  if (productBackground) {
    const dialog = await act({ type: 'click', ref: ref('弹窗测试') });
    assert.match(dialog.result.result, /对话框.*已拦截/);
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('#dialog').dataset.answer"), 'false');
    await act({ type: 'upload', ref: ref('简历附件'), files: ['简历.pdf'] });
    await window.webContents.executeJavaScript("document.querySelector('#file').addEventListener('cancel', () => document.querySelector('#file').dataset.cancelled = 'yes')");
    const chooser = await act({ type: 'click', ref: ref('文件选择测试') });
    assert.match(chooser.result.result, /文件选择窗口.*已拦截/);
    for (let attempt = 0; attempt < 30 && !(await window.webContents.executeJavaScript("document.querySelector('#file').dataset.cancelled")); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('#file').dataset.cancelled"), 'yes');
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('#file').files[0]?.name"), '简历.pdf', '后台拦截不应清空已选择的文件');
    await act({ type: 'click', ref: ref('下载测试文件') });
    const downloadPath = path.join(root, '下载', 'fixture.txt');
    let downloaded = '';
    for (let attempt = 0; attempt < 50; attempt++) {
      downloaded = await fs.readFile(downloadPath, 'utf8').catch(() => '');
      if (downloaded === '后台下载验证') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(downloaded, '后台下载验证');
    assert.match((await agent.handle('browser__downloads', {})).result, /fixture\.txt/);
    assert.equal((await agent.handle('browser__handoff', { reason: '测试接管' })).errorCode, 'HANDOFF_UNAVAILABLE');
    assert.equal((await agent.handle('browser__open', { url, background: false })).errorCode, 'BROWSER_MODE_BUSY');
    checks.push('系统弹窗和文件选择被拦截，后台下载已保存，接管与切换限制有明确反馈');
  }
  await fs.writeFile(path.join(evidence, 'resume-saved.png'), (await window.webContents.capturePage()).toPNG());
  await act({ type: 'click', ref: ref('查看下一页') });
  const next = await agent.handle('browser__wait', { type: 'text_present', value: '第二页已打开', timeoutMs: 5000 }); assert.equal(next.ok, true); observation = next;
  await act({ type: 'back' });
  const back = await agent.handle('browser__wait', { type: 'text_present', value: '已保存：张测试', timeoutMs: 5000 }); assert.equal(back.ok, true); observation = back;
  await act({ type: 'forward' });
  const forward = await agent.handle('browser__wait', { type: 'text_present', value: '第二页已打开', timeoutMs: 5000 }); assert.equal(forward.ok, true); observation = forward; checks.push('前进后退');
  if (productBackground) {
    const firstTab = background.surface.activeId;
    const firstContents = window.webContents;
    const auth = await agent.handle('browser__tabs', { action: 'open', url: `${url}/protected` });
    assert.match(auth.result, /身份验证/);
    for (const record of background.surface.tabs.values()) assert.equal(record.win.isVisible(), false);
    if (auth.ok) {
      const authTab = background.surface.activeId;
      assert.equal((await agent.handle('browser__tabs', { action: 'close', tabId: authTab })).ok, true);
      const restored = await agent.handle('browser__tabs', { action: 'activate', tabId: firstTab });
      assert.equal(restored.ok, true, restored.result);
    }
    const second = await agent.handle('browser__tabs', { action: 'open', url });
    assert.equal(second.ok, true, second.result);
    assert.equal(background.surface.listTabs().length, 2);
    assert.equal(firstContents.debugger.isAttached(), true, '切换后台标签页不能解除保护');
    observation = second;
    await act({ type: 'click', ref: ref('下载测试文件') });
    let secondDownload = '';
    for (let attempt = 0; attempt < 50; attempt++) {
      secondDownload = await fs.readFile(path.join(root, '下载', 'fixture(1).txt'), 'utf8').catch(() => '');
      if (secondDownload === '后台下载验证') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(secondDownload, '后台下载验证');
    const switched = await agent.handle('browser__tabs', { action: 'activate', tabId: firstTab });
    assert.equal(switched.ok, true, switched.result);
    observation = switched;
    checks.push('身份验证不弹系统窗口，多标签切换保持保护通道并能下载');
    const closeCheck = createBackgroundBrowserAgent({ ownerSessionId: 'close-check', runId: 'run', workspacePath: root, createWindow: options => {
      const testWindow = new BrowserWindow(options);
      testWindow.on('show', () => { shownCount++; });
      testWindow.on('focus', () => { focusedCount++; });
      return testWindow;
    } });
    try {
      assert.equal((await closeCheck.agent.handle('browser__open', { url: `${url}/other` })).ok, true);
      const closedContents = closeCheck.surface.getContents();
      assert.equal((await closeCheck.agent.handle('browser__tabs', { action: 'close' })).ok, true);
      assert.equal(closeCheck.agent.controlManager.session.status, 'stopped');
      for (let attempt = 0; !closedContents.isDestroyed() && attempt < 30; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(closedContents.isDestroyed(), true);
      assert.equal(closeCheck.agent.downloadHandler, null);
      checks.push('关闭所有页面后停止控制并释放下载处理');
    } finally {
      closeCheck.agent.dispose();
      await closeCheck.surface.dispose();
    }
    let chooserCalls = 0;
    const handoffs = new BackgroundBrowserHandoffs({ openFileDialog: async () => { chooserCalls++; return chooserCalls === 2 ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [path.join(root, '简历.pdf')] }; } });
    let handedBackground, handoffShown = 0;
    const handoffRouter = new TaskBrowserRouter({ visible: new BrowserAgent(), ownerSessionId: 'handoff-e2e', runId: 'original-run', handoffs, allowHandoff: true,
      createBackground: () => {
        handedBackground = createBackgroundBrowserAgent({ ownerSessionId: 'handoff-e2e', runId: 'original-run', workspacePath: root, createWindow: options => {
          const testWindow = new BrowserWindow(options);
          // 真正执行显示事件，但保持透明、忽略鼠标且不激活应用，避免干扰用户。
          const setOpacity = testWindow.setOpacity.bind(testWindow);
          const ignoreMouse = testWindow.setIgnoreMouseEvents.bind(testWindow);
          const showInactive = testWindow.showInactive.bind(testWindow);
          testWindow.setOpacity = value => setOpacity(value === 1 ? 0 : value);
          testWindow.setIgnoreMouseEvents = () => ignoreMouse(true);
          testWindow.show = () => { assert.equal(testWindow.getOpacity(), 0); showInactive(); };
          testWindow.on('show', () => { handoffShown++; });
          testWindow.on('focus', () => { focusedCount++; });
          return testWindow;
        } });
        return handedBackground;
      } });
    try {
      const opened = await handoffRouter.handle('browser__open', { url });
      assert.equal(opened.ok, true, opened.result);
      const originalContents = handedBackground.surface.getContents();
      await originalContents.executeJavaScript("document.querySelector('[name=name]').value='交接前内容'");
      const requested = await handoffRouter.handle('browser__handoff', { reason: '模拟人工验证' });
      assert.equal(requested.ok, true, requested.result);
      handoffRouter.abort({ preserveHandoff: true });
      await handoffRouter.dispose();
      assert.equal(originalContents.isDestroyed(), false, '任务结束后应保留原页面');
      const item = handoffs.list()[0];
      assert.equal(handoffShown, 0, '用户操作前窗口不得显示');
      assert.equal((await handoffs.show(item.id)).ok, true);
      const handoffWindow = handedBackground.surface.tabs.get(handedBackground.surface.activeId).win;
      for (let attempt = 0; handoffShown === 0 && attempt < 30; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(handoffShown, 1, '主动打开后应触发真实窗口显示');
      assert.equal(handoffWindow.isVisible(), true);
      assert.equal(handoffWindow.getOpacity(), 0);
      assert.equal(handoffWindow.isFocused(), false);
      await originalContents.executeJavaScript("document.querySelector('#choose').click()", true);
      for (let attempt = 0; !handoffs.list()[0].filePending && attempt < 30; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(handoffs.list()[0].filePending, true, '网页请求文件时等待用户主动选择');
      assert.equal(chooserCalls, 0, '网页不能自动打开系统文件选择');
      const chosen = await handoffs.chooseFile(item.id);
      assert.equal(chosen.ok, true, chosen.result);
      assert.equal(chooserCalls, 1);
      assert.equal(await originalContents.executeJavaScript("document.querySelector('#file').files[0]?.name"), '简历.pdf');
      await originalContents.executeJavaScript("document.querySelector('#file').addEventListener('cancel', () => document.querySelector('#file').dataset.cancelled = 'yes')");
      await originalContents.executeJavaScript("document.querySelector('#choose').click()", true);
      for (let attempt = 0; !handoffs.list()[0].filePending && attempt < 30; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(handoffs.list()[0].filePending, true);
      assert.equal((await handoffs.chooseFile(item.id)).ok, true);
      assert.equal(await originalContents.executeJavaScript("document.querySelector('#file').files[0]?.name"), '简历.pdf', '取消应保留之前选择的文件');
      assert.equal(await originalContents.executeJavaScript("document.querySelector('#file').dataset.cancelled"), 'yes', '网页应收到文件选择取消事件');
      await originalContents.executeJavaScript("document.querySelector('[name=name]').value='人工处理后的内容'");
      const ready = await handoffs.ready(item.id);
      assert.equal(ready.ok, true, ready.result);
      const resumed = handoffs.claim('handoff-e2e', ready.runId, root);
      assert.equal(resumed.surface.getContents(), originalContents, '恢复时必须使用原页面');
      assert.equal(await originalContents.executeJavaScript("document.querySelector('[name=name]').value"), '人工处理后的内容');
      assert.equal(resumed.agent.controlManager.session.status, 'running');
      assert.equal(resumed.surface.tabs.get(resumed.surface.activeId).win.isVisible(), false);
      const resumedRouter = new TaskBrowserRouter({ visible: new BrowserAgent(), ownerSessionId: 'handoff-e2e', runId: ready.runId,
        claimedBackground: resumed, handoffs, allowHandoff: true });
      const resumedObservation = await resumedRouter.handle('browser__observe', {});
      assert.equal(resumedObservation.ok, true, resumedObservation.result);
      const nameRef = resumedObservation.data.elements.find(element => element.name === '姓名')?.ref;
      assert.notEqual(nameRef, undefined);
      const resumedEdit = await resumedRouter.handle('browser__act', { observationId: resumedObservation.data.observationId,
        actionId: 'resume-edit', action: { type: 'type', ref: nameRef, text: '继续后的内容', mode: 'replace' } });
      assert.equal(resumedEdit.ok, true, resumedEdit.result);
      assert.equal(await originalContents.executeJavaScript("document.querySelector('[name=name]').value"), '继续后的内容');
      await resumedRouter.dispose();
      checks.push('透明窗口真实显示、收起；用户选择和取消文件后原页面状态正确，并以新任务身份恢复');
    } finally { await handoffs.dispose(); }
  }
  agent.controlManager.takeover({ reason: '验收人工接管' });
  assert.equal((await agent.handle('browser__act', { observationId: observation.data.observationId, actionId: 'blocked', action: { type: 'reload' } })).errorCode, 'HUMAN_TAKEOVER');
  assert.equal((await agent.handle('browser__close', {})).errorCode, 'HUMAN_TAKEOVER');
  agent.controlManager.pause({ reason: '验收任务暂停' });
  assert.equal(agent.controlManager.session.status, 'human_control');
  assert.equal(window.isDestroyed(), false, '接管期间助手不得关闭页面');
  checks.push('人工接管后停止自动输入，暂停不能撤销接管且助手不能关闭页面');
  if (hidden) {
    assert.equal(window.isVisible(), false, '后台页面不得显示窗口');
    assert.equal(window.isFocused(), false, '后台页面不得获得系统焦点');
    if (productBackground) {
      assert.equal(shownCount, 0, '后台窗口在整个测试过程中不得显示');
      assert.equal(focusedCount, 0, '后台窗口在整个测试过程中不得获得焦点');
    }
    // 用户可能在验收期间自行切换应用或移动鼠标；记录事实而不是禁止用户操作。
    checks.push('隐藏页面操作期间测试窗口未显示或获得系统焦点');
  }
  await fs.writeFile(path.join(evidence, hidden ? 'hidden-result.json' : 'result.json'), JSON.stringify({ passed: true, checks, submissions, saved }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, submissions, evidence }, null, 2));
  await agent.dispose();
} catch (error) {
  console.error(error); exitCode = 1;
  if (window && !window.isDestroyed()) {
    const capture = await Promise.race([window.webContents.capturePage().catch(() => null), new Promise(resolve => setTimeout(() => resolve(null), 3000))]);
    if (capture) await fs.writeFile(path.join(evidence, 'failed.png'), capture.toPNG());
  }
} finally {
  await taskRouter?.dispose();
  if (window && !window.isDestroyed()) window.destroy();
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); app.exit(exitCode);
}
}
void main().catch(error => { console.error(error); app.exit(1); });
