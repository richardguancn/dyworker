import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {buildForkSeed} from '@deepseek-ai/dsh-session/fork';
import {createHost,disposeHost} from '../electron/host/context.mts';
import {createOfficialDshContext} from '../electron/host/dsh-runtime/official-context.mts';
import {createSessionHistory} from '../electron/host/dsh-runtime/session-history.mts';
import {birthDshTask,dshWorkspaceId} from '../electron/host/dsh-runtime/task-birth.mts';
import {OfficialDshSession} from '../electron/host/dsh-runtime/full-session.mts';
import {ClientPluginHost} from '../src/pluginRuntime/clientHost.ts';
import {createSessionHistoryClient} from '../src/pluginRuntime/sessionHistory.ts';
import {mergeCreatedDshTask} from '../src/dshTurns.ts';

const signal=()=>new AbortController().signal;
const dataDir=(host,id)=>path.join(host.dshRuntime.config.dir,createHash('sha256').update(id).digest('hex'));
async function fixture(t){
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-task-birth-')));
  const host=await createHost({userDataDir:dir,mountPlugins:true});
  t.after(async()=>{await disposeHost(host);await fs.rm(dir,{recursive:true,force:true});});
  return {host,dir,create:request=>host.dshRuntime.request('','session-create',request)};
}
async function read(host,id){
  const ctx=await createOfficialDshContext({dataDir:dataDir(host,id),workspacePath:(await host.sessions.getAsync(id)).workspacePath});
  try{const handle=await ctx.sessionPersistence.open(id,'read');try{return {header:handle.header,inheritedEventCount:handle.inheritedEventCount,...await handle.read(0)};}finally{await handle.close();}}
  finally{await ctx.fiber.dispose();}
}

test('插件创建的多个空任务实际保存，指定编号可重复采用，工作区编号与默认任务有效；错误和取消不发布',async t=>{
  const {host,dir,create}=await fixture(t);
  const a=await create({cwd:dir,sessionId:'born-a'}),b=await create({workspaceId:dshWorkspaceId(dir)});
  assert.notEqual(a.sessionId,b.sessionId);assert.deepEqual(a.nativeSession.messages,[]);
  assert.equal((await create({cwd:dir,sessionId:a.sessionId})).sessionId,a.sessionId);
  const c=await create({defaultSessionId:a.sessionId});assert.equal(c.nativeSession.workspacePath,dir);
  assert.deepEqual(new Set((await host.sessions.loadAll()).map(row=>row.id)),new Set([a.sessionId,b.sessionId,c.sessionId]));
  assert.equal((await read(host,a.sessionId)).header.id,a.sessionId);assert.equal(host.dshRuntime.sessions.size,0);
  for(const payload of [{workspaceId:'unknown'},{cwd:dir,workspaceId:dir},{cwd:path.join(dir,'missing')},{cwd:dir,sessionId:''},{}])
    await assert.rejects(create(payload));
  const abort=new AbortController();abort.abort(new Error('取消创建'));
  await assert.rejects(host.dshRuntime.request('','session-create',{cwd:dir},{signal:abort.signal}),/取消创建/);
  assert.equal((await host.sessions.loadAll()).length,3);
  await host.sessions.applyDelta({removed:[a.sessionId],order:[b.sessionId,c.sessionId]});
  await assert.rejects(create({cwd:dir,sessionId:a.sessionId}),/已有存档/);
});

