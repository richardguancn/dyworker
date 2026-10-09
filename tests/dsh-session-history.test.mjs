import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {z} from 'zod';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {createOfficialDshContext} from '../electron/host/dsh-runtime/official-context.mts';
import {createSessionHistory} from '../electron/host/dsh-runtime/session-history.mts';
import {createHistoryRelay} from '../electron/host/dsh-runtime/history-relay.mts';
import {OfficialDshSession} from '../electron/host/dsh-runtime/full-session.mts';
import {createSessionHistoryFace,createSessionHistoryClient} from '../src/pluginRuntime/sessionHistory.ts';
import {ClientPluginHost} from '../src/pluginRuntime/clientHost.ts';

const address = {kind:'session',sessionId:'history-root'};
const signal = () => new AbortController().signal;
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function until(check) {
  const end=Date.now()+5000;
  while(!check()) {if(Date.now()>end)throw new Error('等待真实状态变化超时');await new Promise(resolve=>setTimeout(resolve,5));}
}
async function fixture(t) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-history-')));
  const ctx=await createOfficialDshContext({dataDir:dir,workspacePath:dir});
  const history=createSessionHistory(ctx,address.sessionId,dir);
  const root=ctx.sessions.create(address.sessionId,{meta:{cwd:dir}});
  t.after(async()=>{await history.dispose();await ctx.fiber.dispose();await fs.rm(dir,{recursive:true,force:true});});
  const request=(action,payload,abort=signal())=>history.request(action,payload,abort);
  const operation=async input=>{
    try {return {ok:true,value:await request(input.action,input.payload)};}
    catch(error) {return {ok:false,error:{message:error.message,code:error.code,details:error.details}};}
  };
  return {dir,ctx,root,history,request,operation};
}
function appendTurn(session,turn,count) {
  session.append('turn/start',{turn});
  for(let i=0;i<count;i++) session.append('user/message',createUserMessage({content:[{type:'text',text:`回合${turn}记录${i}`}],source:{kind:'user'}}),{surfaceOp:'append'});
  session.append('turn/end',{turn,reason:{kind:'completed'}});
}
const durable = face=>face.eventSource.getSnapshot().entries.filter(entry=>entry.type==='event').map(entry=>entry.event);

test('固定的官方历史、窗口、助手处理与传输文件均原样通过来源校验',async()=>{
  const base=new URL('../vendor/dsh-session-controller/',import.meta.url);
  const manifest=JSON.parse(await fs.readFile(new URL('sources.json',base),'utf8'));
  assert.equal(manifest.commit,'5badb15009ae1756c3afe0ae0cef1faafc290ccc');
  assert.equal(Object.keys(manifest.sources).length,37);
  for(const [file,digest] of Object.entries(manifest.sources))
    assert.equal(createHash('sha256').update(await fs.readFile(new URL(file,base))).digest('hex'),digest,file);
});

test('真实官方长历史按回合翻页；跳转到最早记录时保持正在增加的尾部且无重复遗漏',async t=>{
  const {root,request,operation}=await fixture(t);
  for(let turn=1;turn<=12;turn++) appendTurn(root,turn,50);
  const original=root.snapshotEvents();
  const page=await request('history-page',{address,throughSeq:root.seq-1,maxMessages:500,turnWindow:{minMessages:50,minTurns:2}});
  assert.equal(page.hasMore,true);assert.equal(page.records[0].event.data.turn,11);
  assert.equal(page.records.filter(row=>row.event.type==='user/message').length,100);
  const wrapper=createSessionHistoryFace(address.sessionId,address.sessionId,undefined,operation);
  t.after(()=>wrapper.dispose());await wrapper.session.open();
  assert.equal(wrapper.session.getSnapshot().openState,'open');assert.equal(wrapper.session.getSnapshot().hasMore,true);
  assert.equal(durable(wrapper.session)[0].data.turn,11);
  await wrapper.session.loadOlder();assert.equal(durable(wrapper.session)[0].data.turn,9);
  const first=wrapper.session.loadThrough(150),second=wrapper.session.loadThrough(0);
  appendTurn(root,13,2);
  await Promise.all([first,second]);
  for(let i=0;i<30&&durable(wrapper.session).length<root.seq;i++) await tick();
  assert.deepEqual(durable(wrapper.session),root.snapshotEvents());
  assert.deepEqual(durable(wrapper.session).slice(0,original.length),original);
  assert.equal(wrapper.session.getSnapshot().hasMore,false);assert.equal(wrapper.session.getSnapshot().loadingOlder,false);
  const snapshot=wrapper.session.eventSource.getSnapshot();await wrapper.session.loadOlder();assert.equal(wrapper.session.eventSource.getSnapshot(),snapshot);
});

test('页界限保留来源组；非法光标、空地址、未来光标与外部根任务明确拒绝',async t=>{
  const {root,request}=await fixture(t);
  root.append('turn/start',{turn:1});
  const source=root.append('agent/inbox/spliced',{messages:[]});
  root.append('user/message',createUserMessage({content:[{type:'text',text:'保留来源组'}],source:{kind:'user'}}),{surfaceOp:'append',sourceEventSeqs:[source.seq]});
  const page=await request('history-page',{address,throughSeq:root.seq-1,maxMessages:1});
  assert.equal(page.records[0].event.seq,source.seq);
  assert.equal(page.records.at(-1).event.data.content[0].text,'保留来源组');
  for(const payload of [{throughSeq:-2},{throughSeq:-0},{throughSeq:0,beforeSeq:-0},{throughSeq:0,maxMessages:0},{throughSeq:0,maxMessages:1,turnWindow:{minMessages:2,minTurns:1}},{throughSeq:999}])
    await assert.rejects(request('history-page',{address,...payload}),error=>error.code==='gateway/bad-request');
  await assert.rejects(request('history-page',{throughSeq:0}),error=>error.code==='gateway/bad-request');
  await assert.rejects(request('history-open',{address:{kind:'session',sessionId:'another-root'}}),error=>error.code==='session/not-found');
  assert.deepEqual(await request('history-page',{address,throughSeq:-1}),{records:[],hasMore:false});
});

