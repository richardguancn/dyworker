import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CommandAttachmentGrants } from '../electron/host/dsh-runtime/attachment-grants.mts';
import { createOfficialDshContext } from '../electron/host/dsh-runtime/official-context.mts';
import { ClientPluginHost } from '../src/pluginRuntime/clientHost.ts';

async function temp(t) {const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-command-attachments-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function bench(t, accept=true, submit=async()=>({kind:'success'})) {
 const host=new ClientPluginHost({sessionProvider:id=>({id,runtime:'dsh'})});t.after(()=>host.dispose());
 await host.load({name:'attachments-fixture',inject:['inputTriggers'],apply(ctx){ctx.inputTriggers.registerSource({name:'upload',trigger:'/',candidates:async()=>[],onPick:()=>undefined,
 matchEnter:async(_s,line)=>line.startsWith('/upload')?{claim:{name:'upload',token:'/upload ',attachments:accept,submit}}:undefined});}},'attachments-fixture');
 const editor=host.mountInputEditor('a');editor.setPlain('/upload 原参数');return {host,editor};
}

test('原生附件授权不接受伪造、其他窗口和其他会话，真实快照保持字节且自动清理',async t=>{
 const dir=await temp(t), file=path.join(dir,'actual.txt');await fs.writeFile(file,'真实文件内容\n唯一标记-UPLOAD-73');
 const grants=new CommandAttachmentGrants(), issued=await grants.issue('a',11,{path:file,name:'actual.txt',mimeType:'text/plain'});
 for(const [id,sender,ids] of [['b',11,[issued.commandGrantId]],['a',12,[issued.commandGrantId]],['a',11,['invented']],['a',11,[issued.commandGrantId,issued.commandGrantId]]]) await assert.rejects(grants.stage(id,sender,ids,dir),/当前会话|清单无效/);
 const staged=await grants.stage('a',11,[issued.commandGrantId],dir);assert.equal(staged.files[0].name,'actual.txt');assert.equal(await fs.readFile(staged.files[0].filePath,'utf8'),await fs.readFile(file,'utf8'));
 await staged.dispose();await assert.rejects(fs.stat(staged.files[0].filePath),{code:'ENOENT'});
 grants.releaseSender(11);await assert.rejects(grants.stage('a',11,[issued.commandGrantId],dir),/当前会话/);
});

test('选择后被改写或替换的文件拒绝读取，失败不留下未完成的快照',async t=>{
 const dir=await temp(t), file=path.join(dir,'actual.txt');await fs.writeFile(file,'原始文件');const grants=new CommandAttachmentGrants();
 const issued=await grants.issue('a',1,{path:file,name:'actual.txt'});await fs.writeFile(file,'替换内容');await assert.rejects(grants.stage('a',1,[issued.commandGrantId],dir),/发生变化/);
 assert.deepEqual(await fs.readdir(path.join(dir,'command-uploads')),[]);
 const second=await grants.issue('a',1,{path:file,name:'actual.txt'});await fs.rename(file,file+'.original');await fs.writeFile(file,'替换内容');await assert.rejects(grants.stage('a',1,[second.commandGrantId],dir),/发生变化/);
});

test('实际官方文件服务生成会话凭据，可读取真实存储；外来凭据拒绝、失败绑定可回滚、消费后退役',async t=>{
 const dir=await temp(t);const ctx=await createOfficialDshContext({dataDir:dir,workspacePath:dir});t.after(()=>ctx.fiber.dispose());
 const a=await ctx.agents.create({sessionId:'upload-a',agentOptions:{provider:'test',model:'test'}}), b=await ctx.agents.create({sessionId:'upload-b',agentOptions:{provider:'test',model:'test'}});
 const value=await ctx.fileUploads.uploadStream({sessionId:a.agent.id,name:'actual.txt',data:(async function*(){yield Buffer.from('真实上传文件');yield Buffer.from('第二段实际字节');})()});
 assert.match(value.receiptId,/^[a-f0-9-]{36}$/);assert.deepEqual(ctx.fileUploads.resolve(a.agent,value.receiptId),value.file);assert.equal(ctx.fileUploads.resolve(b.agent,value.receiptId),undefined);
 let content='';for await(const chunk of ctx.attachments.readFileStream(value.file))content+=Buffer.from(chunk).toString();assert.equal(content,'真实上传文件第二段实际字节');
 assert.throws(()=>ctx.fileUploads.bindPrompt(b.agent,[value.receiptId],'foreign'),/not uploaded/);
 const rollback=ctx.fileUploads.bindPrompt(a.agent,[value.receiptId],'failed');rollback[Symbol.dispose]();ctx.fileUploads.retirePrompt(a.agent,'failed');assert.ok(ctx.fileUploads.resolve(a.agent,value.receiptId));
 const binding=ctx.fileUploads.bindPrompt(a.agent,[value.receiptId],'accepted');binding.commit();binding[Symbol.dispose]();ctx.fileUploads.retirePrompt(a.agent,'accepted');assert.equal(ctx.fileUploads.resolve(a.agent,value.receiptId),undefined);
 const again=await ctx.fileUploads.upload(a.agent,{data:Buffer.from('真实上传文件第二段实际字节').toString('base64'),name:'actual.txt'},new AbortController().signal);assert.notEqual(again.receiptId,value.receiptId);
});

test('命令收到原样附件顺序、图片字节、文件凭据和正确会话，成功才清空草稿及本次附件',async t=>{
 const expected=[{type:'image',mediaType:'image/png',data:'AQID',name:'actual.png'},{type:'file',receiptId:'genuine-upload-receipt'}];let consumed=0,calls=0;
 const {host,editor}=await bench(t,true,async(args,ctx,attachments)=>{calls++;assert.equal(args,'原参数');assert.equal(ctx.dshSessionId,'a');assert.deepEqual(attachments,expected);return {kind:'success'};});
 const other=host.mountInputEditor('b');other.setPlain('另一任务草稿');
 assert.equal(await host.matchInputEnter('a','',{count:2,current:()=>true,serialize:async()=>expected,consume:()=>consumed++}),true);
 assert.equal(calls,1);assert.equal(consumed,1);assert.equal(editor.projection.clipboardText,'');assert.equal(other.projection.clipboardText,'另一任务草稿');
});

test('不接收附件的命令在读取前拒绝；读取失败或命令失败都保留正文和附件',async t=>{
 let reads=0,consumed=0;const {host,editor}=await bench(t,false);const submission={count:1,current:()=>true,serialize:async()=>{reads++;return [];},consume:()=>consumed++};
 await assert.rejects(host.matchInputEnter('a','',submission),/不接收附件/);assert.equal(reads,0);assert.equal(consumed,0);assert.equal(editor.projection.clipboardText,'/upload 原参数');
 const accepted=await bench(t,true,async()=>({kind:'error',text:'插件实际拒绝'}));
 await assert.rejects(accepted.host.matchInputEnter('a','',{...submission,serialize:async()=>{throw new Error('真实附件保存失败');}}),/真实附件保存失败/);
 await assert.rejects(accepted.host.matchInputEnter('a','',{...submission,serialize:async()=>[{type:'file',receiptId:'actual'}]}),/插件实际拒绝/);assert.equal(consumed,0);assert.equal(accepted.editor.projection.clipboardText,'/upload 原参数');
});

test('准备期间附件改变或切换会话，迟到结果不能执行命令和清空新草稿',async t=>{
 for(const change of ['attachments','switch','edit']) {let ready,finish,calls=0,consumed=0,current=true;const started=new Promise(resolve=>ready=resolve);const {host,editor}=await bench(t,true,async()=>{calls++;return {kind:'success'};});
 const pending=host.matchInputEnter('a','',{count:1,current:()=>current,serialize:async()=>{ready();return new Promise(resolve=>finish=resolve);},consume:()=>consumed++});await started;
 const rejected=assert.rejects(pending,/已经变化|取消/);if(change==='switch')host.unmountInputEditor('a');else if(change==='edit')editor.adoptProjection('/upload 新正文');else current=false;
 finish([{type:'file',receiptId:'late'}]);await rejected;assert.equal(calls,0);assert.equal(consumed,0);assert.equal(editor.projection.clipboardText,change==='edit'?'/upload 新正文':'/upload 原参数');
 }
});

test('执行期间附件变化、命令停用和取消不能清空已改变草稿或附件',async t=>{
 for(const change of ['attachments','unload','cancel']) {let finish,ready,consumed=0,current=true;const started=new Promise(resolve=>ready=resolve);const {host,editor}=await bench(t,true,async()=>{ready();return new Promise(resolve=>finish=resolve);});
 const pending=host.matchInputEnter('a','',{count:1,current:()=>current,serialize:async()=>[{type:'file',receiptId:'actual'}],consume:()=>consumed++});await started;const rejected=assert.rejects(pending,/已经变化|取消|停用/);
 if(change==='attachments')current=false;else if(change==='unload')await host.unload('attachments-fixture');else host.cancelInput('a');finish({kind:'success'});await rejected;assert.equal(consumed,0);assert.equal(editor.projection.clipboardText,'/upload 原参数');}
});

test('真实受限进程接收原生授权快照，官方命令读回普通文件和图片；伪造凭据及损坏图片拒绝',async t=>{
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-command-worker-')));const {OfficialDshSession}=await import('../electron/host/dsh-runtime/full-session.mts');const {pathToFileURL}=await import('node:url');const sharp=(await import('sharp')).default;
 const profileDir=path.join(dir,'profile'),workspacePath=path.join(dir,'work'),dataDir=path.join(dir,'dsh');await fs.mkdir(path.join(profileDir,'node_modules'),{recursive:true});await fs.mkdir(workspacePath);await fs.writeFile(path.join(profileDir,'package.json'),'{}');
 const pluginDir=path.join(profileDir,'node_modules','test-command-attachments');await fs.mkdir(pluginDir);const entry=path.join(pluginDir,'index.mjs');
 await fs.writeFile(entry,`export const inject=['connection','commands','agents','attachments','fileUploads'];export function apply(ctx){
 ctx.commands.register({name:'read-file',description:'检查真实上传',input:{hint:'实际附件',attachments:true},handler:async inv=>{const items=[];for(const part of inv.attachments){if(part.type==='file'){const chunks=[];for await(const chunk of ctx.attachments.readFileStream(part.attachment))chunks.push(Buffer.from(chunk));items.push({type:'file',name:part.attachment.name,text:Buffer.concat(chunks).toString('utf8')});}else{const data=await ctx.attachments.readImage(part.attachment);items.push({type:'image',name:part.attachment.name,bytes:data.data.length});}}return {kind:'success',text:JSON.stringify(items)}}});
 ctx.connection.fetch.register({path:'/api/check',methods:['POST'],fetch:async req=>{const data=await req.json();return Response.json(await ctx.commands.execute(ctx.agents.get('actual-root'),'/read-file',data,req.signal));}});
 ctx.connection.fetch.register({path:'/api/encoded-upload',methods:['POST'],fetch:async req=>Response.json(await ctx.fileUploads.upload(ctx.agents.get('actual-root'),await req.json(),req.signal))});}`);
 const runtime=new OfficialDshSession({profileDir,workspacePath,dataDir,sessionId:'actual-root',plugins:[{id:'test-command-attachments',entryUrl:pathToFileURL(entry).href}]});t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});await runtime.start();
 const file=path.join(dir,'实际文件.txt'),image=path.join(dir,'实际图.png');await fs.writeFile(file,'文件原始字节-UPLOAD-73');await fs.writeFile(image,await sharp({create:{width:3,height:2,channels:3,background:'#126a31'}}).png().toBuffer());
 const grants=new CommandAttachmentGrants();const selected=await Promise.all([grants.issue('actual-root',1,{path:file,name:'实际文件.txt',mimeType:'text/plain'}),grants.issue('actual-root',1,{path:image,name:'实际图.png',mimeType:'image/png',isImage:true})]);
 const staged=await grants.stage('actual-root',1,selected.map(item=>item.commandGrantId),dataDir);let attachments;try{attachments=await runtime.request('command-attachments',{files:staged.files});}finally{await staged.dispose();}
 assert.deepEqual(attachments.map(item=>item.type),['file','image']);assert.match(attachments[0].receiptId,/^[a-f0-9-]{36}$/);assert.deepEqual(Buffer.from(attachments[1].data,'base64'),await fs.readFile(image));
 const response=await runtime.request('route',{path:'/api/check',method:'POST',body:JSON.stringify(attachments)});assert.equal(response.status,200);const result=JSON.parse(response.body);assert.equal(result.result.kind,'success');const read=JSON.parse(result.result.text);assert.deepEqual(read[0],{type:'file',name:'实际文件.txt',text:'文件原始字节-UPLOAD-73'});assert.equal(read[1].name,'实际图.png');assert.ok(read[1].bytes>0);
 const invalid=await runtime.request('route',{path:'/api/check',method:'POST',body:JSON.stringify([{type:'file',receiptId:'invented'}])});assert.equal(JSON.parse(invalid.body).result.kind,'error');assert.doesNotMatch(JSON.parse(invalid.body).result.text,/UPLOAD-73/);
 const encoded=await runtime.request('route',{path:'/api/encoded-upload',method:'POST',body:JSON.stringify({data:Buffer.from('实际编码上传原文').toString('base64'),name:'编码文件.txt'})});assert.equal(encoded.status,200);
 const encodedCheck=await runtime.request('route',{path:'/api/check',method:'POST',body:JSON.stringify([{type:'file',receiptId:JSON.parse(encoded.body).receiptId}])});assert.equal(JSON.parse(encodedCheck.body).result.kind,'success');assert.match(JSON.parse(encodedCheck.body).result.text,/实际编码上传原文/);
 const bad=path.join(dataDir,'bad.png');await fs.writeFile(bad,'not an image');await assert.rejects(runtime.request('command-attachments',{files:[{filePath:bad,image:true,mediaType:'image/png',name:'bad.png'}]}),/image|Image/);
 await assert.rejects(runtime.request('command-attachments',{files:[{filePath:bad,image:true,mediaType:'image/bmp',name:'bad.bmp'}]}),/仅支持/);
});

