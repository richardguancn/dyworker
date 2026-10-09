import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {createOfficialDshContext} from '../electron/host/dsh-runtime/official-context.mts';
import {createSessionHistory} from '../electron/host/dsh-runtime/session-history.mts';
import {readSessionFamily} from '../electron/host/dsh-runtime/session-family.mts';
import {OfficialDshSession} from '../electron/host/dsh-runtime/full-session.mts';
import {createSessionHistoryClient} from '../src/pluginRuntime/sessionHistory.ts';
import {ClientPluginHost} from '../src/pluginRuntime/clientHost.ts';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){const end=Date.now()+7000;while(!check()){if(Date.now()>end)throw new Error('等待实际会话状态超时');await new Promise(resolve=>setTimeout(resolve,5));}}
async function fixture(t){
  const previous=globalThis.dyworker,dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-ui-session-')));
  const contexts=new Map(),histories=new Map(),rows=new Map();let current;
  for(const id of ['ui-a','ui-b']){
    const cwd=path.join(dir,id);await fs.mkdir(cwd);
    const ctx=await createOfficialDshContext({dataDir:path.join(cwd,'data'),workspacePath:cwd});contexts.set(id,ctx);
    const session=ctx.sessions.create(id,{meta:{cwd}});
    session.append('turn/start',{turn:1});session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:`${id}的实际历史`}]}),{surfaceOp:'append'});session.append('turn/end',{turn:1,reason:{kind:'completed'}});
    histories.set(id,createSessionHistory(ctx,id,cwd));rows.set(id,{id,runtime:'dsh',title:id,workspacePath:cwd,messages:[{}]});
  }
  const operation=async input=>{try{const signal=new AbortController().signal;return {ok:true,value:input.action==='family'
    ?await readSessionFamily(contexts.get(input.sessionId),input.sessionId,signal)
    :await histories.get(input.sessionId).request(input.action,input.payload,signal)};}catch(error){return {ok:false,error};}};
  globalThis.dyworker={dshOperation:operation};
  const host=new ClientPluginHost({sessionProvider:id=>rows.get(id)});
  const sync=()=>host.setCollections(()=>({items:[...rows.values()],current}),()=>({items:[],current:null}));sync();
  t.after(async()=>{await host.dispose();for(const history of histories.values())await history.dispose();for(const ctx of contexts.values())await ctx.fiber.dispose();globalThis.dyworker=previous;await fs.rm(dir,{recursive:true,force:true});});
  return {host,rows,contexts,histories,operation,sync,select:async id=>{current=rows.get(id);sync();await host.selectMainSession(id);await tick();}};
}

test('官方 UiSession、范围登记与渲染数据源的九份源码原样保存',async()=>{
  const base=new URL('../vendor/dsh-ui-session/',import.meta.url),manifest=JSON.parse(await fs.readFile(new URL('sources.json',base),'utf8'));
  assert.equal(manifest.commit,'5badb15009ae1756c3afe0ae0cef1faafc290ccc');assert.equal(Object.keys(manifest.sources).length,9);
  for(const [file,hash]of Object.entries(manifest.sources))assert.equal(createHash('sha256').update(await fs.readFile(new URL(file,base))).digest('hex'),hash,file);
});

