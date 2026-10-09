import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {createOfficialDshContext} from '../electron/host/dsh-runtime/official-context.mts';
import {searchDshSessions} from '../electron/host/dsh-runtime/global-search.mts';
import {OfficialDshSession} from '../electron/host/dsh-runtime/full-session.mts';
import {createHost,disposeHost} from '../electron/host/context.mts';
import {ClientPluginHost} from '../src/pluginRuntime/clientHost.ts';
import {RemoteError} from '../src/pluginRuntime/vendor/dsh-session-controller/index.js';
import {createHistoryRelay} from '../electron/host/dsh-runtime/history-relay.mts';
import {EventEmitter} from 'node:events';

const signal=()=>new AbortController().signal;
const message=(session,text)=>session.append('user/message',createUserMessage({content:[{type:'text',text}],source:{kind:'user'}}),{surfaceOp:'append'});
async function directory(){return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-global-search-')));}
async function persist(ctx,session){const handle=await ctx.sessionPersistence.create(session.header);try{await handle.append(session.snapshotEvents());await handle.flush();}finally{await handle.close();}}

test('跨任务搜索在一个原始排名中返回最多二十项，未登记的高匹配任务不能参与排名；无模型或写入',async t=>{
  const dir=await directory(),ctx=await createOfficialDshContext({dataDir:dir,workspacePath:dir});
  t.after(async()=>{await ctx.fiber.dispose();await fs.rm(dir,{recursive:true,force:true});});
  const roots=[];
  for(let i=0;i<27;i++){
    const id=`root-${i}`,session=ctx.sessions.create(id,{meta:{cwd:dir}});
    message(session,`corpusmarker ${i} ${'corpusmarker '.repeat(i%5)}`);await persist(ctx,session);roots.push({id,runtime:'dsh',workspacePath:dir});
  }
  const expected=await ctx.sessionQuery.searchSessions({query:'corpusmarker',limit:20,eventFilters:[{kind:'type',values:['user/message','assistant/message']},{kind:'surface',values:['current']}]},{signal:signal()});
  for(let i=0;i<65;i++){
    const outside=ctx.sessions.create(`outside-${i}`,{meta:{cwd:dir}});message(outside,'corpusmarker corpusmarker corpusmarker corpusmarker corpusmarker');await persist(ctx,outside);
  }
  await ctx.sessionPersistence.flush();
  const before=await ctx.sessionPersistence.list();
  const request=query=>searchDshSessions({dir,query,signal:signal(),roots:async()=>roots,active:()=>({persistenceContext:ctx})});
  const result=await request(' corpusmarker ');
  assert.equal(result.items.length,20);assert.equal(result.hasMore,true);
  assert.ok(result.items.every(item=>roots.some(root=>root.id===item.sessionId)));
  assert.deepEqual(result.items.map(item=>item.sessionId),expected.items.map(hit=>hit.header.id));
  assert.deepEqual(await request('missingmarker'),{items:[],hasMore:false});
  assert.deepEqual(await ctx.sessionPersistence.list(),before);assert.equal(ctx.agents.list().length,0);
  let activeCalls=0;
  for(const query of ['', ' ', 'x'.repeat(501), 'x\0y', null])
    await assert.rejects(searchDshSessions({dir,query,signal:signal(),roots:async()=>roots,active:()=>{activeCalls++;}}),error=>error.code==='gateway/bad-request');
  assert.equal(activeCalls,0);
  const controller=new AbortController();controller.abort(new Error('取消跨任务搜索'));
  await assert.rejects(searchDshSessions({dir,query:'corpusmarker',signal:controller.signal,roots:async()=>roots,active:()=>({persistenceContext:ctx})}),/取消跨任务搜索/);
});

test('真实应用两处工作区、原始子任务与冷重启可一起搜索；搜索不打开运行进程，删除根后不可再见',{timeout:30000},async t=>{
  const dir=await directory(),host=await createHost({userDataDir:dir,mountPlugins:true});
  const workA=path.join(dir,'workspace-a'),workB=path.join(dir,'workspace-b');await fs.mkdir(workA);await fs.mkdir(workB);
  let calls=0,rootCalls=0,runtime;
  t.after(async()=>{await runtime?.close();await disposeHost(host);await fs.rm(dir,{recursive:true,force:true});});
  for(const [id,workspacePath] of [['global-root-a',workA],['global-root-b',workB],['native-draft',workA]])
    await host.sessions.upsert({id,runtime:'dsh',workspacePath,title:id,messages:[]});
  const dataDir=id=>path.join(host.dshRuntime.config.dir,createHash('sha256').update(id).digest('hex'));
  runtime=new OfficialDshSession({profileDir:host.plugins.dir,dataDir:dataDir('global-root-a'),workspacePath:workA,sessionId:'global-root-a',plugins:[],approve:async()=>true,
    async *generate(request){calls++;if(request.sessionId==='global-root-a'&&++rootCalls===1){yield {type:'block-start',index:0,blockType:'tool-call'};
      yield {type:'block-end',index:0,block:{type:'tool-call',id:'real-child',name:'subagent',arguments:JSON.stringify({description:'真正子任务',prompt:'nestedglobalmarker child',run_in_background:false})}};
      yield {type:'finish',reason:{kind:'tool-calls'}};return;}
      const value=request.sessionId==='global-root-a'?'workspaceglobalmarker parent':'nestedglobalmarker child';
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:value}};yield {type:'finish',reason:{kind:'stop'}};}});
  await runtime.start();await runtime.request('prompt',{text:'workspaceglobalmarker A'});const family=await runtime.request('family');
  const child=Object.values(family.byId).find(row=>row.parentId);assert.ok(child);
  await runtime.close();runtime=undefined;
  const b=new OfficialDshSession({profileDir:host.plugins.dir,dataDir:dataDir('global-root-b'),workspacePath:workB,sessionId:'global-root-b',plugins:[],
    async *generate(){calls++;yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:'workspaceglobalmarker B'}};yield {type:'finish',reason:{kind:'stop'}};}});
  try{await b.start();await b.request('prompt',{text:'workspaceglobalmarker B'});}finally{await b.close();}
  const modelCount=calls;
  const search=query=>host.dshRuntime.request('','global-search',{query});
  assert.deepEqual(new Set((await search('workspaceglobalmarker')).items.map(row=>row.sessionId)),new Set(['global-root-a','global-root-b']));
  assert.ok((await search('nestedglobalmarker')).items.some(row=>row.sessionId===child.id));
  assert.equal(host.dshRuntime.sessions.size,0);assert.equal(calls,modelCount);
  const restarted=await search('workspaceglobalmarker');assert.equal(restarted.items.length,2);assert.equal(host.dshRuntime.sessions.size,0);
  await host.sessions.applyDelta({removed:['global-root-a'],order:['global-root-b','native-draft']});
  assert.deepEqual((await search('workspaceglobalmarker')).items.map(row=>row.sessionId),['global-root-b']);
  assert.deepEqual(await search('nestedglobalmarker'),{items:[],hasMore:false});assert.equal(calls,modelCount);
});

