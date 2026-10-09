import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {createHost,disposeHost} from '../electron/host/context.mts';
import {createTranscriptCollector,mainChannelEntry,mainWakeEntry} from './helpers/main-transcript.mjs';
import {mergeDshTranscript} from '../electron/host/dsh-runtime/presentation.mts';
import {hasConfiguredModel} from '../electron/host/dsh-runtime/model-settings.mts';
import {normalizeApprovalMode,wakeApprovalMode} from '../electron/settings.mts';
import {channelMediaToolDefinitions} from '../electron/channels/media-tools.mts';
const require=createRequire(import.meta.url);
const response=text=>new Response(JSON.stringify({choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
async function setup(t,fetchImpl,windowOpen=true) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-channel-wake-'))), workspacePath=path.join(dir,'work');await fs.mkdir(workspacePath);
  const router=()=>Object.assign(async()=>{throw new Error('Unexpected external tool');},{dispose:async()=>{}});
  const host=await createHost({userDataDir:dir,mountPlugins:true,agentResolvers:{isShuttingDown:()=>false,agentExtraTools:v=>v,mcpExtraTools:async()=>[],createExtraToolRouter:router,readHooks:async()=>[],readStandingRules:async()=>[],auditRecord:()=>{},memoriesFromAgentResult:()=>[],appendUsageStat:()=>{}}});
  t.after(async()=>{await disposeHost(host);await fs.rm(dir,{recursive:true,force:true});});
  await fs.mkdir(path.join(host.plugins.dir,'node_modules'),{recursive:true});await fs.symlink(path.dirname(require.resolve('dsh-office-tools/package.json')),path.join(host.plugins.dir,'node_modules/dsh-office-tools'),'dir');
  assert.equal((await host.plugins.install({spec:'dsh-office-tools'})).ok,true);
  const envelopes=[],outbound=[],entryRuns=new Map(),wakeRuns=new Map(),channelTaskAborts=new Set();
  const ctx={sessions:host.sessions,scheduler:host.scheduler,inbox:host.inbox,agent:{run:options=>host.agent.run({...options,fetchImpl})}};
  const settings={endpoint:'https://fixture.test/v1/chat/completions',model:'selected',apiKey:'test-only',approvalMode:'full-access',channels:{runtime:'dsh'}};
  const deps={ctx,crypto,entryRuns,wakeRuns,channelTaskAborts,channelTaskKeys:new Set(),activeAgents:new Map(),mcpShuttingDown:false,CHANNEL_QUEUE_WAIT_TIMEOUT_MS:10000,
    trackTaskStart:()=>{},trackTaskEnd:()=>{},channelDebug:()=>{},CHANNEL_LABELS:{qq:'QQ'},defaultChannelWorkspace:async()=>workspacePath,
    mainWindow:windowOpen ? {isDestroyed:()=>false,webContents:{send:(type,payload)=>envelopes.push({type,payload})}} : null,
    createTranscriptCollector,mergeDshTranscript,readSettings:async()=>settings,hasConfiguredModel,normalizeApprovalMode,wakeApprovalMode,
    UNATTENDED_PENDING_TIMEOUT_MS:10000,CHANNEL_STREAM_EVENT_TYPES:new Set(['queue-start','dsh-conversation','agent-finished']),
    parseWorkspaceSwitch:()=>null,buildChannelAttachments:async media=>{assert.deepEqual(media||[],[]);return [];},
    visibleConversationForSession:async id=>(await host.sessions.getAsync(id))?.messages.map(m=>({role:m.role,content:m.content}))||[],
    workingContextForSession:async()=>'',providerMessageContent:async message=>message.content,createExtraToolRouter:router,channelMediaToolDefinitions,
    persistSessionAppend:(id,messages)=>host.sessions.appendMessages(id,messages),drainSessionQueue:id=>envelopes.push({type:'drain',id})};
  const channel=mainChannelEntry(deps),wake=mainWakeEntry(deps);
  const runChannel=(text,isNewChat=true)=>channel({channel:'qq',chat:{chatId:'isolated',userName:'测试'},chatKey:'qq:isolated',text,media:[],chatRecord:{sessionId:'channel-root',workspacePath,title:'隔离渠道'},isNewChat,
    reply:async text=>outbound.push(text),replyMedia:async()=>{throw new Error('Unexpected external media');},sendTyping:async()=>{},registerPending:()=>{},clearPending:()=>{}});
  return {host,workspacePath,envelopes,outbound,entryRuns,wakeRuns,runChannel,wake};
}

test('真实渠道入口使用 DSH，两轮按真实顺序落盘；下一次相同要求和回复仍各保存一次',async t=>{
  let entered,release,calls=0;const start=new Promise(r=>entered=r),gate=new Promise(r=>release=r);t.after(()=>release());
  const {host,envelopes,outbound,entryRuns,runChannel}=await setup(t,async()=>{calls++;if(calls===1){entered();await gate;}return response(calls===2?'第二轮实际回复':'相同的实际回复');});
  const running=runChannel('重复要求');await start;assert.equal((await host.sessions.getAsync('channel-root')).runtime,'dsh');assert.ok(entryRuns.has('channel-root'));
  await host.dshRuntime.request('channel-root','input-admit',{requestId:'channel-queue',mode:'queue',content:[{type:'text',text:'实际追加要求'}]});release();await running;
  const first=await host.sessions.getAsync('channel-root');assert.deepEqual(first.messages.map(m=>m.content),['[来自QQ 测试] 重复要求','相同的实际回复','实际追加要求','第二轮实际回复']);
  const append=envelopes.find(e=>e.type==='sessions:append'&&e.payload.runId);assert.deepEqual(append.payload.messages,first.messages);
  await runChannel('重复要求',false);const saved=await host.sessions.getAsync('channel-root');assert.equal(saved.messages.length,6);assert.equal(saved.messages.at(-1).content,'相同的实际回复');
  assert.deepEqual(outbound,['第二轮实际回复','相同的实际回复']);assert.equal(entryRuns.size,0);assert.ok(saved.messages.every(m=>m.dshMessageId));
});

test('实际渠道原生停止保留已生成片段，完整保存并释放运行归属',async t=>{
  let entered;const started=new Promise(r=>entered=r);
  const {host,envelopes,outbound,entryRuns,runChannel}=await setup(t,async(_url,init)=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{content:'渠道停止前的实际片段'}}]})}\n\n`));init.signal.addEventListener('abort',()=>controller.error(init.signal.reason),{once:true});entered();}}),{headers:{'content-type':'text/event-stream'}}));
  const running=runChannel('停止验收');await started;
  const end=Date.now()+10000;while(!envelopes.some(e=>e.payload?.event?.type==='dsh-conversation'&&e.payload.event.turns.some(turn=>turn.replies.some(reply=>reply.text==='渠道停止前的实际片段')))){if(Date.now()>end)throw new Error('没有收到实际渠道片段');await new Promise(r=>setTimeout(r,10));}
  entryRuns.get('channel-root').abort.abort();await running;const saved=await host.sessions.getAsync('channel-root');assert.equal(saved.messages.at(-1).taskStatus,'cancelled');assert.match(saved.messages.at(-1).content,/渠道停止前的实际片段/);assert.equal(entryRuns.size,0);assert.deepEqual(outbound,[]);
  assert.match(saved.messages.at(-1).content,/已按你的要求停止/);assert.doesNotMatch(saved.messages.at(-1).content,/通过渠道消息停止/);
});

test('窗口关闭时真实渠道入口仍完整保存并可重新读取，原有会话不被移除',async t=>{
  const {host,runChannel,envelopes,outbound}=await setup(t,async()=>response('没有窗口的实际回复'),false);
  await host.sessions.replace({id:'another-root',messages:[{role:'user',content:'另一份原有记录'}]});
  await runChannel('无窗口渠道要求');await host.sessions.flush();
  const saved=await host.sessions.getAsync('channel-root');assert.deepEqual(saved.messages.map(m=>m.content),['[来自QQ 测试] 无窗口渠道要求','没有窗口的实际回复']);
  assert.ok(saved.messages.every(m=>m.dshMessageId));assert.equal((await host.sessions.getAsync('another-root')).messages[0].content,'另一份原有记录');
  assert.deepEqual(outbound,['没有窗口的实际回复']);assert.equal(envelopes.filter(e=>e.type==='sessions:append').length,0);
});

test('真实唤醒入口沿用原任务的 DSH，两轮完整保存并释放归属，重复文字不删旧记录',async t=>{
  let entered,release,calls=0;const start=new Promise(r=>entered=r),gate=new Promise(r=>release=r);t.after(()=>release());
  const {host,workspacePath,envelopes,wakeRuns,wake}=await setup(t,async()=>{if(++calls===1){entered();await gate;}return response(`唤醒实际第${calls}轮`);});
  await host.sessions.replace({id:'wake-root',runtime:'dsh',workspacePath,messages:[{id:'old-user',role:'user',content:'旧要求'},{id:'old-assistant',role:'assistant',content:'旧回复'}]});
  const running=wake({sessionId:'wake-root',workspacePath,prompt:'旧要求',reason:'隔离验收',createdAt:new Date().toISOString(),wakeAt:new Date().toISOString()});await start;assert.ok(wakeRuns.has('wake-root'));
  await host.dshRuntime.request('wake-root','input-admit',{requestId:'wake-second',mode:'queue',content:[{type:'text',text:'唤醒后实际追加'}]});release();await running;
  const saved=await host.sessions.getAsync('wake-root');assert.equal(saved.messages.length,6);assert.equal(saved.messages[0].content,'旧要求');assert.equal(saved.messages[3].content,'唤醒实际第1轮');assert.equal(saved.messages[4].content,'唤醒后实际追加');assert.equal(saved.messages[5].content,'唤醒实际第2轮');
  assert.equal(wakeRuns.size,0);assert.ok(envelopes.some(e=>e.type==='agent:event'&&e.payload.wakeRun&&e.payload.event.type==='agent-finished'));
  assert.deepEqual(envelopes.find(e=>e.type==='sessions:append').payload.messages,saved.messages.slice(2));
});

test('实际唤醒停止保留片段，旧历史和本轮要求不被覆盖，所属占用完成释放',async t=>{
  let entered;const start=new Promise(r=>entered=r);
  const {host,workspacePath,envelopes,wakeRuns,wake}=await setup(t,async(_url,init)=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{content:'唤醒停止前的实际片段'}}]})}\n\n`));init.signal.addEventListener('abort',()=>controller.error(init.signal.reason),{once:true});entered();}}),{headers:{'content-type':'text/event-stream'}}));
  await host.sessions.replace({id:'wake-root',runtime:'dsh',workspacePath,messages:[{id:'old-user',role:'user',content:'旧要求'},{id:'old-assistant',role:'assistant',content:'旧回复'}]});
  const running=wake({sessionId:'wake-root',workspacePath,prompt:'旧要求',reason:'停止验收',createdAt:new Date().toISOString(),wakeAt:new Date().toISOString()});await start;
  const end=Date.now()+10000;while(!envelopes.some(e=>e.payload?.event?.type==='dsh-conversation'&&e.payload.event.turns.some(turn=>turn.replies.some(reply=>reply.text==='唤醒停止前的实际片段')))){if(Date.now()>end)throw new Error('没有收到实际唤醒片段');await new Promise(r=>setTimeout(r,10));}
  wakeRuns.get('wake-root').abort.abort();await running;const saved=await host.sessions.getAsync('wake-root');
  assert.deepEqual(saved.messages.slice(0,2).map(m=>m.content),['旧要求','旧回复']);assert.equal(saved.messages.length,4);assert.match(saved.messages.at(-1).content,/唤醒停止前的实际片段/);assert.equal(saved.messages.at(-1).taskStatus,'cancelled');assert.equal(wakeRuns.size,0);
});
