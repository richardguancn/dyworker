import test from 'node:test';
import assert from 'node:assert/strict';
import {createTranscriptCollector} from './helpers/main-transcript.mjs';
import {reconcileChannelAppend,isWakeRunEnvelope} from '../src/channelStream.ts';
import {mergeDshTranscript} from '../electron/host/dsh-runtime/presentation.mts';
import {createHost,disposeHost} from '../electron/host/context.mts';
import {agentIpcPlugin} from '../electron/host/plugins/agent-ipc.mts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const time='2026-10-07T05:00:00.000Z';
const reply=(id,text,partial=false)=>({id,text,partial,createdAt:time,executedMessages:partial?[]:[{role:'assistant',content:text}]});
const first={user:{id:'real-u1',text:'实际第一条要求',createdAt:time},replies:[reply('a1','第一轮回复')]};
const second={user:{id:'u2',text:'补充要求',createdAt:time},replies:[reply('temporary','第二轮片段',true)]};

test('实际共用收集器保留各轮回复、进度与初始附件，停止只标到第二轮，媒体发送注记不覆盖第一轮',()=>{
  const collector=createTranscriptCollector({runId:'run',userMessage:{id:'native-user',attachments:[{name:'实际文件'}],pluginReferences:[{ref:'actual'}]}});
  collector.handle({type:'dsh-conversation',turns:[{...first,replies:[]}]});
  collector.handle({type:'activity',activity:{id:'tool1',status:'running'}});
  collector.handle({type:'dsh-conversation',turns:[first,{...second,replies:[]}]});
  collector.handle({type:'activity',activity:{id:'tool2',status:'running'}});
  collector.handle({type:'activity-update',id:'tool1',status:'success'});
  collector.handle({type:'dsh-conversation',turns:[first,second]});
  const saved=collector.buildMessages('原生第一条要求',{status:'cancelled',finalText:'第二轮片段',dshTurns:[first,second]},'第二轮片段\n\n已停止');
  assert.deepEqual(saved.map(message=>message.content),['实际第一条要求','第一轮回复','补充要求','第二轮片段\n\n已停止']);
  assert.equal(saved[0].attachments[0].name,'实际文件');assert.equal(saved[0].pluginReferences[0].ref,'actual');
  assert.deepEqual(saved[1].activities.map(a=>a.id),['tool1']);assert.equal(saved[1].activities[0].status,'success');
  assert.deepEqual(saved[3].activities.map(a=>a.id),['tool2']);assert.equal(saved[3].taskStatus,'cancelled');assert.equal(saved[3].dshMessageId,undefined);
  const delivered=collector.buildMessages('原生第一条要求',{status:'done',finalText:'第二轮片段',dshTurns:[first,second]},'第二轮片段（已发送 1 个文件）');
  // Sent-media notes also survive successful settlement, independently of official assistant text.
  assert.equal(delivered[1].content,'第一轮回复');assert.match(delivered[3].content,/已发送 1 个文件/);
});

test('渠道收尾先到或先收到结束事件都替换所有本轮内容，重复传录不增加消息且保留其他任务和未执行队列',()=>{
  const collector=createTranscriptCollector({runId:'run',userMessage:{id:'native-user'}});
  const final=collector.buildMessages('原始文字',{status:'cancelled',finalText:'第二轮片段',dshTurns:[first,second]},'第二轮片段\n\n用户停止');
  const pending={id:'still-pending',role:'user',content:'没有执行的排队要求'};
  const existing=[{id:'history',role:'assistant',content:'旧记录'},{id:'native-user',runId:'run',role:'user',content:'原始文字'},
    {id:'run:assistant',role:'assistant',runId:'run',dshTurnId:'real-u1',content:'第一轮半截'},
    {id:'u2',role:'user',content:'补充要求'},{id:'run:dsh-turn:u2',role:'assistant',runId:'run',dshTurnId:'u2',content:'第二轮半截'},pending];
  for(const placeholder of ['run:assistant',null]){
    const merged=reconcileChannelAppend(existing,placeholder,final).messages;
    assert.deepEqual(merged.map(m=>m.content),['旧记录','实际第一条要求','第一轮回复','补充要求','第二轮片段\n\n用户停止','没有执行的排队要求']);
    assert.deepEqual(reconcileChannelAppend(merged,null,final).messages,merged);
    assert.deepEqual(mergeDshTranscript(existing,final),merged);
  }
});