test('搜索拒绝错误父任务、重复目录、损坏存档及中途删除，异常不降成空结果',async t=>{
  const dir=await directory(),ctx=await createOfficialDshContext({dataDir:dir,workspacePath:dir});
  t.after(async()=>{await ctx.fiber.dispose();await fs.rm(dir,{recursive:true,force:true});});
  const root=ctx.sessions.create('checked-root',{meta:{cwd:dir}});message(root,'checkedmarker');
  root.append('subagent/catalog',{version:0,childId:'wrong-child',childCreatedAt:Date.now(),mode:'one-shot'});
  const child=ctx.sessions.create('wrong-child',{meta:{cwd:dir,origin:'subagent',parentSession:'another-parent'}});message(child,'checkedmarker');
  await persist(ctx,root);await persist(ctx,child);
  const roots=[{id:root.id,runtime:'dsh',workspacePath:dir}];
  await assert.rejects(searchDshSessions({dir,query:'checkedmarker',signal:signal(),roots:async()=>roots,active:()=>({persistenceContext:ctx})}),/父任务不匹配/);
  const clean=ctx.sessions.create('clean-root',{meta:{cwd:dir}});message(clean,'checkedmarker');await persist(ctx,clean);
  const cleanRows=[{id:clean.id,runtime:'dsh',workspacePath:dir}];let reads=0;
  await assert.rejects(searchDshSessions({dir,query:'checkedmarker',signal:signal(),roots:async()=>++reads===1?cleanRows:[],active:()=>({persistenceContext:ctx})}),/任务列表已变化/);
  const abort=new AbortController();reads=0;
  await assert.rejects(searchDshSessions({dir,query:'checkedmarker',signal:abort.signal,roots:async()=>{
    if(++reads===2)abort.abort(new Error('搜索完成前取消'));return cleanRows;
  },active:()=>({persistenceContext:ctx})}),/搜索完成前取消/);
  const replacement=await createOfficialDshContext({dataDir:dir,workspacePath:dir});
  try{
    let replaced=false;reads=0;
    await assert.rejects(searchDshSessions({dir,query:'checkedmarker',signal:signal(),roots:async()=>{
      if(++reads===2)replaced=true;return cleanRows;
    },active:()=>({persistenceContext:replaced?replacement:ctx})}),/读取来源已变化/);
  }finally{await replacement.fiber.dispose();}
  await assert.rejects(searchDshSessions({dir,query:'checkedmarker',signal:signal(),roots:async()=>[...cleanRows,...cleanRows],active:()=>({persistenceContext:ctx})}),/重复身份/);
  const reader=Object.create(ctx.sessionPersistence);reader.open=async()=>{throw new Error('实际存档损坏');};
  await assert.rejects(searchDshSessions({dir,query:'checkedmarker',signal:signal(),roots:async()=>cleanRows,active:()=>({persistenceContext:{sessionPersistence:reader}})}),/实际存档损坏/);
});

