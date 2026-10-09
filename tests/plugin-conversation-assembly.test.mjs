import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ClientPluginHost} from '../src/pluginRuntime/clientHost.ts';

const event = (seq, type, data = {}) => ({seq, time: seq + 1000, type, data});
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(t) {
  const sessions = new Map(['a','b'].map(id => [id,{id,runtime:'dsh'}]));
  const host = new ClientPluginHost({sessionProvider: id => sessions.get(id)});
  t.after(() => host.dispose());
  return {host,sessions,ui:host.ctx.get('uiConversation')};
}
function view(target = 'ledger', counters = {}) {
  return {target,create() {
    counters.create = (counters.create ?? 0) + 1;
    let nodes = new Map(), snapshot = {nodes:[],timeline:{turnOrder:[],turns:new Map()}};
    let input;
    const readers = {
      readNode: key => nodes.get(key), readTurn: () => [],
      readPosition: key => {const order = [...nodes.keys()], index = order.indexOf(key);return index < 0 ? undefined : {turn:undefined,previous:order[index-1],next:order[index+1]};},
    };
    const set = timeline => snapshot = {nodes:[...nodes.values()],timeline};
    return {
      empty:snapshot,
      replace({nodes:list,timeline}) {
        counters.replace = (counters.replace ?? 0) + 1;
        nodes = new Map(list.map(node => [node.key,node]));
        input = {kind:'replace',order:[...nodes.keys()],timeline,...readers};return set(timeline);
      },
      apply({upserts,timeline,changedTurns=[]}) {
        counters.apply = (counters.apply ?? 0) + 1;
        const changes = upserts.map(current => ({previous:nodes.get(current.key),current}));
        for (const node of upserts) nodes.set(node.key,node);
        input = {kind:'apply',changes,changedTurns,changedTurnOrders:[],order:[...nodes.keys()],timeline,...readers};return set(timeline);
      },
      groupInput: () => input,
    };
  }};
}
function definition(kind = 'record', target = 'ledger') {
  return {kind,target,match:{'test/record': event => ({id:event.data.id,role:'start'})},
    start: (_context,match) => match.event.data.text,
    update: (_context,match) => match.event.data.text,
    buildViewNode: context => ({target,key:context.key,anchorSeq:context.start.event.seq,text:context.state}),
  };
}

test('官方装配源文件原样固定，每个文件均与来源清单校验一致',async()=>{
  const directory = new URL('../vendor/dsh-conversation-assembly/',import.meta.url);
  const manifest = JSON.parse(await fs.readFile(new URL('sources.json',directory),'utf8'));
  assert.equal(manifest.commit,'5badb15009ae1756c3afe0ae0cef1faafc290ccc');
  assert.equal(Object.keys(manifest.sources).length,17);
  for (const [file,digest] of Object.entries(manifest.sources))
    assert.equal(createHash('sha256').update(await fs.readFile(new URL(file,directory))).digest('hex'),digest,file);
});

test('两个任务独立使用官方窗口；重复读取保持身份，尾部增长保留旧节点，改写历史整体重建',async t=>{
  const {host,ui} = setup(t), counters = {};
  ui.events.register(definition());ui.views.register(view('ledger',counters));await tick();
  const a = host.ctx.sessions.binding('a'), b = host.ctx.sessions.binding('b');
  assert.equal(a.sessionId,'a');assert.notEqual(a.eventSource,b.eventSource);
  const original = [event(0,'test/record',{id:'one',text:'任务甲'})];
  host.ingestSessionEvents(original,'a');host.activateSessionView('a','ledger');
  const source = ui.binding(a).target('ledger'), initial = source.getSnapshot(), revision = a.eventSource.getSnapshot().revision;
  assert.equal(host.ingestSessionEvents(structuredClone(original),'a'),true);
  assert.equal(a.eventSource.getSnapshot().revision,revision);assert.equal(source.getSnapshot(),initial);
  host.ingestSessionEvents([event(0,'test/record',{id:'one',text:'任务乙'})],'b');host.activateSessionView('b','ledger');
  assert.equal(ui.binding(b).target('ledger').getSnapshot().nodes[0].text,'任务乙');assert.equal(source.getSnapshot(),initial);
  host.ingestSessionEvents([...original,event(1,'test/record',{id:'two',text:'甲的后续'})],'a');
  const next = source.getSnapshot();assert.equal(next.nodes[0],initial.nodes[0]);assert.equal(next.nodes.length,2);
  assert.equal(a.eventSource.getSnapshot().change.kind,'append');assert.ok(counters.apply > 0);
  host.ingestSessionEvents([event(0,'test/record',{id:'one',text:'修正后的甲'})],'a');
  assert.equal(a.eventSource.getSnapshot().change.kind,'replace');assert.equal(source.getSnapshot().nodes[0].text,'修正后的甲');
  const beforeInvalid = source.getSnapshot();assert.throws(()=>host.ingestSessionEvents([event(0,'test/record'),event(2,'test/record')],'a'),/不连续/);
  assert.equal(source.getSnapshot(),beforeInvalid);assert.equal(host.sessionViewSnapshots('b').get('ledger').nodes[0].text,'任务乙');
});

