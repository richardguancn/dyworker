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
import {queuedGoalPayload,settledStoredGoal} from '../electron/goal.mts';
const require=createRequire(import.meta.url);
const response=text=>new Response(JSON.stringify({choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});

test('渠道与自动续跑已有进度后报错，发送内容和窗口存档都说明未完成及原因',async t=>{
  let calls=0;
  const progress='视频介绍共 277 字符。现在核验成片规格。';
  const {host,workspacePath,runChannel,wake,envelopes,outbound,wakeRuns,entryRuns}=await setup(t,async()=>++calls%2===1
    ?new Response(JSON.stringify({choices:[{message:{role:'assistant',content:progress,
      tool_calls:[{id:`time-${calls}`,type:'function',function:{name:'get_datetime',arguments:'{}'}}]}}]}),{headers:{'content-type':'application/json'}})
    :new Response('{"error":{"message":"bad image input"}}',{headers:{'content-type':'text/event-stream'}}),true,{runtime:'dyworker'});
  await runChannel('检查视频');
  const channel=await host.sessions.getAsync('channel-root');
  assert.equal(channel.messages.at(-1).taskStatus,'error');
  assert.ok(channel.messages.at(-1).content.startsWith(progress));
  assert.match(outbound.at(-1),/任务未完成，已停止/);assert.match(outbound.at(-1),/模型服务返回了异常格式/);
  assert.equal(outbound.at(-1),channel.messages.at(-1).content);
  await host.sessions.replace({id:'wake-error',runtime:'dyworker',workspacePath,messages:[{role:'user',content:'检查视频'}]});
  await wake({sessionId:'wake-error',workspacePath,prompt:'检查视频',reason:'失败收尾验收',createdAt:new Date().toISOString(),wakeAt:new Date().toISOString()});
  await host.sessions.flush();
  const saved=await host.sessions.getAsync('wake-error');
  assert.equal(saved.messages.at(-1).taskStatus,'error');
  assert.ok(saved.messages.at(-1).content.startsWith(progress));
  assert.match(saved.messages.at(-1).content,/任务未完成，已停止/);assert.match(saved.messages.at(-1).content,/模型服务返回了异常格式/);
  assert.deepEqual(envelopes.filter(e=>e.type==='sessions:append'&&e.payload.sessionId==='wake-error').at(-1).payload.messages,[saved.messages.at(-1)]);
  assert.equal(calls,4);assert.equal(wakeRuns.size,0);assert.equal(entryRuns.size,0);
});
async function setup(t,fetchImpl,windowOpen=true,permissionCase=null) {
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-channel-wake-'))), workspacePath=path.join(dir,'work');await fs.mkdir(workspacePath);
  const router=()=>Object.assign(async()=>{throw new Error('Unexpected external tool');},{dispose:async()=>{}});
  const host=await createHost({userDataDir:dir,mountPlugins:true,agentResolvers:{isShuttingDown:()=>false,agentExtraTools:v=>v,mcpExtraTools:async()=>[],createExtraToolRouter:router,readHooks:async()=>[],readMemoryPages:async()=>[],readSkills:async()=>[],history:()=>null,readStandingRules:async()=>[],auditRecord:()=>{},memoriesFromAgentResult:()=>[],appendUsageStat:()=>{}}});
  t.after(async()=>{await disposeHost(host);await fs.rm(dir,{recursive:true,force:true});});
  await fs.mkdir(path.join(host.plugins.dir,'node_modules'),{recursive:true});await fs.symlink(path.dirname(require.resolve('dsh-office-tools/package.json')),path.join(host.plugins.dir,'node_modules/dsh-office-tools'),'dir');
  assert.equal((await host.plugins.install({spec:'dsh-office-tools'})).ok,true);
  const envelopes=[],outbound=[],entryRuns=new Map(),wakeRuns=new Map(),channelTaskAborts=new Set();
  const ctx={sessions:host.sessions,scheduler:host.scheduler,inbox:host.inbox,agent:{run:options=>host.agent.run({...options,fetchImpl})}};
  const settings={endpoint:'https://fixture.test/v1/chat/completions',model:'selected',apiKey:'test-only',profiles:permissionCase?.profiles || [],approvalMode:permissionCase?.mode || 'full-access',channels:{runtime:permissionCase?.runtime || 'dsh'}};
  await host.settings.write({approvalMode:settings.approvalMode});
  const deps={ctx,crypto,entryRuns,wakeRuns,channelTaskAborts,channelTaskKeys:new Set(),activeAgents:new Map(),mcpShuttingDown:false,CHANNEL_QUEUE_WAIT_TIMEOUT_MS:10000,
    trackTaskStart:()=>{},trackTaskEnd:()=>{},channelDebug:()=>{},CHANNEL_LABELS:{qq:'QQ',wechat:'微信'},defaultChannelWorkspace:async()=>workspacePath,
    mainWindow:windowOpen ? {isDestroyed:()=>false,webContents:{send:(type,payload)=>envelopes.push({type,payload})}} : null,
    createTranscriptCollector,mergeDshTranscript,queuedGoalPayload,settledStoredGoal,readSettings:async()=>settings,hasConfiguredModel,normalizeApprovalMode,wakeApprovalMode,
    UNATTENDED_PENDING_TIMEOUT_MS:10000,CHANNEL_STREAM_EVENT_TYPES:new Set(['queue-start','dsh-conversation','agent-finished']),
    parseWorkspaceSwitch:()=>null,buildChannelAttachments:async media=>{assert.deepEqual(media||[],[]);return [];},
    visibleConversationForSession:async id=>(await host.sessions.getAsync(id))?.messages.map(m=>({role:m.role,content:m.content}))||[],
    workingContextForSession:async()=>'',providerMessageContent:async message=>message.content,createExtraToolRouter:router,channelMediaToolDefinitions,
    persistSessionAppend:(id,messages)=>host.sessions.appendMessages(id,messages),drainSessionQueue:id=>envelopes.push({type:'drain',id})};
  const channel=mainChannelEntry(deps),wake=mainWakeEntry(deps);
  const runChannel=(text,isNewChat=true)=>channel({channel:permissionCase?.channel || 'qq',chat:{chatId:'isolated',userName:'测试'},chatKey:'qq:isolated',text,media:[],chatRecord:{sessionId:'channel-root',workspacePath,title:'隔离渠道'},isNewChat,
    reply:async text=>{outbound.push(text);if(permissionCase && text.includes('⚠️ 需要审批')) await host.settings.write({approvalMode:'full-access'});},replyMedia:async()=>{throw new Error('Unexpected external media');},sendTyping:async()=>{},registerPending:()=>{},clearPending:()=>{}});
  return {host,workspacePath,envelopes,outbound,entryRuns,wakeRuns,runChannel,wake};
}

test('渠道和自动唤醒沿用会话选择，不被默认模型替换',async t=>{
  const profile={id:'alternate',endpoint:'https://fixture.test/v1/chat/completions',model:'alternate-model',apiKey:'alternate-key'};
  const models=[];
  const {host,workspacePath,runChannel,wake}=await setup(t,async(_url,init)=>{
    models.push(JSON.parse(init.body).model);return response('会话模型验证完成');
  },false,{profiles:[profile]});
  const modelSelection={profileId:profile.id,endpoint:profile.endpoint,model:profile.model,reasoningEffort:''};
  await host.sessions.replace({id:'channel-root',runtime:'dsh',workspacePath,modelSelection,messages:[]});
  await runChannel('渠道验证',false);
  await host.sessions.replace({id:'wake-selected',runtime:'dsh',workspacePath,modelSelection,messages:[{role:'user',content:'继续验证'}]});
  await wake({sessionId:'wake-selected',workspacePath,prompt:'继续验证',reason:'验证会话模型',createdAt:new Date().toISOString(),wakeAt:new Date().toISOString()});
  assert.equal(models.length,2);
  assert.deepEqual(models,[profile.model,profile.model]);
});

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
  // 先发唤醒消息：开跑前一条（只有用户消息），收尾再补 DSH 轮次转录（整轮下发）
  const appends=envelopes.filter(e=>e.type==='sessions:append'&&e.payload.runId);
  assert.equal(appends[0].payload.messages.length,1);
  assert.equal(appends[0].payload.messages[0].role,'user');
  assert.equal(appends[0].payload.messages[0].content,saved.messages[2].content);
  assert.deepEqual(appends.at(-1).payload.messages,saved.messages.slice(2));
});

