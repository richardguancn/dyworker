// Vite 提供本地测试页；窗口保持不可见、不抢焦点。
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-control-ui-'));
  app.setPath('userData', profile);
  app.on('window-all-closed', () => {});
  await app.whenReady();
  if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
  const win = new BrowserWindow({ show: false, focusable: false, opacity: 0, width: 950, height: 500, webPreferences: { backgroundThrottling: false } });
  win.setIgnoreMouseEvents(true);
  let failed = false;
  try {
    await win.loadURL('http://127.0.0.1:5179/tests/fixtures/browser-control-overlay.html');
    const run = code => win.webContents.executeJavaScript(code);
    for (let i = 0; i < 100 && !await run("Boolean(document.querySelector('[role=status]'))"); i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await run("document.body.textContent.includes('正在准备接管')"), true);
    assert.equal(await run("document.activeElement?.classList.contains('browser-control-input-barrier')"), true);
    assert.equal(await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))"), false);
    await new Promise(resolve => setTimeout(resolve, 500));
    await fs.writeFile('/tmp/dyworker-control-pending.png', (await win.webContents.capturePage()).toPNG());
    await run("window.setTestRelease('failed')");
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await run("document.body.textContent.includes('请关闭此网页后重新打开')"), true);
    assert.equal(await run("Boolean(document.querySelector('.browser-control-input-barrier'))"), true);
    await run("window.setTestRelease('ready')");
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await run("Boolean(document.querySelector('.browser-control-input-barrier'))"), false);
    assert.equal(await run("document.body.textContent.includes('已由你接管')"), true);
    await run("window.setTestRelease('pending'); window.setTestStatus('stopped')");
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await run("document.body.textContent.includes('正在结束操作')"), true);
    assert.equal(await run("Boolean(document.querySelector('.browser-control-input-barrier'))"), true);
    await run("window.setTestRelease('failed')");
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await run("document.body.textContent.includes('请关闭此网页后重新打开')"), true);
    await run("window.setTestRelease('ready')");
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await run("Boolean(document.querySelector('.browser-control-overlay-container'))"), false);
    assert.equal(win.isVisible(), false);
    console.log('可见浏览器接管：等待、失败和可操作状态的界面检查通过。');
  } catch (error) { console.error(error); failed = true; }
  finally { win.destroy(); await fs.rm(profile, { recursive: true, force: true }); app.exit(failed ? 1 : 0); }
}
main().catch(error => { console.error(error); app.exit(1); });
