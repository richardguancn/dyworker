import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectProcessTargets, processSignalTargets } from '../electron/process-review.mts';
import { Workspace, planTaskApproval, suggestStandingRule, reviewApproval, runAgent } from '../electron/agent.mts';
import { createDshApproval } from '../electron/host/dsh-runtime/approval.mts';
import { createBotApproval } from '../electron/host/dsh-runtime/bot-harness.mts';

const settings = { endpoint: 'http://mock.local/v1/chat/completions', model: 'mock', apiKey: 'test' };
const response = message => ({ ok: true, json: async () => ({ choices: [{ message: typeof message === 'string' ? { role: 'assistant', content: message } : message }] }) });
const call = command => ({ role: 'assistant', tool_calls: [{ id: randomUUID(), type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command }) } }] });
const posix = { skip: process.platform === 'win32' };
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-process-review-')));
  const other = path.join(root, 'other'), workspacePath = path.join(root, 'task');
  await fs.mkdir(workspacePath); await fs.mkdir(other);
  const children = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
    await fs.rm(root, { recursive: true, force: true });
  });
  const launch = async (cwd, marker = randomUUID()) => {
    const child = spawn(process.execPath, ['-e', 'console.log("ready");setInterval(()=>{},1000)', marker, 'fake-secret-not-to-be-sent'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child); await once(child.stdout, 'data'); return child;
  };
  return { root, workspacePath, other, launch };
}

test('进程信号可以送审但不能保存成永久允许，明确规则和其他危险命令仍生效', () => {
  for (const command of ['kill 123 2>/dev/null; rm -rf ./.gradle-home', 'pkill -f "build tool" 2>&1', 'killall node']) {
    const input = { name: 'run_command', args: { command }, approvalMode: 'reviewer' };
    assert.equal(planTaskApproval(input), 'review');
    assert.equal(suggestStandingRule('run_command', input.args), null);
    assert.equal(planTaskApproval({ ...input, hookRequiresApproval: true, hook: { action: 'require_approval' } }), 'confirm');
    assert.equal(planTaskApproval({ ...input, approvalMode: 'deny-changes' }), 'deny');
  }
  for (const command of ['sudo tool', 'rm -rf existing', 'git reset --hard HEAD', 'shutdown now']) {
    assert.notEqual(planTaskApproval({ name: 'run_command', args: { command }, approvalMode: 'reviewer' }), 'review');
  }
});

test('解析复合命令、信号、重定向；动态目标和进程组不猜测', () => {
  const targets = processSignalTargets('kill -s TERM 123 456 2>/dev/null; pkill -f "build tool" 2>&1; echo done');
  assert.deepEqual(targets[0].pids, [123, 456]); assert.equal(targets[0].signal, 'TERM');
  assert.deepEqual(targets[1].query, ['-f', 'build tool']);
  assert.equal(processSignalTargets('kill -0 123')[0].signal, '0');
  assert.deepEqual(processSignalTargets('/bin/kill 123 > "a b.log"')[0].pids, [123]);
  assert.deepEqual(processSignalTargets('killall node.worker')[0].query, ['-x', 'node\\.worker']);
  for (const command of ['kill $PID', 'kill -- -123', 'kill 0', 'kill -9 -1', 'pkill -u nobody node']) assert.ok(processSignalTargets(command)[0].error);
});

test('无法核实的动态目标要求继续调查，审核取消仍保留取消状态', async () => {
  const action = { kind: 'run_command', command: 'kill $PID', details: 'kill $PID' };
  const result = await reviewApproval({ settings, action, fetchImpl: async () => assert.fail('未知真实目标不能交模型猜测放行') });
  assert.equal(result.status, 'needs_evidence'); assert.equal(result.unavailable, undefined);
  const controller = new AbortController(); controller.abort(new Error('用户停止'));
  const cancelled = await reviewApproval({ settings, action, signal: controller.signal, fetchImpl: async () => assert.fail('取消后不送审') });
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.unavailable, true);
});

test('真实目标检查区分当前项目与其他项目，不输出完整参数或环境', posix, async t => {
  const f = await fixture(t), marker = randomUUID();
  const owned = await f.launch(f.workspacePath, marker), other = await f.launch(f.other, marker);
  const snapshot = await inspectProcessTargets(`pkill -f ${marker}`, f.workspacePath);
  assert.equal(snapshot.complete, true, JSON.stringify(snapshot));
  const infos = snapshot.targets[0].processes;
  assert.equal(infos.find(info => info.pid === owned.pid).directoryScope, 'workspace');
  assert.equal(infos.find(info => info.pid === other.pid).directoryScope, 'outside');
  assert.doesNotMatch(JSON.stringify(snapshot), /fake-secret-not-to-be-sent/);
  for (const child of [owned, other]) assert.equal(child.signalCode, null);
});