test('跟随者关闭会释放等待；并发读取拒绝；取消一个读取不影响同任务的另一订阅',async t=>{
  const {root,request}=await fixture(t);
  const a=await request('history-open',{address,assistantStream:true}),b=await request('history-open',{address,assistantStream:true});
  assert.equal(a.frame.type,'snapshot');assert.equal(a.frame.assistantStream.revision,0);
  const waitA=request('history-next',{streamId:a.streamId});
  await assert.rejects(request('history-next',{streamId:a.streamId}),/同时读取/);
  assert.equal(await request('history-close',{streamId:a.streamId}),true);
  assert.equal((await waitA).done,true);assert.equal(await request('history-close',{streamId:a.streamId}),false);
  const controller=new AbortController(),waitB=request('history-next',{streamId:b.streamId},controller.signal);
  const rejected=assert.rejects(waitB,/仅取消读取/);controller.abort(new Error('仅取消读取'));await rejected;
  const c=await request('history-open',{address});const pending=request('history-next',{streamId:c.streamId});
  const event=root.append('turn/start',{turn:1});assert.deepEqual((await pending).value,{type:'event',event});
  await request('history-close',{streamId:c.streamId});
  await assert.rejects(request('history-next',{streamId:b.streamId}),/不存在/);
});

test('窗口订阅按页面和根任务归属；重新加载只清理本页，迟到的打开结果也实际关闭',async()=>{
  const closed=[];let count=0,late;
  const gate=new Promise(resolve=>{late=resolve;});
  const relay=createHistoryRelay(async(root,action,payload)=>{
    if(action==='history-open') {const streamId=`stream-${++count}`;if(count===3) await gate;return {streamId,frame:{type:'snapshot'}};}
    if(action==='history-close') {closed.push([root,payload.streamId]);return true;}
    return {done:false,value:{type:'event'}};
  });
  const a=new EventEmitter(),b=new EventEmitter();a.isDestroyed=b.isDestroyed=()=>false;
  const first=await relay.request(a,'root-a','history-open',{}),other=await relay.request(b,'root-b','history-open',{});
  await assert.rejects(relay.request(b,'root-a','history-next',{streamId:first.streamId}),/不属于/);
  await assert.rejects(relay.request(a,'root-b','history-next',{streamId:first.streamId}),/不属于/);
  const pending=relay.request(a,'root-a','history-open',{}),rejected=assert.rejects(pending,/已经关闭/);
  a.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});late();await rejected;
  assert.deepEqual(closed,[['root-a',first.streamId],['root-a','stream-3']]);
  assert.equal((await relay.request(b,'root-b','history-next',{streamId:other.streamId})).done,false);
  await relay.dispose();assert.ok(closed.some(([,id])=>id===other.streamId));
  assert.equal(a.listenerCount('destroyed'),0);assert.equal(b.listenerCount('did-start-navigation'),0);
});

test('绑定接入真正的官方窗口，完整旧快照不能覆盖翻页；关闭后的结果不进入新绑定',async t=>{
  const {root,operation}=await fixture(t);
  for(let turn=1;turn<=8;turn++) appendTurn(root,turn,50);
  const sessions=new Map([[address.sessionId,{id:address.sessionId,runtime:'dsh'}]]);
  const host=new ClientPluginHost({sessionProvider:id=>sessions.get(id)});t.after(()=>host.dispose());
  const previous=globalThis.dyworker;globalThis.dyworker={dshOperation:operation};t.after(()=>{globalThis.dyworker=previous;});
  const binding=host.ctx.sessions.binding(address.sessionId);await host.openSessionHistory(address.sessionId);
  assert.equal(binding.session.getSnapshot().openState,'open');assert.equal(binding.eventSource.getSnapshot().entries[0].event.data.turn,7);
  assert.equal(host.ingestSessionEvents(root.snapshotEvents(),address.sessionId,binding),false);
  await binding.session.loadThrough(0);assert.deepEqual(binding.eventSource.getSnapshot().entries.map(entry=>entry.event),root.snapshotEvents());
  const state=await operation({sessionId:address.sessionId,action:'history-state',payload:{address}});
  assert.equal(host.acceptSessionHistoryState(address.sessionId,state.value,binding),true);
  sessions.delete(address.sessionId);host.ctx.sessions.binding(address.sessionId);
  assert.equal(binding.eventSource.closed,true);const snapshot=binding.eventSource.getSnapshot();
  sessions.set(address.sessionId,{id:address.sessionId,runtime:'dsh'});const current=host.ctx.sessions.binding(address.sessionId);assert.notEqual(current,binding);
  assert.equal(host.acceptSessionHistoryState(address.sessionId,state.value,binding),false);
  assert.equal(binding.eventSource.getSnapshot(),snapshot);assert.equal(current.eventSource.getSnapshot().entries.length,0);
});

