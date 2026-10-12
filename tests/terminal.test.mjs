import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as pty from 'node-pty';
import { createTerminalManager } from '../builtin-plugins/dyworker-terminal/terminal-manager.js';
import { apply } from '../builtin-plugins/dyworker-terminal/index.js';

function sender(id = 1) {
  return Object.assign(new EventEmitter(), { id, events: [], isDestroyed: () => false,
    send(_channel, event) { this.events.push(event); } });
}
async function until(check, message) {
  const end = Date.now() + 8000;
  while (Date.now() < end) { if (check()) return; await delay(30); }
  assert.fail(message);
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
// 回放里混有 shell 集成发出的 OSC（BEL 结尾）与 CSI 控制序列，界面渲染时并不显示，匹配前先剔除。
const control = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)|\u001b\[[\d;?]*[\dA-PR-TZcf-nq-uy=><~]|\r/g;
const output = (manager, owner, id) => manager.read(owner, { id }).chunks.map(chunk => chunk.data).join('').replace(control, '');

test('真实终端：工作目录、TTY、输入、尺寸、中断、独立标签和退出', { skip: process.platform === 'win32' }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker terminal 中文 '));
  const manager = createTerminalManager();
  t.after(async () => { manager.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  const owner = sender();
  const first = await manager.create(owner, { workspacePath: directory, cols: 91, rows: 27 });
  const second = await manager.create(owner, { workspacePath: directory });
  manager.write(owner, { id: first.id, data: 'pwd\r' });
  await until(() => output(manager, owner, first.id).includes(`\n${directory}\n`), 'pwd 应输出所选工作目录');
  manager.write(owner, { id: first.id, data: "test -t 0 && printf '\\nTTY_OK\\n'; stty size\r" });
  await until(() => /\nTTY_OK\n/.test(output(manager, owner, first.id)) && /\n27 91\n/.test(output(manager, owner, first.id)), '命令必须在真实 TTY 中运行并继承尺寸');
  manager.resize(owner, { id: first.id, cols: 105, rows: 31 });
  manager.write(owner, { id: first.id, data: 'stty size\r' });
  await until(() => /\n31 105\n/.test(output(manager, owner, first.id)), '调整尺寸必须传入真实终端');
  manager.write(owner, { id: first.id, data: 'sleep 60\r' });
  await delay(150);
  manager.write(owner, { id: first.id, data: '\x03' });
  manager.write(owner, { id: first.id, data: "printf '\\nINTERRUPT_OK\\n'\r" });
  await until(() => /\nINTERRUPT_OK\n/.test(output(manager, owner, first.id)), 'Ctrl+C 应中断运行命令后继续输入');
  assert.equal(output(manager, owner, second.id).includes('INTERRUPT_OK'), false);
  manager.write(owner, { id: first.id, data: 'exit 7\r' });
  await until(() => manager.read(owner, { id: first.id }).exited, '退出必须通知界面');
  assert.equal(manager.read(owner, { id: first.id }).exitCode, 7);
  assert.throws(() => manager.write(owner, { id: first.id, data: 'pwd\r' }), /已退出/);
  manager.write(owner, { id: second.id, data: "sleep 60 & printf '\\nBACKGROUND_PID=%s\\n' $!\r" });
  await until(() => /\nBACKGROUND_PID=\d+\n/.test(output(manager, owner, second.id)), '读取后台子进程标识');
  const childPid = Number(output(manager, owner, second.id).match(/\nBACKGROUND_PID=(\d+)\n/)[1]);
  manager.close(owner, { id: second.id });
  await until(() => !alive(second.pid), '关闭标签必须结束真实 shell');
  await until(() => !alive(childPid), '关闭标签必须结束所属后台子进程');
  assert.throws(() => manager.read(owner, { id: second.id }), /已关闭/);
});

test('目录异常、跨窗口访问、刷新、停用与创建中停用都正确收尾', async t => {
  const manager = createTerminalManager();
  t.after(() => manager.dispose());
  const owner = sender();
  await assert.rejects(manager.create(owner, { workspacePath: '/this-directory-does-not-exist-dyworker-terminal' }));
  const first = await manager.create(owner, {});
  assert.equal(first.cwd, process.cwd());
  for (const action of ['read', 'write', 'resize', 'close']) assert.throws(() => manager[action](sender(2), { id: first.id, data: 'pwd\r' }), /已关闭/);
  owner.emit('did-start-navigation', {}, 'file:///app', false, true);
  await until(() => !alive(first.pid), '刷新窗口应结束旧终端');
  const second = await manager.create(owner, {});
  manager.dispose();
  await until(() => !alive(second.pid), '停用插件应结束真实终端');
  assert.equal(owner.listenerCount('destroyed'), 0);
  await assert.rejects(manager.create(owner, {}), /已停用/);
  const race = createTerminalManager();
  const creating = race.create(owner, {});
  race.dispose();
  await assert.rejects(creating, /已停用/);
});

for (const shell of ['/bin/sh', '/bin/bash', '/bin/zsh']) {
  test(`关闭 ${shell} 终端时结束独立后台任务，其他标签继续运行`, { skip: process.platform === 'win32' }, async t => {
    try { await fs.access(shell); } catch { t.skip('系统未安装此 shell'); return; }
    const manager = createTerminalManager({ spawn: (_shell, args, options) => pty.spawn(shell, args, options) });
    t.after(() => manager.dispose());
    const owner = sender();
    const first = await manager.create(owner, {});
    const second = await manager.create(owner, {});
    manager.write(owner, { id: first.id, data: "/bin/sh -c 'sleep 60 & printf \"\\nGRANDCHILD_PID=%s\\n\" \"$!\"; wait' & printf '\\nCHILD_PID=%s\\n' $!\r" });
    await until(() => {
      const text = output(manager, owner, first.id);
      return /\nCHILD_PID=\d+\n/.test(text) && /\nGRANDCHILD_PID=\d+\n/.test(text);
    }, '后台任务及其下级任务应已启动');
    const childPid = Number(output(manager, owner, first.id).match(/\nCHILD_PID=(\d+)\n/)[1]);
    const grandchildPid = Number(output(manager, owner, first.id).match(/\nGRANDCHILD_PID=(\d+)\n/)[1]);
    t.after(() => {
      for (const pid of [grandchildPid, childPid]) { try { if (alive(pid)) process.kill(pid, 'SIGKILL'); } catch {} }
    });
    assert.equal(alive(childPid), true);
    assert.equal(alive(grandchildPid), true);
    manager.close(owner, { id: first.id });
    await until(() => !alive(first.pid) && !alive(childPid) && !alive(grandchildPid), '关闭标签应结束 shell、后台任务及其下级任务');
    assert.equal(alive(second.pid), true);
    manager.write(owner, { id: second.id, data: "printf '\\nOTHER_TAB_OK\\n'\r" });
    await until(() => /\nOTHER_TAB_OK\n/.test(output(manager, owner, second.id)), '关闭一个标签不影响另一个标签输入');
  });
}

test('无法查看进程信息时仍关闭终端，不让清理异常打断插件停用', { skip: process.platform === 'win32' }, async t => {
  for (const synchronous of [true, false]) {
    const manager = createTerminalManager({ execFile: (_file, _args, _options, callback) => {
      const error = Object.assign(new Error('查看进程被拒绝'), { code: 'EPERM' });
      if (synchronous) throw error;
      setImmediate(() => callback(error, ''));
    } });
    t.after(() => manager.dispose());
    const owner = sender();
    const terminal = await manager.create(owner, {});
    assert.doesNotThrow(() => manager.dispose());
    await until(() => !alive(terminal.pid), '查询进程失败也应结束终端');
    assert.throws(() => manager.read(owner, { id: terminal.id }), /已关闭/);
  }
});

test('插件注册五个受控入口，停用时注销入口并关闭终端', async t => {
  const handlers = new Map();
  const cleanups = [];
  apply({ ipc: { handle(channel, handler) { handlers.set(channel, handler); return () => handlers.delete(channel); } },
    effect(fn) { cleanups.push(fn()); } });
  t.after(() => cleanups.reverse().forEach(cleanup => cleanup()));
  assert.equal(handlers.size, 5);
  const owner = sender();
  const first = await handlers.get('terminal:create')({ sender: owner }, {});
  assert.equal(first.ok, true);
  const denied = await handlers.get('terminal:read')({ sender: sender(2) }, { id: first.id });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /已关闭/);
  cleanups.reverse().forEach(cleanup => cleanup());
  cleanups.length = 0;
  assert.equal(handlers.size, 0);
  await until(() => !alive(first.pid), '插件清理必须结束进程');
});
