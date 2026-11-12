import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolveBrowserUploadFiles, findObservedFileNode } from '../electron/browser-upload.mts';
import { macosCoordinateScale } from '../electron/macos-computer-use-server.mts';
import { readReviewObservation, requiresFullParameterReview, reviewActionFacts } from '../electron/approval-context.mts';
import { matchStandingRule, suggestStandingRule } from '../electron/agent/standing-rules.mts';
import { isReviewerEligible, planTaskApproval, reviewApproval } from '../electron/agent/review.mts';
import { BrowserControlManager } from '../electron/browser-control.mts';
import { browserToolDefinitions } from '../electron/browser.mts';
import { classify } from '../electron/risk.mts';
import { browserKeyDefinition } from '../electron/browser-keyboard.mts';
import { foregroundElementClickArgs } from '../electron/linux-computer-use-server.mts';
import { validateDesktopClick } from '../electron/desktop/click-parameters.mts';

test('桌面控件右键与双击保留目标、按键和次数，并拒绝越界或含糊参数', () => {
  const geometry = { x: 100, y: 200, width: 300, height: 200 };
  assert.deepEqual(foregroundElementClickArgs(geometry, { x: 130, y: 260 }, 'right', 1), ['mousemove', '--sync', '130', '260', 'click', '--repeat', '1', '3']);
  assert.deepEqual(foregroundElementClickArgs(geometry, { x: 130, y: 260 }, 'left', 2), ['mousemove', '--sync', '130', '260', 'click', '--repeat', '2', '1']);
  assert.throws(() => foregroundElementClickArgs(geometry, { x: 401, y: 260 }, 'right', 1), /超出/);
  assert.throws(() => validateDesktopClick({ element_index: 'e1', x: 1, y: 2 }), /只能选择/);
  assert.throws(() => validateDesktopClick({ mouse_button: 'invalid' }), /鼠标按键/);
  assert.throws(() => validateDesktopClick({ click_count: 0 }), /点击次数/);
});

