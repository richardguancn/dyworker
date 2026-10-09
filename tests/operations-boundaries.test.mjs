import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createTelemetryController,createInstallationClient} from '../electron/telemetry.mts';
import {createRemoteMessagesManager} from '../electron/remote-messages.mts';
const response=(data,status=200)=>new Response(JSON.stringify({code:status,data}),{status,headers:{'Content-Type':'application/json'}});
const secure={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
const settings=(overrides={})=>({telemetry:{serviceUrl:'https://first.example',statsEnabled:true,messagesEnabled:true,...overrides}});
async function temporary(run){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dyw-boundary-'));try{await run(dir)}finally{await fs.rm(dir,{recursive:true,force:true})}}
function server(){let generation=1;const requests=[];return {requests,fetch:async(url,init)=>{
 const body=init.body?JSON.parse(init.body):null;requests.push({url,body,auth:init.headers.Authorization});
 if(url.endsWith('/register'))return response({installation_id:body.installation_id,device_secret:'test-only-secret'});
 if(url.endsWith('/preferences'))return response({generation:++generation});
 if(url.endsWith('/batches'))return response({results:body.events.map(e=>({event_id:e.event_id,status:'accepted'}))});
 return response({});
}}}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise}};

test('首次离线登记失败，恢复后统计与仅消息模式都能重试；仅消息身份跨重启稳定',async()=>temporary(async dir=>{
 for(const statsEnabled of [true,false]){
  const api=server();let offline=true, now=Date.now();const userDataDir=path.join(dir,String(statsEnabled));
  const c=createTelemetryController({userDataDir,appVersion:'test',secretStorage:secure,now:()=>now,fetchImpl:(...args)=>{if(offline)throw Error('offline');return api.fetch(...args)}});
  await c.configure(settings({statsEnabled}));assert.equal((await c.status()).registered,false);
  offline=false;now+=60001;await c.heartbeatOnce();assert.equal((await c.status()).registered,true);
  const next=createTelemetryController({userDataDir,appVersion:'test',secretStorage:secure,fetchImpl:api.fetch});
  await next.configure(settings({statsEnabled}));assert.equal(next.getInstallationId(),c.getInstallationId());
  assert.equal(api.requests.filter(r=>r.url.endsWith('/register')).length,1);c.stop();next.stop();
 }
}));

test('关闭统计在慢网络返回前停止采集和清队列，两个开关都关闭仍同步服务端',async()=>temporary(async dir=>{
 const api=server();const gate=deferred();let hold=false;
 const c=createTelemetryController({userDataDir:dir,appVersion:'test',secretStorage:secure,fetchImpl:async(...args)=>{if(hold)await gate.promise;return api.fetch(...args)}});
 await c.configure(settings());c.noteUserActivity();await c.store.count();hold=true;
 const saving=c.configure(settings({statsEnabled:false,messagesEnabled:false}));
 await new Promise(r=>setImmediate(r));assert.equal((await c.status()).collecting,false);assert.equal(await c.store.count(),0);
 c.noteUserActivity();assert.equal(await c.store.count(),0);gate.resolve();await saving;
 const last=api.requests.filter(r=>r.url.endsWith('/preferences')).at(-1).body;
 assert.equal(last.telemetry_enabled,false);assert.equal(last.messages_enabled,false);
}));

test('切换运营服务使用新身份，旧凭据和旧统计不会发往新服务',async()=>temporary(async dir=>{
 const api=server();const c=createTelemetryController({userDataDir:dir,appVersion:'test',secretStorage:secure,fetchImpl:api.fetch});
 await c.configure(settings());const id=c.getInstallationId();c.noteUserActivity();await c.store.count();
 await c.configure(settings({serviceUrl:'https://second.example'}));assert.notEqual(c.getInstallationId(),id);assert.equal(await c.store.count(),0);
 for(const r of api.requests.filter(r=>r.url.startsWith('https://second.example')))assert.ok(!String(r.auth).includes(id));
}));

test('上传缺少逐条确认或业务失败时，必须保留队列',async()=>temporary(async dir=>{
 for(const data of [{code:200,data:{}},{code:500,message:'failure',data:{}}]){
  const api=server();const c=createTelemetryController({userDataDir:path.join(dir,String(data.code)),appVersion:'test',secretStorage:secure,
   fetchImpl:(url,init)=>url.endsWith('/batches')?Promise.resolve(new Response(JSON.stringify(data))):api.fetch(url,init)});
  await c.configure(settings());c.noteUserActivity();const before=await c.store.count();assert.ok(before);
  assert.equal((await c.flushOnce()).ok,false);assert.equal(await c.store.count(),before);
 }
}));

