import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { BrowserUploads } from '../electron/host/dsh-runtime/browser-uploads.mts';
import { OfficialDshSession } from '../electron/host/dsh-runtime/full-session.mts';
import { attachmentsIpcPlugin } from '../electron/host/plugins/attachments-ipc.mts';
import { BrowserFileUpload } from '../src/pluginRuntime/fileUpload.ts';

async function bench(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-browser-upload-')));
  const profileDir = path.join(root, 'profile'), workspacePath = path.join(root, 'work');
  await fs.mkdir(path.join(profileDir, 'node_modules', 'upload-fixture'), { recursive: true }); await fs.mkdir(workspacePath);
  await fs.writeFile(path.join(profileDir, 'package.json'), '{}');
  const entry = path.join(profileDir, 'node_modules', 'upload-fixture', 'index.mjs');
  await fs.writeFile(entry, `export const inject=['connection','commands','agents','attachments']; export function apply(ctx){
    ctx.commands.register({name:'read-upload',description:'真实字节检查',input:{hint:'真实附件',attachments:true},handler:async inv=>{
      const items=[]; for(const part of inv.attachments){const chunks=[];for await(const data of ctx.attachments.readFileStream(part.attachment))chunks.push(Buffer.from(data));
      const data=Buffer.concat(chunks);items.push({name:part.attachment.name,bytes:data.length,data:data.toString('base64')});}return {kind:'success',text:JSON.stringify(items)};}});
    ctx.connection.fetch.register({path:'/api/read-upload',methods:['POST'],fetch:async req=>Response.json(await ctx.commands.execute(ctx.agents.list()[0],'/read-upload',await req.json(),req.signal))});
  }`);
  const ctx = new Context(), entries = new Map(), handlers = new Map();
  ctx.provide('sessions', { getAsync: async id => entries.has(id) ? { id, runtime: 'dsh' } : undefined });
  ctx.provide('dshRuntime', { sessions: entries, request: (id, action) => entries.get(id).runtime.request(action) });
  t.after(async () => { await ctx.fiber.dispose(); await Promise.all([...entries.values()].map(row => row.runtime.close())); await fs.rm(root, { recursive: true, force: true }); });
  for (const id of ['upload-a', 'upload-b']) {
    const runtime = new OfficialDshSession({ profileDir, workspacePath, dataDir: path.join(root, id), sessionId: id,
      plugins: [{ id: 'upload-fixture', entryUrl: pathToFileURL(entry).href }] });
    entries.set(id, { runtime }); await runtime.start();
  }
  await ctx.plugin(attachmentsIpcPlugin({ trustedHandle: (name, handler) => handlers.set(name, handler) }));
  const sender = Object.assign(new EventEmitter(), { id: 31, dead: false, isDestroyed() { return this.dead; } });
  const event = { sender };
  const bridge = input => handlers.get('attachments:browser-upload')(event, input);
  const client = new Context(); t.after(() => client.fiber.dispose());
  new BrowserFileUpload(client, bridge, id => entries.has(id));
  return { root, ctx, entries, handlers, sender, bridge, upload: client.get('fileUpload') };
}

test('浏览器文件、准确字节和字节流分块进入真实受限进程，官方命令读回全部内容及会话凭据', async t => {
  const { upload, entries, bridge, root } = await bench(t);
  const bytes = Buffer.alloc(200123); for (let at = 0; at < bytes.length; at++) bytes[at] = at % 251;
  const progress = [];
  for (const data of [new Blob([bytes]), new Uint8Array(bytes), new ReadableStream({ start(c) { c.enqueue(new Uint8Array(bytes)); c.close(); } })]) {
    const result = await upload.upload('upload-a', data, '资料.bin', undefined, value => progress.push(value));
    assert.equal(result.ok, true); assert.equal(result.value.file.bytes, bytes.length);
    const response = await entries.get('upload-a').runtime.request('route', { path: '/api/read-upload', method: 'POST', body: JSON.stringify([{ type: 'file', receiptId: result.value.receiptId }]) });
    const checked = JSON.parse(response.body).result; assert.equal(checked.kind, 'success');
    const actual = JSON.parse(checked.text)[0]; assert.equal(actual.name, '资料.bin'); assert.deepEqual(Buffer.from(actual.data, 'base64'), bytes);
    const foreign = await entries.get('upload-b').runtime.request('route', { path: '/api/read-upload', method: 'POST', body: JSON.stringify([{ type: 'file', receiptId: result.value.receiptId }]) });
    assert.equal(JSON.parse(foreign.body).result.kind, 'error');
  }
  assert.equal(progress[0].loaded, 0); assert.equal(progress.at(-1).loaded, bytes.length);
  assert.ok(progress.some(item => item.loaded === 65536));
  assert.deepEqual(await fs.readdir(path.join(root, 'upload-a', 'browser-uploads')), []);
  const empty = await upload.upload('upload-a', new Uint8Array(), '空文件.txt'); assert.equal(empty.value.file.bytes, 0);
  await assert.rejects(upload.upload('unknown-root', bytes, 'no.txt'), /仍被保留/);
  assert.equal((await bridge({ action: 'open', sessionId: 'unknown-root' })).ok, false);
});

