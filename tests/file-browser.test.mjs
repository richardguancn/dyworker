import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileAppIcon, fileBrowserPaths, openFileTerminal, saveFileAs } from '../electron/file-browser.mts';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-file-browser-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '中文 项目'));
  await fs.writeFile(path.join(root, '中文 项目', 'a.txt'), '磁盘内容');
  return fs.realpath(root);
}
test('项目路径与仓库路径分开计算，非仓库不伪造仓库根目录', async t => {
  const root = await fixture(t); const project = path.join(root, '中文 项目');
  assert.equal((await fileBrowserPaths(project, 'a.txt')).repositoryRelative, undefined);
  execFileSync('git', ['init', '-q', root]);
  const result = await fileBrowserPaths(project, 'a.txt');
  assert.equal(result.ok, true);
  assert.equal(result.absolute, path.join(project, 'a.txt'));
  assert.equal(result.projectRelative, 'a.txt');
  assert.equal(result.repositoryRelative, path.join('中文 项目', 'a.txt'));
  assert.equal((await fileBrowserPaths(project, '../outside.txt')).ok, false);
});
test('另存为支持当前编辑内容、原始字节及取消，原文件不变', async t => {
  const root = await fixture(t); const target = path.join(root, '副本.txt');
  const dialog = { showSaveDialog: async () => ({ canceled: false, filePath: target }) };
  assert.equal((await saveFileAs(root, '中文 项目/a.txt', { dialog, content: '最新编辑' })).ok, true);
  assert.equal(await fs.readFile(target, 'utf8'), '最新编辑');
  assert.equal(await fs.readFile(path.join(root, '中文 项目/a.txt'), 'utf8'), '磁盘内容');
  await fs.writeFile(path.join(root, '图像.bin'), Buffer.from([0, 255, 12]));
  await saveFileAs(root, '图像.bin', { dialog });
  assert.deepEqual(await fs.readFile(target), Buffer.from([0, 255, 12]));
  assert.equal((await saveFileAs(root, '图像.bin', { dialog: { showSaveDialog: async () => ({ canceled: true }) } })).canceled, true);
  assert.equal((await saveFileAs(root, 'missing.txt', { dialog })).ok, false);
});
test('终端在文件所在目录打开，特殊路径独立传参，失败会反馈', async t => {
  const root = await fixture(t); const calls = [];
  const execute = async (...args) => { calls.push(args); };
  for (const platform of ['darwin', 'win32', 'linux']) assert.equal((await openFileTerminal(root, '中文 项目/a.txt', platform, execute)).ok, true);
  assert.deepEqual(calls[0].slice(0, 2), ['open', ['-a', 'Terminal', path.join(root, '中文 项目')]]);
  assert.equal(calls[1][2].cwd, path.join(root, '中文 项目'));
  assert.equal(calls[2][2].cwd, path.join(root, '中文 项目'));
  assert.equal((await openFileTerminal(root, '中文 项目/a.txt', 'linux', async () => { throw new Error('not found'); })).ok, false);
});
test('大文件可复制路径和另存为，软链接越界仍被拒绝', async t => {
  const root = await fixture(t); const outside = await fixture(t);
  await fs.writeFile(path.join(root, 'large.bin'), ''); await fs.truncate(path.join(root, 'large.bin'), 33 * 1024 * 1024);
  assert.equal((await fileBrowserPaths(root, 'large.bin')).ok, true);
  await fs.symlink(path.join(outside, '中文 项目/a.txt'), path.join(root, 'escape.txt'));
  assert.equal((await fileBrowserPaths(root, 'escape.txt')).ok, false);
  assert.equal((await openFileTerminal(root, 'escape.txt', 'darwin', async () => assert.fail('不可执行'))).ok, false);
});
test('默认应用图标按文件类型缓存，取不到图标或越界都返回可读原因', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, '中文 项目', 'b.txt'), '二号文件');
  await fs.writeFile(path.join(root, '中文 项目', 'c.md'), '# 三号文件');
  const asked = [];
  const app = { getFileIcon: async (file) => { asked.push(file); return { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AAAA' }; } };
  assert.equal((await fileAppIcon(app, root, '中文 项目/a.txt')).data, 'data:image/png;base64,AAAA');
  assert.equal((await fileAppIcon(app, root, '中文 项目/b.txt')).ok, true);
  assert.equal(asked.length, 1, '同扩展名只向系统取一次图标');
  assert.equal((await fileAppIcon({ getFileIcon: async () => ({ isEmpty: () => true, toDataURL: () => '' }) }, root, '中文 项目/c.md')).ok, false);
  assert.equal((await fileAppIcon(app, root, '../outside.txt')).ok, false);
});
