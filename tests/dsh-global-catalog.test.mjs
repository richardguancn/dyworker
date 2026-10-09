import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {ClientPluginHost} from '../src/pluginRuntime/clientHost.ts';
import {createHistoryRelay} from '../electron/host/dsh-runtime/history-relay.mts';
import {createHash} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {createHost,disposeHost} from '../electron/host/context.mts';
import {createOfficialDshContext} from '../electron/host/dsh-runtime/official-context.mts';
import {OfficialDshSession} from '../electron/host/dsh-runtime/full-session.mts';
import {ApiSessionList} from '../electron/host/dsh-runtime/vendor/session-history.mjs';
import {listDshSessions} from '../electron/host/dsh-runtime/global-catalog.mts';

async function fixture(t){
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-global-catalog-'))),host=await createHost({userDataDir:dir,mountPlugins:true});
 const a=path.join(dir,'workspace-a'),b=path.join(dir,'workspace-b');await fs.mkdir(a);await fs.mkdir(b);
 t.after(async()=>{await disposeHost(host);await fs.rm(dir,{recursive:true,force:true});});
 const data=id=>path.join(host.dshRuntime.config.dir,createHash('sha256').update(id).digest('hex'));
 const stored=async(id,cwd,title)=>{
  const ctx=await createOfficialDshContext({dataDir:data(id),workspacePath:cwd});
  try{
   new ApiSessionList(ctx,16);const session=ctx.sessions.create(id,{meta:{cwd}});
   ctx.sessionTitle.rename(session,title);
   session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'真实目录消息'}]}),{surfaceOp:'append'});
   const handle=await ctx.sessionPersistence.create(session.header);
   try{await handle.append(session.snapshotEvents());await handle.flush();}finally{await handle.close();}
   await host.sessions.upsert({id,runtime:'dsh',workspacePath:cwd,title:'原生列表标题不能冒充原始标题',createdAt:new Date(session.header.createdAt).toISOString(),messages:[]});
  }finally{await ctx.fiber.dispose();}
 };
 return {host,dir,a,b,data,stored};
}

test('全局原始目录读取两处冷存档及真实标题，未初始化草稿单独列明，不打开工作进程',async t=>{
 const {host,a,b,stored}=await fixture(t);await stored('cold-a',a,'原始标题甲');await stored('cold-b',b,'原始标题乙');
 await host.sessions.upsert({id:'draft',runtime:'dsh',workspacePath:a,title:'未开始',messages:[]});
 await host.sessions.upsert({id:'native',runtime:'dyworker',workspacePath:a,title:'普通任务',messages:[]});
 const result=await host.dshRuntime.request('','global-list');
 assert.deepEqual(new Set(result.items.map(row=>row.sessionId)),new Set(['cold-a','cold-b']));
 assert.equal(result.items.find(row=>row.sessionId==='cold-a').projections.values.title,'原始标题甲');
 assert.equal(result.items.find(row=>row.sessionId==='cold-b').projections.values.title,'原始标题乙');
 assert.deepEqual(result.draftRootIds,['draft']);assert.deepEqual(result.addresses,{});
 assert.deepEqual(result.rootIdBySession,{'cold-a':'cold-a','cold-b':'cold-b'});
 assert.ok(result.items.every(row=>row.running===false&&row.agentAvailable===false));
 assert.equal(host.dshRuntime.sessions.size,0);assert.equal(host.dshRuntime.opening.size,0);
 const again=await host.dshRuntime.request('','global-list');assert.deepEqual(again,result);
});

