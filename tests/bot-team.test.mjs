import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBotTeam, botModelProfiles } from '../electron/host/services/bot-team.mts';
import { createHost, disposeHost } from '../electron/host/context.mts';
import { conversationMessages } from '../builtin-plugins/ds-bot/src/messages.ts';

const entryUrl = new URL('../builtin-plugins/ds-bot/upstream/index.js', import.meta.url).href;
const builtinPluginsDir = fileURLToPath(new URL('../builtin-plugins/', import.meta.url));
const settings = { endpoint: 'http://127.0.0.1:9999/v1/chat/completions', model: 'test-one', apiKey: '',
  profiles: [{ id: 'second', name: '第二模型', endpoint: 'http://127.0.0.1:9999/v1/chat/completions', model: 'test-two', apiKey: '' }] };
const text = value => [
  { type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: value },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } }, { type: 'finish', reason: { kind: 'stop' } },
];
const tool = (name, args) => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'question-test', name, arguments: JSON.stringify(args) } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
];
async function call(team, endpoint, payload = {}) {
  const response = await team.dispatch(new Request('http://local/api/bot', {
    method: 'POST', body: JSON.stringify({ endpoint, payload }),
  }));
  const result = await response.json();
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.value;
}
async function settle(team) {
  for (let i = 0; i < 30; i++) {
    await Promise.all(team.ctx.agents.list().map(agent => agent.whenIdle()));
    await new Promise(resolve => setTimeout(resolve, 20));
    if (team.ctx.agents.list().every(agent => agent.status === 'idle')) return;
  }
  throw new Error('机器人没有完成回复');
}

test('内置机器人插件无需安装：宿主识别、启停，未配置模型时不调用模型', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-bot-host-'));
  const host = await createHost({ userDataDir: dir, mountPlugins: true, builtinPluginsDir });
  t.after(async () => { await disposeHost(host); await fs.rm(dir, { recursive: true, force: true }); });
  const entry = host.plugins.entries().find(row => row.name === 'ds-bot');
  assert.ok(entry?.builtin); assert.equal(entry.disabled, false);
  assert.ok(host.connection.matches('/api/bot', 'POST'));
  const result = await host.connection.dispatch({ path: '/api/bot', method: 'POST', body: JSON.stringify({ endpoint: 'state' }) });
  const value = JSON.parse(result.body).value;
  assert.equal(value.bots[0].name, '总管'); assert.deepEqual(value.models, []); assert.equal(value.bots[0].waiting, true);
  assert.equal((await host.plugins.setEnabled('ds-bot', false)).ok, true);
  assert.equal(host.connection.matches('/api/bot', 'POST'), false);
  assert.equal((await host.plugins.setEnabled('ds-bot', true)).ok, true);
  const again = await host.connection.dispatch({ path: '/api/bot', method: 'POST', body: JSON.stringify({ endpoint: 'state' }) });
  assert.equal(JSON.parse(again.body).value.mainBotId, value.mainBotId);
});

