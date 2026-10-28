import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAgent } from '../electron/agent.mts';
import { isReviewerEligible } from '../electron/agent/review.mts';

const settings = { endpoint: 'http://mock.local/v1/chat/completions', model: 'mock', apiKey: 'test', reviewerBackend: 'main' };
const call = args => ({ id: 'delete', type: 'function', function: { name: 'delete_file', arguments: JSON.stringify(args) } });

test('服务状态查询可交审核，服务修改仍须人工确认', () => {
  const eligible = command => isReviewerEligible({ name: 'run_command', args: { command }, approvalMode: 'reviewer' });
  assert.equal(eligible('launchctl print gui/$(id -u)/com.example.service 2>&1 | head -40'), true);
  assert.equal(eligible('launchctl bootout gui/501/com.example.service'), false);
});

for (const [label, opinion, approved, expected] of [
  ['同次允许', { decision: 'allow', reason: '用户明确要求删除此文件' }, false, false],
  ['缺少意见', undefined, false, true],
  ['需要确认', { decision: 'ask', reason: '范围待确认' }, false, true],
  ['同次拒绝', { decision: 'deny', reason: '用户禁止删除' }, false, true],
]) test(`同次审核：${label}`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-inline-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'sample.txt'), 'example');
  const requests = [], approvals = [];
  const args = { path: 'sample.txt', ...(opinion ? { __dyworker_approval: opinion } : {}) };
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    const message = body.messages[0].content.includes('安全审核助手')
      ? { role: 'assistant', content: JSON.stringify({ decision: 'ask', reason: '范围待确认' }) }
      : requests.length === 1
      ? { role: 'assistant', content: null, tool_calls: [call(args)] }
      : { role: 'assistant', content: '已处理' };
    return { ok: true, json: async () => ({ choices: [{ message }] }) };
  };
  await runAgent({ settings, workspacePath: root, approvalMode: 'reviewer',
    conversation: [{ role: 'user', content: '删除 sample.txt' }], fetchImpl,
    requestApproval: async action => { approvals.push(action); return approved; } });
  const exists = await fs.stat(path.join(root, 'sample.txt')).then(() => true, () => false);
  assert.equal(exists, expected);
  assert.equal(requests.length, label === '缺少意见' ? 3 : 2);
  assert.equal(approvals.length, ['缺少意见', '需要确认'].includes(label) ? 1 : 0);
  const schema = requests[0].tools.find(item => item.function?.name === 'delete_file').function.parameters;
  assert.ok(schema.properties.__dyworker_approval);
});

test('同次审核缺少路径事实时重新审核，按审核结论执行或请求授权', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-inline-facts-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'check.mjs'), "console.log('ok')\n");
  for (const decision of ['allow', 'ask', 'deny']) {
    let requests = 0, reviews = 0, approvals = 0;
    const command = 'node check.mjs';
    await runAgent({ settings, workspacePath: root, approvalMode: 'reviewer',
      conversation: [{ role: 'user', content: '检查当前任务。' }],
      requestApproval: async () => { approvals++; return false; },
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        if (body.messages[0].content.includes('安全审核助手')) {
          reviews++;
          assert.match(body.messages.at(-1).content, /console\.log/);
          return { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ decision, reason: '核对当前操作' }) } }] }) };
        }
        const message = ++requests === 1
          ? { role: 'assistant', content: null, tool_calls: [{ id: 'command', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command, __dyworker_approval: { decision: 'allow', reason: '任务检查' } }) } }] }
          : { role: 'assistant', content: '结束' };
        return { ok: true, json: async () => ({ choices: [{ message }] }) };
      } });
    assert.equal(reviews, 1, decision);
    assert.equal(approvals, decision === 'ask' ? 1 : 0, decision);
  }
});

test('规则要求确认时，同次允许不能覆盖用户决定', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-inline-hook-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'sample.txt'), 'example');
  let requests = 0, approvals = 0;
  await runAgent({ settings, workspacePath: root, approvalMode: 'reviewer',
    conversation: [{ role: 'user', content: '删除 sample.txt' }],
    beforeToolExecute: async ({ name }) => name === 'delete_file' ? { action: 'require_approval', message: '须确认' } : null,
    requestApproval: async () => { approvals++; return false; },
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: ++requests === 1
      ? { role: 'assistant', content: null, tool_calls: [call({ path: 'sample.txt', __dyworker_approval: { decision: 'allow', reason: '用户要求' } })] }
      : { role: 'assistant', content: '结束' } }] }) }) });
  assert.equal(await fs.readFile(path.join(root, 'sample.txt'), 'utf8'), 'example');
  assert.equal(approvals, 1);
  assert.equal(requests, 2);
});
