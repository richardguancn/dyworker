import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import {PluginCatalogService,validatePluginCatalog,PLUGIN_CATALOG_PATH} from '../electron/host/services/plugin-catalog.mts';
import {PLUGIN_CATALOG} from '../src/pluginCatalog.ts';

const target={hostVersion:'0.2.2',platform:'darwin',arch:'arm64'};
const manifest=()=>({schemaVersion:1,revision:'test-published',publishedAt:'2026-10-08T00:00:00Z',plugins:PLUGIN_CATALOG.map(p=>({...structuredClone(p),verified:true,status:'published'}))});
async function service(t,extra={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dyw-approved-directory-'));
 const ctx=new Context();let source='https://platform.example.com';
 ctx.provide('settings',{read:async()=>({telemetry:{serviceUrl:source}})});
 const catalog=new PluginCatalogService(ctx,{dir,...target,...extra});await ctx.fiber.await();
 t.after(async()=>{await ctx.fiber.dispose();await fs.rm(dir,{recursive:true,force:true});});
 return {ctx,catalog,dir,setSource:value=>{source=value;}};
}
test('已验证记录限定具体版本、宿主版本、系统和处理器；草稿和撤回记录被过滤',()=>{
 const data=manifest();data.plugins.push({...data.plugins[0],id:'draft',verified:false},{...data.plugins[0],id:'withdrawn',status:'withdrawn'});
 assert.equal(validatePluginCatalog(data,target).plugins.length,2);
 assert.equal(validatePluginCatalog(data,{...target,platform:'win32'}).plugins.length,0);
 assert.equal(validatePluginCatalog(data,{...target,arch:'x64'}).plugins.length,0);
 assert.equal(validatePluginCatalog(data,{...target,hostVersion:'0.2.3'}).plugins.length,0);
 data.plugins[0].install='dsh-office-tools@latest';assert.throws(()=>validatePluginCatalog(data,target),/版本不明确/);
 data.plugins[0].install='dsh-office-tools@1.0.5';data.plugins.push(data.plugins[0]);assert.throws(()=>validatePluginCatalog(data,target),/记录不完整/);
 const missingVersion=manifest();missingVersion.plugins[0].support.version=null;missingVersion.plugins[0].install='dsh-office-tools@null';
 assert.throws(()=>validatePluginCatalog(missingVersion,target),/版本不明确/);
});
test('未配置平台时使用随包清单，不触发网络读取',async t=>{
 const s=await service(t,{fetch:()=>assert.fail('不应请求网络')});s.setSource('');
 const result=await s.catalog.read();assert.equal(result.source,'bundled');assert.equal(result.plugins.length,2);
});
test('旧平台清单和已保存清单中的 dsh-context 不显示，内置上下文不受影响',async t=>{
 const legacy=manifest();legacy.plugins.push({...structuredClone(legacy.plugins[0]),id:'bowenliang123/dsh-context',packageName:'dsh-context',install:'dsh-context@0.62.2',support:{...legacy.plugins[0].support,version:'0.62.2'}});
 const s=await service(t,{fetch:async()=>Response.json(legacy)});
 const downloaded=await s.catalog.read(true);assert.equal(downloaded.plugins.length,2);assert.ok(downloaded.plugins.every(p=>p.packageName!=='dsh-context'));
 const file=path.join(s.dir,'verified-plugin-catalog.json'),stored=JSON.parse(await fs.readFile(file,'utf8'));
 stored.manifest=legacy;await fs.writeFile(file,JSON.stringify(stored));
 const cached=await s.catalog.read();assert.equal(cached.source,'cache');assert.equal(cached.plugins.length,2);
 const {isVerifiedEntry}=await import('../src/pluginCatalog.ts');
 assert.equal(isVerifiedEntry({id:'dsh-context',name:'dsh-context'},'0.62.2',cached.plugins),false);
 assert.equal(isVerifiedEntry({id:'dyworker-context',name:'dyworker-context',builtin:true},undefined,cached.plugins),true);
});
test('平台读取使用公开固定地址，缓存重启可用，手动刷新支持撤回全部插件',async t=>{
 let calls=0,body=manifest(),now=1000;
 const s=await service(t,{now:()=>now,fetch:async(url,options)=>{
  calls++;assert.equal(url,`https://platform.example.com${PLUGIN_CATALOG_PATH}`);
  assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.deepEqual(options.headers,{accept:'application/json'});
  return Response.json({code:200,data:body});
 }});
 assert.equal((await s.catalog.read()).source,'platform');assert.equal(calls,1);
 const stored=JSON.parse(await fs.readFile(path.join(s.dir,'verified-plugin-catalog.json'),'utf8'));
 assert.ok(stored.manifest.plugins.every(p=>p.verified===true&&p.status==='published'));
 assert.equal((await s.catalog.read()).plugins.length,2);assert.equal(calls,1);
 const cached=await service(t,{dir:s.dir,now:()=>now,fetch:()=>assert.fail('24 小时内使用已保存清单')});
 assert.equal((await cached.catalog.read()).plugins.length,2);
 body={...body,revision:'withdrawn-all',plugins:[]};
 const withdrawn=await s.catalog.read(true);assert.equal(withdrawn.source,'platform');assert.deepEqual(withdrawn.plugins,[]);
 assert.deepEqual((await s.catalog.read()).plugins,[]);assert.equal(calls,2);
 now+=24*60*60*1000;assert.equal((await s.catalog.read()).source,'platform');assert.equal(calls,3);
});
test('断网和损坏的发布文件保留最近清单；首次断网只使用随包已验证清单',async t=>{
 const s=await service(t,{fetch:async()=>Response.json(manifest())});await s.catalog.read();
 for(const fetch of [async()=>{throw new Error('offline');},async()=>Response.json({plugins:[]}),async()=>new Response('x',{headers:{'content-length':String(512*1024+1)}})]){
  s.catalog.config.fetch=fetch;const result=await s.catalog.read(true);
  assert.equal(result.source,'cache');assert.equal(result.plugins.length,2);assert.match(result.notice,/上次保存/);
 }
 const first=await service(t,{fetch:async()=>{throw new Error('offline');}});
 assert.equal((await first.catalog.read()).source,'bundled');
});
test('更换平台或应用版本后不能把旧缓存当成新平台和新版本的清单',async t=>{
 let calls=0;
 const s=await service(t,{fetch:async()=>{calls++;return Response.json(manifest());}});await s.catalog.read();
 s.catalog.config.hostVersion='0.2.3';assert.deepEqual((await s.catalog.read()).plugins,[]);assert.equal(calls,2);
 s.setSource('https://other.example.com');s.catalog.config.fetch=async()=>{throw new Error('offline');};
 const result=await s.catalog.read();assert.equal(result.source,'bundled');assert.deepEqual(result.plugins,[]);
});
test('平台地址在请求期间变化，迟到结果不能发布或写入旧平台缓存',async t=>{
 let release;const received=new Promise(resolve=>{release=resolve;});
 const s=await service(t,{fetch:async()=>{await received;return Response.json(manifest());}});
 const pending=s.catalog.read();await new Promise(resolve=>setImmediate(resolve));s.setSource('https://other.example.com');release();
 await assert.rejects(pending,/平台地址已更换/);
 await assert.rejects(fs.access(path.join(s.dir,'verified-plugin-catalog.json')),{code:'ENOENT'});
});
test('关闭宿主会取消正在读取的清单，完成关闭后不留后台写入',async t=>{
 let started;const ready=new Promise(resolve=>{started=resolve;});
 const s=await service(t,{fetch:async(url,{signal})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})});
 const pending=s.catalog.read();const rejected=assert.rejects(pending,/读取已关闭/);await ready;await s.ctx.fiber.dispose();await rejected;
 await assert.rejects(fs.access(path.join(s.dir,'verified-plugin-catalog.json')),{code:'ENOENT'});
});
test('较早请求的迟到响应不能把已撤回的插件重新写回缓存',async t=>{
 let release,started,calls=0;const ready=new Promise(resolve=>{started=resolve;}),pause=new Promise(resolve=>{release=resolve;});
 const s=await service(t,{fetch:async()=>{
  if(++calls===1){started();await pause;return Response.json(manifest());}
  return Response.json({...manifest(),revision:'withdrawal-new',plugins:[]});
 }});
 const older=s.catalog.read(true);await ready;
 const fresh=await s.catalog.read(true);assert.deepEqual(fresh.plugins,[]);
 release();await older;
 const cached=await s.catalog.read();assert.equal(cached.revision,'withdrawal-new');assert.deepEqual(cached.plugins,[]);
});
