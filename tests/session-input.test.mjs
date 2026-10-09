import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientPluginHost } from '../src/pluginRuntime/clientHost.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i=0;i<100;i++) { if (predicate()) return; await tick(); } assert.fail('输入状态未按预期收尾'); }
function bench(t, onInputSubmit) {
  const host = new ClientPluginHost({sessionProvider:id => ['a','b'].includes(id) ? {id,runtime:'dsh'} : undefined, onInputSubmit});
  t.after(() => host.dispose()); return host;
}
const inputOf = (host, id='a') => host.ctx.conversation.input.for(host.ctx.sessions.scope(id));
async function command(host, run, attachments=true) {
  const claim = {name:'actual',token:'/actual ',attachments,submit:run};
  const row = await host.load({name:'public-input-test',inject:['inputTriggers'],apply(ctx) {
    ctx.effect(() => ctx.inputTriggers.registerSource({name:'public-input-test',trigger:'/',candidates:async()=>[],onPick:()=>({claim}),
      matchEnter:async(_session,line)=>line.startsWith('/actual') ? {claim}:undefined}));
  }},'public-input-test'); assert.equal(row.ok,true,row.error);
}

test('公开草稿在挂载前初始化，挂载后共用原编辑器，保留内容、范围修订和会话代次', async t => {
  const host=bench(t), binding=host.ctx.sessions.binding('a');
  assert.equal(host.ctx.sessions.binding('a'),binding);
  assert.equal(host.ctx.conversation.input.requestDraftInitialization(binding,{prompt:'预先准备的草稿'}),'applied');
  const a=inputOf(host), b=inputOf(host,'b');
  assert.equal(a,inputOf(host)); assert.equal(a.state.getSnapshot().draft,'预先准备的草稿');
  const editor=host.mountInputEditor('a','旧界面值');
  assert.equal(editor.editor,editor.shell.editor); assert.equal(editor.projection.clipboardText,'预先准备的草稿');
  const span=a.actions.captureInsertion();a.setDraft('后来修改');
  assert.equal(a.actions.insertText('迟到内容',span),false); assert.equal(editor.projection.clipboardText,'后来修改');
  assert.equal(host.ctx.conversation.input.requestDraftInitialization(binding,{prompt:'不应覆盖'}),'preserved');
  assert.equal(host.ctx.conversation.input.requestDraftInitialization(binding,{clearPreviousDraft:true,prompt:'显式替换'}),'applied');
  assert.equal(b.state.getSnapshot().draft,'');assert.equal(host.ctx.sessions.scopeOf(host.ctx.sessions.scope('a')),'a');
  assert.throws(()=>host.ctx.conversation.input.for(host.ctx),/仍被保留/);
  host.setSessionProvider(id=>id==='b'?{id,runtime:'dsh'}:undefined);
  assert.throws(()=>a.setDraft('不能写入旧代次'),/已经关闭/);
  assert.throws(()=>a.actions.setDraft('旧动作'),/已经关闭/);
  assert.throws(()=>host.ctx.conversation.input.requestDraftInitialization(binding,{prompt:'旧绑定'}),/仍被保留/);
  host.setSessionProvider(id=>({id,runtime:'dsh'}));assert.notEqual(inputOf(host),a);
});

test('公开命令失败保留原输入，成功清除；取消后的迟到成功不能消费新草稿', async t => {
  const host=bench(t);let fail=true,finish;const calls=[];
  await command(host,async(args,scope)=>{calls.push([args,scope.dshSessionId]);if(args==='waiting')return new Promise(resolve=>finish=resolve);
    return fail?{kind:'error',text:'实际命令失败'}:{kind:'success',text:'实际命令成功'};});
  const a=inputOf(host);a.setDraft('/actual original');a.submit();await until(()=>a.notices.getSnapshot()?.text==='实际命令失败');
  assert.equal(a.state.getSnapshot().draft,'/actual original');assert.equal(a.state.getSnapshot().phase,'claimed');
  fail=false;a.submit();await until(()=>a.state.getSnapshot().draft==='');assert.deepEqual(calls,[['original','a'],['original','a']]);
  a.setDraft('/actual waiting');a.submit();await until(()=>!!finish);assert.equal(a.state.getSnapshot().phase,'submitting');
  host.cancelPublicInput('a');a.setDraft('取消后新输入');finish({kind:'success',text:'不应采用'});await tick();
  assert.equal(a.state.getSnapshot().draft,'取消后新输入');assert.match(a.notices.getSnapshot().text,/已取消/);
});

