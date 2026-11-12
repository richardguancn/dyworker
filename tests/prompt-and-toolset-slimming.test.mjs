import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgent } from '../electron/agent.mts';
import { prepareToolsetDiscovery, activateToolsets } from '../electron/host/toolset-discovery.mts';
import { VISUAL_SKILL_ID } from '../electron/host/chart-guidance.mts';
import { dshNativeSkills } from '../electron/host/dsh-runtime/native-skills.mts';
import { OfficialDshSession } from '../electron/host/dsh-runtime/full-session.mts';
import { browserToolDefinitions } from '../electron/browser.mts';
import { sessionToolDefinitions } from '../electron/session-tools.mts';
import { filePreviewToolDefinitions } from '../electron/file-preview.mts';

const settings = {
  endpoint: 'http://mock.local/v1/chat/completions',
  model: 'mock',
  apiKey: 'test',
  reviewerBackend: 'main',
};

test('prepareToolsetDiscovery 按身份分层工具组并去重历史搜索，空组不出现在 load_toolset 中', () => {
  const sampleTools = [
    { type: 'function', function: { name: 'read_file', description: '读文件', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'gov_search', description: '搜政务', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'search_history', description: '旧历史', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'list_sessions', description: '新会话列表', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'browser__open', description: '打开浏览器', parameters: { type: 'object', properties: {} } } },
  ];
  const general = prepareToolsetDiscovery(sampleTools, { identity: 'general' });
  const initialNames = general.initial.map(t => t.function.name);
  assert.deepEqual(initialNames, ['read_file', 'load_toolset']);
  assert.deepEqual(general.availableGroups, ['browser', 'office', 'history_and_skills']);
  const historyLoaded = activateToolsets(general.deferredByGroup, ['history_and_skills']);
  assert.deepEqual(historyLoaded.tools.map(t => t.function.name), ['list_sessions']);

  const gov = prepareToolsetDiscovery(sampleTools, { identity: 'government' });
  assert.ok(gov.initial.some(t => t.function.name === 'gov_search'), '政务身份默认常驻 office 工具');
  assert.ok(!gov.availableGroups.includes('office'));
});

test('prepareToolsetDiscovery 将飞书工具与插件工具按需归组，不在首轮暴露', () => {
  const toolsWithPluginsAndFeishu = [
    { type: 'function', function: { name: 'read_file', description: '读文件' } },
    { type: 'function', function: { name: 'feishu_read_doc', description: '读取飞书文档' } },
    { type: 'function', function: { name: 'feishu_bitable_read_records', description: '读多维表格' } },
    { type: 'function', function: { name: 'plugin__dyworker_knowledge_base__kb_query', description: '知识库检索' } },
    { type: 'function', function: { name: 'plugin__dsh_office_tools__word_create', description: '创建 Word' } },
  ];
  const discovery = prepareToolsetDiscovery(toolsWithPluginsAndFeishu);
  const initialNames = discovery.initial.map(t => t.function.name);
  assert.deepEqual(initialNames, ['read_file', 'load_toolset']);
  assert.ok(discovery.availableGroups.includes('feishu'));
  assert.ok(discovery.availableGroups.includes('plugin_dyworker_knowledge_base'));
  assert.ok(discovery.availableGroups.includes('plugin_dsh_office_tools'));

  const activated = activateToolsets(discovery.deferredByGroup, ['plugin_dyworker_knowledge_base']);
  assert.deepEqual(activated.tools.map(t => t.function.name), ['plugin__dyworker_knowledge_base__kb_query']);
  assert.match(activated.text, /已激活 1 个工具/);
});

test('电脑与浏览器工具说明包含观察编号和 Linux 共享桌面要求', () => {
  const tools = [
    { function: { name: 'mcp__computer-use__get_app_state', description: '读取应用' } },
    { function: { name: 'browser__open', description: '打开网页' } },
  ];
  const discovery = prepareToolsetDiscovery(tools);
  assert.match(discovery.initial.find(item => item.function.name === 'load_toolset').function.description, /任务独立后台浏览器/);
  const loaded = activateToolsets(discovery.deferredByGroup, ['desktop']);
  assert.match(loaded.text, /动作携带最新 observation_id/);
  assert.match(loaded.text, /Linux 共享桌面截图和系统输入需要用户明确允许/);
});