test('唤醒消息在模型开始产出之前就已上屏并落盘，收尾不重复下发用户消息',async t=>{
  let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);t.after(()=>release());
  const {host,workspacePath,envelopes,wake}=await setup(t,async()=>{entered();await gate;return response('唤醒后的实际回复');});
  await host.sessions.replace({id:'wake-first',workspacePath,messages:[{id:'old-user',role:'user',content:'旧要求'},{id:'old-assistant',role:'assistant',content:'旧回复'}]});
  const running=wake({sessionId:'wake-first',workspacePath,prompt:'旧要求',finalText:'此前的进展内容',reason:'先发唤醒消息验收',createdAt:new Date().toISOString(),wakeAt:new Date().toISOString()});
  // 模型请求已经发出（这轮执行已经开始），但还没有返回
  await started;
  const runId=envelopes.find(e=>e.type==='wake:status'&&e.payload.status==='running')?.payload.runId;
  assert.ok(runId);
  const early=envelopes.filter(e=>e.type==='sessions:append'&&e.payload.runId===runId);
  assert.equal(early.length,1);
  assert.equal(early[0].payload.messages.length,1);
  assert.equal(early[0].payload.messages[0].role,'user');
  assert.match(early[0].payload.messages[0].content,/^（到点自动唤醒）你于/);
  assert.match(early[0].payload.messages[0].content,/先发唤醒消息验收/);
  assert.match(early[0].payload.messages[0].content,/此前的进展内容/);
  const mid=await host.sessions.getAsync('wake-first');
  assert.deepEqual(mid.messages.map(m=>m.role),['user','assistant','user']);
  assert.equal(mid.messages.at(-1).content,early[0].payload.messages[0].content);
  assert.equal(mid.messages.at(-1).runId,runId);
  release();await running;
  const saved=await host.sessions.getAsync('wake-first');
  assert.deepEqual(saved.messages.map(m=>m.content),['旧要求','旧回复',early[0].payload.messages[0].content,'唤醒后的实际回复']);
  assert.deepEqual(envelopes.filter(e=>e.type==='sessions:append'&&e.payload.runId).at(-1).payload.messages.map(m=>m.role),['assistant']);
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

test('目标自动唤醒沿用当前目标，达成后先保存完成状态再释放队列',async t=>{
  let calls=0;
  const {host,workspacePath,envelopes,wake}=await setup(t,async()=>{
    calls++;
    return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'两项文字检查均已完成。',tool_calls:[{id:'goal-wake-finish',type:'function',function:{name:'finish_task',arguments:JSON.stringify({summary:'文字检查均已完成',evidence:'已核对两项文字',goalAchieved:true})}}]},finish_reason:'tool_calls'}]}),{headers:{'content-type':'application/json'}});
  });
  await host.sessions.replace({id:'wake-goal',runtime:'dsh',workspacePath,goal:'核对两项文字',goalState:{id:'wake-goal-generation',status:'active',createdAt:Date.now(),elapsedMs:5000,activeSince:Date.now()},messages:[{id:'old-user',role:'user',content:'核对两项文字'}]});
  await wake({sessionId:'wake-goal',workspacePath,prompt:'核对两项文字',reason:'隔离目标验收',createdAt:new Date().toISOString(),wakeAt:new Date().toISOString()});
  const saved=await host.sessions.getAsync('wake-goal');
  assert.equal(calls,1);
  assert.equal(saved.goalState.status,'complete');
  assert.ok(saved.goalState.elapsedMs>=5000);
  assert.equal(saved.goalState.activeSince,undefined);
  assert.equal(envelopes.filter(e=>e.type==='sessions:append').at(-1).payload.goalState.status,'complete');
  assert.equal(queuedGoalPayload({goal:'核对两项文字'},saved).goal,'');
});


