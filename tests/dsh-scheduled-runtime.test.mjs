import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {createHost,disposeHost} from '../electron/host/context.mts';
import {mainScheduledEntry,createTranscriptCollector} from './helpers/main-transcript.mjs';
import {hasConfiguredModel} from '../electron/host/dsh-runtime/model-settings.mts';
import {unattendedApprovalMode} from '../electron/settings.mts';
import {mergeDshTranscript} from '../electron/host/dsh-runtime/presentation.mts';
const require=createRequire(import.meta.url);
const settings={endpoint:'https://fixture.test/v1/chat/completions',model:'selected',apiKey:'only-in-parent',approvalMode:'full-access'};
async function setup(t,fetchImpl,windowOpen=false) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-dsh-schedule-')));const workspacePath=path.join(dir,'work');await fs.mkdir(workspacePath);
  const host=await createHost({userDataDir:dir,mountPlugins:true,agentResolvers:{isShuttingDown:()=>false,agentExtraTools:value=>value,mcpExtraTools:async()=>[],
    createExtraToolRouter:()=>Object.assign(()=>{},{dispose:async()=>{}}),readHooks:async()=>[],readStandingRules:async()=>[],
    readMemoryPages:async()=>[],readSkills:async()=>[],history:()=>[],hasPendingWakeForSession:()=>false,
    auditRecord:()=>{},memoriesFromAgentResult:()=>[],appendUsageStat:()=>{}}});
  t.after(async()=>{await disposeHost(host);await fs.rm(dir,{recursive:true,force:true});});
  await fs.mkdir(path.join(host.plugins.dir,'node_modules'),{recursive:true});await fs.symlink(path.dirname(require.resolve('dsh-office-tools/package.json')),path.join(host.plugins.dir,'node_modules/dsh-office-tools'),'dir');
  assert.equal((await host.plugins.install({spec:'dsh-office-tools'})).ok,true);
  const envelopes=[],entryRuns=new Map();const original=host.agent.run.bind(host.agent);
  const ctx={scheduler:host.scheduler,sessions:host.sessions,inbox:host.inbox,agent:{run:options=>original({...options,fetchImpl})}};
  const execute=mainScheduledEntry({ctx,crypto,entryRuns,trackTaskStart:()=>{},trackTaskEnd:()=>{},broadcastSchedulesChanged:()=>{},
    createTranscriptCollector,mergeDshTranscript,readSettings:async()=>settings,hasConfiguredModel,unattendedApprovalMode,UNATTENDED_PENDING_TIMEOUT_MS:10000,
    sendScheduleRunStarted:payload=>envelopes.push({type:'started',payload}),CHANNEL_STREAM_EVENT_TYPES:new Set(['dsh-conversation','assistant-text','agent-finished']),
    mainWindow:windowOpen?{isDestroyed:()=>false,webContents:{send:(type,payload)=>envelopes.push({type,payload})}}:null,
    persistSessionRecord:session=>host.sessions.replace(session),drainSessionQueue:id=>envelopes.push({type:'drain',id})});
  return {host,workspacePath,execute,envelopes,entryRuns};
}
const response=text=>new Response(JSON.stringify({choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});

test('实际计划壳层选择 DSH 并提前登记真实根任务，两次模型回复完整保存在无窗口存档中',async t=>{
  let entered,release,calls=0;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);t.after(()=>release());
  const {host,workspacePath,execute,envelopes,entryRuns}=await setup(t,async()=>{if(++calls===1){entered();await gate;}return response(`真实第${calls}轮回复`);});
  await host.scheduler.save({name:'无窗口插件计划',runtime:'dsh',workspacePath,prompt:'计划原始要求',allowWorkspaceWrites:true,recurrence:'once',nextRun:'2030-01-01T00:00:00Z'});
  const [plan]=await host.scheduler.list();
  const running=execute(plan,{manual:true});
  await started;const root=envelopes.find(event=>event.type==='started').payload;
  assert.equal(root.runtime,'dsh');assert.equal((await host.sessions.getAsync(root.sessionId)).runtime,'dsh');assert.ok(entryRuns.has(root.sessionId));
  await host.dshRuntime.request(root.sessionId,'input-admit',{requestId:'schedule-second',mode:'queue',content:[{type:'text',text:'计划实际补充'}]});release();await running;
  const saved=await host.sessions.getAsync(root.sessionId);assert.equal(saved.runtime,'dsh');assert.equal(calls,2);
  assert.deepEqual(saved.messages.map(m=>m.content),['计划原始要求','真实第1轮回复','计划实际补充','真实第2轮回复']);
  assert.ok(saved.messages.every(m=>m.dshMessageId));assert.equal(saved.messages.at(-1).taskStatus,'done');assert.equal(entryRuns.size,0);
  assert.equal((await host.scheduler.list())[0].lastStatus,'success');
  assert.ok(envelopes.some(event=>event.type==='drain'&&event.id===root.sessionId));
  const snapshot=await host.dshRuntime.request(root.sessionId,'snapshot');
  for(const message of saved.messages)assert.ok(snapshot.events.some(event=>(event.type==='user/message'?event.data?.id:event.type==='assistant/message'?event.data?.message?.id:null)===message.dshMessageId));
});

