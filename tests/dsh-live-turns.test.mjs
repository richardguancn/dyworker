import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveDshTurns} from '../electron/host/dsh-runtime/live-turns.mts';
const event=(type,data)=>({type,data,time:Date.now()});
const user=id=>({id,source:{kind:'user'},content:[{type:'text',text:id}]});
const assistant=(id,text)=>({id,content:[{type:'text',text}]});

test('旧请求的迟到文字不覆盖新轮，正文与思考分开，工具步骤提交后也退休临时输出',async()=>{
  const frames=[];const tracker=createLiveDshTurns(async message=>({role:'assistant',content:message.content}),turns=>frames.push(turns));
  const first=user('first');tracker.event(event('user/message',first));
  const retired=tracker.start({messages:[first]});tracker.text(retired,'先收到的文字');
  tracker.event(event('assistant/message',{message:assistant('official-first','正式第一轮')}));
  const second=user('second');tracker.event(event('user/message',second));
  const active=tracker.start({messages:[first,second]});tracker.text(active,'新轮片段');tracker.reasoning(active,'新轮思考');tracker.text(retired,'迟到的旧输出');
  const partial=await tracker.seal();
  assert.equal(partial[0].replies[0].text,'正式第一轮');assert.equal(partial[1].replies[0].text,'新轮片段');
  assert.equal(partial[1].replies[0].reasoning,'新轮思考');assert.equal(partial[1].replies[0].partial,true);
  const toolTracker=createLiveDshTurns(async m=>m,()=>{});toolTracker.event(event('user/message',first));
  const toolRequest=toolTracker.start({messages:[first]});toolTracker.text(toolRequest,'临时工具说明');
  toolTracker.event(event('assistant/message',{message:{id:'official-tool',content:[{type:'tool-call',name:'read_file'}]}}));
  assert.equal((await toolTracker.seal())[0].replies.length,0);
});

test('慢速实际附件解码不会发布过期画面，结束后没有迟到显示，同一正式回复只读取一次',async()=>{
  let release,reads=0;const gate=new Promise(resolve=>release=resolve),frames=[];
  const tracker=createLiveDshTurns(async message=>{reads++;await gate;return {role:'assistant',content:message.content};},turns=>frames.push(turns));
  const first=user('first');tracker.event(event('user/message',first));
  tracker.event(event('assistant/message',{message:assistant('image-message','含实际附件的回复')}));
  await Promise.resolve();
  const second=user('second');tracker.event(event('user/message',second));
  const request=tracker.start({messages:[first,second]});tracker.text(request,'最新片段');
  release();await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(frames.length);assert.ok(frames.every(turns=>turns.length===2));assert.equal(frames.at(-1)[1].replies[0].text,'最新片段');
  const final=await tracker.seal();const count=frames.length;tracker.text(request,'结束后的迟到输出');tracker.event(event('user/message',user('late')));
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(frames.length,count);assert.equal(reads,1);assert.equal(final.length,2);
});
