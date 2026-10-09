import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createHost,disposeHost} from '../electron/host/context.mts';
import {createOfficialDshContext} from '../electron/host/dsh-runtime/official-context.mts';
import {createSessionHistory} from '../electron/host/dsh-runtime/session-history.mts';
import {createSessionHistoryClient} from '../src/pluginRuntime/sessionHistory.ts';
import {createSessionConnection,HISTORY_CARRIER_LOST} from '../src/pluginRuntime/sessionConnection.ts';
import {z} from 'zod';
import {LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import {SessionControlController,ApiSessionList} from '../electron/host/dsh-runtime/vendor/session-history.mjs';
import {followSessionControl} from '../electron/host/dsh-runtime/session-control.mts';

const config={backoffBaseMs:10,backoffMaxMs:30,generationReadyWarnMs:3000,generationReadyTimeoutMs:10000};
const reply=message=>new Response(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}),{headers:{'content-type':'application/json'}});
async function until(check){const end=Date.now()+15000;while(!check()){if(Date.now()>end)throw new Error('等待实际连接恢复超时');await new Promise(resolve=>setTimeout(resolve,5));}}
function deferred(){return Promise.withResolvers();}
const events=reference=>reference.binding.eventSource.getSnapshot().entries.filter(row=>row.type==='event').map(row=>row.event);
async function assertActualHistory(service,rootId,reference,address,prefix){
  const actual=events(reference);
  assert.deepEqual(actual.slice(0,prefix.length),prefix,'恢复不能改写原有已确认记录');
  const page=await service.request(rootId,'history-page',{address,throughSeq:actual.at(-1)?.seq??-1,maxMessages:500});
  assert.deepEqual(actual,page.records.map(row=>row.event),'必须已接收真实新初始记录，包括原始恢复标记');
}

test('官方恢复控制器与配置校验源码保持固定提交的原始字节',async()=>{
  const base=new URL('../vendor/dsh-connection/',import.meta.url),manifest=JSON.parse(await fs.readFile(new URL('sources.json',base),'utf8'));
  assert.equal(manifest.commit,'5badb15009ae1756c3afe0ae0cef1faafc290ccc');assert.equal(Object.keys(manifest.sources).length,2);
  for(const [file,digest]of Object.entries(manifest.sources))assert.equal(createHash('sha256').update(await fs.readFile(new URL(file,base))).digest('hex'),digest);
});

test('发现实际新任务期间较早的创建状态不能盖掉正在运行状态，真正结束后才显示结束',{timeout:15000},async t=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-connection-discovery-'))),ctx=await createOfficialDshContext({dataDir:dir,workspacePath:dir});
  const controller=new AbortController(),discovery=deferred(),releaseDiscovery=deferred(),started=deferred(),finish=deferred(),frames=[];
  ctx.sessionProjections.register({key:'discovery-barrier',stateSchema:z.number(),stateVersion:1,init:()=>0,
    apply:(value,event)=>event.type==='test/discovery-barrier'?event.data.value:value,wire:{viewSchema:z.number(),view:value=>value}});
  class Model extends LlmAdapter{async *stream(){started.resolve();await finish.promise;yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:'真实发现任务结束'}};yield {type:'finish',reason:{kind:'stop'}};}}
  ctx.llm.registerAdapter(['discovery'],new Model());ctx.sessions.create('discovery-root',{meta:{cwd:dir}});
  let delayed=true,handle;
  const scopes=async()=>{
    if(ctx.sessions.get('discovery-child')&&delayed){discovery.resolve();await releaseDiscovery.promise;}
    return new Set(['discovery-root','discovery-child'].filter(id=>ctx.sessions.get(id)));
  };
  const iterator=followSessionControl(ctx,new SessionControlController(ctx),new ApiSessionList(ctx,16),
    {kind:'session',sessionId:'discovery-root'},controller.signal,scopes)[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.frame.type,'baseline');
  const pump=(async()=>{while(!controller.signal.aborted){const next=await iterator.next();if(next.done)return;frames.push(next.value);}})();
  t.after(async()=>{releaseDiscovery.resolve();finish.resolve();controller.abort();await pump;await iterator.return?.();await handle?.dispose();await ctx.fiber.dispose();await fs.rm(dir,{recursive:true,force:true});});
  handle=await ctx.agents.create({sessionId:'discovery-child',meta:{cwd:dir,parentSession:'discovery-root'},agentOptions:{provider:'discovery',model:'actual'}});
  await discovery.promise;handle.agent.followup(createUserMessage({content:[{type:'text',text:'控制流发现期间启动'}],source:{kind:'user'}}));await started.promise;
  assert.equal(handle.agent.status,'running');delayed=false;releaseDiscovery.resolve();
  await until(()=>frames.some(row=>row.events?.some(event=>event.name==='api-session/added'&&event.args[0].sessionId==='discovery-child'&&event.args[0].running)));
  handle.agent.session.append('test/discovery-barrier',{value:1});
  await until(()=>frames.some(row=>row.frame?.key==='discovery-barrier'&&row.frame.sessionId==='discovery-child'&&row.frame.value===1));
  const updates=frames.flatMap(row=>row.events||[]).filter(event=>
    (event.name==='api-session/added'&&event.args[0].sessionId==='discovery-child')||(event.name==='api-session/status'&&event.args[0]==='discovery-child'));
  assert.ok(updates.length);assert.ok(updates.every(event=>(event.name==='api-session/added'?event.args[0].running:event.args[1])===true));
  assert.equal(handle.agent.status,'running');finish.resolve();await handle.agent.whenIdle();
  await until(()=>frames.some(row=>row.events?.some(event=>event.name==='api-session/status'&&event.args[0]==='discovery-child'&&event.args[1]===false)));
});

