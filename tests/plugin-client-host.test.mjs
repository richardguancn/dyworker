// 客户端插件宿主（第 2 步）：cordis 容器 + slots / locale / sessions / connection / workspaces。
//
// 验收：真实的 DSH 插件 bundle 能被容器加载并 apply 成功，且它注册的界面贡献真的进了插槽表。
// 同时打印"它调用过但宿主未实现的服务方法"——这是下一步该补什么的直接依据。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClientRuntime } from "../src/pluginRuntime/index.ts";
import { ClientPluginHost, HOST_SLOTS } from "../src/pluginRuntime/clientHost.ts";
import { consumeInputToken } from '../src/pluginRuntime/inputTriggers.ts';

test('输入命令关闭时按真实修订号与完整 token 删除，拒绝旧输入和越界范围', () => {
  assert.equal(consumeInputToken(' /context ', 4, { kind: 'bare-token', token: '/context' }), '');
  assert.equal(consumeInputToken('/context 新内容', 4, { kind: 'bare-token', token: '/context' }), undefined);
  assert.equal(consumeInputToken('/con 保留正文', 4, { kind: 'span', span: { start: 0, end: 4, draftRev: 4 } }), ' 保留正文');
  for (const span of [{ start: 0, end: 4, draftRev: 3 }, { start: -1, end: 4, draftRev: 4 },
    { start: 0, end: 100, draftRev: 4 }, { start: 1, end: 1, draftRev: 4 }, { start: 0.5, end: 4, draftRev: 4 }])
    assert.equal(consumeInputToken('/con 保留正文', 4, { kind: 'span', span }), undefined);
});

test('原样上下文插件实际登记命令与弹窗；菜单、直接发送、关闭、两任务与停用隔离', async () => {
  installDomStub();
  const plugin = loadBundleModule(await fs.readFile(new URL('../node_modules/dsh-context/lib/client.js', import.meta.url), 'utf8'));
  const host = new ClientPluginHost({ sessionProvider: id => ({ id, runtime: id === 'native' ? 'dyworker' : 'dsh' }) });
  const loaded = await host.load(plugin, 'original-context');
  assert.equal(loaded.ok, true, loaded.error);
  assert.ok(loaded.slots.includes('conversation.input.overlay'));
  const contribution = host.contributionsFor('conversation.input.overlay').find(item => item.meta.id === 'context-modal');
  assert.ok(contribution);
  const storeA = contribution.meta.inject('a').hooks.contextModal;
  const storeB = contribution.meta.inject('b').hooks.contextModal;
  const revisions = new Map();
  const consumed = [];
  host.subscribeInputConsumer((id, text) => { consumed.push([id, text]); return true; });
  const signal = new AbortController().signal;
  const items = await host.inputCandidates('a', 'con', 0, '/con', signal);
  assert.equal(items.length, 1); assert.equal(items[0].candidate.name, 'context');
  assert.deepEqual(await host.inputCandidates('a', 'con', 4, '正文 /con', signal), []);
  assert.deepEqual(await host.inputCandidates('native', 'con', 0, '/con', signal), []);
  revisions.set('a', host.setInputDraft('a', '/con 保留正文'));
  assert.throws(() => host.pickInputCandidate('a', items[0], { start: 0, end: 4, draftRev: revisions.get('a') }), /候选已经变化/);
  const currentItems = await host.inputCandidates('a', 'con', 0, '/con 保留正文', signal);
  host.pickInputCandidate('a', currentItems[0], { start: 0, end: 4, draftRev: revisions.get('a') });
  assert.equal(storeA.getSnapshot(), true); assert.equal(storeB.getSnapshot(), false);
  const scopePlugin = { name: 'input-close-check', inject: ['sessions'], apply(ctx) {
    const a = ctx.sessions.scope('a');
    assert.equal(a.bail(a, 'slash/input-consume-token', { guard: { kind: 'span', span: { start: 0, end: 4, draftRev: revisions.get('a') } } }), true);
    assert.equal(a.bail(a, 'slash/input-consume-token', { guard: { kind: 'span', span: { start: 0, end: 4, draftRev: revisions.get('a') } } }), undefined);
  } };
  assert.equal((await host.load(scopePlugin, 'input-close-check')).ok, true);
  assert.deepEqual(consumed, [['a', ' 保留正文']]);
  host.setInputDraft('b', '/context');
  assert.equal(await host.matchInputEnter('b', '/context', 1), true, '打开弹窗不丢弃附件');
  assert.equal(storeB.getSnapshot(), true);
  host.setInputDraft('b', '/context 参数');
  assert.equal(await host.matchInputEnter('b', '/context 参数'), false, '原样插件只接收完整的裸命令');
  await host.unload('original-context');
  assert.deepEqual(await host.inputCandidates('a', 'con', 0, '/con', signal), []);
  assert.equal(host.contributionsFor('conversation.input.overlay').length, 0);
  assert.equal(await host.matchInputEnter('a', '/context'), false);
  await host.dispose();
});