test('普通公开发送使用原会话及准确模式，失败回填空草稿并保留后来输入，正在提交时初始化被阻止', async t => {
  const pending=[],host=bench(t, input=>new Promise((resolve,reject)=>pending.push({input,resolve,reject}))),a=inputOf(host),b=inputOf(host,'b');
  a.setDraft('第一次');a.submit('queue');await until(()=>pending.length===1);assert.equal(a.state.getSnapshot().draft,'');
  assert.equal(host.ctx.conversation.input.requestDraftInitialization(host.ctx.sessions.binding('a'),{prompt:'不能覆盖在途'}),'blocked');
  a.setDraft('第二次');a.submit('steer');await until(()=>pending.length===2);
  assert.deepEqual(pending.map(row=>[row.input.sessionId,row.input.text,row.input.mode]),[['a','第一次','queue'],['a','第二次','steer']]);
  pending[1].reject(new Error('第二次实际失败'));await until(()=>a.state.getSnapshot().draft==='第二次');
  pending[0].reject(new Error('第一次实际失败'));await until(()=>a.state.getSnapshot().draft==='第一次\n\n第二次');
  a.setDraft('新编辑');a.submit();await until(()=>pending.length===3);a.setDraft('后来输入');
  pending[2].reject(new Error('实际失败'));await until(()=>a.notices.getSnapshot()?.text==='实际失败');
  assert.equal(a.state.getSnapshot().draft,'后来输入');assert.equal(b.state.getSnapshot().draft,'');
  await assert.rejects(host.ctx.conversation.send('没有指定会话'),/会话范围/);
  const scoped=host.ctx.sessions.scope('b').conversation.send('直接公开发送');await until(()=>pending.length===4);
  assert.equal(pending[3].input.sessionId,'b');pending[3].resolve({kind:'success'});await scoped;
});

test('公开引用与原有节点共用身份，模型转换每个真实引用，来源停用不能发送迟到内容', async t => {
  let finish;const sends=[];const host=bench(t,async input=>{sends.push(input);return {kind:'success'};});
  await host.load({name:'public-refs',inject:['inputTriggers'],apply(ctx){ctx.effect(()=>ctx.inputTriggers.registerSource({name:'public-refs',trigger:'@',candidates:async()=>[],onPick:()=>undefined,
    codec:{clipboardText:ref=>ref,serialize:()=>new Promise(resolve=>finish=resolve)}}));}},'public-refs');
  const a=inputOf(host);a.setDraft('前文 ');const editor=host.mountInputEditor('a');
  const span=a.actions.captureInsertion();assert.equal(a.insertReference({source:'public-refs',ref:'opaque',label:'真实引用',clipboardText:'@actual'},span),true);
  assert.equal(editor.projection.occurrences.length,1);a.submit();await until(()=>!!finish);
  await host.unload('public-refs');finish('不能发送的迟到引用');await until(()=>a.notices.getSnapshot()?.level==='error');
  assert.equal(sends.length,0);assert.equal(a.state.getSnapshot().draft,'前文 @actual ');
  assert.equal(editor.projection.occurrences[0].invalid,true);
});