test('全局目录读取真实父子关系和地址；冷读取不增加模型调用，删除根后整棵目录退出',{timeout:30000},async t=>{
 const {host,a,data}=await fixture(t);await host.dshRuntime.request('','session-create',{cwd:a,sessionId:'parent'});
 let calls=0;
 const worker=new OfficialDshSession({profileDir:host.plugins.dir,dataDir:data('parent'),workspacePath:a,sessionId:'parent',plugins:[],approve:async()=>true,
  async *generate(request){calls++;let block;
   if(calls===1)block={type:'tool-call',id:'child-call',name:'subagent',arguments:JSON.stringify({description:'真实子任务',prompt:'子任务目录内容',run_in_background:false})};
   else block={type:'text',text:request.sessionId==='parent'?'父任务答复':'子任务答复'};
   yield {type:'block-start',index:0,blockType:block.type};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:block.type==='tool-call'?'tool-calls':'stop'}};
  }});
 let child;
 try{await worker.start();await worker.request('prompt',{text:'建立真实子任务'});child=Object.values((await worker.request('family')).byId).find(row=>row.parentId);}finally{await worker.close();}
 assert.ok(child);const baseline=calls;
 const result=await host.dshRuntime.request('','global-list'),entry=result.items.find(row=>row.sessionId===child.id);
 assert.equal(entry.origin,'subagent');assert.equal(entry.parentSessionId,'parent');
 assert.equal(result.rootIdBySession[child.id],'parent');
 assert.deepEqual(result.addresses[child.id],{parentSessionId:'parent',childSessionId:child.id,mode:child.projectionValues.subagent.mode});
 assert.equal(result.addresses[child.id].mode,'one-shot');
 assert.equal(calls,baseline);assert.equal(host.dshRuntime.sessions.size,0);
 const old=globalThis.dyworker,opened=[],client=new ClientPluginHost({onOpenSession:id=>opened.push(id)});
 let rows=await host.sessions.loadAll();client.setSessionProvider(id=>rows.find(row=>row.id===id));
 const update=()=>client.setCollections(()=>({items:rows,current:rows[0]}),()=>({items:[],current:null}));update();
 const relay=createHistoryRelay((id,action,payload,options)=>host.dshRuntime.request(id,action,payload,options));
 const sender=new EventEmitter();sender.isDestroyed=()=>false;
 globalThis.dyworker={dshOperation:async input=>{try{return {ok:true,value:await relay.request(sender,input.sessionId,input.action,input.payload||{})};}catch(error){return {ok:false,error};}}};
 try{
  await client.ctx.sessions.refresh();const snapshot=client.ctx.sessions.list.getSnapshot();
  assert.equal(snapshot,client.ctx.sessions.list.getSnapshot());assert.equal(client.ctx.sessions.searchResultLimit,20);
  assert.ok(snapshot.ids.includes(child.id));assert.deepEqual(client.sessionListStore.getSnapshot().ids,['parent']);
  assert.deepEqual(client.ctx.sessions.subagentAddress(child.id),result.addresses[child.id]);
  assert.equal(host.dshRuntime.sessions.size,0,'全局目录刷新不启动冷任务');
  assert.equal(client.ctx.uiWorkspace.openSession(child.id),true);assert.deepEqual(opened,[child.id]);
  const reference=client.ctx.sessions.retain(result.addresses[child.id],{source:'cold-child-reader'});
  try{
   await reference.ready;await new Promise(resolve=>setImmediate(resolve));
   assert.match(JSON.stringify(reference.binding.session.eventSource.getSnapshot()),/子任务答复/);
   assert.equal(client.ctx.sessions.list.getSnapshot().byId[child.id].retainedBy['cold-child-reader'],1);
   assert.equal(calls,baseline,'选择和读取冷子任务不会调用模型');
  }finally{reference.release();}
  rows=[];update();assert.deepEqual(client.ctx.sessions.list.getSnapshot().ids,[],'根任务删除后旧的原始目录立即退出');
 }finally{await client.dispose();await relay.dispose();globalThis.dyworker=old;}
 await host.sessions.applyDelta({removed:['parent'],order:[]});
 assert.deepEqual((await host.dshRuntime.request('','global-list')).items,[]);assert.equal(calls,baseline);
});

test('全局目录拒绝错误工作目录、取消及读取期间删除或替换原生身份；异常不返回空目录',async t=>{
 const {host,a,b,stored}=await fixture(t);await stored('checked',a,'原始标题');
 const record=await host.sessions.getAsync('checked');
 const options={dir:host.dshRuntime.config.dir,signal:new AbortController().signal,active:()=>undefined};
 await assert.rejects(listDshSessions({...options,roots:async()=>[{...record,workspacePath:b}]}),/工作目录不匹配/);
 let reads=0;await assert.rejects(listDshSessions({...options,roots:async()=>++reads===1?[record]:[]}),/任务列表已变化/);
 reads=0;await assert.rejects(listDshSessions({...options,roots:async()=>[{...record,createdAt:++reads===1?record.createdAt:new Date(Date.now()+1000).toISOString()}]}),/任务列表已变化/);
 const abort=new AbortController();abort.abort(new Error('取消目录读取'));
 await assert.rejects(listDshSessions({...options,signal:abort.signal,roots:async()=>[record]}),/取消目录读取/);
 assert.equal(host.dshRuntime.sessions.size,0);
});