test('输入来源取消与停用不接收迟到候选；不同来源独立注销，命令等待不会误发送旧正文', async () => {
  const host = new ClientPluginHost({ sessionProvider: id => ({ id, runtime: 'dsh' }) });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const make = (name, delayed = false) => ({ name, inject: ['inputTriggers'], apply(ctx) {
    ctx.effect(() => ctx.inputTriggers.registerSource({ trigger: '/', name,
      candidates: async () => delayed ? pending : [{ name }], onPick: () => 'handled',
      matchEnter: async () => delayed ? pending : undefined }));
  } });
  assert.equal((await host.load(make('late', true), 'late')).ok, true);
  assert.equal((await host.load(make('retained'), 'retained')).ok, true);
  const controller = new AbortController();
  const candidates = host.inputCandidates('a', '', 0, '/', controller.signal);
  const rejected = assert.rejects(candidates, /取消/);
  controller.abort(new Error('取消候选')); await rejected;
  host.setInputDraft('a', '/late');
  const command = host.matchInputEnter('a', '/late');
  const cancelled = assert.rejects(command, /变化/);
  host.setInputDraft('a', '新的正文'); await cancelled;
  await host.unload('late'); release([{ name: 'late' }]);
  const remaining = await host.inputCandidates('a', '', 0, '/', new AbortController().signal);
  assert.deepEqual(remaining.map(item => item.candidate.name), ['retained']);
  await host.dispose();
});

test('停用来源甲不会取消来源乙的命令；Escape 只取消对应任务的输入等待', async () => {
  const host = new ClientPluginHost({ sessionProvider: id => ({ id, runtime: 'dsh' }) });
  let entered; const started = new Promise(resolve => { entered = resolve; });
  let complete; const answer = new Promise(resolve => { complete = resolve; });
  const source = name => ({ name, inject: ['inputTriggers'], apply(ctx) {
    ctx.effect(() => ctx.inputTriggers.registerSource({ trigger: '/', name,
      candidates: async () => [], onPick: () => 'handled', matchEnter: async (_session, line) => {
        if (name !== 'second') return undefined;
        entered(); return line === '/pending' ? new Promise(() => {}) : answer;
      } }));
  } });
  await host.load(source('first'), 'first'); await host.load(source('second'), 'second');
  host.setInputDraft('a', '/second'); const command = host.matchInputEnter('a', '/second');
  await started; await host.unload('first'); complete('handled');
  assert.equal(await command, true);
  host.setInputDraft('b', '/pending'); const waiting = host.matchInputEnter('b', '/pending');
  const stopped = assert.rejects(waiting, /已取消/);
  assert.equal(host.cancelInput('a'), false); assert.equal(host.cancelInput('b'), true);
  await stopped; await host.dispose();
});