test('真实运行环境关闭、异常退出和手动重连后，原父子引用恢复；另一任务继续运行且不重发模型请求',{timeout:60000},async t=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-connection-real-'))),workspaceA=path.join(dir,'a'),workspaceB=path.join(dir,'b');
  await fs.mkdir(workspaceA);await fs.mkdir(workspaceB);
  const resolvers={isShuttingDown:()=>false,agentExtraTools:value=>value,mcpExtraTools:async()=>[],
    createExtraToolRouter:()=>Object.assign(()=>{},{dispose:async()=>{}}),readHooks:async()=>[],readStandingRules:async()=>[],
    auditRecord:()=>{},memoriesFromAgentResult:()=>[],appendUsageStat:()=>{}};
  const host=await createHost({userDataDir:dir,mountPlugins:true,agentResolvers:resolvers});
  const clients=[],refs=[],releaseB=deferred(),enteredB=deferred();let requests=0,rootCalls=0,signalB;
  t.after(async()=>{releaseB.resolve();for(const ref of refs)ref.release();for(const client of clients)await client.dispose();await disposeHost(host);await fs.rm(dir,{recursive:true,force:true});});
  const settings={endpoint:'https://example.test/v1/chat/completions',model:'connection-test',apiKey:'parent-only'};
  await host.sessions.upsert({id:'connection-a',runtime:'dsh',workspacePath:workspaceA,messages:[]});
  await host.sessions.upsert({id:'connection-b',runtime:'dsh',workspacePath:workspaceB,messages:[]});
  const seeded=await host.agent.run({sessionId:'connection-a',settings,workspacePath:workspaceA,prompt:'准备真实子任务记录',approvalMode:'full-access',fetchImpl:async(_url,init)=>{
    requests++;const request=JSON.parse(init.body);
    if(request.messages.some(row=>row.role==='user'&&JSON.stringify(row.content).includes('connection-child-marker')))return reply({role:'assistant',content:'连接恢复的真实子任务结果'});
    if(rootCalls++===0)return reply({role:'assistant',content:null,tool_calls:[{id:'connection-spawn',type:'function',function:{name:'subagent',arguments:JSON.stringify({description:'连接恢复子任务',prompt:'connection-child-marker'})}}]});
    return reply({role:'assistant',content:'连接恢复的真实父任务结果'});
  }});assert.equal(seeded.status,'done');
  const pendingB=host.agent.run({sessionId:'connection-b',settings,workspacePath:workspaceB,prompt:'另一任务保持运行',approvalMode:'full-access',fetchImpl:async(_url,init)=>{
    requests++;signalB=init.signal;enteredB.resolve();await releaseB.promise;return reply({role:'assistant',content:'另一任务实际完成'});
  }});await enteredB.promise;
  const opened=[],operation=async input=>{
    try{const value=await host.dshRuntime.request(input.sessionId,input.action,input.payload);
      if(input.action==='history-control-open'||input.action==='history-open')opened.push({root:input.sessionId,...value});
      return {ok:true,value};
    }catch(error){return {ok:false,error};}
  };
  const a=createSessionHistoryClient('connection-a',operation,()=>true,undefined,undefined,undefined,config),b=createSessionHistoryClient('connection-b',operation,()=>true,undefined,undefined,undefined,config);clients.push(a,b);
  await Promise.all([a.sessions.refresh(),b.sessions.refresh()]);
  const root=a.sessions.retain('connection-a',{source:'root-detail'}),childId=a.sessions.list.getSnapshot().ids.find(id=>id!=='connection-a');assert.ok(childId);
  const child=a.sessions.retain(childId,{source:'child-detail'}),other=b.sessions.retain('connection-b',{source:'other-detail'});refs.push(root,child,other);
  await Promise.all([root.ready,child.ready,other.ready,a.open(root.binding.session),a.open(child.binding.session),b.open(other.binding.session)]);
  const identities=[root.binding,child.binding,other.binding],oldRoot=events(root),oldChild=events(child),generationA=a.connection.generation.getSnapshot(),generationB=b.connection.generation.getSnapshot(),before=requests;
  let rootSnapshot=root.binding.eventSource.getSnapshot(),childSnapshot=child.binding.eventSource.getSnapshot();
  assert.equal(generationA.host.home,os.homedir());assert.equal(a.connection.generation.getSnapshot(),generationA);
  assert.equal(root.binding.ctx.get('connection'),a.connection);assert.equal(child.binding.ctx.get('connection'),a.connection);
  assert.match(JSON.stringify(oldChild),/连接恢复的真实子任务结果/);
  const concurrent=await host.dshRuntime.request('connection-a','history-open',{address:{kind:'session',sessionId:'connection-a'}});
  const waiting=host.dshRuntime.request('connection-a','history-next',{streamId:concurrent.streamId});
  await assert.rejects(host.dshRuntime.request('connection-a','history-next',{streamId:concurrent.streamId}),error=>error.code==='gateway/bad-request');
  assert.equal(await host.dshRuntime.request('connection-a','history-close',{streamId:concurrent.streamId}),true);
  assert.equal((await waiting).done,true,'拒绝并发读取后仍能关闭自己的实际订阅');
  const oldRuntime=host.dshRuntime.sessions.get('connection-a').runtime,oldHandle=opened.find(row=>row.root==='connection-a').streamId;
  const saved=oldRuntime.request.bind(oldRuntime),late=deferred(),entered=deferred();let staleHandle;
  oldRuntime.request=async(action,payload,options)=>{
    const value=await saved(action,payload,options);
    if(action==='history-open'&&payload?.lateProbe){staleHandle=value.streamId;entered.resolve();await late.promise;}
    if(action==='history-state'&&payload?.lateProbe){enteredState.resolve();await lateState.promise;}
    return value;
  };
  const enteredState=deferred(),lateState=deferred();t.after(()=>{late.resolve();lateState.resolve();});
  const oldOpening=host.dshRuntime.request('connection-a','history-open',{address:{kind:'session',sessionId:'connection-a'},lateProbe:true}),oldPage=host.dshRuntime.request('connection-a','history-state',{address:{kind:'session',sessionId:'connection-a'},lateProbe:true});
  const openingRejected=assert.rejects(oldOpening,error=>error.code===HISTORY_CARRIER_LOST),pageRejected=assert.rejects(oldPage,error=>error.code===HISTORY_CARRIER_LOST);
  await Promise.all([entered.promise,enteredState.promise]);await host.dshRuntime.close('connection-a');
  await until(()=>a.connection.generation.getSnapshot()?.id>generationA.id);late.resolve();lateState.resolve();await Promise.all([openingRejected,pageRejected]);
  assert.ok(staleHandle);await assert.rejects(host.dshRuntime.request('connection-a','history-next',{streamId:oldHandle}),error=>error.code===HISTORY_CARRIER_LOST);
  await until(()=>root.binding.eventSource.getSnapshot()!==rootSnapshot&&child.binding.eventSource.getSnapshot()!==childSnapshot);
  const rootAddress={kind:'session',sessionId:'connection-a'},childAddress={kind:'subagent',...a.sessions.subagentAddress(childId)};
  await assertActualHistory(host.dshRuntime,'connection-a',root,rootAddress,oldRoot);
  await assertActualHistory(host.dshRuntime,'connection-a',child,childAddress,oldChild);
  assert.equal(a.errors.getSnapshot(),null);assert.deepEqual([root.binding,child.binding,other.binding],identities);
  assert.equal(b.connection.generation.getSnapshot(),generationB);assert.equal(signalB.aborted,false);assert.equal(requests,before);
  let generation=a.connection.generation.getSnapshot().id;
  rootSnapshot=root.binding.eventSource.getSnapshot();childSnapshot=child.binding.eventSource.getSnapshot();
  host.dshRuntime.sessions.get('connection-a').runtime.child.kill('SIGKILL');
  await until(()=>a.connection.generation.getSnapshot()?.id>generation);
  await until(()=>root.binding.eventSource.getSnapshot()!==rootSnapshot&&child.binding.eventSource.getSnapshot()!==childSnapshot);
  await assertActualHistory(host.dshRuntime,'connection-a',child,childAddress,oldChild);
  rootSnapshot=root.binding.eventSource.getSnapshot();childSnapshot=child.binding.eventSource.getSnapshot();
  generation=a.connection.generation.getSnapshot().id;a.connection.reconnect();
  await until(()=>a.connection.generation.getSnapshot()?.id>generation);
  await until(()=>root.binding.eventSource.getSnapshot()!==rootSnapshot&&child.binding.eventSource.getSnapshot()!==childSnapshot);
  await assertActualHistory(host.dshRuntime,'connection-a',root,rootAddress,oldRoot);
  assert.equal(root.binding,identities[0]);assert.equal(child.binding,identities[1]);assert.equal(requests,before);assert.equal(signalB.aborted,false);
  const hooksEntered=deferred(),releaseHooks=deferred(),newRunEntered=deferred(),finishNewRun=deferred();
  const agentResolvers=host.agent.resolvers,previousHooks=agentResolvers.readHooks;
  agentResolvers.readHooks=async()=>{hooksEntered.resolve();await releaseHooks.promise;return [];};
  t.after(()=>{releaseHooks.resolve();finishNewRun.resolve();agentResolvers.readHooks=previousHooks;});
  const authorized=host.agent.run({sessionId:'connection-a',settings,workspacePath:workspaceA,prompt:'恢复之后新授权的任务',approvalMode:'full-access',fetchImpl:async()=>{
    requests++;newRunEntered.resolve();await finishNewRun.promise;return reply({role:'assistant',content:'新授权任务正常完成'});
  }});
  await hooksEntered.promise;const beforeAuthorized=host.dshRuntime.sessions.get('connection-a').runtime;
  generation=a.connection.generation.getSnapshot().id;a.connection.reconnect();await until(()=>a.connection.generation.getSnapshot()?.id>generation);
  assert.equal(host.dshRuntime.sessions.get('connection-a').runtime,beforeAuthorized,'权限与指令读取期间不提前替换原读取环境');
  releaseHooks.resolve();await newRunEntered.promise;const authorizedRuntime=host.dshRuntime.sessions.get('connection-a').runtime;
  assert.notEqual(authorizedRuntime,beforeAuthorized);assert.equal(beforeAuthorized.child.connected,false);assert.equal(requests,before+1);
  await until(()=>root.binding.session.getSnapshot().running===true);assert.equal(host.dshRuntime.sessions.get('connection-a').runtime,authorizedRuntime);
  finishNewRun.resolve();assert.equal((await authorized).status,'done');agentResolvers.readHooks=previousHooks;
  releaseB.resolve();assert.equal((await pendingB).status,'done');await until(()=>other.binding.session.getSnapshot().running===false);
  assert.equal(requests,before+1,'只有新授权增加一次执行，恢复不会重发已执行任务');
  const service=host.dshRuntime;await disposeHost(host);
  await assert.rejects(service.request('connection-a','history-list',{address:rootAddress}),error=>error.code===HISTORY_CARRIER_LOST);
  assert.equal(service.sessions.size,0);assert.equal(service.opening.size,0);
  await Promise.all(clients.map(client=>client.dispose()));
  assert.equal(service.sessions.size,0,'宿主关闭后连接恢复不能重新启动工作进程');
});