test('官方浏览器草稿注册表实际上传文件，跨会话拒绝借用，失败与重试保留原对象，成功命令消费准确凭据', async t => {
  const host=bench(t), uploads=[],file=new File(['公开文件的实际内容'],'材料.txt',{type:'text/plain'});
  const fileUpload=host.ctx.get('fileUpload');fileUpload.upload=async(id,data,name,signal,progress)=>{uploads.push({id,data,name,signal});progress({loaded:data.size,total:data.size});
    return uploads.length===1?{ok:false,error:{message:'实际失败'}}:{ok:true,value:{receiptId:'actual-upload-receipt',file:{attachmentId:'actual-file',name,bytes:data.size}}};};
  const drafts=host.ctx.conversation.createDrafts('a',[file]),a=inputOf(host),b=inputOf(host,'b');
  assert.equal(a.addAttachments([drafts[0].id]),true);await until(()=>host.conversation.fileUploads.getSnapshot()[drafts[0].id]?.status==='error');
  assert.equal(uploads[0].data,file);assert.equal(await uploads[0].data.text(),'公开文件的实际内容');
  assert.throws(()=>b.addAttachments([drafts[0].id]),/其他会话/);assert.throws(()=>host.conversation.rebindDraftFiles('b',[drafts[0].id]),/其他会话/);
  host.conversation.retryFileUpload('a',drafts[0].id);await until(()=>host.conversation.fileUploads.getSnapshot()[drafts[0].id]?.status==='ready');
  let received;await command(host,async(_args,scope,attachments)=>{received={scope:scope.dshSessionId,attachments};return {kind:'success'};});
  a.setDraft('/actual withfile');a.submit();await until(()=>a.state.getSnapshot().draft==='');
  assert.deepEqual(received,{scope:'a',attachments:[{type:'file',receiptId:'actual-upload-receipt'}]});
  assert.equal(a.state.getSnapshot().attachmentIds.length,0);assert.equal(host.conversation.resolveDraftAttachments([drafts[0].id]).length,0);
});

test('上传并发有限，删除任务取消原上传，迟到结果不复活草稿；宿主关闭释放全部上传对象', async t => {
  const host=bench(t);const running=[];
  host.ctx.get('fileUpload').upload=async(id,file,_name,signal)=>new Promise(resolve=>{running.push({id,file,signal,resolve});signal.addEventListener('abort',()=>resolve({ok:false,error:{message:'取消'}}),{once:true});});
  const rows=host.conversation.createDrafts('a',Array.from({length:5},(_,i)=>new File([String(i)],`${i}.txt`)));
  inputOf(host).addAttachments(rows.map(row=>row.id));await until(()=>running.length===3);
  host.setSessionProvider(id=>id==='b'?{id,runtime:'dsh'}:undefined);await tick();await tick();
  assert.ok(running.every(row=>row.signal.aborted));assert.equal(host.conversation.resolveDraftAttachments(rows.map(row=>row.id)).length,0);
  assert.deepEqual(host.conversation.fileUploads.getSnapshot(),{});
  host.conversation.createDrafts('b',[new File(['remain'],'剩余.txt')]);await until(()=>running.some(row=>row.id==='b'));
  await host.dispose();assert.ok(running.filter(row=>row.id==='b').every(row=>row.signal.aborted));
});

test('阻止输入的理由确实阻止公开发送，解除后恢复，附件不被不接受附件的命令吞掉', async t=>{
  let sent=0;const host=bench(t,async()=>{sent++;return {kind:'success'};}),a=inputOf(host);
  host.conversation.blocks.set('a',{reason:'实际缺少模型设置'});a.setDraft('保留的消息');a.submit();
  await until(()=>a.notices.getSnapshot()?.text==='实际缺少模型设置');assert.equal(sent,0);assert.equal(a.state.getSnapshot().draft,'保留的消息');
  host.conversation.blocks.set('a',undefined);a.submit();await until(()=>sent===1);
  const row=host.conversation.createDrafts('a',[new File(['bytes'],'普通文件')])[0];a.addAttachments([row.id]);
  await command(host,async()=>{sent++;return {kind:'success'};},false);a.setDraft('/actual refused');a.submit();
  await until(()=>a.notices.getSnapshot()?.level==='error');assert.equal(sent,1);assert.equal(a.state.getSnapshot().draft,'/actual refused');
  assert.deepEqual(a.state.getSnapshot().attachmentIds,[row.id]);
});

