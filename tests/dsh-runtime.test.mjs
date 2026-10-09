import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createHost, disposeHost } from '../electron/host/context.mts';
import { PluginRouteRegistry } from '../electron/host/services/connection.mts';
import { transactPluginProfile } from '../electron/host/plugin-transaction.mts';
import { ClientModuleLoader } from '../src/pluginRuntime/moduleLoader.ts';
const require = createRequire(import.meta.url);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-dsh-accept-'));
  const ctx = await createHost({ userDataDir: dir, mountPlugins: true });
  t.after(async () => { await disposeHost(ctx); await fs.rm(dir, { recursive: true, force: true }); });
  const workspace = path.join(dir, 'work'); await fs.mkdir(workspace);
  const execution = { sessionId: 'one', runId: 'task-one', workspacePath: workspace, source: 'agent' };
  return { dir, ctx, workspace, execution };
}
async function copyPlugin(ctx, name, id, config) {
  const source = path.dirname(require.resolve(`${name}/package.json`));
  const target = path.join(ctx.plugins.dir, 'node_modules', name);
  await fs.cp(source, target, { recursive: true });
  const peers = await ctx.plugins.ensureRuntimePeers(name);
  assert.deepEqual(peers.failed, []);
  const added = await ctx.plugins.add({ id, name, config });
  assert.equal(added.ok, true, added.error);
  return target;
}
async function synthetic(ctx, name, source) {
  const dir = path.join(ctx.plugins.dir, 'node_modules', name); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.mjs', type: 'module', dsh: {} }));
  await fs.writeFile(path.join(dir, 'index.mjs'), source);
  await ctx.plugins.ensureRuntimePeers(name);
  const added = await ctx.plugins.add({ name, id: name }); assert.equal(added.ok, true, added.error);
  return dir;
}
async function call(ctx, name, args, execution) {
  const result = await ctx.tools.execute(name, args, execution);
  assert.equal(result.ok, true, result.error);
  return result.result.value;
}

test('真实办公发布包：Word、Excel 创建读取修改，PowerPoint 创建读取，越界及错误参数拒绝', async t => {
  const { ctx, workspace, execution } = await fixture(t);
  await copyPlugin(ctx, 'dsh-office-tools', 'office');
  await call(ctx, 'plugin__office__word_create', { path: 'doc.docx', title: '验收', paragraphs: ['第一段'] }, execution);
  await call(ctx, 'plugin__office__word_update', { path: 'doc.docx', paragraphs: ['第二段'] }, execution);
  const doc = await call(ctx, 'plugin__office__word_read', { path: 'doc.docx' }, execution);
  assert.match(doc.text, /第一段/); assert.match(doc.text, /第二段/);
  assert.equal((await fs.readFile(path.join(workspace, 'doc.docx'))).subarray(0, 2).toString(), 'PK');
  await call(ctx, 'plugin__office__excel_create', { path: 'book.xlsx', sheets: [{ name: '数据', rows: [['项目','数量'],['检查',1]] }] }, execution);
  await call(ctx, 'plugin__office__excel_update', { path: 'book.xlsx', cell_updates: [{ sheet: '数据', cell: 'B2', value: 9 }] }, execution);
  const book = await call(ctx, 'plugin__office__excel_read', { path: 'book.xlsx' }, execution);
  assert.match(JSON.stringify(book.sheets), /9/);
  await call(ctx, 'plugin__office__ppt_create', { path: 'slides.pptx', title: '验收', slides: [{ title: '一页', paragraphs: ['实际内容'] }] }, execution);
  const slides = await call(ctx, 'plugin__office__ppt_read', { path: 'slides.pptx' }, execution);
  assert.match(JSON.stringify(slides), /实际内容/);
  const outside = await ctx.tools.execute('plugin__office__word_create', { path: '../outside.docx', paragraphs: ['禁止'] }, execution);
  assert.equal(outside.ok, false); await assert.rejects(fs.access(path.join(workspace, '..', 'outside.docx')));
  const invalid = await ctx.tools.execute('plugin__office__word_create', { path: 123 }, execution);
  assert.equal(invalid.ok, false);
  const blocked = await ctx.tools.execute('plugin__office__word_create', { path: 'blocked.docx' }, { ...execution, source: 'internal' });
  assert.equal(blocked.blocked, true); await assert.rejects(fs.access(path.join(workspace, 'blocked.docx')));
});

