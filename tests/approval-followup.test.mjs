import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { externalPathsForTool, isReviewerEligible, parseReviewerDecision, reviewApproval, runAgent, Workspace } from '../electron/agent.mts';
import { findSensitiveReference } from '../electron/host/plugins/sensitive-path-guard.mts';

const settings = { endpoint: 'http://mock.local/v1/chat/completions', model: 'mock-model', apiKey: 'test' };
const response = content => ({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content } }] }) });
const command = 'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 22 >/dev/null 2>&1; cd frontend && npx jest --config ../mobile/.dyworker/tmp/jest.config.cjs --testPathPatterns visitInputRender 2>&1 | tail -55';

test('截图的测试命令按 frontend 目录解析配置文件，项目内兄弟目录不再误报越界', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-cwd-approval-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'frontend'));
  await fs.mkdir(path.join(root, 'mobile/.dyworker/tmp'), { recursive: true });
  const workspace = new Workspace(root, { trustTempDirs: false });
  assert.deepEqual(externalPathsForTool(workspace, 'run_command', { command }), []);
  assert.deepEqual(externalPathsForTool(workspace, 'run_command', { command: 'cd frontend && cat ../../outside.txt' }), [path.resolve(root, '../outside.txt')]);
  assert.deepEqual(externalPathsForTool(workspace, 'run_command', { command: 'cd frontend && cat $PWD/../../outside.txt' }), [path.resolve(root, '../outside.txt')]);
  assert.deepEqual(externalPathsForTool(workspace, 'run_command', { command: 'cd frontend && cat ${PWD}/../../outside.txt' }), [path.resolve(root, '../outside.txt')]);
});

test('条件失败、管道和引号中的 cd 不得用成功切换目录来消除真实越界', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-cwd-branches-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = new Workspace(root, { trustTempDirs: false });
  for (const value of [
    'cd frontend || cat ../outside.txt', 'cd frontend | cat ../outside.txt',
    'cd frontend; cat ../outside.txt', 'cd frontend\ncat ../outside.txt',
    'cd frontend && false || cat ../outside.txt', 'cd frontend && false; cat ../outside.txt',
    'printf x | cd frontend && cat ../outside.txt', 'cd frontend && true & cat ../outside.txt',
    `printf 'cd frontend && cat example'; cat ../outside.txt`,
    'printf "cd frontend; cat example"; cat ../outside.txt',
  ]) assert.ok(externalPathsForTool(workspace, 'run_command', { command: value }).includes('../outside.txt'), value);
});

test('切入软链接目录后按真实位置判断后续文件，不把链接外目标当成项目内', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-cwd-links-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'), external = path.join(root, 'external');
  await fs.mkdir(project); await fs.mkdir(external);
  await fs.symlink(external, path.join(project, 'frontend'), process.platform === 'win32' ? 'junction' : 'dir');
  const workspace = new Workspace(project, { trustTempDirs: false });
  const outside = externalPathsForTool(workspace, 'run_command', { command: 'cd frontend && cat ./settings.json' });
  assert.ok(outside.includes(path.join(external, 'settings.json')));
});

test('审核回复可带说明、代码围栏和额外参数对象，但只采用完整且唯一的正式决定', () => {
  for (const value of [
    '```json\n{"decision":"allow","reason":"已授权"}\n```',
    '操作参数：{"command":"npm test"}\n结论：{"decision":"allow","reason":"已授权"}',
    '<think>示例：{"decision":"deny","reason":"思考里的例子"}</think>\n{"decision":"allow","reason":"已授权"}',
    JSON.stringify({ decision: 'allow', reason: '参数包含 {x} 和 "引号"，仍属于授权范围' }),
  ]) assert.equal(parseReviewerDecision(value).decision, 'allow', value);
  for (const value of [
    '<think>{"decision":"allow","reason":"尚未结束的思考"}',
    '{"decision":"deny","reason":"越权"}\n{"decision":"allow","reason":"另一对象"}',
    '{"decision":"allow","reason":{"decision":"deny"}}',
    '{"decision":"allow","command":"额外执行"}',
    '{"result":{"decision":"allow","reason":"嵌套资料"}}',
    '{"decision":"allow",',
  ]) assert.equal(parseReviewerDecision(value).decision, 'ask', value);
});