test('原插件真实运行：模型选择、机器人对话、提问回答、群聊协作、记忆与重启', { timeout: 30000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-bot-team-'));
  const requests = [];
  const options = { dataDir, entryUrl, readSettings: async () => settings,
    async *generate(profile, request) {
      requests.push({ model: profile.model, sessionId: request.sessionId });
      if (request.system?.includes('You keep the memory of one Bot')) {
        yield* text(JSON.stringify({ reply: '已记住', changes: [{ op: 'add', text: '回答用简体中文' }] })); return;
      }
      if (request.system?.includes('You keep the long-term memory of one Bot')) { yield* text('{"changes":[]}'); return; }
      const latest = request.messages?.at(-1);
      const said = latest?.content?.filter(part => part.type === 'text').map(part => part.text).join('') || '';
      if (latest?.role === 'user' && said === '请提问') {
        yield* tool('ask_user', { question: '选哪个方向？', options: [{ label: '写作' }, { label: '分析' }] }); return;
      }
      yield* text(`模型${profile.model}答复：${said.slice(0, 30) || '已完成'}`);
    } };
  let team = await createBotTeam(options);
  t.after(async () => { await team.dispose(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const state = await call(team, 'state', { locale: 'zh-CN' });
  assert.equal(state.models.length, 2); assert.equal(requests.length, 0);
  const chief = state.bots[0], selected = state.models.find(model => model.id === 'test-two');
  await call(team, 'update-bot', { id: chief.id, model: selected.ref }); await settle(team);
  await call(team, 'send', { sessionId: chief.id, text: '请确认第二模型' }); await settle(team);
  const history = await call(team, 'dyworker-history', { sessionId: chief.id });
  assert.match(JSON.stringify(history.events), /模型test-two答复/);
  assert.ok(requests.some(request => request.model === 'test-two'));
  await call(team, 'send', { sessionId: chief.id, text: '请提问' }); await settle(team);
  const question = (await call(team, 'state')).questions[chief.id]; assert.ok(question);
  await call(team, 'answer-question', { sessionId: chief.id, questionId: question.id, answer: { selected: ['写作'] } }); await settle(team);
  assert.equal((await call(team, 'state')).questions[chief.id], undefined);
  const bot = await call(team, 'create-bot', { name: '写作助手', role: '写作', model: selected.ref }); await settle(team);
  const room = await call(team, 'create-room', { name: '工作群', members: [chief.id, bot.id], admin: chief.id });
  await call(team, 'update-room', { id: room.id, mode: 'everyone' });
  await call(team, 'send', { sessionId: room.id, text: '两位请给意见' }); await settle(team);
  const group = await call(team, 'dyworker-history', { sessionId: room.id });
  assert.ok(group.groupLog.some(line => line.who === 'User' && line.text === '两位请给意见'));
  assert.ok(group.groupLog.some(line => line.botId === chief.id)); assert.ok(group.groupLog.some(line => line.botId === bot.id));
  const lastSeq = group.groupLog.at(-1)?.seq || 0;
  await call(team, 'send', { sessionId: room.id, text: `@${bot.name} 请独立检查` }); await settle(team);
  const targeted = (await call(team, 'dyworker-history', { sessionId: room.id })).groupLog.filter(line => line.seq > lastSeq && !line.kind && line.who !== 'User');
  assert.equal(targeted.length, 1, '指定成员时只让该成员回复');
  assert.equal(targeted[0].botId, bot.id);
  const memory = await call(team, 'memory-ask', { botId: chief.id, text: '请记住用简体中文回答' });
  assert.ok(memory.view.entries.some(entry => entry.text === '回答用简体中文'));
  const usage = await call(team, 'usage'); assert.ok(usage.rows.some(row => row[4] >= 100));
  await assert.rejects(call(team, 'dyworker-history', { sessionId: '../../outside' }), /不属于/);
  const first = requests.length;
  await team.dispose(); team = await createBotTeam(options);
  const restored = await call(team, 'state'); assert.equal(restored.mainBotId, chief.id);
  assert.ok(restored.rooms.some(item => item.id === room.id)); assert.equal(requests.length, first);
  assert.ok((await call(team, 'memory-view', { botId: chief.id })).entries.some(entry => entry.text === '回答用简体中文'));
  await call(team, 'send', { sessionId: chief.id, text: '重启后继续' }); await settle(team);
  assert.match(JSON.stringify(await call(team, 'dyworker-history', { sessionId: chief.id })), /模型test-two答复：重启后继续/);
});

test('模型标识不随当前模型和档案名称变化；聊天隐藏内部交接文字', () => {
  const one = botModelProfiles(settings)[0];
  const next = botModelProfiles({ ...settings, model: 'test-two', profiles: [{ ...settings, id: 'new-id', name: '新名字' }] });
  assert.equal(next.find(profile => profile.model === 'test-one').provider, one.provider);
  assert.deepEqual(conversationMessages({ events: [
    { seq: 0, type: 'user/message', data: { source: { role: 'kickoff' }, content: [{ type: 'text', text: 'hidden' }] } },
    { seq: 0.5, type: 'user/message', data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'runtime hidden' }] } },
    { seq: 1, type: 'assistant/message', data: { message: { id: 'a', content: [{ type: 'text', text: '你好' }] } } },
  ] }).map(message => message.text), ['你好']);
});

