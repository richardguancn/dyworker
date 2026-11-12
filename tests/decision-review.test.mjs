// 决策模型（Intern-Decision）客户端与审批分档、工具组预路由的判定行为。
// 每个用例使用独立端口，避免共享的端点不可达负缓存把用例串起来。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DECISION_MAX_QUESTIONS,
  fitsDecisionInput,
  mapDecisionApproval,
  normalizeDecisionEndpoint,
  readDecisionAnswers,
  requestToolsetRoute,
} from '../electron/agent/decision-client.mts';
import { reviewApproval } from '../electron/agent/review.mts';

const decisionResponse = answers => ({ ok: true, json: async () => ({ answers }) });
const chatResponse = decision => ({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: JSON.stringify(decision) } }] }) });
// reviewApproval 的 fallback 要求主模型端点与审核端点可区分，用不同域名承载主模型。
const decisionSettings = (name, port, extra = {}) => ({
  endpoint: `http://main-${name}.test/v1/chat/completions`, model: 'fixture', apiKey: 'test',
  reviewerBackend: 'decision', decisionEndpoint: `http://127.0.0.1:${port}`, reviewerDecisionThreshold: 0.9, ...extra,
});
// 服务故障类用例不带主模型端点：决策后端的 fallback 只在主模型可用时触发，
// 去掉后直接观察决策路径自身的 fail-closed 行为（请求数不受 fallback 重试干扰）。
const decisionOnlySettings = (port, extra = {}) => ({
  reviewerBackend: 'decision', decisionEndpoint: `http://127.0.0.1:${port}`, reviewerDecisionThreshold: 0.9, ...extra,
});

test('端点归一化：base URL 自动补 /v1/decisions，完整路径与官方别名原样保留', () => {
  assert.equal(normalizeDecisionEndpoint('http://127.0.0.1:7860'), 'http://127.0.0.1:7860/v1/decisions');
  assert.equal(normalizeDecisionEndpoint('http://127.0.0.1:7860/'), 'http://127.0.0.1:7860/v1/decisions');
  assert.equal(normalizeDecisionEndpoint('http://127.0.0.1:7860/v1/decisions'), 'http://127.0.0.1:7860/v1/decisions');
  assert.equal(normalizeDecisionEndpoint('http://127.0.0.1:7860/v1/jev'), 'http://127.0.0.1:7860/v1/jev');
  assert.equal(normalizeDecisionEndpoint(''), '');
});

test('answers 只接受概率分布形状，并按总质量归一', () => {
  const normalized = readDecisionAnswers({ answers: { decision: { probabilities: { allow: 0.7, ask: 0.2, deny: 0.09 } } } });
  assert.ok(Math.abs(normalized.decision.allow - 0.7 / 0.99) < 1e-9);
  assert.equal(readDecisionAnswers({ answers: {} }), null);
  assert.equal(readDecisionAnswers({ answers: { decision: {} } }), null);
  assert.equal(readDecisionAnswers({ answers: { decision: { probabilities: { allow: 'high' } } } }), null);
  assert.equal(readDecisionAnswers({ answers: { decision: { probabilities: { allow: 1.1 } } } }), null);
  assert.equal(readDecisionAnswers({ answers: { decision: { probabilities: {} } } }), null);
  assert.equal(readDecisionAnswers({ answers: [1, 2] }), null);
  assert.equal(readDecisionAnswers(null), null);
});

test('审批阈值映射：达标放行/拒绝，其余转人工（ask 而非 unavailable）', () => {
  const allow = mapDecisionApproval({ allow: 0.95, ask: 0.04, deny: 0.01 }, 0.9);
  assert.equal(allow.decision, 'allow'); assert.equal(allow.probability.threshold, 0.9);
  const deny = mapDecisionApproval({ allow: 0.03, ask: 0.05, deny: 0.92 }, 0.9);
  assert.equal(deny.decision, 'deny');
  const uncertain = mapDecisionApproval({ allow: 0.5, ask: 0.3, deny: 0.2 }, 0.9);
  assert.equal(uncertain.decision, 'ask'); assert.equal(uncertain.unavailable, undefined);
  const clamped = mapDecisionApproval({ allow: 0.6, ask: 0.4, deny: 0 }, 0.2);
  assert.equal(clamped.probability.threshold, 0.5);
  assert.match(allow.reason, /决策模型/); assert.match(allow.reason, /95\.00%/);
});

test('实际审核路径：达到阈值自动放行，材料包含审核政策与待审操作', async () => {
  let request;
  const result = await reviewApproval({
    settings: decisionSettings('allow', 7910),
    context: '用户要求创建报告',
    action: { kind: 'write_file', details: 'report.txt' },
    fetchImpl: async (url, options) => {
      assert.match(String(url), /\/v1\/decisions$/);
      request = JSON.parse(options.body);
      return decisionResponse({ decision: { probabilities: { allow: 0.95, ask: 0.04, deny: 0.01 } } });
    },
  });
  assert.equal(result.decision, 'allow');
  assert.equal(result.probability.source, 'decision_model');
  assert.ok(result.policyHash);
  assert.match(result.reason, /决策模型/);
  assert.match(request.state, /审核助手/);
  assert.match(request.state, /write_file/);
  assert.deepEqual(Object.keys(request.questions.decision.criteria), ['allow', 'ask', 'deny']);
});

