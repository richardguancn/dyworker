import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createHost, disposeHost } from '../electron/host/context.mts';
import { createDshApproval } from '../electron/host/dsh-runtime/approval.mts';
import { assertDshModelSettings, hasConfiguredModel, isLocalModelEndpoint } from '../electron/host/dsh-runtime/model-settings.mts';
import { createChildEntry } from '../electron/host/dsh-runtime/child-entry.mts';
import { agentIpcPlugin } from '../electron/host/plugins/agent-ipc.mts';
const require = createRequire(import.meta.url);
const settings = { endpoint: 'https://example.test/v1/chat/completions', model: 'selected', apiKey: 'only-in-parent' };
function reply(message) { return new Response(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 12 } }), { headers: { 'content-type': 'application/json' } }); }
async function setup(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-dsh-app-')));
  const workspacePath = path.join(root, 'work'); await fs.mkdir(workspacePath);
  const resolvers = { isShuttingDown: () => false, agentExtraTools: value => value, mcpExtraTools: async () => [],
    createExtraToolRouter: () => Object.assign(() => {}, { dispose: async () => {} }), readHooks: async () => [],
    readStandingRules: async () => [], auditRecord: () => {}, memoriesFromAgentResult: () => [], appendUsageStat: () => {} };
  const host = await createHost({ userDataDir: root, mountPlugins: true, agentResolvers: resolvers });
  t.after(async () => { await disposeHost(host); await fs.rm(root, { recursive: true, force: true }); });
  const profile = host.plugins.dir;
  await fs.mkdir(path.join(profile, 'node_modules'), { recursive: true });
  const packageDir = path.dirname(require.resolve('dsh-office-tools/package.json'));
  await fs.symlink(packageDir, path.join(profile, 'node_modules/dsh-office-tools'), 'dir');
  const added = await host.plugins.install({ spec: 'dsh-office-tools' });
  assert.equal(added.ok, true, added.error);
  return { root, host, workspacePath };
}

test('goal 只结束部分工作仍继续，整个目标完成后停止', async t => {
  const { host, workspacePath } = await setup(t);
  let calls = 0;
  const result = await host.agent.run({ runtime: 'dsh', sessionId: 'goal-partial', settings, workspacePath,
    prompt: '完成两项普通文字检查', goal: '完成两项普通文字检查', conversation: [{ role: 'user', content: '完成两项普通文字检查' }],
    loop: { enabled: true, iteration: 1, maximum: 3 }, approvalMode: 'full-access',
    fetchImpl: async () => {
      calls++;
      return reply({ role: 'assistant', content: calls === 1 ? '第一项已核对。' : '两项已核对。', tool_calls: [{ id: `finish-${calls}`, type: 'function',
        function: { name: 'finish_task', arguments: JSON.stringify({ summary: '文字检查结果', evidence: '已核对文字', ...(calls === 2 ? { goalAchieved: true } : {}) }) } }] });
    } });
  assert.equal(calls, 2);
  assert.equal(result.status, 'done');
  assert.equal(result.goalAchieved, true);
});

test('goal 用尽轮次明确保留未完成状态，不报告目标完成', async t => {
  const { host, workspacePath } = await setup(t);
  let calls = 0;
  const result = await host.agent.run({ runtime: 'dsh', sessionId: 'goal-limit', settings, workspacePath,
    prompt: '继续核对文字', goal: '完成全部文字检查', conversation: [{ role: 'user', content: '继续核对文字' }],
    loop: { enabled: true, iteration: 1, maximum: 2 }, approvalMode: 'full-access',
    fetchImpl: async () => { calls++; return reply({ role: 'assistant', content: '部分文字已核对，仍有剩余。' }); } });
  assert.equal(calls, 2);
  assert.equal(result.status, 'paused');
  assert.match(result.reason, /已推进 2 轮/);
  assert.equal(result.goalAchieved, undefined);
});

test('DSH 缺少模型设置明确失败，不创建官方会话或调用模型；补齐后可执行', async t => {
  const { host, workspacePath } = await setup(t);
  await host.sessions.upsert({ id: 'missing-model', runtime: 'dsh', workspacePath, messages: [] });
  let requests = 0;
  const run = settings => host.agent.run({ sessionId: 'missing-model', settings, workspacePath,
    prompt: '真实任务', conversation: [{ role: 'user', content: '真实任务' }], approvalMode: 'full-access',
    fetchImpl: async () => { requests++; return reply({ role: 'assistant', content: '真实模型已执行' }); } });
  for (const key of ['endpoint', 'model', 'apiKey']) {
    for (const value of [undefined, '', '   ']) {
      await assert.rejects(run({ ...settings, [key]: value }), /DSH 任务需要完整的模型服务设置/);
      assert.equal(host.dshRuntime.sessions.size, 0);
      assert.equal(requests, 0);
    }
  }
  assert.doesNotThrow(() => assertDshModelSettings('dyworker', {}));
  assert.doesNotThrow(() => assertDshModelSettings(undefined, {}));
  await assert.rejects(host.agent.run({ runtime: 'dsh', sessionId: 'explicit-missing', settings: {}, workspacePath }), /DSH 任务需要完整的模型服务设置/);
  const result = await run(settings);
  assert.equal(result.status, 'done');
  assert.equal(result.finalText, '真实模型已执行');
  assert.equal(result.demo, undefined);
  assert.equal(requests, 1);
  let authorization;
  const localResult = await host.agent.run({ runtime: 'dsh', sessionId: 'local-model', settings: { ...settings, endpoint: 'http://127.0.0.1:9337/v1/chat/completions', apiKey: '' }, workspacePath,
    prompt: '本机免密任务', conversation: [{ role: 'user', content: '本机免密任务' }], approvalMode: 'full-access',
    fetchImpl: async (_url, options) => { authorization = options.headers.Authorization; return reply({ role: 'assistant', content: '本机模型实际执行' }); } });
  assert.equal(localResult.status, 'done');
  assert.equal(localResult.finalText, '本机模型实际执行');
  assert.equal(authorization, undefined);
});

test('免密模型设置只接受回环地址，远程缺密钥不算完整设置', () => {
  for (const endpoint of ['http://localhost:9337/v1', 'http://127.0.0.1:9337/v1', 'https://[::1]/v1']) {
    assert.equal(isLocalModelEndpoint(endpoint), true);
    assert.equal(hasConfiguredModel({ endpoint, model: 'selected', apiKey: '' }), true);
  }
  for (const endpoint of ['https://example.test/v1', 'https://localhost.example.test/v1', 'http://192.168.1.2/v1', 'file://localhost/model', 'invalid']) {
    assert.equal(isLocalModelEndpoint(endpoint), false);
    assert.equal(hasConfiguredModel({ endpoint, model: 'selected', apiKey: '' }), false);
  }
  assert.equal(hasConfiguredModel({ endpoint: 'http://localhost', model: '   ' }), false);
  assert.equal(hasConfiguredModel(undefined), false);
});

test('应用共用入口实际运行官方 DSH，创建 Word、显示工具结果并读取产物证明', async t => {
  const { host, workspacePath } = await setup(t); let requests = 0;
  const events = [];
  const result = await host.agent.run({ runtime: 'dsh', sessionId: 'app-one', settings, workspacePath,
    prompt: '创建 Word', conversation: [{ role: 'user', content: '创建 Word' }], approvalMode: 'full-access', emit: event => events.push(event),
    fetchImpl: async () => requests++ === 0 ? reply({ role: 'assistant', content: null,
      tool_calls: [{ id: 'app-tool', type: 'function', function: { name: 'word_create', arguments: '{"path":"app.docx","paragraphs":["应用入口生成"]}' } }] })
      : reply({ role: 'assistant', content: '文件已创建' }) });
  assert.equal(result.status, 'done', JSON.stringify(result));
  assert.equal(result.finalText, '文件已创建');
  assert.equal((await fs.readFile(path.join(workspacePath, 'app.docx'))).subarray(0, 2).toString(), 'PK');
  assert.equal(result.hostReceipts.length, 1);
  assert.equal(result.hostReceipts[0].path, 'app.docx');
  assert.equal(result.hostReceipts[0].sha256.length, 64);
  assert.ok(events.some(event => event.type === 'activity-update' && event.status === 'success'));
  assert.equal(events.filter(event => event.type === 'token-usage').length, 2);
  assert.ok(events.some(event => event.type === 'file-change'));
  const traces = events.filter(event => event.type === 'trace').map(event => event.trace);
  const toolCall = traces.find(trace => trace.kind === 'tool-call' && trace.title === '调用工具 word_create');
  const toolResult = traces.find(trace => trace.kind === 'tool-result');
  assert.ok(toolCall); assert.equal(toolResult.parentSeq, toolCall.seq);
  assert.match(toolResult.content, /app.docx/);
  const {buildTraceModel}=await import('../src/traceModel.ts');
  const displayed=buildTraceModel(traces);
  assert.equal(displayed.turns.reduce((sum,turn)=>sum+turn.steps.reduce((subtotal,step)=>subtotal+step.requests.length,0),0),2);
  assert.equal(displayed.turns[0].toolNames[0], 'word_create');
  assert.doesNotMatch(JSON.stringify(traces), /only-in-parent/);
  const persisted = await host.dshRuntime.request('app-one', 'snapshot');
  assert.match(JSON.stringify(persisted.events), /应用入口生成/);
  assert.doesNotMatch(JSON.stringify(persisted.events), /only-in-parent/);
});

test('保存的会话运行方式由共用入口恢复；重新启动官方会话能继续原历史', async t => {
  const { host, workspacePath } = await setup(t);
  await host.sessions.upsert({ id: 'remembered', runtime: 'dsh', workspacePath, messages: [] });
  const run = prompt => host.agent.run({ sessionId: 'remembered', settings, workspacePath, prompt, conversation: [{ role: 'user', content: prompt }], approvalMode: 'full-access', fetchImpl: async () => reply({ role: 'assistant', content: '接着工作' }) });
  assert.equal((await run('第一轮真实任务')).status, 'done');
  await host.dshRuntime.close('remembered');
  const reopened = await Promise.all(Array.from({ length: 3 }, () => host.dshRuntime.request('remembered', 'snapshot')));
  for (const snapshot of reopened) assert.match(JSON.stringify(snapshot.events), /第一轮真实任务/);
  assert.equal(host.dshRuntime.sessions.size, 1);
  assert.equal((await run('重启后的第二轮')).status, 'done');
  const snapshot = await host.dshRuntime.request('remembered', 'snapshot');
  assert.match(JSON.stringify(snapshot.events), /第一轮真实任务/);
  assert.match(JSON.stringify(snapshot.events), /重启后的第二轮/);
});

test('模型实际返回的图片保存在官方历史并进入应用回复，重启后下一轮发送原图字节', async t => {
  const { host, workspacePath } = await setup(t); const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#184b76' } }).png().toBuffer();
  const url = 'data:image/png;base64,' + png.toString('base64');
  await host.sessions.upsert({ id: 'assistant-image', runtime: 'dsh', workspacePath, messages: [] });
  const result = await host.agent.run({ runtime: 'dsh', sessionId: 'assistant-image', settings, workspacePath,
    prompt: '返回一幅实际图片', approvalMode: 'full-access', fetchImpl: async () => reply({ role: 'assistant', content: [
      { type: 'text', text: '图片之前' }, { type: 'image_url', image_url: { url } }, { type: 'text', text: '图片之后' },
    ] }) });
  assert.equal(result.status, 'done', JSON.stringify(result));
  assert.deepEqual(result.executedMessages[0].content, [{ type: 'text', text: '图片之前' }, { type: 'image_url', image_url: { url } }, { type: 'text', text: '图片之后' }]);
  const snapshot = await host.dshRuntime.request('assistant-image', 'snapshot');
  const message = snapshot.events.find(event => event.type === 'assistant/message').data.message;
  assert.equal(message.content[1].type, 'image'); assert.equal(message.content[1].attachment.width, 3);
  assert.equal(message.content[1].attachment.height, 2); assert.equal(message.content[1].data, undefined);
  await host.dshRuntime.close('assistant-image'); let request;
  const continued = await host.agent.run({ runtime: 'dsh', sessionId: 'assistant-image', settings, workspacePath,
    prompt: '继续阅读这张图片', approvalMode: 'full-access', fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body); return reply({ role: 'assistant', content: '读取图片后继续' });
    } });
  assert.equal(continued.status, 'done');
  const previous = request.messages.find(item => item.role === 'assistant' && Array.isArray(item.content));
  assert.ok(previous); const image = previous.content.find(item => item.type === 'image_url');
  assert.deepEqual(Buffer.from(image.image_url.url.split(',')[1], 'base64'), png);
});

test('应用任务收尾等待所属后台工作，保留取消及工具入口，结束后撤销授权且下一轮不受旧清理影响', { timeout: 15000 }, async t => {
  const { host, workspacePath } = await setup(t);
  for (const id of ['background-owner', 'background-other']) await host.sessions.upsert({ id, runtime: 'dsh', workspacePath, messages: [] });
  let releaseChild, childEntered;
  const childGate = new Promise(resolve => { releaseChild = resolve; });
  const childStarted = new Promise(resolve => { childEntered = resolve; });
  t.after(() => releaseChild());
  let rootCalls = 0, settled = false;
  const pending = host.agent.run({ runtime: 'dsh', sessionId: 'background-owner', settings, workspacePath,
    prompt: '安排后台验收', approvalMode: 'full-access', fetchImpl: async (_url, options) => {
      const messages = JSON.parse(options.body).messages;
      if (messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('独立子项唯一标记'))) {
        childEntered(); await childGate;
        return reply({ role: 'assistant', content: '所属后台子项已经完成' });
      }
      return rootCalls++ === 0 ? reply({ role: 'assistant', content: null, tool_calls: [{ id: 'background-start', type: 'function',
        function: { name: 'workflow', arguments: JSON.stringify({ run_in_background: true,
          meta: { name: 'lifecycle-test', description: '真实后台收尾验收' }, script: "return await agent('独立子项唯一标记');" }) } }] })
        : reply({ role: 'assistant', content: '后台通知已处理' });
    } });
  void pending.then(() => { settled = true; });
  await childStarted;
  const owned = host.dshRuntime.sessions.get('background-owner');
  assert.equal(owned.busy, true);
  assert.equal(settled, false);
  assert.equal(typeof owned.runtime.options.onQuestion, 'function');
  await host.dshRuntime.closeIdle();
  assert.equal(host.dshRuntime.sessions.get('background-owner'), owned);
  await assert.rejects(host.agent.run({ runtime: 'dsh', sessionId: 'background-owner', settings, workspacePath,
    prompt: '不能借用前一轮授权', approvalMode: 'full-access' }), /已有运行中的任务/);
  const other = await host.agent.run({ runtime: 'dsh', sessionId: 'background-other', settings, workspacePath,
    prompt: '另一个根任务', approvalMode: 'full-access', fetchImpl: async () => reply({ role: 'assistant', content: '另一会话完成' }) });
  assert.equal(other.status, 'done');
  assert.equal(settled, false);
  releaseChild();
  assert.equal((await pending).status, 'done');
  assert.equal(owned.busy, false);
  assert.equal(owned.runtime.options.onQuestion, undefined);
  assert.equal(owned.runtime.options.onExtraTool, undefined);
  const completed = await host.dshRuntime.request('background-owner', 'snapshot');
  assert.equal(completed.jobs[0].status, 'completed');
  const next = await host.agent.run({ runtime: 'dsh', sessionId: 'background-owner', settings, workspacePath,
    prompt: '同根下一轮', approvalMode: 'full-access', fetchImpl: async () => reply({ role: 'assistant', content: '新授权下一轮完成' }) });
  assert.equal(next.finalText, '新授权下一轮完成');
  await host.dshRuntime.close('background-owner');
  const restored = await host.dshRuntime.request('background-owner', 'snapshot');
  assert.match(JSON.stringify(restored.events), /新授权下一轮完成/);
});