test('消息分页一次补齐，大整数消息编号无损，链接和北京时间正确读取',async()=>temporary(async dir=>{
 let pages=0;const client=createInstallationClient();client.configure('https://first.example');client.setToken('installation.secret');
 const m=createRemoteMessagesManager({file:path.join(dir,'messages.json'),client,fetchImpl:async(url,init)=>{
  assert.equal(init.headers.Authorization,'Device installation.secret');
  if(url.endsWith('/receipts'))return response({results:JSON.parse(init.body).receipts.map(r=>({message_id:r.message_id,status:'ok'}))});
  pages++;return new Response(`{"code":200,"data":{"items":[{"message_id":900719925474099${pages},"category":"update","content":"page ${pages}","action_url":"https://example.com","published_at":"2026-10-03 12:00:00"}],"cursor":"page-${pages}","has_more":${pages<3}}}`);
 }});
 await m.configure({messagesEnabled:true,notifyNewMessages:false});assert.equal((await m.pull()).received,3);
 const list=await m.listMessages();assert.equal(list.length,3);assert.equal(list[0].message_id,'9007199254740991');
 assert.ok(list.some(x=>x.message_id==='9007199254740993'));assert.equal(list[0].link,'https://example.com');assert.equal(list[0].published_at,'2026-10-03T12:00:00+08:00');
 assert.equal((await m.status()).pendingReceipts,0);
}));

test('关闭订阅时，迟到响应不能保存消息或弹通知',async()=>temporary(async dir=>{
 const gate=deferred();const entered=deferred();const client=createInstallationClient();client.configure('https://first.example');client.setToken('installation.secret');
 let notified=0;const m=createRemoteMessagesManager({file:path.join(dir,'messages.json'),client,showNotification:()=>notified++,fetchImpl:async()=>{entered.resolve();await gate.promise;return response({items:[{message_id:'1',title:'late'}],cursor:'next'})}});
 await m.configure({messagesEnabled:true});const pulling=m.pull();await entered.promise;await m.configure({messagesEnabled:false});gate.resolve();await pulling;
 assert.equal((await m.listMessages()).length,0);assert.equal(notified,0);
}));

test('启动时订阅关闭，后续开启持续轮询；服务端不支持实时连接时不反复重连',async()=>temporary(async dir=>{
 let pulls=0,streams=0;const client=createInstallationClient();client.configure('https://first.example');client.setToken('installation.secret');
 const m=createRemoteMessagesManager({file:path.join(dir,'messages.json'),client,pollIntervalMs:20,fetchImpl:async url=>{
  if(url.endsWith('/stream')){streams++;return response({realtime_mode:'polling'},501)}
  pulls++;return response({items:[],cursor:`${pulls}`,has_more:false});
 }});
 try{await m.configure({messagesEnabled:false});m.start();await m.configure({messagesEnabled:true});
  const deadline=Date.now()+2000;while(pulls<3&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
  assert.ok(pulls>=3);assert.equal(streams,1);
 }finally{await m.stop()}
}));

test('缺失回执确认不能清队列，发送中新增已读必须保留到下一次确认',async()=>temporary(async dir=>{
 const client=createInstallationClient();client.configure('https://first.example');client.setToken('installation.secret');
 let fail=true,hold=false;const gate=deferred(),entered=deferred();let now=Date.now();
 const sent=[];const m=createRemoteMessagesManager({file:path.join(dir,'messages.json'),client,now:()=>now,fetchImpl:async(url,init)=>{
  if(!url.endsWith('/receipts'))return response({items:[{message_id:'1',title:'message'}],cursor:'1'});
  const receipts=JSON.parse(init.body).receipts;sent.push(receipts);
  if(fail)return response({});
  if(hold){entered.resolve();await gate.promise}
  return response({results:receipts.map(r=>({message_id:r.message_id,status:'ok'}))});
 }});
 await m.configure({messagesEnabled:true,notifyNewMessages:false});await m.pull();assert.equal((await m.status()).pendingReceipts,1);
 fail=false;hold=true;now+=61000;const flushing=m.flushReceipts();await entered.promise;await m.markRead('1');gate.resolve();await flushing;
 assert.equal((await m.status()).pendingReceipts,1);hold=false;await m.flushReceipts();assert.equal((await m.status()).pendingReceipts,0);assert.equal(sent.at(-1)[0].read,true);
}));


test('同一服务地址的尾斜杠、主机大小写变化不重复登记',async()=>temporary(async dir=>{
 const api=server();const c=createTelemetryController({userDataDir:dir,appVersion:'test',secretStorage:secure,fetchImpl:api.fetch});
 await c.configure(settings());const id=c.getInstallationId();
 await c.configure(settings({serviceUrl:'https://FIRST.example/'}));assert.equal(c.getInstallationId(),id);
 assert.equal(api.requests.filter(r=>r.url.endsWith('/register')).length,1);
}));


test('旧版未绑定服务的身份保留，重启不重复创建设备',async()=>temporary(async dir=>{
 const legacy='f493f809-c0d7-4332-8e86-6e188a339f35';
 await fs.writeFile(path.join(dir,'telemetry-state.json'),JSON.stringify({installation_id:legacy,consent_generation:1}));
 const api=server();const make=()=>createTelemetryController({userDataDir:dir,appVersion:'test',secretStorage:secure,fetchImpl:api.fetch});
 const first=make();await first.configure(settings());assert.equal(first.getInstallationId(),legacy);
 const second=make();await second.configure(settings());assert.equal(second.getInstallationId(),first.getInstallationId());
 assert.equal(api.requests.filter(r=>r.url.endsWith('/register')).length,1);
}));
