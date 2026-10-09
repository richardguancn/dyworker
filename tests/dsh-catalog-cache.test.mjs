import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {createHost,disposeHost} from '../electron/host/context.mts';
import {createOfficialDshContext} from '../electron/host/dsh-runtime/official-context.mts';
import {mountDshProfile} from '../electron/host/dsh-runtime/profile.mts';
import {ApiSessionList} from '../electron/host/dsh-runtime/vendor/session-history.mjs';
import {readPluginCatalogCache} from '../electron/host/dsh-runtime/catalog-cache.mts';
import {listDshSessions} from '../electron/host/dsh-runtime/global-catalog.mts';
import {OfficialDshSession} from '../electron/host/dsh-runtime/full-session.mts';
const require=createRequire(import.meta.url);
const generic=`import {z} from 'zod';
export const inject=['sessionProjections'];
export function apply(ctx,config){ctx.sessionProjections.register({key:'catalog-test',stateSchema:z.number(),stateVersion:1,
 init:()=>0,apply:(value,event)=>event.type==='user/message'?value+1:value,
 wire:{viewSchema:z.number(),view:value=>value+(config.offset||0)}});}`;

async function fixture(t){
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-cache-test-')));
 const host=await createHost({userDataDir:dir,mountPlugins:true});
 t.after(async()=>{await disposeHost(host);await fs.rm(dir,{recursive:true,force:true});});
 await fs.mkdir(path.join(host.plugins.dir,'node_modules'),{recursive:true});
 await fs.symlink(path.dirname(require.resolve('zod/package.json')),path.join(host.plugins.dir,'node_modules','zod'),'dir');
 const workspace=path.join(dir,'workspace');await fs.mkdir(workspace);
 const sourceDir=path.join(host.dshRuntime.config.dir,createHash('sha256').update('cache-root').digest('hex'));
 const input={profileDir:host.plugins.dir,sourceDir,workspacePath:workspace,headers:[],signal:new AbortController().signal};
 const plugin=async(source=generic,config={offset:10})=>{
  const packageDir=path.join(host.plugins.dir,'node_modules','dsh-cache-test');await fs.mkdir(packageDir,{recursive:true});
  await fs.writeFile(path.join(packageDir,'package.json'),JSON.stringify({name:'dsh-cache-test',type:'module',main:'index.mjs',dsh:{}}));
  const entry=path.join(packageDir,'index.mjs');await fs.writeFile(entry,source);
  input.plugins=[{id:'cache-test',entryUrl:pathToFileURL(entry).href,config}];
  return {entry,packageDir};
 };
 const store=async()=>{
  const ctx=await createOfficialDshContext({dataDir:sourceDir,workspacePath:workspace});
  try{
   new ApiSessionList(ctx,16);await mountDshProfile(ctx,{...input,dataDir:sourceDir});
   const session=ctx.sessions.create('cache-root',{meta:{cwd:workspace}});
   ctx.sessionTitle.rename(session,'原始缓存标题');
   session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'真实目录记录'}]}),{surfaceOp:'append'});
   const handle=await ctx.sessionPersistence.create(session.header);
   try{await handle.append(session.snapshotEvents());await handle.flush();}finally{await handle.close();}
   await ctx.sessionProjectionCache.write(session);
   input.headers=[session.header];
   const expected=ctx.sessionProjectionCache.cachedSnapshot(session.header);
   await host.sessions.upsert({id:'cache-root',runtime:'dsh',workspacePath:workspace,createdAt:new Date(session.header.createdAt).toISOString(),messages:[]});
   return expected;
  }finally{await ctx.fiber.dispose();}
 };
 const list=()=>listDshSessions({dir:host.dshRuntime.config.dir,roots:()=>host.sessions.loadAll(),active:()=>undefined,
  signal:input.signal,pluginCache:{profileDir:input.profileDir,plugins:input.plugins}});
 return {host,dir,workspace,input,plugin,store,list};
}
async function bytes(dir){
 const files={};
 async function visit(at){for(const entry of await fs.readdir(at,{withFileTypes:true})){const file=path.join(at,entry.name);if(entry.isDirectory())await visit(file);else if(entry.isFile())files[path.relative(dir,file)]=createHash('sha256').update(await fs.readFile(file)).digest('hex');}}
 await visit(dir);return files;
}