test('实际存档的完成历史按原始边界复制，未结束的明确切点按原始规则收尾；源历史不改变',{timeout:30000},async t=>{
  const {host,dir,create}=await fixture(t);await create({cwd:dir,sessionId:'fork-source'});
  let calls=0;
  const options={profileDir:host.plugins.dir,dataDir:dataDir(host,'fork-source'),workspacePath:dir,sessionId:'fork-source',plugins:[],
    async *generate(){calls++;yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:'真实回答'}};yield {type:'finish',reason:{kind:'stop'}};}};
  const worker=new OfficialDshSession(options);try{await worker.start();await worker.request('prompt',{text:'第一段'});await worker.request('prompt',{text:'第二段'});}finally{await worker.close();}
  const source=await read(host,'fork-source'),address={kind:'session',sessionId:'fork-source'};
  const first=source.events.find(event=>event.type==='user/message'&&event.data.source.kind==='user');
  const fork=payload=>host.dshRuntime.request('','session-fork',{sourceRootId:'fork-source',address,...payload});
  const exact=await fork({atSeq:first.seq});const exactStored=await read(host,exact.sessionId);
  assert.deepEqual(exactStored.events,buildForkSeed(source.events,first.seq));assert.equal(exactStored.inheritedEventCount,first.seq+1);
  assert.equal(exactStored.header.parentSession,'fork-source');assert.equal(exactStored.header.origin,undefined);
  assert.deepEqual(exact.nativeSession.messages.map(row=>row.content),['第一段']);
  const latest=await fork({});assert.equal(latest.nativeSession.messages.length,4);
  const reply=source.events.find(event=>event.type==='assistant/message');
  const selected=await fork({messageId:reply.data.message.id,turnId:first.data.id});
  assert.deepEqual(selected.nativeSession.messages.map(row=>row.content),['第一段','真实回答']);
  assert.doesNotMatch(JSON.stringify((await read(host,selected.sessionId)).events),/第二段/);
  assert.deepEqual((await read(host,'fork-source')).events,source.events);assert.equal(calls,2);assert.equal(host.dshRuntime.sessions.size,0);
  for(const payload of [{atSeq:-1},{atSeq:-0},{atSeq:1.5},{atSeq:source.events.length},{messageId:'missing'},{turnId:first.data.id}])await assert.rejects(fork(payload));
  const continuing=new OfficialDshSession({...options,sessionId:exact.sessionId,dataDir:dataDir(host,exact.sessionId)});
  try{await continuing.start();await continuing.request('prompt',{text:'分支独立继续'});}finally{await continuing.close();}
  assert.match(JSON.stringify((await read(host,exact.sessionId)).events),/分支独立继续/);
  assert.doesNotMatch(JSON.stringify((await read(host,'fork-source')).events),/分支独立继续/);assert.equal(calls,3);
});

test('复制仅带入切点以前的真实图片与文件，删除源存储后仍可读取；附件损坏不留下半个新任务',async t=>{
  const {host,dir}=await fixture(t),sourceDir=path.join(dir,'source-assets');
  const ctx=await createOfficialDshContext({dataDir:sourceDir,workspacePath:dir});t.after(()=>ctx.fiber.dispose());
  const session=ctx.sessions.create('attachment-source',{meta:{cwd:dir}});
  const image=await ctx.attachments.saveImage({mediaType:'image/png',data:await sharp({create:{width:3,height:2,channels:3,background:'#338855'}}).png().toBuffer()});
  const file=await ctx.attachments.saveFile({name:'真实文件.txt',data:Buffer.from('附件的真实内容')});
  const future=await ctx.attachments.saveFile({name:'后续私有文件.txt',data:Buffer.from('不能复制')});
  session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'带附件的请求'},{type:'image',attachment:image},{type:'file',attachment:file}]}),{surfaceOp:'append'});
  const boundary=session.snapshotEvents().at(-1).seq;
  session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'file',attachment:future}]}),{surfaceOp:'append'});
  const request={dir:host.dshRuntime.config.dir,archive:host.sessions,request:{},signal:signal(),fork:{header:session.header,seed:buildForkSeed(session.snapshotEvents(),boundary),inheritedEventCount:boundary+1,atSeq:boundary,store:ctx.attachments}};
  const born=await birthDshTask(request);assert.equal(born.nativeSession.messages[0].attachments.length,1);
  assert.deepEqual(born.nativeSession.messages[0].dshAttachments.map(part=>part.mediaType),[image.mediaType]);
  assert.deepEqual(Buffer.from(born.nativeSession.messages[0].dshAttachments[0].data,'base64'),Buffer.from((await ctx.attachments.readImage(image)).data));
  assert.ok(born.nativeSession.messages[0].attachments.every(ref=>ref.path.startsWith(dataDir(host,born.sessionId))));
  const damagedStore=Object.create(ctx.attachments);damagedStore.readImage=async()=>{throw new Error('原图片损坏');};
  await assert.rejects(birthDshTask({...request,fork:{...request.fork,store:damagedStore}}),/原图片损坏/);
  assert.equal((await host.sessions.loadAll()).length,1);assert.deepEqual((await fs.readdir(host.dshRuntime.config.dir)).filter(name=>name.startsWith('.creating-')),[]);
  await ctx.fiber.dispose();await fs.rm(sourceDir,{recursive:true,force:true});
  const target=await createOfficialDshContext({dataDir:dataDir(host,born.sessionId),workspacePath:dir});
  try{
    assert.equal((await target.attachments.readImage(image)).data.length,image.bytes);
    const chunks=[];for await(const chunk of target.attachments.readFileStream(file))chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(),'附件的真实内容');
    await assert.rejects(async()=>{for await(const chunk of target.attachments.readFileStream(future))void chunk;});
  }finally{await target.fiber.dispose();}
});