test('插件公开搜索返回原始错误对象，取消及关闭后的迟到结果不能交给新页面',async t=>{
  const old=globalThis.dyworker,host=new ClientPluginHost();t.after(async()=>{globalThis.dyworker=old;await host.dispose();});
  const calls=[];globalThis.dyworker={dshOperation:async input=>{calls.push(input);return {ok:true,value:{items:[{sessionId:'actual-root',snippet:'actual'}],hasMore:false}};}};
  assert.deepEqual(await host.ctx.sessions.search('actual',signal()),{ok:true,value:{items:[{sessionId:'actual-root',snippet:'actual'}],hasMore:false}});
  assert.equal(calls[0].action,'global-search');assert.equal(calls[0].sessionId,'');assert.equal(calls[0].payload.query,'actual');assert.match(calls[0].payload.searchId,/^[a-f0-9-]{36}$/);
  globalThis.dyworker.dshOperation=async()=>({ok:false,error:{code:'gateway/bad-request',message:'非法查询',details:{}}});
  const invalid=await host.ctx.sessions.search('',signal());assert.equal(invalid.ok,false);assert.ok(invalid.error instanceof RemoteError);assert.equal(invalid.error.code,'gateway/bad-request');
  const controller=new AbortController();controller.abort(new Error('当前调用取消'));const count=calls.length;
  assert.equal((await host.ctx.sessions.search('actual',controller.signal)).ok,false);assert.equal(calls.length,count);
  let finish;globalThis.dyworker.dshOperation=input=>input.action==='global-search-cancel'?Promise.resolve({ok:true,value:true}):new Promise(resolve=>finish=resolve);
  const pending=host.ctx.sessions.search('actual',signal());await host.dispose();finish({ok:true,value:{items:[],hasMore:false}});
  assert.equal((await pending).ok,false);
});

