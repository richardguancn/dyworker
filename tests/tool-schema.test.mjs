import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { requestModel, toolDefinitions } from '../electron/agent.mts';
import { adaptToolsForModel, moonshotToolSchema } from '../electron/tool-schema.mts';
import { generateWithDyworker } from '../electron/host/dsh-runtime/model-adapter.mts';

// Captured from the installed REA MCP tools/list, without executing any tool.
const schema = JSON.parse(fs.readFileSync(new URL('./fixtures/tool-schemas/rea-native-ui-scenario.json', import.meta.url)));
const tool = { type: 'function', function: { name: 'capture_native_ui_scenario', parameters: schema } };
const settings = { endpoint: 'https://api.kimi.com/coding/v1/chat/completions', model: 'k3', apiKey: 'test' };

// Independent reproduction of MoonshotAI/walle's CheckRefTermination rules:
// required object fields and nonempty arrays must terminate; only anyOf is read.
function terminates(node, root, refs = new Set()) {
  if (node.type && !['array', 'object'].includes(node.type)) return true;
  if (node.type === 'array') return !(node.minItems > 0) || !node.items || terminates(node.items, root, refs);
  if (node.type === 'object') return (node.required || []).every(name =>
    !node.properties?.[name] || terminates(node.properties[name], root, new Set(refs)));
  if (node.anyOf?.some(branch => terminates(branch, root, new Set(refs)))) return true;
  if (node.$ref) {
    if (refs.has(node.$ref)) return false;
    refs.add(node.$ref);
    const target = node.$ref.slice(2).split('/').reduce((value, key) => value?.[key], root);
    assert.ok(target, `Missing reference ${node.$ref}`);
    return terminates(target, root, refs);
  }
  return Object.keys(node).length === 0;
}

test('实际 REA steps 声明重现 Moonshot 终止检查失败，转换后四种操作都保留', () => {
  assert.equal(terminates(schema.properties.steps, schema), false);
  const adapted = moonshotToolSchema(schema);
  assert.equal(terminates(adapted.properties.steps, adapted), true);
  assert.deepEqual(adapted.$defs.__schema7.anyOf.map(branch => branch.properties.kind.enum[0]),
    ['click', 'scroll', 'key-entry', 'wait']);
  assert.deepEqual(adapted.required, ['pid', 'window_id', 'steps']);
  assert.deepEqual(adapted.$defs.__schema7.anyOf[2].required, ['kind', 'path', 'text']);
  assert.equal(adapted.$defs.__schema0.minimum, 1);
  assert.equal(adapted.additionalProperties, false);
  assert.ok(schema.$defs.__schema7.oneOf, 'Original schema remains intact');
  assert.equal(schema.$defs.__schema7.oneOf[0].properties.kind.const, 'click');
});

test('只转换 Kimi 的发送副本，保留原始工具和其他厂商声明', () => {
  const tools = [tool, { type: 'builtin_function', function: { name: '$web_search' } }];
  const before = JSON.stringify(tools);
  for (const [endpoint, model] of [
    [settings.endpoint, 'k3'], ['https://api.moonshot.cn/v1/chat/completions', 'kimi-k3'],
    ['https://api.moonshot.ai/v1/chat/completions', 'kimi-k2.7'],
    ['https://gateway.example/v1/chat/completions', 'kimi-k3[1M]'],
  ]) {
    const adapted = adaptToolsForModel(tools, { endpoint, model });
    assert.ok(adapted[0].function.parameters.$defs.__schema7.anyOf);
    assert.equal(adapted[1], tools[1]);
  }
  assert.equal(adaptToolsForModel(tools, { endpoint: 'https://api.deepseek.com/responses', model: 'deepseek-flash' }), tools);
  assert.equal(JSON.stringify(tools), before);
  for (const builtin of toolDefinitions()) assert.deepEqual(moonshotToolSchema(builtin.function.parameters), builtin.function.parameters);
});

test('数据里的 const/oneOf 不被当作声明改写；嵌套字典、数组和定义得到转换', () => {
  const literal = { const: 'literal', oneOf: ['literal'], format: 'literal' };
  const adapted = moonshotToolSchema({ type: 'object', properties: {
    data: { type: 'object', default: literal, enum: [literal], additionalProperties: {
      type: 'array', items: { oneOf: [{ const: 'a' }, { const: 'b' }] },
    } },
  } });
  assert.deepEqual(adapted.properties.data.default, literal);
  assert.deepEqual(adapted.properties.data.enum, [literal]);
  assert.deepEqual(adapted.properties.data.additionalProperties.items.anyOf, [{ enum: ['a'] }, { enum: ['b'] }]);
});

test('模型请求的流式尝试与普通响应回退都发送兼容声明', async () => {
  const requests = [];
  const result = await requestModel({ settings, messages: [{ role: 'user', content: '回复收到' }],
    tools: [tool], fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body);
      const sent = body.tools[0].function.parameters;
      assert.equal(terminates(sent.properties.steps, sent), true);
      if (body.stream) return { ok: false, status: 400, text: async () => 'stream unsupported', headers: { get: () => '' } };
      return { ok: true, headers: { get: () => 'application/json' },
        json: async () => ({ choices: [{ message: { role: 'assistant', content: '收到' } }] }) };
    } });
  assert.equal(result.content, '收到');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].stream, true);
  assert.equal(requests[1].stream, undefined);
});

test('实际 DSH 模型桥能带 REA 声明接收工具调用；纯文字请求不带工具', async () => {
  const chunks = [];
  for await (const chunk of generateWithDyworker(settings, { model: 'k3',
    messages: [{ role: 'user', content: [{ type: 'text', text: '等待 100 毫秒' }] }], tools: [tool.function],
  }, { fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body), sent = body.tools[0].function.parameters;
    assert.equal(terminates(sent.properties.steps, sent), true);
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: {
      role: 'assistant', content: null, tool_calls: [{ id: 'call-rea', type: 'function', function: {
        name: 'capture_native_ui_scenario', arguments: JSON.stringify({ pid: 123, window_id: 456, steps: [{ kind: 'wait', milliseconds: 100 }] }),
      } }],
    } }] }) };
  } })) chunks.push(chunk);
  const call = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call');
  assert.equal(call.block.name, 'capture_native_ui_scenario');
  assert.deepEqual(JSON.parse(call.block.arguments).steps, [{ kind: 'wait', milliseconds: 100 }]);
  await requestModel({ settings, messages: [], tools: false, fetchImpl: async (_url, init) => {
    assert.equal(JSON.parse(init.body).tools, undefined);
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: '收到' } }] }) };
  } });
});