test('真实进程开页保留已输出内容；关闭和取消读取不停止模型；重启读取不调用模型', {timeout:20000},async t=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-history-worker-')));
  const profileDir=path.join(dir,'plugins');await fs.mkdir(path.join(profileDir,'node_modules'),{recursive:true});
  let ready,finish,calls=0;const started=new Promise(resolve=>{ready=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
  const options={profileDir,dataDir:path.join(dir,'owned'),workspacePath:dir,sessionId:address.sessionId,plugins:[],approve:async()=>true,
    async *generate(){calls++;yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'尚未结束的输出'};ready();await gate;
      yield {type:'block-end',index:0,block:{type:'text',text:'尚未结束的输出'}};yield {type:'finish',reason:{kind:'stop'}};}};
  const runtime=new OfficialDshSession(options);t.after(async()=>{finish();await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  await runtime.start();const prompt=runtime.request('prompt',{text:'读取时保持任务运行'});await started;
  const opened=await runtime.request('history-open',{address,assistantStream:true});
  assert.match(JSON.stringify(opened.frame.assistantStream),/尚未结束的输出/);
  const controller=new AbortController();const pending=runtime.request('history-next',{streamId:opened.streamId},{signal:controller.signal});
  const rejected=assert.rejects(pending,/只关闭读取/);controller.abort(new Error('只关闭读取'));await rejected;
  assert.equal((await runtime.request('snapshot')).status,'running');assert.equal(calls,1);
  const wrapper=createSessionHistoryFace(address.sessionId,address.sessionId,undefined,async input=>({ok:true,value:await runtime.request(input.action,input.payload)}));
  await wrapper.session.open();assert.ok(wrapper.session.eventSource.getSnapshot().entries.some(row=>row.type==='transient'));
  await wrapper.dispose();assert.equal((await runtime.request('snapshot')).status,'running');
  const kept=createSessionHistoryFace(address.sessionId,address.sessionId,undefined,async input=>({ok:true,value:await runtime.request(input.action,input.payload)}));
  await kept.session.open();finish();const result=await prompt;assert.match(JSON.stringify(result.events),/尚未结束的输出/);
  for(let i=0;i<50&&durable(kept.session).length<result.events.length;i++) await tick();
  assert.deepEqual(durable(kept.session),result.events);assert.ok(!kept.session.eventSource.getSnapshot().entries.some(row=>row.type==='transient'));
  await kept.dispose();
  await runtime.close();const cold=new OfficialDshSession(options);
  try {await cold.start();const coldRead=await cold.request('history-open',{address,assistantStream:true});assert.match(JSON.stringify(coldRead.frame.records),/尚未结束的输出/);
    assert.equal(coldRead.frame.assistantStream.revision,0);assert.equal(calls,1);await cold.request('history-close',{streamId:coldRead.streamId});}
  finally {await cold.close();}
});

test('真实子任务通过确切父地址读取，模式及跨根地址拒绝；冷读子任务不恢复模型执行', {timeout:20000},async t=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-history-child-'))),profileDir=path.join(dir,'plugins');
  await fs.mkdir(path.join(profileDir,'node_modules'),{recursive:true});let calls=0,rootCalls=0;
  const options={profileDir,dataDir:path.join(dir,'owned'),workspacePath:dir,sessionId:address.sessionId,plugins:[],approve:async()=>true,
    async *generate(request){calls++;
      if(request.sessionId===address.sessionId && rootCalls++===0) {
        const args=JSON.stringify({prompt:'子任务自己的记录',description:'历史归属检查',run_in_background:false});
        yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id:'history-child-call',name:'subagent',argumentsDelta:args};
        yield {type:'block-end',index:0,block:{type:'tool-call',id:'history-child-call',name:'subagent',arguments:args}};yield {type:'finish',reason:{kind:'tool-calls'}};
      } else {
        const text=request.sessionId===address.sessionId?'父任务结果':'子任务真实结果';yield {type:'block-start',index:0,blockType:'text'};
        yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
      }
    }};
  const runtime=new OfficialDshSession(options);t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  await runtime.start();await runtime.request('prompt',{text:'生成子任务历史'});
  const family=await runtime.request('family'),child=Object.values(family.byId).find(row=>row.parentId===address.sessionId);assert.ok(child);
  const childAddress={kind:'subagent',childSessionId:child.id,parentSessionId:child.parentId,mode:child.projectionValues.subagent.mode};
  const opened=await runtime.request('history-open',{address:childAddress,assistantStream:true});
  assert.match(JSON.stringify(opened.frame.records),/子任务真实结果/);assert.ok(!JSON.stringify(opened.frame.records).includes('父任务结果'));
  await runtime.request('history-close',{streamId:opened.streamId});
  await assert.rejects(runtime.request('history-open',{address:{...childAddress,parentSessionId:'foreign-root'}}),error=>error.code==='subagent/unauthorized');
  await assert.rejects(runtime.request('history-open',{address:{...childAddress,mode:childAddress.mode==='continuable'?'one-shot':'continuable'}}),error=>error.code==='subagent/unauthorized');
  await assert.rejects(runtime.request('history-open',{address:{...childAddress,childSessionId:'foreign-child'}}),error=>error.code==='subagent/unauthorized');
  await assert.rejects(runtime.request('history-open',{address:{kind:'session',sessionId:child.id}}),error=>error.code==='session/not-found');
  const before=calls;await runtime.close();const cold=new OfficialDshSession(options);
  try {await cold.start();const wrapper=createSessionHistoryFace(address.sessionId,child.id,{parentSessionId:child.parentId,childSessionId:child.id,mode:childAddress.mode},
      async input=>({ok:true,value:await cold.request(input.action,input.payload)}));
    try {await wrapper.open();assert.match(JSON.stringify(durable(wrapper.session)),/子任务真实结果/);assert.equal(wrapper.session.getSnapshot().subagent.address.childSessionId,child.id);assert.equal(wrapper.session.getSnapshot().running,false);assert.equal(calls,before);}
    finally {await wrapper.dispose();}
  } finally {await cold.close();}
});

