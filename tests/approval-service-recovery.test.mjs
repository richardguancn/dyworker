import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { evaluateApproval, isReviewerAutoApprovableCommand, matchStandingRule, reviewApproval, runAgent, suggestStandingRule } from '../electron/agent.mts';

const settings = { endpoint: 'http://main.mock/v1/chat/completions', model: 'main', apiKey: 'main-test',
  reviewerBackend: 'custom', reviewerEndpoint: 'http://review.mock/v1/chat/completions', reviewerModel: 'review', reviewerApiKey: 'review-test' };
const response = content => ({ ok: true, json: async () => ({ choices: [{ message: typeof content === 'object' && content ? content : { role: 'assistant', content } }] }) });
const allow = '{"decision":"allow","reason":"属于已授权的项目清理"}';
const command = `cd /workspace/jie2 && docker exec jie2-verify bash -lc "grep -rn 'wl_surface\\|wl_display' /usr/include/aarch64-linux-gnu/qt6/ 2>/dev/null | grep -v '\\.p:' | head -8; echo '---'; grep -rn 'QNativeInterface' /usr/include/aarch64-linux-gnu/qt6/QtGui/qguiapplication.h 2>/dev/null | head -5"`;

test('截图中的容器头文件查询可直接核对，显式限制和只读模式仍优先', () => {
  assert.equal(isReviewerAutoApprovableCommand(command), true);
  assert.equal(evaluateApproval({ name: 'run_command', args: { command }, approvalMode: 'reviewer' }), 'allow');
  assert.equal(evaluateApproval({ name: 'run_command', args: { command }, approvalMode: 'reviewer', hookRequiresApproval: true }), 'ask');
  assert.equal(evaluateApproval({ name: 'run_command', args: { command }, approvalMode: 'deny-changes' }), 'deny');
});

test('实际运行截图的头文件过滤步骤，读取代表性文件并检查输出', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-header-query-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const headers = path.join(root, 'aarch64-linux-gnu/qt6/QtGui');
  await fs.mkdir(headers, { recursive: true });
  await fs.writeFile(path.join(headers, 'qguiapplication.h'), 'struct wl_surface;\nstruct wl_display;\nnamespace QNativeInterface {}\n');
  // 用本地函数替代容器连接，只验证原来的引用、管道、匹配表达式和实际输出。
  const local = command.replace('/workspace/jie2', root).replaceAll('/usr/include', root);
  const output = execFileSync('/bin/sh', ['-c', `docker() { shift; shift; "$@"; }; ${local}`], { encoding: 'utf8' });
  assert.match(output, /wl_surface/); assert.match(output, /wl_display/); assert.match(output, /QNativeInterface/);
});

test('容器查询夹带变更、展开、越界读取、特殊执行选项时不能直接通过', () => {
  const script = text => `docker exec jie2-verify bash -lc '${text}'`;
  for (const value of [
    command + '; touch changed', command + ' > result.txt', command + ' &',
    command.replace('docker exec', 'docker exec --privileged'), command.replace('docker exec', 'docker -H tcp://remote exec'),
    script('grep -rn Qt /usr/include/; rm -f important'), script('grep -rn Qt /usr/include/ > result'),
    script('grep -rn Qt /usr/include/; cat /root/.ssh/id_rsa'), script('grep -rn Qt /usr/include/; env'),
    script('grep -rn Qt /usr/include/../../etc/'), script('grep -rn Qt /workspace/private/'),
    script('grep -rn Qt /usr/include/; head -8 private.txt'), script('grep -rn Qt /usr/include/; rg --pre ./evil'),
    script('grep -rn "$(touch bad)" /usr/include/'), script('grep -rn `touch bad` /usr/include/'),
    script('grep -rn Qt /usr/include/ 3>/dev/null'), script('grep -rn Qt /usr/include/ < input'),
    script('grep -rn Qt /usr/include/ |'), command + ' "',
  ]) assert.equal(isReviewerAutoApprovableCommand(value), false, value);
});