test('真实官方待办：两个会话隔离，事件重放，停用待办不影响办公插件', async t => {
  const { ctx, dir, execution } = await fixture(t);
  await copyPlugin(ctx, '@deepseek-ai/dsh-tool-todo', 'todo', { allowParallelInProgress: false });
  await copyPlugin(ctx, 'dsh-office-tools', 'office');
  await Promise.all([
    call(ctx, 'plugin__todo__todo_write', { todos: [{ content: '甲的任务', status: 'in_progress' }] }, execution),
    call(ctx, 'plugin__todo__todo_write', { todos: [{ content: '乙的任务', status: 'pending' }] }, { ...execution, sessionId: 'two', runId: 'task-two' }),
  ]);
  await ctx.plugins.stopRun('one', 'task-one');
  await call(ctx, 'plugin__office__word_create', { path: 'after-todo.docx', paragraphs:['记录保留'] }, execution);
  const sessionFile = id => path.join(dir, 'plugins', 'data', 'dsh-sessions', createHash('sha256').update(id).digest('hex') + '.json');
  const readTodos = async id => JSON.parse(await fs.readFile(sessionFile(id), 'utf8')).events.filter(e => e.type === 'todo/write').at(-1).data.todos;
  assert.equal((await readTodos('one'))[0].content, '甲的任务');
  assert.equal((await readTodos('two'))[0].content, '乙的任务');
  await call(ctx, 'plugin__todo__todo_write', { todos: [{ content: '甲已完成', status: 'completed' }] }, { ...execution, runId: 'another-run' });
  assert.equal((await readTodos('one'))[0].content, '甲已完成');
  await ctx.plugins.setEnabled('todo', false);
  assert.equal(ctx.tools.owns('plugin__todo__todo_write'), false);
  assert.equal(ctx.plugins.entries().find(e => e.id === 'todo').state, 'disabled');
  assert.equal(ctx.tools.owns('plugin__office__word_read'), true);
  await ctx.plugins.setEnabled('todo', true);
  assert.equal(ctx.tools.owns('plugin__todo__todo_write'), true);
});

test('不合作工具：取消和超时真正结束写入，不影响另一会话', async t => {
  const { ctx, execution, workspace } = await fixture(t);
  await synthetic(ctx, 'dsh-stubborn', `import fs from 'node:fs'; import {defineTool} from '@deepseek-ai/dsh-tools'; export const inject=['tools']; export function apply(ctx) {
    ctx.tools.register(defineTool({name:'spin',description:'验收停止',parameters:{},output:{schema:{type:'object',properties:{},additionalProperties:false},render:()=>[]},execute(_args,exec) {
      const file=exec.agent.session.header.cwd+'/spinning.txt'; fs.writeFileSync(file,'started'); while(true) fs.appendFileSync(file,'.');
    }}));
  }`);
  await copyPlugin(ctx, 'dsh-office-tools', 'office');
  const abort = new AbortController();
  const spinning = ctx.tools.execute('plugin__dsh_stubborn__spin', {}, { ...execution, signal: abort.signal });
  for (let tries=0; tries<150; tries++) { try { await fs.access(path.join(workspace,'spinning.txt')); break; } catch { await delay(20); } }
  await fs.access(path.join(workspace,'spinning.txt'));
  const other = call(ctx, 'plugin__office__word_create', { path:'other.docx', paragraphs:['其他会话'] }, { ...execution, sessionId:'other', runId:'other-run' });
  abort.abort(new Error('测试取消'));
  assert.equal((await spinning).ok, false);
  const size = (await fs.stat(path.join(workspace,'spinning.txt'))).size; await delay(100);
  assert.equal((await fs.stat(path.join(workspace,'spinning.txt'))).size, size, '返回取消后实际没有继续写');
  await other;
  const timed = await ctx.tools.execute('plugin__dsh_stubborn__spin', {}, { ...execution, runId:'timeout', timeoutMs:250 });
  assert.equal(timed.ok, false);
  const after = (await fs.stat(path.join(workspace,'spinning.txt'))).size; await delay(100);
  assert.equal((await fs.stat(path.join(workspace,'spinning.txt'))).size, after);
});

