import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientPluginHost } from '../src/pluginRuntime/clientHost.ts';
import { InputTriggerController, detectTrigger } from '../src/pluginRuntime/vendor/dsh-input-controller/index.js';

function bench(t) {
  const sessions = new Map(['a', 'b'].map(id => [id, { id, runtime: 'dsh' }]));
  const host = new ClientPluginHost({ sessionProvider: id => sessions.get(id) });
  const drafts = new Map(); const edits = [];
  host.subscribeInputConsumer((id, text, edit) => { drafts.set(id, text); edits.push({ id, text, edit }); return true; });
  t.after(() => host.dispose());
  return { host, sessions, drafts, edits };
}
async function source(host, definition, id = definition.name) {
  const loaded = await host.load({ name: id, inject: ['inputTriggers'], apply(ctx) {
    ctx.effect(() => ctx.inputTriggers.registerSource(definition));
  } }, id);
  assert.equal(loaded.ok, true, loaded.error);
}
const signal = () => new AbortController().signal;

test('真实官方控制器按保留范围取得，预热和引用订阅各自独立，移除范围后旧控制器不能恢复', async t => {
  const { host, sessions } = bench(t); const warmed = []; const offs = [];
  const listeners = new Map(); let names = ['first'];
  await source(host, { trigger: '/', name: 'catalog', candidates: async () => [], onPick: () => undefined,
    warm: s => warmed.push(s.sessionId), lexicon: () => names,
    subscribeLexicon: (s, notify) => { listeners.set(s.sessionId, notify); return () => offs.push(s.sessionId); },
    codec: { clipboardText: ref => ref, serialize: async (ref, signal) => { signal.throwIfAborted(); return `<actual>${ref}</actual>`; } } });
  const a = host.ctx.sessions.scope('a'); const b = host.ctx.sessions.scope('b');
  const ca = host.ctx.inputTriggers.sessionOf(a); const cb = host.ctx.inputTriggers.sessionOf(b);
  assert.ok(ca instanceof InputTriggerController); assert.notEqual(ca, cb);
  assert.equal(host.ctx.inputTriggers.sessionOf(a), ca); assert.deepEqual(warmed, ['a', 'b']);
  assert.deepEqual(ca.lexicon.getSnapshot().get('/'), ['first']); names = ['second']; listeners.get('a')();
  assert.deepEqual(ca.lexicon.getSnapshot().get('/'), ['second']); assert.deepEqual(cb.lexicon.getSnapshot().get('/'), ['first']);
  assert.equal(await ca.serializeReference('catalog', 'one', signal()), '<actual>one</actual>');
  await assert.rejects(ca.serializeReference('missing', 'one', signal()), /no serializer/);
  assert.throws(() => host.ctx.inputTriggers.sessionOf(host.ctx.extend({ dshSessionId: 'a' })), /仍被保留/);
  sessions.delete('a'); host.setSessionProvider(id => sessions.get(id));
  assert.throws(() => host.ctx.inputTriggers.sessionOf(a), /仍被保留/); assert.equal(ca.menu.getSnapshot().open, false);
  sessions.set('a', { id: 'a', runtime: 'dsh' }); const replacement = host.ctx.sessions.scope('a');
  assert.notEqual(replacement, a); assert.throws(() => host.ctx.inputTriggers.sessionOf(a), /仍被保留/);
  assert.notEqual(host.ctx.inputTriggers.sessionOf(replacement), ca);
  await host.unload('catalog'); assert.ok(offs.includes('a')); assert.ok(offs.includes('b'));
});