test('专用审核额度耗尽时用当前模型核对完整材料，成功后不转人工', async () => {
  const calls = [];
  const action = { kind: 'delete_file', details: 'src/ui/wayland_layer.cpp' };
  let original;
  const result = await reviewApproval({ settings, action, context: '删除已废弃的 Wayland 实现；保留其他文件。',
    fetchImpl: async (url, options) => {
      calls.push(url);
      const body = JSON.parse(options.body);
      if (!original) original = body.messages;
      else assert.deepEqual(body.messages, original);
      if (calls.length === 1) return { ok: false, status: 403, text: async () => 'You have reached your 5-hour usage limit. quota' };
      assert.equal(body.model, 'main');
      assert.equal(options.headers.Authorization, 'Bearer main-test');
      return response(allow);
    } });
  assert.equal(result.decision, 'allow'); assert.equal(calls.length, 2);
  assert.match(result.reason, /当前任务模型复核/);
});

test('专用审核超时后切换，迟到的允许不能覆盖复核拒绝', async () => {
  let late, firstSignal, calls = 0;
  const started = Date.now();
  const result = await reviewApproval({ settings, modelTimeoutMs: 160,
    fetchImpl: async (_url, options) => {
      calls++;
      if (calls === 1) { firstSignal = options.signal; return new Promise(resolve => { late = resolve; }); }
      return response('{"decision":"deny","reason":"用户禁止删除"}');
    } });
  assert.equal(result.decision, 'deny'); assert.equal(calls, 2); assert.equal(firstSignal.aborted, true);
  assert.ok(Date.now() - started < 1500);
  late(response(allow)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.decision, 'deny');
});

test('明确询问、拒绝、格式问题不能换模型寻求允许；同一服务也不重复切换', async () => {
  for (const content of ['{"decision":"ask","reason":"需要用户确认范围"}', '{"decision":"deny","reason":"用户禁止"}', 'invalid']) {
    const urls = [];
    const result = await reviewApproval({ settings, fetchImpl: async url => { urls.push(url); return response(content); } });
    assert.notEqual(result.decision, 'allow'); assert.ok(urls.every(url => url.includes('review.mock')));
  }
  let calls = 0;
  const result = await reviewApproval({ settings: { ...settings, reviewerEndpoint: settings.endpoint, reviewerModel: settings.model, reviewerApiKey: settings.apiKey },
    fetchImpl: async () => { calls++; return { ok: false, status: 403, text: async () => 'quota: usage limit' }; } });
  assert.equal(calls, 1); assert.equal(result.decision, 'ask'); assert.match(result.reason, /额度已用完/);
  assert.doesNotMatch(result.reason, /403|quota/);
});

test('停止不触发复核，两路均不可用时仍不允许执行', async () => {
  const controller = new AbortController(); let calls = 0;
  const stopped = await reviewApproval({ settings, signal: controller.signal, fetchImpl: async () => {
    calls++; controller.abort(new Error('用户停止')); return new Promise(() => {});
  } });
  assert.equal(stopped.decision, 'ask'); assert.equal(calls, 1);
  const unavailable = await reviewApproval({ settings, fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'quota exceeded' }) });
  assert.equal(unavailable.decision, 'ask');
});

test('两路都不响应时仍共享原有总等待时间，停止时不会留下有效请求', async () => {
  const signals = [];
  const started = Date.now();
  const result = await reviewApproval({ settings, modelTimeoutMs: 120, fetchImpl: async (_url, options) => {
    signals.push(options.signal); return new Promise(() => {});
  } });
  assert.equal(result.decision, 'ask'); assert.match(result.reason, /审核等待超时/);
  assert.equal(signals.length, 2); assert.ok(signals.every(signal => signal.aborted));
  assert.ok(Date.now() - started < 1000);
});

test('删除不生成按扩展名授权，旧的删除通配规则也不再生效', () => {
  for (const file of ['src/ui/wayland_layer.cpp', 'scripts/test-single-instance.sh']) {
    assert.equal(suggestStandingRule('delete_file', { path: file }), null);
    assert.equal(matchStandingRule([{ kind: 'path-glob', tool: 'delete_file', pattern: '*' }], 'delete_file', { path: file }), false);
  }
});

