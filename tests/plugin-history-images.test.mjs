import test from 'node:test';
import assert from 'node:assert/strict';
import {ClientPluginHost} from '../src/pluginRuntime/clientHost.ts';
import {referencedImage} from '../electron/host/dsh-runtime/vendor/referenced-image.mts';

const ref = attachmentId => ({attachmentId,mediaType:'image/png',width:3,height:2});
function bench(t, operation) {
  const sessions=new Map(['a','b'].map(id=>[id,{id,runtime:'dsh'}]));
  const host=new ClientPluginHost({sessionProvider:id=>sessions.get(id)});
  const previous=globalThis.dyworker;globalThis.dyworker={dshOperation:operation};
  t.after(async()=>{await host.dispose();globalThis.dyworker=previous;});
  return {host,sessions,ui:host.ctx.get('uiConversation')};
}
const success=(id,data)=>({ok:true,value:{attachment:ref(id),data:Buffer.from(data).toString('base64')}});

test('原样官方图片缓存读取真实字节，合并在途重复读取；绑定保持身份并读取最新会话',async t=>{
  const calls=[];let finish;const wait=new Promise(resolve=>{finish=resolve;});
  const {host,sessions,ui}=bench(t,async input=>{calls.push(input);return wait;});
  const binding=host.ctx.sessions.binding('a');assert.equal(binding.session.id,'a');assert.equal(host.ctx.sessions.scopeOf(binding.ctx),'a');
  const first=ui.imageUrl('a',ref('image-one')),second=ui.imageUrl('a',ref('image-one'));
  assert.equal(first,second);assert.equal(calls.length,1);
  finish(success('image-one','实际存储字节'));const url=await first;
  assert.equal(await (await fetch(url)).text(),'实际存储字节');assert.equal(ui.peekImageUrl('a',ref('image-one')),url);
  assert.deepEqual(calls,[{sessionId:'a',action:'session-image',payload:{targetSessionId:'a',attachmentId:'image-one'}}]);
  sessions.set('a',{id:'a',runtime:'dsh',title:'更新后的标题'});host.setSessionProvider(id=>sessions.get(id));
  assert.equal(host.ctx.sessions.binding('a'),binding);assert.equal(binding.session.title,'更新后的标题');
  assert.equal(await ui.imageUrl('a',ref('image-one')),url);assert.equal(calls.length,1);
});

test('失败不缓存空图片，可重试；同编号在另一个任务独立读取，未知任务不请求',async t=>{
  let attempts=0;const calls=[];
  const {ui}=bench(t,async input=>{calls.push(input);if(attempts++===0)return {ok:false,error:{code:'session/attachment-invalid',message:'不属于此任务'}};return success(input.payload.attachmentId,input.sessionId);});
  await assert.rejects(ui.imageUrl('a',ref('same')),/不属于此任务/);assert.equal(ui.peekImageUrl('a',ref('same')),undefined);
  const a=await ui.imageUrl('a',ref('same')),b=await ui.imageUrl('b',ref('same'));assert.notEqual(a,b);
  assert.equal(await (await fetch(a)).text(),'a');assert.equal(await (await fetch(b)).text(),'b');
  await assert.rejects(ui.imageUrl('unknown',ref('same')),/unknown session/);assert.equal(calls.length,3);
});

test('任务关闭撤销图片，迟到结果不能进入重新建立的同名任务；其他任务继续可用',async t=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});let late=0;
  const {host,sessions,ui}=bench(t,async input=>input.payload.attachmentId==='late'&&late++===0?pending:success(input.payload.attachmentId,input.sessionId));
  const binding=host.ctx.sessions.binding('a');const a=await ui.imageUrl('a',ref('ready')),b=await ui.imageUrl('b',ref('ready'));
  const old=ui.imageUrl('a',ref('late'));const rejected=assert.rejects(old,/关闭|released/);
  sessions.delete('a');host.setSessionProvider(id=>sessions.get(id));
  await binding.ctx.fiber.dispose();
  await assert.rejects(fetch(a));assert.equal(await (await fetch(b)).text(),'b');
  sessions.set('a',{id:'a',runtime:'dsh'});host.setSessionProvider(id=>sessions.get(id));
  assert.notEqual(host.ctx.sessions.binding('a'),binding);
  finish(success('late','旧读取'));await rejected;
  const current=await ui.imageUrl('a',ref('late'));assert.equal(await (await fetch(current)).text(),'a');
  const stale=await binding.session.readAttachment('ready');assert.equal(stale.ok,false);assert.match(stale.error.message,/关闭/);
});

