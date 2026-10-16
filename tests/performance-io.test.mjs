import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {setImmediate} from 'node:timers/promises';
import {createTraceWriter} from '../electron/trace-writer.mts';
import {createTraceBuffer} from '../src/traceBuffer.ts';
import {tracesIpcPlugin} from '../electron/host/plugins/traces-ipc.mts';

test('运行中分批保存完整轨迹，收尾冲刷余下内容且保持顺序', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-perf-trace-'));
  const file = path.join(dir, 'traces', 's.jsonl');
  const writer = createTraceWriter(file, {batchBytes: 1, delayMs: 10});
  const rows = Array.from({length: 50}, (_, seq) => ({seq, content: '完整正文'.repeat(100)}));
  rows.forEach(row => writer.push(row));
  await writer.flush();
  assert.deepEqual((await fs.readFile(file, 'utf8')).trim().split('\n').map(JSON.parse), rows);
  writer.push({seq: 50, content: '最终答复'});
  await writer.close();
  assert.equal(JSON.parse((await fs.readFile(file, 'utf8')).trim().split('\n').at(-1)).content, '最终答复');
  assert.equal(writer.stats().pendingBytes, 0);
});

test('轨迹写入失败保留未确认批次，恢复后重试无丢失、无重复', async () => {
  let fail = true;
  const writes = [];
  const writer = createTraceWriter('/tmp/dyw-test-trace.jsonl', {
    delayMs: 10000,
    storage: {mkdir: async () => {}, appendFile: async (_file, text) => {
      if (fail) throw new Error('暂时不可写');
      writes.push(text);
    }},
  });
  writer.push({seq: 1});
  await assert.rejects(writer.flush(), /暂时不可写/);
  writer.push({seq: 2});
  fail = false;
  await writer.close();
  assert.deepEqual(writes.join('').trim().split('\n').map(JSON.parse), [{seq: 1}, {seq: 2}]);
});

test('任务结束时保存失败，恢复后仍自动补存最后一批轨迹', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  let fail = true;
  const writes = [];
  const writer = createTraceWriter('/tmp/dyw-test-final-trace.jsonl', {
    delayMs: 10,
    storage: {mkdir: async () => {}, appendFile: async (_file, text) => {
      if (fail) throw new Error('暂时不可写');
      writes.push(text);
    }},
  });
  writer.push({seq: 1, content: '最终答复'});
  await assert.rejects(writer.close(), /暂时不可写/);
  assert.throws(() => writer.push({seq: 2}), /已关闭/);
  fail = false;
  context.mock.timers.tick(10);
  await setImmediate();
  assert.deepEqual(writes.join('').trim().split('\n').filter(Boolean).map(JSON.parse), [{seq: 1, content: '最终答复'}]);
  assert.equal(writer.stats().pendingBytes, 0);
  context.mock.timers.tick(100);
  await setImmediate();
  assert.equal(writes.length, 1);
});

test('轨迹展示缓存按容量淘汰、去重，不修改原始内容', () => {
  const buffer = createTraceBuffer(1500, 2);
  const rows = Array.from({length: 5}, (_, seq) => ({seq, runId: 'r', title: '事件', content: '内容'}));
  buffer.append(rows);
  assert.deepEqual(buffer.snapshot().map(row => row.seq), [3, 4]);
  assert.equal(buffer.append([rows[4]]), false);
  assert.ok(buffer.stats().bytes <= 1500);
  const huge = {seq: 6, runId: 'r', content: '全'.repeat(2000)};
  buffer.append([huge]);
  assert.deepEqual(buffer.snapshot(), [huge]);
  assert.equal(huge.content.length, 2000);
  buffer.clear();
  assert.deepEqual(buffer.snapshot(), []);
});

test('历史轨迹逐行分页读取，坏行不会导致下一页重复或停止', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-trace-pages-'));
  await fs.mkdir(path.join(dir, 'traces'));
  await fs.writeFile(path.join(dir, 'traces', 's.jsonl'), '{"seq":1}\n{坏行\n\n{"seq":3}\n{"seq":4}\n');
  const handlers = new Map();
  tracesIpcPlugin({
    app: {getPath: () => dir}, path, safeTraceSessionId: id => id,
    fs: {...fs, readFile: () => { throw new Error('不能一次读入完整历史'); }},
    trustedHandle: (name, handler) => handlers.set(name, handler),
  }).apply({});
  const list = await handlers.get('traces:list')(null, 's');
  assert.equal(list.count, 4);
  const first = await handlers.get('traces:read')(null, {sessionId: 's', offset: 0, limit: 2});
  assert.deepEqual(first.records, [{seq: 1}]);
  assert.equal(first.nextOffset, 2);
  const next = await handlers.get('traces:read')(null, {sessionId: 's', offset: first.nextOffset, limit: 2});
  assert.deepEqual(next.records, [{seq: 3}, {seq: 4}]);
  assert.equal(next.total, 4);
});