test('跨会话总览读取两份真实投影；关闭后从存档恢复且不包含完整消息或凭据', async t => {
  const { host, workspacePath } = await setup(t);
  await fs.symlink(path.dirname(require.resolve('dsh-context/package.json')), path.join(host.plugins.dir, 'node_modules/dsh-context'), 'dir');
  const installed = await host.plugins.install({ spec: 'dsh-context' });
  assert.equal(installed.ok, true, installed.error);
  for (const [id, tokens] of [['overview-a', 123], ['overview-b', 789]]) {
    await host.sessions.upsert({ id, runtime: 'dsh', title: id, workspacePath, updatedAt: new Date().toISOString(),
      messages: [{ role: 'user', content: `仅在该任务内可见的原文-${id}` }] });
    const result = await host.agent.run({ runtime: 'dsh', sessionId: id, settings, workspacePath,
      prompt: `仅在该任务内可见的原文-${id}`, approvalMode: 'full-access',
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: tokens, completion_tokens: 17 } }), { headers: { 'content-type': 'application/json' } }) });
    assert.equal(result.status, 'done');
  }
  await host.sessions.upsert({ id: 'ordinary-task', runtime: 'dyworker', title: '普通任务', workspacePath, messages: [] });
  const expected = {};
  for (const id of ['overview-a', 'overview-b']) {
    const snapshot = await host.dshRuntime.request(id, 'snapshot');
    expected[id] = snapshot.projections.values.contextTimeline;
    assert.ok(expected[id]);
    await host.dshRuntime.close(id);
  }
  assert.equal(host.dshRuntime.sessions.size, 0);
  const [overview, concurrent] = await Promise.all([host.dshRuntime.overview(), host.dshRuntime.overview()]);
  assert.equal(overview, concurrent);
  assert.deepEqual(overview.ids.sort(), ['overview-a', 'overview-b']);
  for (const id of overview.ids) assert.deepEqual(overview.byId[id].projectionValues.contextTimeline, expected[id]);
  assert.notDeepEqual(expected['overview-a'], expected['overview-b']);
  assert.equal(host.dshRuntime.sessions.size, 0, '读取缓存不能启动模型任务或常驻新进程');
  assert.doesNotMatch(JSON.stringify(overview), /only-in-parent/);
  for (const id of overview.ids) {
    assert.equal(overview.byId[id].messages, undefined);
    assert.equal(overview.byId[id].events, undefined);
    assert.equal(overview.byId[id].projectionValues.contextTimeline.lastUser, `仅在该任务内可见的原文-${id}`, '原样插件总览使用最后提问的预览');
  }
  // 缺失旧缓存只能从自己的官方存档恢复，不借用另一任务的统计。
  await fs.rm(host.dshRuntime.config.dir + '/' + createHash('sha256').update('overview-b').digest('hex') + '/overview.json');
  const cold = await host.dshRuntime.overview();
  assert.deepEqual(cold.byId['overview-b'].projectionValues.contextTimeline, expected['overview-b']);
  assert.equal(host.dshRuntime.sessions.size, 0);
});

test('DSH 工具原始短名称也按外部操作审批，拒绝修改模式不能误当只读放行', async () => {
  const controller = new AbortController(); let asks = 0;
  for (const name of ['word_create', 'subagent', 'innocent_name']) {
    assert.equal(await createDshApproval({ approvalMode: 'deny-changes' })({ name, args: {}, signal: controller.signal }), false);
  }
  assert.equal(await createDshApproval({ approvalMode: 'interactive', requestApproval: async () => { asks++; return false; } })({ name: 'word_create', args: {}, signal: controller.signal }), false);
  assert.equal(asks, 1);
  assert.equal(await createDshApproval({ approvalMode: 'full-access' })({ name: 'word_create', args: {}, signal: controller.signal }), true);
  assert.equal(await createDshApproval({ approvalMode: 'full-access', hooks: [{ event: 'before_tool', tool: 'word_create', action: 'block' }] })({ name: 'word_create', args: {}, signal: controller.signal }), false);
});

test('DSH 人工审批等待可停止，且强制人工规则不能被审核模型覆盖', async () => {
  const controller = new AbortController(); let reviewCalls = 0;
  const approve = createDshApproval({ approvalMode: 'reviewer', hooks: [{ event: 'before_tool', tool: 'word_create', action: 'require_approval' }],
    review: async () => { reviewCalls++; return { decision: 'allow' }; }, requestApproval: () => new Promise(() => {}) });
  const pending = approve({ name: 'word_create', args: {}, signal: controller.signal });
  const rejection = assert.rejects(pending, /停止/);
  await new Promise(resolve => setTimeout(resolve, 20)); controller.abort(new Error('审批已停止')); await rejection;
  assert.equal(reviewCalls, 0);
});

test('DSH 真实任务调用应用的外部工具，保留参数和结果；拒绝时不会调用', async t => {
  const { host, workspacePath } = await setup(t);
  await fs.writeFile(path.join(workspacePath, 'AGENTS.md'), '工作区的真实约定：始终保留原始办公文件');
  host.agent.resolvers.readMemoryPages = async () => [{ relPath: 'pages/session.md', title: '会话记忆', content: '本会话已批准的真实背景', scope: 'session', rows: [] }];
  const schema = { type: 'function', function: { name: 'mcp__fixture__lookup', description: '查询隔离测试数据',
    parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false } } };
  const invoked = []; const sent = [];
  const run = async approvalMode => {
    let calls = 0;
    return host.agent.run({ runtime: 'dsh', sessionId: `external-${approvalMode}`, settings, workspacePath,
      prompt: '查询', conversation: [{ role: 'user', content: '查询\n附件中提取的文字：保留这部分' }], approvalMode,
      extraTools: [schema], onExtraTool: async (name, args) => { invoked.push({ name, args }); return { key: args.key, value: '真实外部返回值' }; },
      fetchImpl: async (_, init) => {
        sent.push(JSON.parse(init.body));
        return calls++ === 0 ? reply({ role: 'assistant', content: null, tool_calls: [{ id: 'external-call', type: 'function',
          function: { name: schema.function.name, arguments: '{"key":"requested"}' } }] }) : reply({ role: 'assistant', content: '读取完成' });
      } });
  };
  assert.equal((await run('full-access')).status, 'done');
  assert.deepEqual(invoked, [{ name: schema.function.name, args: { key: 'requested' } }]);
  assert.ok(sent[0].tools.some(tool => tool.function.name === schema.function.name));
  assert.match(JSON.stringify(sent[0].messages), /附件中提取的文字/);
  assert.match(JSON.stringify(sent[0].messages), /始终保留原始办公文件/);
  assert.match(JSON.stringify(sent[0].messages), /本会话已批准的真实背景/);
  assert.match(JSON.stringify(sent[1].messages), /真实外部返回值/);
  assert.doesNotMatch(JSON.stringify(await host.dshRuntime.request('external-full-access', 'snapshot')), /only-in-parent/);
  assert.equal((await run('deny-changes')).status, 'done');
  assert.equal(invoked.length, 1, '未批准的第二次调用没有进入应用工具');
  await assert.rejects(host.agent.run({ runtime: 'dsh', sessionId: 'image', settings, workspacePath, prompt: '查看图片',
    conversation: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }] }],
    approvalMode: 'full-access' }), /图片需要已上传|image|Image|base64|编码|解码/);
  assert.equal(host.dshRuntime.sessions.has('image'), false, '未支持的附件在启动任务前明确拒绝');
});

test('DSH 审核模式不让审核模型批准改写自己的规则', async () => {
  let reviews = 0; let asked = 0;
  const approve = createDshApproval({ approvalMode: 'reviewer', workspacePath: process.cwd(),
    review: async () => { reviews++; return { decision: 'allow' }; }, requestApproval: async () => { asked++; return false; } });
  assert.equal(await approve({ name: 'write_rule', args: { path: 'electron/reviewer-policy.md' }, signal: new AbortController().signal }), false);
  assert.equal(reviews, 0); assert.equal(asked, 1);
});

test('已有 DSH 页面打开后新增插件，配置读取重新打开真实插件组合', async t => {
  const { host, workspacePath } = await setup(t);
  await host.sessions.upsert({ id: 'settings-on-enable', runtime: 'dsh', workspacePath, messages: [] });
  const before = await host.dshRuntime.request('settings-on-enable', 'settings-describe');
  assert.ok(!before.some(row => row.ns === 'dsh-context'));
  const profile = host.plugins.dir;
  await fs.symlink(path.dirname(require.resolve('dsh-context/package.json')), path.join(profile, 'node_modules/dsh-context'), 'dir');
  const added = await host.plugins.install({ spec: 'dsh-context', allowIncompatible: true });
  assert.equal(added.ok, true, added.error);
  const after = await host.dshRuntime.request('settings-on-enable', 'settings-describe');
  assert.ok(after.some(row => row.ns === 'dsh-context'));
});


test('DSH 官方提问保持问题标识、说明、单选、多选和自填回答，沿用原有提问权限', async t => {
  const { host, workspacePath } = await setup(t); let calls = 0; let approvals = 0;
  const shown = []; const requests = [];
  const result = await host.agent.run({ runtime: 'dsh', sessionId: 'human-questions', settings, workspacePath,
    prompt: '向用户询问需要的文件', conversation: [{ role: 'user', content: '向用户询问需要的文件' }], approvalMode: 'interactive',
    requestApproval: async () => { approvals++; return false; },
    requestUserInput: async (request, signal) => {
      assert.equal(signal.aborted, false); shown.push(request);
      return { ok: true, answer: shown.length === 1 ? 'Word' : shown.length === 2
        ? JSON.stringify({ format: 'dsh-question-answer-v1', selected: ['Excel', 'PDF'], custom: '还需要摘要' }) : '使用中文标题' };
    },
    fetchImpl: async (_, init) => {
      requests.push(JSON.parse(init.body));
      return calls++ === 0 ? reply({ role: 'assistant', content: null, tool_calls: [{ id: 'question-call', type: 'function',
        function: { name: 'ask_user_question', arguments: JSON.stringify({ questions: [
          { id: 'single', header: '文件格式', question: '主要输出什么格式？', options: [{ label: 'Word', description: '便于继续编辑' }, { label: 'PDF' }] },
          { id: 'multiple', question: '另外需要哪些文件？', multi_select: true, options: [{ label: 'Excel' }, { label: 'PDF' }] },
          { id: 'free', question: '标题有什么要求？' },
        ] }) } }] }) : reply({ role: 'assistant', content: '已收到完整回答' });
    } });
  assert.equal(result.status, 'done'); assert.equal(approvals, 0, '不为普通提问再增加一次审批');
  assert.equal(shown[0].header, '文件格式'); assert.equal(shown[0].optionDescriptions[0], '便于继续编辑');
  assert.equal(shown[1].multiSelect, true); assert.equal(new Set(shown.map(row => row.id)).size, 3);
  const toolMessage = requests[1].messages.find(message => message.role === 'tool');
  assert.deepEqual(JSON.parse(toolMessage.content), { answers: [
    { id: 'single', selected: ['Word'] }, { id: 'multiple', selected: ['Excel', 'PDF'], custom: '还需要摘要' },
    { id: 'free', selected: [], custom: '使用中文标题' },
  ] });
  assert.match(JSON.stringify((await host.dshRuntime.request('human-questions', 'snapshot')).events), /还需要摘要/);
  assert.equal(host.dshRuntime.sessions.get('human-questions').runtime.options.onQuestion, undefined);
});

test('DSH 提问取消或没有窗口会返回真实失败，停止等待不影响其他会话', async t => {
  const { host, workspacePath } = await setup(t);
  const questionCall = { role: 'assistant', content: null, tool_calls: [{ id: 'question', type: 'function',
    function: { name: 'ask_user_question', arguments: '{"questions":[{"id":"q","question":"继续吗？"}]}' } }] };
  for (const [id, requestUserInput] of [['no-window', undefined], ['declined', async () => ({ ok: false, reason: '用户取消' })]]) {
    let calls = 0;
    const result = await host.agent.run({ runtime: 'dsh', sessionId: id, settings, workspacePath, prompt: '提问',
      conversation: [{ role: 'user', content: '提问' }], approvalMode: 'full-access', requestUserInput,
      fetchImpl: async () => calls++ === 0 ? reply(questionCall) : reply({ role: 'assistant', content: '缺少回答' }) });
    assert.equal(result.status, 'done');
    const snapshot = await host.dshRuntime.request(id, 'snapshot');
    const message = snapshot.events.find(event => event.type === 'tool/result').data.message;
    assert.equal(message.isError, true); assert.match(JSON.stringify(message.content), /不支持|取消/);
    assert.doesNotMatch(JSON.stringify(message.content), /"selected":/);
  }
  let entered; const waiting = new Promise(resolve => { entered = resolve; }); const controller = new AbortController();
  let questionSignal;
  const stopped = host.agent.run({ runtime: 'dsh', sessionId: 'stopped-question', settings, workspacePath, prompt: '提问',
    conversation: [{ role: 'user', content: '提问' }], approvalMode: 'full-access', signal: controller.signal,
    requestUserInput: (_request, signal) => { questionSignal = signal; entered(); return new Promise(() => {}); },
    fetchImpl: async () => reply(questionCall) });
  await waiting; controller.abort(new Error('任务已停止'));
  assert.equal((await stopped).status, 'cancelled'); assert.equal(questionSignal.aborted, true);
  assert.equal(host.dshRuntime.sessions.has('stopped-question'), false);
  assert.ok((await host.dshRuntime.request('declined', 'snapshot')).events.length > 0);
});