test('冷目录装载真实通用插件定义和当前设置，返回原始缓存，原存档字节不变且无 Agent',{timeout:20000},async t=>{
 const {host,input,plugin,store,list}=await fixture(t);await plugin();const expected=await store(),before=await bytes(input.sourceDir);
 const result=await list();assert.deepEqual(result.items[0].projections.values,expected.values);
 assert.equal(result.items[0].projections.values['catalog-test'],11);
 assert.equal(result.items[0].running,false);assert.equal(result.items[0].agentAvailable,false);
 assert.equal(host.dshRuntime.sessions.size,0);assert.equal(host.dshRuntime.opening.size,0);
 input.plugins[0].config={offset:20};
 assert.equal((await list()).items[0].projections.values['catalog-test'],21,'读取使用当前插件的 view 规则');
 assert.deepEqual(await bytes(input.sourceDir),before);
 const reader=await readPluginCatalogCache(input);assert.throws(()=>process.kill(reader.workerPid,0),{code:'ESRCH'},'返回前已经等待实际读取进程退出');
});

test('真实发布的 dsh-context 冷统计与其原始服务一致，目录刷新不会恢复任务',{timeout:20000},async t=>{
 const {host,input,store}=await fixture(t);
 const source=path.dirname(require.resolve('dsh-context/package.json')),target=path.join(host.plugins.dir,'node_modules','dsh-context');
 await fs.symlink(source,target,'dir');
 assert.equal((await host.plugins.add({id:'context',name:'dsh-context'})).ok,true);
 input.plugins=await host.plugins.dshSessionPlugins();const expected=await store();
 assert.ok(expected.values.contextTimeline);assert.ok(expected.values.contextActivity);
 const before=await bytes(input.sourceDir),actual=await host.dshRuntime.request('','global-list');
 assert.deepEqual(actual.items[0].projections.values.contextTimeline,expected.values.contextTimeline);
 assert.deepEqual(actual.items[0].projections.values.contextActivity,expected.values.contextActivity);
 assert.equal(host.dshRuntime.sessions.size,0);assert.equal(host.dshRuntime.opening.size,0);
 assert.deepEqual(await bytes(input.sourceDir),before);
 await host.plugins.setEnabled('context',false);
 const disabled=await host.dshRuntime.request('','global-list');assert.equal(disabled.items[0].projections.values.contextTimeline,undefined);
});

test('原始校验排除版本和状态不匹配的缓存，也排除同名任务的旧生命周期',{timeout:20000},async t=>{
 const {input,plugin,store}=await fixture(t),{entry}=await plugin();await store();
 await fs.writeFile(entry,generic.replace('stateVersion:1','stateVersion:2'));
 const version=await readPluginCatalogCache(input);assert.equal(version.cachedSnapshot(input.headers[0]).values['catalog-test'],undefined);
 await fs.writeFile(entry,generic.replace('stateSchema:z.number()','stateSchema:z.string()'));
 const schema=await readPluginCatalogCache(input);assert.equal(schema.cachedSnapshot(input.headers[0]).values['catalog-test'],undefined);
 const lifecycle=await readPluginCatalogCache({...input,headers:[{...input.headers[0],createdAt:input.headers[0].createdAt+1}]});
 assert.equal(lifecycle.cachedSnapshot(input.headers[0]),undefined);
});

test('真实会话设置覆盖保留，校验过程不会写回原设置',{timeout:20000},async t=>{
 const {input,plugin,store}=await fixture(t);await plugin();await store();
 const patch=path.join(input.sourceDir,'profile','cordis.patch.yml');
 await fs.writeFile(patch,JSON.stringify([{id:'cache-test',name:input.plugins[0].entryUrl,config:{offset:37}}]));
 const before=await bytes(input.sourceDir),cache=await readPluginCatalogCache(input);
 assert.equal(cache.cachedSnapshot(input.headers[0]).values['catalog-test'],38);
 assert.deepEqual(await bytes(input.sourceDir),before);
});

test('目录进程拒绝工作目录写入和自动创建任务，失败也清理临时副本',{timeout:20000},async t=>{
 const {workspace,input,plugin}=await fixture(t);
 const before=(await fs.readdir(os.tmpdir())).filter(name=>name.startsWith('dyw-catalog-cache-')).sort();
 await plugin(`import fs from 'node:fs';export function apply(){fs.writeFileSync(${JSON.stringify(path.join(workspace,'forbidden.txt'))},'bad');}`);
 await assert.rejects(readPluginCatalogCache(input),/未在官方配置树中启动|Access|permission|Permission/);
 await assert.rejects(fs.access(path.join(workspace,'forbidden.txt')));
 await plugin(`export const inject=['agents'];export async function apply(ctx){await ctx.agents.create({sessionId:'forbidden'});}`);
 await assert.rejects(readPluginCatalogCache(input),/未在官方配置树中启动|不能执行任务/);
 const after=(await fs.readdir(os.tmpdir())).filter(name=>name.startsWith('dyw-catalog-cache-')).sort();assert.deepEqual(after,before);
});

