import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createTelemetryController, shanghaiDayKey } from '../electron/telemetry.mts';
import { createRemoteMessagesManager } from '../electron/remote-messages.mts';

const backend = process.env.DYWORKER_PLATFORM_BACKEND;
const secretStorage = {isEncryptionAvailable:()=>true, encryptString:s=>Buffer.from(s), decryptString:b=>b.toString()};
// Explicit opt-in: temporary database, local random port, actual platform business routes.
test('真实平台联调：登记、统计、断网补传去重、重启、消息回执与撤回、关闭、删除', {skip:!backend, timeout:60000}, async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dyw-platform-acceptance-'));
 const child=spawn(path.join(backend,'.venv/bin/python'),[fileURLToPath(new URL('./fixtures/operations-platform.py',import.meta.url)),path.join(dir,'isolated.sqlite')],{
  cwd:backend,env:{...process.env,PYTHONPATH:backend,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
 let diagnostic=''; child.stderr.on('data',b=>{diagnostic=(diagnostic+b.toString()).slice(-12000)});
 const clients=[]; let messages;
 try{
  const port=await new Promise((resolve,reject)=>{
   let output=''; const timer=setTimeout(()=>reject(new Error('Platform startup timeout: '+diagnostic)),15000);
   child.once('exit',code=>{clearTimeout(timer);reject(new Error('Platform exit '+code+': '+diagnostic))});
   child.stdout.on('data',b=>{output+=b;const match=/ACCEPTANCE_PORT=(\d+)/.exec(output);if(match){clearTimeout(timer);resolve(Number(match[1]))}});
  });
  const base=`http://127.0.0.1:${port}`;
  const api=async(route,body)=>{
   const r=await fetch(base+'/api/v1/dyworker'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
   const p=JSON.parse(await r.text(),(key,v,c)=>typeof v==='number'&&!Number.isSafeInteger(v)?c.source:v);
   assert.equal(r.status,200,JSON.stringify(p));assert.equal(p.code,200,JSON.stringify(p));return p.data;
  };
  let clock=Date.now()-90000, mono=0, failOnce=true;
  const settings={telemetry:{serviceUrl:base,statsEnabled:true,messagesEnabled:true}};
  const create=(overrides={})=>{const c=createTelemetryController({userDataDir:dir,appVersion:'0.2.2-acceptance',platform:'darwin',secretStorage,now:()=>clock,monotonicNow:()=>mono,...overrides});clients.push(c);return c};
  const controller=create({fetchImpl:async(url,init)=>{
   const response=await fetch(url,init);
   // Simulate the response getting lost AFTER server commit; retry must deduplicate.
   if(url.endsWith('/telemetry/batches')&&failOnce){failOnce=false;await response.text();throw new Error('simulated response loss')}
   return response;
  }});
  await controller.configure(settings);
  assert.equal((await controller.status()).registered,true);
  controller.noteUserActivity();
  for(let i=0;i<6;i++){clock+=5000;mono+=5000;controller.tick()}
  assert.equal((await controller.flushOnce()).ok,false);
  assert.ok(await controller.store.count());
  const retry=await controller.flushOnce();assert.equal(retry.ok,true);assert.equal(retry.rejected,0);assert.equal(await controller.store.count(),0);
  const day=shanghaiDayKey(clock);
  const metrics=await api(`/admin/metrics?start_date=${day}&end_date=${day}`);
  assert.equal(metrics.daily[0].dau,1);assert.equal(metrics.daily[0].foreground_seconds,30);
  assert.equal(metrics.monthly[0].mau,1);assert.equal(metrics.version_distribution[0].version,'0.2.2-acceptance');
  const installations=await api('/admin/installations');
  const items=Array.isArray(installations)?installations:installations.items;
  assert.equal(items.length,1);assert.ok(items[0].last_ip,'server observed IP');
  controller.stop();
  const restarted=create();await restarted.configure(settings);
  assert.equal(restarted.getInstallationId(),controller.getInstallationId());assert.equal((await restarted.status()).registered,true);
  messages=createRemoteMessagesManager({file:path.join(dir,'messages.json'),client:restarted.getClient()});
  await messages.configure({messagesEnabled:true,notifyNewMessages:false});
  const draft=await api('/admin/messages',{title:'验收通知',content:'真实平台联调消息',category:'update',action_url:'https://example.com/notice',audience:{installations:[restarted.getInstallationId()]}});
  await api(`/admin/messages/${draft.id}/publish`,{idempotency_key:'acceptance-publish-1'});
  const pulled=await messages.pull();assert.equal(pulled.ok,true,JSON.stringify(pulled));
  const list=await messages.listMessages();assert.equal(list.length,1);assert.equal(list[0].message_id,String(draft.id));
  assert.equal(list[0].body,'真实平台联调消息');assert.equal(list[0].link,'https://example.com/notice');assert.equal(list[0].category,'version');
  await messages.markRead(String(draft.id));
  await new Promise(r=>setTimeout(r,100));await messages.markClicked(String(draft.id));
  await new Promise(r=>setTimeout(r,100));await messages.flushReceipts();
  const receipts=await api(`/admin/messages/${draft.id}/receipts`);
  assert.equal(receipts.summary.received,1);assert.equal(receipts.summary.read,1);assert.equal(receipts.summary.clicked,1);
  await api(`/admin/messages/${draft.id}/revoke`,{});await messages.pull();assert.equal((await messages.listMessages())[0].revoked,true);
  await restarted.configure({telemetry:{...settings.telemetry,statsEnabled:false}});
  assert.equal((await restarted.status()).collecting,false);assert.equal((await messages.pull()).ok,true);
  await restarted.configure({telemetry:{...settings.telemetry,statsEnabled:false,messagesEnabled:false}});
  const disabled=await api('/admin/installations');const row=(Array.isArray(disabled)?disabled:disabled.items)[0];
  assert.equal(row.telemetry_enabled,false);assert.equal(row.messages_enabled,false);
  await restarted.deleteInstallationData();
  const afterDelete=create();await afterDelete.configure(settings);assert.equal((await afterDelete.status()).registered,false);
  console.log('verified: DAU=1, MAU=1, foreground=30s, version, IP, duplicate retry, restart, message receive/read/click/revoke, disable, deletion');
 }finally{
  messages?.stop();for(const c of clients)c.stop();
  child.kill('SIGTERM');await once(child,'exit').catch(()=>{});
  await fs.rm(dir,{recursive:true,force:true});
 }
});
