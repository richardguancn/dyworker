import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAgent, reviewApproval, parseReviewerDecision, Workspace } from '../electron/agent.mts';
import { reviewOutcome } from '../electron/approval-policy.mts';
import { buildReviewContext } from '../electron/approval-context.mts';
import { createDshApproval } from '../electron/host/dsh-runtime/approval.mts';
import { createBotApproval } from '../electron/host/dsh-runtime/bot-harness.mts';

const settings = { endpoint: 'http://mock.local/v1/chat/completions', model: 'mock', apiKey: 'test' };
const reply = message => ({ ok: true, json: async () => ({ choices: [{ message: typeof message === 'string' ? { role: 'assistant', content: message } : message }] }) });
const call = (id, name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const evidence = { decision: 'ask', needsEvidence: true, reason: '先读取 helper.mjs，核对被调用程序的实际输出和影响' };

test('模型可明确要求补查，错误组合和伪造字段不能成为允许', () => {
  assert.equal(reviewOutcome(parseReviewerDecision(JSON.stringify(evidence))).status, 'needs_evidence');
  for (const value of [
    { ...evidence, decision: 'allow' }, { ...evidence, decision: 'deny' },
    { ...evidence, execution: 'host' }, { ...evidence, needsEvidence: 'true' },
    { ...evidence, reason: ' ' }, { ...evidence, unexpected: true },
  ]) assert.equal(parseReviewerDecision(JSON.stringify(value)).unavailable, true);
  assert.equal(reviewOutcome({ ...evidence, unavailable: true }).status, 'unavailable');
  assert.equal(reviewOutcome({ ...evidence, unavailable: true }).needsEvidence, undefined);
  assert.equal(reviewOutcome({ ...evidence, status: 'cancelled' }).status, 'cancelled');
  assert.equal(reviewOutcome({ ...evidence, decision: 'deny' }).decision, 'deny');
  assert.equal(reviewOutcome({ ...evidence, decision: 'deny' }).needsEvidence, undefined);
  assert.equal(reviewOutcome({ decision: 'ask', reason: '需要批准新增接收方' }).status, 'needs_authorization');
});

test('缺少事实只返回补查结果，不另找模型投票；真实授权询问保持原样', async () => {
  for (const result of [evidence, { decision: 'ask', reason: '请决定是否允许覆盖其他项目的文件' }, { decision: 'deny', reason: '用户明确禁止外发' }]) {
    let calls = 0;
    const review = await reviewApproval({ settings, context: '检查本项目，不修改其他项目。',
      action: { kind: 'run_command', command: 'node check.mjs', details: 'node check.mjs' },
      fetchImpl: async () => { calls++; return reply(JSON.stringify(result)); } });
    assert.equal(calls, 1);
    assert.equal(review.status, result.needsEvidence ? 'needs_evidence' : result.decision === 'ask' ? 'needs_authorization' : 'denied');
  }
});

for (const [label, create] of [['DSH', createDshApproval], ['机器人', createBotApproval]]) {
  test(`${label}通用事实缺项不弹人工卡，补查后重审，新增授权仍转人工`, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-evidence-entry-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let result = evidence, asks = 0;
    const approve = create({ workspace: new Workspace(root), workspacePath: root, approvalMode: 'reviewer', settings,
      conversation: [{ role: 'user', content: '检查本项目。' }],
      requestApproval: async () => { asks++; return false; },
      fetchImpl: async () => reply(JSON.stringify(result)) });
    const tool = () => ({ name: 'run_command', args: { command: 'node check.mjs' }, signal: new AbortController().signal });
    await assert.rejects(approve(tool()), /先读取 helper.mjs/);
    assert.equal(asks, 0);
    result = { decision: 'allow', reason: '完整内容已核对，属于当前任务' };
    assert.equal(await approve(tool()), true);
    result = { decision: 'ask', reason: '需要用户决定新增接收方' };
    assert.equal(await approve(tool()), false); assert.equal(asks, 1);
  });
}