test('runAgent 首轮仅暴露精简工具与精准自审参数，load_toolset 与 builtin-visual-output 按需生效', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-slim-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'obsolete.txt'), 'temp');

  const extraTools = [
    ...browserToolDefinitions(),
    ...sessionToolDefinitions(),
    ...filePreviewToolDefinitions(),
    { type: 'function', function: { name: 'mcp__computer-use__get_app_state', description: '获取界面', parameters: { type: 'object', properties: {} } } },
  ];
  const requests = [];
  let step = 0;
  const result = await runAgent({
    settings,
    workspacePath: root,
    approvalMode: 'reviewer',
    extraTools,
    onExtraTool: async () => ({ ok: true, result: 'ok' }),
    conversation: [{ role: 'user', content: '查看图表规范并清理 obsolete.txt' }],
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      let message;
      if (step++ === 0) {
        message = {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'load-1', type: 'function', function: { name: 'load_toolset', arguments: JSON.stringify({ groups: ['file_and_wake'] }) } },
            { id: 'skill-1', type: 'function', function: { name: 'load_skill', arguments: JSON.stringify({ skill_id: VISUAL_SKILL_ID }) } },
          ],
        };
      } else if (step === 2) {
        message = {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'del-1',
              type: 'function',
              function: {
                name: 'delete_file',
                arguments: JSON.stringify({
                  path: 'obsolete.txt',
                  __dyworker_approval: { decision: 'allow', reason: '用户明确要求清理 obsolete.txt' },
                }),
              },
            },
          ],
        };
      } else {
        message = { role: 'assistant', content: '已完成清理并读取规范。' };
      }
      return { ok: true, json: async () => ({ choices: [{ message }] }) };
    },
  });

  assert.equal(result.status, 'done');
  const firstToolNames = requests[0].tools.map(item => item.function.name);
  assert.ok(firstToolNames.length <= 19, `首轮工具数应精简（实际 ${firstToolNames.length}）`);
  assert.ok(firstToolNames.includes('load_toolset'));
  assert.ok(!firstToolNames.includes('browser__open'));
  assert.ok(!firstToolNames.includes('mcp__computer-use__get_app_state'));
  assert.ok(!firstToolNames.includes('delete_file'));

  const withInline = requests[0].tools.filter(item => item.function.parameters?.properties?.__dyworker_approval).map(item => item.function.name);
  assert.deepEqual(withInline.sort(), ['edit_file', 'run_command', 'write_file']);

  const secondDelete = requests[1].tools.find(item => item.function.name === 'delete_file');
  assert.ok(secondDelete?.function.parameters?.properties?.__dyworker_approval, '激活后的 delete_file 自动挂载内联审核');
  const secondDatetime = requests[1].tools.find(item => item.function.name === 'get_datetime');
  assert.equal(secondDatetime?.function.parameters?.properties?.__dyworker_approval, undefined);
  assert.match(JSON.stringify(requests[1].messages), /ECharts 数据图表/);
  assert.match(JSON.stringify(requests[1].messages), /dyworker-ui/);
  const exists = await fs.stat(path.join(root, 'obsolete.txt')).then(() => true, () => false);
  assert.equal(exists, false);
});

test('runAgent 决策模型预路由：命中阈值的工具组首轮直接激活，服务不可达时静默降级', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-route-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const extraTools = [...browserToolDefinitions()];
  const conversation = [{ role: 'user', content: '打开 example.com 检查页面内容' }];

  // 命中阈值：browser 组按 noul 概率 0.9 预激活，首轮请求即含 browser__open
  const requests = [];
  let decisionCalls = 0;
  let step = 0;
  const result = await runAgent({
    settings: { ...settings, decisionEndpoint: 'http://127.0.0.1:7930', toolsetRouteThreshold: 0.5 },
    workspacePath: root,
    approvalMode: 'reviewer',
    extraTools,
    onExtraTool: async () => ({ ok: true, result: 'ok' }),
    conversation,
    fetchImpl: async (url, options) => {
      if (String(url).includes('/v1/decisions')) {
        decisionCalls += 1;
        const body = JSON.parse(options.body);
        assert.equal(body.questions.browser.type, 'noul');
        assert.match(body.state, /打开 example.com/);
        return { ok: true, json: async () => ({ answers: { browser: { type: 'noul', probabilities: { yes: 0.9, no: 0.1 } } } }) };
      }
      requests.push(JSON.parse(options.body));
      const message = step++ === 0
        ? { role: 'assistant', content: '已检查页面，一切正常。' }
        : { role: 'assistant', content: '完成。' };
      return { ok: true, json: async () => ({ choices: [{ message }] }) };
    },
  });
  assert.equal(result.status, 'done');
  assert.equal(decisionCalls, 1);
  const firstToolNames = requests[0].tools.map(item => item.function.name);
  assert.ok(firstToolNames.includes('browser__open'), '预路由命中的浏览器工具组应在首轮出现');
  assert.ok(firstToolNames.includes('load_toolset'));

  // 服务不可达（502）：预路由静默降级，首轮与现状完全一致；同端点短期不再探测
  const fallbackRequests = [];
  let fallbackStep = 0;
  let downCalls = 0;
  const downResult = await runAgent({
    settings: { ...settings, decisionEndpoint: 'http://127.0.0.1:7931' },
    workspacePath: root,
    approvalMode: 'reviewer',
    extraTools,
    onExtraTool: async () => ({ ok: true, result: 'ok' }),
    conversation,
    fetchImpl: async (url, options) => {
      if (String(url).includes('/v1/decisions')) { downCalls += 1; return { ok: false, status: 502, json: async () => ({}) }; }
      fallbackRequests.push(JSON.parse(options.body));
      const message = fallbackStep++ === 0
        ? { role: 'assistant', content: '先看一下页面。' }
        : { role: 'assistant', content: '完成。' };
      return { ok: true, json: async () => ({ choices: [{ message }] }) };
    },
  });
  assert.equal(downResult.status, 'done');
  assert.equal(downCalls, 1);
  const downFirst = fallbackRequests[0].tools.map(item => item.function.name);
  assert.ok(!downFirst.includes('browser__open'), '预路由降级后首轮不应出现按需工具');
  assert.ok(downFirst.includes('load_toolset'));
});