test('浏览器历史打开晚到时实际释放原订阅，已关闭范围不接收其记录',async t=>{
  const {root,operation}=await fixture(t);
  let opened,streamId;const gate=new Promise(resolve=>{opened=resolve;});const calls=[];
  const wrapper=createSessionHistoryFace(root.id,root.id,undefined,async input=>{
    calls.push(input);
    const answer=await operation(input);
    if(input.action==='history-open'){streamId=answer.value.streamId;await gate;}
    return answer;
  });
  const opening=wrapper.session.open();await until(()=>!!streamId);const disposing=wrapper.dispose();opened();
  await Promise.all([opening,disposing]);assert.equal(wrapper.session.eventSource.getSnapshot().entries.length,0);
  assert.equal(calls.filter(call=>call.action==='history-close'&&call.payload.streamId===streamId).length,1);
});

test('原始状态控制器和管理器直接推送投影变化；早期、重复值不覆盖新值，不暴露其他任务',async t=>{
  const {ctx,root,operation,request}=await fixture(t),calls=[];
  ctx.sessionProjections.register({key:'control-test',stateSchema:z.number(),stateVersion:1,init:()=>0,
    apply:(value,event)=>event.type==='test/control'?event.data.value:value,wire:{viewSchema:z.number(),view:value=>value}});
  const foreign=ctx.sessions.create('foreign-history',{meta:{cwd:root.header.cwd}});
  foreign.append('test/control',{value:999});
  const opened=await request('history-control-open',{address});
  assert.equal(opened.frame.frame.type,'baseline');assert.deepEqual(Object.keys(opened.frame.frame.value.projections),[address.sessionId]);
  assert.deepEqual(opened.frame.events.map(event=>event.args[0].sessionId),[address.sessionId]);await request('history-close',{streamId:opened.streamId});
  const face=createSessionHistoryFace(address.sessionId,address.sessionId,undefined,async input=>{calls.push(input.action);return operation(input);});t.after(()=>face.dispose());
  await face.open();assert.equal(face.session.getSnapshot().blank,true);assert.equal(face.session.projections.faceOf('control-test').getSnapshot(),0);
  root.append('test/control',{value:7});await until(()=>face.session.projections.faceOf('control-test').getSnapshot()===7);
  const actual=ctx.sessionProjections.snapshot(root);assert.equal(face.session.projections.values()['control-test'],actual.values['control-test']);
  face.session.projections.seed({asOfSeq:-1,values:{'control-test':-100}});assert.equal(face.session.projections.faceOf('control-test').getSnapshot(),7);
  root.append('turn/start',{turn:1});await until(()=>face.session.getSnapshot().blank===false);
  foreign.append('test/control',{value:1000});await tick();assert.equal(face.session.projections.faceOf('control-test').getSnapshot(),7);
  assert.ok(calls.includes('history-control-open'));assert.ok(!calls.includes('history-state'));
  await face.dispose();const snapshots=face.session.eventSource.getSnapshot();root.append('test/control',{value:8});await tick();
  assert.equal(face.session.eventSource.getSnapshot(),snapshots);
});

test('原始管理器接收真实 Agent 状态、收件变化和结束状态，页面不轮询；关闭状态读取不停止任务', {timeout:20000},async t=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-control-worker-'))),profileDir=path.join(dir,'plugins');
  await fs.mkdir(path.join(profileDir,'node_modules'),{recursive:true});
  let ready,finish,calls=0;const started=new Promise(resolve=>{ready=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
  const runtime=new OfficialDshSession({profileDir,dataDir:path.join(dir,'owned'),workspacePath:dir,sessionId:address.sessionId,plugins:[],approve:async()=>true,
    async *generate(){calls++;const text=calls===1?'第一轮正在运行':'第二轮消费真实队列';yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};
      if(calls===1){ready();await gate;}
      yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};}});
  t.after(async()=>{finish();await runtime.close();await fs.rm(dir,{recursive:true,force:true});});await runtime.start();
  const visited=[];
  const face=createSessionHistoryFace(address.sessionId,address.sessionId,undefined,async input=>{
    visited.push(input.action);try{return {ok:true,value:await runtime.request(input.action,input.payload)};}catch(error){return {ok:false,error};}
  });t.after(()=>face.dispose());await face.open();assert.equal(face.session.getSnapshot().running,false);
  const running=runtime.request('prompt',{text:'真实状态推送检查'});await started;await until(()=>face.session.getSnapshot().running===true);
  const extra=await runtime.request('history-control-open',{address});const waiting=runtime.request('history-next',{streamId:extra.streamId});
  await runtime.request('history-close',{streamId:extra.streamId});await waiting;
  assert.equal((await runtime.request('snapshot')).status,'running');assert.equal(face.session.getSnapshot().running,true);
  await runtime.request('input-admit',{requestId:'control-queue',mode:'queue',content:[{type:'text',text:'真正排队的补充内容'}]});
  await until(()=>JSON.stringify(face.session.projections.values().inbox).includes('真正排队的补充内容'));
  finish();const result=await running;await until(()=>face.session.getSnapshot().running===false);
  assert.equal(calls,2);assert.match(JSON.stringify(result.events),/真正排队的补充内容/);assert.match(JSON.stringify(result.events),/第二轮消费真实队列/);
  assert.ok(!visited.includes('history-state'));assert.ok(visited.includes('history-control-open'));
  await face.dispose();assert.equal(runtime.pending.size,0);
});

