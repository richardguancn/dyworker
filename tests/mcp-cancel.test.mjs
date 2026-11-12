import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpClient } from '../electron/mcp.mts';
import { discoverComputerUseServer } from '../electron/computer-use.mts';
import { resolveMcpServer } from '../electron/mcp-config.mts';

test('请求超时时通知服务停止执行', async () => {
  const client = new McpClient();
  const sent = [];
  client.send = message => sent.push(message);
  await assert.rejects(client.request('tools/call', { name: 'sample' }, 20), /超时/);
  assert.equal(sent[0].method, 'tools/call');
  assert.deepEqual(sent[1], { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: sent[0].id, reason: '请求超时' } });
  assert.equal(client.pending.size, 0);
});

test('关闭本机操作服务时等待已开始的清理', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-mcp-close-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ready = path.join(root, 'ready'), cleaned = path.join(root, 'cleaned');
  const script = `const fs=require('node:fs');process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(process.argv[2],'done');process.exit(0)},1300));fs.writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['-e', script, ready, cleaned], { stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  for (let i = 0; i < 100 && !await fs.stat(ready).catch(() => null); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(await fs.stat(ready).catch(() => null));
  const client = new McpClient({ shutdownGraceMs: 2500 });
  client.process = child;
  await client.close();
  assert.equal(await fs.readFile(cleaned, 'utf8'), 'done');
  assert.equal(child.exitCode, 0);
});

test('Mac 本机操作服务连接保留清理等待时间', () => {
  const server = discoverComputerUseServer({ platform: 'darwin', developmentPath: '/test', pathExists: () => true });
  assert.equal(resolveMcpServer(server).shutdownGraceMs, 1500);
});