test('计划与渠道运行方式可以保存和恢复，旧计划仍按原方式运行，非法运行方式不能写入',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dyw-entry-mode-'));const host=await createHost({userDataDir:dir});
  t.after(async()=>{await disposeHost(host);await fs.rm(dir,{recursive:true,force:true});});
  const draft={name:'插件计划',prompt:'实际任务',workspacePath:dir,recurrence:'once',nextRun:'2030-01-01T00:00:00Z',runtime:'dsh'};
  assert.equal((await host.scheduler.save(draft)).ok,true);const [record]=await host.scheduler.list();assert.equal(record.runtime,'dsh');
  assert.equal((await host.scheduler.save({...draft,runtime:'unknown'})).ok,false);assert.equal((await host.scheduler.list()).length,1);
  assert.equal((await host.scheduler.save({...draft,name:'旧运行方式',runtime:undefined})).ok,true);
  assert.equal((await host.scheduler.list()).find(item=>item.name==='旧运行方式').runtime,'dyworker');
  await host.settings.write({channels:{runtime:'dsh'}});assert.equal((await host.settings.read()).channels.runtime,'dsh');
  await host.settings.write({channels:{runtime:'unknown'}});assert.equal((await host.settings.read()).channels.runtime,undefined);
  const firstMessages=mergeDshTranscript([],createTranscriptCollector({runId:'one'}).buildMessages('重复要求',{status:'done',finalText:'相同回复',dshTurns:[first]}));
  const secondMessages=createTranscriptCollector({runId:'two'}).buildMessages('重复要求',{status:'done',finalText:'相同回复',dshTurns:[{...first,user:{...first.user,id:'other-u1'}}]});
  const saved={id:'headless',runtime:'dsh',workspacePath:dir,messages:mergeDshTranscript(firstMessages,secondMessages)};
  await host.sessions.replace(saved);await host.sessions.flush();assert.equal((await host.sessions.getAsync('headless')).messages.length,4);
  await Promise.all([host.sessions.replace({id:'sibling',messages:[]}),host.sessions.replace({...saved,title:'更新原任务'})]);
  assert.deepEqual((await host.sessions.loadAll()).map(session=>session.id).sort(),['headless','sibling']);
  assert.equal((await host.sessions.getAsync('headless')).title,'更新原任务');
  assert.equal(isWakeRunEnvelope({wakeRun:true}),true);assert.equal(isWakeRunEnvelope({scheduleRun:true}),false);
});

test('原生停止按确切运行标识取消计划或渠道，不会停止兄弟任务，同时撤销待唤醒',async()=>{
  const handlers=new Map(),calls=[],a=new AbortController(),b=new AbortController();
  const ctx={scheduler:{cancelForSession:async id=>calls.push(id)}};
  agentIpcPlugin({trustedHandle:(name,handler)=>handlers.set(name,handler),activeAgents:new Map(),wakeRuns:new Map(),
    entryRuns:new Map([['a',{runId:'run-a',abort:a}],['b',{runId:'run-b',abort:b}]])}).apply(ctx);
  const cancel=handlers.get('agent:cancel');assert.equal((await cancel({}, {sessionId:'a',runId:'other'})).ok,false);assert.equal(a.signal.aborted,false);
  assert.equal((await cancel({}, {sessionId:'a',runId:'run-a'})).ok,true);assert.equal(a.signal.aborted,true);assert.equal(b.signal.aborted,false);
  assert.deepEqual(calls,['a']);
});