test('状态传输失败明确报告原因；迟到的状态初始结果在关闭后释放',async()=>{
  let late;const gate=new Promise(resolve=>{late=resolve;});const visited=[];
  const face=createSessionHistoryFace('root','root',undefined,async input=>{
    visited.push(input);
    if(input.action==='history-control-open')return gate;
    if(input.action==='history-list')return {ok:true,value:{items:[]}};
    if(input.action==='history-open')return {ok:false,error:{code:'gateway/internal',message:'实际历史读取失败'}};
    return {ok:true,value:true};
  });
  const opening=face.open(),rejected=assert.rejects(opening,/历史读取已关闭/);await tick();const disposal=face.dispose();
  late({ok:true,value:{streamId:'late-control',frame:{frame:{type:'baseline',value:{projections:{}}},events:[]}}});
  await rejected;await disposal;assert.equal(visited.filter(call=>call.action==='history-close'&&call.payload.streamId==='late-control').length,1);
  const bad=createSessionHistoryFace('root','root',undefined,async input=>input.action==='history-list'?{ok:true,value:{items:[]}}
    :{ok:false,error:{code:'gateway/internal',message:'实际状态读取失败'}});
  try {await assert.rejects(bad.open(),/实际状态读取失败/);assert.equal(bad.errors.getSnapshot().message,'实际状态读取失败');}
  finally{await bad.dispose();}
});

test('根页面自动发现实际多层子任务并跟随运行状态；目录读取关闭不停止子任务', {timeout:25000},async t=>{
  const previous=globalThis.dyworker;
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-control-family-'))),profileDir=path.join(dir,'plugins');
  await fs.mkdir(path.join(profileDir,'node_modules'),{recursive:true});
  const entry=path.join(profileDir,'node_modules','dsh-control-family-fixture','index.mjs');
  await fs.mkdir(path.dirname(entry),{recursive:true});
  await fs.writeFile(path.join(profileDir,'package.json'),' {"name":"isolated-control-profile","private":true}');
  await fs.writeFile(path.join(path.dirname(entry),'package.json'),JSON.stringify({name:'dsh-control-family-fixture',version:'1.0.0',type:'module',main:'index.mjs',dsh:{host:'index.mjs'}}));
  await fs.writeFile(entry,`export const name='dsh-control-family-fixture';export const inject=['tools','subagents'];
    export function apply(ctx){ctx.tools.register({name:'control_delegate',description:'两层真实委派检查',
      parameters:{type:'object',properties:{},additionalProperties:false},
      execute:async(_,exec)=>{const receipt=await ctx.subagents.startContinuable({provider:'spawn',label:'实际多层状态检查',
        request:{parent:exec.agent,prompt:[{type:'text',text:'实际多层状态检查'}],maxDepth:2},signal:exec.signal});return receipt.childId;},
      output:{schema:{type:'string'},render:(_,value)=>[{type:'text',text:value}]}});}`);
  let childId,grandchildId,finish,ready;
  const gate=new Promise(resolve=>{finish=resolve;}),started=new Promise(resolve=>{ready=resolve;});
  const invocations=new Map(),visited=[];
  const runtime=new OfficialDshSession({profileDir,dataDir:path.join(dir,'owned'),workspacePath:dir,sessionId:address.sessionId,
    plugins:[{id:'dsh-control-family-fixture',entryUrl:pathToFileURL(entry).href}],approve:async()=>true,
    async *generate(request){
      const count=(invocations.get(request.sessionId)||0)+1;invocations.set(request.sessionId,count);
      if(request.sessionId!==address.sessionId&&!childId)childId=request.sessionId;
      if(count===1&&(request.sessionId===address.sessionId||request.sessionId===childId)){
        const args='{}';
        const id=`delegate-${request.sessionId}`;
        yield {type:'block-start',index:0,blockType:'tool-call'};
        yield {type:'tool-call-delta',index:0,id,name:'control_delegate',argumentsDelta:args};
        yield {type:'block-end',index:0,block:{type:'tool-call',id,name:'control_delegate',arguments:args}};
        yield {type:'finish',reason:{kind:'tool-calls'}};return;
      }
      const text='实际多层状态检查完成';yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};
      if(request.sessionId!==address.sessionId&&request.sessionId!==childId){grandchildId=request.sessionId;ready();await gate;}
      yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
    }});
  const root={id:address.sessionId,runtime:'dsh',workspacePath:dir,messages:[{}]};
  const host=new ClientPluginHost({sessionProvider:id=>id===root.id?root:undefined});
  host.setCollections(()=>({items:[root],current:root}),()=>({items:[],current:null}));
  globalThis.dyworker={dshOperation:async input=>{
    visited.push(input.action);
    try{return {ok:true,value:await runtime.request(input.action,input.payload)};}catch(error){return {ok:false,error};}
  }};
  t.after(async()=>{finish();await host.dispose();await runtime.close();globalThis.dyworker=previous;await fs.rm(dir,{recursive:true,force:true});});
  await runtime.start();await host.openSessionHistory(root.id);
  const running=runtime.request('prompt',{text:'启动后台子任务和它的子任务'});
  try {await until(()=>!!grandchildId);}catch(error){
    throw new Error(`${error.message}: ${JSON.stringify({invocations:[...invocations],snapshot:await runtime.request('snapshot')})}`);
  }
  await started;await until(()=>host.subagent(grandchildId)?.running===true);
  assert.equal(host.subagent(childId).parentId,root.id);
  assert.equal(host.subagent(grandchildId).parentId,childId);
  assert.deepEqual(host.sessionListStore.getSnapshot().ids,[root.id],'多层目录不能增加根任务列表');
  assert.equal(host.sessionHistoryControlError(root.id),null);
  const control=await runtime.request('history-control-open',{address});
  assert.deepEqual(new Set(control.frame.events.map(event=>event.args[0].sessionId)),new Set([root.id,childId,grandchildId]));
  await runtime.request('history-close',{streamId:control.streamId});
  assert.equal(host.subagent(grandchildId).running,true,'关闭另一读取不取消真实子任务');
  finish();await running;await runtime.request('wait-jobs');
  await until(()=>host.subagent(grandchildId)?.running===false&&host.subagent(childId)?.running===false);
  const before=JSON.stringify([...invocations]);await host.refreshSubagents(root.id);
  assert.equal(JSON.stringify([...invocations]),before,'目录读取不调用模型');
  assert.ok(!visited.includes('history-state'));
});