test('官方前驱状态和无页面状态定义按真实先后参与装配；补入较早记录会更新依赖',async t=>{
  const {host,ui} = setup(t);
  ui.views.register(view());
  ui.events.register({kind:'facts',match:{'test/fact':event=>({id:String(event.seq),role:'start'})},
    start:(_context,match)=>match.event.data.value,update:context=>context.state});
  ui.events.register({kind:'dependent',target:'ledger',match:{'test/use':event=>({id:String(event.seq),role:'start'})},
    start:(_context,_match,reader)=>reader.previous('facts')?.state ?? '尚未加载',update:context=>context.state,
    buildViewNode:context=>({target:'ledger',key:context.key,anchorSeq:context.start.event.seq,text:context.state})});
  await tick();const binding = host.ctx.sessions.binding('a');const source = ui.binding(binding).target('ledger');const off = source.subscribe(()=>{});t.after(off);
  binding.eventSource.replace([{type:'event',event:event(2,'test/use')}],true);
  assert.equal(source.getSnapshot().nodes[0].text,'尚未加载');
  binding.eventSource.prepend([event(0,'test/fact',{value:'最早事实'}),event(1,'test/fact',{value:'最近事实'})].map(event=>({type:'event',event})),false);
  assert.equal(source.getSnapshot().nodes[0].text,'最近事实');
  binding.eventSource.append({type:'event',event:event(3,'test/fact',{value:'未来事实'})});
  assert.equal(source.getSnapshot().nodes[0].text,'最近事实','只能读取严格早于当前起点的状态');
});

test('正式入口与旧登记入口共用原始注册表；停用只移除自身定义，重新加载无残留',async t=>{
  const {host,ui} = setup(t);
  const plugin = {name:'assembly-owner',inject:['uiConversation','conversationEvents','conversationViews'],apply(ctx) {
    ctx.conversationViews.register(view('owned'));
    ctx.conversationEvents.register(definition('owned-record','owned'));
    ctx.uiConversation.events.registerFallback({...definition('owned-fallback','owned'),match:event=>({id:`fallback-${event.seq}`,role:'start'}),start:()=> '未匹配记录'});
  }};
  ui.views.register(view('other'));ui.events.register(definition('other-record','other'));
  assert.equal((await host.load(plugin,'assembly-owner')).ok,true);await tick();
  host.ingestSessionEvents([event(0,'test/record',{id:'own',text:'已登记'})],'a');host.activateSessionView('a','owned');host.activateSessionView('a','other');
  assert.equal(host.sessionViewSnapshots('a').get('owned').nodes[0].text,'已登记');
  assert.throws(()=>ui.views.register(view('owned')),/already registered/);
  await host.unload('assembly-owner');await tick();
  assert.equal(ui.views.entries().some(value=>value.target==='owned'),false);
  assert.equal(ui.events.entries().some(value=>value.kind==='owned-record'),false);assert.equal(ui.events.fallbackEntry(),undefined);
  assert.equal(host.sessionViewSnapshots('a').get('owned'),undefined);assert.equal(host.sessionViewSnapshots('a').get('other').nodes[0].text,'已登记');
  assert.equal((await host.load(plugin,'assembly-owner')).ok,true);await tick();
  assert.equal(host.sessionViewSnapshots('a').get('owned').nodes[0].text,'已登记');
});

test('没有选中页面也能订阅当前回合；页面只在激活后装配，回合关闭同步更新',async t=>{
  const {host,ui} = setup(t), counters = {};
  ui.views.register(view('ledger',counters));ui.events.register(definition());await tick();
  const binding = ui.binding('a');let changes = 0;const stop = binding.openTurn.subscribe(()=>changes++);t.after(stop);
  host.ingestSessionEvents([event(0,'turn/start',{turn:1})],'a');
  assert.equal(binding.openTurn.getSnapshot(),1);assert.equal(counters.create ?? 0,0);
  const target = binding.target('ledger');assert.equal(binding.target('ledger'),target);
  const off = target.subscribe(()=>{});off();assert.equal(counters.create,1);
  host.ingestSessionEvents([event(0,'turn/start',{turn:1}),event(1,'turn/end',{turn:1})],'a');
  assert.equal(binding.openTurn.getSnapshot(),undefined);assert.equal(changes,2);
});

