import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHost, disposeHost } from '../electron/host/context.mts';

test('Linux 电脑操作按任务隔离进程，停用和取消会关闭连接', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-linux-cu-'));
  const bin = path.join(dir, 'bin', 'arm64'); await fs.mkdir(bin, { recursive: true });
  const executable = path.join(bin, 'computer-use-linux');
  await fs.writeFile(executable, `#!/usr/bin/env node
const readline = require('node:readline');
const rl = readline.createInterface({input:process.stdin});
rl.on('line', line => {
 const msg=JSON.parse(line); if(!msg.id)return;
 const reply=result=>console.log(JSON.stringify({jsonrpc:'2.0',id:msg.id,result}));
 if(msg.method==='initialize')return reply({protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}});
 if(msg.method==='tools/list')return reply({tools:[{name:'get_app_state',description:'查看',inputSchema:{type:'object',properties:{}}},{name:'slow',inputSchema:{type:'object',properties:{}}},{name:'run_shell',inputSchema:{type:'object',properties:{}}}]});
 if(msg.method==='tools/call' && msg.params.name==='slow')return setTimeout(()=>reply({content:[{type:'text',text:'late'}]}),10000);
 if(msg.method==='tools/call')return reply({content:[{type:'text',text:String(process.pid)},{type:'image',mimeType:'image/png',data:'aGVsbG8='}]});
});
`);
  await fs.chmod(executable, 0o755);
  const host = await createHost({ userDataDir: path.join(dir, 'data') });
  t.after(async () => { await host.linuxComputerUse.closeAll(); await disposeHost(host); await fs.rm(dir, { recursive: true, force: true }); });
  const cleanups = [];
  const scope = { tools: host.tools, effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); } };
  await host.linuxComputerUse.mount(scope, path.join(dir, 'bin'), 'linux', 'arm64');
  const prefix = 'plugin__dyworker_linux_computer_use__';
  assert.equal(host.tools.owns(prefix + 'run_shell'), false);
  const call = (sessionId, runId, signal) => host.tools.execute(prefix + 'get_app_state', {}, { sessionId, runId, workspacePath: dir, source: 'agent', signal });
  const a = await call('one', 'run1'); const b = await call('two', 'run2');
  assert.equal(a.ok, true); assert.equal(a.result.ok, true); assert.notEqual(a.result.result, b.result.result);
  assert.equal(a.result.images[0].mimeType, 'image/png');
  assert.equal((await call('one', 'run1')).result.result, a.result.result);
  await host.linuxComputerUse.stopRun('one', 'run1');
  assert.notEqual((await call('one', 'run1')).result.result, a.result.result);
  const abort = new AbortController();
  const pending = host.tools.execute(prefix + 'slow', {}, { sessionId: 'one', runId: 'run1', workspacePath: dir, source: 'agent', signal: abort.signal });
  setTimeout(() => abort.abort(), 100);
  assert.equal((await pending).ok, false);
  assert.equal(host.linuxComputerUse.clients.has(JSON.stringify(['one', 'run1'])), false);
  for (const cleanup of cleanups.reverse()) await cleanup();
  assert.equal(host.tools.owns(prefix + 'get_app_state'), false);
  assert.equal(host.linuxComputerUse.clients.size, 0);
});
