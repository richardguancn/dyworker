import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Workspace } from '../electron/agent.mts';
import { createBackgroundTasksManager } from '../electron/background-tasks.mts';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(process.cwd(), '.dyw-windows-command-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const identity = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
  const sid = identity.stdout.match(/S-1-5-[0-9-]+/)?.[0];
  assert.equal(identity.status, 0); assert.ok(sid);
  // 只设置自建夹具。普通用户侧可写，才能确认外部拒绝来自受限令牌一侧。
  const grant = spawnSync('icacls.exe', [root, '/grant', `*${sid}:(OI)(CI)M`], { encoding: 'utf8' });
  assert.equal(grant.status, 0, grant.stderr + grant.stdout);
  const work = path.join(root, '工作 目录'); await fs.mkdir(work);
  const outside = path.join(root, 'outside.txt'); await fs.writeFile(outside, 'original');
  return { root, work, outside, workspace: new Workspace(work, { trustTempDirs: false }) };
}

test('Windows 前台命令真实执行：引号、空格、中文、复合命令、输出及退出码', { skip: process.platform !== 'win32' }, async t => {
  const { work, workspace } = await fixture(t);
  const result = await workspace.runCommand(`node -e "require('fs').writeFileSync('含 空格.txt','你好');process.stdout.write('A  B')" && node -e "process.stdout.write(' SECOND')"`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(await fs.readFile(path.join(work, '含 空格.txt'), 'utf8'), '你好');
  assert.match(result.output, /A  B SECOND/);
  assert.equal(result.protection.enforcement, 'partial');
  const failed = await workspace.runCommand(`node -e "process.exitCode=7"`);
  assert.equal(failed.ok, false); assert.match(failed.output, /退出码 7/);
  assert.equal(failed.protection.state, 'ready');
  const environment = await workspace.runCommand(`node -e "process.stdout.write('BOOTSTRAP_FLAG='+String(process.env.ELECTRON_RUN_AS_NODE||'unset'))"`);
  assert.equal(environment.ok, true, JSON.stringify(environment));
  assert.ok(environment.output.includes('BOOTSTRAP_FLAG=' + (process.env.ELECTRON_RUN_AS_NODE || 'unset')));
});

test('Windows 默认拒绝上级写入，明确单次权限真实生效且不延续，只读命令仍不能写入', { skip: process.platform !== 'win32' }, async t => {
  const { workspace, work, outside } = await fixture(t);
  const command = `node -e "require('fs').writeFileSync(require('path').join('..','out'+'side.txt'),'changed')"`;
  const denied = await workspace.runCommand(command);
  assert.equal(denied.ok, false, JSON.stringify(denied));
  assert.equal(denied.errorCode, 'SANDBOX_DENIED');
  assert.equal(await fs.readFile(outside, 'utf8'), 'original');
  const once = await workspace.runCommand(command, { mode: 'danger-full-access' });
  assert.equal(once.ok, true, JSON.stringify(once));
  assert.equal(await fs.readFile(outside, 'utf8'), 'changed');
  await fs.writeFile(outside, 'restored');
  assert.equal((await workspace.runCommand(command)).ok, false);
  assert.equal(await fs.readFile(outside, 'utf8'), 'restored');
  const readonly = await workspace.runCommand(`node -e "require('fs').writeFileSync('readonly.txt','must not write')"`, { mode: 'read-only' });
  assert.equal(readonly.ok, false, JSON.stringify(readonly));
  await assert.rejects(fs.access(path.join(work, 'readonly.txt')), { code: 'ENOENT' });
});

async function settled(manager, id) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const task = manager.listTasks().find(task => task.id === id);
    if (task.endTime) return task;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('后台命令未按时退出');
}

test('Windows 后台命令真实写入工作区并保留外部拒绝结果', { skip: process.platform !== 'win32' }, async t => {
  const { work, outside } = await fixture(t);
  const manager = createBackgroundTasksManager(); t.after(() => manager.cleanupAll());
  const first = await manager.startTask({ cwd: work, command: `node -e "require('fs').writeFileSync('background.txt','actual');process.stdout.write('BACKGROUND_DONE')"` });
  assert.equal(first.protection.enforcement, 'partial');
  const done = await settled(manager, first.id);
  assert.equal(done.status, 'stopped', JSON.stringify(done)); assert.equal(done.exitCode, 0);
  assert.equal(await fs.readFile(path.join(work, 'background.txt'), 'utf8'), 'actual');
  assert.ok(done.outputTail.join('\n').includes('BACKGROUND_DONE'));
  const second = await manager.startTask({ cwd: work, command: `node -e "require('fs').writeFileSync(require('path').join('..','outside.txt'),'must not write')"` });
  const denied = await settled(manager, second.id);
  assert.equal(denied.status, 'error', JSON.stringify(denied));
  assert.equal(denied.protection.state, 'denied');
  assert.equal(await fs.readFile(outside, 'utf8'), 'original');
});
