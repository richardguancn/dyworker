// 机器人继承桌面任务能力：工具面、真实文件/命令执行、审批确认与拒绝。
// 用真实宿主（createHost）+ 脚本化模型驱动真实的机器人会话，不做静态检查。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost, disposeHost } from '../electron/host/context.mts';
import { sessionToolDefinitions } from '../electron/session-tools.mts';
import { toolDefinitions } from '../electron/agent.mts';
import { BOT_HARNESS_TOOL_NAMES } from '../electron/host/dsh-runtime/bot-harness.mts';

const entryUrl = new URL('../builtin-plugins/ds-bot/upstream/index.js', import.meta.url).href;
const builtinPluginsDir = fileURLToPath(new URL('../builtin-plugins/', import.meta.url));
const text = value => [
  { type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: value },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } }, { type: 'finish', reason: { kind: 'stop' } },
];
const tool = (name, args, id = `call-${name}`) => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
];
const lastText = request => (request.messages?.at(-1)?.content || [])
  .filter(part => part?.type === 'text').map(part => part.text).join('');

async function call(team, endpoint, payload = {}) {
  const response = await team.dispatch(new Request('http://local/api/bot', {
    method: 'POST', body: JSON.stringify({ endpoint, payload }),
  }));
  const result = await response.json();
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.value;
}
const historyOf = (team, sessionId) => call(team, 'dyworker-history', { sessionId });
/** 等这一轮机器人真的跑完：既出现过运行中，又已经空闲且有新内容。 */
async function waitTurn(team, sessionId, previousEvents = -1, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let running = false;
  while (Date.now() < deadline) {
    const view = await historyOf(team, sessionId);
    running = running || view.running;
    if (!view.running && (running || view.events.length > previousEvents)) return view;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`${sessionId} 的机器人没有完成回复`);
}
async function send(team, sessionId, text) {
  const before = (await historyOf(team, sessionId)).events.length;
  await call(team, 'send', { sessionId, text });
  return waitTurn(team, sessionId, before);
}
/** 等确认卡出现（审批由工具调用内部发起，和模型回合并行）。 */
async function waitForApproval(team, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { items } = await call(team, 'dyworker-approvals');
    if (items.length) return items[0];
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('没有等到需要确认的操作');
}

