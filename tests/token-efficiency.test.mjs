import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compactConversation, remainingWorkingContext, requestModel, runAgent, readUsageExtras } from '../electron/agent.mts';
import { generateWithDyworker } from '../electron/host/dsh-runtime/model-adapter.mts';
import { createDshTrace } from '../electron/host/dsh-runtime/trace.mts';

const chatResponse = (content = '结果', usage = undefined, finish_reason = 'stop') => ({ ok: true,
  json: async () => ({ choices: [{ message: { role: 'assistant', content }, finish_reason }], ...(usage ? { usage } : {}) }) });
const responsesResponse = () => ({ ok: true, json: async () => ({ status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: '结果' }] }] }) });
const routes = [
  ['OpenAI Chat', 'https://api.openai.com/v1/chat/completions', 'gpt-5', 'max_completion_tokens'],
  ['OpenAI Responses', 'https://api.openai.com/v1/responses', 'gpt-5', 'max_output_tokens'],
  ['DeepSeek Chat', 'https://api.deepseek.com/chat/completions', 'deepseek-v4-flash', 'max_tokens'],
  ['DeepSeek Responses', 'https://api.deepseek.com/responses', 'deepseek-v4-flash', 'max_output_tokens'],
  ['通义', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen-plus', 'max_tokens'],
  ['智谱', 'https://open.bigmodel.cn/api/paas/v4/chat/completions', 'glm-5.3', 'max_tokens'],
  ['Kimi', 'https://api.moonshot.cn/v1/chat/completions', 'kimi-k2.7', 'max_tokens'],
  ['MiniMax', 'https://api.minimax.io/v1/chat/completions', 'MiniMax-M2.7', 'max_tokens'],
  ['本地兼容服务', 'http://127.0.0.1:8000/v1/chat/completions', 'local-model', 'max_tokens'],
  ['兼容 Responses 服务', 'https://model.example.test/v1/responses', 'custom-model', 'max_output_tokens'],
];
for (const [label, endpoint, model, parameter] of routes) {
  test(`${label}：DSH 的摘要预算传到实际请求，正常回复不添加预算`, async () => {
    const payloads = [];
    for (const maxTokens of [2048, undefined]) {
      for await (const _chunk of generateWithDyworker({ endpoint, model, apiKey: 'test' }, {
        model, maxTokens, messages: [{ role: 'user', content: [{ type: 'text', text: '整理材料' }] }],
      }, { fetchImpl: async (_url, init) => {
        payloads.push(JSON.parse(init.body));
        return parameter === 'max_output_tokens' ? responsesResponse() : chatResponse();
      } })) {}
    }
    assert.equal(payloads.length, 2);
    assert.equal(payloads[0][parameter], 2048);
    assert.deepEqual(Object.keys(payloads[0]).filter(key => /^max_/.test(key)), [parameter]);
    assert.deepEqual(Object.keys(payloads[1]).filter(key => /^max_/.test(key)), []);
  });
}

test('服务不支持流式时，改用普通请求仍保留预算', async () => {
  const payloads = [];
  await requestModel({ settings: { endpoint: routes[0][1], model: 'gpt-5', apiKey: 'test' },
    messages: [{ role: 'user', content: '总结' }], tools: false, maxOutputTokens: 2048,
    fetchImpl: async (_url, init) => {
      payloads.push(JSON.parse(init.body));
      return payloads.length === 1
        ? { ok: false, status: 400, text: async () => 'stream unsupported' } : chatResponse();
    } });
  assert.deepEqual(payloads.map(body => body.max_completion_tokens), [2048, 2048]);
  assert.deepEqual(payloads.map(body => body.stream), [true, undefined]);
});

test('非法预算在请求前报错，不静默取消限制', async () => {
  for (const maxOutputTokens of [0, -1, 1.5, Infinity, NaN, null, '2048']) {
    await assert.rejects(requestModel({ settings: { endpoint: routes[0][1], model: 'gpt-5' },
      messages: [], maxOutputTokens, fetchImpl: () => assert.fail('不应发出请求') }), /输出上限必须是正整数/);
  }
});

test('兼容网关明确拒绝旧字段时改用另一字段，预算始终保留', async () => {
  const payloads = [];
  await requestModel({ settings: { endpoint: 'https://gateway.example.test/v1/chat/completions', model: 'gpt-5' },
    messages: [{ role: 'user', content: '总结' }], tools: false, maxOutputTokens: 2048,
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(init.body); payloads.push(payload);
      return payloads.length === 1 ? { ok: false, status: 400,
        text: async () => 'Unsupported parameter: max_tokens. Use max_completion_tokens instead.' } : chatResponse();
    } });
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].max_tokens, 2048);
  assert.equal(payloads[1].max_completion_tokens, 2048);
  assert.equal('max_tokens' in payloads[1], false);
});

