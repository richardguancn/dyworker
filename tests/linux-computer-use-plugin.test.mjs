import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHost, disposeHost } from '../electron/host/context.mts';
import { toolSummary } from '../electron/agent/tool-summary.mts';

test('Linux 电脑操作按任务隔离进程，停用和取消会关闭连接', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-linux-cu-'));
  const bin = path.join(dir, 'bin', 'arm64'); await fs.mkdir(bin, { recursive: true });
  const executable = path.join(bin, 'computer-use-linux');
  await fs.writeFile(executable, `const readline = require('node:readline');
const rl = readline.createInterface({input:process.stdin});
rl.on('line', line => {
 const msg=JSON.parse(line); if(!msg.id)return;
 const reply=result=>console.log(JSON.stringify({jsonrpc:'2.0',id:msg.id,result}));
 if(msg.method==='initialize')return reply({protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}});
 if(msg.method==='tools/list')return reply({tools:[{name:'get_app_state',description:'查看',inputSchema:{type:'object',properties:{}}},{name:'slow',inputSchema:{type:'object',properties:{}}},{name:'run_shell',inputSchema:{type:'object',properties:{}}}]});
 if(msg.method==='tools/call' && msg.params.name==='slow')return setTimeout(()=>reply({content:[{type:'text',text:'late'}]}),10000);
 if(msg.method==='tools/call')return reply({content:[{type:'text',text:String(process.pid)+':'+JSON.stringify(msg.params.arguments)},{type:'image',mimeType:'image/png',data:'aGVsbG8='}]});
});
`);
  const host = await createHost({ userDataDir: path.join(dir, 'data') });
  t.after(async () => { await host.linuxComputerUse.closeAll(); await disposeHost(host); await fs.rm(dir, { recursive: true, force: true }); });
  // 测试程序用 Node 显式启动，避免 Windows 把没有 .exe 后缀的脚本当作程序执行。
  // 保留真实客户端的参数、环境、通信和退出流程；生产环境仍直接启动 Linux 程序。
  const newClient = host.linuxComputerUse.newClient.bind(host.linuxComputerUse);
  t.mock.method(host.linuxComputerUse, 'newClient', () => {
    const client = newClient();
    client.args = [client.command, ...client.args];
    client.command = process.execPath;
    return client;
  });
  const cleanups = [];
  const scope = { tools: host.tools, effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); } };
  await host.linuxComputerUse.mount(scope, path.join(dir, 'bin'), 'linux', 'arm64');
  const prefix = 'plugin__dyworker_linux_computer_use__';
  assert.equal(host.tools.owns(prefix + 'run_shell'), false);
  const blocked = await host.tools.execute(prefix + 'get_app_state', {}, { sessionId: 'one', runId: 'run1', workspacePath: dir, source: 'agent' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /当前桌面/);
  assert.equal(host.linuxComputerUse.clients.size, 0);
  const definition = host.tools.definitions().find(tool => tool.function.name === prefix + 'get_app_state');
  assert.equal(definition.function.parameters.properties.use_shared_desktop.type, 'boolean');
  assert.match(toolSummary(prefix + 'get_app_state', { use_shared_desktop: true }), /切换前台并占用鼠标键盘/);
  const call = (sessionId, runId, signal) => host.tools.execute(prefix + 'get_app_state', { use_shared_desktop: true }, { sessionId, runId, workspacePath: dir, source: 'agent', signal });
  const a = await call('one', 'run1'); const b = await call('two', 'run2');
  assert.equal(a.ok, true); assert.equal(a.result.ok, true); assert.notEqual(a.result.result, b.result.result);
  assert.match(a.result.result, /:\{\}(?:\n|$)/);
  assert.equal(a.result.images[0].mimeType, 'image/png');
  assert.equal((await call('one', 'run1')).result.result, a.result.result);
  await host.linuxComputerUse.stopRun('one', 'run1');
  assert.notEqual((await call('one', 'run1')).result.result, a.result.result);
  const abort = new AbortController();
  const pending = host.tools.execute(prefix + 'slow', { use_shared_desktop: true }, { sessionId: 'one', runId: 'run1', workspacePath: dir, source: 'agent', signal: abort.signal });
  setTimeout(() => abort.abort(), 100);
  assert.equal((await pending).ok, false);
  assert.equal(host.linuxComputerUse.clients.has(JSON.stringify(['one', 'run1'])), false);
  for (const cleanup of cleanups.reverse()) await cleanup();
  assert.equal(host.tools.owns(prefix + 'get_app_state'), false);
  assert.equal(host.linuxComputerUse.clients.size, 0);
});

test('Windows 和 macOS 不会启动 Linux 电脑操作程序', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-linux-cu-platform-'));
  const host = await createHost({ userDataDir: dir });
  t.after(async () => { await disposeHost(host); await fs.rm(dir, { recursive: true, force: true }); });
  const clients = t.mock.method(host.linuxComputerUse, 'newClient', () => { throw new Error('不应启动 Linux 程序'); });
  for (const platform of ['win32', 'darwin']) {
    await assert.rejects(host.linuxComputerUse.mount({}, dir, platform, 'x64'), /此插件仅支持 Linux/);
  }
  assert.equal(clients.mock.callCount(), 0);
  assert.equal(host.linuxComputerUse.active, false);
  assert.equal(host.linuxComputerUse.clients.size, 0);
});
