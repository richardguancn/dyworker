import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { runAgent, compactConversation, reviewApproval } from '../electron/agent.mts';
const settings = { endpoint: 'http://mock.local/v1/chat/completions', model: 'audit-model', apiKey: 'test' };
const response = (message) => ({ ok: true, json: async () => ({ choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 10 } }) });
const usageEvents = events => events.filter(event => event.type === 'token-usage');
async function workspace(t) {
  const root = await fs.mkdtemp('/tmp/dyworker-token-test-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test('子任务和主任务各记一次，原始用量与轨迹一致', async t => {
  const root = await workspace(t);
  const events = [];
  const messages = [
    { role: 'assistant', content: null, tool_calls: [{ id: 's1', type: 'function', function: { name: 'dispatch_agent', arguments: JSON.stringify({ task: '计算 1+1' }) } }] },
    { role: 'assistant', content: '2' }, { role: 'assistant', content: '结果为2。' },
  ];
  let calls = 0;
  const result = await runAgent({ settings, workspacePath: root, conversation: [{ role: 'user', content: '让子任务计算 1+1' }], emit: e => events.push(e), fetchImpl: async () => response(messages[calls++]) });
  assert.equal(result.status, 'done');
  assert.equal(calls, 3);
  assert.equal(usageEvents(events).length, 3);
  assert.equal(usageEvents(events).reduce((sum, e) => sum + e.prompt + e.completion, 0), 330);
  assert.equal(events.filter(e => e.type === 'trace' && e.trace.kind === 'token-usage').length, 3);
});
test('超限后的强制压缩与重试都计入用量', async t => {
  const root = await workspace(t);
  const events = [];
  let phase = 0;
  const conversation = Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `第${i}条消息 ${'资料'.repeat(500)}` }));
  const result = await runAgent({ settings, workspacePath: root, conversation, contextLimit: 10000000, emit: e => events.push(e), fetchImpl: async (_url, options) => {
    if (phase === 0) {
      if (!JSON.parse(options.body).stream) phase = 1;
      return { ok: false, status: 400, text: async () => '{"error":{"code":"context_length_exceeded"}}' };
    }
    return response({ role: 'assistant', content: phase++ === 1 ? '已整理资料，下一步汇总。' : '汇总完成。' });
  } });
  assert.equal(result.status, 'done');
  assert.equal(usageEvents(events).length, 2);
  assert.equal(usageEvents(events).reduce((sum, e) => sum + e.prompt + e.completion, 0), 220);
});
async function storageHarness(seed = []) {
  const source = await fs.readFile(new URL('../electron/main.mts', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const USAGE_STATS_LIMIT ='), source.indexOf('// ---- 跨会话历史搜索 ----'));
  const clear = source.slice(source.indexOf('function clearUsageStats()'), source.indexOf('\nconst shellDeps ='));
  let reads = 0; let release;
  let persisted = structuredClone(seed);
  const loaded = new Promise(resolve => { release = resolve; });
  let flush;
  const context = vm.createContext({
    readJson: async () => { reads++; const snapshot = structuredClone(persisted); await loaded; return snapshot; },
    dataFile: x => x,
    writeJson: async (_file, items) => { persisted = structuredClone(items); },
    setTimeout: fn => { flush = fn; return 1; }, clearTimeout: () => { flush = null; },
  });
  vm.runInContext(block + clear + '\nglobalThis.audit={appendUsageStat,readUsageStats,clearUsageStats};', context);
  return { ...context.audit, release, reads: () => reads, flush: async () => { flush?.(); await Promise.resolve(); return persisted; } };
}
test('冷启动并发记账不丢记录，合并读取并正确保存', async () => {
  const store = await storageHarness();
  const writes = Array.from({ length: 20 }, (_, i) => store.appendUsageStat({ model: `model-${i}`, prompt: 100, completion: 10 }));
  store.release();
  await Promise.all(writes);
  assert.equal(store.reads(), 1);
  assert.equal((await store.readUsageStats()).length, 20);
  const persisted = await store.flush();
  assert.equal(persisted.length, 20);
  assert.equal(persisted.reduce((sum, e) => sum + e.prompt + e.completion, 0), 2200);
});
test('清空时尚未完成的读取不会把旧记录恢复', async () => {
  const store = await storageHarness([{ model: 'old', prompt: 100, completion: 10 }]);
  const read = store.readUsageStats();
  await store.clearUsageStats();
  store.release();
  assert.equal((await read).length, 0);
  await store.appendUsageStat({ model: 'new', prompt: 20, completion: 2 });
  const persisted = await store.flush();
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].model, 'new');
});
test('达到记录上限后并发写入仍保留最新两万条', async () => {
  const store = await storageHarness(Array.from({ length: 20000 }, (_, i) => ({ model: `old-${i}`, prompt: 1, completion: 0 })));
  store.release();
  await store.readUsageStats();
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.appendUsageStat({ model: `new-${i}`, prompt: 10, completion: 1 })));
  const persisted = await store.flush();
  assert.equal(persisted.length, 20000);
  assert.equal(persisted[0].model, 'old-20');
  assert.equal(persisted.filter(e => e.model.startsWith('new-')).length, 20);
});

test('压缩请求未返回用量时仍生成带估算标记的记录', async () => {
  const messages = Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `消息${i}：待整理材料` }));
  const usages = [];
  const changed = await compactConversation({ messages, settings, onUsage: usage => usages.push(usage), fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: '材料已整理。' } }] }) }) });
  assert.equal(changed, true);
  assert.equal(usages.length, 1);
  assert.equal(usages[0].estimated, true);
  assert.ok(usages[0].prompt_tokens > 0);
  assert.ok(usages[0].completion_tokens > 0);
});
test('审核请求按实际使用模型记账，未返回用量时标记估算', async () => {
  for (const backend of ['main', 'custom']) {
    const usages = [];
    const reviewSettings = { ...settings, reviewerBackend: backend, reviewerEndpoint: 'http://review.local/v1/chat/completions', reviewerModel: 'review-model' };
    await reviewApproval({ settings: reviewSettings, onUsage: usage => usages.push(usage), fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: '{"decision":"allow","reason":"安全读取"}' } }] }) }) });
    assert.equal(usages.length, 1);
    assert.equal(usages[0].model, backend === 'main' ? settings.model : 'review-model');
    assert.equal(usages[0].estimated, true);
  }
});
test('服务返回零输入用量时保留实测值，不额外估算', async t => {
  const root = await workspace(t);
  const events = [];
  await runAgent({ settings, workspacePath: root, conversation: [{ role: 'user', content: '你好' }], emit: e => events.push(e), fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: '你好。' } }], usage: { prompt_tokens: 0, completion_tokens: 10 } }) }) });
  assert.equal(usageEvents(events).length, 1);
  assert.equal(usageEvents(events)[0].prompt, 0);
  assert.equal(usageEvents(events)[0].completion, 10);
  assert.equal(usageEvents(events)[0].estimated, false);
});