test('分块上传逐块等待实际写入，存储失败和取消释放在途等待，不缓存整份文件',async()=>{
 const {StreamedAttachmentUpload}=await import('../electron/host/dsh-runtime/streamed-upload.mts');let unblock,entered;
 const started=new Promise(resolve=>entered=resolve);const chunks=[];
 const stream=new StreamedAttachmentUpload({saveFileStream:async({data})=>{for await(const chunk of data){chunks.push(Buffer.from(chunk));if(chunks.length===1){entered();await new Promise(resolve=>unblock=resolve);}}return {bytes:Buffer.concat(chunks).length};}},'实际大文件');
 let written=false;const first=stream.write(Buffer.alloc(65536,1)).then(()=>written=true);await started;assert.equal(written,false);await assert.rejects(stream.write(Buffer.from('too-early')),/顺序/);unblock();await first;await stream.write(Buffer.from('next'));assert.deepEqual(await stream.end(),{bytes:65540});
 const failing=new StreamedAttachmentUpload({saveFileStream:async({data})=>{for await(const _chunk of data)throw new Error('实际存储失败');}});
 await assert.rejects(failing.write(Buffer.from('actual')),/实际存储失败/);await assert.rejects(failing.result,/实际存储失败/);
 const canceled=new StreamedAttachmentUpload({saveFileStream:async({data})=>{for await(const _chunk of data){}return {};}});canceled.abort(new Error('实际上传取消'));await assert.rejects(canceled.result,/实际上传取消/);
});