test('官方分组使用每个任务自己的节点与回合状态，独立发布组数据',async t=>{
  const {host,ui} = setup(t);ui.views.register(view());ui.events.register(definition());
  ui.groups.register({kind:'grouping',target:'ledger',create:()=>null,update:(_context,input)=>input,
    buildGroups:({state})=>state ? {entries:[{kind:'group',key:'whole'}],groups:{kind:'replace',snapshots:[{
      key:'whole',data:state.timeline.turns.get(1)?.status,members:state.order.map(key=>({kind:'node',key})),
    }]}} : null});await tick();
  for (const id of ['a','b']) {
    host.ingestSessionEvents([event(0,'turn/start',{turn:1}),event(1,'test/record',{id,text:id})],id);host.activateSessionView(id,'ledger');
  }
  const groupedA = host.sessionViewSnapshots('a').grouped('ledger'), groupedB = host.sessionViewSnapshots('b').grouped('ledger');
  assert.notEqual(groupedA,groupedB);const aSource = groupedA.groupSource('whole'), bSource = groupedB.groupSource('whole');
  assert.equal(aSource.getSnapshot().data,'open');assert.equal(bSource.getSnapshot().data,'open');
  host.ingestSessionEvents([event(0,'turn/start',{turn:1}),event(1,'test/record',{id:'a',text:'a'}),event(2,'turn/end',{turn:1})],'a');
  assert.equal(groupedA.groupSource('whole'),aSource);assert.equal(aSource.getSnapshot().data,'closed');assert.equal(bSource.getSnapshot().data,'open');
});

test('官方事件窗口处理模型临时输出，落盘结算撤掉同次临时块并保留最终内容',async t=>{
  const {host,ui} = setup(t);ui.views.register(view());
  ui.events.register({kind:'assistant',target:'ledger',match: event => event.type==='assistant/live-chunk' || event.type==='assistant/message' ? {id:'answer',role:'start'} : null,
    start: (_context,match) => match.event.data.text,
    update: (_context,match) => match.event.data.text,
    buildViewNode: context => context.start ? {target:'ledger',key:context.key,anchorSeq:context.start.event.seq,text:context.state} : null});await tick();
  const binding = host.ctx.sessions.binding('a');host.activateSessionView('a','ledger');
  binding.eventSource.append({type:'transient',event:event(0.5,'assistant/live-chunk',{attemptId:'attempt',text:'临时内容'})});
  assert.equal(host.sessionViewSnapshots('a').get('ledger').nodes[0].text,'临时内容');
  binding.eventSource.settleAssistant('attempt',{type:'event',event:event(1,'assistant/message',{text:'最终内容'})});
  assert.equal(binding.eventSource.getSnapshot().entries.length,1);assert.equal(host.sessionViewSnapshots('a').get('ledger').nodes[0].text,'最终内容');
});

test('已知子任务与根任务的页面互不覆盖；根任务移除后旧绑定停止订阅，重新打开获得新绑定',async t=>{
  const {host,sessions,ui} = setup(t);const original = globalThis.dyworker;
  globalThis.dyworker = {dshOperation:async()=>({ok:true,value:{byId:{child:{id:'child',rootSessionId:'a',parentId:'a'}}}})};
  t.after(()=>{globalThis.dyworker=original;});
  host.setCollections(()=>({items:[...sessions.values()],current:sessions.get('a')}),()=>({items:[],current:null}));await host.refreshSubagents('a');
  ui.views.register(view());ui.events.register(definition());await tick();
  for (const id of ['a','b','child']) {host.ingestSessionEvents([event(0,'test/record',{id:'same',text:id})],id);host.activateSessionView(id,'ledger');}
  assert.equal(host.sessionViewSnapshots('a').get('ledger').nodes[0].text,'a');assert.equal(host.sessionViewSnapshots('child').get('ledger').nodes[0].text,'child');
  const old = host.ctx.sessions.binding('child'), oldView = ui.binding(old), before = oldView.target('ledger').getSnapshot();
  const oldRoot = host.ctx.sessions.binding('a');
  sessions.delete('a');host.setSessionProvider(id=>sessions.get(id));await old.ctx.fiber.dispose();
  assert.throws(()=>ui.binding(old),/inactive/);assert.equal(host.ctx.sessions.binding('child'),undefined);
  old.eventSource.append({type:'event',event:event(1,'test/record',{id:'late',text:'迟到数据'})});
  assert.equal(oldView.target('ledger').getSnapshot(),before);assert.equal(host.sessionViewSnapshots('b').get('ledger').nodes[0].text,'b');
  sessions.set('a',{id:'a',runtime:'dsh'});host.setSessionProvider(id=>sessions.get(id));
  assert.notEqual(host.ctx.sessions.binding('a'),old);assert.equal(ui.binding('a').target('ledger').getSnapshot(),undefined);
  assert.equal(host.ingestSessionEvents([event(0,'test/record',{id:'stale',text:'旧请求的迟到结果'})],'a',oldRoot),false);
  host.activateSessionView('a','ledger');assert.deepEqual(ui.binding('a').target('ledger').getSnapshot().nodes,[]);
});
