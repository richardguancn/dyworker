// 配合本地 Vite 测试页面执行，始终使用不可见窗口。
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function main() {
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-handoff-ui-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
await app.whenReady();
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
const win = new BrowserWindow({ show: false, focusable: false, opacity: 0, width: 900, height: 500 });
win.setIgnoreMouseEvents(true);
let failed = false;
try {
  await Promise.race([win.loadURL('http://127.0.0.1:5179/tests/fixtures/background-handoff.html'), new Promise((_, reject) => setTimeout(() => reject(new Error('测试页面加载超时')), 20000))]);
  const run = code => win.webContents.executeJavaScript(code);
  for (let attempt = 0; attempt < 100 && !await run("Boolean(document.querySelector('button'))"); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  await run("document.querySelector('button').click()");
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await run("document.body.textContent.includes('网页需要选择文件')"), true);
  const image = await win.webContents.capturePage();
  await fs.writeFile('/tmp/dyworker-handoff-ui-check.png', image.toPNG());
  await run("[...document.querySelectorAll('button')].find(b => b.textContent === '选择文件').click()");
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await run("[...document.querySelectorAll('button')].some(b => b.textContent === '选择文件')"), false);
  await run("[...document.querySelectorAll('button')].find(b => b.textContent === '继续交给助手').click()");
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await run('document.body.dataset.resumed'), 'test-session:resumed-run');
  assert.equal(win.isVisible(), false);
  console.log('人工接手界面：文件选择和继续流程通过，窗口未显示。');
} catch (error) { console.error(error); failed = true; }
finally { win.destroy(); await fs.rm(profile, { recursive: true, force: true }); app.exit(failed ? 1 : 0); }
}
main().catch(error => { console.error(error); app.exit(1); });