test('公开队列按准确作用域发送真实编号和操作，接收原队列状态，收敛竞争可结束，其他失败明确拒绝',async t=>{
  const before=globalThis.dyworker;const calls=[],changes=[];let failure;
  const queue={id:'actual-message-id',content:[{type:'text',text:'原队列正文'}],source:{kind:'user',rpcId:'actual-request'}};
  globalThis.dyworker={dshOperation:async request=>{calls.push(request);
    if(request.action==='input-snapshot')return {ok:true,value:{status:'running',inbox:{'next-turn':[queue],'next-step':[]}}};
    if(failure)return {ok:false,error:{code:failure,message:'实际队列错误'}};
    return {ok:true,value:{accepted:true}};
  }};
  t.after(()=>{if(before===undefined)delete globalThis.dyworker;else globalThis.dyworker=before;});
  const host=bench(t),a=inputOf(host);host.subscribeInputQueue(change=>changes.push(change));
  await host.refreshInputInbox('a');assert.deepEqual(a.state.getSnapshot().queue,[queue]);
  const scope=host.ctx.sessions.scope('a');
  await scope.conversation.updateQueue(queue.id,{kind:'edit',content:[{type:'text',text:'真实替换'}]});
  const actual=calls.find(call=>call.action==='input-update-queue');
  assert.deepEqual(actual,{sessionId:'a',action:'input-update-queue',payload:{itemId:queue.id,action:{kind:'edit',content:[{type:'text',text:'真实替换'}]}}});
  assert.deepEqual(changes,[{sessionId:'a',itemId:queue.id,action:{kind:'edit',content:[{type:'text',text:'真实替换'}]}}]);
  failure='session/queue-item-not-found';await scope.conversation.updateQueue(queue.id,{kind:'steer'});
  await assert.rejects(scope.conversation.updateQueue(queue.id,{kind:'remove'}),error=>error.code===failure);
  failure='gateway/internal';await assert.rejects(scope.conversation.updateQueue(queue.id,{kind:'steer'}),error=>error.code===failure);
  failure=undefined;await scope.conversation.cancel();assert.ok(calls.some(call=>call.sessionId==='a'&&call.action==='input-cancel'));
  await assert.rejects(host.ctx.conversation.cancel(),/会话范围/);
  await host.dispose();await tick();
});

test('原生及公开附件共同进入实际命令，失败保留两类附件，成功才消费本次选择',async t=>{
  const host=bench(t);let consume=0,serialize=0,success=false,captured=0;const received=[];
  const native={type:'file',receiptId:'native-owner-receipt'};
  host.setNativeAttachmentProvider(id=>{assert.equal(id,'a');captured++;return {count:1,current:()=>true,serialize:async()=>{serialize++;return[native];},consume:()=>consume++};});
  host.ctx.get('fileUpload').upload=async(_id,file,name)=>({ok:true,value:{receiptId:'public-owner-receipt',file:{attachmentId:'public-owner-file',name,bytes:file.size}}});
  const a=inputOf(host),row=host.conversation.createDrafts('a',[new File(['public'],'public.txt')])[0];a.addAttachments([row.id]);
  await until(()=>host.conversation.fileUploads.getSnapshot()[row.id]?.status==='ready');
  await command(host,async(_text,scope,attachments)=>{received.push({scope:scope.dshSessionId,attachments});return {kind:success?'success':'error',text:success?'已完成':'实际失败'};});
  a.setDraft('/actual mixed');a.submit();await until(()=>a.notices.getSnapshot()?.text==='实际失败');
  assert.equal(consume,0);assert.deepEqual(a.state.getSnapshot().attachmentIds,[row.id]);assert.equal(a.state.getSnapshot().draft,'/actual mixed');
  success=true;a.submit();await until(()=>consume===1&&a.state.getSnapshot().draft==='');
  assert.equal(serialize,2);assert.equal(captured,2);assert.deepEqual(received.map(row=>row.attachments),Array(2).fill([{type:'file',receiptId:'public-owner-receipt'},native]));
  assert.ok(received.every(row=>row.scope==='a'));assert.equal(host.conversation.resolveDraftAttachments([row.id]).length,0);
});