test('原始引用共享一次真实历史打开；取消一个等待不关闭其他读取，最后释放后保持目录和稳定计数来源',async t=>{
  const {root,operation}=await fixture(t);appendTurn(root,1,2);
  let publish;const gate=new Promise(resolve=>publish=resolve),visited=[];
  const client=createSessionHistoryClient(root.id,async input=>{
    visited.push(input);
    const answer=await operation(input);
    if(input.action==='history-open')await gate;
    return answer;
  });t.after(()=>client.dispose());
  const info=client.sessions.retainInfo(root.id);
  assert.equal(info.getSnapshot().referenceCount,0);assert.equal(client.sessions.binding(root.id),undefined);
  await client.sessions.refresh();assert.equal(client.sessions.list.getSnapshot().phase,'ready');
  assert.equal(client.sessions.binding(root.id),undefined,'目录不持有页面范围');
  const abort=new AbortController(),first=client.sessions.retain(root.id,{source:'first',signal:abort.signal});
  const second=client.sessions.retain(root.id,{source:'__proto__'});
  assert.equal(first.binding,second.binding);assert.equal(client.sessions.sessionOf(first.binding.ctx),first.binding.session);
  assert.equal(client.sessions.scopeOf(first.binding.ctx),root.id);
  assert.equal(info.getSnapshot().referenceCount,2);
  assert.equal(Object.getPrototypeOf(info.getSnapshot().retainedBy),null);
  assert.equal(info.getSnapshot().retainedBy.__proto__,1);
  const rejected=assert.rejects(first.ready,/只取消第一个等待/);abort.abort(new Error('只取消第一个等待'));await rejected;
  first.release();first.release();assert.equal(info.getSnapshot().referenceCount,1);
  assert.equal(visited.filter(x=>x.action==='history-close').length,0);
  publish();await second.ready;
  assert.equal(visited.filter(x=>x.action==='history-open').length,1);
  appendTurn(root,2,1);await until(()=>durable(second.binding.session).length===root.seq);
  const retired=second.binding,oldSnapshot=retired.eventSource.getSnapshot();
  second.release();assert.equal(info.getSnapshot().referenceCount,0);assert.equal(client.sessions.binding(root.id),undefined);
  assert.equal(client.sessions.sessionOf(retired.ctx),undefined);assert.throws(()=>second.binding,/released/);
  await until(()=>visited.some(x=>x.action==='history-close'));
  assert.equal(client.sessions.retainInfo(root.id),info);assert.ok(client.sessions.list.getSnapshot().ids.includes(root.id));
  appendTurn(root,3,1);await tick();assert.equal(retired.eventSource.getSnapshot(),oldSnapshot);
  const requestsBefore=visited.length;
  assert.equal((await retired.session.prompt([{type:'text',text:'旧范围迟到输入'}],'queue')).ok,false);
  assert.equal((await retired.session.cancel()).ok,false);
  assert.equal((await retired.session.readAttachment('old-image')).ok,false);
  assert.equal(visited.length,requestsBefore,'已释放范围缓存的对象不能发出新读取、输入或取消');
  const next=client.sessions.retain(root.id,{source:'replacement'});t.after(()=>next.release());await next.ready;
  assert.notEqual(next.binding,retired);assert.notEqual(next.binding.ctx,retired.ctx);
  assert.equal(client.sessions.sessionOf(retired.ctx),undefined);assert.equal(client.sessions.sessionOf(next.binding.ctx),next.binding.session);
  assert.equal(info.getSnapshot().retainedBy.replacement,1);
});

