import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {createOfficialDshContext} from '../electron/host/dsh-runtime/official-context.mts';
import {createSessionHistory} from '../electron/host/dsh-runtime/session-history.mts';
import {OfficialDshSession} from '../electron/host/dsh-runtime/full-session.mts';
import {createSessionHistoryClient} from '../src/pluginRuntime/sessionHistory.ts';
import {createHost,disposeHost} from '../electron/host/context.mts';

const address={kind:'session',sessionId:'operations-root'};
const signal=()=>new AbortController().signal;
async function directory(){return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-session-operations-')));}
function text(session,value){session.append('user/message',createUserMessage({content:[{type:'text',text:value}],source:{kind:'user'}}),{surfaceOp:'append'});}
const carrier=runtime=>async input=>{
  try{return {ok:true,value:await runtime.request(input.action,input.payload)};}
  catch(error){return {ok:false,error:{code:error.code,message:error.message,details:error.details}};}
};
async function fixture(t){
  const dir=await directory(t),ctx=await createOfficialDshContext({dataDir:dir,workspacePath:dir});
  t.after(async()=>{await ctx.fiber.dispose();await fs.rm(dir,{recursive:true,force:true});});const history=createSessionHistory(ctx,address.sessionId,dir);
  const root=ctx.sessions.create(address.sessionId,{meta:{cwd:dir}});
  return {ctx,root,request:(action,payload,abort=signal())=>history.request(action,payload,abort)};
}

test('原始搜索在排名前限定根任务，其他任务大量命中也不会挤掉本任务；非法内容和取消明确失败',async t=>{
  const {ctx,root,request}=await fixture(t);
  for(let i=0;i<65;i++)text(ctx.sessions.create(`foreign-${i}`,{meta:{cwd:root.header.cwd}}),'searchmarker searchmarker 外部资料');
  text(root,'当前任务自己的 searchmarker 内容');
  const found=await request('history-search',{address,query:' searchmarker '});
  assert.deepEqual(found.items.map(row=>row.sessionId),[address.sessionId]);assert.equal(found.hasMore,false);
  assert.match(found.items[0].snippet,/当前任务自己的/);assert.doesNotMatch(JSON.stringify(found),/外部资料/);
  assert.deepEqual(await request('history-search',{address,query:'missingmarker'}),{items:[],hasMore:false});
  for(const query of ['', '  ', 'x'.repeat(501), 'x\0y',null])
    await assert.rejects(request('history-search',{address,query}),error=>error.code==='gateway/bad-request');
  const abort=new AbortController();abort.abort(new Error('只取消搜索'));
  await assert.rejects(request('history-search',{address,query:'searchmarker'},abort.signal),/只取消搜索/);
  assert.equal(ctx.agents.list().length,0);
});

test('原始公开 Session 修改标题并即时更新投影；空标题、外部任务及释放后的旧对象不能写入',async t=>{
  const {root,request}=await fixture(t),calls=[];
  const client=createSessionHistoryClient(address.sessionId,async input=>{calls.push(input);try{return {ok:true,value:await request(input.action,input.payload)};}catch(error){return {ok:false,error:{code:error.code,message:error.message,details:error.details}};}});
  t.after(()=>client.dispose());const reference=client.sessions.retainAgentScope(address.sessionId);await client.open(reference.binding.session);
  const session=reference.binding.session,renamed=await session.rename('  修改\n后的 \u001b[31m标题\u001b[0m  ');
  assert.equal(renamed.ok,true);assert.equal(renamed.value.title,'修改 后的 标题');
  assert.equal(session.projections.get('title'),'修改 后的 标题');
  assert.equal(root.snapshotEvents().at(-1).type,'session/title');assert.equal(root.snapshotEvents().at(-1).data.source.kind,'user');
  const before=root.seq;assert.equal((await session.rename(' \u0000\u200b ')).error.code,'session/title-invalid');assert.equal(root.seq,before);
  await assert.rejects(request('session-rename',{address:{kind:'session',sessionId:'foreign'},title:'不能写'}),error=>error.code==='session/not-found');
  reference.release();const count=calls.length;assert.equal((await session.rename('旧对象不能修改')).ok,false);assert.equal(calls.length,count);
});

test('真实子任务的搜索与冷标题保存跨重启保留，错父地址拒绝，不恢复模型或额外创建任务',{timeout:25000},async t=>{
  const dir=await directory(t),profileDir=path.join(dir,'profile');await fs.mkdir(path.join(profileDir,'node_modules'),{recursive:true});
  let calls=0,rootCalls=0;
  const options={profileDir,dataDir:path.join(dir,'owned'),workspacePath:dir,sessionId:address.sessionId,plugins:[],approve:async()=>true,
    async *generate(request){calls++;
      if(request.sessionId===address.sessionId && rootCalls++===0){
        const args=JSON.stringify({prompt:'childsearchmarker 子任务内容',description:'原始子任务',run_in_background:false});
        yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id:'create-child',name:'subagent',argumentsDelta:args};
        yield {type:'block-end',index:0,block:{type:'tool-call',id:'create-child',name:'subagent',arguments:args}};yield {type:'finish',reason:{kind:'tool-calls'}};
      }else{const value=request.sessionId===address.sessionId?'父任务完成':'子任务 childsearchmarker 真结果';yield {type:'block-start',index:0,blockType:'text'};
        yield {type:'text-delta',index:0,text:value};yield {type:'block-end',index:0,block:{type:'text',text:value}};yield {type:'finish',reason:{kind:'stop'}};}}};
  let runtime=new OfficialDshSession(options);t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});await runtime.start();await runtime.request('prompt',{text:'生成真实子任务'});
  const family=await runtime.request('family'),child=Object.values(family.byId).find(row=>row.parentId===address.sessionId);assert.ok(child);
  const childAddress={kind:'subagent',childSessionId:child.id,parentSessionId:child.parentId,mode:child.projectionValues.subagent.mode};
  const before=calls;await runtime.close();runtime=new OfficialDshSession(options);await runtime.start();
  const beforeInvalid=(await runtime.request('child-snapshot',{childId:child.id})).events;
  await assert.rejects(runtime.request('session-rename',{address:childAddress,title:' \u0000\u200b '}),error=>error.code==='session/title-invalid');
  assert.deepEqual((await runtime.request('child-snapshot',{childId:child.id})).events,beforeInvalid);
  const client=createSessionHistoryClient(address.sessionId,carrier(runtime));await client.sessions.refresh();
  const reference=client.sessions.retain({kind:'subagent',childSessionId:child.id,parentSessionId:child.parentId,mode:childAddress.mode},{source:'rename-child'});await reference.ready;
  const renamed=await reference.binding.session.rename('冷子任务的新标题');assert.equal(renamed.ok,true,renamed.error?.message);
  const found=await client.sessions.search('childsearchmarker',signal());assert.equal(found.ok,true,found.error?.message);assert.deepEqual(new Set(found.value.items.map(row=>row.sessionId)),new Set([child.id,address.sessionId]));
  await assert.rejects(runtime.request('session-rename',{address:{...childAddress,parentSessionId:'foreign'},title:'错误归属'}),error=>error.code==='subagent/unauthorized');
  assert.equal(Object.keys((await runtime.request('family')).byId).length,2);assert.equal(calls,before);
  reference.release();await client.dispose();await runtime.close();runtime=new OfficialDshSession(options);await runtime.start();
  const stored=await runtime.request('child-snapshot',{childId:child.id});assert.equal(stored.projections.values.title,'冷子任务的新标题');
  assert.equal(stored.events.filter(row=>row.type==='session/title'&&row.data.source.kind==='user').length,1);assert.equal(calls,before);
});

