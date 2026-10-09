// 评估用合成样例，不等同于第三方插件整体验收。仅创建和清理自己的临时目录。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHost, disposeHost } from '../../../electron/host/context.mts';
import { clearPluginRoutes, dispatchPluginRoute } from '../../../electron/host/services/connection.mts';
import { ClientModuleLoader } from '../../../src/pluginRuntime/moduleLoader.ts';
import { analyzePlugin } from '../../../electron/host/dsh-compat.mts';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dyw-dsh-probe-'));
const ctx=await createHost({userDataDir:dir,mountPlugins:true});
const report={};
try {
 try {ctx.tools.register({name:'dsh_sample',description:'probe',parameters:{type:'object',properties:{}},output:{schema:{type:'string'},render:(_,v)=>[{type:'text',text:v}]},execute:async()=> 'ok'}); report.dshTool='registered';} catch(e) {report.dshTool=e.message;}
 report.projectionRegister=typeof ctx.sessionProjections.register;
 const name=ctx.tools.toolName('probe','cancel');
 ctx.tools.register({plugin:'probe',name:'cancel',handler:(_,exec)=>({hasSignal:!!exec.signal,hasAgent:!!exec.agent})});
 report.cancelContext=await ctx.tools.execute(name,{}, {source:'agent',signal:new AbortController().signal});
 const pkg=path.join(dir,'plugins/node_modules/probe-plugin'); await fs.mkdir(pkg,{recursive:true});
 const manifest={name:'probe-plugin',version:'1.0.0',type:'module',main:'index.js'};
 await fs.writeFile(path.join(pkg,'package.json'),JSON.stringify(manifest));
 await fs.writeFile(path.join(pkg,'index.js'),`export const inject=['connection']; export function apply(ctx){ctx.effect(()=>ctx.connection.fetch.register({path:'/api/probe-review',fetch:()=>new Response('active')}));}`);
 report.routeInstall=await ctx.plugins.add({id:'probe-route',name:'probe-plugin'});
 report.beforeDisable=(await dispatchPluginRoute({path:'/api/probe-review'})).status;
 await ctx.plugins.setEnabled('probe-route',false);
 report.afterDisable=(await dispatchPluginRoute({path:'/api/probe-review'})).status;
 const missing=path.join(dir,'plugins/node_modules/probe-missing'); await fs.mkdir(missing,{recursive:true});
 await fs.writeFile(path.join(missing,'package.json'),JSON.stringify({...manifest,name:'probe-missing'}));
 await fs.writeFile(path.join(missing,'index.js'),`export const inject=['serviceDefinitelyMissing'];export function apply(){globalThis.__reviewMissingApplied=true}`);
 report.missingAdd=await ctx.plugins.add({id:'missing',name:'probe-missing'});
 report.missingEntry=ctx.plugins.entries().find(x=>x.id==='missing'); report.missingApplied=!!globalThis.__reviewMissingApplied;
 const probePkg=path.join(dir,'plugins/node_modules/probe-declared'); await fs.mkdir(probePkg,{recursive:true});
 await fs.writeFile(path.join(probePkg,'package.json'),JSON.stringify({...manifest,name:'probe-declared'}));
 await fs.writeFile(path.join(probePkg,'index.js'),`globalThis.__reviewImportEffect=(globalThis.__reviewImportEffect||0)+1; export const inject={serviceDefinitelyMissing:null};export function apply(){}`);
 const a=await analyzePlugin(path.join(dir,'plugins/package.json'),'probe-declared',{...manifest,name:'probe-declared'},probePkg);
 report.preflight={verdict:a.verdict,inject:a.hostHalf.inject,topLevelExecuted:globalThis.__reviewImportEffect};
 const loader=new ClientModuleLoader();let runs=0;
 loader.load({id:'lazy',factory:()=>{runs++;return {ok:true}}});
 const chunk=loader.load({id:'chunked',factory:require=>require.async('./client.chunk.js')});
 report.clientLoader={ranAtRegistration:runs,asyncError:chunk.error};
 await disposeHost(ctx);
 report.afterHostDispose=(await dispatchPluginRoute({path:'/api/probe-review'})).status;
 console.log(JSON.stringify(report,null,2));
} finally {clearPluginRoutes();await disposeHost(ctx).catch(()=>{});await fs.rm(dir,{recursive:true,force:true});}