test('DSH 完成声明沿用实际证据检查；上传无回执或文件没有写入不能显示完成', async t => {
  const { host, workspacePath } = await setup(t);
  for (const [id, response, expected] of [
    ['missing-file', '已创建 missing.docx', 'TARGET_FILE_NOT_FOUND'],
    ['missing-upload', '文章已上传公众号草稿箱', 'NO_UPLOAD_ACTION'],
  ]) {
    const result = await host.agent.run({ runtime: 'dsh', sessionId: id, settings, workspacePath,
      prompt: '检查完成情况', conversation: [{ role: 'user', content: '检查完成情况' }], approvalMode: 'full-access',
      fetchImpl: async () => reply({ role: 'assistant', content: response }) });
    assert.equal(result.status, 'unverified'); assert.equal(result.verification.code, expected);
    assert.match(result.finalText, /系统核验提示/);
  }
  const tool = { type: 'function', function: { name: 'mcp__fixture__upload', description: '隔离上传测试', parameters: { type: 'object', properties: {} } } };
  for (const [id, toolResult, expectedStatus] of [['empty-receipt', { ok: true }, 'unverified'], ['actual-receipt', { media_id: 'receipt_fixture_1234567890' }, 'done']]) {
    let calls = 0;
    const result = await host.agent.run({ runtime: 'dsh', sessionId: id, settings, workspacePath,
      prompt: '检查完成情况', conversation: [{ role: 'user', content: '检查完成情况' }], approvalMode: 'full-access',
      extraTools: [tool], onExtraTool: async () => toolResult,
      fetchImpl: async () => calls++ === 0 ? reply({ role: 'assistant', content: null, tool_calls: [{ id: 'upload-call', type: 'function',
        function: { name: tool.function.name, arguments: '{}' } }] }) : reply({ role: 'assistant', content: '文章已上传公众号草稿箱' }) });
    assert.equal(result.status, expectedStatus, JSON.stringify(result));
    assert.equal(result.executedTools[0].name, tool.function.name); assert.equal(result.executedTools[0].status, 'success');
    if (expectedStatus === 'unverified') assert.equal(result.verification.code, 'NO_UPLOAD_RECEIPT');
  }
});

test('DSH 可按原有编号读取已启用模板，完整要求进入真实后续请求，停用模板不提供', async t => {
  const {host,workspacePath}=await setup(t);
  host.agent.resolvers.readSkills=async()=>[{id:'approved',name:'验收模板',description:'实际检查',instructions:'完整要求：核对生成内容',enabled:true},
    {id:'disabled',name:'停用模板',instructions:'不得读取',enabled:false}];
  const requests=[];let count=0;
  const result=await host.agent.run({runtime:'dsh',sessionId:'skills-one',settings,workspacePath,prompt:'按模板工作',conversation:[{role:'user',content:'按模板工作'}],approvalMode:'full-access',
    fetchImpl:async(_url,options)=>{requests.push(JSON.parse(options.body));return count++===0?reply({role:'assistant',content:null,tool_calls:[{id:'load-template',type:'function',function:{name:'load_skill',arguments:'{"skill_id":"approved"}'}}]}):reply({role:'assistant',content:'检查完成'});}});
  assert.equal(result.status,'done',JSON.stringify(result));
  assert.ok(requests[0].tools.some(tool=>tool.function.name==='load_skill'));
  assert.match(JSON.stringify(requests[0].messages),/验收模板/);assert.doesNotMatch(JSON.stringify(requests[0].messages),/完整要求：核对生成内容|停用模板/);
  assert.match(JSON.stringify(requests[1].messages),/完整要求：核对生成内容/);
  let disabledCalls=0;
  await host.agent.run({runtime:'dsh',sessionId:'skills-disabled',settings,workspacePath,prompt:'检查停用模板',conversation:[{role:'user',content:'检查停用模板'}],approvalMode:'full-access',
    fetchImpl:async(_url,options)=>{const request=JSON.parse(options.body);if(disabledCalls++===0)return reply({role:'assistant',content:null,tool_calls:[{id:'disabled-template',type:'function',function:{name:'load_skill',arguments:'{"skill_id":"disabled"}'}}]});
      assert.match(JSON.stringify(request.messages),/没有找到模板/);assert.doesNotMatch(JSON.stringify(request.messages),/不得读取/);return reply({role:'assistant',content:'模板不可用'});}});
});

