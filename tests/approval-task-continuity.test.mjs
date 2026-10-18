import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { reviewContextPages, parseReviewPage, reviewAllContextPages } from '../electron/approval-review-pages.mts';
import { reviewApproval, runAgent, Workspace, externalPathsForTool, reviewerCacheKey, isReviewerProtectedPath } from '../electron/agent.mts';
import { findSensitiveReference } from '../electron/host/plugins/sensitive-path-guard.mts';
import { createDshApproval } from '../electron/host/dsh-runtime/approval.mts';
import { createBotApproval } from '../electron/host/dsh-runtime/bot-harness.mts';

const settings = { endpoint: 'http://mock.local/v1/chat/completions', model: 'mock', apiKey: 'test' };
const authorized = '请修复当前项目，运行测试并保存工作模板；禁止上传私密数据。';
const longContext = `【用户亲自提出的要求】\n${authorized}\n` + '检查背景资料。'.repeat(5000);
const response = message => ({ ok: true, json: async () => ({ choices: [{ message: typeof message === 'string' ? { role: 'assistant', content: message } : message }] }) });
const pageResult = (decision = 'allow', authorization = '', reason = '任务范围内') => JSON.stringify({ decision, reason, authorization });
const toolCall = (index, name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: `c${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-continuity-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('长任务分段覆盖全部原文，页边界重叠且不丢弃中间限制', () => {
  assert.equal(isReviewerProtectedPath(process.cwd(), 'electron/approval-review-pages.mts'), true);
  const pages = reviewContextPages(longContext);
  assert.ok(pages.length > 2);
  let rebuilt = '';
  for (const page of pages) {
    assert.equal(page.text, longContext.slice(page.start, page.end));
    rebuilt += page.text.slice(Math.max(0, rebuilt.length - page.start));
  }
  assert.equal(rebuilt, longContext);
});

test('只有全部页面无冲突且存在可核对的原文授权才允许', async () => {
  for (const variant of ['allowed', 'old-deny', 'uncertain', 'missing-authority', 'forged-quote', 'bad-format']) {
    let seen = 0, active = 0, peak = 0;
    const result = await reviewAllContextPages({ context: longContext,
      review: async (page, index) => {
        active++; peak = Math.max(peak, active); seen++;
        await new Promise(resolve => setImmediate(resolve)); active--;
        if (index === 1 && variant === 'old-deny') return pageResult('deny', '', '较早要求禁止');
        if (index === 1 && variant === 'uncertain') return pageResult('ask', '', '目标不明');
        if (index === 1 && variant === 'bad-format') return 'allow';
        const quote = index === 0 && variant !== 'missing-authority' ? (variant === 'forged-quote' ? '不存在的授权' : authorized) : '';
        return pageResult('allow', quote);
      } });
    assert.equal(result.decision, variant === 'allowed' ? 'allow' : variant === 'old-deny' ? 'deny' : 'ask', variant);
    assert.equal(seen, reviewContextPages(longContext).length);
    assert.ok(peak <= 3);
  }
  assert.equal(parseReviewPage('{"decision":"allow","reason":"yes"}', authorized).decision, 'ask');
});

test('在线长任务每页都带完整命令、接口和访问说明，末页禁止仍拒绝', async () => {
  const action = { kind: 'run_command', details: 'python3 -m unittest && upload-private-data',
    toolDefinition: { name: 'run_command', description: '完整命令执行' }, accessCheck: '外部接收方未知' };
  let calls = 0;
  const context = longContext + '\n用户要求：禁止执行 upload-private-data。';
  const result = await reviewApproval({ settings, context, action,
    fetchImpl: async (_url, options) => {
      calls++;
      const text = JSON.parse(options.body).messages.at(-1).content;
      assert.ok(text.includes(action.details));
      assert.match(text, /外部接收方未知/); assert.match(text, /完整命令执行/);
      return response(text.includes('用户要求：禁止执行 upload-private-data。')
        ? pageResult('deny', '', '用户禁止上传')
        : pageResult('allow', text.includes(authorized) ? authorized : ''));
    } });
  assert.ok(calls > 2); assert.equal(result.decision, 'deny');
});

test('分段超时和停止不产生迟到允许，也不启动后续批次', async () => {
  const controller = new AbortController(); let calls = 0;
  const result = await reviewApproval({ settings, context: longContext, action: { kind: 'run_command', details: 'python3 -m unittest' },
    signal: controller.signal, modelTimeoutMs: 30,
    fetchImpl: async () => { calls++; return new Promise(() => {}); } });
  assert.equal(result.decision, 'ask'); assert.match(result.reason, /超时/); assert.equal(calls, 3);
  let stopped = 0;
  await assert.rejects(reviewAllContextPages({ context: longContext, signal: controller.signal,
    review: async () => { stopped++; controller.abort(new Error('停止')); return pageResult('allow', authorized); } }), /停止/);
  assert.equal(stopped, 1);
});

test('单页服务失败后，其他在途页面结束也不能继续启动新页面', async () => {
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = reviewAllContextPages({ context: longContext + longContext,
    review: async (_page, index) => {
      calls++;
      if (index === 0) throw new Error('模拟连接失败');
      await gate;
      return pageResult('allow');
    } });
  await assert.rejects(pending, /模拟连接失败/);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 3);
});

test('配置示例只交语义审核，真实凭据、混合命令和用户强制确认不获得豁免', () => {
  const example = 'python3 -m compileall -q app tests && find . -name ".env.example" | sort';
  assert.equal(findSensitiveReference({ command: example }, 'run_command').reviewable, true);
  for (const command of [example + '; cat .env', 'cat .env.example ~/.ssh/id_ed25519', 'cat .env.example > .env', 'cat .env.production']) {
    assert.notEqual(findSensitiveReference({ command }, 'run_command').reviewable, true, command);
  }
  for (const name of ['save_skill', 'update_skill']) assert.equal(findSensitiveReference({ instructions: '后续检查 .env 中配置是否齐全。' }, name), null);
  assert.notEqual(findSensitiveReference({ path: '.env.example' }, 'read_file').reviewable, true);
});

test('虚拟环境系统解释器不再当作外部数据，作为读取参数和私人链接仍受检查', async t => {
  const root = await fixture(t), workspace = new Workspace(root, { trustTempDirs: false });
  const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  await fs.mkdir(path.join(root, '.venv/bin'), { recursive: true });
  await fs.symlink(python, path.join(root, '.venv/bin/python'));
  assert.deepEqual(externalPathsForTool(workspace, 'run_command', { command: '.venv/bin/python -m unittest' }), []);
  assert.ok(externalPathsForTool(workspace, 'run_command', { command: 'cat .venv/bin/python' }).length);
  const external = await fixture(t);
  await fs.writeFile(path.join(external, 'private-script'), 'private');
  await fs.symlink(path.join(external, 'private-script'), path.join(root, 'runner'));
  assert.ok(externalPathsForTool(workspace, 'run_command', { command: './runner' }).length);
  assert.notEqual(reviewerCacheKey('run_command', 'printf "a  b"'), reviewerCacheKey('run_command', 'printf "a b"'));
});

for (const [label, create] of [['DSH', createDshApproval], ['机器人', createBotApproval]]) {
  test(`${label}拒绝三次后继续自动审核第四步，用户强制规则仍优先`, async t => {
    const root = await fixture(t); let reviews = 0, asks = 0;
    const approve = create({ workspace: new Workspace(root), workspacePath: root, approvalMode: 'reviewer', settings,
      nativeToolNames: ['run_command'],
      hooks: [{ tool: 'run_command', command: '*forced*', action: 'require_approval', message: '用户要求确认' }],
      review: async () => ({ decision: ++reviews <= 3 ? 'deny' : 'allow', reason: '当前操作判断' }),
      requestApproval: async () => { asks++; return false; } });
    for (let index = 0; index < 4; index++) assert.equal(await approve({ name: 'run_command', args: { command: `python3 -c 'print(${index})'` },
      signal: new AbortController().signal, sessionId: 'task' }), index === 3);
    assert.equal(reviews, 4); assert.equal(asks, 0);
    assert.equal(await approve({ name: 'run_command', args: { command: 'python3 forced.py' }, signal: new AbortController().signal }), false);
    assert.equal(asks, 1); assert.equal(reviews, 4);
  });
}

test('长任务实际连续完成查找、编译、测试、临时改写和恢复、假凭据探测与保存模板，无人工确认', async t => {
  const root = await fixture(t);
  const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  await fs.mkdir(path.join(root, '.venv/bin'), { recursive: true });
  await fs.mkdir(path.join(root, 'app')); await fs.mkdir(path.join(root, 'tests'));
  await fs.symlink(python, path.join(root, '.venv/bin/python'));
  await fs.writeFile(path.join(root, 'app/client.py'), 'VALUE = 1\n');
  await fs.writeFile(path.join(root, 'tests/test_client.py'), 'import unittest\nfrom app.client import VALUE\nclass TestClient(unittest.TestCase):\n def test_value(self): self.assertEqual(VALUE, 1)\n');
  await fs.writeFile(path.join(root, '.env.example'), 'CLIENT_ID=example\n');
  const commands = [
    'grep -n "VALUE" app/client.py | head -5',
    '.venv/bin/python -m compileall -q app tests && find . -name ".env.example" | sort',
    '.venv/bin/python -m unittest discover -s tests -v 2>&1 | tail -20',
    '.venv/bin/python - <<\'PY\'\nfrom pathlib import Path\np=Path("app/client.py")\nPath("client.bak").write_text(p.read_text())\np.write_text("VALUE = 2\\n")\nPY',
    'cp client.bak app/client.py && rm -f client.bak && .venv/bin/python -m unittest discover -s tests 2>&1 | tail -6',
    'AMZ_CLIENT_SECRET=fake-secret .venv/bin/python -c \'import os; assert os.environ["AMZ_CLIENT_SECRET"] == "fake-secret"; print("probe passed")\'',
    '.venv/bin/python -m unittest discover -s tests 2>&1 | tail -6',
  ];
  const messages = commands.map((command, index) => toolCall(index, 'run_command', { command }));
  messages.push(toolCall('skill', 'save_skill', { name: '检查模板', description: '已验证流程', instructions: '先确认 .env 配置齐全，再运行检查，不显示凭据值。' }));
  messages.push({ role: 'assistant', content: '已完成检查和恢复。' });
  let step = 0, asks = 0, pages = 0, saved = null;
  const result = await runAgent({ settings, workspacePath: root, approvalMode: 'reviewer',
    conversation: [{ role: 'user', content: longContext }],
    requestApproval: async () => { asks++; return false; },
    skillStore: { append: async item => { saved = item; return { ...item, id: 'saved' }; } },
    beforeToolExecute: ({ name, args }) => {
      const hit = findSensitiveReference(args, name);
      return hit ? { action: 'require_approval', reviewable: hit.reviewable === true, message: hit.label } : null;
    },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body), system = body.messages[0].content;
      if (system.includes('安全审核助手')) {
        const text = body.messages.at(-1).content;
        if (system.includes('逐页审核')) { pages++; return response(pageResult('allow', text.includes(authorized) ? authorized : '')); }
        return response('{"decision":"allow","reason":"任务范围内"}');
      }
      return response(messages[step++]);
    } });
  assert.equal(result.status, 'done'); assert.equal(asks, 0); assert.ok(pages > 6);
  assert.equal(await fs.readFile(path.join(root, 'app/client.py'), 'utf8'), 'VALUE = 1\n');
  await assert.rejects(fs.access(path.join(root, 'client.bak')));
  assert.ok(saved?.instructions.includes('.env'));
  const output = JSON.stringify(result);
  assert.match(output, /probe passed/); assert.match(output, /Ran 1 test/);
});
