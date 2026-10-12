import assert from 'node:assert/strict';
import test from 'node:test';
import { findReasoningOverride, getModelReasoningConfig, normalizeReasoningOverrides, reasoningOptionLabel, selectedReasoningEffort, updateReasoningOverride } from '../electron/model-reasoning.ts';
import { requestModel } from '../electron/agent.mts';
import { matchProvider } from '../src/providers.ts';

async function payload(endpoint, model, effort = '', reasoningOverrides = []) {
  const calls = [];
  await requestModel({
    settings: { endpoint, model, apiKey: 'test-key', reasoningEffort: effort, reasoningOverrides },
    messages: [{ role: 'user', content: '测试' }], tools: false,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => body.input
        ? { id: 'test', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '完成' }] }] }
        : { choices: [{ message: { role: 'assistant', content: '完成' } }] } };
    },
  });
  assert.equal(calls.length, 1);
  return calls[0];
}

const deepseek = 'https://api.deepseek.com/chat/completions';
const kimi = 'https://api.kimi.com/coding/v1/chat/completions';
const kimiOpen = 'https://api.moonshot.cn/v1/chat/completions';
const glm = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

test('DeepSeek 只显示三个实际档位，旧兼容名称在展示和两种请求中折算一致', async () => {
  const expected = { minimal: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'high', max: 'max', ultra: 'max' };
  for (const [effort, actual] of Object.entries({ '': 'high', ...expected })) {
    assert.equal((await payload(deepseek, 'deepseek-v4-pro[1M]', effort)).reasoning_effort, actual);
    assert.deepEqual((await payload('https://api.deepseek.com/responses', 'deepseek-v4-pro', effort)).reasoning, { effort: actual });
  }
  const config = getModelReasoningConfig({ endpoint: deepseek, model: 'deepseek-v4-pro' });
  assert.deepEqual(config.efforts, ['low', 'high', 'max']);
  assert.equal(selectedReasoningEffort(config, ''), 'high');
  for (const [input, actual] of Object.entries(expected)) assert.equal(selectedReasoningEffort(config, input), actual);
  assert.deepEqual(config.efforts.map(value => reasoningOptionLabel(config, value)), ['低', '高 · 默认', '最高']);
  assert.equal((await payload(deepseek, 'deepseek-v4-pro', 'off')).reasoning_effort, 'high');
  assert.deepEqual((await payload('https://api.deepseek.com/responses', 'deepseek-v4-pro', 'off')).reasoning, { effort: 'high' });
  assert.equal((await payload(deepseek, 'deepseek-v4.1-flash[1M]', 'medium')).reasoning_effort, 'high');
});

test('K3 两种接入按用户要求默认 high，保留 low/high/max', async () => {
  for (const [endpoint, model] of [[kimi, 'k3'], [kimiOpen, 'kimi-k3']]) {
    const config = getModelReasoningConfig({ endpoint, model });
    assert.deepEqual(config.efforts, ['low', 'high', 'max']);
    for (const [input, output] of [['', 'high'], ['low', 'low'], ['max', 'max'], ['medium', 'high'], ['ultra', 'max']]) {
      assert.equal((await payload(endpoint, model, input)).reasoning_effort, output);
    }
  }
});

test('GLM 5.3 展示三档中文名称、默认 max，旧关闭设置不再发出非法关闭请求', async () => {
  for (const model of ['glm-5.3', 'glm-5.3-flash']) {
    const config = getModelReasoningConfig({ endpoint: glm, model });
    assert.deepEqual(config.efforts, ['low', 'high', 'max']);
    assert.equal(config.labels.low, '轻量思考');
    assert.equal(config.labels.high, '增强思考');
    assert.equal(config.labels.max, '深度思考');
    for (const effort of ['', 'off', 'medium']) {
      const body = await payload(glm, model, effort);
      assert.equal(body.reasoning_effort, 'max');
      assert.equal(body.thinking, undefined);
      assert.equal(selectedReasoningEffort(config, effort), 'max');
    }
  }
});

test('切换旧模型后不继承新模型强度；Kimi K2.6 可关闭、K2.7 不传强度', async () => {
  const oldKimi = await payload(kimiOpen, 'kimi-k2.6', 'max');
  assert.equal(oldKimi.reasoning_effort, undefined);
  assert.deepEqual(oldKimi.thinking, { type: 'enabled' });
  assert.deepEqual((await payload(kimiOpen, 'kimi-k2.6', 'off')).thinking, { type: 'disabled' });
  assert.equal((await payload(kimiOpen, 'kimi-k2.7-code', '')).reasoning_effort, undefined);
  assert.equal((await payload(kimiOpen, 'kimi-k2.7-code', 'max')).reasoning_effort, undefined);
  assert.deepEqual(getModelReasoningConfig({ endpoint: glm, model: 'glm-4.6' }).efforts, ['off', 'on']);
  assert.equal((await payload(glm, 'glm-4.6', 'max')).reasoning_effort, undefined);
  assert.equal((await payload(glm, 'glm-5.2', 'low')).reasoning_effort, 'high');
  assert.deepEqual(getModelReasoningConfig({ endpoint: glm, model: 'glm-4-flash' }).efforts, []);
});

