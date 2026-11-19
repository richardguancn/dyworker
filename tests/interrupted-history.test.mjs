import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHost, disposeHost } from '../electron/host/context.mts';
import { runAgent } from '../electron/agent.mts';
import { compactDesktopHistory } from '../electron/agent/messages.mts';
import { recoverInterruptedDesktopHistory } from '../electron/desktop/interrupted-history.mts';

const tool = name => `mcp__computer-use__${name}`;
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = message => new Response(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }),
  { headers: { 'content-type': 'application/json' } });

test('停止后保留真实工具结果与计划，下轮首个模型请求能读到', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-stopped-turn-'));
  const host = await createHost({ userDataDir: dir, agentResolvers: {
    isShuttingDown: () => false, mcpExtraTools: async () => [], agentExtraTools: tools => tools,
    createExtraToolRouter: () => undefined, readHooks: async () => [], readMemoryPages: async () => [],
    readSkills: async () => [], readStandingRules: async () => [], history: () => null,
    memoriesFromAgentResult: () => [], auditRecord: () => {}, appendUsageStat: () => {},
  } });
  t.after(async () => { await disposeHost(host); await fs.rm(dir, { recursive: true, force: true }); });
  await fs.writeFile(path.join(dir, '进度.txt'), '法语元数据已经保存，西语尚未填写。');
  const config = { sessionId: 'resume-test', workspacePath: dir, approvalMode: 'full-access',
    settings: { endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test', model: 'test' } };
  const initial = { role: 'user', content: '读进度记录，完成剩余语言' };
  const abort = new AbortController();
  let requests = 0;
  let cancelHook = 0;
  const stopped = await host.agent.run({ ...config, conversation: [initial], signal: abort.signal,
    isCancelled: () => abort.signal.aborted, onCancelled: () => { cancelHook++; },
    fetchImpl: async () => {
      if (requests++ === 0) return reply({ role: 'assistant', tool_calls: [
        call('plan', 'update_plan', { steps: [{ title: '查看进度', status: 'in_progress' }] }),
        call('read', 'read_file', { path: '进度.txt' }),
      ] });
      abort.abort();
      throw abort.signal.reason;
    },
  });
  assert.equal(stopped.status, 'cancelled');
  assert.equal(cancelHook, 1);
  assert.deepEqual(stopped.plan.map(step => step.title), ['查看进度']);
  assert.match(stopped.workingContext, /西语尚未填写/);
  assert.match(stopped.executedMessages.find(message => message.tool_call_id === 'read').content, /法语元数据已经保存/);

  let firstRequest;
  const continued = await host.agent.run({ ...config, conversation: [initial,
    { role: 'assistant', content: stopped.finalText, executedMessages: stopped.executedMessages },
    { role: 'user', content: '继续' }], workingContext: stopped.workingContext,
    fetchImpl: async (_url, init) => {
      firstRequest ??= JSON.parse(init.body);
      return reply({ role: 'assistant', content: '下一步是西语。' });
    },
  });
  assert.equal(continued.status, 'done');
  assert.match(JSON.stringify(firstRequest.messages), /法语元数据已经保存，西语尚未填写/);
  assert.equal(firstRequest.messages.at(-1).content, '继续');
});

test('旧停止日志恢复实际保存和未完成字段，忽略其他轮次和已保存的执行链', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-legacy-stop-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'trace.jsonl');
  const rows = [];
  function log(runId, kind, data) { rows.push({ runId, kind, depth: 0, seq: rows.length + 1, ...data }); }
  function exchange(run, name, args, content, ok = true, turn = rows.length + 1) {
    log(run, 'tool-call', { turn, title: `调用工具 ${tool(name)}`, content: JSON.stringify({ app: 'test-browser', ...args }) });
    log(run, 'tool-result', { turn, parentSeq: rows.at(-1).seq, title: `工具 ${tool(name)} ${ok ? '成功' : '失败'}`, content });
  }
  const page = (id, locale, disabled) => `观察编号：${id}\nWindow: "本地测试页"\n0 standard window 本地测试页 ID: test\n1 HTML content 测试, URL: https://example.test/form\n2 标题 版本 1.0\n12 弹出式按钮 ${locale}\n42 按钮 ${disabled ? '(disabled) ' : ''}保存\n56 文本输入区 描述 Value: 不应重发的字段正文`;
  exchange('old-run', 'get_app_state', {}, page('fr', '法语', false));
  exchange('old-run', 'click', { observation_id: 'fr', element_index: '42' }, 'ok');
  exchange('old-run', 'get_app_state', {}, page('fr-after', '法语', true));
  exchange('old-run', 'get_app_state', {}, page('de', '德语', false));
  exchange('old-run', 'click', { observation_id: 'de', element_index: '42' }, 'ok');
  exchange('old-run', 'get_app_state', {}, page('es', '西语', true)); // Different scope is not proof of saving German.
  exchange('old-run', 'fill_form', { observation_id: 'es', fields: [{ value: '长正文'.repeat(1000) }] }, '描述未能读回', false);
  log('old-run', 'agent-finished', { content: '{"status":"cancelled","finalText":"准备重试"}' });
  log('new-run', 'agent-finished', { content: JSON.stringify({ status: 'cancelled', executedMessages: [{ role: 'assistant', content: '刚保存的进度' }] }) });
  await fs.writeFile(file, rows.map(record => JSON.stringify(record)).join('\n') + '\n{不完整行');
  const conversation = [{ role: 'assistant', taskStatus: 'cancelled', runId: 'old-run' },
    { role: 'assistant', runId: 'new-run' }, { role: 'user', content: '继续' }];
  const recovered = await recoverInterruptedDesktopHistory(file, conversation);
  const summary = recovered.get('old-run').summary;
  assert.match(summary, /保存按钮变为不可用：.*法语/);
  assert.match(summary, /西语.*批量填写未核对完成：描述未能读回/);
  assert.doesNotMatch(summary, /德语|不应重发|长正文|观察编号/);
  assert.deepEqual(recovered.get('new-run').executedMessages, [{ role: 'assistant', content: '刚保存的进度' }]);
  assert.equal((await recoverInterruptedDesktopHistory(file, [{ ...conversation[0], executedMessages: [{}] }])).size, 0);
  assert.equal((await recoverInterruptedDesktopHistory(path.join(dir, 'missing'), conversation)).size, 0);

  let request;
  const result = await runAgent({
    settings: { endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test', model: 'test' },
    workspacePath: dir,
    conversation: [{ role: 'user', content: '填写网页本地化' }, { role: 'assistant', content: summary }, conversation.at(-1)],
    extraTools: [{ type: 'function', function: { name: tool('get_app_state'), parameters: { type: 'object' } } }],
    fetchImpl: async (_url, init) => {
      request ??= JSON.parse(init.body);
      return reply({ role: 'assistant', content: '接着核对西语。' });
    },
  });
  assert.equal(result.status, 'done');
  assert.ok(request.tools.some(definition => definition.function?.name === tool('get_app_state')));
  assert.match(JSON.stringify(request.messages), /法语.*西语.*描述未能读回/);
});

test('旧点击从上下文折叠后，保留工具核对的保存结果', () => {
  const exchanges = Array.from({ length: 12 }, (_, index) => {
    const isSave = index === 0;
    return [{ role: 'assistant', content: '', tool_calls: [call(`t${index}`, tool(isSave ? 'click' : 'get_app_state'), {})] },
      { role: 'tool', tool_call_id: `t${index}`, content: isSave
        ? '成功\n已点击「保存」，页面上的保存按钮已变为不可用，已填写字段读回一致。\n观察编号：历史编号\nWindow: "测试"\n标题 版本 0.3.3\n弹出式按钮 法语'
        : '成功\n界面状态' }];
  }).flat();
  compactDesktopHistory(exchanges);
  assert.match(exchanges[0].content, /已填写字段读回一致.*法语/);
  assert.doesNotMatch(JSON.stringify(exchanges), /历史编号/);
});