test('公开命令调用原始执行器并保存成对记录；错误命令、跨根调用和只读重启不能取得执行资格',{timeout:25000},async t=>{
  const dir=await directory(t),profileDir=path.join(dir,'profile'),packageDir=path.join(profileDir,'node_modules','command-check'),entry=path.join(packageDir,'index.mjs');await fs.mkdir(packageDir,{recursive:true});
  await fs.writeFile(path.join(packageDir,'package.json'),JSON.stringify({name:'command-check',version:'1.0.0',type:'module'}));
  await fs.writeFile(entry,`export const inject=['commands'];export function apply(ctx){ctx.commands.register({name:'echo-check',description:'实际命令',handler:inv=>({kind:'success',text:inv.agent.id+':'+inv.rawInput})});}`);
  let ready,finish,calls=0;const started=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>finish=resolve);
  const options={profileDir,dataDir:path.join(dir,'owned'),workspacePath:dir,sessionId:address.sessionId,plugins:[{id:'command-check',entryUrl:pathToFileURL(entry).href}],
    async *generate(){calls++;ready();await gate;yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'模型完成'};
      yield {type:'block-end',index:0,block:{type:'text',text:'模型完成'}};yield {type:'finish',reason:{kind:'stop'}};}};
  let runtime=new OfficialDshSession(options);t.after(async()=>{finish();await runtime.close();await fs.rm(dir,{recursive:true,force:true});});await runtime.start();
  await assert.rejects(runtime.request('session-command',{address,line:'/echo-check',attachments:[]}),error=>error.code==='dyworker/input-unavailable');
  const running=runtime.request('prompt',{text:'保持当前已授权执行'});await started;
  const client=createSessionHistoryClient(address.sessionId,carrier(runtime));const reference=client.sessions.retainAgentScope(address.sessionId);await client.open(reference.binding.session);
  assert.deepEqual(await reference.binding.session.command('/echo-check 原参数'),{ok:true,value:{matched:true}});
  assert.deepEqual(await reference.binding.session.command('/unknown-command'),{ok:true,value:{matched:false}});
  await assert.rejects(runtime.request('session-command',{address:{kind:'session',sessionId:'foreign'},line:'/echo-check',attachments:[]}),error=>error.code==='session/not-found');
  const snapshot=await runtime.request('snapshot');const commandRun=snapshot.events.filter(row=>row.type==='command/run'),commandDone=snapshot.events.filter(row=>row.type==='command/done');
  assert.equal(commandRun.length,1);assert.equal(commandDone.length,1);assert.equal(commandRun[0].data.commandId,commandDone[0].data.commandId);
  assert.equal(commandDone[0].data.text,`${address.sessionId}: 原参数`);assert.equal(snapshot.status,'running');assert.equal(calls,1);
  reference.release();await client.dispose();finish();await running;await runtime.close();runtime=new OfficialDshSession(options);await runtime.start();
  assert.match(JSON.stringify((await runtime.request('snapshot')).events),/原参数/);
  await assert.rejects(runtime.request('session-command',{address,line:'/echo-check',attachments:[]}),error=>error.code==='dyworker/input-unavailable');assert.equal(calls,1);
});