test('机器人继承桌面任务工具并真实执行：文件、命令、审批同意与拒绝', { timeout: 60000 }, async t => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-bot-harness-')));
  // 临时目录按应用规则视为工作区内，所以工作区外读取用仓库里的真实文件。
  const outside = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({
    endpoint: 'http://127.0.0.1:9999/v1/chat/completions', model: 'test-one', apiKey: '', approvalMode: 'interactive',
  }), 'utf8');
  const resolvers = {
    isShuttingDown: () => false, mcpExtraTools: async () => [],
    // 与应用一致的额外工具装配：会话检索只读工具在这里进入模型可见的工具面。
    agentExtraTools: mcpTools => [...mcpTools, ...sessionToolDefinitions()],
    createExtraToolRouter: () => Object.assign(async () => { throw new Error('本轮不用插件工具'); }, { dispose: async () => {} }),
    readHooks: async () => [], readStandingRules: async () => [], readMemoryPages: async () => [],
    readSkills: async () => [], history: () => null, auditRecord: () => {},
    memoriesFromAgentResult: () => [], appendUsageStat: () => {}, appendMemory: async () => {},
  };
  const host = await createHost({ userDataDir: dir, mountPlugins: true, builtinPluginsDir, agentResolvers: resolvers });
  const toolNames = [];
  const scripted = async function* (profile, request) {
    // 记录模型实际看到的工具面（取最完整的一次请求）。
    // 机器人运行环境给模型的是 DSH 扁平工具表（name/description/parameters）。
    const seen = (request.tools || []).map(item => item.name || item.function?.name).filter(Boolean);
    if (seen.length > toolNames.length) { toolNames.length = 0; toolNames.push(...seen); }
    const latest = request.messages?.at(-1);
    const said = lastText(request);
    if (latest?.role === 'tool') {
      yield* text(`工具结果已收到：${String(said).slice(0, 80)}`);
      return;
    }
    if (said.includes('写到文件')) { yield* tool('write_file', { path: '机器人笔记.txt', content: '机器人写入的内容' }); return; }
    if (said.includes('运行命令')) { yield* tool('run_command', { command: 'echo 完成 > 命令结果.txt' }); return; }
    if (said.includes('读工作区外') || said.includes('工作区外的文件')) { yield* tool('read_file', { path: outside }); return; }
    if (said.includes('记住')) { yield* tool('save_memory', { category: '用户偏好', content: '机器人团队交付要用简体中文', kind: 'preference', scope: 'global' }); return; }
    if (said.includes('能力说明')) { yield* text('说明书在会话上下文里'); return; }
    yield* text(`收到：${said.slice(0, 40)}`);
  };
  const team = await createBotTeamForTest(host, { generate: scripted });
  t.after(async () => { await team.dispose(); await disposeHost(host); await fs.rm(dir, { recursive: true, force: true }); });

  const state = await call(team, 'state', { locale: 'zh-CN' });
  const chief = state.bots[0];
  const session = chief.sessionId || chief.id;
  const beforeKickoff = (await historyOf(team, session)).events.length;
  await call(team, 'update-bot', { id: chief.id, model: state.models[0].ref });
  await waitTurn(team, session, beforeKickoff, 10000).catch(() => undefined);

  // 1) 工具面：桌面任务的文件、命令、联网、模板、记忆、历史检索都在。
  for (const name of [...BOT_HARNESS_TOOL_NAMES, 'list_sessions', 'search_sessions', 'read_session']) {
    assert.ok(toolNames.includes(name), `机器人缺少继承工具：${name}`);
  }
  for (const name of ['browser__open', 'open_file']) {
    assert.equal(toolNames.includes(name), false, `界面相关工具不应直接暴露给机器人：${name}`);
  }
  assert.deepEqual(toolNames.filter(name => name.startsWith('browser__')), []);

  // 2) 会话上下文里带了能力说明（对用户隐藏）。
  assert.match(JSON.stringify((await call(team, 'dyworker-history', { sessionId: chief.id })).events), /机器人能力说明/);

  // 3) 工作区内写文件：按互动模式直接执行，磁盘上真有这个文件。
  await send(team, chief.id, '把结论写到文件');
  const workspace = path.join(dir, 'ds-bot', 'workspace');
  assert.equal(await fs.readFile(path.join(workspace, '机器人笔记.txt'), 'utf8'), '机器人写入的内容');

  // 4) 命令带重定向：互功模式下需要人工确认，面板同意后真实执行。
  await call(team, 'send', { sessionId: chief.id, text: '运行命令生成结果' });
  const approval = await waitForApproval(team);
  assert.equal(approval.kind, 'run_command');
  assert.match(approval.title, /运行命令|命令/);
  await call(team, 'dyworker-approve', { id: approval.id, allow: true });
  await waitTurn(team, session);
  // Windows 下该命令由 cmd.exe 执行：重定向会带上命令里空格并写入 CRLF 行尾。
  const commandOutput = await fs.readFile(path.join(workspace, '命令结果.txt'), 'utf8').catch(() => '');
  assert.equal(commandOutput.replace(/\s+$/, ''), '完成');
  assert.equal((await call(team, 'dyworker-approvals')).items.length, 0);

  // 5) 工作区外读取：需要确认；拒绝后不读取，且把拒绝结果交给模型。
  await call(team, 'send', { sessionId: chief.id, text: '读工作区外的文件' });
  const external = await waitForApproval(team);
  assert.equal(external.kind, 'read_file');
  assert.match(external.details, /工作区外路径/);
  await call(team, 'dyworker-approve', { id: external.id, allow: false });
  await waitTurn(team, session);
  const history = JSON.stringify((await call(team, 'dyworker-history', { sessionId: chief.id })).events);
  assert.match(history, /没有允许这次「read_file」操作/);
  assert.doesNotMatch(history, /"productName": "DYWorker"/);

  // 6) 长期记忆写入应用自己的记忆库（与桌面任务共用）。
  await send(team, chief.id, '请记住这条偏好');
  const pages = await host.memory.list();
  assert.ok(pages.some(page => (page.rows || []).some(row => row.content === '机器人团队交付要用简体中文')),
    `长期记忆没有写入：${JSON.stringify(pages).slice(0, 200)}`);

  // 7) 停止机器人时，等待中的确认随之撤销，不留悬空的确认卡。
  await call(team, 'send', { sessionId: chief.id, text: '再读一次工作区外的文件' });
  const pending = await waitForApproval(team);
  await call(team, 'dyworker-stop', { sessionId: chief.id });
  await waitTurn(team, session, -1, 10000).catch(() => undefined);
  assert.equal((await call(team, 'dyworker-approvals')).items.find(item => item.id === pending.id), undefined);
});

// 走宿主自己的服务实例（BotTeamService.mount），确保应用接线与测试注入是同一条路径。
async function createBotTeamForTest(host, options) {
  return host.botTeam.mount(entryUrl, options);
}

test('继承工具的定义与桌面任务同一份（描述、参数不另写一套）', () => {
  const definitions = new Map(toolDefinitions().map(item => [item.function.name, item.function]));
  for (const name of BOT_HARNESS_TOOL_NAMES) {
    assert.ok(definitions.has(name), `桌面任务里没有这个工具：${name}`);
  }
  assert.ok(sessionToolDefinitions().some(item => item.function.name === 'read_session'));
});

test('面板确认卡走真实通道：读取待确认、同意/拒绝都落回同一个对话', async () => {
  const panel = await fs.readFile(new URL('../builtin-plugins/ds-bot/src/client.tsx', import.meta.url), 'utf8');
  assert.match(panel, /call\('dyworker-approvals', \{ sessionId: conversationId \}/, '面板要按对话取待确认项');
  assert.match(panel, /dyworker-approve', \{ id: pendingApproval\.id, allow: true \}/, '「允许」要回执同一张卡');
  assert.match(panel, /dyworker-approve', \{ id: pendingApproval\.id, allow: false \}/, '「拒绝」要回执同一张卡');
  assert.match(panel, /需要你确认/, '确认卡要有明确标题');
  for (const name of ['read_file', 'run_command']) assert.ok(BOT_HARNESS_TOOL_NAMES.includes(name));
});