test('旧连接迟到的真实投影读取不能覆盖新连接已确认的数据',async t=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-connection-projection-'))),ctx=await createOfficialDshContext({dataDir:dir,workspacePath:dir});
  ctx.sessionProjections.register({key:'connection-number',stateSchema:z.number(),stateVersion:1,init:()=>0,
    apply:(value,event)=>event.type==='test/connection-number'?event.data.value:value,wire:{viewSchema:z.number(),view:value=>value}});
  const root=ctx.sessions.create('projection-root',{meta:{cwd:dir}});root.append('test/connection-number',{value:1});
  const history=createSessionHistory(ctx,root.id,dir),gate=deferred(),entered=deferred();let hold=false,lateValue;
  const client=createSessionHistoryClient(root.id,async input=>{try{
    const value=await history.request(input.action,input.payload,new AbortController().signal);
    if(input.action==='history-state'&&hold){hold=false;lateValue=value;entered.resolve();await gate.promise;}
    return {ok:true,value};
  }catch(error){return {ok:false,error};}},()=>true,undefined,undefined,undefined,config);
  let ref;t.after(async()=>{gate.resolve();ref?.release();await client.dispose();await history.dispose();await ctx.fiber.dispose();await fs.rm(dir,{recursive:true,force:true});});
  await client.sessions.refresh();ref=client.sessions.retain(root.id,{source:'projection-test'});await ref.ready;await client.open(ref.binding.session);
  const projection=ref.binding.session.projections.faceOf('connection-number');assert.equal(projection.getSnapshot(),1);
  hold=true;const pending=client.sessions.refreshProjections(root.id);await entered.promise;assert.equal(lateValue.projections.values['connection-number'],1);
  const generation=client.connection.generation.getSnapshot().id;client.connection.reconnect();
  await until(()=>client.connection.generation.getSnapshot()?.id>generation);root.append('test/connection-number',{value:9});await until(()=>projection.getSnapshot()===9);
  gate.resolve();await pending;await new Promise(resolve=>setTimeout(resolve,20));assert.equal(projection.getSnapshot(),9);assert.equal(client.errors.getSnapshot(),null);
});