test('应用根任务标题修改同时保存到任务列表及官方历史，两次顺序修改和冷重启保留结果',{timeout:25000},async t=>{
  const dir=await directory(t),host=await createHost({userDataDir:dir,mountPlugins:true});t.after(async()=>{await disposeHost(host);await fs.rm(dir,{recursive:true,force:true});});
  await host.sessions.upsert({id:address.sessionId,runtime:'dsh',workspacePath:dir,title:'旧标题',messages:[]});
  await host.dshRuntime.request(address.sessionId,'snapshot');
  const results=await Promise.all(['第一标题','最终标题'].map(title=>host.dshRuntime.request(address.sessionId,'session-rename',{address,title})));
  assert.deepEqual(results.map(row=>row.title),['第一标题','最终标题']);assert.equal(host.sessions.get(address.sessionId).title,'最终标题');assert.equal(host.sessions.get(address.sessionId).titleCustom,true);
  await host.dshRuntime.close(address.sessionId);
  const cold=await host.dshRuntime.request(address.sessionId,'snapshot');assert.equal(cold.projections.values.title,'最终标题');
  assert.equal((await host.sessions.loadAll()).find(row=>row.id===address.sessionId).title,'最终标题');
  await assert.rejects(host.dshRuntime.request(address.sessionId,'session-command',{address,line:'/anything',attachments:[]}),error=>error.code==='dyworker/input-unavailable');
});