test('真实两任务切换只释放主视图引用，其他读取独立；删除与重新取得同名任务不复用旧界面范围',async t=>{
  const {host,rows,operation,sync,select}=await fixture(t),ui=host.ctx.uiSession,service=host.ctx.sessions;
  assert.equal(ui.adapter.current.getSnapshot().key,undefined);assert.equal(ui.sessionStatus.getSnapshot().get('ui-a').running,undefined,'尚无实际基线时不编造运行状态');
  await select('ui-a');assert.equal(ui.adapter.current.getSnapshot().key,'ui-a');
  const mainValue=ui.adapter.current.getSnapshot();assert.equal(mainValue.props.sessionId,'ui-a');assert.equal(mainValue.hooks.session.getSnapshot().openState,'open');
  const independent=service.retain('ui-a',{source:'reader'});await independent.ready;t.after(()=>independent.release());
  const bound=ui.bindingSource(independent);assert.equal(bound.getSnapshot().ctx,independent.binding.ctx);assert.equal(bound.getSnapshot().hooks.session,independent.binding.session);assert.equal(ui.bindingSource(independent),bound);
  assert.equal(host.ctx.uiConversation.binding(independent.binding),host.ctx.uiConversation.binding('ui-a'),'原始界面范围能直接取得对应的实际对话');
  const alien=createSessionHistoryClient('ui-a',operation);t.after(()=>alien.dispose());await alien.sessions.refresh();const foreign=alien.sessions.retain('ui-a',{source:'reader'});t.after(()=>foreign.release());await foreign.ready;
  assert.throws(()=>ui.bindingSource(foreign),/not active/);
  assert.throws(()=>host.ctx.uiConversation.binding(foreign.binding),/inactive/);
  await select('ui-b');assert.equal(ui.adapter.current.getSnapshot().key,'ui-b');assert.equal(service.retainInfo('ui-a').getSnapshot().retainedBy.mainView,undefined);assert.equal(service.retainInfo('ui-a').getSnapshot().retainedBy.reader,1);
  assert.equal(bound.getSnapshot(),mainValue,'其他读取继续持有同一实际范围');
  await host.selectMainSession('');assert.equal(ui.adapter.current.getSnapshot().key,undefined);assert.equal(service.retainInfo('ui-b').getSnapshot().retainedBy.mainView,undefined);
  await select('ui-a');const old=bound.getSnapshot();const saved=rows.get('ui-a');rows.delete('ui-a');host.setSessionProvider(id=>rows.get(id));sync();await tick();
  assert.equal(ui.adapter.current.getSnapshot().key,undefined);assert.equal(bound.getSnapshot().key,undefined);assert.equal(ui.sessionStatus.getSnapshot().has('ui-a'),false);
  assert.throws(()=>independent.binding,/released/);
  rows.set('ui-a',saved);host.setSessionProvider(id=>rows.get(id));sync();await select('ui-a');assert.notEqual(ui.adapter.current.getSnapshot().ctx,old.ctx);
  await assert.rejects(host.selectMainSession('missing'),/DSH/);assert.equal(ui.adapter.current.getSnapshot().key,undefined);
  rows.set('ordinary',{id:'ordinary',title:'普通任务'});sync();await host.selectMainSession('');assert.equal(ui.adapter.current.getSnapshot().key,undefined);
  await host.dispose();await assert.rejects(host.selectMainSession('ui-a'),/已关闭/);
});

test('插件的等待交互按原始优先级显示，停用先撤销自身提示再等待处理；界面贡献和其他插件保持独立',async t=>{
  const {host,select}=await fixture(t);await select('ui-a');const ui=host.ctx.uiSession,current=ui.adapter.current;
  let low,high,release,delegated=0;const gate=new Promise(resolve=>release=resolve);t.after(()=>release());
  const descriptor=(key)=>({props:[key],resolve:binding=>({props:{[key]:`${binding.sessionId}:${key}`}})});
  assert.equal((await host.load({name:'low-ui',inject:['uiSession'],apply(ctx){ctx.uiSession.provide(descriptor('lowData'));low=ctx.uiSession.registerPendingInteraction(()=>10);}},'low-ui')).ok,true);
  assert.equal((await host.load({name:'high-ui',inject:['uiSession'],apply(ctx){ctx.uiSession.provide(descriptor('highData'));high=ctx.uiSession.registerPendingInteraction(()=>20);}},'high-ui')).ok,true);
  assert.equal(current.getSnapshot().props.lowData,'ui-a:lowData');assert.equal(current.getSnapshot().props.highData,'ui-a:highData');
  const lowValue={key:'low',kind:'fixture',sessionId:'ui-a'},highValue={key:'high',kind:'fixture',sessionId:'ui-a'};
  const offLow=low(lowValue,async()=>delegated++);high(highValue,async()=>{delegated++;await gate;});
  assert.equal(ui.sessionStatus.getSnapshot().get('ui-a').pendingInteraction,highValue);assert.throws(()=>high(highValue,async()=>{}),/duplicate/);
  let settled=false;const unload=host.unload('high-ui').then(()=>settled=true);await until(()=>delegated===1);
  assert.equal(settled,false);assert.equal(ui.sessionStatus.getSnapshot().get('ui-a').pendingInteraction,lowValue);
  assert.equal(current.getSnapshot().props.highData,undefined);assert.equal(current.getSnapshot().props.lowData,'ui-a:lowData');
  release();await unload;assert.equal(delegated,1);offLow();assert.equal(ui.sessionStatus.getSnapshot().get('ui-a').pendingInteraction,undefined);
  await host.unload('low-ui');assert.equal(delegated,1,'已自行完成的交互不能再次委托');assert.equal(current.getSnapshot().props.lowData,undefined);
  const bad=await host.load({name:'bad-ui',inject:['uiSession'],apply(ctx){ctx.uiSession.provide({props:['wrong'],resolve:()=>({props:{unlisted:1}})});}},'bad-ui');assert.equal(bad.ok,false);assert.match(bad.error,/undeclared/);assert.equal(current.getSnapshot().props.unlisted,undefined);
  assert.throws(()=>host.ctx.remote.$on('invented/event',()=>{}),/尚未提供/);assert.equal(host.ctx.remote.publish,undefined);
});

