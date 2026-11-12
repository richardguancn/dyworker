// 使用虚构登录数据和本机网页，不读取用户浏览器。
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { BackgroundBrowserSurface } from '../dist/electron/desktop/background-browser.mjs';

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-seed-e2e-'));
  app.setPath('userData', profile);
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.example.test 127.0.0.1, MAP example.test 127.0.0.1');
  app.on('window-all-closed', () => {});
  const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<title>Local fixture</title>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await app.whenReady();
  if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
  let finish, requests = 0, valid = true, surface, hostScopeSurface, failed = false;
  try {
    surface = new BackgroundBrowserSurface({ ownerSessionId: 'test', runId: 'run', createWindow: options => new BrowserWindow(options),
      loadSiteSession: async () => {
        requests++;
        if (requests === 1) await new Promise(resolve => { finish = resolve; });
        return { ok: true, cookies: [], localStorage: { [origin]: { fixtureToken: 'temporary-example' } } };
      } });
    const initial = await surface.open(`${origin}/initial`);
    assert.equal(initial.ok, true);
    const pending = surface.open(`${origin}/target`, initial.tabId, { sessionSource: 'fixture', validate: () => valid });
    for (let i = 0; i < 50 && !finish; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(finish);
    valid = false;
    finish();
    assert.equal((await pending).ok, false);
    const record = surface.tabs.get(initial.tabId);
    assert.equal(record.contents.getURL(), `${origin}/initial`);
    await record.contents.loadURL(`${origin}/other`);
    assert.equal(await record.contents.executeJavaScript("localStorage.getItem('fixtureToken')"), null);
    valid = true;
    const retry = await surface.open(`${origin}/target`, initial.tabId, { sessionSource: 'fixture', validate: () => valid });
    assert.equal(retry.ok, true, retry.result);
    assert.equal(requests, 2);
    assert.equal(await record.contents.executeJavaScript("localStorage.getItem('fixtureToken')"), 'temporary-example');
    const otherAccount = await surface.open(`${origin}/target`, '', { sessionSource: 'different-fixture' });
    assert.equal(otherAccount.ok, false);
    assert.match(otherAccount.result, /混用账号/);
    assert.equal(await record.contents.executeJavaScript("localStorage.getItem('fixtureToken')"), 'temporary-example');
    assert.equal(surface.listTabs().length, 1);
    assert.equal(record.win.isVisible(), false);
    assert.equal(record.win.isFocused(), false);
    hostScopeSurface = new BackgroundBrowserSurface({ ownerSessionId: 'scope-test', runId: 'run', createWindow: options => new BrowserWindow(options),
      loadSiteSession: async () => ({ ok: true, localStorage: {}, cookies: [
        { host: 'example.test', hostOnly: true, name: 'parent-only', value: 'a', path: '/', secure: false },
        { host: '.example.test', hostOnly: false, name: 'shared', value: 'b', path: '/', secure: false },
        { host: 'app.example.test', hostOnly: true, name: 'exact', value: 'c', path: '/', secure: false }
      ] }) });
    const scoped = await hostScopeSurface.open(`http://app.example.test:${server.address().port}/`, '', { sessionSource: 'fixture' });
    assert.equal(scoped.ok, true, scoped.result);
    const cookieNames = (await scoped.contents.session.cookies.get({})).map(cookie => cookie.name).sort();
    assert.deepEqual(cookieNames, ['exact', 'shared']);
    assert.equal(hostScopeSurface.tabs.get(scoped.tabId).win.isFocused(), false);
    console.log('取消后本地存储未被注入，重试正常，其他账号不会混入。');
    console.log('实际后台页面只载入适用子网站的登录信息。');
  } catch (error) { console.error(error); failed = true; }
  finally {
    await surface?.dispose();
    await hostScopeSurface?.dispose();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
}
main().catch(error => { console.error(error); app.exit(1); });