test('补全文字走真实事件和范围校验，支持引号路径、目录下钻与返回，陈旧输入不能覆盖新正文', async t => {
  const { host, drafts, edits } = bench(t); const requests = []; const picks = [];
  await source(host, { trigger: '@', name: 'files',
    candidates: async (_s, req) => { requests.push(req); return [{ name: 'directory', drill: true, value: 'dir' }]; },
    header: (_s, req) => req.drilled ? [{ label: '首页', value: '' }, { label: req.query, value: 'dir', current: true }] : undefined,
    onPick: pick => { picks.push(pick); return { text: pick.candidate.value === '' ? '@' : pick.action === 'drill' ? '@"root dir/' : '@"root dir/file.txt" ', continue: pick.action === 'drill' }; } });
  const items = await host.inputCandidates('a', 'f', 0, '@f', signal(), '@');
  const rev = host.setInputDraft('a', '@f');
  host.pickInputCandidate('a', items[0], { start: 0, end: 2, draftRev: rev }, 'drill');
  assert.equal(drafts.get('a'), '@"root dir/'); assert.equal(edits.at(-1).edit.continue, true);
  const text = drafts.get('a'); const hit = detectTrigger(text, text.length, { tier: 'plain' });
  assert.equal(hit.quoted, true); assert.equal(hit.query, 'root dir/');
  const nested = await host.inputCandidates('a', hit.query, hit.span.start, text, signal(), '@', hit.span.end);
  assert.equal(requests.at(-1).drilled, true); assert.equal(requests.at(-1).quoted, true);
  assert.equal(host.inputHeaders('a')[0].label, '首页');
  host.pickInputCrumb('a', 'files', 0); assert.equal(drafts.get('a'), '@'); assert.equal(picks.at(-1).action, 'drill');
  host.setInputDraft('a', '新正文');
  assert.throws(() => host.pickInputCandidate('a', nested[0], { start: 0, end: text.length, draftRev: rev }), /输入已经变化/);
  assert.equal(drafts.get('a'), '@', '消费者没有收到覆盖新正文的事件');
  assert.equal(detectTrigger('mail@example.test', 17, { tier: 'plain' }), null);
  assert.equal(detectTrigger('https://example.test/path', 25, { tier: 'plain' }), null);
});

test('菜单与空格进入真实命令，参数和所属范围正确，成功才消费输入；直接回车在同次提交执行', async t => {
  const { host, drafts } = bench(t); const calls = []; const notices = [];
  const claim = { name: 'echo', token: '/echo ', hint: '填写要记录的文字', submit: async (args, ctx, attachments) => {
    calls.push({ args, id: ctx.dshSessionId, attachments }); return { kind: 'success', text: `实际收到 ${args}` };
  } };
  await source(host, { trigger: '/', name: 'commands', candidates: async () => [{ name: 'echo' }], onPick: () => ({ claim }),
    matchSpace: (_s, token) => token === '/echo' ? { claim } : undefined,
    matchEnter: async (_s, line) => /^\/echo(?:\s|$)/.test(line) ? { claim } : undefined });
  const items = await host.inputCandidates('a', 'ec', 0, '/ec', signal()); const revision = host.setInputDraft('a', '/ec');
  host.pickInputCandidate('a', items[0], { start: 0, end: 3, draftRev: revision });
  assert.equal(drafts.get('a'), '/echo '); assert.equal(host.inputClaim('a').hint, claim.hint); assert.equal(calls.length, 0);
  host.setInputDraft('a', '/echo 第一份参数');
  assert.equal(await host.matchInputEnter('a', '/echo 第一份参数', 0, text => notices.push(text)), true);
  assert.deepEqual(calls[0], { args: '第一份参数', id: 'a', attachments: [] }); assert.equal(drafts.get('a'), '');
  assert.deepEqual(notices, ['实际收到 第一份参数']);
  host.setInputDraft('b', '/echo'); assert.equal(host.matchInputSpace('b', '/echo', 5), true); assert.equal(drafts.get('b'), '/echo ');
  host.setInputDraft('b', '/echo 空格后的参数'); assert.equal(await host.matchInputEnter('b', '/echo 空格后的参数'), true);
  assert.equal(calls[1].id, 'b'); assert.equal(calls[1].args, '空格后的参数');
  host.setInputDraft('a', '/echo 直接回车的参数'); assert.equal(await host.matchInputEnter('a', '/echo 直接回车的参数'), true);
  assert.equal(calls[2].args, '直接回车的参数'); assert.equal(host.inputClaim('a'), undefined);
});