test('原任务在发布前删除或换工作区、取消创建时，复制失败并移除自己的暂存数据',async t=>{
  const {host,dir}=await fixture(t),ctx=await createOfficialDshContext({dataDir:path.join(dir,'source'),workspacePath:dir});t.after(()=>ctx.fiber.dispose());
  const session=ctx.sessions.create('race-source',{meta:{cwd:dir}});session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'原历史'}]}),{surfaceOp:'append'});
  const source={id:session.id,runtime:'dsh',workspacePath:dir,createdAt:new Date().toISOString(),messages:[]};await host.sessions.upsert(source);
  for(const action of ['delete','replace','abort']){
    await host.sessions.upsert(source);const abort=new AbortController();
    const archive={getAsync:id=>host.sessions.getAsync(id),publishDshTask:async(record,expected,signal)=>{
      if(action==='delete')await host.sessions.applyDelta({removed:[source.id],order:[]});
      if(action==='replace')await host.sessions.replace({...source,workspacePath:path.join(dir,'changed')});
      if(action==='abort')abort.abort(new Error('发布前取消'));
      return host.sessions.publishDshTask(record,expected,signal);
    }};
    await assert.rejects(birthDshTask({dir:host.dshRuntime.config.dir,archive,request:{},signal:abort.signal,sourceRecord:source,
      fork:{header:session.header,seed:buildForkSeed(session.snapshotEvents(),session.snapshotEvents().at(-1).seq),inheritedEventCount:session.snapshotEvents().length,atSeq:session.snapshotEvents().at(-1).seq,store:ctx.attachments}}));
    assert.deepEqual(await fs.readdir(host.dshRuntime.config.dir),[]);
  }
});

test('插件原始创建与复制在返回时立即可选可保留，标题递增在真实存档保存，关闭后旧调用拒绝',{timeout:30000},async t=>{
  const {host,dir}=await fixture(t),old=globalThis.dyworker;
  const client=new ClientPluginHost();t.after(async()=>{globalThis.dyworker=old;await client.dispose();});
  globalThis.dyworker={dshOperation:async input=>{try{return {ok:true,value:await host.dshRuntime.request(input.sessionId,input.action,input.payload)};}catch(error){return {ok:false,error:{code:error.code,message:error.message,details:error.details}};}}};
  let rows=[];client.setSessionProvider(id=>rows.find(row=>row.id===id));client.setCollections(()=>({items:rows,current:null}),()=>({items:[],current:null}));
  const id=await client.ctx.sessions.create({cwd:dir,sessionId:'plugin-born'});
  assert.equal(client.ctx.sessions.list.getSnapshot().byId[id].cwd,dir);assert.equal(client.nativeSession(id).runtime,'dsh');
  const source=client.nativeSession(id);rows=[source];client.setCollections(()=>({items:rows,current:source}),()=>({items:[],current:null}));
  const runtime=new OfficialDshSession({profileDir:host.plugins.dir,dataDir:dataDir(host,id),workspacePath:dir,sessionId:id,plugins:[],async *generate(){yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:'原任务完成'}};yield {type:'finish',reason:{kind:'stop'}};}});
  try{await runtime.start();await runtime.request('prompt',{text:'复制来源'});}finally{await runtime.close();}
  const ref=client.ctx.sessions.retain(id,{source:'birth-check'});await ref.ready;assert.ok(ref.binding.session);ref.release();
  let observed;
  await host.dshRuntime.request(id,'session-rename',{address:{kind:'session',sessionId:id},title:'真实保存的来源标题'});
  await client.refreshSessions();
  const forked=await client.ctx.sessions.fork({sessionId:id,increaseTitle:true,onCreated:child=>{
    observed=child;assert.ok(client.ctx.sessions.list.getSnapshot().byId[child]);
    // React may already have consumed publication before the rename resolves.
    rows=mergeCreatedDshTask(rows,client.nativeSession(child));
    client.setCollections(()=>({items:rows,current:source}),()=>({items:[],current:null}));
  }});
  assert.equal(observed,forked);assert.equal(client.nativeSession(forked).title,'真实保存的来源标题 (1)');assert.equal((await host.sessions.getAsync(forked)).title,'真实保存的来源标题 (1)');
  const newborn=client.nativeSession(forked);
  rows=[{...newborn,title:'尚未接到改名的旧标题'},source];client.setCollections(()=>({items:rows,current:source}),()=>({items:[],current:null}));
  assert.equal(client.nativeSession(forked).title,'真实保存的来源标题 (1)');
  const newMessages=[...newborn.messages,{role:'assistant',content:'改名等待期间的新输出'}];rows[0]={...rows[0],messages:newMessages};
  assert.equal(client.nativeSession(forked).messages,newMessages);
  rows=[source];client.setCollections(()=>({items:rows,current:source}),()=>({items:[],current:null}));
  assert.equal(client.nativeSession(forked),undefined);assert.equal(client.ctx.sessions.list.getSnapshot().byId[forked],undefined);
  client.acceptCreatedSession(newborn);assert.equal(client.nativeSession(forked),undefined);
  const stale=client.ctx.sessions;await client.dispose();await assert.rejects(async()=>stale.create({cwd:dir}),/已关闭/);
});