test('上传编号绑定原窗口、根会话及运行代次，伪造编号、越界分块和窗口关闭不能保存文件', async t => {
  const { bridge, handlers, sender, entries, root } = await bench(t);
  const opened = await bridge({ action: 'open', sessionId: 'upload-a', name: '../../显示名称.txt' }); assert.equal(opened.ok, true);
  for (const input of [
    { action: 'write', sessionId: 'upload-b', uploadId: opened.value, data: 'YQ==' },
    { action: 'write', sessionId: 'upload-a', uploadId: 'invented', data: 'YQ==' },
    { action: 'write', sessionId: 'upload-a', uploadId: opened.value, data: Buffer.alloc(65537).toString('base64') },
    { action: 'write', sessionId: 'upload-a', uploadId: opened.value, data: 'not base64!' },
  ]) assert.equal((await bridge(input)).ok, false);
  const foreignSender = Object.assign(new EventEmitter(), { id: 32, isDestroyed: () => false });
  assert.equal((await handlers.get('attachments:browser-upload')({ sender: foreignSender }, { action: 'finish', sessionId: 'upload-a', uploadId: opened.value })).ok, false);
  assert.equal((await bridge({ action: 'write', sessionId: 'upload-a', uploadId: opened.value, data: 'YQ==' })).ok, true);
  const removed = await bridge({ action: 'open', sessionId: 'upload-a', name: '删除会话后取消.txt' });
  const saved = entries.get('upload-a'); entries.delete('upload-a');
  assert.equal((await bridge({ action: 'cancel', sessionId: 'upload-a', uploadId: removed.value })).ok, true);
  entries.set('upload-a', saved);
  const original = entries.get('upload-a'); entries.set('upload-a', { runtime: original.runtime });
  const stale = await bridge({ action: 'finish', sessionId: 'upload-a', uploadId: opened.value }); assert.equal(stale.ok, false); assert.match(stale.error, /重新启动/);
  entries.set('upload-a', original);
  const next = await bridge({ action: 'open', sessionId: 'upload-a', name: '关闭窗口.txt' }); sender.dead = true; sender.emit('destroyed');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await bridge({ action: 'finish', sessionId: 'upload-a', uploadId: next.value })).ok, false);
  assert.deepEqual(await fs.readdir(path.join(root, 'upload-a', 'browser-uploads')), []);
});

test('取消等待字节流会清理临时文件，取消上传不停止根任务，损坏的流与官方存储失败明确返回', async t => {
  const { upload, entries, root } = await bench(t); const abort = new AbortController(); let entered;
  const reading = new Promise(resolve => { entered = resolve; }); let canceled = false;
  const data = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); }, pull() { entered(); }, cancel() { canceled = true; } });
  const pending = upload.upload('upload-a', data, '取消.bin', abort.signal); const rejected = assert.rejects(pending, /验收取消/);
  await reading; abort.abort(new Error('验收取消')); await rejected;
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(canceled, true);
  assert.deepEqual(await fs.readdir(path.join(root, 'upload-a', 'browser-uploads')), []);
  assert.equal((await entries.get('upload-a').runtime.request('snapshot')).status, 'idle');
  await assert.rejects(upload.upload('upload-a', new ReadableStream({ start(c) { c.enqueue('错误类型'); c.close(); } })), /不是字节/);
  await new Promise(resolve => setTimeout(resolve, 20));
  const failed = await entries.get('upload-a').runtime.request('browser-upload', { file: { filePath: path.join(root, 'upload-a', 'missing-file'), name: '不存在.txt' } });
  assert.equal(failed.ok, false); assert.equal(failed.error.code, 'gateway/internal');
  assert.equal((await entries.get('upload-a').runtime.request('snapshot')).status, 'idle');
  const runtime = entries.get('upload-a').runtime, request = runtime.request.bind(runtime);
  runtime.request = (action, payload, options) => request(action, action === 'browser-upload'
    ? { ...payload, file: { ...payload.file, filePath: payload.file.filePath + '.missing' } } : payload, options);
  try {
    const result = await upload.upload('upload-a', new Blob(['模拟暂存文件消失']), '失效.txt');
    assert.equal(result.ok, false); assert.equal(result.error.code, 'gateway/internal');
    assert.equal(result.error.isDSHRemoteError, true); assert.ok(result.error instanceof Error);
  } finally { runtime.request = request; }
});