test('不接受附件的命令拒绝原生附件，既不转换也不消费',async t=>{
  const host=bench(t);let submitted=0,serialized=0,consumed=0;
  host.setNativeAttachmentProvider(()=>({count:1,current:()=>true,serialize:async()=>{serialized++;return[{type:'file',receiptId:'native'}];},consume:()=>consumed++}));
  await command(host,async()=>{submitted++;return {kind:'success'};},false);
  const a=inputOf(host);a.setDraft('/actual native');a.submit();await until(()=>a.notices.getSnapshot()?.level==='error');
  assert.match(a.notices.getSnapshot().text,/不接受附件|不接收附件/);assert.equal(submitted,0);assert.equal(serialized,0);assert.equal(consumed,0);assert.equal(a.state.getSnapshot().draft,'/actual native');
});

test('普通公开发送携带两类附件及原引用身份，后来输入不改变这次显示内容',async t=>{
  const sends=[],host=bench(t,async input=>{sends.push(input);return {kind:'success'};});let finish,consumed=0;
  host.setNativeAttachmentProvider(()=>({count:1,current:()=>true,serialize:async()=>[{type:'file',receiptId:'native-real-receipt'}],consume:()=>consumed++}));
  host.ctx.get('fileUpload').upload=async(_id,file,name)=>({ok:true,value:{receiptId:'browser-real-receipt',file:{attachmentId:'browser-real-file',name,bytes:file.size}}});
  await host.load({name:'mixed-ref',inject:['inputTriggers'],apply(ctx){ctx.effect(()=>ctx.inputTriggers.registerSource({name:'mixed-ref',trigger:'@',candidates:async()=>[],onPick:()=>undefined,
    codec:{clipboardText:ref=>ref,serialize:()=>new Promise(resolve=>finish=resolve)}}));}},'mixed-ref');
  const a=inputOf(host),row=host.conversation.createDrafts('a',[new File(['bytes'],'public.txt')])[0];a.addAttachments([row.id]);
  await until(()=>host.conversation.fileUploads.getSnapshot()[row.id]?.status==='ready');
  a.setDraft('读取 ');a.insertReference({source:'mixed-ref',ref:'true-file-ref',label:'原文件引用',clipboardText:'@文件'},a.actions.captureInsertion());
  const before=a.state.getSnapshot();a.submit('steer');await until(()=>!!finish);a.setDraft('后来输入');finish('MODEL_ACTUAL_FILE_CONTENT');
  await until(()=>sends.length===1&&consumed===1);
  assert.deepEqual(sends[0].attachments,[{type:'file',receiptId:'browser-real-receipt'},{type:'file',receiptId:'native-real-receipt'}]);
  assert.equal(sends[0].mode,'steer');assert.match(sends[0].text,/MODEL_ACTUAL_FILE_CONTENT/);assert.equal(sends[0].presentation.text,before.draft);
  assert.equal(sends[0].presentation.references[0].ref,'true-file-ref');assert.equal(sends[0].presentation.references[0].label,'原文件引用');assert.equal(a.state.getSnapshot().draft,'后来输入');
});

