import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createTelemetryController,createInstallationClient} from '../electron/telemetry.mts';
const secure={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
const settings={telemetry:{serviceUrl:'https://ops.example',statsEnabled:true,messagesEnabled:true}};
async function temporary(run){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dyw-register-429-'));try{await run(dir)}finally{await fs.rm(dir,{recursive:true,force:true})}}
const ok=data=>new Response(JSON.stringify({code:200,data}));
test('登记 429 的等待时间由上传、在线检查、保存和重启共同遵守；恢复后补传原来的 30 条',async()=>temporary(async dir=>{
 let now=Date.now(), limited=true, registers=0;const sent=[];
 const fetchImpl=async(url,init)=>{
  const body=init.body?JSON.parse(init.body):null;
  if(url.endsWith('/register')){registers++;if(limited)return new Response(JSON.stringify({code:429,message:'请求频繁'}),{status:429,headers:{'Retry-After':'120'}});return ok({installation_id:body.installation_id,device_secret:'test-secret'})}
  if(url.endsWith('/preferences'))return ok({generation:2});
  if(url.endsWith('/batches')){sent.push(...body.events);return ok({results:body.events.map(e=>({event_id:e.event_id,status:'accepted'}))})}
  return ok({});
 };
 const make=()=>createTelemetryController({userDataDir:dir,appVersion:'test',secretStorage:secure,now:()=>now,fetchImpl});
 const first=make();await first.configure(settings);const id=first.getInstallationId();
 await first.store.enqueue(Array.from({length:30},(_,i)=>({event_id:`cached-${i}`,type:'app_activity',occurred_at:new Date(now).toISOString(),app_version:'test'})));
 assert.equal(registers,1);assert.equal((await first.status()).nextRegistrationRetryAt,new Date(now+120000).toISOString());
 for(let i=0;i<12;i++)await Promise.all([first.flushOnce(),first.heartbeatOnce(),first.configure(settings)]);
 assert.equal(registers,1);assert.equal(await first.store.count(),30);
 const second=make();await second.configure(settings);assert.equal(second.getInstallationId(),id);assert.equal(registers,1);assert.equal(await second.store.count(),30);
 limited=false;now+=120001;const uploaded=await second.flushOnce();assert.equal(uploaded.ok,true);assert.equal(uploaded.uploaded,30);
 assert.equal(registers,2);assert.equal(await second.store.count(),0);assert.equal(sent.length,30);
 assert.deepEqual(sent.map(e=>e.event_id),Array.from({length:30},(_,i)=>`cached-${i}`));
 assert.equal((await second.status()).nextRegistrationRetryAt,'');assert.equal((await second.status()).lastError,'');
}));
test('兼容服务器未给出等待时间、HTTP 日期和响应正文的等待秒数',async()=>{
 const now=Date.parse('2026-10-04T02:00:00Z');
 for(const [headers,payload,expected] of [[{}, {},3600000],[{'Retry-After':'Sun, 04 Oct 2026 02:05:00 GMT'},{},300000],[{}, {retry_after_seconds:45},45000]]){
  const client=createInstallationClient({now:()=>now,fetchImpl:async()=>new Response(JSON.stringify({code:429,...payload}),{status:429,headers})});client.configure('https://ops.example');
  await assert.rejects(()=>client.register({installationId:'test',appVersion:'test'}),e=>e.status===429&&e.retryAfterMs===expected);
 }
});
test('普通登记失败也递增等待，不让多个循环连续重试',async()=>temporary(async dir=>{
 let now=Date.now(),requests=0;const c=createTelemetryController({userDataDir:dir,appVersion:'test',now:()=>now,fetchImpl:async()=>{requests++;throw Error('offline')}});
 await c.configure(settings);assert.equal(requests,1);await c.heartbeatOnce();await c.flushOnce();assert.equal(requests,1);
 now+=60001;await c.heartbeatOnce();assert.equal(requests,2);
 const retry=Date.parse((await c.status()).nextRegistrationRetryAt);assert.equal(retry-now,120000);
}));
test('已有登记但缺少凭证的 409 停止重试，保留安装身份及缓存，恢复凭证后补传',async()=>temporary(async dir=>{
 let now=Date.now(),registers=0;const sent=[];
 const fetchImpl=async(url,init)=>{
  if(url.endsWith('/register')){registers++;return new Response(JSON.stringify({code:409,message:'该安装已登记，请使用凭据轮换接口'}),{status:409})}
  if(url.endsWith('/preferences'))return ok({generation:3});
  if(url.endsWith('/batches')){const body=JSON.parse(init.body);sent.push(...body.events);return ok({results:body.events.map(e=>({event_id:e.event_id,status:'accepted'}))})}
  return ok({});
 };
 const make=()=>createTelemetryController({userDataDir:dir,appVersion:'test',secretStorage:secure,now:()=>now,fetchImpl});
 const first=make();await first.configure(settings);const id=first.getInstallationId();
 await first.store.enqueue([{event_id:'preserved-before-conflict',type:'app_activity',occurred_at:new Date(now).toISOString(),app_version:'test'}]);
 now+=86400000;await first.heartbeatOnce();await first.flushOnce();await first.configure(settings);
 const second=make();await second.configure(settings);
 assert.equal(registers,1);assert.equal(second.getInstallationId(),id);assert.equal(await second.store.count(),1);
 assert.equal((await second.status()).nextRegistrationRetryAt,'');assert.match((await second.status()).lastError,/恢复原登记/);
 await fs.writeFile(path.join(dir,'telemetry-credentials.json'),JSON.stringify({encrypted:true,token:Buffer.from(`${id}.restored-secret`).toString('base64')}));
 const restored=make();await restored.configure(settings);const result=await restored.flushOnce();
 assert.equal(result.ok,true);assert.equal(registers,1);assert.equal(restored.getInstallationId(),id);
 assert.equal(await restored.store.count(),0);assert.equal(sent[0].event_id,'preserved-before-conflict');
}));