test('浏览器快捷键解释修饰键、方向键、删除键和跨平台全选', () => {
  assert.deepEqual(browserKeyDefinition('Shift+Tab'), { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
  assert.equal(browserKeyDefinition('ControlOrMeta+a', 'darwin').modifiers, 4);
  assert.equal(browserKeyDefinition('ControlOrMeta+a', 'linux').modifiers, 2);
  assert.equal(browserKeyDefinition('ArrowLeft').windowsVirtualKeyCode, 37);
  assert.equal(browserKeyDefinition('Delete').windowsVirtualKeyCode, 46);
  assert.deepEqual(browserKeyDefinition('Control+/'), { key: '/', code: 'Slash', windowsVirtualKeyCode: 191, modifiers: 2 });
  assert.deepEqual(browserKeyDefinition('Control++'), { key: '+', code: 'Equal', windowsVirtualKeyCode: 187, modifiers: 10 });
  assert.deepEqual(browserKeyDefinition('Shift+1'), { key: '!', code: 'Digit1', windowsVirtualKeyCode: 49, modifiers: 8 });
  assert.deepEqual(browserKeyDefinition('F24'), { key: 'F24', code: 'F24', windowsVirtualKeyCode: 135, modifiers: 0 });
  assert.throws(() => browserKeyDefinition('Invented+a'), /未知/);
  assert.throws(() => browserKeyDefinition('unknown'), /不支持/);
});

test('上传只接受存在的普通文件，拒绝空列表、目录、越界路径和越界链接', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cu-upload-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const work = path.join(root, 'work'); await fs.mkdir(work);
  await fs.writeFile(path.join(work, '简历.pdf'), '%PDF-1.4\n代表性简历');
  await fs.writeFile(path.join(root, 'outside.pdf'), 'outside');
  await fs.symlink(path.join(root, 'outside.pdf'), path.join(work, 'shortcut.pdf'));
  assert.deepEqual(await resolveBrowserUploadFiles(['简历.pdf'], work), [path.join(work, '简历.pdf')]);
  for (const files of [[], ['.'], ['../outside.pdf'], ['shortcut.pdf'], ['missing.pdf'], [''], [null], Array(21).fill('简历.pdf')]) {
    await assert.rejects(resolveBrowserUploadFiles(files, work));
  }
});

test('文件输入框定位穿透同源子页和 Shadow DOM，不能拿错观察中的文件框', () => {
  const target = { nodeName: 'INPUT', backendNodeId: 44, attributes: ['type', 'file', 'data-dyworker-obs', 'obs-a', 'data-dyworker-ref', '9'] };
  const tree = { children: [{ contentDocument: { children: [{ shadowRoots: [{ children: [target] }] }] } }] };
  assert.equal(findObservedFileNode(tree, 'obs-a', 9), target);
  assert.equal(findObservedFileNode(tree, 'obs-b', 9), null);
  assert.equal(findObservedFileNode(tree, 'obs-a', 8), null);
});

test('Mac 截图坐标使用实际比例并拒绝缺图、过期和越界坐标', () => {
  const capture = { data: 'png', scale: 2, width: 1600, height: 1000, capturedAt: 1000 };
  assert.equal(macosCoordinateScale(capture, { x: 1000, y: 500 }, 2000), 2);
  assert.equal(macosCoordinateScale(capture, { from_x: 20, from_y: 30, to_x: 200, to_y: 300 }, 2000), 2);
  assert.throws(() => macosCoordinateScale(capture, { x: 1600, y: 1 }, 2000), /范围/);
  assert.throws(() => macosCoordinateScale(capture, { x: NaN, y: 1 }, 2000), /范围/);
  assert.throws(() => macosCoordinateScale(capture, { x: 1, y: 1 }, 62000), /重新观察/);
  assert.throws(() => macosCoordinateScale(null, { x: 1, y: 1 }), /重新观察/);
});

test('操作审核优先用不更改观察编号的核对入口，上传仍为需审核的外部操作', async () => {
  const calls = [];
  const result = await readReviewObservation({ name: 'browser__act', args: { observationId: 'original', action: { type: 'upload', files: ['简历.pdf'] } },
    availableNames: browserToolDefinitions().map(tool => tool.function.name),
    execute: async (name, args) => { calls.push({ name, args }); return { ok: true, result: '上传简历页面' }; } });
  assert.equal(result.available, true);
  assert.equal(calls[0].name, 'browser__inspect');
  assert.equal(classify('browser__inspect').consequential, false);
  assert.equal(classify('browser__act', { action: { type: 'upload' } }).consequential, true);
  assert.equal(classify('mcp__computer-use__insert_text').consequential, true);
});

test('读取和审核不消耗连续动作次数，实际动作消耗一次且重复动作不重放', async () => {
  const manager = new BrowserControlManager();
  await manager.acquireControl({ ownerSessionId: 'a', runId: 'r', tabId: 't', workspacePath: '/tmp', webContents: { isDestroyed: () => false, on() {}, once() {} } });
  const context = { ownerSessionId: 'a', runId: 'r' };
  let count = 0;
  manager.session.adapter = { setLeaseChecker() {}, inspect: async () => ({ ok: true }), act: async () => { count++; return { ok: true }; } };
  for (let i = 0; i < 80; i++) assert.equal((await manager.inspect({ context })).ok, true);
  assert.equal(manager.session.actionCount, 0);
  const action = { observationId: 'o', actionId: 'save', action: { type: 'click' }, context };
  await manager.act(action); await manager.act(action);
  assert.equal(count, 1); assert.equal(manager.session.actionCount, 1);
});

test('常驻规则不静默放行 Linux 共享桌面工具，且不影响替我审批自动放行', async () => {
  const rules = [
    { kind: 'plugin-tool', pattern: 'plugin__dyworker_linux_computer_use__click' },
    { kind: 'plugin-tool', pattern: 'plugin__custom_demo__hello' },
    { kind: 'mcp-tool', pattern: 'mcp__computer-use__click' },
  ];
  assert.equal(matchStandingRule(rules, 'plugin__dyworker_linux_computer_use__click', { use_shared_desktop: true }), false);
  assert.equal(suggestStandingRule('plugin__dyworker_linux_computer_use__click', { use_shared_desktop: true }), null);
  assert.equal(matchStandingRule(rules, 'mcp__computer-use__click', {}), false);
  assert.equal(matchStandingRule(rules, 'plugin__custom_demo__hello', {}), true);

  for (const name of [
    'mcp__computer-use__click',
    'mcp__computer-use__launch_app',
    'plugin__dyworker_linux_computer_use__click',
    'browser__open',
  ]) {
    assert.equal(isReviewerEligible({ name, approvalMode: 'reviewer' }), true);
    assert.equal(planTaskApproval({ name, args: {}, approvalMode: 'reviewer', standingRules: rules }), 'review');
  }

  assert.match(reviewActionFacts({ kind: 'plugin__dyworker_linux_computer_use__click', args: { use_shared_desktop: true } }), /当前可见桌面会话/);
  assert.match(reviewActionFacts({ kind: 'mcp__computer-use__launch_app', args: { app: 'Notes', background: false } }), /background=false/);
  assert.match(reviewActionFacts({ kind: 'browser__open', args: { url: 'https://example.com', sessionSource: 'firefox' } }), /sessionSource=firefox/);
  assert.equal(requiresFullParameterReview({ kind: 'plugin__dyworker_linux_computer_use__click', args: { use_shared_desktop: true } }), true);
  assert.equal(requiresFullParameterReview({ kind: 'mcp__computer-use__launch_app', args: { app: 'Notes', background: false } }), true);
  assert.equal(requiresFullParameterReview({ kind: 'mcp__computer-use__launch_app', args: { app: 'Notes', background: true } }), false);
  assert.equal(requiresFullParameterReview({ kind: 'browser__open', args: { url: 'https://example.com', sessionSource: 'auto' } }), true);
  assert.equal(requiresFullParameterReview({ kind: 'browser__open', args: { url: 'https://example.com' } }), false);

  const requests = [];
  const verdict = await reviewApproval({
    settings: { endpoint: 'https://api.example.com/v1', model: 'test-model', apiKey: 'k', reviewerBackend: 'main', reviewerProbability: true },
    context: '用户要求在当前 Linux 桌面点击确认按钮',
    action: {
      kind: 'plugin__dyworker_linux_computer_use__click',
      title: '点击确认',
      args: { use_shared_desktop: true, element_index: 1 },
      details: JSON.stringify({ use_shared_desktop: true, element_index: 1 }),
    },
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body || '{}')));
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '{"decision":"allow","reason":"符合用户当前桌面操作要求"}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(verdict.decision, 'allow');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].logprobs, undefined);
  assert.match(String(requests[0].messages?.[1]?.content || ''), /当前可见桌面会话/);
});
