import test from 'node:test';
import assert from 'node:assert/strict';
import {createTextCache, createConversationIndex} from '../src/performanceCache.ts';
import {createSessionSaveQueue} from '../src/sessionSaveQueue.ts';

test('文字缓存按最近使用淘汰，并限制 key 与结果的总字节量', () => {
  const cache = createTextCache(2, 24);
  const calls = [];
  const compute = key => { calls.push(key); return key.toUpperCase(); };
  for (const key of ['a', 'b', 'a', 'c', 'a', 'b']) cache.get(key, compute);
  assert.deepEqual(calls, ['a', 'b', 'c', 'b']);
  assert.equal(cache.get('very long uncacheable input', compute), 'VERY LONG UNCACHEABLE INPUT');
  assert.ok(cache.stats().bytes <= 24);
  assert.equal(cache.stats().entries, 2);
});

test('轮次索引跨系统消息找到首个助手，且只重算发生变化的轮次', () => {
  let calls = 0;
  const build = createConversationIndex((user, assistant) => { calls++; return `${user.content}:${assistant?.content || ''}`; });
  const user = content => ({role: 'user', content});
  const reply = content => ({role: 'assistant', content});
  const history = [reply('前言'), user('一'), {role: 'system'}, reply('甲'), reply('忽略'), user('二')];
  const first = build(history);
  assert.deepEqual(first.turns.map(row => row.preview), ['一:甲', '二:']);
  assert.deepEqual([...first.byMessageIndex], [[1, 0], [5, 1]]);
  const next = build([...history, reply('乙')]);
  assert.equal(calls, 3);
  assert.equal(first.turns[0].preview, next.turns[0].preview);
  assert.equal(next.turns[1].preview, '二:乙');
  assert.deepEqual(build([]).turns, []);
});

const row = (id, content = id) => ({id, title: id, messages: [{role: 'assistant', content}]});

test('保存失败不推进基线；下次请求重发所有未确认的更改，空闲不重复写入', async () => {
  const sent = [];
  let fail = true;
  const queue = createSessionSaveQueue(async payload => { sent.push(payload); return {ok: !fail}; });
  const a = row('a'), b = row('b');
  queue.seed([a], 'a');
  assert.equal(await queue.request([a, b], 'b'), false);
  fail = false;
  assert.equal(await queue.request([a, b], 'b'), true);
  assert.deepEqual(sent[1].changed, [b]);
  await queue.request([a, b], 'b');
  assert.equal(sent.length, 2);
  await queue.request([b], 'b');
  assert.deepEqual(sent[2].removed, ['a']);
});

test('保存串行执行，等待期间只保留最新快照，仍保留成功回执之后的新改动', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const sent = [];
  let concurrency = 0, maxConcurrency = 0;
  const queue = createSessionSaveQueue(async payload => {
    concurrency++; maxConcurrency = Math.max(maxConcurrency, concurrency);
    sent.push(payload);
    if (sent.length === 1) await gate;
    concurrency--;
    return {ok: true};
  });
  const a = row('a'), b = row('a', '二'), c = row('a', '三');
  const first = queue.request([a], 'a');
  await Promise.resolve();
  queue.request([b], 'a');
  const last = queue.request([c], 'a');
  release();
  assert.equal(await first, true);
  assert.equal(await last, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].changed[0], c);
  assert.equal(maxConcurrency, 1);
});

test('保存抛错后可恢复；活动会话与顺序变化也会保存', async () => {
  let throwing = true;
  const sent = [];
  const queue = createSessionSaveQueue(async payload => {
    if (throwing) throw new Error('磁盘暂不可写');
    sent.push(payload);
    return {ok: true};
  });
  const a = row('a'), b = row('b');
  queue.seed([a, b], 'a');
  assert.equal(await queue.request([a, b], 'b'), false);
  assert.equal(queue.error(), '磁盘暂不可写');
  throwing = false;
  await queue.request([b, a], 'b');
  assert.deepEqual(sent[0].changed, []);
  assert.deepEqual(sent[0].order, ['b', 'a']);
  assert.equal(sent[0].activeId, 'b');
});
