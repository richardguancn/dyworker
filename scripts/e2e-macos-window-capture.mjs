// 在屏幕外创建本进程的测试窗口，不移动鼠标或切换前台应用。
// 构建后以 Electron 运行；仅用于 macOS 的真实窗口截图验收。
import { app, BrowserWindow, nativeImage, screen } from 'electron';
import assert from 'node:assert/strict';
import { McpClient } from '../dist/electron/mcp.mjs';
import { fileURLToPath } from 'node:url';

async function main() {
  assert.equal(process.platform, 'darwin');
  app.on('window-all-closed', () => {});
  app.commandLine.appendSwitch('force-renderer-accessibility');
  await app.whenReady();
  app.setActivationPolicy(process.env.DYWORKER_CU_TRANSPARENT_AX === '1' ? 'accessory' : 'prohibited');
  app.setAccessibilitySupportEnabled(true);
  const displays = screen.getAllDisplays().map(item => item.bounds);
  const x = Math.min(...displays.map(item => item.x)) - 1400;
  const y = Math.min(...displays.map(item => item.y)) - 1000;
  const transparentAX = process.env.DYWORKER_CU_TRANSPARENT_AX === '1';
  const rangeOnly = process.env.DYWORKER_CU_RANGE_ONLY === '1';
  const win = new BrowserWindow({ x, y, width: 800, height: 600, show: false, opacity: transparentAX ? 0 : 1, skipTaskbar: true, title: 'DYWorker 截图验收', webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true } });
  let focusedCount = 0;
  win.on('focus', () => { focusedCount++; });
  const client = new McpClient({ command: process.execPath, args: [fileURLToPath(new URL('../dist/electron/macos-computer-use-server.mjs', import.meta.url))], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, requestTimeoutMs: 60000 });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,<title>DYWorker 截图验收</title><body style="background:rgb(200,30,40);margin:0"><h1>目标窗口</h1><button aria-label="后台按钮" onclick="this.dataset.clicked='yes'">执行</button><input aria-label="后台输入框" value="${rangeOnly ? '前😀中间😀后' : ''}"></body>`);
    // macOS 会把显示到屏幕外的窗口重新摆回显示器；保持隐藏，不干扰用户。
    if (transparentAX) {
      win.setIgnoreMouseEvents(true);
      win.showInactive();
      assert.equal(win.getOpacity(), 0, '测试窗口必须始终透明');
    }
    assert.equal(win.isFocused(), false);
    await client.connect();
    let state = await client.callTool('get_app_state', { app: `pid:${process.pid}` });
    for (let attempt = 0; transparentAX && ((state.isError && /没有可访问的窗口|尚未运行/.test(state.text)) || (!state.isError && !state.text.includes('后台输入框'))) && attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      state = await client.callTool('get_app_state', { app: `pid:${process.pid}` });
    }
    if (transparentAX && process.env.DYWORKER_CU_MULTI_WINDOW === '1') {
      const second = new BrowserWindow({ show: false, opacity: 0, skipTaskbar: true, width: 500, height: 400, title: '另一份测试文档' });
      try {
        await second.loadURL('data:text/html,<title>另一份测试文档</title><p>另一份虚构文档</p>');
        second.setIgnoreMouseEvents(true);
        second.showInactive();
        let ambiguous;
        for (let attempt = 0; attempt < 8; attempt++) {
          ambiguous = await client.callTool('get_app_state', { app: `pid:${process.pid}` });
          if (ambiguous.isError && /多个窗口/.test(ambiguous.text)) break;
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        assert.equal(ambiguous.isError, true, ambiguous.text);
        assert.match(ambiguous.text, /多个窗口/);
        assert.equal(second.isFocused(), false);
        assert.equal(second.getOpacity(), 0);
      } finally { second.destroy(); }
      state = await client.callTool('get_app_state', { app: `pid:${process.pid}` });
      for (let attempt = 0; state.isError && /多个窗口/.test(state.text) && attempt < 8; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 300));
        state = await client.callTool('get_app_state', { app: `pid:${process.pid}` });
      }
    }
    assert.equal(win.isFocused(), false);
    if (transparentAX) {
      if (state.isError) throw new Error(state.text);
      const identity = text => ({ app: `pid:${process.pid}`, window_id: /窗口编号：(\d+)/.exec(text)?.[1], window_title: /窗口：([^\n]+)/.exec(text)?.[1], observation_id: /观察编号：([^\s]+)/.exec(text)?.[1] });
      const element = (text, name) => {
        const line = text.split('\n').find(row => row.includes(name));
        assert.ok(line, `应找到 ${name}；状态：${text}`);
        return /\[(e\d+)\]/.exec(line)?.[1];
      };
      const target = identity(state.text);
      assert.ok(target.window_id && target.window_title && target.observation_id);
      console.log(state.text.split('\n').filter(row => row.includes('后台按钮') || row.includes('后台输入框')).join('\n'));
      if (!rangeOnly) {
        const click = await client.callTool('click', { ...target, element_index: element(state.text, '后台按钮') });
        assert.equal(click.isError, false, click.text);
        assert.equal(await win.webContents.executeJavaScript("document.querySelector('button').dataset.clicked"), 'yes');
        assert.equal(win.isFocused(), false);
      }
      const updated = rangeOnly ? state : await client.callTool('get_app_state', target);
      assert.equal(updated.isError, false, updated.text);
      if (!rangeOnly) {
        const set = await client.callTool('set_value', { ...identity(updated.text), element_index: element(updated.text, '后台输入框'), value: '前😀中间😀后' });
        assert.equal(set.isError, false, set.text);
      }
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('input').value"), '前😀中间😀后');
      const editable = rangeOnly ? updated : await client.callTool('get_app_state', target);
      assert.equal(editable.isError, false, editable.text);
      const textTarget = { ...identity(editable.text), element_index: element(editable.text, '后台输入框') };
      const selection = await client.callTool('select_text', { ...textTarget, text: '中间' });
      assert.equal(selection.isError, false, selection.text);
      assert.deepEqual(await win.webContents.executeJavaScript("(() => { const e=document.querySelector('input'); return [e.selectionStart,e.selectionEnd] })()"), [3, 5]);
      assert.equal(win.isFocused(), false);
      const afterSelection = await client.callTool('get_app_state', target);
      assert.equal(afterSelection.isError, false, afterSelection.text);
      const selectedTarget = { ...identity(afterSelection.text), element_index: element(afterSelection.text, '后台输入框') };
      const duplicate = await client.callTool('select_text', { ...selectedTarget, text: '😀' });
      assert.equal(duplicate.isError, true);
      assert.deepEqual(await win.webContents.executeJavaScript("(() => { const e=document.querySelector('input'); return [e.selectionStart,e.selectionEnd] })()"), [3, 5]);
      const cursor = await client.callTool('select_text', { ...selectedTarget, text: '😀', prefix: '前', selection: 'cursor_after' });
      assert.equal(cursor.isError, false, cursor.text);
      assert.deepEqual(await win.webContents.executeJavaScript("(() => { const e=document.querySelector('input'); return [e.selectionStart,e.selectionEnd] })()"), [3, 3]);
      assert.equal(win.isFocused(), false);
      const insertionState = await client.callTool('get_app_state', target);
      assert.equal(insertionState.isError, false, insertionState.text);
      const insertionTarget = { ...identity(insertionState.text), element_index: element(insertionState.text, '后台输入框') };
      const inserted = await client.callTool('insert_text', { ...insertionTarget, text: '新增' });
      assert.equal(inserted.isError, false, inserted.text);
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('input').value"), '前😀新增中间😀后');
      assert.equal(win.isFocused(), false);
      await win.webContents.executeJavaScript("(() => { const e=document.querySelector('input'); e.value='前😀中间😀后'; e.setSelectionRange(3,3); })()");
      await win.webContents.executeJavaScript("(() => { const e=document.createElement('input'); e.setAttribute('aria-label','后台输入框'); e.value='前😀中间😀后'; e.id='duplicate'; document.body.append(e); })()");
      const duplicateState = await client.callTool('get_app_state', target);
      assert.equal(duplicateState.isError, false, duplicateState.text);
      const duplicateTarget = { ...identity(duplicateState.text), element_index: element(duplicateState.text, '后台输入框') };
      const ambiguousControl = await client.callTool('select_text', { ...duplicateTarget, text: '中间' });
      assert.equal(ambiguousControl.isError, true);
      assert.match(ambiguousControl.text, /唯一确认目标控件/);
      assert.deepEqual(await win.webContents.executeJavaScript("(() => { const e=document.querySelector('input'); return [e.selectionStart,e.selectionEnd] })()"), [3, 3]);
      await win.webContents.executeJavaScript("document.querySelector('#duplicate').remove()");
      const restoredState = await client.callTool('get_app_state', target);
      assert.equal(restoredState.isError, false, restoredState.text);
      const restoredTarget = { ...identity(restoredState.text), element_index: element(restoredState.text, '后台输入框') };
      const ambiguous = await client.callTool('replace_text', { ...restoredTarget, old_text: '😀', new_text: '错' });
      assert.equal(ambiguous.isError, true);
      assert.match(ambiguous.text, /多处匹配/);
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('input').value"), '前😀中间😀后');
      const replaced = await client.callTool('replace_text', { ...restoredTarget, old_text: '中间', new_text: '更改' });
      assert.equal(replaced.isError, false, replaced.text);
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('input').value"), '前😀更改😀后');
      const blocked = await client.callTool('press_key', { ...target, key: 'Return' });
      assert.equal(blocked.isError, true);
      assert.match(blocked.text, /不支持后台/);
      const raised = await client.callTool('perform_secondary_action', { ...identity(updated.text), element_index: element(updated.text, '后台按钮'), action: 'AXRaise' });
      assert.equal(raised.isError, true);
      assert.match(raised.text, /不能在后台/);
      const menu = await client.callTool('perform_secondary_action', { ...identity(updated.text), element_index: element(updated.text, '后台按钮'), action: 'AXShowMenu' });
      assert.equal(menu.isError, true);
      assert.match(menu.text, /不能在后台/);
      assert.equal(win.isFocused(), false);
      assert.equal(win.getOpacity(), 0);
      assert.equal(focusedCount, 0, '测试窗口在整个操作过程中不得获得焦点');
      console.log(JSON.stringify({ passed: true, checks: [rangeOnly ? '测试文字准备' : '后台点击及设置文本', '后台选择中文与表情并定位光标', '后台光标处插入文字', '后台替换中文与表情混排文字', '拒绝多处匹配', '不支持的按键和菜单动作不会切换前台', ...(process.env.DYWORKER_CU_MULTI_WINDOW === '1' ? ['多窗口时要求明确选择'] : [])], focused: win.isFocused(), opacity: win.getOpacity() }));
      return;
    }
    if (state.isError) {
      assert.match(state.text, /没有可访问的窗口/);
      console.log(JSON.stringify({ skipped: true, hiddenWindowCaptured: false, note: '隐藏窗口不可访问，无法验证正常截图' }));
      return;
    }
    if (!state.images.length) {
      console.log(JSON.stringify({ skipped: true, hiddenWindowCaptured: false, note: '隐藏窗口不可截图，无法验证正常截图' }));
      return;
    }
    assert.equal(state.images.length, 1, '必须取得目标窗口截图');
    const image = nativeImage.createFromBuffer(Buffer.from(state.images[0].data, 'base64'));
    assert.equal(image.isEmpty(), false);
    const size = image.getSize(), pixels = image.toBitmap();
    const at = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4;
    assert.ok(pixels[at + 2] > 150 && pixels[at + 1] < 80 && pixels[at] < 80, '截图中心必须是测试窗口的红色背景');
    console.log(JSON.stringify({ passed: true, width: size.width, height: size.height, focused: win.isFocused() }));
  } finally {
    await client.close().catch(() => {});
    win.destroy();
  }
}

main().then(() => app.exit(0), error => { console.error(error.message); app.exit(1); });