test('开始上传期间取消仍释放迟到的编号，插件宿主关闭会取消活跃上传', async t => {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose()); let finish, opened, cancelCalls = 0;
  const ready = new Promise(resolve => { opened = resolve; });
  new BrowserFileUpload(ctx, async request => {
    if (request.action === 'open') { opened(); return new Promise(resolve => { finish = resolve; }); }
    if (request.action === 'cancel') cancelCalls++;
    return { ok: true };
  }, () => true);
  const abort = new AbortController(); const pending = ctx.get('fileUpload').upload('a', new Blob(['数据']), undefined, abort.signal);
  const rejected = assert.rejects(pending, /提前取消/); await ready; abort.abort(new Error('提前取消')); await rejected;
  finish({ ok: true, value: 'late-id' }); await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelCalls, 1);
  const next = ctx.get('fileUpload').upload('a', new Uint8Array([1])); const disposed = assert.rejects(next, /已关闭/);
  await new Promise(resolve => setImmediate(resolve)); await ctx.fiber.dispose(); await disposed;
  finish({ ok: true, value: 'disposed-id' }); await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelCalls, 2);
});

test('受限进程取消尚未收到编号的上传，父进程释放实际存储通道且会话继续可用', async t => {
  const { entries } = await bench(t), runtime = entries.get('upload-a').runtime;
  await runtime.receive({ type: 'attachment', id: 'late-upload-open', action: 'upload-open', name: '未收到编号的文件.txt' }, {});
  const uploadId = runtime.attachmentUploadRequests.get('late-upload-open'), upload = runtime.attachmentUploads.get(uploadId);
  assert.ok(uploadId); assert.ok(upload);
  await runtime.receive({ type: 'cancel-request', id: 'late-upload-open' }, {});
  await assert.rejects(upload.result, /请求已取消/);
  assert.equal(runtime.attachmentUploads.has(uploadId), false);
  assert.equal(runtime.attachmentUploadRequests.size, 0);
  assert.equal((await runtime.request('snapshot')).status, 'idle');
});

test('会话关闭等待已取消但尚未退出的实际存储，另一根会话仍可读取', async t => {
  const { entries } = await bench(t), runtime = entries.get('upload-a').runtime;
  const store = runtime.persistenceContext.attachments, original = store.saveFileStream.bind(store);
  let release; const gate = new Promise(resolve => { release = resolve; }); t.after(() => release());
  store.saveFileStream = async input => { await gate; return original(input); };
  await runtime.receive({ type: 'attachment', id: 'closing-upload-open', action: 'upload-open', name: '关闭等待.txt' }, {});
  await runtime.receive({ type: 'cancel-request', id: 'closing-upload-open' }, {});
  assert.equal(runtime.attachmentUploads.size, 0);
  assert.equal(runtime.attachmentUploadOperations.size, 1);
  let stopped = false; const closing = runtime.stop().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, false);
  assert.equal((await entries.get('upload-b').runtime.request('snapshot')).status, 'idle');
  release(); await closing; assert.equal(runtime.attachmentUploadOperations.size, 0);
  assert.equal(runtime.child.connected, false);
});

test('暂存失败、取消与服务关闭释放句柄，不能重用已结束上传', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-browser-stage-')));
  const uploads = new BrowserUploads(); t.after(async () => { await uploads.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  const id = await uploads.open('a', 1, directory, '真实文件', async () => { throw new Error('实际保存失败'); });
  await uploads.write('a', 1, id, Buffer.from('原始字节').toString('base64'));
  await assert.rejects(uploads.finish('a', 1, id), /实际保存失败/); await assert.rejects(uploads.finish('a', 1, id), /不属于/);
  assert.deepEqual(await fs.readdir(path.join(directory, 'browser-uploads')), []);
  const cancel = await uploads.open('a', 1, directory, '取消文件', async () => assert.fail('取消后不能保存')); await uploads.cancel('a', 1, cancel);
  await uploads.open('a', 1, directory, '服务关闭', async () => ({})); await uploads.dispose();
  assert.deepEqual(await fs.readdir(path.join(directory, 'browser-uploads')), []);
  await assert.rejects(uploads.open('a', 1, directory, '不允许', async () => ({})), /已关闭/);
});