test('应用公开引用与原始范围共用任务；父子、两根、关闭和同名重开保持真实身份与计数',async t=>{
  const {root,operation}=await fixture(t);appendTurn(root,1,1);
  const previous=globalThis.dyworker,visited=[];
  globalThis.dyworker={dshOperation:async input=>{visited.push(input);return operation(input);}};t.after(()=>globalThis.dyworker=previous);
  const rows=new Map([[root.id,{id:root.id,runtime:'dsh'}],['other',{id:'other',runtime:'dsh'}]]);
  const host=new ClientPluginHost({sessionProvider:id=>rows.get(id)});t.after(()=>host.dispose());
  const service=host.ctx.sessions,info=service.retainInfo(root.id),unknown=service.retainInfo('unknown');
  assert.equal(info.getSnapshot().referenceCount,0);assert.equal(unknown.getSnapshot().referenceCount,0);assert.equal(visited.length,0);
  const cancelled=new AbortController();cancelled.abort(new Error('读取前已取消'));
  assert.throws(()=>service.retain(root.id,{source:'cancelled',signal:cancelled.signal}),/读取前已取消/);
  assert.equal(info.getSnapshot().referenceCount,0);assert.equal(visited.length,0);
  let notifications=0;const stop=info.subscribe(()=>notifications++);t.after(stop);
  const binding=service.binding(root.id);
  assert.equal(info.getSnapshot().retainedBy.gateway,1,'已验证应用读取入口持有实际 Gateway 引用');
  const ref=service.retain(root.id,{source:'details'});await ref.ready;
  assert.equal(ref.binding.session,service.sessionOf(binding.ctx));assert.equal(ref.binding.ctx.fiber,binding.ctx.fiber);
  assert.equal(info.getSnapshot().referenceCount,2);assert.equal(info.getSnapshot().retainedBy.details,1);
  await assert.rejects(service.using(root.id,{source:'failed-reader'},()=>{throw new Error('真实回调失败');}),/真实回调失败/);
  assert.equal(info.getSnapshot().referenceCount,2);assert.equal(info.getSnapshot().retainedBy['failed-reader'],undefined);
  assert.throws(()=>service.retain('unknown',{source:'foreign'}),/不是仍被保留/);assert.equal(unknown.getSnapshot().referenceCount,0);
  assert.equal(service.scopeOf(binding.ctx),root.id);ref.release();assert.equal(info.getSnapshot().referenceCount,1);
  const other=service.binding('other');assert.notEqual(other.ctx.fiber,binding.ctx.fiber);
  assert.equal(service.sessionOf(other.ctx).sessionId,'other');
  rows.delete(root.id);host.setSessionProvider(id=>rows.get(id));assert.equal(info.getSnapshot().referenceCount,0);
  assert.equal(service.sessionOf(binding.ctx),undefined);assert.equal(service.scopeOf(binding.ctx),undefined);
  rows.set(root.id,{id:root.id,runtime:'dsh'});host.setSessionProvider(id=>rows.get(id));
  const replacement=service.binding(root.id);assert.notEqual(replacement,binding);
  assert.equal(service.retainInfo(root.id),info);assert.equal(info.getSnapshot().referenceCount,1);
  assert.equal(service.sessionOf(binding.ctx),undefined);assert.equal(service.sessionOf(replacement.ctx).sessionId,root.id);
  assert.ok(notifications>=4);
});