test('窗口取消只能结束自己的搜索；并发搜索、重新加载和关闭都实际终止对应读取',async()=>{
  const pending=new Map();
  const relay=createHistoryRelay(async(root,action,payload,{signal})=>{
    const {promise,resolve,reject}=Promise.withResolvers();
    pending.set(payload.query,{resolve,signal});signal.addEventListener('abort',()=>reject(signal.reason),{once:true});return promise;
  });
  const a=new EventEmitter(),b=new EventEmitter();a.isDestroyed=b.isDestroyed=()=>false;
  const first=relay.request(a,'','global-search',{query:'a',searchId:'same-id'}),other=relay.request(b,'','global-search',{query:'b',searchId:'same-id'});
  const rejected=assert.rejects(first,/取消/);
  await assert.rejects(relay.request(a,'','global-search',{query:'duplicate',searchId:'same-id'}),/重复/);
  assert.equal(await relay.request(b,'','global-search-cancel',{searchId:'not-owned'}),false);
  assert.equal(await relay.request(a,'','global-search-cancel',{searchId:'same-id'}),true);await rejected;
  assert.equal(pending.get('b').signal.aborted,false);pending.get('b').resolve({items:[],hasMore:false});assert.deepEqual(await other,{items:[],hasMore:false});
  const late=relay.request(a,'','global-search',{query:'reloaded',searchId:'later'}),lateRejected=assert.rejects(late,/页面已关闭/);
  a.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});await lateRejected;
  const final=relay.request(b,'','global-search',{query:'closed',searchId:'final'}),finalRejected=assert.rejects(final,/入口已关闭/);
  await relay.dispose();await finalRejected;assert.equal(a.listenerCount('destroyed'),0);assert.equal(b.listenerCount('destroyed'),0);
});

test('运行中的真实任务可立即被搜索，取消搜索不结束模型；冷读不额外启动进程',{timeout:25000},async t=>{
  const dir=await directory(),host=await createHost({userDataDir:dir,mountPlugins:true});
  let started,finish,calls=0;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>finish=resolve);
  const id='live-global-root';await host.sessions.upsert({id,runtime:'dsh',workspacePath:dir,title:id,messages:[]});
  const runtime=new OfficialDshSession({profileDir:host.plugins.dir,dataDir:path.join(host.dshRuntime.config.dir,createHash('sha256').update(id).digest('hex')),workspacePath:dir,sessionId:id,plugins:[],
    async *generate(){calls++;started();await gate;yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:'运行结束'}};yield {type:'finish',reason:{kind:'stop'}};}});
  t.after(async()=>{finish();await disposeHost(host);await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  await runtime.start();host.dshRuntime.sessions.set(id,{runtime,busy:true,version:'test',ownerIds:[]});
  const prompt=runtime.request('prompt',{text:'unflushedglobalmarker 运行中的原输入'});await ready;
  const result=await host.dshRuntime.request('','global-search',{query:'unflushedglobalmarker'});
  assert.deepEqual(result.items.map(row=>row.sessionId),[id]);assert.equal(calls,1);assert.equal(host.dshRuntime.sessions.size,1);
  const controller=new AbortController();controller.abort(new Error('只结束搜索'));
  await assert.rejects(host.dshRuntime.request('','global-search',{query:'unflushedglobalmarker'},{signal:controller.signal}),/只结束搜索/);
  assert.equal((await runtime.request('snapshot')).status,'running');assert.equal(calls,1);
  finish();await prompt;await host.dshRuntime.close(id);
  assert.equal((await host.dshRuntime.request('','global-search',{query:'unflushedglobalmarker'})).items.length,1);assert.equal(host.dshRuntime.sessions.size,0);assert.equal(calls,1);
});
