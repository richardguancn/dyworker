import test from 'node:test';
import assert from 'node:assert/strict';
import {readPublicModelPrices,PUBLIC_MODEL_PRICES_PATH} from '../electron/host/public-model-prices.mts';
import {installPluginApiBridge} from '../src/pluginRuntime/apiBridge.ts';
import {pluginApiIpcPlugin} from '../electron/host/plugins/plugin-api-ipc.mts';

test('公开价格读取使用固定来源，不带调用者凭据、地址或跳转，保留真实资料',async()=>{
 let request;const body='{"provider":{"models":{"m":{"cost":{"input":1}}}}}';
 const reply=await readPublicModelPrices(new AbortController().signal,async(url,init)=>{request={url,init};return new Response(body);});
 assert.equal(reply.body,body);assert.equal(reply.status,200);assert.equal(request.url,'https://models.dev/api.json');
 assert.equal(request.init.credentials,'omit');assert.equal(request.init.redirect,'error');assert.deepEqual(request.init.headers,{accept:'application/json'});
});

test('公开价格读取拒绝错误状态、损坏资料和超大响应，不伪造成功',async()=>{
 const signal=new AbortController().signal;
 await assert.rejects(readPublicModelPrices(signal,async()=>new Response('no',{status:503})),/503/);
 for(const body of ['broken','[]','null'])await assert.rejects(readPublicModelPrices(signal,async()=>new Response(body)));
 let cancelled=false;const oversized=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(32*1024*1024+1));},cancel(){cancelled=true;}});
 await assert.rejects(readPublicModelPrices(signal,async()=>new Response(oversized)),/超过读取限制/);assert.equal(cancelled,true);
});

test('取消公开价格读取会终止真正的网络请求，已取消调用不发起读取',async()=>{
 const abort=new AbortController();let supplied,entered=Promise.withResolvers();
 const pending=readPublicModelPrices(abort.signal,async(_url,init)=>{supplied=init.signal;entered.resolve();return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));});
 const rejected=assert.rejects(pending,/取消价格读取/);await entered.promise;abort.abort(new Error('取消价格读取'));await rejected;assert.equal(supplied.aborted,true);
 let called=false;await assert.rejects(readPublicModelPrices(abort.signal,async()=>{called=true;return new Response('{}');}),/取消价格读取/);assert.equal(called,false);
});

test('原始插件价格请求经现有读取桥返回，敏感头不转发；其他地址保持原约束',async()=>{
 const calls=[],target={fetch:async input=>{calls.push({direct:input});return new Response('other');}},api={pluginApiFetch:async payload=>{calls.push(payload);return {status:200,body:'{"actual":true}'};}};
 const restore=installPluginApiBridge(target,api);
 try{
  assert.deepEqual(await (await target.fetch(new Request('https://models.dev/api.json',{headers:{authorization:'caller-secret',cookie:'private-cookie'}}))).json(),{actual:true});
  assert.equal(calls[0].path,PUBLIC_MODEL_PRICES_PATH);assert.deepEqual(calls[0].headers,{});assert.equal(calls[0].body,undefined);
  const invalid=await target.fetch('https://models.dev/api.json',{method:'POST',body:'private'});assert.equal(invalid.status,405);assert.equal(calls.length,1);
  await target.fetch('https://models.dev/api.json?other=1');await target.fetch('https://untrusted.test/api.json');
  assert.deepEqual(calls.slice(1),[{direct:'https://models.dev/api.json?other=1'},{direct:'https://untrusted.test/api.json'}]);
 }finally{restore();}
});

test('价格读取入口拒绝写入与夹带正文，不能改变实际网络来源或请求头',async()=>{
 const handlers=new Map(),effects=[],old=globalThis.fetch;let observed;
 globalThis.fetch=async(url,init)=>{observed={url,init};return new Response('{"actual":true}');};
 pluginApiIpcPlugin().apply({effect(fn){effects.push(fn());},ipc:{handle(name,handler){handlers.set(name,handler);return()=>{};}},connection:{dispatch:async()=>({status:404,body:'no'}),list:()=>[]}});
 try{
  const call=handlers.get('plugin-api:fetch'),sender={sender:{id:1}};
  for(const payload of [{method:'POST'},{method:'GET',body:'private'}])assert.equal((await call(sender,{path:PUBLIC_MODEL_PRICES_PATH,...payload})).status,405);
  assert.equal(observed,undefined);
  const result=await call(sender,{path:PUBLIC_MODEL_PRICES_PATH,method:'GET',headers:{authorization:'private'},url:'https://untrusted.test'});
  assert.equal(result.body,'{"actual":true}');assert.equal(observed.url,'https://models.dev/api.json');assert.deepEqual(observed.init.headers,{accept:'application/json'});
  assert.equal((await call(sender,{path:PUBLIC_MODEL_PRICES_PATH+'?url=https://untrusted.test',method:'GET'})).status,404);
 }finally{globalThis.fetch=old;for(const stop of effects)stop?.();}
});
