// 真实 webview 与应用内切换请求；测试窗口不可见且不抢占焦点。
import { app, BrowserWindow, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserRuntime } from '../dist/electron/desktop/browser-runtime.mjs';
import { browserControlIpcPlugin } from '../dist/electron/host/plugins/browser-control-ipc.mjs';
import { BrowserAgent } from '../dist/electron/browser.mjs';

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-switch-ui-'));
  app.setPath('userData', profile);
  app.on('window-all-closed', () => {});
  await app.whenReady();
  if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
  const deps = { mainWindow: null, ctx: {}, isTrustedRendererUrl: url => String(url).startsWith('http://127.0.0.1:5179/') };
  const runtime = createBrowserRuntime(deps);
  browserControlIpcPlugin({ trustedHandle: (name, handler) => ipcMain.handle(name, handler), browserControlManager: runtime.browserControlManager,
    getMainWindow: () => deps.mainWindow, backgroundBrowserHandoffs: {} }).apply({});
  const win = new BrowserWindow({ show: false, focusable: false, opacity: 0, webPreferences: { webviewTag: true, backgroundThrottling: false,
    preload: fileURLToPath(new URL('../tests/fixtures/browser-switch-preload.cjs', import.meta.url)) } });
  deps.mainWindow = win;
  win.setIgnoreMouseEvents(true);
  let failed = false, agent;
  try {
    await win.loadURL('http://127.0.0.1:5179/tests/fixtures/browser-switch.html');
    const run = code => win.webContents.executeJavaScript(code);
    for (let i = 0; i < 100 && !await run('Boolean(window.switchFixtureReady)'); i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await run('Boolean(window.switchFixtureReady)'), true, '测试页面应加载两个网页');
    await new Promise(resolve => setTimeout(resolve, 150));
    const manager = runtime.browserControlManager;
    const initial = runtime.activeEmbeddedBrowserContents({ forOwnerSessionId: 'one' });
    assert.ok(initial);
    await manager.acquireControl({ ownerSessionId: 'one', runId: 'run', tabId: 'one', webContents: initial });
    agent = new BrowserAgent({ controlManager: manager, openPanel: async () => ({ ok: true, contents: initial }),
      activateTab: (tabId, ownerSessionId, credential) => runtime.activateBrowserPanelTab(win.webContents, tabId, { ownerSessionId, token: credential.token }) });
    agent.setContext({ ownerSessionId: 'one', runId: 'run' });
    const switched = await agent.handle('browser__tabs', { action: 'activate', tabId: 'two' });
    assert.equal(switched.ok, true, switched.result);
    assert.equal((await run('window.switchState()')).active, 'two');
    assert.notEqual(manager.session.webContentsId, initial.id);
    await run('window.holdSwitch()');
    const pending = agent.handle('browser__tabs', { action: 'activate', tabId: 'one' });
    for (let i = 0; i < 30 && !(await run('window.switchState()')).held; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal((await run('window.switchState()')).held, true);
    manager.stop();
    await run('window.releaseSwitch()');
    assert.equal((await pending).ok, false);
    assert.equal((await run('window.switchState()')).active, 'two');
    assert.equal(manager.getStatus().status, 'stopped');
    assert.equal(win.isVisible(), false);
    assert.equal(win.isFocused(), false);
    console.log('真实网页标签切换与停止后的迟到请求检查通过。');
  } catch (error) { console.error(error); failed = true; }
  finally { agent?.dispose(); win.destroy(); await fs.rm(profile, { recursive: true, force: true }); app.exit(failed ? 1 : 0); }
}
main().catch(error => { console.error(error); app.exit(1); });