test('DSH 实际保存、更新和重新读取工作模板；记忆绑定根会话且落盘后才确认成功', async t => {
  const {host,root,workspacePath}=await setup(t); const events=[]; const sent=[]; let count=0; let id;
  let duplicateAppends=0; host.agent.resolvers.appendSkill=async()=>{duplicateAppends++;};
  const tool=(name,args)=>reply({role:'assistant',content:null,tool_calls:[{id:`native-${count}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  const result=await host.agent.run({runtime:'dsh',sessionId:'native-write',settings,workspacePath,prompt:'保存并更新已验证的做法和当前任务约定',
    conversation:[{role:'user',content:'保存并更新已验证的做法和当前任务约定'}],approvalMode:'full-access',emit:event=>events.push(event),
    fetchImpl:async(_url,options)=>{
      sent.push(JSON.parse(options.body));
      switch(count++) {
        case 0:return tool('save_skill',{name:'DSH 实际保存模板',description:'验收流程',instructions:'步骤一：读回实际文件'});
        case 1: {
          const stored=JSON.parse(await fs.readFile(path.join(root,'skills.json'),'utf8'));
          const records=stored.filter(row=>row.name==='DSH 实际保存模板');assert.equal(records.length,1);id=records[0].id;
          assert.match(JSON.stringify(sent.at(-1).messages),new RegExp(id));
          return tool('update_skill',{skill_id:id,instructions:'步骤一：读回文件；步骤二：核对内容'});
        }
        case 2: {
          const record=(await host.skills.readStored()).find(row=>row.id===id);assert.match(record.instructions,/步骤二/);
          return tool('load_skill',{skill_id:id});
        }
        case 3:assert.match(JSON.stringify(sent.at(-1).messages),/步骤二：核对内容/);return tool('save_memory',{
          category:'当前任务约定',content:'当前任务保留原始材料',kind:'rule',scope:'session',sessionId:'forged',workspacePath:'/forged'});
        default: {
          const memory=JSON.parse(await fs.readFile(path.join(root,'memory.json'),'utf8')).filter(row=>row.content==='当前任务保留原始材料');
          assert.equal(memory.length,1);assert.equal(memory[0].sessionId,'native-write');assert.equal(memory[0].scope,'session');
          return reply({role:'assistant',content:'保存和更新完成'});
        }
      }
    }});
  assert.equal(result.status,'done',JSON.stringify(result)); assert.equal(duplicateAppends,0,'不通过旧事件重复保存');
  assert.equal(events.filter(event=>event.type==='skill-saved'&&event.persisted).length,1);
  assert.equal(events.filter(event=>event.type==='skill-updated'&&event.persisted).length,1);
  assert.equal(events.filter(event=>event.type==='memory-saved'&&event.persisted).length,1);
  assert.equal(await host.memory.sessionPage('other-root'),null);
  assert.match((await host.memory.sessionPage('native-write')).content,/保留原始材料/);
  await host.dshRuntime.close('native-write');
  assert.match((await host.skills.read(workspacePath)).find(row=>row.id===id).instructions,/步骤二/);
});

test('DSH 保存模板沿用人工确认，拒绝与钩子阻止不写入；文件模板不能通过更新工具覆盖', async t => {
  const {host,workspacePath}=await setup(t);let asks=0;
  const run=async(id,name,args,options={})=>{
    let count=0; const requests=[];
    const result=await host.agent.run({runtime:'dsh',sessionId:id,settings,workspacePath,prompt:'检查模板写入边界',conversation:[{role:'user',content:'检查模板写入边界'}],approvalMode:'interactive',
      requestApproval:async()=>{asks++;return false;},...options,fetchImpl:async(_url,init)=>{requests.push(JSON.parse(init.body));return count++===0?reply({role:'assistant',content:null,
        tool_calls:[{id:'guard-write',type:'function',function:{name,arguments:JSON.stringify(args)}}]}):reply({role:'assistant',content:'操作未完成'});}});
    assert.equal(result.status,'done');return requests;
  };
  await run('decline-native','save_skill',{name:'不得保存的模板',description:'检查人工拒绝后不保存',instructions:'不得落盘'});assert.equal(asks,1);
  assert.ok(!(await host.skills.readStored()).some(row=>row.name==='不得保存的模板'));
  host.agent.resolvers.readHooks=async()=>[{event:'before_tool',tool:'save_skill',action:'block'}];
  await run('hook-native','save_skill',{name:'不得保存的模板',description:'检查规则阻止后不保存',instructions:'不得落盘'},{approvalMode:'full-access'});
  assert.equal(asks,1);assert.ok(!(await host.skills.readStored()).some(row=>row.name==='不得保存的模板'));
  host.agent.resolvers.readHooks=async()=>[];
  host.agent.resolvers.readSkills=async()=>[{id:'file-template',name:'文件模板',enabled:true,readOnly:true,path:'/source/SKILL.md',instructions:'原来的执行要求'}];
  const requests=await run('readonly-native','update_skill',{skill_id:'file-template',instructions:'不能覆盖'},{approvalMode:'full-access'});
  assert.match(JSON.stringify(requests.at(-1).messages),/请直接修改对应的 SKILL.md/);
  assert.ok(!(await host.skills.readStored()).some(row=>row.id==='file-template'));
});

test('DSH 正式结束任务保留完整交付内容，持续模式不再多跑；无真实文件时不能宣告目标完成',async t=>{
  const {host,workspacePath}=await setup(t);
  let calls=0;
  const finish=(summary)=>reply({role:'assistant',content:'现在给你完整答案。',tool_calls:[{id:'finish-root',type:'function',
    function:{name:'finish_task',arguments:JSON.stringify({summary,evidence:'核对实际结果',goalAchieved:true})}}]});
  const result=await host.agent.run({runtime:'dsh',sessionId:'finish-root',settings,workspacePath,prompt:'解释检查结论',goal:'完成检查',conversation:[{role:'user',content:'解释检查结论'}],
    loop:{enabled:true,iteration:1,maximum:3},approvalMode:'full-access',fetchImpl:async()=>{calls++;return finish('检查结论：已核对两项输入，均为普通文字。本次没有向外发布。');}});
  assert.equal(result.status,'done');assert.equal(result.goalAchieved,true);assert.ok(result.finish);assert.match(result.finalText,/已核对两项输入/);assert.equal(calls,1);
  const failed=await host.agent.run({runtime:'dsh',sessionId:'finish-missing',settings,workspacePath,prompt:'核对文件',goal:'生成文件',conversation:[{role:'user',content:'核对文件'}],approvalMode:'full-access',
    fetchImpl:async()=>finish('已创建 missing-finish.docx 文件。')});
  assert.equal(failed.status,'unverified');assert.equal(failed.goalAchieved,undefined);assert.equal(failed.finish,undefined);assert.match(failed.reason,/文件/);
});

test('DSH 挂起登记沿用调度器，关闭运行进程，重新打开后到点只续跑一次',async t=>{
  const {host,workspacePath}=await setup(t);
  host.agent.resolvers.hasPendingWakeForSession=id=>host.scheduler.hasPendingForSession(id);
  host.agent.resolvers.registerWake=input=>host.scheduler.registerWake(input);
  await host.sessions.upsert({id:'sleep-root',runtime:'dsh',workspacePath,messages:[]});
  let firstCalls=0;
  const sleeping=await host.agent.run({sessionId:'sleep-root',settings,workspacePath,prompt:'等待后继续核对',conversation:[{role:'user',content:'等待后继续核对'}],approvalMode:'full-access',
    fetchImpl:async()=>{firstCalls++;return reply({role:'assistant',content:'等待约定时间后继续核对。',tool_calls:[{id:'sleep-root',type:'function',function:{name:'sleep_until',arguments:'{"minutes":1,"reason":"等待验收条件"}'}}]});}});
  assert.equal(sleeping.status,'sleeping');assert.equal(firstCalls,1);assert.equal(host.dshRuntime.sessions.has('sleep-root'),false);
  const wakes=await host.scheduler.readWakes();assert.equal(wakes.filter(wake=>wake.status==='pending').length,1);assert.equal(wakes[0].sessionId,'sleep-root');
  assert.equal(wakes[0].workspacePath,workspacePath);assert.equal(wakes[0].approvalMode,'full-access');
  const restored=await host.dshRuntime.request('sleep-root','snapshot');assert.match(JSON.stringify(restored.events),/等待后继续核对/);
  await host.dshRuntime.close('sleep-root');
  let resumed=0;
  host.scheduler.hooks.now=()=>new Date(Date.parse(sleeping.wake.wakeAt)+1);
  host.scheduler.hooks.resumeWake=async wake=>{
    resumed++;
    const result=await host.agent.run({sessionId:wake.sessionId,settings,workspacePath:wake.workspacePath,prompt:'到点继续实际核对',conversation:[{role:'user',content:'到点继续实际核对'}],approvalMode:wake.approvalMode,
      fetchImpl:async(_url,init)=>{assert.match(JSON.stringify(JSON.parse(init.body).messages),/等待后继续核对/);return reply({role:'assistant',content:'已完成本次文字核对。'});}});
    assert.equal(result.status,'done');
  };
  await host.scheduler.checkDueWakes();await host.scheduler.checkDueWakes();assert.equal(resumed,1);
  assert.equal((await host.scheduler.readWakes())[0].status,'fired');
});

test('DSH 挂起拒绝过期时间、超过十二小时与重复等待，均没有新唤醒登记',async t=>{
  const {host,workspacePath}=await setup(t);let registered=0;
  host.agent.resolvers.registerWake=async()=>{registered++;};
  host.agent.resolvers.hasPendingWakeForSession=id=>id==='sleep-duplicate';
  for(const [id,args,reason] of [['sleep-past',{wake_at:'2000-01-01T00:00:00Z',reason:'过去'},/必须晚于当前时间/],
    ['sleep-too-long',{minutes:721,reason:'太久'},/1-720/],['sleep-duplicate',{minutes:1,reason:'重复'},/已经有一个等待中的挂起/]]) {
    let calls=0;
    const result=await host.agent.run({runtime:'dsh',sessionId:id,settings,workspacePath,prompt:'核对等待边界',conversation:[{role:'user',content:'核对等待边界'}],approvalMode:'full-access',
      fetchImpl:async(_url,init)=>{if(calls++===0)return reply({role:'assistant',content:null,tool_calls:[{id:'bad-sleep',type:'function',function:{name:'sleep_until',arguments:JSON.stringify(args)}}]});
        assert.match(JSON.stringify(JSON.parse(init.body).messages),reason);return reply({role:'assistant',content:'没有安排等待。'});}});
    assert.equal(result.status,'done');
  }
  assert.equal(registered,0);
});

test('DSH 图片用官方存储保存并真实读回给模型；文件保持原始字节，重新启动继续同一附件',async t=>{
  const {host,workspacePath}=await setup(t);const sharp=(await import('sharp')).default;
  const image=await sharp({create:{width:3,height:2,channels:3,background:'#126a31'}}).png().toBuffer();
  const file=Buffer.from('附件原始文字\n不能在保存时改写');let calls=0;const sent=[];
  const run=(conversation,prompt)=>host.agent.run({runtime:'dsh',sessionId:'image-file',settings,workspacePath,prompt,conversation,approvalMode:'full-access',
    fetchImpl:async(_url,init)=>{sent.push(JSON.parse(init.body));calls++;return reply({role:'assistant',content:'已收到附件，尚未执行其他操作。'});}});
  const result=await run([{role:'user',content:[{type:'text',text:'核对图片和文件'},
    {type:'image_url',name:'验收图.png',image_url:{url:`data:image/png;base64,${image.toString('base64')}`}},
    {type:'input_file',filename:'材料.txt',file_data:`data:text/plain;base64,${file.toString('base64')}`}]}],'核对图片和文件');
  assert.equal(result.status,'done',JSON.stringify(result));
  const mixed=sent[0].messages.find(message=>message.role==='user'&&Array.isArray(message.content));assert.ok(mixed);
  const imagePart=mixed.content.find(part=>part.type==='image_url');assert.ok(imagePart);
  const actualImage=Buffer.from(imagePart.image_url.url.split(',')[1],'base64');const metadata=await sharp(actualImage).metadata();
  assert.equal(metadata.width,3);assert.equal(metadata.height,2);assert.match(JSON.stringify(mixed.content),/材料.txt/);
  const snapshot=await host.dshRuntime.request('image-file','snapshot');
  const content=snapshot.events.find(event=>event.type==='user/message').data.content;
  assert.deepEqual(content.map(block=>block.type),['text','image','file']);assert.equal(content[1].attachment.name,'验收图.png');
  assert.doesNotMatch(JSON.stringify(snapshot.events),new RegExp(image.toString('base64')),'事件只保存官方附件引用');
  const runtime=host.dshRuntime.sessions.get('image-file').runtime;const chunks=[];
  for await(const chunk of runtime.persistenceContext.attachments.readFileStream(content[2].attachment))chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks),file);
  await host.dshRuntime.close('image-file');await run([{role:'user',content:'重启后继续核对同一图片'}],'重启后继续核对同一图片');
  assert.equal(calls,2);assert.ok(sent[1].messages.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url')));
});

test('DSH 图片错误字节和外部 URL 不当作有效图片，失败后没有接受用户事件',async t=>{
  const {host,workspacePath}=await setup(t);
  for(const [id,url] of [['invalid-image','data:image/png;base64,YWJj'],['remote-image','https://example.com/image.png']]){
    await assert.rejects(host.agent.run({runtime:'dsh',sessionId:id,settings,workspacePath,prompt:'检查图片',conversation:[{role:'user',content:[{type:'image_url',image_url:{url}}]}],approvalMode:'full-access',
      fetchImpl:async()=>{throw new Error('无效图片不能请求模型');}}));
    assert.equal(host.dshRuntime.sessions.has(id),false);
  }
});

test('浏览器上传凭据通过应用真实发送入口进入历史，运行入口重建后仍可读取，其他会话与过期凭据明确拒绝', async t=>{
  const {host,workspacePath}=await setup(t);await host.settings.write({...settings,apiKey:''});
  for (const id of ['browser-prompt','foreign-browser']) await host.sessions.upsert({id,runtime:'dsh',workspacePath,messages:[]});
  await host.dshRuntime.request('browser-prompt','snapshot');
  const viewed=host.dshRuntime.sessions.get('browser-prompt').runtime;
  const stage=path.join(viewed.options.dataDir,'browser-uploads');await fs.mkdir(stage,{recursive:true});
  const bytes=Buffer.from('浏览器普通发送的真实文件内容\n唯一标记 browser-prompt-71e2');
  const staged=path.join(stage,'actual-input.txt');await fs.writeFile(staged,bytes);
  const uploaded=await viewed.request('browser-upload',{file:{filePath:staged,name:'浏览器材料.txt'}});
  assert.equal(uploaded.ok,true);await fs.unlink(staged);
  const attachmentId=uploaded.value.file.attachmentId;let calls=0;
  const run=(sessionId,receiptId)=>host.agent.run({runtime:'dsh',sessionId,settings,workspacePath,prompt:'读取浏览器材料',
    conversation:[{role:'user',content:[{type:'text',text:'读取浏览器材料'},{type:'dsh-file-receipt',receiptId}]}],approvalMode:'full-access',
    fetchImpl:async(_url,init)=>{
      if(calls++===0)return reply({role:'assistant',content:null,tool_calls:[{id:'actual-browser-read',type:'function',function:{name:'read_attachment',arguments:JSON.stringify({attachment_id:attachmentId})}}]});
      assert.match(JSON.stringify(JSON.parse(init.body).messages),/browser-prompt-71e2/);return reply({role:'assistant',content:'已按实际材料核对。'});
    }});
  await assert.rejects(run('foreign-browser',uploaded.value.receiptId),/不存在或属于其他会话/);assert.equal(calls,0);
  const result=await run('browser-prompt',uploaded.value.receiptId);assert.equal(result.status,'done',JSON.stringify(result));assert.equal(calls,2);
  assert.notEqual(host.dshRuntime.sessions.get('browser-prompt').runtime,viewed,'只读入口切换为实际授权任务入口');
  const snapshot=await host.dshRuntime.request('browser-prompt','snapshot');
  const file=snapshot.events.find(event=>event.type==='user/message').data.content.find(part=>part.type==='file').attachment;
  assert.equal(file.name,'浏览器材料.txt');assert.equal(file.attachmentId,attachmentId);
  const chunks=[];for await(const chunk of host.dshRuntime.sessions.get('browser-prompt').runtime.persistenceContext.attachments.readFileStream(file))chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks),bytes);
  await host.dshRuntime.close('browser-prompt');await assert.rejects(run('browser-prompt',uploaded.value.receiptId),/不存在或属于其他会话/);
  assert.equal(calls,2,'过期凭据不能触发模型请求');
});

test('运行中的真实 DSH 接收即时补充和队列，按真实消息编号编辑、移除、提前处理，重复提交只出现一次', async t=>{
  const {host,workspacePath}=await setup(t);await host.sessions.upsert({id:'live-input',runtime:'dsh',workspacePath,messages:[]});
  let release,entered;const firstEntered=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);t.after(()=>release());
  const requests=[];
  const running=host.agent.run({sessionId:'live-input',settings,workspacePath,prompt:'原要求',conversation:[{role:'user',content:'原要求'}],approvalMode:'full-access',
    fetchImpl:async(_url,init)=>{requests.push(JSON.parse(init.body));if(requests.length===1){entered();await gate;}return reply({role:'assistant',content:`真实回答${requests.length}`});}});
  await firstEntered;
  const admit=(requestId,text,mode='queue')=>host.dshRuntime.request('live-input','input-admit',{requestId,mode,content:[{type:'text',text}]});
  const edited=await admit('edit-one','未修改的排队文字'),removed=await admit('remove-one','不应执行的队列文字'),early=await admit('steer-one','提前处理的排队文字');
  const duplicate=await admit('edit-one','重复要求不能改写原内容');assert.equal(duplicate.messageId,edited.messageId);
  let snapshot=await host.dshRuntime.request('live-input','input-snapshot');
  assert.deepEqual(snapshot.inbox['next-turn'].map(message=>message.id),[edited.messageId,removed.messageId,early.messageId]);
  await host.dshRuntime.request('live-input','input-update-queue',{itemId:edited.messageId,action:{kind:'edit',content:[{type:'text',text:'实际编辑后的排队文字'}]}});
  await host.dshRuntime.request('live-input','input-update-queue',{itemId:removed.messageId,action:{kind:'remove'}});
  await host.dshRuntime.request('live-input','input-update-queue',{itemId:early.messageId,action:{kind:'steer'}});
  await admit('direct-steer','直接即时补充','steer');
  snapshot=await host.dshRuntime.request('live-input','input-snapshot');
  assert.equal(snapshot.inbox['next-turn'].length,1);assert.equal(snapshot.inbox['next-step'].length,2);
  await assert.rejects(host.dshRuntime.request('live-input','input-update-queue',{itemId:removed.messageId,action:{kind:'remove'}}),error=>error.code==='session/queue-item-not-found');
  await assert.rejects(host.dshRuntime.request('live-input','input-update-queue',{itemId:edited.messageId,action:{kind:'edit',content:[{type:'image',data:'forged'}]}}),error=>error.code==='gateway/bad-request');
  release();const result=await running;assert.equal(result.status,'done',JSON.stringify(result));assert.equal(requests.length,3);
  assert.deepEqual(result.dshTurns.flatMap(turn=>turn.replies.map(reply=>reply.text)),['真实回答1','真实回答2','真实回答3']);
  assert.equal(result.dshTurns[0].user.text,'原要求');
  assert.equal(result.dshTurns.at(-1).user.id,edited.messageId);
  assert.equal(result.dshTurns.at(-1).user.text,'实际编辑后的排队文字');
  assert.ok(result.dshTurns.every(turn=>!turn.user.text.includes('不应执行')));
  assert.match(JSON.stringify(requests[1].messages),/提前处理的排队文字/);assert.match(JSON.stringify(requests[1].messages),/直接即时补充/);
  assert.doesNotMatch(JSON.stringify(requests[1].messages),/实际编辑后的排队文字/);
  assert.match(JSON.stringify(requests[2].messages),/实际编辑后的排队文字/);assert.doesNotMatch(JSON.stringify(requests),/不应执行的队列文字|重复要求不能改写原内容|未修改的排队文字/);
  const history=await host.dshRuntime.request('live-input','snapshot');
  assert.equal(history.events.filter(event=>event.type==='user/message'&&event.data.source?.rpcId==='edit-one').length,1);
  assert.equal((await host.dshRuntime.request('live-input','input-snapshot')).inbox['next-turn'].length,0);
  await assert.rejects(admit('after-finished','不能借用旧授权'),error=>error.code==='dyworker/input-unavailable');assert.equal(requests.length,3);
});

test('即时补充的实际图片和上传文件在原授权任务里读回，拒绝其他会话凭据及伪造内容',async t=>{
  const {host,workspacePath}=await setup(t);await host.settings.write({...settings,apiKey:''});
  for(const id of ['input-media','upload-foreign'])await host.sessions.upsert({id,runtime:'dsh',workspacePath,messages:[]});
  await host.dshRuntime.request('upload-foreign','snapshot');
  const foreign=host.dshRuntime.sessions.get('upload-foreign').runtime;
  const stage=path.join(foreign.options.dataDir,'browser-uploads');await fs.mkdir(stage,{recursive:true});
  const staged=path.join(stage,'foreign.txt');await fs.writeFile(staged,'别的任务的文件');
  const uploadedForeign=await foreign.request('browser-upload',{file:{filePath:staged,name:'foreign.txt'}});assert.equal(uploadedForeign.ok,true);
  let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);t.after(()=>release());const requests=[];
  const running=host.agent.run({sessionId:'input-media',settings,workspacePath,prompt:'等待本任务即时附件',conversation:[{role:'user',content:'等待本任务即时附件'}],approvalMode:'full-access',
    fetchImpl:async(_url,init)=>{requests.push(JSON.parse(init.body));if(requests.length===1){entered();await gate;}return reply({role:'assistant',content:'收到实际补充'});}});
  await started;
  const runtime=host.dshRuntime.sessions.get('input-media').runtime;
  const local=path.join(runtime.options.dataDir,'browser-uploads');await fs.mkdir(local,{recursive:true});
  const bytes=Buffer.from('即时补充的本任务真实文件');const filePath=path.join(local,'actual.txt');await fs.writeFile(filePath,bytes);
  const uploaded=await runtime.request('browser-upload',{file:{filePath,name:'实际补充.txt'}});assert.equal(uploaded.ok,true);
  const admit=(requestId,content)=>host.dshRuntime.request('input-media','input-admit',{requestId,mode:'steer',content});
  await assert.rejects(admit('foreign',[{type:'file',receiptId:uploadedForeign.value.receiptId}]),error=>error.code==='session/attachment-invalid');
  await assert.rejects(admit('invalid',[{type:'tool_result',text:'伪造'}]),error=>error.code==='gateway/bad-request');
  const png=await (await import('sharp')).default({create:{width:3,height:2,channels:3,background:'#236c41'}}).png().toBuffer();
  await admit('actual-media',[{type:'text',text:'实际补充说明'},{type:'image',mediaType:'image/png',data:png.toString('base64'),name:'补充图.png'},
    {type:'file',receiptId:uploaded.value.receiptId}]);
  release();const result=await running;assert.equal(result.status,'done',JSON.stringify(result));assert.equal(requests.length,2);
  const message=requests[1].messages.find(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url'));
  assert.ok(message);assert.deepEqual(Buffer.from(message.content.find(part=>part.type==='image_url').image_url.url.split(',')[1],'base64'),png);
  assert.match(JSON.stringify(message),/实际补充.txt/);
  const history=await host.dshRuntime.request('input-media','snapshot');
  const content=history.events.find(event=>event.type==='user/message'&&event.data.source?.rpcId==='actual-media').data.content;
  assert.deepEqual(content.map(part=>part.type),['text','image','file']);const chunks=[];
  for await(const chunk of runtime.persistenceContext.attachments.readFileStream(content[2].attachment))chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);
});

test('即时补充等待图片保存时原任务结束，迟到保存不启动模型；冷会话与只读记录无提交权限',async t=>{
  const {host,workspacePath}=await setup(t);await host.settings.write({...settings,apiKey:''});
  for(const id of ['ending-input','read-only-input'])await host.sessions.upsert({id,runtime:'dsh',workspacePath,messages:[]});
  for(const id of ['ending-input','read-only-input'])await assert.rejects(host.dshRuntime.request(id,'input-admit',{requestId:'cold',mode:'steer',content:[{type:'text',text:'不能唤醒'}]}),error=>error.code==='dyworker/input-unavailable');
  assert.equal(host.dshRuntime.sessions.size,0);await host.dshRuntime.request('read-only-input','snapshot');
  await assert.rejects(host.dshRuntime.request('read-only-input','input-cancel'),error=>error.code==='dyworker/input-unavailable');
  let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);t.after(()=>release());let calls=0;
  const running=host.agent.run({sessionId:'ending-input',settings,workspacePath,prompt:'即将完成的任务',conversation:[{role:'user',content:'即将完成的任务'}],approvalMode:'full-access',
    fetchImpl:async()=>{calls++;entered();await gate;return reply({role:'assistant',content:'原任务实际完成'});}});await started;
  const runtime=host.dshRuntime.sessions.get('ending-input').runtime,store=runtime.persistenceContext.attachments;
  let saveEntered,saveRelease;const saving=new Promise(resolve=>saveEntered=resolve),saveGate=new Promise(resolve=>saveRelease=resolve);t.after(()=>saveRelease());
  const actualSave=store.saveImages.bind(store);store.saveImages=async inputs=>{saveEntered();await saveGate;return actualSave(inputs);};
  const png=await (await import('sharp')).default({create:{width:2,height:2,channels:3,background:'#467321'}}).png().toBuffer();
  const pending=host.dshRuntime.request('ending-input','input-admit',{requestId:'late-image',mode:'steer',content:[{type:'image',mediaType:'image/png',data:png.toString('base64')}]});
  const rejected=assert.rejects(pending,error=>error.code==='dyworker/input-unavailable');await saving;release();assert.equal((await running).status,'done');
  saveRelease();await rejected;assert.equal(calls,1);const history=await host.dshRuntime.request('ending-input','snapshot');
  assert.equal(history.events.filter(event=>event.type==='user/message'&&event.data.source?.rpcId==='late-image').length,0);
});

test('公开停止取消真实当前请求并保留待处理队列，下一轮新授权继续执行，旧授权不再可用',async t=>{
  const {host,workspacePath}=await setup(t);await host.sessions.upsert({id:'cancel-input',runtime:'dsh',workspacePath,messages:[]});
  let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);t.after(()=>release());let calls=0;
  const running=host.agent.run({sessionId:'cancel-input',settings,workspacePath,prompt:'原请求',conversation:[{role:'user',content:'原请求'}],approvalMode:'full-access',
    fetchImpl:async(_url,init)=>{calls++;entered();await Promise.race([gate,new Promise((resolve,reject)=>{
      if(init.signal.aborted)reject(init.signal.reason);else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
    })]);return reply({role:'assistant',content:'不应完成原请求'});}});await started;
  const queued=await host.dshRuntime.request('cancel-input','input-admit',{requestId:'kept-queue',mode:'queue',content:[{type:'text',text:'保留到下一轮的排队要求'}]});
  assert.equal((await host.dshRuntime.request('cancel-input','input-cancel')).accepted,true);
  const result=await running;assert.equal(result.status,'cancelled',JSON.stringify(result));assert.equal(calls,1);
  let snapshot=await host.dshRuntime.request('cancel-input','input-snapshot');assert.equal(snapshot.inbox['next-turn'].length,1);assert.equal(snapshot.inbox['next-turn'][0].id,queued.messageId);
  await assert.rejects(host.dshRuntime.request('cancel-input','input-admit',{requestId:'stale',mode:'steer',content:[{type:'text',text:'旧入口不能接收'}]}),error=>error.code==='dyworker/input-unavailable');
  const requests=[];
  const next=await host.agent.run({sessionId:'cancel-input',settings,workspacePath,prompt:'新一轮要求',conversation:[{role:'user',content:'新一轮要求'}],approvalMode:'full-access',
    fetchImpl:async(_url,init)=>{requests.push(JSON.parse(init.body));return reply({role:'assistant',content:'实际下一轮回答'});}});
  assert.equal(next.status,'done',JSON.stringify(next));assert.equal(requests.length,2);
  assert.match(JSON.stringify(requests[0].messages),/保留到下一轮的排队要求/);assert.doesNotMatch(JSON.stringify(requests[0].messages),/新一轮要求/);
  assert.match(JSON.stringify(requests[1].messages),/新一轮要求/);snapshot=await host.dshRuntime.request('cancel-input','input-snapshot');assert.equal(snapshot.inbox['next-turn'].length,0);
});

test('DSH 手动压缩带图片的实际历史，复用本会话附件并保存摘要',async t=>{
  const {host,workspacePath}=await setup(t);await host.settings.write({...settings,apiKey:''});
  const sharp=(await import('sharp')).default;
  const png=await sharp({create:{width:2,height:2,channels:3,background:'#215476'}}).png().toBuffer();
  for(const [index,content] of [[0,[{type:'text',text:'保留这张真实图片及检查背景。'.repeat(700)},
    {type:'image_url',image_url:{url:`data:image/png;base64,${png.toString('base64')}`}}]],[1,'第二轮要保留的独立背景。'.repeat(700)]]){
    const result=await host.agent.run({runtime:'dsh',sessionId:'compact-image',settings,workspacePath,prompt:'核对背景',conversation:[{role:'user',content}],approvalMode:'full-access',
      fetchImpl:async()=>reply({role:'assistant',content:`第${index+1}轮真实回答。`.repeat(700)})});assert.equal(result.status,'done');
  }
  let requests=0;
  const compacted=await host.dshRuntime.request('compact-image','compact',{}, {fetchImpl:async(_url,init)=>{
    requests++;const payload=JSON.parse(init.body);assert.match(JSON.stringify(payload.messages),/保留这张真实图片|第二轮要保留/);
    return reply({role:'assistant',content:'保留图片与两轮核对背景的真实摘要。'});
  }});
  assert.ok(compacted);assert.ok(requests>0);
  const snapshot=await host.dshRuntime.request('compact-image','snapshot');assert.match(JSON.stringify(snapshot.events),/保留图片与两轮核对背景的真实摘要/);
  assert.ok(snapshot.events.some(event=>event.type==='compaction/summary'));
});

test('DSH 实际读取已上传文本与办公附件，重启仍可读取，拒绝跨会话与被改写的文件',async t=>{
  const {host,workspacePath}=await setup(t);
  let created=0;
  const creation=await host.agent.run({runtime:'dsh',sessionId:'make-upload',settings,workspacePath,prompt:'生成实际办公附件',conversation:[{role:'user',content:'生成实际办公附件'}],approvalMode:'full-access',
    fetchImpl:async()=>created++===0?reply({role:'assistant',content:null,tool_calls:[{id:'make-file',type:'function',function:{name:'word_create',arguments:'{"path":"uploaded.docx","paragraphs":["附件中的真实办公文字"]}'}}]}):reply({role:'assistant',content:'文件已创建。'})});
  assert.equal(creation.status,'done');
  const doc=await fs.readFile(path.join(workspacePath,'uploaded.docx'));
  const plain=Buffer.from('此内容来自实际上传的文本附件');
  const files=[{name:'材料.txt',data:plain},{name:'附件.docx',data:doc}];
  const id=data=>`sha256:${createHash('sha256').update(data).digest('hex')}`;
  const run=async(sessionId,conversation,target,expected)=>{
    let calls=0;
    return host.agent.run({runtime:'dsh',sessionId,settings,workspacePath,prompt:'读取附件',conversation,approvalMode:'full-access',
      fetchImpl:async(_url,init)=>{
        const request=JSON.parse(init.body);
        if(calls++===0){assert.ok(request.tools.some(tool=>tool.function.name==='read_attachment'));
          return reply({role:'assistant',content:null,tool_calls:[{id:'read-upload',type:'function',function:{name:'read_attachment',arguments:JSON.stringify({attachment_id:target})}}]});}
        assert.match(JSON.stringify(request.messages),expected);return reply({role:'assistant',content:'已核对附件读取结果。'});
      }});
  };
  for(const file of files){const result=await run('read-files',[{role:'user',content:[{type:'text',text:'读取本次上传的附件'},
      {type:'input_file',filename:file.name,file_data:`data:application/octet-stream;base64,${file.data.toString('base64')}`}]}],id(file.data),
      file===files[0]?/此内容来自实际上传的文本附件/:/附件中的真实办公文字/);assert.equal(result.status,'done',JSON.stringify(result));}
  await host.dshRuntime.close('read-files');
  assert.equal((await run('read-files',[{role:'user',content:'继续读取已上传的文件'}],id(plain),/此内容来自实际上传的文本附件/)).status,'done');
  assert.equal((await run('other-files',[{role:'user',content:'尝试读取另一会话的附件'}],id(plain),/不是本会话已上传的附件/)).status,'done');
  const runtime=host.dshRuntime.sessions.get('read-files').runtime;
  const snapshot=await host.dshRuntime.request('read-files','snapshot');
  const ref=snapshot.events.filter(event=>event.type==='user/message').flatMap(event=>event.data.content).find(block=>block.type==='file'&&block.attachment.name==='材料.txt').attachment;
  const storedFile=runtime.persistenceContext.attachments.fileHostPath(ref);
  await fs.chmod(storedFile,0o600);await fs.writeFile(storedFile,'被改写的内容');
  assert.equal((await run('read-files',[{role:'user',content:'检查文件是否被改写'}],id(plain),/integrity|digest|bytes|mismatch/i)).status,'done');
});

test('可续跑子任务继续、即时补充及停止使用真实父子归属，保留原有提问限制且冷记录不借用旧权限',{timeout:25000},async t=>{
  const {host,workspacePath}=await setup(t);
  await host.sessions.upsert({id:'child-controls',runtime:'dsh',workspacePath,messages:[]});
  let releaseRoot,rootEntered,releaseChild,childEntered;
  const rootGate=new Promise(resolve=>releaseRoot=resolve),rootStarted=new Promise(resolve=>rootEntered=resolve);
  const childGate=new Promise(resolve=>releaseChild=resolve),childStarted=new Promise(resolve=>childEntered=resolve);
  t.after(()=>{releaseRoot();releaseChild();});
  let rootCalls=0,childCalls=0,childAbort=false;const shown=[],childRequests=[];
  const tool=(name,args,id)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
  const running=host.agent.run({sessionId:'child-controls',settings,workspacePath,prompt:'验证所属子任务控制',approvalMode:'full-access',
    requestUserInput:async(request,signal)=>{assert.equal(signal.aborted,false);shown.push(request);return {ok:true,answer:'中文'};},
    fetchImpl:async(_url,init)=>{
      const request=JSON.parse(init.body);
      if(request.messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes('child-control-unique-marker'))){
        childRequests.push(request);const index=childCalls++;
        if(index===0)return reply({role:'assistant',content:null,tool_calls:[tool('ask_user_question',{questions:[{id:'child-language',question:'子任务使用哪种语言？'}]},'child-question')]});
        if(index===1){assert.match(JSON.stringify(request.messages),/human interaction is unavailable/);return reply({role:'assistant',content:'子任务保留未解决问题并返回父任务'});}
        childEntered();init.signal.addEventListener('abort',()=>{childAbort=true;},{once:true});
        await Promise.race([childGate,new Promise((resolve,reject)=>{if(init.signal.aborted)reject(init.signal.reason);else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});})]);
        return reply({role:'assistant',content:'不应越过停止继续运行'});
      }
      if(rootCalls++===0)return reply({role:'assistant',content:null,tool_calls:[tool('subagent',{description:'真实继续子任务',prompt:'child-control-unique-marker'},'spawn-child')]});
      rootEntered();await rootGate;return reply({role:'assistant',content:'所属任务完成'});
    }});
  await rootStarted;
  const until=async(predicate)=>{const deadline=Date.now()+7000;while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('真实子任务没有按预期收尾');};
  const child=await until(async()=>{const family=await host.dshRuntime.request('child-controls','family');const row=Object.values(family.byId).find(row=>row.parentId==='child-controls');return row&&!row.running&&childCalls===2?row:undefined;});
  assert.equal(shown.length,0,'官方服务拒绝被父任务托管的子任务直接向用户提问');
  const address={childSessionId:child.id,parentSessionId:'child-controls',mode:'continuable'};
  let history=await host.dshRuntime.request('child-controls','child-snapshot',{childId:child.id});
  assert.equal(history.control.available,true);assert.equal(history.control.mode,'continuable');assert.equal(history.control.parentSessionId,'child-controls');
  const send=(requestId,text,delivery='queue',extra={})=>host.dshRuntime.request('child-controls','child-prompt',{...address,requestId,delivery,content:[{type:'text',text}],...extra});
  for(const extra of [{parentSessionId:'foreign-parent'},{childSessionId:'foreign-child'},{childSessionId:'child-controls'}])await assert.rejects(send('forged','不能送入', 'queue',extra),error=>error.code==='subagent/unauthorized');
  await assert.rejects(send('invalid-mode','不能送入','queue',{mode:'one-shot'}),error=>error.code==='gateway/bad-request');
  await assert.rejects(send('empty',' '),error=>error.code==='gateway/bad-request');
  const accepted=await send('continue-child','直接继续子任务');assert.equal(typeof accepted.messageId,'string');await childStarted;
  assert.deepEqual(await send('continue-child','直接继续子任务'),accepted,'同一请求编号从实际队列和历史去重');
  const immediate=await send('steer-child','子任务即时补充','steer');assert.equal(typeof immediate.messageId,'string');
  assert.equal((await host.dshRuntime.request('child-controls','child-interrupt',address)).accepted,true);
  await until(async()=>{const family=await host.dshRuntime.request('child-controls','family');return !family.byId[child.id].running;});
  assert.equal(childAbort,true);assert.equal(host.dshRuntime.sessions.get('child-controls').busy,true,'停止子任务不停止根任务');
  history=await host.dshRuntime.request('child-controls','child-snapshot',{childId:child.id});
  assert.equal(history.events.filter(event=>event.type==='user/message'&&event.data.source?.rpcId==='continue-child').length,1);
  assert.match(JSON.stringify(childRequests[2].messages),/直接继续子任务/);
  const before=childCalls;releaseRoot();releaseChild();await running;
  await assert.rejects(send('after-complete','不能借用旧权限'),error=>error.code==='subagent/parent-unavailable');
  history=await host.dshRuntime.request('child-controls','child-snapshot',{childId:child.id});assert.equal(history.control.available,false);
  await host.dshRuntime.close('child-controls');
  history=await host.dshRuntime.request('child-controls','child-snapshot',{childId:child.id});assert.equal(history.control.available,false);
  await assert.rejects(send('cold-child','冷记录不能自行启动'),error=>error.code==='subagent/parent-unavailable');assert.equal(childCalls,before);
});

test('子任务排队和即时补充进入实际后续请求，停止兄弟互不影响，冷子任务仅在父任务新授权后恢复',{timeout:25000},async t=>{
  const {host,workspacePath}=await setup(t);await host.sessions.upsert({id:'child-turns',runtime:'dsh',workspacePath,messages:[]});
  let releaseRoot,releaseOne,releaseTwo,enteredOne,enteredTwo,enteredRoot;
  const rootGate=new Promise(resolve=>releaseRoot=resolve),oneGate=new Promise(resolve=>releaseOne=resolve),twoGate=new Promise(resolve=>releaseTwo=resolve);
  const oneStarted=new Promise(resolve=>enteredOne=resolve),twoStarted=new Promise(resolve=>enteredTwo=resolve),rootStarted=new Promise(resolve=>enteredRoot=resolve);
  t.after(()=>{releaseRoot();releaseOne();releaseTwo();});
  let rootCalls=0,twoAborted=false;const oneRequests=[];
  const tool=(prompt,id)=>({id,type:'function',function:{name:'subagent',arguments:JSON.stringify({description:prompt,prompt})}});
  const pending=host.agent.run({sessionId:'child-turns',settings,workspacePath,prompt:'实际子任务后续要求检查',approvalMode:'full-access',fetchImpl:async(_url,init)=>{
    const request=JSON.parse(init.body);const ownUser=text=>request.messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes(text));
    if(ownUser('child-one-step-marker')){oneRequests.push(request);if(oneRequests.length===1){enteredOne();await oneGate;}return reply({role:'assistant',content:'第一个子任务实际回答'});}
    if(ownUser('child-two-step-marker')){enteredTwo();await Promise.race([twoGate,new Promise((resolve,reject)=>{
      init.signal.addEventListener('abort',()=>{twoAborted=true;reject(init.signal.reason);},{once:true});if(init.signal.aborted){twoAborted=true;reject(init.signal.reason);}
    })]);return reply({role:'assistant',content:'不应越过停止'});}
    if(rootCalls++===0)return reply({role:'assistant',content:null,tool_calls:[tool('child-one-step-marker','one-child'),tool('child-two-step-marker','two-child')]});
    enteredRoot();await rootGate;return reply({role:'assistant',content:'父任务已完成真实子任务检查'});
  }});
  await Promise.all([oneStarted,twoStarted,rootStarted]);
  const family=await host.dshRuntime.request('child-turns','family');const children=Object.values(family.byId).filter(row=>row.parentId==='child-turns');assert.equal(children.length,2);
  const one=children.find(row=>row.displayTitle==='child-one-step-marker'),two=children.find(row=>row.displayTitle==='child-two-step-marker');assert.ok(one);assert.ok(two);
  const address=child=>({parentSessionId:'child-turns',childSessionId:child.id,mode:'continuable'});
  const queue=await host.dshRuntime.request('child-turns','child-prompt',{...address(one),requestId:'child-next-turn',delivery:'queue',content:[{type:'text',text:'子任务排队新要求'}]});
  const steer=await host.dshRuntime.request('child-turns','child-prompt',{...address(one),requestId:'child-next-step',delivery:'steer',content:[{type:'text',text:'子任务当前即时要求'}]});
  releaseOne();
  const until=async(predicate)=>{const deadline=Date.now()+7000;while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('子任务后续请求未完成');};
  await until(async()=>oneRequests.length===3&&!(await host.dshRuntime.request('child-turns','family')).byId[one.id].running);
  assert.match(JSON.stringify(oneRequests[1].messages),/子任务当前即时要求/);assert.doesNotMatch(JSON.stringify(oneRequests[1].messages),/子任务排队新要求/);
  assert.match(JSON.stringify(oneRequests[2].messages),/子任务排队新要求/);
  const history=await host.dshRuntime.request('child-turns','child-snapshot',{childId:one.id});
  for(const [rpcId,messageId]of [['child-next-turn',queue.messageId],['child-next-step',steer.messageId]]){
    const messages=history.events.filter(event=>event.type==='user/message'&&event.data.source?.rpcId===rpcId);assert.equal(messages.length,1);assert.equal(messages[0].data.id,messageId);
  }
  assert.equal((await host.dshRuntime.request('child-turns','child-interrupt',address(one))).accepted,true);
  assert.equal(twoAborted,false,'停止已经闲置的一个子任务不能停止另一个');
  assert.equal((await host.dshRuntime.request('child-turns','child-interrupt',address(two))).accepted,true);
  await until(()=>twoAborted);releaseRoot();releaseTwo();await pending;
  await host.dshRuntime.close('child-turns');
  await assert.rejects(host.dshRuntime.request('child-turns','child-prompt',{...address(one),requestId:'cold-denied',delivery:'queue',content:[{type:'text',text:'旧权限不能继续'}]}),error=>error.code==='subagent/parent-unavailable');
  let nextRootEntered,nextRootRelease,nextChildEntered;const newRootStarted=new Promise(resolve=>nextRootEntered=resolve),newRootGate=new Promise(resolve=>nextRootRelease=resolve),newChildStarted=new Promise(resolve=>nextChildEntered=resolve);t.after(()=>nextRootRelease());
  const renewed=host.agent.run({sessionId:'child-turns',settings,workspacePath,prompt:'新一轮父任务授权',approvalMode:'full-access',fetchImpl:async(_url,init)=>{
    const request=JSON.parse(init.body);
    if(request.messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes('child-one-step-marker'))){assert.match(JSON.stringify(request.messages),/新授权下恢复子任务/);assert.match(JSON.stringify(request.messages),/子任务排队新要求/);nextChildEntered();return reply({role:'assistant',content:'恢复原子任务真实历史后完成'});}
    nextRootEntered();await newRootGate;return reply({role:'assistant',content:'新授权父任务完成'});
  }});await newRootStarted;
  const resumed=await host.dshRuntime.request('child-turns','child-prompt',{...address(one),requestId:'cold-resumed',delivery:'queue',content:[{type:'text',text:'新授权下恢复子任务'}]});assert.equal(typeof resumed.messageId,'string');await newChildStarted;
  nextRootRelease();await renewed;
  const restored=await host.dshRuntime.request('child-turns','child-snapshot',{childId:one.id});assert.equal(restored.header.id,one.id);assert.match(JSON.stringify(restored.events),/恢复原子任务真实历史后完成/);
});

test('实际流式两轮在结束前分别显示，第二轮停止保留片段且不冒充已提交的正式回复',async t=>{
  const {host,workspacePath}=await setup(t);
  await host.sessions.upsert({id:'live-visible',runtime:'dsh',workspacePath,messages:[]});
  const frames=[];let calls=0,finishFirst,secondStarted,cancelled=false;
  const started=new Promise(resolve=>secondStarted=resolve);
  const waitFor=async predicate=>{const end=Date.now()+10000;while(!predicate()){if(Date.now()>end)throw new Error('未收到真实逐轮显示');await new Promise(resolve=>setTimeout(resolve,10));}};
  const running=host.agent.run({sessionId:'live-visible',settings,workspacePath,prompt:'第一轮要求',conversation:[{role:'user',content:'第一轮要求'}],approvalMode:'full-access',isCancelled:()=>cancelled,
    emit:event=>{if(event.type==='dsh-conversation')frames.push(event.turns);},
    fetchImpl:async(_url,init)=>{
      const index=++calls;
      const body=new ReadableStream({start(controller){
        const chunk=(delta,finish_reason=null)=>controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta,finish_reason}]})}\n\n`));
        chunk({role:'assistant',content:index===1?'第一轮实际回复':'第二轮尚未写完'});
        const finish=()=>{chunk({},'stop');controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));controller.close();};
        if(index===1)finishFirst=finish;else secondStarted();
        init.signal.addEventListener('abort',()=>controller.error(init.signal.reason),{once:true});
      }});
      return new Response(body,{headers:{'content-type':'text/event-stream'}});
    }});
  t.after(()=>{finishFirst?.();});
  await waitFor(()=>frames.some(turns=>turns[0]?.replies.some(reply=>reply.partial&&reply.text==='第一轮实际回复')));
  const queued=await host.dshRuntime.request('live-visible','input-admit',{requestId:'live-second',mode:'queue',content:[{type:'text',text:'第二轮要求'}]});
  finishFirst();finishFirst=undefined;await started;
  await waitFor(()=>frames.some(turns=>turns.length===2&&turns[1].replies.some(reply=>reply.partial&&reply.text==='第二轮尚未写完')));
  const beforeStop=frames.at(-1);
  assert.equal(beforeStop[0].replies[0].text,'第一轮实际回复');assert.equal(beforeStop[0].replies[0].partial,undefined);
  assert.equal(beforeStop[1].user.id,queued.messageId);
  // Native stop revokes the application run; a simultaneous public input call is correctly rejected.
  cancelled=true;
  const result=await running;assert.equal(result.status,'cancelled',JSON.stringify(result));assert.equal(calls,2);
  assert.equal(result.dshTurns[0].replies[0].text,'第一轮实际回复');assert.equal(result.dshTurns[1].replies.at(-1).text,'第二轮尚未写完');
  const history=await host.dshRuntime.request('live-visible','snapshot');
  const official=history.events.filter(event=>event.type==='assistant/message').map(event=>event.data.message.id);
  assert.ok(official.includes(result.dshTurns[0].replies[0].id));assert.equal(official.includes(result.dshTurns[1].replies.at(-1).id),!result.dshTurns[1].replies.at(-1).partial);
  const count=frames.length;await new Promise(resolve=>setTimeout(resolve,50));assert.equal(frames.length,count);
});