test('格式错误使用同一份授权和参数再审核一次，正常决定和多结论不重试', async () => {
  let calls = 0;
  const context = '请运行项目测试，禁止上传报告。';
  const action = { kind: 'run_command', details: command };
  const result = await reviewApproval({ settings, context, action,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.tools, undefined);
      assert.match(body.messages.at(-1).content, /禁止上传报告/);
      assert.ok(body.messages.at(-1).content.includes(command));
      calls++;
      if (calls === 1) return response('{"decision":"allow",');
      assert.match(body.messages[0].content, /完整用户要求和操作重新审核/);
      return response('{"decision":"allow","reason":"只运行用户要求的测试"}');
    } });
  assert.equal(result.decision, 'allow'); assert.equal(calls, 2);
  for (const [value, expected] of [
    ['{"decision":"ask","reason":"缺少账户范围"}', 'ask'],
    ['{"decision":"deny","reason":"明确禁止"}', 'deny'],
    ['{"decision":"deny"}\n{"decision":"allow"}', 'ask'],
  ]) {
    let count = 0;
    const parsed = await reviewApproval({ settings, context, action, fetchImpl: async () => { count++; return response(value); } });
    assert.equal(parsed.decision, expected); assert.equal(count, 1);
  }
});

test('两次格式错误仍转人工，停止后不再发第二次请求', async () => {
  let count = 0;
  const result = await reviewApproval({ settings, action: { kind: 'run_command', details: 'npm test' },
    fetchImpl: async () => { count++; return response('无法返回规范结果'); } });
  assert.equal(count, 2); assert.equal(result.decision, 'ask');
  const controller = new AbortController(); count = 0;
  await reviewApproval({ settings, signal: controller.signal, action: { kind: 'run_command', details: 'npm test' },
    fetchImpl: async () => { count++; controller.abort(new Error('用户停止')); return response('错误格式'); } });
  assert.equal(count, 1);
});

test('真实任务的审核格式异常不会直接打扰用户，重新审核后才执行无害操作', async t => {
  // realpath：Windows 的 os.tmpdir() 是 8.3 短路径（RUNNER~1），沙箱授权按规范化后的
  // 长路径建立，cwd 用短路径会导致命令内写入被授权检查误判拒绝。
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-review-format-flow-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let step = 0, reviews = 0, asks = 0;
  const result = await runAgent({ settings, workspacePath: root, approvalMode: 'reviewer',
    conversation: [{ role: 'user', content: '生成本次验收的 checked.txt，内容写 checked。' }],
    requestApproval: async () => { asks++; return false; },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.messages[0].content.includes('安全审核助手')) {
        reviews++; return response(reviews === 1 ? '{"decision":"allow",' : '{"decision":"allow","reason":"符合明确要求"}');
      }
      // 用 node 写入：printf 重定向在 Windows 的 cmd.exe 下不可用，node 两个平台行为一致。
      const message = step++ === 0 ? { role: 'assistant', content: null, tool_calls: [{ id: 'format-fix', type: 'function',
        function: { name: 'run_command', arguments: JSON.stringify({ command: "node -e \"require('fs').writeFileSync('checked.txt','checked')\"" }) } }] }
        : { role: 'assistant', content: '已生成验收文件。' };
      return { ok: true, json: async () => ({ choices: [{ message }] }) };
    } });
  assert.equal(result.status, 'done'); assert.equal(reviews, 2); assert.equal(asks, 0);
  assert.equal(await fs.readFile(path.join(root, 'checked.txt'), 'utf8'), 'checked');
});

test('npm 配置仍受凭据保护；批量停止先核实并缩小目标，不直接放行或强制人工', async () => {
  assert.equal(findSensitiveReference({ path: '/workspace/.npmrc' }).label, 'npm 配置（可能含令牌）');
  const command = "pkill -f fake_kylin_web.py 2>/dev/null; sleep 1; python3 -m py_compile server/native_vnc.py";
  assert.equal(isReviewerEligible({ approvalMode: 'reviewer', name: 'run_command', args: {
    command,
  } }), true);
  const result = await reviewApproval({ settings, action: { kind: 'run_command', command, details: command },
    fetchImpl: async () => assert.fail('批量目标查清并缩小前不得交模型直接放行') });
  assert.equal(result.status, 'needs_evidence');
  assert.match(result.reason, /具体进程编号/);
});
