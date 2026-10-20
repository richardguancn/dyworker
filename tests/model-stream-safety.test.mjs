import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { requestModel, runAgent } from '../electron/agent.mts';
import { createModelStreamParser } from '../electron/model-stream.mts';

const encoder = new TextEncoder();

function streamedResponse(chunks) {
  const state = { reads: 0, cancelled: false };
  const iterator = chunks[Symbol.iterator]();
  const body = new ReadableStream({
    pull(controller) {
      state.reads++;
      const next = iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(typeof next.value === 'string' ? encoder.encode(next.value) : next.value);
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { state, response: { ok: true, status: 200,
    headers: new Map([['content-type', 'text/event-stream']]), body } };
}

function request(endpoint, response, extra = {}) {
  return requestModel({ settings: { endpoint: `https://mock.invalid/v1/${endpoint}`, model: 'mock', apiKey: '' },
    messages: [{ role: 'user', content: '测试' }], tools: false,
    fetchImpl: async () => response, ...extra });
}

for (const endpoint of ['responses', 'chat/completions']) {
  test(`${endpoint}：错误正文不再无限积存，立即停止读取并关闭连接`, async () => {
    function* chunks() {
      yield ' \r\n';
      yield '{"error":{"message":"247 validation errors:';
      for (let i = 0; i < 128; i++) yield 'x'.repeat(32 * 1024);
    }
    const { response, state } = streamedResponse(chunks());
    await assert.rejects(request(endpoint, response), error => {
      assert.equal(error.code, 'MODEL_STREAM_INVALID_FORMAT');
      assert.ok(error.message.length < 300, '不能把原始错误详情和图片编码放进提示');
      return true;
    });
    assert.ok(state.reads <= 3, `不应继续读取错误正文，实际读取 ${state.reads} 次`);
    assert.equal(state.cancelled, true);
  });

  test(`${endpoint}：未结束的单个事件有大小限制，超限关闭连接`, async () => {
    function* chunks() {
      yield 'data: ';
      for (let i = 0; i < 512; i++) yield 'x'.repeat(32 * 1024);
    }
    const { response, state } = streamedResponse(chunks());
    await assert.rejects(request(endpoint, response), { code: 'MODEL_STREAM_EVENT_TOO_LARGE' });
    assert.ok(state.reads <= 258, '不能读完整份异常大事件');
    assert.equal(state.cancelled, true);
  });

  test(`${endpoint}：分段中文、思考、工具参数和结束事件保持完整`, async () => {
    const events = endpoint === 'responses' ? [
      { type: 'response.reasoning_text.delta', delta: '先想一想' },
      { type: 'response.output_text.delta', delta: '你好🌏' },
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'item1', call_id: 'call1', name: 'read_file' } },
      { type: 'response.function_call_arguments.delta', item_id: 'item1', delta: '{"path":' },
      { type: 'response.function_call_arguments.delta', item_id: 'item1', delta: '"中文.txt"}' },
      { type: 'response.completed', response: { output: [
        { type: 'message', content: [{ type: 'output_text', text: '你好🌏' }] },
        { type: 'function_call', call_id: 'call1', name: 'read_file', arguments: '{"path":"中文.txt"}' },
      ], usage: { input_tokens: 10, output_tokens: 5 } } },
    ] : [
      { choices: [{ delta: { reasoning_content: '先想一想', content: '你好🌏',
        tool_calls: [{ index: 0, id: 'call1', function: { name: 'read_file', arguments: '{"path":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"中文.txt"}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ];
    const wire = ': heartbeat\r\n\r\n' + events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('')
      + (endpoint === 'responses' ? '' : 'data: [DONE]\r\n\r\n');
    // 每个字节独立到达，覆盖 UTF-8 字符、CRLF 与事件边界的所有切分。
    const { response } = streamedResponse(Array.from(encoder.encode(wire), byte => Uint8Array.of(byte)));
    const texts = [], thoughts = [], usages = [];
    const message = await request(endpoint, response, {
      onText: text => texts.push(text), onReasoning: text => thoughts.push(text), onUsage: usage => usages.push(usage),
    });
    assert.equal(message.content, '你好🌏');
    assert.equal(texts.at(-1), '你好🌏');
    assert.equal(thoughts.at(-1), '先想一想');
    assert.equal(message.tool_calls[0].id, 'call1');
    assert.equal(message.tool_calls[0].function.arguments, '{"path":"中文.txt"}');
    assert.equal(usages[0].prompt_tokens, 10);
  });

  test(`${endpoint}：停止任务后关闭等待中的连接，不返回半截回复`, async () => {
    const abort = new AbortController();
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(encoder.encode('data: '));
        abort.abort(new Error('用户停止'));
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    await assert.rejects(request(endpoint, { ok: true, headers: new Map([['content-type', 'text/event-stream']]), body },
      { signal: abort.signal }), /用户停止/);
    assert.equal(cancelled, true);
  });
}

test('事件大小限制按单条计算，长回复与结尾没有空行的内容保持完整', () => {
  const blocks = [];
  const parser = createModelStreamParser(block => blocks.push(block), 32);
  for (let i = 0; i < 1000; i++) parser.feed('data: 完整内容\n\n');
  parser.feed('data: 末段');
  parser.finish();
  assert.equal(blocks.length, 1001);
  assert.equal(blocks.at(-1), 'data: 末段');
});

test('所有分隔符切分位置都不丢字，空行后仍识别错误正文', () => {
  const wire = 'data: 一\r\n\r\ndata: 二\n\ndata: 三\r\n\n';
  for (let split = 0; split <= wire.length; split++) {
    const blocks = [];
    const parser = createModelStreamParser(block => blocks.push(block));
    parser.feed(wire.slice(0, split));
    parser.feed(wire.slice(split));
    parser.finish();
    assert.deepEqual(blocks, ['data: 一', 'data: 二', 'data: 三']);
  }
  const parser = createModelStreamParser(() => {});
  parser.feed(': heartbeat\n\n');
  assert.throws(() => parser.feed('{"error":'), { code: 'MODEL_STREAM_INVALID_FORMAT' });
});

test('恰好达到大小上限的事件在分隔符分段到达时仍然可用', () => {
  const block = 'data: ' + 'x'.repeat(26);
  for (const ending of ['\n\n', '\r\n\r\n']) {
    for (let split = 0; split <= ending.length; split++) {
      const blocks = [];
      const parser = createModelStreamParser(value => blocks.push(value), 32);
      parser.feed(block + ending.slice(0, split));
      parser.feed(ending.slice(split));
      parser.finish();
      assert.deepEqual(blocks, [block]);
    }
  }
});

test('自动任务遇到异常格式直接报错，不重复发起同一请求', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-stream-safety-'));
  let requests = 0;
  try {
    const result = await runAgent({
      settings: { endpoint: 'https://mock.invalid/v1/responses', model: 'mock', apiKey: '' },
      workspacePath: root, conversation: [{ role: 'user', content: '你好' }], transportRetryBaseDelayMs: 0,
      fetchImpl: async () => { requests++; return streamedResponse(['{"error":{"message":"bad input"}}']).response; },
    });
    assert.equal(result.status, 'error');
    assert.match(result.reason, /异常格式/);
    assert.equal(requests, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