test('实际第二轮达到回复限制时仍返回两轮完整记录，未执行的队列不会变成已回答记录',async t=>{
  const {host,workspacePath}=await setup(t);await host.sessions.upsert({id:'visible-limit',runtime:'dsh',workspacePath,messages:[]});
  let entered,release,calls=0;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);t.after(()=>release());
  const running=host.agent.run({sessionId:'visible-limit',settings,workspacePath,prompt:'原始要求',conversation:[{role:'user',content:'原始要求'}],approvalMode:'full-access',fetchImpl:async()=>{
    if(++calls===1){entered();await gate;return reply({role:'assistant',content:'首轮已回答'});}
    return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'第二轮受长度限制的回复'},finish_reason:'length'}]}),{headers:{'content-type':'application/json'}});
  }});
  await started;await host.dshRuntime.request('visible-limit','input-admit',{requestId:'limit-second',mode:'queue',content:[{type:'text',text:'补充要求'}]});release();
  const result=await running;assert.equal(result.status,'paused',JSON.stringify(result));assert.equal(calls,2);
  assert.deepEqual(result.dshTurns.map(turn=>turn.replies.map(reply=>reply.text)),[['首轮已回答'],['第二轮受长度限制的回复']]);
  assert.match(result.reason,/长度限制/);
});


