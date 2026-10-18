// 当前架构验收：仅使用自拟临时文件和受控审核返回，不读取真实配置。
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Workspace, reviewApproval, planTaskApproval } from '../electron/agent.mts';
import { buildReviewContext } from '../electron/approval-context.mts';
import { reviewTaskAction } from '../electron/approval-policy.mts';
const results = [];
for (const [name, args] of [['write_file', { path: 'notes.md', content: 'text' }], ['run_command', { command: 'python3 report.py' }]]) {
  assert.equal(planTaskApproval({ name, args, approvalMode: 'reviewer' }), 'review');
}
results.push({ check: '同等影响的文件操作与脚本都使用统一审核', passed: true });
const local = await reviewApproval({ settings: { reviewerBackend: 'local' }, context: '整理演示项目',
  action: { kind: 'run_command', details: 'python3 -m unittest' }, localReviewImpl: async () => '{"decision":"allow","reason":"允许建议"}' });
assert.equal(local.status, 'unavailable');
results.push({ check: '能力不足明确返回不可用，不伪装成人工授权问题', passed: true });
const context = buildReviewContext({ conversation: [{ role: 'user', content: '先不修改。' }, { role: 'user', content: '明确撤回旧限制，现在允许修改。' }] });
assert.ok(context.indexOf('先不修改') < context.indexOf('明确撤回'));
let version = 'one';
const stale = await reviewTaskAction({ version, currentVersion: () => version, input: {}, review: async () => {
  version = 'two'; return { decision: 'allow', reason: '旧结论' };
} });
assert.equal(stale.status, 'stale');
results.push({ check: '授权有顺序，审核期间授权变化后旧结论失效', passed: true });
const root = await fs.mkdtemp(path.join(process.cwd(), '.dyw-execution-proof-'));
try {
  const workspace = path.join(root, 'work'); await fs.mkdir(workspace);
  const outside = path.join(root, 'outside.txt'); await fs.writeFile(outside, 'original');
  const w = new Workspace(workspace, { trustTempDirs: false });
  assert.equal((await w.runCommand('python3 -c \'open("inside.txt","w").write("yes")\'')).ok, true);
  const command = 'python3 -c \'from pathlib import Path; (Path.cwd().parent / ("out"+"side.txt")).write_text("changed")\'';
  assert.equal((await w.runCommand(command)).ok, false);
  assert.equal(await fs.readFile(outside, 'utf8'), 'original');
  results.push({ check: '动态生成的工作区外写入受到实际限制', passed: true });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log(JSON.stringify({ note: '当前源码的结构与执行验证；真实模型结果另行记录', results }, null, 2));