test('实际连续执行：保存完整临时程序、补查依赖后重新审核并运行，人工零次', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-evidence-task-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const helper = 'export const sample = [2, 3, 5];\n';
  await fs.writeFile(path.join(root, 'helper.mjs'), helper);
  const source = '// representative diagnostic detail\n'.repeat(360)
    + "import {sample} from './helper.mjs';\nimport {writeFile} from 'node:fs/promises';\nawait writeFile('check-result.json', JSON.stringify({total:sample.reduce((a,b)=>a+b,0)}));\nconsole.log('diagnostic-complete');\n";
  let step = 0, commands = 0, asks = 0;
  const audits = [];
  const messages = [call('save', 'write_file', { path: 'check.mjs', content: source }),
    call('run-before-check', 'run_command', { command: 'node check.mjs' }),
    call('read-helper', 'read_file', { path: 'helper.mjs' }),
    call('run-after-check', 'run_command', { command: 'node check.mjs' }),
    { role: 'assistant', content: '检查已完成。' }];
  const result = await runAgent({ settings, workspacePath: root, approvalMode: 'reviewer',
    conversation: [{ role: 'user', content: '完成当前项目检查，允许必要的临时检查文件和本地验证。不要联网，不修改其他项目。' }],
    requestApproval: async () => { asks++; return false; }, audit: item => audits.push(item),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.messages[0].content.includes('安全审核助手')) {
        const input = body.messages.at(-1).content;
        if (input.includes('工具：write_file')) {
          assert.ok(input.includes(JSON.stringify(source).slice(1, -1)), '临时文件完整正文送审');
          assert.match(input, /本次仅保存/);
        } else {
          commands++;
          if (commands === 1) return reply(JSON.stringify(evidence));
          assert.match(input, /export const sample/);
          assert.ok(input.includes('diagnostic-complete'), '执行仍提供当前完整入口');
        }
        return reply('{"decision":"allow","reason":"任务内必要的本地检查"}');
      }
      if (step === 2) {
        assert.match(JSON.stringify(body.messages), /先读取 helper.mjs/);
        await assert.rejects(fs.access(path.join(root, 'check-result.json')), { code: 'ENOENT' });
      }
      return reply(messages[step++]);
    } });
  assert.equal(result.status, 'done'); assert.equal(asks, 0); assert.equal(commands, 2);
  assert.equal(await fs.readFile(path.join(root, 'check.mjs'), 'utf8'), source);
  assert.equal(await fs.readFile(path.join(root, 'helper.mjs'), 'utf8'), helper);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'check-result.json'), 'utf8')), { total: 10 });
  assert.ok(audits.some(item => item.decision === 'reviewer-needs-evidence'));
  assert.ok(result.executedMessages.some(item => item.role === 'tool' && String(item.content).includes('diagnostic-complete')));
});

test('必须人工确认时，影响说明也读取文件尾部完整内容，不以卡片预览判断', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-impact-complete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = '// diagnostic preparation\n'.repeat(220) + '\nconsole.log("TAIL_COMPLETE_EVIDENCE_8246");\n';
  let step = 0, summarySawTail = false, asks = 0;
  const result = await runAgent({ settings, workspacePath: root, approvalMode: 'reviewer',
    hooks: [{ tool: 'write_file', action: 'require_approval', message: '用户要求每次写入先确认' }],
    conversation: [{ role: 'user', content: '准备检查程序，每次写入先由我确认。' }],
    requestApproval: async () => { asks++; return false; },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.messages[0].content.includes('审批说明撰写助手')) {
        summarySawTail = body.messages.at(-1).content.includes('TAIL_COMPLETE_EVIDENCE_8246');
        assert.match(body.messages.at(-1).content, /本次仅保存/);
        return reply('- 创建 check.mjs，等待用户确认后保存。');
      }
      assert.ok(!body.messages[0].content.includes('安全审核助手'), '用户强制确认不能交审核替代');
      return reply(step++ === 0 ? call('save-confirm', 'write_file', { path: 'check.mjs', content: source }) : '操作未执行。');
    } });
  assert.equal(result.status, 'done'); assert.equal(asks, 1); assert.equal(summarySawTail, true);
  await assert.rejects(fs.access(path.join(root, 'check.mjs')), { code: 'ENOENT' });
});
