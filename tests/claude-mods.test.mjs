import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHost,disposeHost} from '../electron/host/context.mts';
import {readMod} from '../electron/host/mods/manifest.mts';
import {runAgent} from '../electron/agent.mts';
import {OfficialDshSession} from '../electron/host/dsh-runtime/full-session.mts';
import {MOD_CATALOG,bundledModsRoot} from '../electron/host/mods/catalog.mts';
async function fixture(t){const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-mods-test-')));const host=await createHost({userDataDir:dir});
 t.after(async()=>{await disposeHost(host);await fs.rm(dir,{recursive:true,force:true});});return {dir,host};}
async function local(dir,name,source,extra={}){const root=path.join(dir,name);await fs.mkdir(path.join(root,'.claude-plugin'),{recursive:true});await fs.mkdir(path.join(root,'hooks'));
 await fs.writeFile(path.join(root,'.claude-plugin/plugin.json'),JSON.stringify({name,version:'1.0.0',...extra}));await fs.writeFile(path.join(root,'hooks/hooks.json'),JSON.stringify({modules:['./register.ts']}));await fs.writeFile(path.join(root,'hooks/register.ts'),source);return root;}
const text=value=>JSON.stringify(value);
test('清单固定开源版本，全部通过读取和真实启动检查',async t=>{const {host}=await fixture(t);
 assert.deepEqual(MOD_CATALOG.map(row=>row.id),['token-weather','office-activity','protect-originals']);
 for(const row of MOD_CATALOG){assert.ok(['MIT','Apache-2.0'].includes(row.license));assert.match(row.source,/^https:\/\/github.com\//);assert.equal((await readMod(path.join(bundledModsRoot(),row.id))).manifest.version,row.version);
 assert.equal((await host.mods.install({catalogId:row.id})).ok,true);}
 assert.equal((await host.mods.list()).entries.length,3);
});
test('活动面板记录实际调用，会话隔离，按钮、停用、启用、重载和卸载完整可用',async t=>{const {host,dir}=await fixture(t);await host.mods.install({catalogId:'office-activity'});
 let executed=0;await host.mods.aroundTool('a','read_file',{path:'a.txt'},async()=>{executed++;return {message:{content:'真实结果'}};});
 await host.mods.dispatch('a','turn.complete',{answer:'完成'},async()=>({}));await host.mods.action('a','office-activity',{command:'activity'});
 let snapshot=await host.mods.snapshot('a');assert.match(text(snapshot),/完成 1 轮任务，调用 1 次操作/);assert.equal(executed,1);
 const actionId=snapshot[0].views[0].tree.props.children[1].props.onPress;await host.mods.action('a','office-activity',{event:'ui.press',actionId});assert.match(text(await host.mods.snapshot('a')),/调用 0 次操作/);
 await host.mods.action('b','office-activity',{command:'activity'});assert.match(text(await host.mods.snapshot('b')),/完成 0 轮任务/);
 await host.mods.enable('office-activity',false);assert.deepEqual(await host.mods.snapshot('a'),[]);assert.equal(host.mods.instances.size,0);
 await host.mods.enable('office-activity',true);await host.mods.action('a','office-activity',{command:'activity'});
 await assert.rejects(host.mods.action('a','office-activity',{event:'ui.press',actionId}),/过期/);
 await disposeHost(host);const restored=await createHost({userDataDir:dir});try{assert.equal((await restored.mods.list()).entries[0].disabled,false);await restored.mods.uninstall('office-activity');assert.equal((await restored.mods.list()).entries.length,0);}finally{await disposeHost(restored);}
});
test('自定义操作保留原始参数，参数中的 tool 字段不会被身份字段覆盖',async t=>{const {host}=await fixture(t);await host.mods.install({catalogId:'office-activity'});
 const args={tool:'pdf',path:'资料.pdf',instructions:'读取'};await host.mods.aroundTool('custom','custom_operation',args,async actual=>{assert.deepEqual(actual,args);return {message:{content:'实际结果'}};});
});
test('活动计数不把拦截、失败或取消写成已经完成',async t=>{const {host}=await fixture(t);await host.mods.install({catalogId:'office-activity'});await host.mods.install({catalogId:'protect-originals'});
 await host.mods.aroundTool('a','write_file',{path:'原始资料/a.txt',content:'拦截'},()=>{throw Error('不应执行');});
 await host.mods.aroundTool('a','read_file',{path:'不存在.txt'},async()=>({message:{content:'失败\n不存在'}}));
 await host.mods.dispatch('a','turn.complete',{isAborted:true},async()=>({}));await host.mods.action('a','office-activity',{command:'activity'});assert.match(text(await host.mods.snapshot('a')),/完成 0 轮任务，调用 0 次操作/);
});
test('官方上下文模组执行原始代码，缺失读数不编造，估算和实际读数有区别',async t=>{const {host}=await fixture(t);await host.mods.install({catalogId:'token-weather'});
 assert.equal((await host.mods.snapshot('a'))[0].views.length,0);host.mods.recordUsage('a',{prompt:64000,estimated:true},128000);
 await host.mods.dispatch('a','turn.complete',{},async()=>({}));let view=await host.mods.snapshot('a');assert.match(text(view),/50% of context/);assert.equal(view[0].estimated,true);
 host.mods.recordUsage('a',{prompt:120000,estimated:false},128000);await host.mods.dispatch('a','turn.complete',{},async()=>({}));view=await host.mods.snapshot('a');assert.match(text(view),/94% of context/);assert.equal(view[0].estimated,false);
 assert.equal((await host.mods.snapshot('b'))[0].views.length,0);
});
test('原始资料保护在执行前阻止真实写入，停用可释放，配置保存后恢复生效',async t=>{const {host,dir}=await fixture(t);await host.mods.install({catalogId:'protect-originals'});
 await fs.mkdir(path.join(dir,'原始资料'));const file=path.join(dir,'原始资料','记录.txt');await fs.writeFile(file,'原始');let writes=0;
 const execute=async args=>{writes++;await fs.writeFile(path.resolve(dir,args.path),args.content);return {message:{content:'成功'}};};
 const denied=await host.mods.aroundTool('a','write_file',{path:'原始资料/记录.txt',content:'改写'},execute);assert.match(denied.message.content,/阻止/);assert.equal(writes,0);assert.equal(await fs.readFile(file,'utf8'),'原始');
 await host.mods.enable('protect-originals',false);await host.mods.aroundTool('a','write_file',{path:'原始资料/记录.txt',content:'允许'},execute);assert.equal(writes,1);
 await host.mods.configure('protect-originals',{folder:'归档'});await host.mods.enable('protect-originals',true);const result=await host.mods.aroundTool('b','delete_file',{path:'归档/记录.txt'},()=>{throw Error('不应执行');});assert.match(result.message.content,/阻止/);
});
test('本地 TypeScript、相对导入、链顺序、参数和结果改写，以及出错后不重复执行',async t=>{const {host,dir}=await fixture(t);const root=await local(dir,'rewrite',`import {suffix} from './helper';export function register(on){on('tool.call',async($,e,next)=>{const result=await next({...e,file_path:'final.txt'});return {...result,result:result.result+suffix};});}`);
 await fs.writeFile(path.join(root,'hooks/helper.ts'),`export const suffix:string=' + 模组';`);assert.equal((await host.mods.install({directory:root})).ok,true);
 let count=0;const result=await host.mods.aroundTool('a','read_file',{path:'before.txt'},async args=>{count++;assert.equal(args.path,'final.txt');return {message:{content:'实际内容'}};});assert.equal(result.message.content,'实际内容 + 模组');assert.equal(count,1);
 const bad=await local(dir,'after-error',`export function register(on){on('tool.call',async($,e,next)=>{await next(e);throw new Error('后续错误');});}`);await host.mods.install({directory:bad});
 await host.mods.aroundTool('a','read_file',{path:'before.txt'},async()=>{count++;return {message:{content:'仍是实际结果'}};});assert.equal(count,2);assert.match(text(await host.mods.snapshot('a')),/后续错误/);
});
test('未知能力、外部导入、失效设置和路径越界明确失败，不覆盖已有版本',async t=>{const {host,dir}=await fixture(t);
 for(const [name,source]of [['unknown',`export function register(on){on('tool.check',()=>({decision:'allow'}));}`],['node-import',`import fs from 'node:fs';export function register(){}`]]){
 const root=await local(dir,name,source);if(name==='unknown')assert.equal((await host.mods.install({directory:root})).ok,false);else await assert.rejects(host.mods.install({directory:root}),/导入/);}
 await host.mods.install({catalogId:'protect-originals'});await assert.rejects(host.mods.configure('protect-originals',{folder:123}),/类型/);assert.equal((await host.mods.list()).entries[0].config.folder,'原始资料');
 const root=await local(dir,'escape',`import '../../outside.js';export function register(){}`);await fs.writeFile(path.join(dir,'outside.js'),'export const value=1;');await assert.rejects(host.mods.install({directory:root}),/越出/);
});
test('未实现的界面位置和元素明确拒绝，不登记空面板',async t=>{const {host,dir}=await fixture(t);
 for(const [name,source,reason]of [['unknown-site',`export function register(on){on('ui.render',{component:'AppHeader'},()=>null);}`,'显示位置'],['unknown-element',`export function register(on){on('ui.render',async($)=>{const {Table}=await $.ui.resolve();return Table({});});}`,'界面元素']]){
  const root=await local(dir,name,source);const result=await host.mods.install({directory:root});assert.equal(result.ok,false);assert.match(result.error,new RegExp(reason));}
 assert.equal((await host.mods.list()).entries.length,0);
});
test('耗时代码被终止，其他模组和会话仍可运行',{timeout:18000},async t=>{const {host,dir}=await fixture(t);const root=await local(dir,'busy-loop',`export function register(on){on('tool.call',()=>{while(true){} });}`);await host.mods.install({directory:root});let called=false;
 await assert.rejects(host.mods.aroundTool('busy','read_file',{path:'a'},async()=>{called=true;return {message:{content:'不应执行'}};}),/timed out|超时|停止|退出/);assert.equal(called,false);
 await host.mods.enable('busy-loop',false);await host.mods.install({catalogId:'office-activity'});await host.mods.action('other','office-activity',{command:'activity'});assert.match(text(await host.mods.snapshot('other')),/完成 0 轮任务/);
});
test('取消终止所属进程，其他会话继续；计时器停用后停止',async t=>{const {host,dir}=await fixture(t);const root=await local(dir,'timer',`export function register(on){on('session.start',($,e,next)=>{ $.clock.every(50,()=>$.ui.status('tick'));return next(e);});on('tool.call',async($,e,next)=>{await $.clock.sleep(1000);return next(e);});}`);
 await host.mods.install({directory:root});const controller=new AbortController();const task=host.mods.aroundTool('a','read_file',{path:'a'},()=>{throw Error('取消后不能执行');},controller.signal);setTimeout(()=>controller.abort(),100);await assert.rejects(task,error=>error.name==='AbortError'||/停止|退出/.test(error.message));
 await host.mods.snapshot('b');await new Promise(resolve=>setTimeout(resolve,80));assert.match(text(await host.mods.snapshot('b')),/tick/);await host.mods.enable('timer',false);assert.equal(host.mods.instances.size,0);
});
function reply(message){return new Response(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:10}}),{headers:{'content-type':'application/json'}});}
test('默认助手实际写入流程被模组阻止',async t=>{const {host,dir}=await fixture(t);await host.mods.install({catalogId:'protect-originals'});let calls=0;const bodies=[];
 const result=await runAgent({settings:{provider:'deepseek',model:'deepseek-chat',apiKey:'test',baseUrl:'https://example.invalid'},workspacePath:dir,conversation:[{role:'user',content:'写入'}],approvalMode:'full-access',aroundToolCall:({name,args,execute})=>host.mods.aroundTool('a',name,args,execute),
 fetchImpl:async(_url,init)=>{bodies.push(JSON.parse(init.body));return calls++===0?reply({role:'assistant',content:null,tool_calls:[{id:'write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'原始资料/记录.txt',content:'不能写入'})}}]}):reply({role:'assistant',content:'原件已保留'});}});
 assert.equal(result.status,'done');await assert.rejects(fs.stat(path.join(dir,'原始资料/记录.txt')),/ENOENT/);assert.match(text(bodies),/模组阻止/);
});
test('改写后的参数重新经过内置检查，拒绝后没有文件副作用',async t=>{const {host,dir}=await fixture(t);const root=await local(dir,'change-path',`export function register(on){on('tool.call',($,e,next)=>next({...e,file_path:'改写目标.txt'}));}`);await host.mods.install({directory:root});let calls=0,checks=0;
 const result=await runAgent({settings:{provider:'deepseek',model:'deepseek-chat',apiKey:'test',baseUrl:'https://example.invalid'},workspacePath:dir,conversation:[{role:'user',content:'保存'}],approvalMode:'full-access',
 aroundToolCall:({name,args,execute})=>host.mods.aroundTool('a',name,args,execute),beforeToolExecute:({args})=>{checks++;assert.equal(args.path,'改写目标.txt');return {action:'block',message:'内置规则拒绝改写目标'};},
 fetchImpl:async()=>calls++===0?reply({role:'assistant',content:null,tool_calls:[{id:'write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'原目标.txt',content:'正文'})}}]}):reply({role:'assistant',content:'未保存'})});
 assert.equal(result.status,'done');assert.equal(checks,1);await assert.rejects(fs.stat(path.join(dir,'改写目标.txt')),/ENOENT/);await assert.rejects(fs.stat(path.join(dir,'原目标.txt')),/ENOENT/);
});
test('并发安装和保存不丢失，启动错误不覆盖既有版本，关闭会话停止后台工作',async t=>{const {host,dir}=await fixture(t);
 await Promise.all([host.mods.install({catalogId:'office-activity'}),host.mods.install({catalogId:'protect-originals'})]);assert.equal((await host.mods.list()).entries.length,2);
 const source=`export function register(on){on('session.start',async($,e,next)=>{await Promise.all([$.store.set('a',1),$.store.set('b',2)]);await $.ui.status(String(await $.store.get('a'))+String(await $.store.get('b')));return next(e);});}`;
 const root=await local(dir,'state-test',source);await host.mods.install({directory:root});assert.match(text(await host.mods.snapshot('a')),/12/);
 await fs.writeFile(path.join(root,'hooks/register.ts'),`export function register(on){on('session.start',()=>{throw new Error('故障版本');});}`);await assert.rejects(host.mods.install({directory:root}),/故障版本/);
 await host.mods.end('a');assert.equal(host.mods.instances.size,0);assert.match(text(await host.mods.snapshot('b')),/12/);
 const data=await fs.readdir(path.join(dir,'claude-mods','state'));assert.equal(data.length,1);
});
test('官方 DSH 实际执行前拦截，允许的调用继续执行，并返回活动记录',{timeout:25000},async t=>{const {host,dir}=await fixture(t);await host.mods.install({catalogId:'protect-originals'});await host.mods.install({catalogId:'office-activity'});
 const profile=path.join(dir,'profile');await fs.mkdir(path.join(profile,'node_modules'),{recursive:true});let calls=0,approved=0;
 let writes=0;
 const runtime=new OfficialDshSession({profileDir:profile,dataDir:path.join(dir,'owned'),workspacePath:dir,sessionId:'dsh-check',plugins:[],mods:host.mods,approve:async()=>{approved++;return true;},
 extraTools:[{name:'write_file',description:'保存资料',parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content']}}],
 onExtraTool:async(_name,args)=>{writes++;await fs.writeFile(path.join(dir,args.path),args.content);return {ok:true,result:'实际保存'};},
 async *generate(){if(calls++<2){const args=JSON.stringify(calls===1?{path:'原始资料/记录.txt',content:'不能写入'}:{path:'副本.txt',content:'实际保存'});yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id:'write-'+calls,name:'write_file',argumentsDelta:args};yield {type:'block-end',index:0,block:{type:'tool-call',id:'write-'+calls,name:'write_file',arguments:args}};yield {type:'finish',reason:{kind:'tool-calls'}};
 }else{yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,delta:'原件已保留'};yield {type:'block-end',index:0,block:{type:'text',text:'原件已保留'}};yield {type:'finish',reason:{kind:'stop'}};}}});
 try{await runtime.start();await runtime.request('prompt',{text:'保护资料'});await assert.rejects(fs.stat(path.join(dir,'原始资料/记录.txt')),/ENOENT/);assert.equal(approved,1);assert.equal(writes,1);assert.equal(await fs.readFile(path.join(dir,'副本.txt'),'utf8'),'实际保存');
  await host.mods.action('dsh-check','office-activity',{command:'activity'});assert.match(text(await host.mods.snapshot('dsh-check')),/调用 1 次操作/);
 }finally{await runtime.close();}
});