test('预算数值不被接受时保留原预算报错，不取消限制或误换字段', async () => {
  const payloads = [];
  await assert.rejects(requestModel({ settings: { endpoint: routes[2][1], model: routes[2][2] },
    messages: [{ role: 'user', content: '总结' }], tools: false, maxOutputTokens: 2048,
    fetchImpl: async (_url, init) => {
      payloads.push(JSON.parse(init.body));
      return { ok: false, status: 400, text: async () => 'max_tokens must be less than 1024' };
    } }), /max_tokens/);
  assert.ok(payloads.every(payload => payload.max_tokens === 2048 && !('max_completion_tokens' in payload)));
});

test('原生长对话整理有明确预算；摘要截断时保留原始内容', async () => {
  const messages = Array.from({ length: 24 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `记录${index}` }));
  const original = structuredClone(messages);
  let payload;
  assert.equal(await compactConversation({ messages,
    settings: { endpoint: routes[6][1], model: 'kimi-k2.7', apiKey: 'test' },
    fetchImpl: async (_url, init) => { payload = JSON.parse(init.body); return chatResponse('只写了一半', undefined, 'length'); } }), false);
  assert.equal(payload.max_tokens, 4096);
  assert.equal(payload.tools, undefined);
  assert.deepEqual(messages, original, '不以截断的摘要覆盖历史');
});

const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reading = content => [
  { role: 'assistant', content: '', tool_calls: [call('read-one', 'read_file', { path: '材料.txt' })] },
  { role: 'tool', tool_call_id: 'read-one', content },
];
test('只去掉当前请求已完整携带的工作记录，旧记录和变化后的内容保留', () => {
  const original = '【读取 材料.txt】\n旧内容';
  const other = '【读取 其他.txt】\n另一份资料';
  const conversation = [{ role: 'assistant', executedMessages: reading('旧内容') }];
  assert.equal(remainingWorkingContext(original, conversation), '');
  assert.equal(remainingWorkingContext(`${original}\n\n${other}`, conversation), other);
  assert.equal(remainingWorkingContext(original, [{ role: 'assistant', executedMessages: reading('新内容') }]), original);
  assert.equal(remainingWorkingContext(original, [{ role: 'assistant', content: '已读文件' }]), original);
  assert.equal(remainingWorkingContext(`补充要求：${original}`, conversation), `补充要求：${original}`);
  const orphan = '【工具操作】\n旧内容';
  assert.equal(remainingWorkingContext(orphan, [{ role: 'tool', tool_call_id: 'missing', content: '旧内容' }]), orphan);
  assert.equal(remainingWorkingContext(original, [reading('旧内容')[0], { role: 'user', content: '中断' }, reading('旧内容')[1]]), original);
});

