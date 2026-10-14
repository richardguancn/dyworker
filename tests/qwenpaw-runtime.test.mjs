import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRuntime } from '../builtin-plugins/qwenpaw/runtime.js';

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function setup(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-qwen-test-'));
  const port = await freePort(); let launches = 0;
  const runtime = createRuntime({ root, python: process.execPath, port, timeoutMs: 3000,
    launch: (_command, _args, options) => {
      launches++;
      return spawn(process.execPath, ['-e', `require('http').createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end('[]')}).listen(${port},'127.0.0.1')`], options);
    }, ...overrides });
  t.after(async () => { await runtime.stop(); await fs.rm(root, { recursive: true, force: true }); });
  return { runtime, root, port, launches: () => launches };
}
test('并发启动只产生一个服务；停止后端口释放，保存的数据不删除', async t => {
  const { runtime, root, port, launches } = await setup(t);
  await fs.writeFile(path.join(root, 'chat.json'), 'saved');
  const results = await Promise.all([runtime.start(), runtime.start()]);
  assert.ok(results.every(r => r.running)); assert.equal(launches(), 1);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/agents`)).status, 200);
  await runtime.stop(); assert.equal(runtime.status().running, false);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/agents`));
  assert.equal(await fs.readFile(path.join(root, 'chat.json'), 'utf8'), 'saved');
  assert.equal((await runtime.start()).running, true); assert.equal(launches(), 2);
});
test('启动失败有明确提示，不留下运行状态', async t => {
  const { runtime } = await setup(t, { python: '/nonexistent/qwenpaw/python' });
  await assert.rejects(runtime.start(), /尚未安装/);
  assert.equal(runtime.status().running, false); assert.equal(runtime.status().starting, false);
});
test('存在但不可执行的运行文件不会引起未处理异常', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-qwen-unexec-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const python = path.join(root, 'not-python'); await fs.writeFile(python, 'invalid');
  const runtime = createRuntime({ root, python, port: await freePort() });
  t.after(() => runtime.stop());
  await assert.rejects(runtime.start(), /EACCES|ENOEXEC|启动失败|未能启动/);
  assert.equal(runtime.status().running, false);
});
test('占用端口时拒绝启动，不接管其他服务', async t => {
  const { runtime, port, launches } = await setup(t);
  const server = net.createServer(); await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(runtime.start(), /已被占用/); assert.equal(launches(), 0);
});
test('健康检查超时后结束子进程，可重试', async t => {
  const { runtime, port } = await setup(t, { probe: async () => false, timeoutMs: 350 });
  await assert.rejects(runtime.start(), /未能启动/);
  assert.equal(runtime.status().starting, false);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/agents`));
});
test('启动途中停用时不报告成功，不留下进程', async t => {
  const { runtime, port } = await setup(t, { probe: async () => false });
  const started = runtime.start(); const rejection = assert.rejects(started, /启动已取消/);
  await new Promise(resolve => setTimeout(resolve, 150)); await runtime.stop(); await rejection;
  assert.equal(runtime.status().running, false);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/agents`));
});