test('DSH 原生技能支持内置图表技能兜底且尊重停用设置', async () => {
  const active = dshNativeSkills([]);
  const content = await active.execute('load_skill', { skill_id: VISUAL_SKILL_ID });
  assert.match(content, /echarts/);
  assert.match(content, /dyworker-ui/);

  const disabled = dshNativeSkills([{ id: VISUAL_SKILL_ID, name: '图表', enabled: false }]);
  await assert.rejects(() => disabled.execute('load_skill', { skill_id: VISUAL_SKILL_ID }), /没有找到模板/);
});

test('DSH OfficialDshSession 首轮收起 browser 与 desktop 工具组，通过 load_toolset 免审激活并在下轮任务重置', { timeout: 30000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-dsh-toolset-'));
  const workspace = path.join(dir, 'work'), profile = path.join(dir, 'profile'), data = path.join(dir, 'data');
  await Promise.all([fs.mkdir(workspace), fs.mkdir(profile), fs.mkdir(data)]);
  const extraTools = [
    ...browserToolDefinitions().map(item => item.function),
    { name: 'mcp__computer-use__list_apps', description: '列出应用', parameters: { type: 'object', properties: {} } },
  ];
  const seenTools = [], extraCalls = [];
  let stage = 0;
  const runtime = new OfficialDshSession({
    profileDir: profile,
    dataDir: data,
    workspacePath: workspace,
    sessionId: 'dsh-toolset',
    plugins: [],
    extraTools,
    approve: async () => true,
    onExtraTool: async (name, args) => { extraCalls.push({ name, args }); return { ok: true, result: '已打开网页' }; },
    async *generate(request) {
      seenTools.push(request.tools.map(tool => tool.name));
      let block;
      if (stage++ === 0) block = { type: 'tool-call', id: 'load', name: 'load_toolset', arguments: JSON.stringify({ groups: ['browser'] }) };
      else if (stage === 2) block = { type: 'tool-call', id: 'open', name: 'browser__open', arguments: JSON.stringify({ url: 'https://example.com' }) };
      else block = { type: 'text', text: '处理完毕' };
      yield { type: 'block-start', index: 0, blockType: block.type };
      yield block.type === 'tool-call'
        ? { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
        : { type: 'text-delta', index: 0, text: block.text };
      yield { type: 'block-end', index: 0, block };
      yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } };
    },
  });
  t.after(async () => { await runtime.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await runtime.start();
  await runtime.request('prompt', { text: '打开网页检查' });
  assert.ok(seenTools[0].includes('load_toolset'));
  assert.ok(!seenTools[0].includes('browser__open'));
  assert.ok(!seenTools[0].includes('mcp__computer-use__list_apps'));
  assert.ok(seenTools[1].includes('browser__open'));
  assert.deepEqual(extraCalls, [{ name: 'browser__open', args: { url: 'https://example.com' } }]);

  const nextIndex = seenTools.length;
  await runtime.request('prompt', { text: '新任务' });
  assert.ok(!seenTools[nextIndex].includes('browser__open'), '新任务重新收起按需工具组');
});