test('实际连接打开迟到时，销毁等待原订阅关闭；无初始记录的连接明确失败而不发布已连接',async t=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-connection-late-'))),ctx=await createOfficialDshContext({dataDir:dir,workspacePath:dir});
  ctx.sessions.create('late-root',{meta:{cwd:dir}});const history=createSessionHistory(ctx,'late-root',dir),gate=deferred(),entered=deferred(),closed=[];let streamId;
  const operation=async input=>{try{
    const value=await history.request(input.action,input.payload,new AbortController().signal);
    if(input.action==='history-control-open'){streamId=value.streamId;entered.resolve();await gate.promise;}
    if(input.action==='history-close')closed.push(input.payload.streamId);
    return {ok:true,value};
  }catch(error){return {ok:false,error};}};
  const connection=createSessionConnection('late-root',operation,()=>true,()=>{},config);
  t.after(async()=>{gate.resolve();await connection.dispose();await history.dispose();await ctx.fiber.dispose();await fs.rm(dir,{recursive:true,force:true});});
  const opening=connection.ready(),rejected=assert.rejects(opening,/连接所属任务已经关闭/);await entered.promise;
  let disposed=false;const disposal=connection.dispose().then(()=>disposed=true);await rejected;assert.equal(disposed,false);gate.resolve();await disposal;
  assert.deepEqual(closed,[streamId]);assert.equal(connection.connection.generation.getSnapshot(),undefined);assert.equal(connection.connection.state.getSnapshot(),undefined);
  let attempts=0;
  const malformed=createSessionConnection('late-root',async input=>{
    const answer=await operation(input);if(input.action==='history-control-open'){attempts++;delete answer.value.host;}return answer;
  },()=>true,()=>{},config);
  await assert.rejects(malformed.ready(),/主机信息/);assert.equal(malformed.connection.generation.getSnapshot(),undefined);await malformed.dispose();
  const before=attempts;await new Promise(resolve=>setTimeout(resolve,50));assert.equal(attempts,before,'销毁后不遗留重试计时器');
});