test('命令失败、附件拒绝、等待取消与来源停用均保留输入，不让迟到成功删除新正文', async t => {
  const { host, drafts } = bench(t); let complete; let entered;
  const started = new Promise(resolve => { entered = resolve; }); const pending = new Promise(resolve => { complete = resolve; });
  const claim = { name: 'wait', token: '/wait ', submit: async args => args === 'fail' ? { kind: 'error', text: '真实拒绝原因' } : (entered(), pending) };
  await source(host, { trigger: '/', name: 'waiting', candidates: async () => [{ name: 'wait' }], onPick: () => ({ claim }),
    matchEnter: async () => ({ claim }) });
  host.setInputDraft('a', '/wait fail'); await assert.rejects(host.matchInputEnter('a', '/wait fail'), /真实拒绝原因/);
  assert.equal(host.inputClaim('a').name, 'wait'); assert.equal(drafts.has('a'), false);
  await assert.rejects(host.matchInputEnter('a', '/wait fail', 1), /不接收附件/);
  host.setInputDraft('a', '/wait pending'); const waiting = host.matchInputEnter('a', '/wait pending'); await started;
  const rejected = assert.rejects(waiting, /输入已经变化/); host.setInputDraft('a', '新的要求'); await rejected;
  complete({ kind: 'success', text: '迟到结果' }); await Promise.resolve(); assert.equal(drafts.has('a'), false);
  const items = await host.inputCandidates('b', 'wa', 0, '/wa', signal()); const rev = host.setInputDraft('b', '/wa');
  host.pickInputCandidate('b', items[0], { start: 0, end: 3, draftRev: rev }); await host.unload('waiting');
  assert.equal(host.inputClaim('b').invalid, true); await assert.rejects(host.matchInputEnter('b', '/wait'), /已停用/);
  assert.equal(drafts.get('b'), '/wait ');
});

test('命令选择只接收行首位置，清除前置空白并保留后面的参数，正文中间不取得命令资格', async t => {
  const { host, drafts, edits } = bench(t); const calls = [];
  const claim = { name: 'leading', token: '/leading ', submit: async args => { calls.push(args); return { kind: 'success' }; } };
  await source(host, { trigger: '/', name: 'leading-source', candidates: async () => [{ name: 'leading' }], onPick: () => ({ claim }) });
  const text = '  /lea 原有参数';
  const candidates = await host.inputCandidates('a', 'lea', 2, text, signal(), '/', 6);
  const scope = host.ctx.sessions.scope('a');
  // 来源回调产生的同一资格不允许用越界范围绕过原始 CAS。
  const revision = host.setInputDraft('a', text);
  host.pickInputCandidate('a', candidates[0], { start: 2, end: 6, draftRev: host.setInputDraft('a', text) });
  assert.equal(drafts.get('a'), '/leading  原有参数');
  assert.equal(edits.at(-1).edit.caret, '/leading '.length);
  assert.equal(host.inputClaim('a').name, 'leading');
  await host.matchInputEnter('a', drafts.get('a'));
  assert.deepEqual(calls, [' 原有参数']);
  host.setInputDraft('a', text);
  assert.equal(scope.bail('slash/input-begin-command', { claim, span: { start: -1, end: 6, draftRev: host.setInputDraft('a', text) } }), undefined);
  assert.equal(scope.bail('slash/input-begin-command', { claim, span: { start: 2, end: 6, draftRev: revision } }), undefined);
  const inline = '这是正文 /lea';
  const nested = await host.inputCandidates('b', 'lea', 5, inline, signal(), '/', inline.length);
  host.pickInputCandidate('b', nested[0], { start: 5, end: inline.length, draftRev: host.setInputDraft('b', inline) });
  assert.equal(host.inputClaim('b'), undefined); assert.equal(drafts.has('b'), false);
});