test('子任务接收真实图片和文件，重复提交只接收一次，根任务和兄弟不能读取专属附件', {timeout:25000}, async t => {
  const {host,workspacePath}=await setup(t);
  for(const id of ['child-media','child-media-foreign']) await host.sessions.upsert({id,runtime:'dsh',workspacePath,messages:[]});
  const upload=async(id,name,text)=>{
    await host.dshRuntime.request(id,'snapshot');const runtime=host.dshRuntime.sessions.get(id).runtime;
    const dir=path.join(runtime.options.dataDir,'browser-uploads');await fs.mkdir(dir,{recursive:true});
    const filePath=path.join(dir,name);await fs.writeFile(filePath,text);
    const result=await runtime.request('browser-upload',{file:{filePath,name}});assert.equal(result.ok,true);return result.value;
  };
  const foreign=await upload('child-media-foreign','foreign.txt','其他根任务的私有文件');
  let releaseRoot,rootEntered;const gate=new Promise(resolve=>releaseRoot=resolve),started=new Promise(resolve=>rootEntered=resolve);t.after(()=>releaseRoot());
  let ownFile,rootCalls=0;const childCalls=new Map(),requests=[];
  const tool=(name,args,id)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
  const running=host.agent.run({sessionId:'child-media',settings,workspacePath,prompt:'子任务附件范围检查',approvalMode:'full-access',fetchImpl:async(_url,init)=>{
    const request=JSON.parse(init.body);requests.push(request);
    const child=['child-media-one-marker','child-media-two-marker'].find(marker=>request.messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes(marker)));
    if(child){
      const count=childCalls.get(child)||0;childCalls.set(child,count+1);
      if(count===0)return reply({role:'assistant',content:'子任务首次完成'});
      if(count===1){
        if(child==='child-media-one-marker') {
          assert.match(JSON.stringify(request.messages),/子任务附件要求/);
          assert.ok(request.messages.some(row=>Array.isArray(row.content)&&row.content.some(part=>part.type==='image_url'&&part.image_url.url===imageUrl)),'真实图片字节进入子任务模型请求');
        }
        return reply({role:'assistant',content:null,tool_calls:[tool('read_attachment',{attachment_id:ownFile.file.attachmentId},child+'-read')]});
      }
      const output=request.messages.filter(row=>row.role==='tool').at(-1).content;
      if(child==='child-media-one-marker')assert.match(output,/只能给第一个子任务读取的实际文字/);
      else {assert.match(output,/不是本会话已上传的附件/);assert.doesNotMatch(output,/只能给第一个子任务读取的实际文字/);}
      return reply({role:'assistant',content:'子任务附件检查完成'});
    }
    if(rootCalls++===0)return reply({role:'assistant',content:null,tool_calls:[
      tool('subagent',{description:'child-media-one-marker',prompt:'child-media-one-marker'},'media-one'),
      tool('subagent',{description:'child-media-two-marker',prompt:'child-media-two-marker'},'media-two')]});
    if(rootCalls===2){rootEntered();await gate;return reply({role:'assistant',content:null,tool_calls:[tool('read_attachment',{attachment_id:ownFile.file.attachmentId},'root-file-probe')]});}
    assert.match(request.messages.filter(row=>row.role==='tool').at(-1).content,/不是本会话已上传的附件/);
    return reply({role:'assistant',content:'父任务检查完成'});
  }});
  await started;
  const children=Object.values((await host.dshRuntime.request('child-media','family')).byId).filter(row=>row.parentId==='child-media');assert.equal(children.length,2);
  const one=children.find(row=>row.displayTitle==='child-media-one-marker'),two=children.find(row=>row.displayTitle==='child-media-two-marker');
  const send=(child,requestId,content)=>host.dshRuntime.request('child-media','child-prompt',{parentSessionId:'child-media',childSessionId:child.id,mode:'continuable',delivery:'queue',requestId,content});
  ownFile=await upload('child-media','child-only.txt','只能给第一个子任务读取的实际文字');
  const png=await (await import('sharp')).default({create:{width:3,height:2,channels:3,background:'#ab7318'}}).png().toBuffer();
  const imageUrl='data:image/png;base64,'+png.toString('base64');
  await assert.rejects(send(one,'foreign-file',[{type:'file',receiptId:foreign.receiptId}]),error=>error.code==='subagent/attachment-invalid');
  await assert.rejects(send(one,'forged-file',[{type:'file',attachment:ownFile.file}]),error=>error.code==='gateway/bad-request');
  await assert.rejects(send(one,'invalid-image',[{type:'file',receiptId:ownFile.receiptId},{type:'image',mediaType:'image/png',data:'bm90IGFuIGltYWdl'}]),/Unsupported or malformed image data/);
  const content=[{type:'text',text:'子任务附件要求'},{type:'image',mediaType:'image/png',data:png.toString('base64'),name:'child.png'},{type:'file',receiptId:ownFile.receiptId}];
  const accepted=await send(one,'child-real-media',content);
  assert.deepEqual(await send(one,'child-real-media',content),accepted,'重复请求在文件凭据释放后仍返回原确认');
  const until=async predicate=>{const end=Date.now()+7000;while(!await predicate()){if(Date.now()>end)assert.fail('真实子任务没有完成');await new Promise(resolve=>setTimeout(resolve,20));}};
  await until(async()=>childCalls.get('child-media-one-marker')===3&&!(await host.dshRuntime.request('child-media','family')).byId[one.id].running);
  await assert.rejects(send(two,'borrow-receipt',[{type:'file',receiptId:ownFile.receiptId}]),error=>error.code==='subagent/attachment-invalid');
  await send(two,'sibling-probe',[{type:'text',text:'尝试读取另一个子任务的文件'}]);
  await until(async()=>childCalls.get('child-media-two-marker')===3&&!(await host.dshRuntime.request('child-media','family')).byId[two.id].running);
  releaseRoot();assert.equal((await running).status,'done');
  await host.dshRuntime.close('child-media');
  const restored=await host.dshRuntime.request('child-media','child-snapshot',{childId:one.id});
  const messages=restored.events.filter(event=>event.type==='user/message'&&event.data.source?.rpcId==='child-real-media');assert.equal(messages.length,1);
  assert.equal(messages[0].data.id,accepted.messageId);assert.equal(messages[0].data.content.find(part=>part.type==='file').attachment.attachmentId,ownFile.file.attachmentId);
  assert.ok(messages[0].data.content.some(part=>part.type==='image'));assert.match(JSON.stringify(restored.events),/只能给第一个子任务读取的实际文字/);
  await assert.rejects(send(one,'late-media',content),error=>error.code==='subagent/parent-unavailable');
});