test('取消不合作的真实插件加载会等待进程终止并删除副本',{timeout:10000},async t=>{
 const {input,plugin}=await fixture(t);await plugin('export function apply(){while(true){}}');
 const before=(await fs.readdir(os.tmpdir())).filter(name=>name.startsWith('dyw-catalog-cache-')).sort();
 const abort=new AbortController(),pending=readPluginCatalogCache({...input,signal:abort.signal});
 const rejected=assert.rejects(pending,/取消真实缓存进程/);
 await new Promise(resolve=>setTimeout(resolve,500));abort.abort(new Error('取消真实缓存进程'));await rejected;
 assert.deepEqual((await fs.readdir(os.tmpdir())).filter(name=>name.startsWith('dyw-catalog-cache-')).sort(),before);
});

test('真实父子任务均使用已保存的插件统计，冷读取没有新增模型请求',{timeout:20000},async t=>{
 const {host,input,plugin,list}=await fixture(t);await plugin();
 await host.dshRuntime.request('','session-create',{cwd:input.workspacePath,sessionId:'cache-root'});let calls=0;
 const runtime=new OfficialDshSession({...input,dataDir:input.sourceDir,sessionId:'cache-root',approve:async()=>true,
  async *generate(request){calls++;const block=calls===1?{type:'tool-call',id:'child',name:'subagent',arguments:JSON.stringify({description:'实际缓存子任务',prompt:'子任务',run_in_background:false})}
   :{type:'text',text:request.sessionId==='cache-root'?'父任务':'子任务'};
   yield {type:'block-start',index:0,blockType:block.type};yield {type:'block-end',index:0,block};
   yield {type:'finish',reason:{kind:block.type==='tool-call'?'tool-calls':'stop'}};
  }});
 let expected;
 try{await runtime.start();await runtime.request('prompt',{text:'建立真实缓存子任务'});expected=(await runtime.request('history-list',{address:{kind:'session',sessionId:'cache-root'}})).items;}
 finally{await runtime.close();}
 const before=await bytes(input.sourceDir),baseline=calls,result=await list();
 assert.equal(result.items.length,2);const child=result.items.find(row=>row.parentSessionId==='cache-root');assert.ok(child);
 for(const row of result.items)assert.equal(row.projections.values['catalog-test'],expected.find(item=>item.sessionId===row.sessionId).projections.values['catalog-test']);
 assert.equal(result.rootIdBySession[child.sessionId],'cache-root');assert.equal(result.addresses[child.sessionId].mode,'one-shot');
 assert.equal(calls,baseline);assert.deepEqual(await bytes(input.sourceDir),before);
});

for(const disable of [true,false])test(`读取完成前${disable?'真实停用插件':'原依赖目录切换后回滚'}会拒绝旧结果`,{timeout:20000},async t=>{
 const {host,input,plugin,store}=await fixture(t);await plugin();await store();
 assert.equal((await host.plugins.add({id:'cache-test',name:'dsh-cache-test',config:{offset:10}})).ok,true);
 const plugins=host.plugins,original=plugins.dshSessionPlugins.bind(plugins),gate=Promise.withResolvers(),entered=Promise.withResolvers();let calls=0;
 plugins.dshSessionPlugins=async()=>{if(++calls===2){entered.resolve();await gate.promise;}return original();};
 t.after(()=>{gate.resolve();plugins.dshSessionPlugins=original;});
 const pending=host.dshRuntime.request('','global-list'),rejected=assert.rejects(pending,/插件已变化/);
 await entered.promise;
 if(disable)await host.plugins.setEnabled('cache-test',false);
 else{const release=await host.dshRuntime.suspendViewsForProfileSwitch();release();}
 gate.resolve();await rejected;
 host.plugins.dshSessionPlugins=original;
 assert.equal((await host.dshRuntime.request('','global-list')).items[0].projections.values['catalog-test'],disable?undefined:11);
 assert.equal(host.dshRuntime.sessions.size,0);assert.equal(input.headers.length,1);
});
