import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { McpClient } from '../dist/electron/mcp.mjs';
import { fileURLToPath } from 'node:url';

async function main() {
  app.on('window-all-closed', () => {});
  await app.whenReady();
  const window = new BrowserWindow({ width: 800, height: 600, show: true });
  const client = new McpClient({ command: process.execPath,
    args: [fileURLToPath(new URL('../dist/electron/macos-computer-use-server.mjs', import.meta.url))],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, requestTimeoutMs: 60000 });
  let exitCode = 0;
  try {
    await window.loadURL('data:text/html,' + encodeURIComponent('<title>滚动验收</title><style>body{margin:0;width:4000px;height:4000px} h1{margin:30px}</style><h1>滚动验收</h1>'));
    await client.connect();
    const state = await client.callTool('get_app_state', { app: process.execPath });
    assert.equal(state.isError, false, state.text);
    const target = { app: process.execPath, window_id: /窗口编号：(\d+)/.exec(state.text)[1], window_title: /窗口：(.*)/.exec(state.text)[1] };
    const scale = Number(/缩放比例：([\d.]+)/.exec(state.text)[1]);
    const point = { x: 300 * scale, y: 300 * scale };
    await window.webContents.executeJavaScript("window.wheels=[];addEventListener('wheel', e=>wheels.push({x:e.deltaX,y:e.deltaY}));");
    const click = await client.callTool('click', { ...target, background: false, ...point }); assert.equal(click.isError, false, click.text);
    const position = () => window.webContents.executeJavaScript('({x:scrollX,y:scrollY})');
    const scroll = async (direction, pages = 1) => {
      const result = await client.callTool('scroll', { ...target, background: false, ...point, direction, pages });
      assert.equal(result.isError, false, result.text);
      await new Promise(resolve => setTimeout(resolve, 500));
      return position();
    };
    const down = await scroll('down'); assert.ok(down.y > 0, JSON.stringify({ down, wheels: await window.webContents.executeJavaScript('wheels') }));
    const right = await scroll('right'); assert.ok(right.x > 0, JSON.stringify(right));
    const up = await scroll('up', 3); assert.equal(up.y, 0, JSON.stringify(up));
    const left = await scroll('left', 3); assert.equal(left.x, 0, JSON.stringify(left));
    console.log(JSON.stringify({ passed: true, down, right, up, left }));
  } catch (error) { console.error(error); exitCode = 1; }
  finally { await client.close().catch(() => {}); window.destroy(); app.exit(exitCode); }
}
void main().catch(error => { console.error(error); app.exit(1); });