test('官方预览采用与替换：成功读取实际图片后撤销预览，失败撤销并允许重试',async t=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});let failed=0;
  const {ui}=bench(t,async input=>input.payload.attachmentId==='preview'?pending:failed++===0?{ok:false,error:{code:'missing',message:'读取失败'}}:success('retry','重试实际图片'));
  const preview=URL.createObjectURL(new Blob(['上传预览']));
  assert.equal(ui.seedImageUrl('a',ref('preview'),preview),true);assert.equal(ui.peekImageUrl('a',ref('preview')),preview);
  assert.equal(ui.seedImageUrl('a',ref('preview'),preview),false);
  finish(success('preview','实际图片'));const actual=await ui.imageUrl('a',ref('preview'));
  await assert.rejects(fetch(preview));assert.equal(await (await fetch(actual)).text(),'实际图片');
  const refused=URL.createObjectURL(new Blob(['失败预览']));assert.equal(ui.seedImageUrl('a',ref('retry'),refused),true);
  await assert.rejects(ui.imageUrl('a',ref('retry')),/读取失败/);await assert.rejects(fetch(refused));
  assert.equal(ui.peekImageUrl('a',ref('retry')),undefined);const retried=await ui.imageUrl('a',ref('retry'));assert.equal(await (await fetch(retried)).text(),'重试实际图片');
});

test('子任务图片经根任务和确切子任务读取，删除根任务同时撤销子任务图片',async t=>{
  const calls=[];const {host,sessions,ui}=bench(t,async input=>{calls.push(input);return input.action==='family'?{ok:true,value:{byId:{child:{id:'child',rootSessionId:'a',parentId:'a'}}}}:success('child-image','实际子任务图片');});
  host.setCollections(()=>({items:[...sessions.values()],current:sessions.get('a')}),()=>({items:[],current:null}));
  await host.refreshSubagents('a');const binding=host.ctx.sessions.binding('child');assert.ok(binding);
  const url=await ui.imageUrl('child',ref('child-image'));assert.equal(await (await fetch(url)).text(),'实际子任务图片');
  assert.deepEqual(calls.at(-1),{sessionId:'a',action:'session-image',payload:{targetSessionId:'child',attachmentId:'child-image'}});
  sessions.delete('a');host.setCollections(()=>({items:[...sessions.values()],current:sessions.get('b')}),()=>({items:[],current:null}));
  assert.equal(host.ctx.sessions.binding('child'),undefined);await binding.ctx.fiber.dispose();await assert.rejects(fetch(url));
});

test('官方图片查找只识别声明的事件内容与已结束图片块，未知事件和文本内编号不授权',()=>{
  const image={type:'image',attachment:ref('actual')};
  for(const event of [
    {type:'user/message',data:{content:[image]}},
    {type:'tool/result',data:{message:{content:[image]}}},
    {type:'agent/inbox/spliced',data:{inserted:[{content:[image]}]}},
    {type:'compaction/summary',data:{rawOutput:[image]}},
    {type:'assistant/attempt',data:{stream:[{type:'chunk',time:1,chunk:{type:'block-end',index:0,block:image}}]}},
  ]) assert.deepEqual(referencedImage([event],'actual'),image.attachment);
  assert.equal(referencedImage([{type:'plugin/unknown',data:{content:[image]}},{type:'user/message',data:{content:[{type:'text',text:JSON.stringify(image)}]}}],'actual'),undefined);
  assert.equal(referencedImage([{type:'user/message',data:{content:[image]}}],'other'),undefined);
});