test('微信与 QQ 实际任务入口：运行中开启完全访问，撤回旧审批并执行新建 Python 脚本',async t=>{
  for (const channel of ['qq','wechat']) await t.test(channel,async t=>{
    let step=0;
    const {host,workspacePath,outbound,runChannel}=await setup(t,async(_url,init)=>{
      const body=JSON.parse(init.body);
      if(body.messages?.[0]?.content.includes('审批说明撰写助手')) return response('在当前工作目录运行报告脚本。');
      const calls=[
        {name:'write_file',args:{path:'channel_report.py',content:"from pathlib import Path\nPath('channel_report.txt').write_text('channel verified', encoding='utf8')\nprint('channel verified')\n"}},
        {name:'run_command',args:{command:'python3 channel_report.py'}},
        {name:'run_command',args:{command:'python3 channel_report.py'}},
      ];
      const call=calls[step++];
      if(!call)return response('报告已生成并检查。');
      return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:`permission-${step}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]},finish_reason:'tool_calls'}]}),{headers:{'content-type':'application/json'}});
    },true,{channel,mode:'interactive',runtime:'dyworker'});
    await runChannel('在当前目录创建并运行报告脚本');
    assert.ok(await fs.stat(path.join(workspacePath,'channel_report.txt')).catch(()=>null),JSON.stringify(outbound));
    assert.equal(await fs.readFile(path.join(workspacePath,'channel_report.txt'),'utf8'),'channel verified');
    assert.equal(outbound.filter(text=>text.includes('⚠️ 需要审批')).length,1);
    // 审批被新权限撤回时要当面告知 IM 用户，否则他会继续去回一张已作废的卡片
    assert.ok(outbound.some(text=>text.includes('审批权限已更新')),JSON.stringify(outbound));
    assert.ok(outbound.includes('报告已生成并检查。'));
    await host.inbox.persistQueue;
    assert.equal(host.inbox.pending.size,0);
    assert.equal((await host.inbox.read()).filter(item=>item.status==='pending').length,0);
    assert.equal(host.settings.approvalListeners.size,0);
  });
});