test('真实子任务可成为独立分支，继承目录不冒充自有后代；错父地址与空任务默认复制拒绝',{timeout:30000},async t=>{
  const {host,dir,create}=await fixture(t);await create({cwd:dir,sessionId:'child-source'});
  await assert.rejects(host.dshRuntime.request('','session-fork',{sourceRootId:'child-source',address:{kind:'session',sessionId:'child-source'}}),error=>error.code==='session/fork-unavailable');
  let calls=0;
  const worker=new OfficialDshSession({profileDir:host.plugins.dir,dataDir:dataDir(host,'child-source'),workspacePath:dir,sessionId:'child-source',plugins:[],approve:async()=>true,
    async *generate(request){calls++;
      if(calls===1){yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'block-end',index:0,block:{type:'tool-call',id:'real-child',name:'subagent',arguments:JSON.stringify({description:'真正子任务',prompt:'子任务自己的内容',run_in_background:false})}};yield {type:'finish',reason:{kind:'tool-calls'}};}
      else{yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:request.sessionId==='child-source'?'父任务回答':'子任务自己的回答'}};yield {type:'finish',reason:{kind:'stop'}};}}});
  let child;
  try{await worker.start();await worker.request('prompt',{text:'创建真正子任务'});child=Object.values((await worker.request('family')).byId).find(row=>row.parentId);}finally{await worker.close();}
  const address={kind:'subagent',childSessionId:child.id,parentSessionId:'child-source',mode:child.projectionValues.subagent.mode};
  const fork=await host.dshRuntime.request('','session-fork',{sourceRootId:'child-source',address});
  const stored=await read(host,fork.sessionId);assert.equal(stored.header.origin,undefined);assert.equal(stored.header.parentSession,child.id);
  assert.match(JSON.stringify(stored.events),/子任务自己的回答/);assert.doesNotMatch(JSON.stringify(fork.nativeSession.messages),/父任务回答/);
  const rootFork=await host.dshRuntime.request('','session-fork',{sourceRootId:'child-source',address:{kind:'session',sessionId:'child-source'}});
  assert.equal(Object.keys((await host.dshRuntime.request(rootFork.sessionId,'family')).byId).length,1);
  await assert.rejects(host.dshRuntime.request('','session-fork',{sourceRootId:'child-source',address:{...address,parentSessionId:'wrong-root'}}),error=>error.code==='subagent/unauthorized');
  assert.equal(calls,3);
});