test('实际计划停止保留已生成片段，窗口收尾与存档一致',async t=>{
  let entered;const started=new Promise(resolve=>entered=resolve);
  const {host,workspacePath,execute,envelopes,entryRuns}=await setup(t,async(_url,init)=>new Response(new ReadableStream({start(controller){
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{role:'assistant',content:'计划停止前的真实片段'}}]})}\n\n`));
    init.signal.addEventListener('abort',()=>controller.error(init.signal.reason),{once:true});entered();
  }}),{headers:{'content-type':'text/event-stream'}}),true);
  await host.scheduler.save({name:'停止验收',runtime:'dsh',workspacePath,prompt:'原始要求',allowWorkspaceWrites:true,recurrence:'once',nextRun:'2030-01-01T00:00:00Z'});
  const [plan]=await host.scheduler.list();
  const running=execute(plan,{manual:true});await started;
  const root=envelopes.find(event=>event.type==='started').payload;
  const end=Date.now()+10000;while(!envelopes.some(event=>event.type==='agent:event'&&event.payload.event.type==='dsh-conversation'&&event.payload.event.turns[0].replies.some(r=>r.text==='计划停止前的真实片段'))){if(Date.now()>end)throw new Error('未收到真实计划片段');await new Promise(resolve=>setTimeout(resolve,10));}
  entryRuns.get(root.sessionId).abort.abort();await running;
  const saved=await host.sessions.getAsync(root.sessionId);assert.match(saved.messages.at(-1).content,/计划停止前的真实片段/);assert.equal(saved.messages.at(-1).taskStatus,'cancelled');
  assert.deepEqual(envelopes.find(event=>event.type==='sessions:prepend').payload.messages,saved.messages);assert.equal(entryRuns.size,0);
  const stopped=(await host.scheduler.list())[0];assert.equal(stopped.lastStatus,'cancelled');assert.equal(stopped.enabled,false);assert.equal(stopped.history.at(-1).status,'cancelled');
});

test('未选择 DSH 的旧计划仍按原有方式执行并保存两条记录',async t=>{
  const {host,workspacePath,execute,envelopes}=await setup(t,async()=>response('旧计划实际回复'));
  await host.scheduler.save({name:'旧计划',workspacePath,prompt:'旧计划原始要求',allowWorkspaceWrites:true,recurrence:'once',nextRun:'2030-01-01T00:00:00Z'});
  const [record]=await host.scheduler.list();await execute(record,{manual:true});
  const root=envelopes.find(e=>e.type==='started').payload,saved=await host.sessions.getAsync(root.sessionId);
  assert.equal(root.runtime,'dyworker');assert.equal(saved.runtime,'dyworker');assert.deepEqual(saved.messages.map(m=>m.content),['旧计划原始要求','旧计划实际回复']);
  assert.ok(saved.messages.every(m=>!m.dshMessageId));assert.equal((await host.scheduler.list())[0].lastStatus,'success');
});