test('子任务附件准备期间父任务结束，迟到图片不能触发子任务续跑', {timeout:20000}, async t => {
  const {host,workspacePath}=await setup(t);await host.sessions.upsert({id:'child-media-late',runtime:'dsh',workspacePath,messages:[]});
  let releaseRoot,rootEntered,releaseImage,imageEntered;
  const gate=new Promise(resolve=>releaseRoot=resolve),started=new Promise(resolve=>rootEntered=resolve),imageGate=new Promise(resolve=>releaseImage=resolve),imageStarted=new Promise(resolve=>imageEntered=resolve);
  t.after(()=>{releaseRoot();releaseImage();});let rootCalls=0,childCalls=0;
  const running=host.agent.run({sessionId:'child-media-late',settings,workspacePath,prompt:'等待子任务',approvalMode:'full-access',fetchImpl:async(_url,init)=>{
    const request=JSON.parse(init.body);
    if(request.messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes('child-late-image-marker'))){childCalls++;return reply({role:'assistant',content:'子任务已完成'});}
    if(rootCalls++===0)return reply({role:'assistant',content:null,tool_calls:[{id:'late-child',type:'function',function:{name:'subagent',arguments:JSON.stringify({description:'child-late-image-marker',prompt:'child-late-image-marker'})}}]});
    rootEntered();await gate;return reply({role:'assistant',content:'父任务已结束'});
  }});await started;
  const family=await host.dshRuntime.request('child-media-late','family'),child=Object.values(family.byId).find(row=>row.parentId==='child-media-late');
  const runtime=host.dshRuntime.sessions.get('child-media-late').runtime,store=runtime.persistenceContext.attachments;
  const original=store.saveImages.bind(store);store.saveImages=async inputs=>{imageEntered();await imageGate;return original(inputs);};
  const png=await (await import('sharp')).default({create:{width:2,height:2,channels:3,background:'#741ba8'}}).png().toBuffer();
  const pending=host.dshRuntime.request('child-media-late','child-prompt',{parentSessionId:'child-media-late',childSessionId:child.id,mode:'continuable',delivery:'queue',requestId:'late-image',content:[{type:'image',mediaType:'image/png',data:png.toString('base64')}]});
  const rejected=assert.rejects(pending,/结束|取消|cancel|unavailable/i);
  await imageStarted;releaseRoot();assert.equal((await running).status,'done');releaseImage();await rejected;
  store.saveImages=original;
  const snapshot=await host.dshRuntime.request('child-media-late','child-snapshot',{childId:child.id});
  assert.equal(childCalls,1);assert.equal(snapshot.events.some(event=>event.type==='user/message'&&event.data.source?.rpcId==='late-image'),false);
});

test('运行中追加的根任务文件可由实际读取工具读回', async t => {
  const {host,workspacePath}=await setup(t);await host.sessions.upsert({id:'live-file-read',runtime:'dsh',workspacePath,messages:[]});
  let entered,release,file,calls=0;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);t.after(()=>release());
  const running=host.agent.run({sessionId:'live-file-read',settings,workspacePath,prompt:'等待追加材料',approvalMode:'full-access',fetchImpl:async(_url,init)=>{
    const request=JSON.parse(init.body);calls++;
    if(calls===1){entered();await gate;return reply({role:'assistant',content:'第一轮完成'});}
    if(calls===2)return reply({role:'assistant',content:null,tool_calls:[{id:'live-file-tool',type:'function',function:{name:'read_attachment',arguments:JSON.stringify({attachment_id:file.attachmentId})}}]});
    assert.match(request.messages.filter(row=>row.role==='tool').at(-1).content,/实际追加后仍然可读取/);return reply({role:'assistant',content:'读回追加材料'});
  }});await started;
  const runtime=host.dshRuntime.sessions.get('live-file-read').runtime,dir=path.join(runtime.options.dataDir,'browser-uploads');await fs.mkdir(dir,{recursive:true});
  const filePath=path.join(dir,'later.txt');await fs.writeFile(filePath,'实际追加后仍然可读取');
  const uploaded=await runtime.request('browser-upload',{file:{filePath,name:'later.txt'}});assert.equal(uploaded.ok,true);file=uploaded.value.file;
  await host.dshRuntime.request('live-file-read','input-admit',{requestId:'later-file',mode:'queue',content:[{type:'file',receiptId:uploaded.value.receiptId}]});
  release();const result=await running;assert.equal(result.status,'done');assert.equal(calls,3);const history=await host.dshRuntime.request('live-file-read','snapshot');assert.equal(history.events.find(event=>event.type==='user/message'&&event.data.source?.rpcId==='later-file').data.content[0].attachment.attachmentId,file.attachmentId);
});

test('原生选择与浏览器上传合并后经实际任务入口读取两个文件及图片，正式历史保留全部内容',async t=>{
  const {host,workspacePath}=await setup(t);await host.settings.write({...settings,apiKey:''});
  await host.sessions.upsert({id:'mixed-input-real',runtime:'dsh',workspacePath,messages:[]});
  const {ClientPluginHost}=await import('../src/pluginRuntime/clientHost.ts');
  let calls=0,consumed=0,nativeFile,publicFile;const wire=[];
  const png=await (await import('sharp')).default({create:{width:3,height:2,channels:3,background:'#94723e'}}).png().toBuffer();
  const imageUrl='data:image/png;base64,'+png.toString('base64');
  const client=new ClientPluginHost({sessionProvider:id=>id==='mixed-input-real'?{id,runtime:'dsh'}:undefined,onInputSubmit:async input=>{
    wire.push(input);const parts=[{type:'text',text:input.text},...input.attachments.map(part=>part.type==='file'
      ?{type:'dsh-file-receipt',receiptId:part.receiptId}:{type:'image_url',image_url:{url:`data:${part.mediaType};base64,${part.data}`}})];
    const result=await host.agent.run({runtime:'dsh',sessionId:input.sessionId,settings,workspacePath,prompt:input.text,conversation:[{role:'user',content:parts}],approvalMode:'full-access',signal:input.signal,fetchImpl:async(_url,init)=>{
      const request=JSON.parse(init.body);calls++;
      if(calls===1){
        assert.ok(request.messages.some(row=>Array.isArray(row.content)&&row.content.some(part=>part.type==='image_url'&&part.image_url.url===imageUrl)));
        assert.match(JSON.stringify(request.messages),/native-selection.txt/);assert.match(JSON.stringify(request.messages),/browser-selection.txt/);
        return reply({role:'assistant',content:null,tool_calls:[nativeFile,publicFile].map((file,index)=>({id:`mixed-file-${index}`,type:'function',function:{name:'read_attachment',arguments:JSON.stringify({attachment_id:file.attachmentId})}}))});
      }
      assert.match(JSON.stringify(request.messages),/原生选择的实际文字/);assert.match(JSON.stringify(request.messages),/浏览器上传的实际文字/);return reply({role:'assistant',content:'两个文件和图片已读回'});
    }});assert.equal(result.status,'done',JSON.stringify(result));return {kind:'success'};
  }});t.after(()=>client.dispose());
  client.ctx.get('fileUpload').upload=async(id,file,name,signal)=>{
    await host.dshRuntime.request(id,'snapshot');const runtime=host.dshRuntime.sessions.get(id).runtime;
    const stage=path.join(runtime.options.dataDir,'browser-uploads');await fs.mkdir(stage,{recursive:true});const filePath=path.join(stage,'mixed-browser.txt');await fs.writeFile(filePath,Buffer.from(await file.arrayBuffer()));
    const result=await runtime.request('browser-upload',{file:{filePath,name}},{signal});assert.equal(result.ok,true);publicFile=result.value.file;return result;
  };
  const nativePath=path.join(workspacePath,'native-selection.txt');await fs.writeFile(nativePath,'原生选择的实际文字');
  const imagePath=path.join(workspacePath,'native.png');await fs.writeFile(imagePath,png);
  client.setNativeAttachmentProvider(id=>id==='mixed-input-real'?{count:2,names:['native-selection.txt','native.png'],current:()=>true,serialize:async signal=>{
    signal.throwIfAborted();const parts=await host.dshRuntime.commandAttachments(id,async()=>({files:[
      {filePath:nativePath,name:'native-selection.txt',image:false},{filePath:imagePath,name:'native.png',image:true,mediaType:'image/png'}],dispose:async()=>{}}));
    nativeFile=(await host.dshRuntime.request(id,'resolve-file-receipts',{ids:[parts[0].receiptId]}))[0];signal.throwIfAborted();return parts;
  },consume:()=>consumed++}:undefined);
  const input=client.ctx.conversation.input.for(client.ctx.sessions.scope('mixed-input-real'));
  const row=client.conversation.createDrafts('mixed-input-real',[new File(['浏览器上传的实际文字'],'browser-selection.txt',{type:'text/plain'})])[0];input.addAttachments([row.id]);
  const until=async predicate=>{const end=Date.now()+10000;while(!predicate()){if(Date.now()>end)assert.fail('混合输入未完成');await new Promise(resolve=>setTimeout(resolve,10));}};
  await until(()=>client.conversation.fileUploads.getSnapshot()[row.id]?.status==='ready');input.setDraft('一起读取两类附件');input.submit();
  await until(()=>consumed===1||input.notices.getSnapshot()?.level==='error');assert.equal(input.notices.getSnapshot()?.level==='error',false,input.notices.getSnapshot()?.text);
  assert.equal(consumed,1);assert.equal(wire.length,1);assert.equal(wire[0].attachments.length,3);assert.deepEqual(wire[0].attachmentNames,['browser-selection.txt','native-selection.txt','native.png']);assert.equal(calls,2);assert.equal(input.state.getSnapshot().attachmentIds.length,0);
  await host.dshRuntime.close('mixed-input-real');const history=await host.dshRuntime.request('mixed-input-real','snapshot');
  const message=history.events.find(event=>event.type==='user/message'&&event.data.source?.kind==='user');
  assert.deepEqual(message.data.content.map(part=>part.type),['text','file','file','image']);
  assert.deepEqual(message.data.content.filter(part=>part.type==='file').map(part=>part.attachment.attachmentId),[publicFile.attachmentId,nativeFile.attachmentId]);
});