test('子任务目录按所属根合并真实投影，根列表不增加，切换与迟到结果不串任务', async () => {
  const previous = globalThis.dyworker;
  const opened = []; let release;
  const host = new ClientPluginHost({ onOpenSession: id => opened.push(id) });
  let items = [{ id: 'root-a', runtime: 'dsh', title: '甲', messages: [{}] },
    { id: 'root-b', runtime: 'dsh', title: '乙', messages: [{}] }];
  host.setCollections(() => ({ items, current: items[0] }), () => ({ items: [], current: null }));
  globalThis.dyworker = { dshOperation: async ({ sessionId, action }) => {
    if(action==='global-list')return {ok:true,value:{items:[
      {sessionId:'root-a',updatedAt:1,blank:false,agentAvailable:false,running:false},
      {sessionId:'root-b',updatedAt:0,blank:false,agentAvailable:false,running:false},
      {sessionId:'child-a',updatedAt:0,blank:false,agentAvailable:false,running:false,parentSessionId:'root-a',origin:'subagent',
       projections:{kind:'cached',values:{contextTimeline:{total:123},subagent:{mode:'one-shot'}}}}],
      rootIdBySession:{'root-a':'root-a','root-b':'root-b','child-a':'root-a'},addresses:{'child-a':{childSessionId:'child-a',parentSessionId:'root-a',mode:'one-shot'}},draftRootIds:[]}};
    assert.equal(action, 'family');
    if (sessionId === 'root-b') return new Promise(resolve => { release = resolve; });
    return { ok: true, value: { byId: {
      'root-a': { id: 'root-a', rootSessionId: 'root-a', projectionValues: { subagentCatalog: [{ id: 'child-a' }] } },
      'child-a': { id: 'child-a', rootSessionId: 'root-a', parentId: 'root-a', origin: 'subagent',
        displayTitle: '真实子任务', projectionValues: { contextTimeline: { total: 123 }, subagent: { mode: 'one-shot' } } },
    } } };
  } };
  try {
    const result=await host.load({ name: 'family-reader', inject: ['sessions', 'uiWorkspace'], async apply(ctx) {
      await ctx.sessions.refresh();
      const list = ctx.sessions.list.getSnapshot();
      assert.deepEqual(list.ids, ['root-a','child-a','root-b']);
      assert.deepEqual(host.sessionListStore.getSnapshot().ids,['root-a','root-b']);
      assert.equal(list.byId['child-a'].projectionValues.contextTimeline.total, 123);
      assert.equal(ctx.uiWorkspace.openSession('child-a'), true);
    } }, 'family-reader');assert.equal(result.ok,true,result.error);
    assert.deepEqual(opened, ['child-a']);
    assert.equal(host.subagent('child-a').rootSessionId, 'root-a');
    assert.equal(host.subagent('root-a'), undefined);
    await assert.rejects(host.refreshSubagents('native'), /不是已登记/);
    const late = host.refreshSubagents('root-b');
    items = [items[0]]; host.setCollections(() => ({ items, current: items[0] }), () => ({ items: [], current: null }));
    release({ ok: true, value: { byId: { 'child-b': { id: 'child-b', rootSessionId: 'root-b', parentId: 'root-b' } } } });
    await late;
    assert.equal(host.sessionListStore.getSnapshot().byId['child-b'], undefined);
    assert.ok(host.subagent('child-a'));
  } finally { await host.dispose(); globalThis.dyworker = previous; }
});

test('总览的标准列表稳定订阅、保留归档与工作区成员，卡片跳转到对应任务', async () => {
  const previous=globalThis.dyworker;
  globalThis.dyworker={dshOperation:async input=>{assert.equal(input.action,'global-list');return {ok:true,value:{items:[
    {sessionId:'a',cwd:'/real/project',updatedAt:2,blank:false,agentAvailable:false,running:false,projections:{kind:'cached',values:{title:'存档任务甲'}}},
    {sessionId:'b',updatedAt:1,blank:false,agentAvailable:false,running:false,projections:{kind:'cached',values:{title:'存档任务乙'}}}],
    rootIdBySession:{a:'a',b:'b'},addresses:{},draftRootIds:[]}};}};
  const selected = [];
  const host = new ClientPluginHost({ onOpenSession: id => selected.push(id) });
  let notifications = 0;
  const unsubscribe = host.sessionListStore.subscribe(() => notifications++);
  host.setCollections(() => ({ items: [
    { id: 'a', runtime: 'dsh', title: '任务甲', workspacePath: '/real/project', messages: [{}] },
    { id: 'b', runtime: 'dsh', title: '任务乙', messages: [{}] },
    { id: 'native', runtime: 'dyworker', title: '普通任务', messages: [{}] },
  ], current: { id: 'b' } }), () => ({ items: [{ title: '真实工作区', sessionIds: ['a'] }], current: null, archivedSessionIds: ['a'] }));
  const baseline = host.sessionListStore.getSnapshot();
  assert.equal(baseline, host.sessionListStore.getSnapshot(), '未更新时返回同一快照，避免渲染循环');
  assert.deepEqual(baseline.ids, ['a', 'b']);
  assert.equal(baseline.current, 'b');
  assert.equal(baseline.byId.a.projectionValues, undefined, '缺少真实统计时不生成估算数');
  assert.deepEqual(host.workspaceListStore.getSnapshot().archivedSessionIds, ['a']);
  const result = await host.load({ name: 'overview-consumer', inject: ['sessions', 'uiWorkspace', 'locale'], async apply(ctx) {
    await ctx.sessions.refresh();
    const catalog=ctx.sessions.list.getSnapshot();
    assert.equal(catalog,ctx.sessions.list.getSnapshot());
    assert.deepEqual(catalog.ids,['a','b']);assert.equal(catalog.byId.a.title,'存档任务甲');
    assert.equal(host.sessionListStore.getSnapshot().byId.a.title,'任务甲');
    assert.deepEqual(ctx.locale.getLocale(), { active: 'zh' });
    assert.equal(ctx.uiWorkspace.openSession('b'), true);
    assert.equal(ctx.uiWorkspace.openSession('missing'), false);
  } }, 'overview-consumer');
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(selected, ['b']); assert.ok(notifications > 0);
  unsubscribe(); await host.dispose();globalThis.dyworker=previous;
});