test('运行中复制已完成前缀不打断模型；精确切点收尾后不会重新执行源任务',{timeout:30000},async t=>{
  const {host,dir,create}=await fixture(t);await create({cwd:dir,sessionId:'active-source'});
  let calls=0,ready,finish;
  const started=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>finish=resolve);
  const worker=new OfficialDshSession({profileDir:host.plugins.dir,dataDir:dataDir(host,'active-source'),workspacePath:dir,sessionId:'active-source',plugins:[],async *generate(){
    calls++;yield {type:'block-start',index:0,blockType:'text'};
    if(calls===2){yield {type:'text-delta',index:0,text:'仍在继续'};ready();await gate;}
    yield {type:'block-end',index:0,block:{type:'text',text:'正常完成'}};yield {type:'finish',reason:{kind:'stop'}};
  }});
  t.after(async()=>{finish();await worker.close();});await worker.start();await worker.request('prompt',{text:'完成的第一段'});
  const pending=worker.request('prompt',{text:'运行中的第二段'});await started;
  host.dshRuntime.sessions.set('active-source',{runtime:worker,busy:true,version:'test',ownerIds:[]});
  const address={kind:'session',sessionId:'active-source'};
  const completed=await host.dshRuntime.request('','session-fork',{sourceRootId:'active-source',address});
  assert.doesNotMatch(JSON.stringify((await read(host,completed.sessionId)).events),/运行中的第二段/);
  const current=(await worker.request('snapshot')).events;
  const user=current.findLast(event=>event.type==='user/message'&&event.data.source.kind==='user');
  const cut=await host.dshRuntime.request('','session-fork',{sourceRootId:'active-source',address,atSeq:user.seq});
  assert.deepEqual((await read(host,cut.sessionId)).events,buildForkSeed(current,user.seq));
  assert.equal((await worker.request('snapshot')).status,'running');assert.equal(calls,2);
  host.dshRuntime.sessions.delete('active-source');finish();await pending;await worker.close();
});

test('局部客户端委托创建和复制给真实入口，关闭后已缓存的方法也不能创建新任务',async()=>{
  let live=true,calls=0;
  const client=createSessionHistoryClient('scoped-root',async()=>{throw new Error('不应打开历史');},()=>live,undefined,()=>({
    create:async()=>{calls++;return {ok:true,value:{sessionId:'new-scoped'}};},
    fork:async()=>{calls++;return {ok:true,value:{sessionId:'fork-scoped'}};},
  }));
  const sessions=client.sessions;
  try{
    assert.equal(await sessions.create({cwd:'/actual'}),'new-scoped');
    assert.equal(await sessions.fork({sessionId:'scoped-root'}),'fork-scoped');
    live=false;await assert.rejects(sessions.create(),/已经关闭/);assert.equal(calls,2);
  }finally{await client.dispose();}
});

test('采用已有编号只确认原任务，旧存档回复不能覆盖当前尚未保存的对话、标题和运行状态',async t=>{
  const {host,dir,create}=await fixture(t),original=await create({cwd:dir,sessionId:'adoption-source'}),old=globalThis.dyworker;
  const current={...original.nativeSession,title:'当前修改的标题',messages:[{id:'unsaved',role:'assistant',content:'当前仍在输出',taskStatus:'running'}]};
  let rows=[current];const client=new ClientPluginHost({sessionProvider:id=>rows.find(row=>row.id===id)});
  t.after(async()=>{globalThis.dyworker=old;await client.dispose();});
  client.setCollections(()=>({items:rows,current}),()=>({items:[],current:null}));
  globalThis.dyworker={dshOperation:async input=>({ok:true,value:await host.dshRuntime.request(input.sessionId,input.action,input.payload)})};
  assert.equal(await client.ctx.sessions.create({cwd:dir,sessionId:current.id}),current.id);
  assert.equal(client.nativeSession(current.id),current);assert.equal(client.sessionListStore.getSnapshot().byId[current.id].title,current.title);
  assert.equal(client.ctx.sessions.list.getSnapshot().byId[current.id].title,undefined,'应用侧未保存标题不能冒充原始存档标题');
  assert.equal(mergeCreatedDshTask(rows,original.nativeSession),rows);
  const newborn=await create({cwd:dir});rows=mergeCreatedDshTask(rows,newborn.nativeSession);
  assert.equal(rows.length,2);assert.equal(rows[1],current);assert.equal((await host.sessions.getAsync(current.id)).messages.length,0);
});