test('异步引用准备期间原生附件改变，不能借用后来附件或清空新选择',async t=>{
  let version=0,finish,sent=0,consumed=0,serialized=0;
  const host=bench(t,async()=>{sent++;return {kind:'success'};});
  host.setNativeAttachmentProvider(()=>{const captured=version;return {count:1,current:()=>captured===version,serialize:async()=>{serialized++;return[{type:'file',receiptId:'original'}];},consume:()=>consumed++};});
  await host.load({name:'stale-native-ref',inject:['inputTriggers'],apply(ctx){ctx.effect(()=>ctx.inputTriggers.registerSource({name:'stale-native-ref',trigger:'@',candidates:async()=>[],onPick:()=>undefined,
    codec:{clipboardText:ref=>ref,serialize:()=>new Promise(resolve=>finish=resolve)}}));}},'stale-native-ref');
  const a=inputOf(host);a.setDraft('原要求 ');a.insertReference({source:'stale-native-ref',ref:'opaque',label:'等待引用',clipboardText:'@等待'},a.actions.captureInsertion());
  const before=a.state.getSnapshot().draft;a.submit();await until(()=>!!finish);version++;finish('真正的模型内容');await until(()=>a.notices.getSnapshot()?.level==='error');
  assert.equal(sent,0);assert.equal(serialized,0);assert.equal(consumed,0);assert.equal(a.state.getSnapshot().draft,before);
});

test('原生附件单独通过公开输入发送，取消期间的迟到转换不进入任务',async t=>{
  const sends=[],host=bench(t,async input=>{sends.push(input);return {kind:'success'};});let finish,consumed=0;
  host.setNativeAttachmentProvider(id=>id==='a'?{count:1,current:()=>true,serialize:async()=>new Promise(resolve=>finish=resolve),consume:()=>consumed++}:undefined);
  const a=inputOf(host);a.submit();await until(()=>!!finish);host.cancelPublicInput('a');finish([{type:'file',receiptId:'late-native'}]);await tick();await tick();
  assert.equal(sends.length,0);assert.equal(consumed,0);
  host.setNativeAttachmentProvider(id=>id==='a'?{count:1,current:()=>true,serialize:async()=>[{type:'file',receiptId:'correct-native'}],consume:()=>consumed++}:undefined);
  a.submit();await until(()=>sends.length===1&&consumed===1);assert.equal(sends[0].text,'');assert.equal(sends[0].sessionId,'a');assert.deepEqual(sends[0].attachments,[{type:'file',receiptId:'correct-native'}]);
  inputOf(host,'b').setDraft('另一任务');inputOf(host,'b').submit();await until(()=>sends.length===2);assert.equal(sends[1].attachments.length,0);
});

test('混合命令在原生附件转换期间取消，迟到结果不能调用命令或消费公开附件',async t=>{
  const host=bench(t);let finish,called=0,consumed=0;
  host.setNativeAttachmentProvider(()=>({count:1,current:()=>true,serialize:async()=>new Promise(resolve=>finish=resolve),consume:()=>consumed++}));
  host.ctx.get('fileUpload').upload=async(_id,file,name)=>({ok:true,value:{receiptId:'cancel-public',file:{attachmentId:'cancel-public-file',name,bytes:file.size}}});
  const a=inputOf(host),row=host.conversation.createDrafts('a',[new File(['retain'],'保留.txt')])[0];a.addAttachments([row.id]);
  await until(()=>host.conversation.fileUploads.getSnapshot()[row.id]?.status==='ready');await command(host,async()=>{called++;return {kind:'success'};});
  a.setDraft('/actual cancel-mixed');a.submit();await until(()=>!!finish);host.cancelPublicInput('a');a.setDraft('取消后新输入');finish([{type:'file',receiptId:'cancel-native'}]);await tick();await tick();
  assert.equal(called,0);assert.equal(consumed,0);assert.equal(a.state.getSnapshot().draft,'取消后新输入');assert.deepEqual(a.state.getSnapshot().attachmentIds,[row.id]);
  assert.equal(host.conversation.resolveDraftAttachments([row.id]).length,1);
});