test('长对话切换到后续部分：读取当前回复、显示运行状态并停止当前部分', { timeout: 15000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-bot-part-'));
  let markStarted, signal, tools;
  const started = new Promise(resolve => { markStarted = resolve; });
  const options = { dataDir, entryUrl, readSettings: async () => settings,
    async *generate(_profile, request) {
      if (request.system?.includes('You keep the long-term memory of one Bot')) { yield* text('{"changes":[]}'); return; }
      tools = request.tools;
      const said = request.messages?.at(-1)?.content?.filter(part => part.type === 'text').map(part => part.text).join('') || '';
      if (said === '当前部分长回复') {
        signal = request.signal; markStarted();
        await new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true }));
        return;
      }
      yield* text('当前部分的回复');
    } };
  let team = await createBotTeam(options);
  t.after(async () => { await team.dispose(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const state = await call(team, 'state'), chief = state.bots[0];
  await call(team, 'update-bot', { id: chief.id, model: state.models[0].ref }); await settle(team);
  const fresh = await team.ctx.sessionController.create({ workspaceId: 'ds-bot-team' });
  const profile = botModelProfiles(settings)[0];
  await team.ctx.sessionController.selectModel({ sessionId: fresh.sessionId, provider: profile.provider, model: profile.model });
  const file = path.join(dataDir, 'bot/state.json');
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  saved.bots[chief.id].segments = [{ sessionId: chief.id, endedAt: Date.now() }];
  saved.bots[chief.id].sessionId = fresh.sessionId;
  saved.revision += 1;
  await fs.writeFile(file, JSON.stringify(saved));
  await team.dispose();
  team = await createBotTeam(options);
  await call(team, 'send', { sessionId: chief.id, text: '当前部分普通回复' }); await settle(team);
  const history = await call(team, 'dyworker-history', { sessionId: chief.id });
  assert.ok(history.events.some(event => event.sessionId === fresh.sessionId && JSON.stringify(event.data).includes('当前部分的回复')));
  assert.ok(tools.some(tool => tool.name === 'read_file'), '继续提供 DYWorker 的文件工具');
  assert.ok(!tools.some(tool => ['save_capability', 'attach_capability', 'request_secret'].includes(tool.name)), '不向模型提供没有对应服务或操作页面的工具');
  await call(team, 'send', { sessionId: chief.id, text: '当前部分长回复' }); await started;
  assert.equal((await call(team, 'dyworker-history', { sessionId: chief.id })).running, true);
  await call(team, 'dyworker-stop', { sessionId: chief.id }); await settle(team);
  assert.equal(signal.aborted, true);
  assert.equal((await call(team, 'dyworker-history', { sessionId: chief.id })).running, false);
});

test('更新后的机器人在重启后继续被中断的工作', { timeout: 15000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-bot-resume-'));
  let markStarted, resumed = 0;
  const started = new Promise(resolve => { markStarted = resolve; });
  const options = { dataDir, entryUrl, readSettings: async () => settings,
    async *generate(_profile, request) {
      if (request.system?.includes('You keep the long-term memory of one Bot')) { yield* text('{"changes":[]}'); return; }
      const said = request.messages?.at(-1)?.content?.filter(part => part.type === 'text').map(part => part.text).join('') || '';
      if (said.includes('DeepSeek Harness restarted while you were working')) {
        resumed += 1;
        assert.ok(JSON.stringify(request.messages).includes('重启前未完成的工作'));
        yield* text('重启后已经继续完成'); return;
      }
      if (said === '重启前未完成的工作') {
        markStarted();
        await new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true }));
        return;
      }
      yield* text('准备好了');
    } };
  let team = await createBotTeam(options);
  t.after(async () => { await team.dispose(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const state = await call(team, 'state'), chief = state.bots[0];
  await call(team, 'update-bot', { id: chief.id, model: state.models[0].ref }); await settle(team);
  await call(team, 'send', { sessionId: chief.id, text: '重启前未完成的工作' }); await started;
  for (let i = 0; i < 50; i++) {
    const notes = JSON.parse(await fs.readFile(path.join(dataDir, 'bot/inflight.json'), 'utf8'));
    if (notes.turns[chief.id]) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await team.dispose(); team = await createBotTeam(options);
  for (let i = 0; i < 100 && resumed === 0; i++) await new Promise(resolve => setTimeout(resolve, 50));
  await settle(team);
  assert.equal(resumed, 1, '只恢复一次尚未完成的工作');
  assert.match(JSON.stringify(await call(team, 'dyworker-history', { sessionId: chief.id })), /重启后已经继续完成/);
});

test('模型失败可见、重新发送恢复；停止群聊会同时取消成员请求', { timeout: 20000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-bot-stop-'));
  let mode = 'ok', started, markStarted, activeSignal;
  const team = await createBotTeam({ dataDir, entryUrl, readSettings: async () => settings,
    async *generate(_profile, request) {
      if (request.system?.includes('You keep the long-term memory of one Bot')) { yield* text('{"changes":[]}'); return; }
      if (mode === 'failure') throw new Error('本机模型连接失败');
      if (mode === 'slow') {
        activeSignal = request.signal; markStarted();
        await new Promise((_, reject) => {
          if (request.signal.aborted) reject(request.signal.reason);
          else request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
        });
        return;
      }
      yield* text('已恢复回复');
    } });
  t.after(async () => { await team.dispose(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const state = await call(team, 'state'), chief = state.bots[0];
  await call(team, 'update-bot', { id: chief.id, model: state.models[0].ref }); await settle(team);
  mode = 'failure'; await call(team, 'send', { sessionId: chief.id, text: '失败检查' }); await settle(team);
  assert.match((await call(team, 'dyworker-history', { sessionId: chief.id })).error, /本机模型连接失败/);
  mode = 'ok'; await call(team, 'send', { sessionId: chief.id, text: '恢复检查' }); await settle(team);
  assert.equal((await call(team, 'dyworker-history', { sessionId: chief.id })).error, '');
  const member = await call(team, 'create-bot', { name: '协作助手', model: state.models[0].ref }); await settle(team);
  const room = await call(team, 'create-room', { name: '停止检查群', members: [chief.id, member.id], admin: chief.id });
  started = new Promise(resolve => { markStarted = resolve; }); mode = 'slow';
  await call(team, 'send', { sessionId: room.id, text: '长回复检查' }); await started;
  assert.equal((await call(team, 'dyworker-history', { sessionId: room.id })).running, true);
  await call(team, 'dyworker-stop', { sessionId: room.id }); await settle(team);
  assert.equal(activeSignal.aborted, true);
  assert.equal((await call(team, 'dyworker-history', { sessionId: room.id })).running, false);
  mode = 'ok'; await call(team, 'send', { sessionId: room.id, text: '群聊继续' }); await settle(team);
  assert.ok((await call(team, 'dyworker-history', { sessionId: room.id })).groupLog.some(line => line.text === '已恢复回复'));
});