test('检查进程不触及主进程全局状态，写入和启动子进程受限制，对象 inject 如实识别', async t => {
  const { ctx, dir } = await fixture(t);
  const pkg=path.join(ctx.plugins.dir,'node_modules','dsh-probe'); await fs.mkdir(pkg,{recursive:true});
  await fs.writeFile(path.join(pkg,'package.json'),JSON.stringify({name:'dsh-probe',type:'module',main:'index.mjs',dsh:{}}));
  await fs.writeFile(path.join(pkg,'index.mjs'),`globalThis.__probeMainTouched=true; export const inject={llm:{}}; export function apply(){}`);
  delete globalThis.__probeMainTouched;
  const result=await ctx.plugins.compatibility({spec:'dsh-probe'});
  assert.equal(globalThis.__probeMainTouched,undefined);
  assert.deepEqual(result.hostHalf.inject,['llm']); assert.equal(result.verdict,'runnable');
  assert.equal(result.runtime, 'dsh-session');
  await fs.writeFile(path.join(pkg,'index.mjs'),`import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(path.join(dir,'unapproved'))},'bad'); export function apply(){}`);
  const write=await ctx.plugins.compatibility({spec:'dsh-probe'}); assert.equal(write.verdict,'unsupported');
  await assert.rejects(fs.access(path.join(dir,'unapproved')));
  await fs.writeFile(path.join(pkg,'index.mjs'),`import {execFileSync} from 'node:child_process'; execFileSync(process.execPath,['-e',${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(path.join(dir,'spawned'))},'bad')`)}]); export function apply(){}`);
  const spawn=await ctx.plugins.compatibility({spec:'dsh-probe'}); assert.equal(spawn.verdict,'unsupported');
  await assert.rejects(fs.access(path.join(dir,'spawned')));
  const privateFile=path.join(ctx.plugins.dir,'data','private-session.json');await fs.mkdir(path.dirname(privateFile),{recursive:true});await fs.writeFile(privateFile,'private');
  await fs.writeFile(path.join(pkg,'index.mjs'),`import fs from 'node:fs'; fs.readFileSync(${JSON.stringify(privateFile)}); export function apply(){}`);
  const read=await ctx.plugins.compatibility({spec:'dsh-probe'}); assert.equal(read.verdict,'unsupported');
  const local=path.join(dir,'local-source');await fs.mkdir(path.join(local,'lib'),{recursive:true});
  await fs.writeFile(path.join(local,'package.json'),JSON.stringify({name:'dsh-local',type:'module',main:'lib/index.mjs',dsh:{}}));
  await fs.writeFile(path.join(local,'helper.mjs'),"export const inject=['tools'];export function apply(){}");
  await fs.writeFile(path.join(local,'lib/index.mjs'),"export * from '../helper.mjs'");
  await fs.symlink(local,path.join(ctx.plugins.dir,'node_modules','dsh-local'),'dir');
  const localCheck=await ctx.plugins.compatibility({spec:'dsh-local'});assert.equal(localCheck.verdict,'runnable',JSON.stringify(localCheck));
});

test('路由按宿主和拥有者清理，冲突拒绝，查询和请求头保留，在途取消等待收尾', async () => {
  const a=new PluginRouteRegistry(), b=new PluginRouteRegistry(), ownerA={}, ownerB={};
  const off=a.register({path:'/api/a',fetch:req=>Response.json({query:new URL(req.url).searchParams.get('q'),header:req.headers.get('x-test')})},ownerA);
  a.register({path:'/api/b',fetch:()=>Response.json({b:true})},ownerB);
  assert.throws(()=>a.register({path:'/api/a',fetch:()=>Response.json({})},ownerB),/已被注册/);
  assert.equal((await b.dispatch({path:'/api/a'})).status,404);
  const response=await a.dispatch({path:'/api/a?q=保留',headers:{'x-test':'value'}});
  assert.deepEqual(JSON.parse(response.body),{query:'保留',header:'value'});
  await off(); assert.equal((await a.dispatch({path:'/api/a'})).status,404);
  assert.equal((await a.dispatch({path:'/api/b'})).status,200);
  let ended=false;
  a.register({path:'/api/slow',fetch:async req=>{ await new Promise(resolve=>req.signal.addEventListener('abort',resolve,{once:true})); await delay(20); ended=true; return Response.json({}); }},ownerA);
  const slow=a.dispatch({path:'/api/slow'}); await a.clear(ownerA);
  assert.equal(ended,true); assert.equal((await slow).status,410); assert.equal((await a.dispatch({path:'/api/b'})).status,200);
});

test('暂存下载或启动失败：文件、锁文件和旧版本全部恢复；成功才切换', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dyw-transaction-')); t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const profile=path.join(dir,'plugins'); await fs.mkdir(profile); await fs.writeFile(path.join(profile,'package-lock.json'),'original');
  const prepare=async stage=>{await fs.writeFile(path.join(stage,'package-lock.json'),'new'); return {ok:true};};
  let restored=false;
  const failed=await transactPluginProfile(profile,prepare,async()=>({ok:false,error:'启动失败'}),async()=>{restored=true;});
  assert.equal(failed.rolledBack,true); assert.equal(restored,true); assert.equal(await fs.readFile(path.join(profile,'package-lock.json'),'utf8'),'original');
  const downloaded=await transactPluginProfile(profile,async()=>({ok:false,error:'断网'}),async()=>assert.fail(),async()=>{});
  assert.equal(downloaded.rolledBack,true); assert.equal(await fs.readFile(path.join(profile,'package-lock.json'),'utf8'),'original');
  const ok=await transactPluginProfile(profile,prepare,async()=>({ok:true}),async()=>{});
  assert.equal(ok.transaction,'committed'); assert.equal(await fs.readFile(path.join(profile,'package-lock.json'),'utf8'),'new');
});

test('官方客户端模块：注册不执行，依赖可晚到，异步分块按所属插件加载并拒绝路径越界', async () => {
  let executions=0; const urls=[];
  const loader=new ClientModuleLoader({loadBundle:async url=>{ urls.push(url); loader.load({id:'lazy',chunk:'client.extra.js',factory:()=>({value:42})}); }});
  const consumer=loader.load({id:'lazy',factory:require=>{ executions++; return {dependency:require('late'),chunk:()=>require.async('./client.extra.js'),bad:()=>require.async('../secret.js')}; }});
  assert.equal(executions,0);
  loader.load({id:'late',factory:()=>({ok:true})});
  const value=consumer.exports; assert.equal(executions,1); assert.equal(value.dependency.ok,true);
  assert.deepEqual(await value.chunk(),{value:42}); assert.match(urls[0],/\/lazy\/client.extra.js\?rev=/);
  await assert.rejects(value.bad(),/cannot resolve|invalid relative chunk/);
  loader.invalidate('lazy'); assert.equal(loader.bundle('lazy'),undefined);
});

test('真实宿主：等待依赖不冒充启动，A 停用收回接口而 B 保留', async t => {
  const {ctx}=await fixture(t);
  const installNative=async (id,source)=>{
    const dir=path.join(ctx.plugins.dir,'node_modules',id);await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name:id,type:'module',main:'index.mjs',dyworker:{}}));
    await fs.writeFile(path.join(dir,'index.mjs'),source);
    return ctx.plugins.add({id,name:id});
  };
  await installNative('waiting',`export const inject={missingService:{}};export function apply(){throw new Error('不应执行')}`);
  const waiting=ctx.plugins.entries().find(item=>item.id==='waiting');assert.equal(waiting.active,false);assert.equal(waiting.state,'pending');assert.deepEqual(waiting.missingServices,['missingService']);
  for(const id of ['route-a','route-b']) await installNative(id,`export const inject=['connection'];export function apply(ctx){ctx.connection.fetch.register({path:'/api/${id}',fetch:()=>Response.json({id:'${id}'})})}`);
  assert.equal((await ctx.connection.dispatch({path:'/api/route-a'})).status,200);
  assert.equal((await ctx.connection.dispatch({path:'/api/route-b'})).status,200);
  await ctx.plugins.setEnabled('route-a',false);
  assert.equal((await ctx.connection.dispatch({path:'/api/route-a'})).status,404);
  assert.equal((await ctx.connection.dispatch({path:'/api/route-b'})).status,200);
  const registry=ctx.connection.registry;
  await disposeHost(ctx);assert.equal((await registry.dispatch({path:'/api/route-b'})).status,404);
});

test('真实代理入口：办公文件读回才记完成，拒绝审批不能调用插件', async t => {
  const { runAgent } = await import('../electron/agent.mts');
  const { pluginToolResult } = await import('../electron/host/services/tools.mts');
  const { ctx, execution, workspace } = await fixture(t);
  await copyPlugin(ctx, 'dsh-office-tools', 'office');
  for (const allowed of [true, false]) {
    let step = 0, calls = 0;
    const file = allowed ? 'agent-approved.docx' : 'agent-denied.docx';
    const outcome = await runAgent({
      settings: { endpoint:'http://mock.local/v1/chat/completions', model:'mock-model', apiKey:'test' },
      workspacePath:workspace, approvalMode:allowed ? 'full-access' : 'deny-changes',
      conversation:[{role:'user',content:'用办公插件创建验收文件'}],
      extraTools:ctx.tools.definitions(),
      onExtraTool:async(name,args)=>{
        calls++;
        const output=await ctx.tools.execute(name,args,execution);
        return output.ok ? pluginToolResult(output.result) : {ok:false,result:output.error};
      },
      requestApproval:async()=>false,
      fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:step++===0
        ? {role:'assistant',content:null,tool_calls:[{id:'office',type:'function',function:{name:'plugin__office__word_create',arguments:JSON.stringify({path:file,paragraphs:['真实文件检查']})}}]}
        : {role:'assistant',content:'检查结束。'}}]})}),
    });
    assert.equal(calls,allowed?1:0);
    if(allowed){
      assert.equal((await fs.readFile(path.join(workspace,file))).subarray(0,2).toString(),'PK');
      assert.ok(outcome.changes.some(change=>change.path===file));
    }else{await assert.rejects(fs.access(path.join(workspace,file)));assert.deepEqual(outcome.changes||[],[]);}
  }
});

test('真实插件升级启动失败：保留旧办公版本和工具，随后仍能写入', async t => {
  const {ctx,execution,workspace}=await fixture(t);
  const pkg=await copyPlugin(ctx,'dsh-office-tools','office');
  const original=await fs.readFile(path.join(pkg,'lib/index.js'),'utf8');
  const failed=await ctx.plugins.installPackage({input:'dsh-office-tools@1.0.6',npmPath:'/fake/npm',run:async(_command,args)=>{
    if(args[0]==='install'){
      const stage=args[args.indexOf('--prefix')+1];
      const target=path.join(stage,'node_modules/dsh-office-tools');
      const manifest=JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8'));manifest.version='1.0.6';
      await fs.writeFile(path.join(target,'package.json'),JSON.stringify(manifest));
      await fs.writeFile(path.join(target,'lib/index.js'),"export const inject=['tools'];export function apply(){throw new Error('升级启动失败验收')} ");
    }
    return {code:0,stdout:'',stderr:''};
  }});
  assert.equal(failed.ok,false);assert.equal(failed.rolledBack,true);
  assert.match(failed.error,/升级启动失败验收/);
  assert.equal(JSON.parse(await fs.readFile(path.join(pkg,'package.json'),'utf8')).version,'1.0.5');
  assert.equal(await fs.readFile(path.join(pkg,'lib/index.js'),'utf8'),original);
  assert.equal(ctx.plugins.entries().find(row=>row.id==='office').active,true);
  await call(ctx,'plugin__office__word_create',{path:'after-failed-update.docx',paragraphs:['旧插件仍正常']},execution);
  await fs.access(path.join(workspace,'after-failed-update.docx'));
});

test('包管理器清理手工已登记的另一插件时，安装事务保留它及原有依赖，真实办公操作继续可用',async t=>{
  const {ctx,execution}=await fixture(t);
  const office=await copyPlugin(ctx,'dsh-office-tools','office');
  const original=await fs.readFile(path.join(office,'lib/index.js'));
  const clientName='retained-client-module';
  const clientDir=path.join(ctx.plugins.dir,'node_modules',clientName);await fs.mkdir(clientDir);
  await fs.writeFile(path.join(clientDir,'package.json'),JSON.stringify({name:clientName,version:'1.0.0',type:'module',main:'index.mjs'}));
  await fs.writeFile(path.join(clientDir,'index.mjs'),"export function renderLabel(){return '原来的界面依赖仍可使用'};");
  const viewDir=path.join(ctx.plugins.dir,'node_modules/manual-view');await fs.mkdir(viewDir);
  await fs.writeFile(path.join(viewDir,'package.json'),JSON.stringify({name:'manual-view',version:'1.0.0',type:'module',main:'index.mjs',dyworker:{client:{inject:[clientName]}}}));
  await fs.writeFile(path.join(viewDir,'index.mjs'),"export function apply(){};");
  assert.equal((await ctx.plugins.add({name:'manual-view',id:'manual-view'})).ok,true);
  const installed=await ctx.plugins.installPackage({input:'new-package@1.0.0',npmPath:'/fake/npm',run:async(_command,args)=>{
    if(args[0]==='install'){
      const stage=args[args.indexOf('--prefix')+1];
      await fs.rm(path.join(stage,'node_modules/dsh-office-tools'),{recursive:true,force:true});
      await fs.rm(path.join(stage,'node_modules/@deepseek-ai/dsh-fs'),{recursive:true,force:true});
      await fs.rm(path.join(stage,'node_modules',clientName),{recursive:true,force:true});
      await fs.rm(path.join(stage,'node_modules/manual-view'),{recursive:true,force:true});
      const target=path.join(stage,'node_modules/new-package');await fs.mkdir(target,{recursive:true});
      await fs.writeFile(path.join(target,'package.json'),JSON.stringify({name:'new-package',version:'1.0.0',type:'module',main:'index.mjs'}));
      await fs.writeFile(path.join(target,'index.mjs'),"export function apply() {};");
    }return {code:0,stdout:'',stderr:''};
  }});
  assert.equal(installed.ok,true,JSON.stringify(installed));
  assert.deepEqual(await fs.readFile(path.join(office,'lib/index.js')),original);
  assert.equal(ctx.plugins.entries().find(row=>row.id==='office').active,true);
  assert.equal((await import(path.join(clientDir,'index.mjs'))).renderLabel(),'原来的界面依赖仍可使用');
  assert.equal(ctx.plugins.entries().find(row=>row.id==='manual-view').active,true);
  await call(ctx,'plugin__office__word_create',{path:'preserved-office.docx',paragraphs:['其他插件安装后原办公功能仍正常']},execution);
  assert.equal((await call(ctx,'plugin__office__word_read',{path:'preserved-office.docx'},execution)).text.includes('其他插件安装后原办公功能仍正常'),true);
});

test('打包路径回归：从 app.asar 入口启动，实际读取解包目录中的依赖', async t => {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-asar-process-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const packed=path.join(root,'app.asar'),unpacked=packed+'.unpacked';
  const relative='dist/electron/host/dsh-runtime';
  await fs.mkdir(path.join(packed,relative),{recursive:true});await fs.mkdir(path.join(unpacked,relative),{recursive:true});
  await fs.copyFile(new URL('../electron/host/dsh-runtime/process.mts',import.meta.url),path.join(packed,relative,'process.mts'));
  const dependency=path.join(unpacked,'node_modules','fixture','data.txt');await fs.mkdir(path.dirname(dependency),{recursive:true});await fs.writeFile(dependency,'实际解包依赖');
  await fs.writeFile(path.join(unpacked,relative,'worker.mts'),`import fs from 'node:fs';process.once('message',()=>{try{process.send({value:fs.readFileSync(${JSON.stringify(dependency)},'utf8')},()=>process.exit(0))}catch(error){process.send({error:error.message},()=>process.exit(1))}})`);
  const profile=path.join(root,'profile');await fs.mkdir(profile);
  const {pathToFileURL}=await import('node:url');
  const {spawnPluginProcess,terminatePluginProcess}=await import(pathToFileURL(path.join(packed,relative,'process.mts')));
  const child=spawnPluginProcess('worker',{profileDir:profile});
  try{
    const result=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('打包进程超时')),3000);
      child.once('message',message=>{clearTimeout(timer);resolve(message)});child.once('error',reject);child.send({});
    });
    assert.deepEqual(result,{value:'实际解包依赖'});
  }finally{await terminatePluginProcess(child);}
});

test('会话专用插件：实际预检后正常安装，原生工具不冒充启动，官方会话可执行并保留启停状态', async t => {
  const { ctx, workspace } = await fixture(t);
  const name = 'dsh-session-capabilities';
  const dir = path.join(ctx.plugins.dir, 'node_modules', name); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version:'1.0.0', type:'module', main:'index.mjs', dsh:{} }));
  await fs.writeFile(path.join(dir, 'index.mjs'), `import {defineTool} from '@deepseek-ai/dsh-tools';
    export const inject=['llm','settings','userQuestions','workflowEngine','jobs','ptcRuntime','tools'];
    export function apply(ctx){
      if(typeof ctx.userQuestions.ask!=='function'||typeof ctx.ptcRuntime.run!=='function')throw new Error('真实能力缺失');
      ctx.tools.register(defineTool({name:'check_runtime',description:'验收',parameters:{},output:{schema:{type:'object',properties:{ok:{type:'boolean',required:true}},additionalProperties:false},render:(_args,r)=>[{type:'text',text:JSON.stringify(r)}]},execute:()=>({ok:true})}));
    }`);
  await ctx.plugins.ensureRuntimePeers(name);
  const check = await ctx.plugins.compatibility({spec:name}); assert.equal(check.verdict,'runnable',JSON.stringify(check));
  assert.equal(check.runtime,'dsh-session');
  const installed = await ctx.plugins.install({spec:name}); assert.equal(installed.ok,true,installed.error);
  const entry = ctx.plugins.entries().find(item=>item.name===name);
  assert.equal(entry.state,'session-required'); assert.equal(entry.active,false); assert.equal(entry.error,null);
  assert.equal(ctx.tools.owns('plugin__dsh_session_capabilities__check_runtime'),false);
  const {OfficialDshSession} = await import('../electron/host/dsh-runtime/full-session.mts');
  const runtime = new OfficialDshSession({profileDir:ctx.plugins.dir,dataDir:path.join(workspace,'session-data'),workspacePath:workspace,
    sessionId:'session-check',plugins:await ctx.plugins.dshSessionPlugins(),approve:async()=>true,async *generate(request){
      const block=request.messages.some(message=>message.role==='tool')?{type:'text',text:'检查完成'}:{type:'tool-call',id:'check-call',name:'check_runtime',arguments:'{}'};
      yield {type:'block-start',index:0,blockType:block.type};
      yield block.type==='tool-call'?{type:'tool-call-delta',index:0,id:block.id,name:block.name,argumentsDelta:block.arguments}:{type:'text-delta',index:0,text:block.text};
      yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:block.type==='tool-call'?'tool-calls':'stop'}};
    }});
  try { const ready=await runtime.start();assert.ok(ready.schemas.some(item=>item.name==='check_runtime'));
    const result=await runtime.request('prompt',{text:'实际检查'});assert.ok(result.events.some(event=>event.type==='tool/result'&&JSON.stringify(event).includes('true')),JSON.stringify(result.events.filter(event=>event.type==='tool/result')));
  } finally {await runtime.close();}
  await ctx.plugins.setEnabled(entry.id,false);assert.equal(ctx.plugins.entries().find(item=>item.id===entry.id).state,'disabled');
  assert.equal((await ctx.plugins.dshSessionPlugins()).length,0);
  await ctx.plugins.setEnabled(entry.id,true);assert.equal(ctx.plugins.entries().find(item=>item.id===entry.id).state,'session-required');
  await fs.writeFile(path.join(dir,'index.mjs'),"export const inject=['llm'];export function apply(){throw new Error('启动失败')} ");
  const failed=await ctx.plugins.compatibility({spec:name});assert.equal(failed.verdict,'unsupported');assert.match(failed.reasons.join(' '),/启动检查失败/);
});

test('应用重启更新旧共享软链，办公插件仍能实际写文件，不依赖旧应用目录', async t=>{
  const {ctx,dir,workspace,execution}=await fixture(t);await copyPlugin(ctx,'dsh-office-tools','office');
  const link=path.join(ctx.plugins.dir,'node_modules/@deepseek-ai/dsh-tools');await fs.unlink(link);await fs.symlink(path.join(dir,'removed-application','dsh-tools'),link,'dir');
  await disposeHost(ctx);
  const restarted=await createHost({userDataDir:dir,mountPlugins:true});t.after(()=>disposeHost(restarted));
  assert.equal(restarted.plugins.entries().find(entry=>entry.id==='office').state,'active');
  await call(restarted,'plugin__office__word_create',{path:'after-app-update.docx',paragraphs:['升级后仍可使用']},execution);
  assert.equal((await fs.readFile(path.join(workspace,'after-app-update.docx'))).subarray(0,2).toString(),'PK');
});
