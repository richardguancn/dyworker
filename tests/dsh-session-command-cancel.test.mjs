import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {OfficialDshSession} from '../electron/host/dsh-runtime/full-session.mts';

test('取消公开命令只收尾自身，保留运行模型；附件读取实际文件，伪造凭据及插件异常保存真实失败',{timeout:20000},async t=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-public-command-'))),profileDir=path.join(dir,'profile');
  const packageDir=path.join(profileDir,'node_modules','command-boundaries'),entry=path.join(packageDir,'index.mjs');await fs.mkdir(packageDir,{recursive:true});
  await fs.writeFile(path.join(packageDir,'package.json'),JSON.stringify({name:'command-boundaries',version:'1.0.0',type:'module'}));
  await fs.writeFile(entry,`export const inject=['commands','attachments'];export function apply(ctx){
    ctx.commands.register({name:'wait-signal',description:'等待实际取消',handler:inv=>new Promise((resolve,reject)=>{inv.signal.addEventListener('abort',()=>reject(inv.signal.reason),{once:true});if(inv.signal.aborted)reject(inv.signal.reason);})});
    ctx.commands.register({name:'read-attachment',description:'读取真实附件',input:{hint:'实际附件',attachments:true},handler:async inv=>{const parts=[];for(const part of inv.attachments){if(part.type==='file'){const bytes=[];for await(const chunk of ctx.attachments.readFileStream(part.attachment))bytes.push(Buffer.from(chunk));parts.push(Buffer.concat(bytes).toString());}}return {kind:'success',text:parts.join('|')};}});
    ctx.commands.register({name:'throw-check',description:'真实异常',handler:()=>{throw new Error('插件实际异常');}});
  }`);
  let ready,finish,models=0;const started=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>finish=resolve);
  const runtime=new OfficialDshSession({profileDir,dataDir:path.join(dir,'owned'),workspacePath:dir,sessionId:'command-root',plugins:[{id:'command-boundaries',entryUrl:pathToFileURL(entry).href}],
    async *generate(){models++;ready();await gate;yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'模型保持正常'};
      yield {type:'block-end',index:0,block:{type:'text',text:'模型保持正常'}};yield {type:'finish',reason:{kind:'stop'}};}});
  t.after(async()=>{finish();await runtime.close();await fs.rm(dir,{recursive:true,force:true});});await runtime.start();
  const prompt=runtime.request('prompt',{text:'执行命令时保持模型运行'});await started;
  const address={kind:'session',sessionId:'command-root'},command=(line,attachments=[],options={})=>runtime.request('session-command',{address,line,attachments},options);
  const abort=new AbortController(),waiting=command('/wait-signal',[],{signal:abort.signal});
  const deadline=Date.now()+5000;
  while(!(await runtime.request('snapshot')).events.some(row=>row.type==='command/run'&&row.data.name==='wait-signal')){
    assert.ok(Date.now()<deadline,'命令没有实际开始');await new Promise(resolve=>setTimeout(resolve,5));
  }
  const rejected=assert.rejects(waiting,/只取消本命令/);abort.abort(new Error('只取消本命令'));await rejected;
  const file=path.join(dir,'actual.txt');await fs.writeFile(file,'真实附件内容-OPS-119');
  const attachments=await runtime.request('command-attachments',{files:[{filePath:file,name:'actual.txt',image:false}]});
  const result=await command('/read-attachment',attachments);assert.equal(result.result.kind,'success');assert.equal(result.result.text,'真实附件内容-OPS-119');
  const forged=await command('/read-attachment',[{type:'file',receiptId:'borrowed-foreign-receipt'}]);assert.equal(forged.result.kind,'error');assert.match(forged.result.text,/not uploaded|staged|receipt/i);
  await assert.rejects(command('/throw-check'),/插件实际异常/);
  const snapshot=await runtime.request('snapshot');assert.equal(snapshot.status,'running');assert.equal(models,1);
  const runs=snapshot.events.filter(row=>row.type==='command/run'),ends=snapshot.events.filter(row=>row.type==='command/done');assert.equal(runs.length,4);assert.equal(ends.length,4);
  assert.deepEqual(new Set(runs.map(row=>row.data.commandId)),new Set(ends.map(row=>row.data.commandId)));
  assert.equal(ends.filter(row=>row.data.kind==='error').length,3);
  const waitingId=runs.find(row=>row.data.name==='wait-signal').data.commandId;
  assert.equal(ends.find(row=>row.data.commandId===waitingId).data.text,'插件请求已取消');
  finish();const completed=await prompt;assert.match(JSON.stringify(completed.events),/模型保持正常/);assert.equal(models,1);
});