test('实际删除两个文件，审核故障得到复核后才删除，另一个文件的拒绝仍生效', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-review-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src/ui'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/ui/wayland_layer.cpp'), 'obsolete');
  await fs.writeFile(path.join(root, 'src/ui/keep.cpp'), 'keep');
  let round = 0, asks = 0, reviews = 0, fallbacks = 0;
  const result = await runAgent({ settings, workspacePath: root, approvalMode: 'reviewer',
    conversation: [{ role: 'user', content: '删除 src/ui/wayland_layer.cpp，必须保留 src/ui/keep.cpp。' }],
    requestApproval: async () => { asks++; return false; },
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.messages[0].content.includes('安全审核助手')) {
        reviews++;
        if (url.includes('review.mock')) return { ok: false, status: 403, text: async () => 'quota exceeded' };
        fallbacks++;
        const text = body.messages.at(-1).content;
        assert.match(text, /必须保留/);
        return response(text.split('详情：\n')[1].includes('"path":"src/ui/keep.cpp"')
          ? '{"decision":"deny","reason":"用户要求保留该文件"}' : allow);
      }
      const file = ['src/ui/wayland_layer.cpp', 'src/ui/keep.cpp'][round++];
      return response(file ? { role: 'assistant', content: null, tool_calls: [{ id: `delete-${round}`, type: 'function',
        function: { name: 'delete_file', arguments: JSON.stringify({ path: file }) } }] } : '完成');
    } });
  assert.equal(result.status, 'done');
  assert.equal(asks, 0); assert.equal(reviews, 4); assert.equal(fallbacks, 2);
  await assert.rejects(fs.access(path.join(root, 'src/ui/wayland_layer.cpp')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, 'src/ui/keep.cpp'), 'utf8'), 'keep');
});

test('人工允许一个文件后，同类文件仍要独立确认，拒绝后保留', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-delete-once-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const file of ['obsolete.cpp', 'keep.cpp']) await fs.writeFile(path.join(root, file), file);
  let round = 0, asks = 0;
  const result = await runAgent({ settings, workspacePath: root, approvalMode: 'reviewer',
    conversation: [{ role: 'user', content: '清理项目中不再需要的文件，删除前让我确认。' }],
    requestApproval: async action => { assert.equal(action.suggestedRule, undefined); return ++asks === 1; },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.messages[0].content.includes('安全审核助手')) return response('{"decision":"ask","reason":"用户要求逐次确认"}');
      if (body.messages[0].content.includes('审批说明撰写助手')) return response('- 删除当前文件');
      const file = ['obsolete.cpp', 'keep.cpp'][round++];
      return response(file ? { role: 'assistant', content: null, tool_calls: [{ id: `delete-${round}`, type: 'function',
        function: { name: 'delete_file', arguments: JSON.stringify({ path: file }) } }] } : '完成');
    } });
  assert.equal(result.status, 'done'); assert.equal(asks, 2);
  await assert.rejects(fs.access(path.join(root, 'obsolete.cpp')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, 'keep.cpp'), 'utf8'), 'keep.cpp');
});

test('无标题窗口原样标签可选中，真实标题改变和窗口消失仍停止', async () => {
  const source = await fs.readFile(new URL('../electron/scripts/macos_computer_use.js', import.meta.url), 'utf8');
  const functions = source.slice(source.indexOf('function processWindows('), source.indexOf('function walkWindow('));
  const select = vm.runInNewContext(functions + '; selectWindow', { norm: value => String(value || '').trim().toLowerCase(), bridgeString: value => String(value || '') });
  const process = title => ({ windows: () => [{ title: () => title }] });
  assert.equal(select(process(''), 'jie2', '1', '（无标题）').title, '');
  assert.throws(() => select(process('New document'), 'jie2', '1', '（无标题）'), /标题已经变化/);
  assert.throws(() => select(process(''), 'jie2', '2', '（无标题）'), /没有找到窗口编号/);
});