test('真实父子页面共用一个根客户端，公开子引用保持原地址、投影和事件隔离', {timeout:15000},async t=>{
  const previous=globalThis.dyworker;
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-retained-child-'))),profileDir=path.join(dir,'plugins');
  await fs.mkdir(path.join(profileDir,'node_modules'),{recursive:true});let rootCalls=0;
  const runtime=new OfficialDshSession({profileDir,dataDir:path.join(dir,'owned'),workspacePath:dir,sessionId:address.sessionId,plugins:[],approve:async()=>true,
    async *generate(request){
      if(request.sessionId===address.sessionId&&rootCalls++===0){
        const args=JSON.stringify({prompt:'真实子引用',description:'父子独立页面检查',run_in_background:false});
        yield {type:'block-start',index:0,blockType:'tool-call'};
        yield {type:'tool-call-delta',index:0,id:'retained-child',name:'subagent',argumentsDelta:args};
        yield {type:'block-end',index:0,block:{type:'tool-call',id:'retained-child',name:'subagent',arguments:args}};
        yield {type:'finish',reason:{kind:'tool-calls'}};
      }else{const text=request.sessionId===address.sessionId?'真实父页面':'真实子页面';
        yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};
        yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
      }
    }});
  const root={id:address.sessionId,runtime:'dsh',workspacePath:dir,messages:[{}]},visited=[];
  const host=new ClientPluginHost({sessionProvider:id=>id===root.id?root:undefined});
  host.setCollections(()=>({items:[root],current:root}),()=>({items:[],current:null}));
  globalThis.dyworker={dshOperation:async input=>{visited.push(input);try{return {ok:true,value:await runtime.request(input.action,input.payload)};}catch(error){return {ok:false,error};}}};
  t.after(async()=>{await host.dispose();await runtime.close();globalThis.dyworker=previous;await fs.rm(dir,{recursive:true,force:true});});
  await runtime.start();
  const sharp=(await import('sharp')).default;
  const original=await sharp({create:{width:3,height:2,channels:3,background:'#276543'}}).png().toBuffer();
  const image=await runtime.persistenceContext.attachments.saveImage({mediaType:'image/png',data:original});
  await runtime.request('prompt',{content:[{type:'text',text:'实际创建父子记录'},{type:'image',attachment:image}]});await host.refreshSubagents(root.id);
  const service=host.ctx.sessions,child=Object.values(host.sessionListStore.getSnapshot().byId).find(row=>row.parentId===root.id);assert.ok(child);
  const rootBinding=service.binding(root.id);await host.openSessionHistory(root.id);
  await tick();let allocating=false,notificationsDuringAllocation=0;
  const stop=host.subscribe(()=>{if(allocating)notificationsDuringAllocation++;});t.after(stop);
  allocating=true;const childBinding=service.binding(child.id);allocating=false;
  assert.equal(notificationsDuringAllocation,0,'页面借用绑定时不在渲染调用栈更新应用列表');
  await host.openSessionHistory(child.id);
  assert.equal(visited.filter(x=>x.action==='history-control-open').length,2,'父子页面共享一次状态订阅和一次真实连接监测');
  const rootRef=service.retain(root.id,{source:'image-reader'});t.after(()=>rootRef.release());await rootRef.ready;
  const read=await rootRef.binding.session.readAttachment(image.attachmentId);assert.equal(read.ok,true);
  assert.ok(read.value.data instanceof Uint8Array);assert.deepEqual(Buffer.from(read.value.data),original);
  assert.equal((await referenceReadChildImage(service,child.id,image.attachmentId)).ok,false,'子任务不能借用父任务图片');
  const childAddress={childSessionId:child.id,parentSessionId:root.id,mode:child.projectionValues.subagent.mode};
  const reference=service.retain(childAddress,{source:'child-details'});t.after(()=>reference.release());await reference.ready;
  assert.equal(reference.binding.session,service.sessionOf(childBinding.ctx));
  assert.equal(reference.binding.session.getSnapshot().subagent.address.childSessionId,child.id);
  assert.equal(service.scopeOf(reference.binding.ctx),child.id);
  assert.throws(()=>host.inputController(reference.binding.ctx),/仍被保留/,'子范围不能继承父任务的输入资格');
  assert.equal(service.subagentAddress(child.id).parentSessionId,root.id);
  assert.equal(service.retainInfo(child.id).getSnapshot().retainedBy['child-details'],1);
  await tick();
  assert.equal(host.sessionListStore.getSnapshot().byId[child.id].retainedBy['child-details'],1);
  const events=[];rootBinding.ctx.on('test/scoped-reference',()=>events.push('root'));childBinding.ctx.on('test/scoped-reference',()=>events.push('child'));
  childBinding.ctx.emit(childBinding.ctx,'test/scoped-reference');assert.deepEqual(events,['child']);
  rootBinding.ctx.emit(rootBinding.ctx,'test/scoped-reference');assert.deepEqual(events,['child','root']);
  assert.match(JSON.stringify(durable(reference.binding.session)),/真实子页面/);assert.ok(!JSON.stringify(durable(reference.binding.session)).includes('真实父页面'));
  assert.throws(()=>service.retain({...childAddress,parentSessionId:'foreign'},{source:'foreign'}),/直接父任务/);
  const before=visited.filter(x=>x.action==='history-state').length;
  await service.refreshProjections(child.id);await service.refreshProjections(child.id);
  assert.equal(visited.filter(x=>x.action==='history-state').length,before+1,'原始管理器只显式读取一次同代投影');
  reference.release();assert.equal(service.retainInfo(child.id).getSnapshot().retainedBy['child-details'],undefined);
  assert.match(JSON.stringify(rootBinding.eventSource.getSnapshot()),/真实父页面/);
});

async function referenceReadChildImage(service,id,attachmentId) {
  const reference=service.retain(id,{source:'image-boundary'});
  try {await reference.ready;return await reference.binding.session.readAttachment(attachmentId);}finally{reference.release();}
}

test('直接关闭原始页面范围也立即退役应用绑定，同一根仍存在时重开得到新对象',async t=>{
  const {root,operation}=await fixture(t),previous=globalThis.dyworker,visited=[];
  globalThis.dyworker={dshOperation:async input=>{visited.push(input);return operation(input);}};t.after(()=>globalThis.dyworker=previous);
  const host=new ClientPluginHost({sessionProvider:id=>id===root.id?{id,runtime:'dsh'}:undefined});t.after(()=>host.dispose());
  const service=host.ctx.sessions,info=service.retainInfo(root.id),old=service.binding(root.id);
  await host.openSessionHistory(root.id);await old.ctx.fiber.dispose();
  assert.equal(old.eventSource.closed,true);assert.equal(service.sessionOf(old.ctx),undefined);assert.equal(info.getSnapshot().referenceCount,0);
  const before=visited.length,stale=await old.session.readAttachment('stale');assert.equal(stale.ok,false);assert.equal(visited.length,before);
  const current=service.binding(root.id);assert.notEqual(current,old);assert.notEqual(current.ctx,old.ctx);
  assert.equal(service.sessionOf(current.ctx).sessionId,root.id);assert.equal(info.getSnapshot().referenceCount,1);
  await host.openSessionHistory(root.id);appendTurn(root,1,1);await until(()=>current.eventSource.getSnapshot().entries.length===root.seq);
  assert.equal(old.eventSource.getSnapshot().entries.length,0);assert.equal(visited.filter(x=>x.action==='history-control-open').length,2,'状态订阅和连接监测不随局部页面重开而重复');
});