test('目录读取期间的新更新会再次读取；同名根重新打开拒绝旧结果且保留新读取', async () => {
  const previous = globalThis.dyworker;
  let items = [{id:'root',runtime:'dsh',messages:[{}]}];
  const host = new ClientPluginHost({sessionProvider:id=>items.find(item=>item.id===id)});
  const update=()=>host.setCollections(()=>({items,current:items[0]}),()=>({items:[],current:null}));
  update();
  const reads=[];
  globalThis.dyworker={dshOperation:input=>{
    assert.equal(input.action,'family');assert.equal(input.sessionId,'root');
    return new Promise(resolve=>reads.push(resolve));
  }};
  const answer=(id,running)=>({ok:true,value:{byId:{[id]:{id,rootSessionId:'root',parentId:'root',running}}}});
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  try {
    const first=host.refreshSubagents('root');
    assert.equal(host.refreshSubagents('root'),first);
    reads[0](answer('child',true));await tick();
    assert.equal(reads.length,2,'第二次更新不能被正在进行的第一次读取吞掉');
    reads[1](answer('child',false));await first;
    assert.equal(host.subagent('child').running,false);
    const retired=host.refreshSubagents('root');
    items=[];update();items=[{id:'root',runtime:'dsh',messages:[{}]}];update();
    const current=host.refreshSubagents('root');assert.notEqual(retired,current);
    assert.equal(reads.length,4);
    reads[2](answer('retired-child',true));await retired;
    assert.equal(host.subagent('retired-child'),undefined);
    assert.equal(host.refreshSubagents('root'),current,'旧读取完成不能移除新读取');
    reads[3](answer('current-child',true));await tick();assert.equal(reads.length,5);
    reads[4](answer('current-child',false));await current;
    assert.equal(host.subagent('current-child').running,false);
    assert.equal(host.subagent('retired-child'),undefined);
  } finally {await host.dispose();globalThis.dyworker=previous;}
});

/**
 * 最小 DOM 桩：真实插件会碰 window.location / document（Node 里没有）。
 * 应用里有真 DOM，这里只是让同一套断言能在 Node 里跑。
 */
function installDomStub() {
  const noop = () => {};
  const element = () => ({
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, removeAttribute: noop, appendChild: noop, removeChild: noop, remove: noop,
    addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
  });
  globalThis.window = {
    location: { origin: "http://localhost", href: "http://localhost/", pathname: "/", search: "", hash: "" },
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    setTimeout, clearTimeout, innerWidth: 1440, innerHeight: 900,
  };
  globalThis.document = {
    addEventListener: noop, removeEventListener: noop, createElement: element,
    documentElement: element(), body: element(), head: element(),
    querySelector: () => null, querySelectorAll: () => [],
  };
  // Node 22 自带 navigator 且只读，不要赋值
}

/** 用加载器执行真实 bundle，拿到它的 cordis 插件导出 */
function loadBundleModule(source) {
  const target = {};
  const runtime = createClientRuntime({ target });
  new Function("window", "globalThis", source)(target, globalThis);
  const record = runtime.loader.bundles_()[0];
  assert.equal(record.error, undefined, `bundle 执行失败：${record.error}`);
  return record.exports;
}

async function findRealBundles() {
  const roots = [
    path.join(os.homedir(), ".dsh", "profiles", "desktop"),
    path.join(os.homedir(), ".dsh", "profiles", "web"),
  ];
  const found = [];
  for (const root of roots) {
    for (const spec of await fs.readdir(path.join(root, "node_modules")).catch(() => [])) {
      if (spec.startsWith(".") || spec.startsWith("@")) continue;
      const pkgDir = path.join(root, "node_modules", spec);
      const manifest = JSON.parse(await fs.readFile(path.join(pkgDir, "package.json"), "utf8").catch(() => "{}"));
      if (!manifest?.dsh?.client) continue;
      const file = path.join(pkgDir, "lib", "client.js");
      const source = await fs.readFile(file, "utf8").catch(() => null);
      if (source) found.push({ spec, source });
    }
  }
  return found;
}