test('同厂商不同服务路径和地区仍能识别，不依赖预设地址精确相等', async () => {
  assert.equal(matchProvider('https://api.deepseek.com/v1/chat/completions'), 'deepseek');
  assert.equal(matchProvider('https://api.kimi.ai/coding/v1/chat/completions'), 'kimi');
  assert.equal(matchProvider('https://api.moonshot.ai/v1/chat/completions'), 'kimi-open');
  assert.equal((await payload('https://api.kimi.ai/coding/v1/chat/completions', 'k3', '')).reasoning_effort, 'high');
});

test('其余已确认模型的选项分别匹配，未知旧型号不猜测强度', async () => {
  const cases = [
    ['openai', 'gpt-5.6', ['off', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
    ['openai', 'gpt-5.3-codex', ['low', 'medium', 'high', 'xhigh'], ''],
    ['openai', 'gpt-5.2', ['off', 'low', 'medium', 'high', 'xhigh'], 'off'],
    ['gemini', 'gemini-3-pro-preview', ['low', 'high'], 'high'],
    ['gemini', 'gemini-3-flash-preview', ['minimal', 'low', 'medium', 'high'], 'high'],
    ['gemini', 'gemini-2.5-flash', ['off', 'low', 'medium', 'high'], ''],
    ['xai', 'grok-4.6', ['low', 'medium', 'high', 'xhigh'], 'high'],
    ['xai', 'grok-4.5', ['low', 'medium', 'high'], 'high'],
    ['xai', 'grok-4-1-fast-reasoning', [], ''],
    ['minimax', 'MiniMax-M2.7', [], ''],
    ['qwen', 'qwen3.8-max', ['off', 'low', 'medium', 'xhigh'], 'xhigh'],
  ];
  for (const [provider, model, efforts, defaultEffort] of cases) {
    const config = getModelReasoningConfig({ provider, model });
    assert.deepEqual(config.efforts, efforts, model);
    assert.equal(config.defaultEffort, defaultEffort, model);
  }
  const gemini = await payload('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'gemini-2.5-flash', 'off');
  assert.equal(gemini.reasoning_effort, 'none');
  const m2 = await payload('https://api.minimaxi.com/v1/chat/completions', 'MiniMax-M2.7', 'off');
  assert.equal(m2.thinking, undefined);
  const endpoint = 'http://127.0.0.1:8000/v1/chat/completions';
  const model = 'Qwen/Qwen3.8-27B';
  const overrides = [{ endpoint, model, kind: 'qwen-local', options: [{ value: 'medium', label: '中' }], defaultEffort: 'medium' }];
  const local = await payload(endpoint, model, 'medium', overrides);
  assert.equal(local.reasoning_effort, 'medium');
  assert.deepEqual(local.chat_template_kwargs, { enable_thinking: true });
});

test('豆包 Evolving 旧 auto 回到 high；Responses 关闭发送 minimal', async () => {
  const endpoint = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  const config = getModelReasoningConfig({ endpoint, model: 'doubao-seed-evolving' });
  assert.ok(!config.efforts.includes('auto'));
  assert.equal((await payload(endpoint, 'doubao-seed-evolving', 'auto')).reasoning_effort, 'high');
  assert.deepEqual((await payload(endpoint.replace('/chat/completions', '/responses'), 'doubao-seed-evolving', 'off')).reasoning, { effort: 'minimal' });
});

const customEndpoint = 'https://custom.example/v1/chat/completions';
const customModel = 'custom-model';
const custom = (endpoint = customEndpoint, model = customModel) => ({
  endpoint, model, kind: 'standard', defaultEffort: 'max',
  options: [{ value: 'low', label: '轻量' }, { value: 'max', label: '深度' }, { value: 'ultra', label: '极深' }],
});

test('未知模型只使用默认：旧强度、仿厂商名称和本地模型名称都不能触发猜测', async () => {
  for (const model of ['custom-model', 'gpt-5.6', 'deepseek-v4-pro', 'Qwen/Qwen3.8-27B']) {
    const config = getModelReasoningConfig({ endpoint: customEndpoint, model });
    assert.deepEqual(config.efforts, []);
    for (const effort of ['', 'high', 'max', 'off']) {
      assert.equal(selectedReasoningEffort(config, effort), '');
      const body = await payload(customEndpoint, model, effort);
      assert.equal(body.reasoning_effort, undefined);
      assert.equal(body.thinking, undefined);
      assert.equal(body.chat_template_kwargs, undefined);
    }
  }
  assert.deepEqual(getModelReasoningConfig({ provider: 'qwen', model: 'unknown-version' }).efforts, []);
});

test('手动档位优先，名称与发送值分开；新增最高/极深、删除中档后发送与菜单一致', async () => {
  const overrides = [custom()];
  const config = getModelReasoningConfig({ endpoint: customEndpoint, model: customModel, overrides });
  assert.deepEqual(config.efforts, ['low', 'max', 'ultra']);
  assert.deepEqual(config.efforts.map(value => reasoningOptionLabel(config, value)), ['轻量', '深度 · 默认', '极深']);
  assert.equal((await payload(customEndpoint, customModel, '', overrides)).reasoning_effort, 'max');
  assert.equal((await payload(customEndpoint, customModel, 'ultra', overrides)).reasoning_effort, 'ultra');
  assert.equal((await payload(customEndpoint, customModel, 'medium', overrides)).reasoning_effort, 'max');
  // 不套用内置别名，手动配置中的 ultra 不能被转换为 max。
  const knownOverride = custom(deepseek, 'deepseek-v4-pro');
  knownOverride.kind = 'deepseek';
  assert.equal((await payload(deepseek, 'deepseek-v4-pro', 'ultra', [knownOverride])).reasoning_effort, 'ultra');
});

test('同名模型在不同地址、同地址的不同模型各自保存；恢复自动识别只删除当前项', () => {
  let overrides = updateReasoningOverride([], customEndpoint, customModel, custom());
  const otherEndpoint = 'https://other.example/v1/chat/completions';
  overrides = updateReasoningOverride(overrides, otherEndpoint, customModel, { ...custom(), defaultEffort: 'ultra' });
  overrides = updateReasoningOverride(overrides, customEndpoint, 'other-model', { ...custom(), defaultEffort: 'low' });
  assert.equal(findReasoningOverride(overrides, `${customEndpoint}/`, customModel).defaultEffort, 'max');
  assert.equal(findReasoningOverride(overrides, otherEndpoint, customModel).defaultEffort, 'ultra');
  assert.equal(findReasoningOverride(overrides, customEndpoint, 'other-model').defaultEffort, 'low');
  overrides = updateReasoningOverride(overrides, customEndpoint, customModel, null);
  assert.equal(overrides.length, 2);
  assert.equal(findReasoningOverride(overrides, customEndpoint, customModel), undefined);
  assert.deepEqual(getModelReasoningConfig({ endpoint: customEndpoint, model: customModel, overrides }).efforts, []);
});

test('不支持调整或默认由模型决定时，两种请求都不携带思考设置；恢复已知模型的内置档位', async () => {
  for (const endpoint of [deepseek, 'https://api.deepseek.com/responses']) {
    const model = 'deepseek-v4-pro';
    const disabled = [{ ...custom(endpoint, model), options: [], defaultEffort: '' }];
    const body = await payload(endpoint, model, 'high', disabled);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.reasoning, undefined);
    assert.equal(body.thinking, undefined);
    const restored = updateReasoningOverride(disabled, endpoint, model, null);
    assert.equal(getModelReasoningConfig({ endpoint, model, overrides: restored }).defaultEffort, 'high');
  }
  const providerDefault = [{ ...custom(), defaultEffort: '' }];
  assert.equal((await payload(customEndpoint, customModel, '', providerDefault)).reasoning_effort, undefined);
});

test('接入方式与自定义开关值一起生效；模型带上下文标注时仍使用原始模型配置', async () => {
  for (const [kind, expected] of [
    ['standard', { reasoning_effort: 'none' }],
    ['glm', { thinking: { type: 'disabled' } }],
    ['qwen', { enable_thinking: false }],
    ['qwen-local', { chat_template_kwargs: { enable_thinking: false } }],
    ['minimax', { thinking: { type: 'disabled' } }],
  ]) {
    const overrides = [{ ...custom(), kind, options: [{ value: 'off', label: '关闭' }], defaultEffort: '' }];
    const body = await payload(customEndpoint, customModel, 'off', overrides);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(body[key], value, kind);
  }
  const model = 'my-model[1M]';
  const body = await payload(customEndpoint, model, 'ultra', [custom(customEndpoint, model)]);
  assert.equal(body.model, 'my-model');
  assert.equal(body.reasoning_effort, 'ultra');
  const responsesEndpoint = 'https://custom.example/responses';
  assert.deepEqual((await payload(responsesEndpoint, customModel, 'ultra', [custom(responsesEndpoint)])).reasoning, { effort: 'ultra' });
});

test('读取配置时丢弃无效值、重复档位和失效默认；空列表仍明确保留', () => {
  const normalized = normalizeReasoningOverrides([
    null, {}, { ...custom(), kind: 'invalid' },
    { ...custom(), options: [{ value: ' low ', label: ' 轻量 ' }, { value: 'low', label: '重复' }, { value: 'bad value', label: '非法' }], defaultEffort: 'gone' },
    custom(), { ...custom('https://disabled.example', 'm'), options: [], defaultEffort: 'max' },
  ]);
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0].options, [{ value: 'low', label: '轻量' }]);
  assert.equal(normalized[0].defaultEffort, '');
  assert.deepEqual(normalized[1].options, []);
});
