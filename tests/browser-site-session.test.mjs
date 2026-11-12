import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cookieMatchesHost, importBrowserData, listImportableBrowsers, loadSiteSession, toCookieSetDetails } from '../electron/browser-import.mts';

test('Cookie 域匹配只包含目标站点自身及父域 Cookie', () => {
  assert.equal(cookieMatchesHost('.example.com', 'app.example.com'), true);
  assert.equal(cookieMatchesHost('example.com', 'example.com'), true);
  assert.equal(cookieMatchesHost('app.example.com', 'example.com'), false);
  assert.equal(cookieMatchesHost('.badexample.com', 'example.com'), false);
  assert.equal(cookieMatchesHost('.com.evil', 'example.com'), false);
  assert.equal(toCookieSetDetails({ host: '.example.com', name: 'a', value: '1', secure: true, sameSite: 2, expires: 0 }).expirationDate, undefined);
  assert.equal(toCookieSetDetails({ host: 'example.com', name: 'a', value: '1', secure: false, sameSite: 'lax', expires: 100 }).url, 'http://example.com/');
});

test('Firefox 画像只读解析目标站点 Cookie、浏览记录与同源本地存储', async (t) => {
  if (process.platform === 'win32') return t.skip('Windows 使用 APPDATA 路径');
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-ff-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = home;
  t.after(async () => { process.env.HOME = originalHome; await fs.rm(home, { recursive: true, force: true }); });
  const root = process.platform === 'darwin' ? path.join(home, 'Library/Application Support/Firefox/Profiles') : path.join(home, '.mozilla/firefox');
  const profileDir = path.join(root, 'abcd1234.default-release');
  await fs.mkdir(path.join(profileDir, 'storage/default/https+++app.example.com/ls'), { recursive: true });
  const cookies = new DatabaseSync(path.join(profileDir, 'cookies.sqlite'));
  cookies.exec('CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, originAttributes TEXT NOT NULL DEFAULT \'\', name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, lastAccessed INTEGER, creationTime INTEGER, isSecure INTEGER, isHttpOnly INTEGER, inBrowserElement INTEGER DEFAULT 0, sameSite INTEGER DEFAULT 0, rawSameSite INTEGER DEFAULT 0, schemeMap INTEGER DEFAULT 0)');
  const future = Math.floor(Date.now() / 1000) + 3600;
  const insert = cookies.prepare('INSERT INTO moz_cookies (originAttributes, name, value, host, path, expiry, isSecure, isHttpOnly, sameSite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insert.run('', 'sid', 'secret', '.example.com', '/', future, 1, 1, 1);
  insert.run('', 'ms', 'v', 'app.example.com', '/', future * 1000, 1, 0, 0);
  insert.run('', 'old', 'v', '.example.com', '/', 100, 1, 0, 0);
  insert.run('^userContextId=2', 'container', 'v', '.example.com', '/', future, 1, 0, 0);
  insert.run('', 'other', 'v', '.other.com', '/', future, 1, 0, 0);
  cookies.close();
  const places = new DatabaseSync(path.join(profileDir, 'places.sqlite'));
  places.exec('CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_date INTEGER)');
  places.prepare('INSERT INTO moz_places (url, title, visit_count, last_visit_date) VALUES (?, ?, ?, ?)').run('https://app.example.com/', '示例', 3, Date.now() * 1000);
  places.close();
  const ls = new DatabaseSync(path.join(profileDir, 'storage/default/https+++app.example.com/ls/data.sqlite'));
  ls.exec('CREATE TABLE data (key TEXT PRIMARY KEY, utf16_length INTEGER, conversion_type INTEGER, compression_type INTEGER, last_access_time INTEGER, value BLOB)');
  ls.prepare('INSERT INTO data VALUES (?, ?, ?, ?, ?, ?)').run('token', 5, 1, 0, 0, Buffer.from('令牌abc', 'utf8'));
  ls.close();

  const browsers = await listImportableBrowsers();
  const firefox = browsers.find(item => item.id === 'firefox');
  assert.ok(firefox);
  assert.deepEqual(firefox.profiles, [{ id: 'abcd1234.default-release', name: 'default-release' }]);

  const all = await importBrowserData(firefox, 'abcd1234.default-release', { passwords: false });
  assert.equal(all.ok, true);
  assert.deepEqual(all.cookies.map(item => item.name).sort(), ['ms', 'other', 'sid']);
  assert.equal(all.history[0].url, 'https://app.example.com/');

  const site = await loadSiteSession({ url: 'https://app.example.com/inbox', source: 'firefox' });
  assert.equal(site.ok, true);
  assert.match(site.sourceLabel, /Firefox/);
  assert.deepEqual(site.cookies.map(item => item.name).sort(), ['ms', 'sid']);
  assert.ok(site.cookies.every(item => item.expires < 1e11));
  assert.deepEqual(site.localStorage, { 'https://app.example.com': { token: '令牌abc' } });

  const auto = await loadSiteSession({ url: 'https://app.example.com/', source: 'auto', builtinSession: { cookies: { get: async () => [] } } });
  assert.equal(auto.ok, true);
  assert.match(auto.sourceLabel, /Firefox/);
  const missing = await loadSiteSession({ url: 'https://nothing.test/', source: 'auto', builtinSession: { cookies: { get: async () => [] } } });
  assert.equal(missing.ok, false);
  assert.match((await loadSiteSession({ url: 'https://example.com', source: 'netscape' })).error, /netscape/);
});

test('内置浏览器来源只返回目标站点 Cookie', async () => {
  const builtinSession = { cookies: { get: async () => [
    { domain: '.example.com', hostOnly: false, name: 'a', value: '1', path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: true },
    { domain: 'other.com', hostOnly: true, name: 'b', value: '2', path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: false, expirationDate: 99999999999 },
  ] } };
  const result = await loadSiteSession({ url: 'https://www.example.com', source: 'builtin', builtinSession });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cookies.map(item => item.name), ['a']);
  assert.equal(result.sourceLabel, '内置浏览器');
});