test('实际父子任务的运行与完成提示跟随官方控制流，切换不停止任务；回到确切任务才消除它的完成提示',{timeout:25000},async t=>{
  const previous=globalThis.dyworker,dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-ui-running-'))),profileDir=path.join(dir,'plugins');await fs.mkdir(path.join(profileDir,'node_modules'),{recursive:true});
  let finish,childId,rootCalls=0,calls=0;const gate=new Promise(resolve=>finish=resolve),workers=new Map();
  for(const id of ['running-a','running-b'])workers.set(id,new OfficialDshSession({sessionId:id,workspacePath:dir,profileDir,dataDir:path.join(dir,id),plugins:[],approve:async()=>true,
    async *generate(request){calls++;
      if(id==='running-a'&&request.sessionId===id&&rootCalls++===0){const args=JSON.stringify({prompt:'真实子任务',description:'界面状态检查',run_in_background:false});
        yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id:'ui-child',name:'subagent',argumentsDelta:args};yield {type:'block-end',index:0,block:{type:'tool-call',id:'ui-child',name:'subagent',arguments:args}};yield {type:'finish',reason:{kind:'tool-calls'}};
      }else{if(request.sessionId!==id){childId=request.sessionId;await gate;}const text='实际完成';yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};}
    }}));
  const rows=[...workers.keys()].map(id=>({id,runtime:'dsh',title:id,workspacePath:dir,messages:[{}]}));const host=new ClientPluginHost({sessionProvider:id=>rows.find(row=>row.id===id)});
  host.setCollections(()=>({items:rows,current:rows[0]}),()=>({items:[],current:null}));
  const actualEvents=[];globalThis.dyworker={dshOperation:async input=>{try{return {ok:true,value:await workers.get(input.sessionId).request(input.action,input.payload)};}catch(error){return {ok:false,error};}}};
  t.after(async()=>{finish();await host.dispose();for(const worker of workers.values())await worker.close();globalThis.dyworker=previous;await fs.rm(dir,{recursive:true,force:true});});
  for(const worker of workers.values())await worker.start();
  await host.load({name:'status-observer',inject:['remote'],apply(ctx){ctx.remote.$on('api-session/status',(id,running)=>actualEvents.push([id,running]));}},'status-observer');
  await host.selectMainSession('running-a');await host.openSessionHistory('running-a');await host.selectMainSession('running-b');await host.openSessionHistory('running-b');
  const pending=workers.get('running-a').request('prompt',{text:'启动真实父子任务'}),status=id=>host.ctx.uiSession.sessionStatus.getSnapshot().get(id);
  await until(()=>childId&&status(childId)?.running===true&&status('running-a')?.running===true);
  assert.equal(host.ctx.uiSession.adapter.current.getSnapshot().key,'running-b');assert.equal(calls,2);assert.equal(status('running-a').completionUnread,false);
  finish();await pending;await until(()=>status('running-a')?.running===false&&status(childId)?.running===false);
  assert.equal(calls,3);assert.equal(status('running-a').completionUnread,true);assert.equal(status(childId).completionUnread,true);assert.equal(status('running-b').completionUnread,false);
  assert.ok(actualEvents.some(([id,running])=>id===childId&&running));assert.ok(actualEvents.some(([id,running])=>id===childId&&!running));
  await host.selectMainSession('running-a');assert.equal(status('running-a').completionUnread,false);assert.equal(status(childId).completionUnread,true);
  const childReference=host.ctx.sessions.retain(host.ctx.sessions.subagentAddress(childId),{source:'detail'});await childReference.ready;t.after(()=>childReference.release());
  const childSource=host.ctx.uiSession.bindingSource(childReference);assert.equal(childSource.getSnapshot().props.sessionId,childId);assert.notEqual(childSource.getSnapshot().ctx,host.ctx.uiSession.adapter.current.getSnapshot().ctx);
  await host.selectMainSession(childId);assert.equal(host.ctx.uiSession.adapter.current.getSnapshot().key,childId);assert.equal(status(childId).completionUnread,false);assert.equal(host.ctx.sessions.retainInfo('running-a').getSnapshot().retainedBy.mainView,undefined);
  const stoppedEvents=actualEvents.length;await host.unload('status-observer');assert.equal(calls,3);await host.selectMainSession('');assert.equal(host.ctx.uiSession.adapter.current.getSnapshot().key,undefined);assert.equal(actualEvents.length,stoppedEvents);
});