test("容器：插槽注册与渲染顺序（order / priority）", async () => {
  const host = new ClientPluginHost();
  const plugin = {
    name: "demo",
    inject: ["slots", "locale"],
    apply(ctx) {
      ctx.effect(() => ctx.locale.register("demo", { zh: { hello: "你好 {name}" }, en: { hello: "hi {name}" } }));
      const t = ctx.locale.bind("demo");
      assert.equal(t("hello", { name: "世界" }), "你好 世界", "文案绑定要能取到并代入参数");
      ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
        name: "sidebar.right.pane.tab", id: "second", order: 2,
      }, () => null));
      ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
        name: "sidebar.right.pane.tab", id: "first", order: 1,
      }, () => null));
      // 宿主没提供的插槽：inject 不应执行注册回调
      ctx.slots.inject("unknown.unserved.slot", () => {
        throw new Error("宿主没提供的插槽不该执行注册回调");
      });
    },
  };

  const record = await host.load(plugin, "demo");
  assert.equal(record.ok, true, record.error);
  assert.deepEqual(record.slots, ["sidebar.right.pane.tab"]);
  const contributions = host.contributionsFor("sidebar.right.pane.tab");
  assert.deepEqual(contributions.map((item) => item.meta.id), ["first", "second"], "order 小的排前面");
  assert.deepEqual(host.slotNames(), ["sidebar.right.pane.tab"]);
});

test("容器：插件出错只记录，不影响其它插件与宿主", async () => {
  const host = new ClientPluginHost();
  const broken = { name: "broken", inject: ["slots"], apply() { throw new Error("故意炸"); } };
  const bad = await host.load(broken, "broken");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /故意炸/);

  const good = { name: "good", inject: ["slots"], apply(ctx) { ctx.slots.register({ name: "settings.section", id: "g" }, () => null); } };
  const ok = await host.load(good, "good");
  assert.equal(ok.ok, true, ok.error);
  assert.deepEqual(host.contributionsFor("settings.section").map((item) => item.meta.id), ["g"]);
});

test("容器：未实现的服务方法被记名，而不是静默失效", async () => {
  const host = new ClientPluginHost();
  const plugin = {
    name: "probe",
    inject: ["sessions"],
    apply(ctx) { ctx.sessions.someFutureMethod({ a: 1 }); },
  };
  const record = await host.load(plugin, "probe");
  assert.equal(record.ok, false);
  assert.match(record.error, /暂不支持/);
  assert.ok(record.missingCalls.some((call) => call.includes("someFutureMethod")),
    `未实现的方法要记名，实际：${JSON.stringify(record.missingCalls)}`);
});

// 真实插件在 Node 里的容器行为不在这里断言：它们的异步 effect 会碰 DOM / 路由，
// 且会以自身错误处理器 + 非零退出码结束进程。真实插件的容器验收放在应用里做
// （那里有真 DOM 与我们的界面容器），见插件页「加载界面半边」的实测结果。

test("宿主声明的插槽与右侧面板/设置页对应（第 2 步的接线位置）", () => {
  // 这些是宿主真的会渲染的位置：右侧面板标签、标签标题、设置分区
  assert.ok(HOST_SLOTS.includes("sidebar.right.pane.tab"), "右侧面板标签是本步的主目标");
  assert.ok(HOST_SLOTS.includes("settings.section"));
});

test('停用界面插件只收回自己的文案和贡献，不覆盖另一插件同名登记', async () => {
  const host=new ClientPluginHost();
  const make=value=>({inject:['locale','slots'],apply(ctx){
    ctx.locale.register('shared',{zh:{label:value}});
    ctx.slots.register({name:'settings.section',id:'same'},()=>null);
  }});
  assert.equal((await host.load(make('甲'),'a')).ok,true);
  assert.equal((await host.load(make('乙'),'b')).ok,true);
  assert.equal(host.contributionsFor('settings.section').length,2);
  assert.equal(host.ctx.locale.bind('shared')('label'),'乙');
  await host.unload('a');
  assert.equal(host.ctx.locale.bind('shared')('label'),'乙');
  assert.equal(host.contributionsFor('settings.section').length,1);
  await host.unload('b');
  assert.equal(host.ctx.locale.bind('shared')('label'),'label');
});
