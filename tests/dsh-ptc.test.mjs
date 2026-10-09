import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PtcExecutor } from '../electron/host/dsh-runtime/ptc-executor.mts';

async function setup(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-ptc-')));
  const work = path.join(root, 'work'); await fs.mkdir(work);
  const executor = new PtcExecutor(work);
  t.after(async () => { await executor.close(); await fs.rm(root, { recursive: true, force: true }); });
  const run = (program, options = {}, invoke = async () => null) => executor.run({ program, cwd: work, timeoutMs: 5000,
    sandboxPolicy: { mode: 'workspace-write', workspaceRoot: work }, bindings: [], ...options }, invoke, options.signal || new AbortController().signal);
  return { root, work, executor, run };
}

test('官方程序执行器返回真实绑定结果，读写工作目录；私有文件、越界写入和自行启动程序被拒绝', async t => {
  const { root, work, run } = await setup(t);
  const result = await run('const value: number = await fixture.plus({ value: 4 }); console.log("实际日志"); return { value };',
    { bindings: [{ global: 'fixture', names: ['plus'] }] }, async (global, member, args) => {
      assert.equal(global, 'fixture'); assert.equal(member, 'plus'); return args.value + 1;
    });
  assert.equal(result.error, undefined, JSON.stringify(result)); assert.deepEqual(result.value, { value: 5 });
  assert.ok(result.logs.some(line => line.includes('实际日志')));
  const write = await run('const fs = await import("node:fs/promises"); await fs.writeFile("actual.txt", "实际工作流文件"); return await fs.readFile("actual.txt", "utf8");');
  assert.equal(write.error, undefined, JSON.stringify(write)); assert.equal(write.value, '实际工作流文件');
  assert.equal(await fs.readFile(path.join(work, 'actual.txt'), 'utf8'), '实际工作流文件');
  const privateFile = path.join(root, 'private.txt'); await fs.writeFile(privateFile, '不能交给程序的私有数据');
  const read = await run(`return await (await import("node:fs/promises")).readFile(${JSON.stringify(privateFile)}, "utf8");`);
  assert.ok(read.error, JSON.stringify(read)); assert.doesNotMatch(JSON.stringify(read), /不能交给程序的私有数据/);
  const outside = path.join(root, 'outside.txt');
  const denied = await run(`await (await import("node:fs/promises")).writeFile(${JSON.stringify(outside)}, "不应写入"); return true;`);
  assert.ok(denied.error, JSON.stringify(denied)); await assert.rejects(fs.access(outside), { code: 'ENOENT' });
  const child = await run('return (await import("node:child_process")).execSync("echo unexpected").toString();');
  assert.ok(child.error, JSON.stringify(child));
});

test('官方程序执行器超时和停止等待实际退出，另一个执行继续正常运行', async t => {
  const { work, run } = await setup(t);
  const timeout = await run('while (true) {}', { timeoutMs: 150 });
  assert.equal(timeout.error?.kind, 'timeout', JSON.stringify(timeout));
  const controller = new AbortController();
  const pending = run('while (true) {}', { signal: controller.signal, timeoutMs: 10000 });
  const timer = setTimeout(() => controller.abort(new Error('验收停止')), 150);
  const cancelled = await pending; clearTimeout(timer);
  assert.equal(cancelled.error?.kind, 'abort', JSON.stringify(cancelled));
  assert.equal((await run('return "另一次正常运行";')).value, '另一次正常运行');
  const late = run('await new Promise(resolve => setTimeout(resolve, 1000)); await (await import("node:fs/promises")).writeFile("late.txt", "不应发生"); return true;', { timeoutMs: 150 });
  assert.equal((await late).error?.kind, 'timeout');
  await new Promise(resolve => setTimeout(resolve, 1100)); await assert.rejects(fs.access(path.join(work, 'late.txt')), { code: 'ENOENT' });
});