test('多轮真实装配中，工具原文不再与工作记录重复发送，未覆盖记录继续保留', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-token-efficiency-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const payloads = [];
  await runAgent({ settings: { endpoint: 'http://mock.local/v1/chat/completions', model: 'test', apiKey: 'test' },
    workspacePath: root,
    workingContext: '【读取 材料.txt】\n唯一资料正文\n\n【读取 其他.txt】\n只有工作记录保留的资料',
    conversation: [
      { role: 'user', content: '读文件' },
      { role: 'assistant', content: '已读', executedMessages: reading('唯一资料正文') },
      { role: 'user', content: '据此继续' },
    ], fetchImpl: async (_url, init) => { payloads.push(JSON.parse(init.body)); return chatResponse('结论'); } });
  const content = JSON.stringify(payloads[0].messages);
  assert.equal(content.split('唯一资料正文').length - 1, 1);
  assert.match(content, /只有工作记录保留的资料/);
  assert.equal(payloads[0].messages.filter(message => message.role === 'tool').length, 1);
});

test('不同服务的缓存和思考用量进入 DSH 与轨迹，零用量与缺项分别保留', async () => {
  const usage = { prompt_tokens: 100, completion_tokens: 20,
    prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 7 } };
  const chunks = [];
  for await (const chunk of generateWithDyworker({ endpoint: routes[0][1], model: 'gpt-5', apiKey: 'test' }, {
    model: 'gpt-5', messages: [{ role: 'user', content: [{ type: 'text', text: '整理' }] }],
  }, { fetchImpl: async () => chatResponse('结果', usage) })) chunks.push(chunk);
  assert.deepEqual(chunks.find(chunk => chunk.type === 'usage').usage,
    { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 0, reasoningTokens: 7 });
  const events = [];
  const trace = createDshTrace('root', event => events.push(event));
  trace.usage('root', trace.request('root', {}), usage);
  assert.deepEqual(events.at(-1).trace.usage,
    { prompt: 100, completion: 20, estimated: false, cacheRead: 80, cacheWrite: 0, reasoning: 7 });
  assert.deepEqual(readUsageExtras({ prompt_cache_hit_tokens: 0, reasoning_tokens: 0 }), { cacheRead: 0, reasoning: 0 });
  assert.deepEqual(readUsageExtras({}), {});
  assert.deepEqual(readUsageExtras({ cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }), { cacheRead: 3, cacheWrite: 4 });
  assert.deepEqual(readUsageExtras({ input_tokens_details: { cached_tokens: 5 }, output_tokens_details: { reasoning_tokens: 2 } }),
    { cacheRead: 5, reasoning: 2 });
});

test('历史整理按已知模型能力减少思考，普通任务保留用户档位，未知模型不猜测', async () => {
  const models = [
    ['https://api.deepseek.com/chat/completions', 'deepseek-v4-flash', 'low'],
    ['https://open.bigmodel.cn/api/paas/v4/chat/completions', 'glm-5.3', 'low'],
    ['https://api.openai.com/v1/chat/completions', 'gpt-5.6', 'none'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen3.8-plus', 'off'],
    ['http://model.example.test/v1/chat/completions', 'unknown-model', undefined],
  ];
  for (const [endpoint, model, expected] of models) {
    const settings = { endpoint, model, reasoningEffort: 'max', apiKey: 'test' };
    const payloads = [];
    for (const purpose of ['compaction', undefined]) {
      for await (const _chunk of generateWithDyworker(settings, { model, purpose,
        messages: [{ role: 'user', content: [{ type: 'text', text: '整理材料' }] }],
      }, { fetchImpl: async (_url, init) => { payloads.push(JSON.parse(init.body)); return chatResponse(); } })) {}
    }
    if (expected === 'off') assert.equal(payloads[0].enable_thinking, false);
    else assert.equal(payloads[0].reasoning_effort, expected, model);
    assert.equal(settings.reasoningEffort, 'max', '不改写已保存的用户设置');
    if (expected !== undefined) {
      assert.ok(payloads[1].reasoning_effort !== payloads[0].reasoning_effort
        || payloads[1].enable_thinking !== payloads[0].enable_thinking, '普通任务仍使用用户选择的较高档位');
    }
  }
});
