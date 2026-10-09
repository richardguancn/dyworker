import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHost,disposeHost} from '../electron/host/context.mts';
import {createSessionHistoryClient} from '../src/pluginRuntime/sessionHistory.ts';
import {transactPluginProfile} from '../electron/host/plugin-transaction.mts';
const recovery={backoffBaseMs:10,backoffMaxMs:30,generationReadyWarnMs:3000,generationReadyTimeoutMs:10000};
async function until(check){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw new Error('没有取得实际状态变化');await new Promise(resolve=>setTimeout(resolve,5));}}
async function fixture(t){
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-profile-switch-'))),host=await createHost({userDataDir:dir,mountPlugins:true});
 t.after(async()=>{await disposeHost(host);await fs.rm(dir,{recursive:true,force:true});});
 const id='profile-switch-root';await host.dshRuntime.request('','session-create',{cwd:dir,sessionId:id});
 return {host,dir,id};
}
for(const fail of [false,true])test(`原始读取连接在插件${fail?'启动失败回滚':'安装提交'}期间等待，结束后原页面引用恢复`,{timeout:20000},async t=>{
 const {host,id}=await fixture(t);let switching=false,blocked=false,restored=false;
 const client=createSessionHistoryClient(id,async input=>{
  if(switching&&input.action==='history-control-open')blocked=true;
  try{return {ok:true,value:await host.dshRuntime.request(id,input.action,input.payload)};}catch(error){return {ok:false,error};}
 },()=>true,undefined,undefined,undefined,recovery);
 let ref;t.after(async()=>{ref?.release();await client.dispose();});
 await client.sessions.refresh();ref=client.sessions.retain(id,{source:'install-view'});await ref.ready;
 const binding=ref.binding,generation=client.connection.generation.getSnapshot().id;
 const profile=host.plugins.dir,marker=path.join(profile,'switch-marker.json');await fs.writeFile(marker,'"previous"');
 const result=await transactPluginProfile(profile,async stage=>{await fs.writeFile(path.join(stage,'switch-marker.json'),'"next"');return {ok:true};},
  async()=>{
   assert.equal(host.dshRuntime.sessions.size,0);assert.equal(host.dshRuntime.opening.size,0);
   assert.equal(await fs.readFile(marker,'utf8'),'"next"');
   await assert.rejects(host.dshRuntime.run({}),/正在切换/);
   return fail?{ok:false,error:'真实切换失败样例'}:{ok:true};
  },async()=>{restored=true;assert.equal(await fs.readFile(marker,'utf8'),'"previous"');},()=>!host.dshRuntime.busy,
  async()=>{
   switching=true;const release=await host.dshRuntime.suspendViewsForProfileSwitch();
   try{
    await until(()=>blocked);assert.equal(host.dshRuntime.sessions.size,0);assert.equal(host.dshRuntime.opening.size,0);
    return ()=>{switching=false;release();};
   }catch(error){switching=false;release();throw error;}
  });
 assert.equal(result.ok,!fail);assert.equal(restored,fail);
 assert.equal(await fs.readFile(marker,'utf8'),fail?'"previous"':'"next"');
 await until(()=>client.connection.generation.getSnapshot()?.id>generation);
 await client.open(binding.session);assert.equal(ref.binding,binding);assert.equal(host.dshRuntime.sessions.size,1);
 assert.equal(host.dshRuntime.sessions.get(id).activeInput,undefined,'恢复只建立读取，不取得模型运行资格');
 assert.equal(await host.dshRuntime.request(id,'history-list',{address:{kind:'session',sessionId:id}}).then(value=>value.items[0].running),false);
});

test('切换期间取消读取不会创建工作进程，切换异常释放后可再次读取',{timeout:15000},async t=>{
 const {host,id}=await fixture(t),release=await host.dshRuntime.suspendViewsForProfileSwitch();
 t.after(release);const controller=new AbortController();
 const pending=host.dshRuntime.request(id,'history-list',{address:{kind:'session',sessionId:id}},{signal:controller.signal});
 const rejected=assert.rejects(pending,/取消等待/);controller.abort(new Error('取消等待'));await rejected;
 assert.equal(host.dshRuntime.sessions.size,0);assert.equal(host.dshRuntime.opening.size,0);
 release();const reply=await host.dshRuntime.request(id,'history-list',{address:{kind:'session',sessionId:id}});assert.equal(reply.items[0].sessionId,id);
});

test('真实新授权还在读取任务规则时已算运行中，插件切换不能抢先关闭它',{timeout:15000},async t=>{
 const {host,dir,id}=await fixture(t),entered=Promise.withResolvers(),gate=Promise.withResolvers(),controller=new AbortController();
 t.after(()=>{controller.abort(new Error('检查收尾'));gate.resolve();});
 const pending=host.dshRuntime.run({sessionId:id,workspacePath:dir,signal:controller.signal,settings:{model:'preparing-test'},prompt:'实际启动准备',
  resolvers:{readHooks:async()=>{entered.resolve();await gate.promise;return [];},readStandingRules:async()=>[]}});
 const rejected=assert.rejects(pending,/检查取消/);await entered.promise;
 assert.equal(host.dshRuntime.busy,true);assert.equal(host.dshRuntime.sessions.size,0);
 await assert.rejects(host.dshRuntime.suspendViewsForProfileSwitch(),/任务正在执行/);
 controller.abort(new Error('检查取消'));gate.resolve();await rejected;
 assert.equal(host.dshRuntime.busy,false);assert.equal(host.dshRuntime.sessions.size,0);
 const release=await host.dshRuntime.suspendViewsForProfileSwitch();release();
});

test('应用在切换等待期间退出会结束真实读取，释放后的旧调用也不能重开进程',{timeout:15000},async t=>{
 const {host,id}=await fixture(t),runtime=host.dshRuntime,release=await runtime.suspendViewsForProfileSwitch();
 const pending=runtime.request(id,'history-list',{address:{kind:'session',sessionId:id}});
 const rejected=assert.rejects(pending,/已关闭/);await disposeHost(host);await rejected;release();
 assert.equal(runtime.sessions.size,0);assert.equal(runtime.opening.size,0);
 await assert.rejects(runtime.request(id,'history-list',{address:{kind:'session',sessionId:id}}),/已关闭|运行环境已经更换/);
 assert.equal(runtime.sessions.size,0);
});