test('窗口目录取消按实际请求归属隔离，同名并发、重新加载和关闭都结束自己的读取',async()=>{
 const pending=[],relay=createHistoryRelay(async(root,action,payload,{signal})=>{
  assert.equal(action,'global-list');assert.deepEqual(payload,{});
  const {promise,resolve,reject}=Promise.withResolvers();pending.push({signal,resolve});
  signal.addEventListener('abort',()=>reject(signal.reason),{once:true});return promise;
 });
 const a=new EventEmitter(),b=new EventEmitter();a.isDestroyed=b.isDestroyed=()=>false;
 const first=relay.request(a,'','global-list',{listId:'same'}),second=relay.request(b,'','global-list',{listId:'same'});
 const reject=assert.rejects(first,/取消/);
 await assert.rejects(relay.request(a,'','global-list',{listId:'same'}),/重复/);
 await assert.rejects(relay.request(a,'','global-list',{}),/缺失/);
 assert.equal(await relay.request(b,'','global-list-cancel',{listId:'missing'}),false);
 assert.equal(await relay.request(a,'','global-list-cancel',{listId:'same'}),true);await reject;
 assert.equal(pending[1].signal.aborted,false);pending[1].resolve({items:[]});assert.deepEqual(await second,{items:[]});
 const navigation=relay.request(a,'','global-list',{listId:'reloaded'}),navigationRejected=assert.rejects(navigation,/页面已关闭/);
 a.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});await navigationRejected;
 const final=relay.request(b,'','global-list',{listId:'closed'}),finalRejected=assert.rejects(final,/入口已关闭/);
 await relay.dispose();await finalRejected;assert.equal(a.listenerCount('destroyed'),0);assert.equal(b.listenerCount('destroyed'),0);
});

test('客户端删除或重建同名根后隐藏旧目录，拒绝迟到结果；关闭取消实际读取且不再发布',{timeout:5000},async t=>{
 const old=globalThis.dyworker,host=new ClientPluginHost(),store=host.ctx.sessions.list;
 t.after(async()=>{await host.dispose();globalThis.dyworker=old;});
 let rows=[{id:'root',runtime:'dsh',workspacePath:'/actual',createdAt:'old',messages:[]}];
 host.setSessionProvider(id=>rows.find(row=>row.id===id));
 const update=()=>host.setCollections(()=>({items:rows,current:rows[0]}),()=>({items:[],current:null}));update();
 const reply={ok:true,value:{items:[{sessionId:'root',cwd:'/actual',updatedAt:1,agentAvailable:false,running:false,blank:false}],rootIdBySession:{root:'root'},addresses:{},draftRootIds:[]}};
 globalThis.dyworker={dshOperation:async()=>reply};await host.refreshSessions();assert.deepEqual(host.ctx.sessions.list.getSnapshot().ids,['root']);
 const oldScope=host.ctx.sessions.scope('root');host.inputController(oldScope);
 let finish,cancelled=false;
 globalThis.dyworker.dshOperation=input=>{
  if(input.action==='global-list-cancel'){cancelled=true;finish({ok:false,error:{message:'读取已关闭'}});return Promise.resolve({ok:true,value:true});}
  return new Promise(resolve=>finish=resolve);
 };
 const late=host.refreshSessions(),lateRejected=assert.rejects(late,/任务列表已变化/);
 rows=[{...rows[0],createdAt:'new'}];update();assert.deepEqual(host.ctx.sessions.list.getSnapshot().ids,[]);
 assert.throws(()=>host.inputController(oldScope),/仍被保留/);assert.notEqual(host.ctx.sessions.scope('root'),oldScope);
 finish(reply);await lateRejected;assert.deepEqual(host.ctx.sessions.list.getSnapshot().ids,[]);
 const pending=host.refreshSessions(),pendingRejected=assert.rejects(pending,/已关闭/);
 const closing=host.dispose();await closing;await pendingRejected;assert.equal(cancelled,true);
 assert.deepEqual(store.getSnapshot().ids,[]);
});


