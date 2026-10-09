import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnRunner } from '../electron/host/plugin-install.mts';

test('安装超时先等待进程退出，子进程不会在回滚后继续写入', {timeout:10000}, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-installer-stop-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'late.txt');
  const grandchild = `setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'late'), 2500);`;
  const program = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}, process.argv[1]], {stdio:'inherit'});
    child.once('spawn',()=>console.log(JSON.stringify({parent:process.pid,child:child.pid})));
    child.once('error',error=>{console.error(error);process.exit(1)});setInterval(() => {}, 10000);`;
  const result = await spawnRunner(process.execPath, ['-e', program, output], { timeoutMs: 1000 });
  assert.equal(result.code, -1);
  assert.match(result.stderr, /安装进程已退出/);
  const ready = JSON.parse(result.stdout.trim());
  const pids = [ready.parent,ready.child];
  assert.ok(pids.every(pid=>Number.isSafeInteger(pid)&&pid>0),`必须取得实际启动的进程编号：${result.stdout}`);
  await new Promise(resolve => setTimeout(resolve, 2600));
  await assert.rejects(fs.access(output), { code: 'ENOENT' });
  for (const pid of pids) {
    try { process.kill(pid, 0); }
    catch (error) { assert.equal(error.code, 'ESRCH'); continue; }
    // 容器的 PID 1 可能尚未回收已退出的子进程；僵尸已不能执行或写文件。
    assert.equal(process.platform, 'linux', `进程 ${pid} 仍然存在`);
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    assert.equal(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0], 'Z', `进程 ${pid} 仍在执行`);
  }
});