test('批量停止先返回查明的目标供缩小，不弹人工卡也不直接送模型放行', posix, async t => {
  const f = await fixture(t), marker = randomUUID(); await f.launch(f.workspacePath, marker); await f.launch(f.other, marker);
  const result = await reviewApproval({ settings, action: { kind: 'run_command', command: `pkill -f ${marker}`, workspacePath: f.workspacePath },
    fetchImpl: async () => assert.fail('批量目标必须先缩小') });
  assert.equal(result.status, 'needs_evidence'); assert.equal(result.needsEvidence, true); assert.equal(result.unavailable, undefined);
  assert.match(result.reason, /outside/); assert.match(result.reason, /具体进程编号/);
});

test('确切进程连同真实元数据和整条命令送审，允许后再次核实身份', posix, async t => {
  const f = await fixture(t), child = await f.launch(f.workspacePath); let calls = 0;
  const command = `kill ${child.pid}; rm -rf ./temporary-cache`;
  const result = await reviewApproval({ settings, context: '停止当前任务自己启动的测试程序并清理自己生成的缓存。',
    action: { kind: 'run_command', command, workspacePath: f.workspacePath, details: command },
    fetchImpl: async (_url, options) => {
      calls++; const request = JSON.parse(options.body), text = JSON.stringify(request.messages);
      assert.match(text, /宿主只读进程检查/); assert.match(text, /temporary-cache/); assert.match(text, /workspace/);
      assert.ok(text.includes(String(child.pid))); assert.doesNotMatch(text, /fake-secret-not-to-be-sent/);
      return response('{"decision":"allow","reason":"实际目标属于已授权任务"}');
    } });
  assert.equal(result.status, 'allowed'); assert.equal(calls, 1); assert.equal(child.signalCode, null, '审核自身不发送信号');
});

test('审核期间目标退出后旧允许作废，不转人工', posix, async t => {
  const f = await fixture(t), child = await f.launch(f.workspacePath);
  const command = `kill ${child.pid}`;
  const result = await reviewApproval({ settings, action: { kind: 'run_command', command, workspacePath: f.workspacePath, details: command },
    fetchImpl: async () => { const exit = once(child, 'exit'); child.kill(); await exit; return response('{"decision":"allow","reason":"此前目标允许"}'); } });
  assert.equal(result.status, 'needs_evidence'); assert.match(result.reason, /旧结论已作废/);
});

for (const [label, create] of [['DSH', createDshApproval], ['机器人', createBotApproval]]) {
  test(`${label}批量停止返回事实核查，不掉回人工；具体目标正常自动审核`, posix, async t => {
    const f = await fixture(t), marker = randomUUID(), child = await f.launch(f.workspacePath, marker); let reviews = 0;
    const approve = create({ workspace: new Workspace(f.workspacePath), workspacePath: f.workspacePath, settings, approvalMode: 'reviewer',
      conversation: [{ role: 'user', content: '停止本任务启动的测试程序。' }], requestApproval: async () => assert.fail('不应弹人工'),
      fetchImpl: async (_url, options) => { reviews++; assert.match(options.body, /宿主只读进程检查/); return response('{"decision":"allow","reason":"本任务自己的程序"}'); } });
    const signal = new AbortController().signal;
    await assert.rejects(approve({ name: 'run_command', args: { command: `pkill -f ${marker}` }, signal }), /不是用户拒绝，也不是审核服务故障/);
    assert.equal(reviews, 0);
    assert.equal(await approve({ name: 'run_command', args: { command: `kill ${child.pid}` }, signal }), true); assert.equal(reviews, 1);
  });
}

test('实际连续流程：批量匹配查清后精确停止本任务、清理缓存，其他项目继续运行，人工零次', posix, async t => {
  const f = await fixture(t), marker = randomUUID();
  const owned = await f.launch(f.workspacePath, marker), other = await f.launch(f.other, marker);
  await fs.mkdir(path.join(f.workspacePath, 'temporary-cache')); await fs.writeFile(path.join(f.workspacePath, 'temporary-cache', 'generated.txt'), 'generated fixture');
  let step = 0, reviews = 0;
  const result = await runAgent({ settings, workspacePath: f.workspacePath, approvalMode: 'reviewer',
    conversation: [{ role: 'user', content: `清理本次测试：停止我刚启动的当前项目测试程序 ${owned.pid}，删除本任务生成的 temporary-cache，保留其他项目。` }],
    requestApproval: async () => assert.fail('任务内清理不应弹人工'),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (!body.tools) { reviews++; assert.match(options.body, /宿主只读进程检查/); return response('{"decision":"allow","reason":"用户已授权的具体任务目标和自产缓存"}'); }
      if (step++ === 0) return response(call(`pkill -f ${marker}`));
      if (step === 2) {
        const messages = JSON.stringify(body.messages); assert.match(messages, /needs|目标|进程/); assert.match(messages, /outside/);
        return response(call(`kill ${owned.pid}; rm -rf ./temporary-cache; echo task-cleaned`));
      }
      return response('测试程序已停止，任务缓存已清理。');
    } });
  assert.equal(reviews, 1);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(owned.signalCode, 'SIGTERM'); assert.equal(other.signalCode, null); process.kill(other.pid, 0);
  await assert.rejects(fs.stat(path.join(f.workspacePath, 'temporary-cache')), { code: 'ENOENT' });
  assert.match(JSON.stringify(result.executedMessages), /task-cleaned/);
});