test('冷父任务直接继续原子任务，使用新模型并保留图片文件；先确认接收、按实际历史去重且不添加父任务要求',{timeout:25000},async t=>{
  const {host,workspacePath}=await setup(t);const rootId='cold-child-entry';
  await host.sessions.upsert({id:rootId,runtime:'dsh',workspacePath,messages:[]});
  let seedCalls=0;
  await host.agent.run({sessionId:rootId,settings,workspacePath,prompt:'建立可恢复目录',approvalMode:'full-access',fetchImpl:async(_url,init)=>{
    const request=JSON.parse(init.body);
    if(request.messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes('cold-child-marker')))return reply({role:'assistant',content:'原子任务已完成第一轮'});
    return seedCalls++===0?reply({role:'assistant',content:null,tool_calls:[{id:'spawn-cold',type:'function',function:{name:'subagent',arguments:JSON.stringify({description:'原子任务',prompt:'cold-child-marker'})}}]}):reply({role:'assistant',content:'父任务第一轮完成'});
  }});
  const family=await host.dshRuntime.request(rootId,'family');const child=Object.values(family.byId).find(row=>row.parentId===rootId);
  assert.ok(child);await host.dshRuntime.close(rootId);
  const before=await host.dshRuntime.request(rootId,'snapshot');
  const png=await (await import('sharp')).default({create:{width:3,height:2,channels:3,background:'#174a82'}}).png().toBuffer();
  const filePath=path.join(workspacePath,'cold-real.txt');await fs.writeFile(filePath,'冷启动子任务附件实际内容');
  const upload=await host.dshRuntime.commandAttachments(rootId,async()=>({files:[{filePath,name:'cold-real.txt'}],dispose:async()=>{}}));
  let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);t.after(()=>release());
  const requests=[],envelopes=[],activeAgents=new Map();let drained=0,finished;
  const done=new Promise(resolve=>finished=resolve);let calls=0;
  const fetchImpl=async(_url,init)=>{
    const request=JSON.parse(init.body);requests.push(request);assert.equal(request.model,'new-selected');
    if(request.messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes('cold-direct-new-marker'))){
      const last=request.messages.find(row=>row.role==='user'&&JSON.stringify(row.content).includes('cold-direct-new-marker'));assert.match(JSON.stringify(last),/cold-real.txt/);
      const image=last.content.find(part=>part.type==='image_url');const actual=await (await import('sharp')).default(Buffer.from(image.image_url.url.split(',')[1],'base64')).raw().toBuffer();assert.deepEqual(actual,await (await import('sharp')).default(png).raw().toBuffer());
      if(calls++===0){entered();await gate;const fileId=originalFile.attachmentId;return reply({role:'assistant',content:null,tool_calls:[{id:'read-cold',type:'function',function:{name:'read_attachment',arguments:JSON.stringify({attachment_id:fileId})}}]});}
      assert.match(JSON.stringify(request.messages),/冷启动子任务附件实际内容/);return reply({role:'assistant',content:'原子任务第二轮已完成'});
    }
    return reply({role:'assistant',content:'父任务收到子任务完成通知'});
  };
  const start=createChildEntry({sessions:host.sessions,agent:{run:options=>host.agent.run({...options,fetchImpl})},
    readSettings:async()=>({...settings,model:'new-selected',approvalMode:'full-access'}),isShuttingDown:()=>false,
    isSessionBusy:id=>activeAgents.has(id),activeAgents,queueCount:()=>0,drainSessionQueue:()=>{drained++;finished();},emit:(_sender,envelope)=>envelopes.push(envelope)});
  const [originalFile]=await host.dshRuntime.request(rootId,'resolve-file-receipts',{ids:[upload[0].receiptId]});
  const prompt={parentSessionId:rootId,childSessionId:child.id,mode:'continuable',requestId:'cold-direct-rpc',delivery:'queue',content:[{type:'text',text:'cold-direct-new-marker'},...upload,{type:'image',mediaType:'image/png',data:png.toString('base64')}]};
  const accepted=await start({payload:{sessionId:rootId,runId:'cold-run',prompt}});assert.equal(accepted.ok,true,JSON.stringify(accepted));await Promise.race([started,done.then(async()=>{throw new Error('子任务未进入实际模型请求：'+JSON.stringify(envelopes.find(item=>item.event.type==='agent-finished')));})]);
  assert.equal(activeAgents.get(rootId).runId,'cold-run');assert.equal(drained,0,'接收先于执行收尾');
  assert.equal((await start({payload:{sessionId:rootId,runId:'collision',prompt}})).ok,false);
  release();await done;assert.equal(activeAgents.size,0);
  const finish=envelopes.find(item=>item.event.type==='agent-finished');assert.equal(finish.event.result.status,'done',JSON.stringify(finish));
  assert.ok(envelopes.every(item=>item.childRun&&item.runId==='cold-run'));
  const after=await host.dshRuntime.request(rootId,'snapshot');
  assert.deepEqual(after.events.filter(event=>event.type==='user/message'&&event.data.source?.kind==='user'),before.events.filter(event=>event.type==='user/message'&&event.data.source?.kind==='user'));
  const history=await host.dshRuntime.request(rootId,'child-snapshot',{childId:child.id});
  assert.equal(history.header.id,child.id);assert.match(JSON.stringify(history.events),/原子任务已完成第一轮/);assert.match(JSON.stringify(history.events),/原子任务第二轮已完成/);
  assert.equal(history.events.filter(event=>event.type==='user/message'&&event.data.source?.rpcId==='cold-direct-rpc').length,1);
  assert.equal(history.control.available,false);const count=requests.length;await host.dshRuntime.close(rootId);
  const repeated=await start({payload:{sessionId:rootId,runId:'repeat-run',prompt}});assert.equal(repeated.ok,true,JSON.stringify(repeated));assert.deepEqual(repeated.value,accepted.value);
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(requests.length,count,'已持久接收的编号不再运行模型，也不再需要已退休上传凭据');
});

test('冷子任务新执行使用当前禁止修改设置，拒绝异会话地址；停止须命中实际运行编号',{timeout:25000},async t=>{
  const {host,workspacePath}=await setup(t);const rootId='cold-permission';await host.sessions.upsert({id:rootId,runtime:'dsh',workspacePath,messages:[]});
  let seed=0;
  await host.agent.run({sessionId:rootId,settings,workspacePath,prompt:'准备原子任务',approvalMode:'full-access',fetchImpl:async(_url,init)=>{
    if(JSON.parse(init.body).messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes('permission-child-marker')))return reply({role:'assistant',content:'原子项完成'});
    return seed++===0?reply({role:'assistant',content:null,tool_calls:[{id:'spawn-permission',type:'function',function:{name:'subagent',arguments:JSON.stringify({description:'权限核对',prompt:'permission-child-marker'})}}]}):reply({role:'assistant',content:'准备完成'});
  }});
  const child=Object.values((await host.dshRuntime.request(rootId,'family')).byId).find(row=>row.parentId===rootId);await host.dshRuntime.close(rootId);
  const activeAgents=new Map(),handlers=new Map(),events=[];let finished,entered;let done=new Promise(resolve=>finished=resolve);const started=new Promise(resolve=>entered=resolve);
  let calls=0,hold=false,aborted=false;
  const fetchImpl=async(_url,init)=>{
    const request=JSON.parse(init.body);if(!request.messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes('new-permission-marker')))return reply({role:'assistant',content:'父任务确认通知'});
    if(hold){entered();await new Promise((resolve,reject)=>{const abort=()=>{aborted=true;reject(init.signal.reason);};init.signal.addEventListener('abort',abort,{once:true});if(init.signal.aborted)abort();});}
    if(calls++===0)return reply({role:'assistant',content:null,tool_calls:[{id:'cold-write',type:'function',function:{name:'word_create',arguments:JSON.stringify({path:'must-not-write.docx',paragraphs:['不能写入']})}}]});
    assert.match(JSON.stringify(request.messages),/禁止|denied|不允许/);return reply({role:'assistant',content:'当前设置禁止写入，未修改文件'});
  };
  const start=createChildEntry({sessions:host.sessions,agent:{run:options=>host.agent.run({...options,fetchImpl})},readSettings:async()=>({...settings,approvalMode:'deny-changes'}),isShuttingDown:()=>false,
    isSessionBusy:id=>activeAgents.has(id),activeAgents,queueCount:()=>0,drainSessionQueue:()=>finished(),emit:(_sender,event)=>events.push(event)});
  const address={childSessionId:child.id,parentSessionId:rootId,mode:'continuable',delivery:'queue',requestId:'permission-rpc',content:[{type:'text',text:'new-permission-marker'}]};
  const bad=await start({payload:{sessionId:rootId,runId:'bad-run',prompt:{...address,parentSessionId:'foreign-parent'}}});assert.equal(bad.ok,false);await done;
  done=new Promise(resolve=>finished=resolve);const accepted=await start({payload:{sessionId:rootId,runId:'deny-run',prompt:address}});assert.equal(accepted.ok,true,JSON.stringify(accepted));await done;
  await assert.rejects(fs.stat(path.join(workspacePath,'must-not-write.docx')),error=>error.code==='ENOENT');
  assert.ok(events.some(item=>item.event.type==='activity-update'&&item.event.status==='error'));
  done=new Promise(resolve=>finished=resolve);hold=true;
  const stopping=await start({payload:{sessionId:rootId,runId:'stop-run',prompt:{...address,requestId:'stop-rpc',content:[{type:'text',text:'new-permission-marker 停止核对'}]}}});
  assert.equal(stopping.ok,true,JSON.stringify(stopping));await started;
  agentIpcPlugin({trustedHandle:(name,handler)=>handlers.set(name,handler),activeAgents,isTrustedRendererUrl:url=>url!=='untrusted',isShuttingDown:()=>false,
    isSessionBusy:id=>activeAgents.has(id),sessionQueue:{},executeChildRun:start}).apply({scheduler:{cancelForSession:async()=>{}}});
  assert.deepEqual(await handlers.get('agent:cancel')({}, {sessionId:rootId,runId:'wrong-run'}),{ok:false});assert.equal(aborted,false);
  assert.deepEqual(await handlers.get('agent:cancel')({}, {sessionId:rootId,runId:'stop-run'}),{ok:true});await done;assert.equal(aborted,true);assert.equal(activeAgents.size,0);
  const denied=await handlers.get('agent:continue-child')({senderFrame:{url:'untrusted'}},{sessionId:rootId,runId:'unauthorized',prompt:address});
  assert.equal(denied.ok,false);
});

test('冷目录中的多层子任务仅恢复精确父链，保持原归属和限制；无关兄弟不接收新要求',{timeout:25000},async t=>{
  const {host,workspacePath,root}=await setup(t);const rootId='cold-nested';await host.sessions.upsert({id:rootId,runtime:'dsh',workspacePath,messages:[]});
  // 使用真实官方委派接口建立两层目录；样例工具明确授权两层，不改变应用默认深度。
  const fixture=path.join(host.plugins.dir,'node_modules/dsh-nested-entry-fixture');await fs.mkdir(fixture);
  await fs.writeFile(path.join(fixture,'package.json'),JSON.stringify({name:'dsh-nested-entry-fixture',version:'1.0.0',type:'module',main:'index.mjs',dsh:{host:'index.mjs'}}));
  await fs.writeFile(path.join(fixture,'index.mjs'),`export const name='dsh-nested-entry-fixture';export const inject=['tools','subagents'];export function apply(ctx){ctx.tools.register({name:'nested_delegate',description:'两层真实委派验收',parameters:{type:'object',properties:{prompt:{type:'string'}},required:['prompt']},execute:async(args,exec)=>{const receipt=await ctx.subagents.startContinuable({provider:'spawn',label:args.prompt,request:{parent:exec.agent,prompt:[{type:'text',text:args.prompt}],maxDepth:2,toolFilter:{deny:['word_create']}},signal:exec.signal});return 'started '+receipt.childId;},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]}});}`);
  const installed=await host.plugins.install({spec:'dsh-nested-entry-fixture'});assert.equal(installed.ok,true,installed.error);

  const counts=new Map();const tool=(id,prompt)=>({id,type:'function',function:{name:'nested_delegate',arguments:JSON.stringify({prompt})}});
  const seed=async(_url,init)=>{
    const request=JSON.parse(init.body);const own=request.messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes('nested-grandchild-marker'))?'grandchild':request.messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes('nested-parent-marker'))?'parent':request.messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes('nested-sibling-marker'))?'sibling':'root';
    const count=counts.get(own)||0;counts.set(own,count+1);
    if(own==='root'&&count===0)return reply({role:'assistant',content:null,tool_calls:[tool('nested-parent','nested-parent-marker'),tool('nested-sibling','nested-sibling-marker')]});
    if(own==='parent'&&count===0)return reply({role:'assistant',content:null,tool_calls:[tool('nested-grandchild','nested-grandchild-marker')]});
    return reply({role:'assistant',content:own+' 原轮次完成'});
  };
  const initial=await host.agent.run({sessionId:rootId,settings,workspacePath,prompt:'建立两层真实子任务',approvalMode:'full-access',fetchImpl:seed}).catch(error=>{throw new Error('建立目录：'+error.message);});assert.equal(initial.status,'done',JSON.stringify(initial));
  const family=await host.dshRuntime.request(rootId,'family');const parent=Object.values(family.byId).find(row=>row.displayTitle==='nested-parent-marker');const grandchild=Object.values(family.byId).find(row=>row.parentId===parent?.id);const sibling=Object.values(family.byId).find(row=>row.displayTitle==='nested-sibling-marker');assert.ok(grandchild);assert.ok(sibling);
  const siblingBefore=await host.dshRuntime.request(rootId,'child-snapshot',{childId:sibling.id});await host.dshRuntime.close(rootId);
  const requests=[];let admitted;
  const result=await host.agent.run({sessionId:rootId,settings:{...settings,model:'nested-current'},workspacePath,approvalMode:'full-access',
    childPrompt:{parentSessionId:parent.id,childSessionId:grandchild.id,mode:'continuable',delivery:'queue',requestId:'nested-direct',content:[{type:'text',text:'nested-new-human-marker'}]},
    onChildAdmitted:receipt=>admitted=receipt,fetchImpl:async(_url,init)=>{const request=JSON.parse(init.body);requests.push(request);assert.equal(request.model,'nested-current');assert.ok(!request.tools.some(tool=>tool.function.name==='word_create'),'恢复父链保留原工具限制');return reply({role:'assistant',content:request.messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes('nested-new-human-marker'))?'最内层任务完成新要求':'直接父任务收到通知'});}});
  assert.equal(typeof admitted.messageId,'string');assert.equal(result.status,'done',JSON.stringify(result));
  const restored=await host.dshRuntime.request(rootId,'child-snapshot',{childId:grandchild.id});assert.equal(restored.header.id,grandchild.id);assert.equal(restored.header.parentSession,parent.id);assert.equal(restored.control.available,false);
  assert.equal(restored.events.filter(event=>event.type==='user/message'&&event.data.source?.rpcId==='nested-direct').length,1);assert.match(JSON.stringify(restored.events),/最内层任务完成新要求/);
  const parentAfter=await host.dshRuntime.request(rootId,'child-snapshot',{childId:parent.id});
  const settled=parentAfter.events.flatMap(event=>event.type==='user/message'?[event.data]:event.type==='agent/inbox/spliced'?event.data.inserted:[]).filter(message=>message.source?.kind==='subagent-settled'&&message.source.senderSessionId===grandchild.id&&JSON.stringify(message.content).includes('最内层任务完成新要求'));
  assert.equal(new Set(settled.map(message=>message.id)).size,1,'真正的子任务收尾通知在父记录关闭前保存一次');
  assert.deepEqual((await host.dshRuntime.request(rootId,'child-snapshot',{childId:sibling.id})).events,siblingBefore.events);
  assert.ok(requests.some(request=>request.messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes('nested-new-human-marker'))));
});
