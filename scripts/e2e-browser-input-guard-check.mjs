// 使用独立配置和不可见窗口，检查真实窗口中的按键事件。
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { browserInputGuard } from '../electron/desktop/browser-input-guard.mts';

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-input-ui-'));
  app.setPath('userData', profile);
  app.on('window-all-closed', () => {});
  await app.whenReady();
  if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
  const win = new BrowserWindow({ show: false, focusable: false, opacity: 0, webPreferences: { backgroundThrottling: false } });
  win.setIgnoreMouseEvents(true);
  let failed = false;
  try {
    let state = { status: 'stopped', inputReleaseState: 'pending' };
    const observed = [];
    win.webContents.on('before-input-event', (event, input) => {
      const guard = browserInputGuard(state, win.webContents.id, win.webContents.id, input);
      observed.push({ type: input.type, prevent: guard.prevent });
      if (guard.prevent) event.preventDefault();
    });
    await win.loadURL('data:text/html,<input id="target">');
    await win.webContents.executeJavaScript("document.querySelector('#target').focus()");
    const press = (key, character) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key });
      if (character) win.webContents.sendInputEvent({ type: 'char', keyCode: character });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key });
    };
    press('A', 'a');
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(observed.some(entry => entry.type === 'keyDown' && entry.prevent));
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#target').value"), '');
    state = { status: 'human_control', inputReleaseState: 'ready' };
    press('B', 'b');
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#target').value"), 'b');
    state = { status: 'running', inputReleaseState: 'ready' };
    observed.length = 0;
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, text: 'c' });
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67 });
    win.webContents.debugger.detach();
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#target').value"), 'bc');
    assert.equal(observed.some(entry => entry.prevent), false);
    assert.equal(win.isVisible(), false);
    console.log('不可见窗口的按键保护与恢复输入检查通过。');
  } catch (error) { console.error(error); failed = true; }
  finally { win.destroy(); await fs.rm(profile, { recursive: true, force: true }); app.exit(failed ? 1 : 0); }
}
main().catch(error => { console.error(error); app.exit(1); });