test('达到拒绝阈值自动拒绝；置信不足转人工确认', async () => {
  const deny = await reviewApproval({
    settings: decisionSettings('deny', 7911), action: { kind: 'write_file', details: 'report.txt' },
    fetchImpl: async () => decisionResponse({ decision: { probabilities: { allow: 0.05, ask: 0.03, deny: 0.92 } } }),
  });
  assert.equal(deny.decision, 'deny'); assert.equal(deny.unavailable, undefined);
  const uncertain = await reviewApproval({
    settings: decisionSettings('ask', 7912), action: { kind: 'write_file', details: 'report.txt' },
    fetchImpl: async () => decisionResponse({ decision: { probabilities: { allow: 0.5, ask: 0.3, deny: 0.2 } } }),
  });
  assert.equal(uncertain.decision, 'ask'); assert.equal(uncertain.unavailable, undefined);
});

test('服务不可达 fail-closed 转人工，短期负缓存不再重复请求', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('ECONNREFUSED'); };
  const first = await reviewApproval({
    settings: decisionOnlySettings(7913), action: { kind: 'write_file', details: 'report.txt' }, fetchImpl,
  });
  assert.equal(first.decision, 'ask'); assert.equal(first.unavailable, true);
  const second = await reviewApproval({
    settings: decisionOnlySettings(7913), action: { kind: 'write_file', details: 'report.txt' }, fetchImpl,
  });
  assert.equal(second.decision, 'ask'); assert.equal(second.unavailable, true);
  assert.equal(calls, 1);
});

test('返回格式无法读取时同样 fail-closed', async () => {
  const result = await reviewApproval({
    settings: decisionOnlySettings(7914), action: { kind: 'write_file', details: 'report.txt' },
    fetchImpl: async () => decisionResponse({ decision: { probabilities: { allow: 'high' } } }),
  });
  assert.equal(result.decision, 'ask'); assert.equal(result.unavailable, true);
});

test('界面操作不传截图给决策模型，落到主模型完整审核', async () => {
  let decisionCalls = 0, chatCalls = 0;
  const result = await reviewApproval({
    settings: decisionSettings('uiop', 7915),
    action: { kind: 'browser__click', details: '提交按钮', observation: { available: true, text: '页面文本' } },
    fetchImpl: async (url) => {
      if (String(url).includes('/v1/decisions')) { decisionCalls += 1; return decisionResponse({ decision: { probabilities: { allow: 0.99, ask: 0, deny: 0.01 } } }); }
      chatCalls += 1;
      return chatResponse({ decision: 'ask', reason: '界面操作需人工确认' });
    },
  });
  assert.equal(decisionCalls, 0); assert.equal(chatCalls, 1);
  assert.equal(result.decision, 'ask');
});

test('超过决策模型输入容量时明确转人工，不截断不猜测', async () => {
  let calls = 0;
  const result = await reviewApproval({
    settings: decisionOnlySettings(7916),
    action: { kind: 'write_file', details: 'x'.repeat(30000) },
    fetchImpl: async () => { calls += 1; return decisionResponse({ decision: { probabilities: { allow: 1 } } }); },
  });
  assert.equal(calls, 0);
  assert.equal(result.decision, 'ask'); assert.equal(result.unavailable, true);
  assert.match(result.reason, /容量/);
});

test('工具组预路由：noul 概率达阈值才激活，题目数超过上限截断', async () => {
  const groups = [{ name: 'browser', summary: '浏览器' }, ...Array.from({ length: DECISION_MAX_QUESTIONS + 1 }, (_, i) => ({ name: `group_${i}`, summary: `组${i}` }))];
  let request;
  const routed = await requestToolsetRoute({
    settings: { decisionEndpoint: 'http://127.0.0.1:7917', toolsetRouteThreshold: 0.5 },
    query: '打开网页检查页面', recentContext: '用户：昨天看过首页', groups,
    fetchImpl: async (url, options) => {
      assert.match(String(url), /\/v1\/decisions$/);
      request = JSON.parse(options.body);
      const answers = {};
      for (const name of Object.keys(request.questions)) {
        answers[name] = { probabilities: name === 'browser' || name === 'group_0' ? { yes: 0.9, no: 0.1 } : { yes: 0.2, no: 0.8 } };
      }
      return { ok: true, json: async () => ({ answers }) };
    },
  });
  assert.equal(Object.keys(request.questions).length, DECISION_MAX_QUESTIONS);
  assert.equal(request.questions.browser.type, 'noul');
  assert.match(request.state, /打开网页检查页面/);
  assert.match(request.state, /昨天看过首页/);
  assert.deepEqual(routed, ['browser', 'group_0']);
});

test('决策服务不可达时预路由返回空数组并短期缓存，低概率不激活', async () => {
  let calls = 0;
  const settingsDown = { decisionEndpoint: 'http://127.0.0.1:7918' };
  const groups = [{ name: 'browser', summary: '浏览器' }];
  assert.deepEqual(await requestToolsetRoute({ settings: settingsDown, query: 'x', groups, fetchImpl: async () => { calls += 1; throw new Error('down'); } }), []);
  assert.deepEqual(await requestToolsetRoute({ settings: settingsDown, query: 'x', groups, fetchImpl: async () => { calls += 1; throw new Error('down'); } }), []);
  assert.equal(calls, 1);
  const quiet = await requestToolsetRoute({
    settings: { decisionEndpoint: 'http://127.0.0.1:7919', toolsetRouteThreshold: 0.5 },
    query: '总结一下', groups,
    fetchImpl: async () => decisionResponse({ browser: { probabilities: { yes: 0.3, no: 0.7 } } }),
  });
  assert.deepEqual(quiet, []);
});

test('输入容量检查：常规材料放行，超长材料拒绝', () => {
  assert.equal(fitsDecisionInput('审核政策\n\n常规操作材料'), true);
  assert.equal(fitsDecisionInput('x'.repeat(40000)), false);
  assert.equal(fitsDecisionInput(''), true);
});