test('新页面从实际初始记录识别已经运行的子任务，不把目录推测或补造状态事件当作依据',{timeout:20000},async t=>{
  const previous=globalThis.dyworker,dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-ui-existing-running-'))),profileDir=path.join(dir,'plugins');await fs.mkdir(path.join(profileDir,'node_modules'),{recursive:true});
  const rootId='existing-running-root';let calls=0,childId,finish,started;
  const gate=new Promise(resolve=>finish=resolve),childStarted=new Promise(resolve=>started=resolve);
  const worker=new OfficialDshSession({sessionId:rootId,workspacePath:dir,profileDir,dataDir:path.join(dir,'data'),plugins:[],approve:async()=>true,
    async *generate(request){calls++;
      if(request.sessionId===rootId&&calls===1){const block={type:'tool-call',id:'existing-running-child',name:'subagent',arguments:JSON.stringify({description:'原已运行子任务',prompt:'真实子任务',run_in_background:false})};
        yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};
      }else{if(request.sessionId!==rootId){childId=request.sessionId;started();await gate;}
        yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:'真实运行结束'}};yield {type:'finish',reason:{kind:'stop'}};
      }
    }});
  let host,pending;t.after(async()=>{finish();await pending?.catch(()=>{});await host?.dispose();await worker.close();globalThis.dyworker=previous;await fs.rm(dir,{recursive:true,force:true});});
  await worker.start();pending=worker.request('prompt',{text:'在页面打开前开始'});await childStarted;
  const root={id:rootId,runtime:'dsh',workspacePath:dir,messages:[{}]},events=[];
  host=new ClientPluginHost({sessionProvider:id=>id===rootId?root:undefined});host.setCollections(()=>({items:[root],current:root}),()=>({items:[],current:null}));
  globalThis.dyworker={dshOperation:async input=>{try{return {ok:true,value:await worker.request(input.action,input.payload)};}catch(error){return {ok:false,error};}}};
  await host.load({name:'existing-state-observer',inject:['remote'],apply(ctx){ctx.remote.$on('api-session/status',(id,running)=>events.push([id,running]));}},'existing-state-observer');
  await host.selectMainSession(rootId);await host.openSessionHistory(rootId);
  const status=id=>host.ctx.uiSession.sessionStatus.getSnapshot().get(id);
  await until(()=>status(childId)?.running===true);assert.equal(status(rootId).running,true);assert.equal(status(childId).completionUnread,false);
  assert.deepEqual(host.sessionListStore.getSnapshot().ids,[rootId]);assert.equal(events.some(([id,running])=>id===childId&&running),false,'初始状态来自真实目录，不补造过去的事件');
  const connection=host.ctx.get('connection').scope(rootId),generation=connection.generation.getSnapshot().id;connection.reconnect();
  await until(()=>connection.generation.getSnapshot()?.id>generation);assert.equal(status(childId).running,true);assert.equal(calls,2);
  finish();await pending;await until(()=>status(childId)?.running===false);assert.equal(status(childId).completionUnread,true);assert.equal(calls,3);
});