test('全局目录从已运行任务取得真实状态；取消目录读取不取消模型，冷根仍不打开',{timeout:25000},async t=>{
 const {host,a,b,data,stored}=await fixture(t);await stored('cold-other',b,'另一目录');
 await host.dshRuntime.request('','session-create',{cwd:a,sessionId:'active-catalog'});
 const {promise:ready,resolve:started}=Promise.withResolvers(),{promise:gate,resolve:finish}=Promise.withResolvers();let calls=0;
 const runtime=new OfficialDshSession({profileDir:host.plugins.dir,dataDir:data('active-catalog'),workspacePath:a,sessionId:'active-catalog',plugins:[],
  async *generate(){calls++;started();await gate;yield {type:'block-start',index:0,blockType:'text'};
   yield {type:'block-end',index:0,block:{type:'text',text:'正常完成'}};yield {type:'finish',reason:{kind:'stop'}};}});
 t.after(async()=>{finish();await runtime.close();});await runtime.start();
 host.dshRuntime.sessions.set('active-catalog',{runtime,busy:true,version:'test',ownerIds:[]});
 const prompt=runtime.request('prompt',{text:'仍在真实运行'});await ready;
 const result=await host.dshRuntime.request('','global-list'),live=result.items.find(row=>row.sessionId==='active-catalog');
 assert.equal(live.running,true);assert.equal(live.agentAvailable,true);assert.equal(live.blank,false);
 assert.equal(result.items.find(row=>row.sessionId==='cold-other').agentAvailable,false);assert.equal(host.dshRuntime.sessions.size,1);
 const abort=new AbortController();abort.abort(new Error('只取消目录读取'));
 await assert.rejects(host.dshRuntime.request('','global-list',{}, {signal:abort.signal}),/只取消目录读取/);
 assert.equal((await runtime.request('snapshot')).status,'running');assert.equal(calls,1);
 finish();await prompt;host.dshRuntime.sessions.delete('active-catalog');await runtime.close();
 const cold=await host.dshRuntime.request('','global-list');assert.equal(cold.items.find(row=>row.sessionId==='active-catalog').running,false);
 assert.equal(calls,1);assert.equal(host.dshRuntime.sessions.size,0);
});

for(const cancel of [false,true])test(`目录与真实读取进程同时启动时${cancel?'取消等待不丢请求':'等到就绪后才发送请求'}`,{timeout:15000},async t=>{
 const {host,a}=await fixture(t);await host.dshRuntime.request('','session-create',{cwd:a,sessionId:'starting-root'});
 const gate=Promise.withResolvers(),entered=Promise.withResolvers();
 const start=OfficialDshSession.prototype.start,request=OfficialDshSession.prototype.request;
 let listCalls=0;
 OfficialDshSession.prototype.start=async function(...args){entered.resolve();await gate.promise;return start.apply(this,args);};
 OfficialDshSession.prototype.request=function(action,...args){if(action==='history-list')listCalls++;return request.call(this,action,...args);};
 t.after(()=>{gate.resolve();OfficialDshSession.prototype.start=start;OfficialDshSession.prototype.request=request;});
 const opening=host.dshRuntime.request('starting-root','snapshot');await entered.promise;
 const abort=new AbortController();let settled=false;
 const pending=host.dshRuntime.request('','global-list',{}, {signal:abort.signal});
 void pending.then(()=>settled=true,()=>settled=true);
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(settled,false);assert.equal(listCalls,0,'进程未就绪时不能向尚未安装监听器的进程发请求');
 if(cancel){const rejected=assert.rejects(pending,/取消启动中的目录/);abort.abort(new Error('取消启动中的目录'));await rejected;assert.equal(listCalls,0);}
 gate.resolve();await opening;
 const result=cancel?await host.dshRuntime.request('','global-list'):await pending;
 assert.equal(result.items[0].sessionId,'starting-root');assert.equal(result.items[0].running,false);
 assert.equal(host.dshRuntime.sessions.get('starting-root').activeInput,undefined);
 assert.equal(listCalls,1);
});
