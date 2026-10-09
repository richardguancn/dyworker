import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleDshTurns} from '../electron/host/dsh-runtime/visible-turns.mts';
import {reconcileDshTurns,patchDshAssistant} from '../src/dshTurns.ts';
import {assistantImageAttachments} from '../src/assistantImages.ts';

const time='2026-10-07T08:00:00.000Z';
const reply=(id,text,content=text)=>({id,text,createdAt:time,executedMessages:[{role:'assistant',content}]});
const turns=[{user:{id:'official-initial',text:'实际资料',createdAt:time},replies:[reply('a1','第一次回复')]},
  {user:{id:'queued-user',text:'修改后的补充',createdAt:time},replies:[reply('a2','第二次回复'),reply('a3','第二次的后续说明')]}];
const options={userId:'native-initial',assistantId:'placeholder',runId:'run'};
const messages=()=>[{id:'history',role:'assistant',content:'旧记录',createdAt:time},
  {id:'native-initial',role:'user',content:'实际资料',createdAt:time,pluginReferences:[{ref:'opaque'}],displayContent:'@资料'},
  {id:'queued-user',role:'user',content:'修改后的补充',createdAt:time,dshAttachments:[{type:'file',receiptId:'real-receipt'}]},
  {id:'placeholder',role:'assistant',content:'被流式覆盖的最后回复',createdAt:time,runId:'run',taskStatus:'done',activities:[{id:'tool'}]},
  {id:'still-pending',role:'user',content:'尚未进入真实记录的排队消息',createdAt:time}];

test('按实际要求排列各轮回复，保留旧历史、引用、附件和未执行队列，重复收尾不增加消息',()=>{
  const actual=reconcileDshTurns(messages(),turns,options);
  assert.deepEqual(actual.map(m=>m.content),['旧记录','实际资料','第一次回复','修改后的补充','第二次回复\n\n第二次的后续说明','尚未进入真实记录的排队消息']);
  assert.equal(actual[1].pluginReferences[0].ref,'opaque');assert.equal(actual[1].displayContent,'@资料');
  assert.equal(actual[3].dshAttachments[0].receiptId,'real-receipt');
  assert.equal(actual[2].activities,undefined);assert.equal(actual[4].activities[0].id,'tool');
  assert.deepEqual(reconcileDshTurns(actual,turns,options),actual);
});

test('图片只归到实际回复的那一轮，后续回复不重复展示前一轮图片',()=>{
  const image=reply('image','图前文字',[{type:'text',text:'图前文字'},{type:'image_url',image_url:{url:'data:image/png;base64,YQ=='}}]);
  const value=reconcileDshTurns(messages(),[{...turns[0],replies:[image]},turns[1]],options);
  const assistants=value.filter(m=>m.role==='assistant'&&m.runId==='run');
  assert.deepEqual(assistants.map(m=>assistantImageAttachments(m).length),[1,0]);
  assert.equal(assistants[0].content,'图前文字');
});

test('真实注入说明与空工具步骤不增加用户回合，多个要求仍保留官方次序',async()=>{
  const event=(type,data,seq)=>({type,data,seq,time:Date.parse(time)+seq});
  const actual=await visibleDshTurns([
    event('user/message',{id:'context',source:{kind:'dyworker-context'},content:[{type:'text',text:'运行说明'}]},0),
    event('user/message',{id:'u1',source:{kind:'user'},content:[{type:'text',text:'要求一'}]},1),
    event('assistant/message',{message:{id:'tool-step',content:[{type:'tool-call',name:'read_file'}]}},2),
    event('user/message',{id:'u2',source:{kind:'user'},content:[{type:'text',text:'即时补充'}]},3),
    event('assistant/message',{message:{id:'answer',content:[{type:'text',text:'实际回复'}]}},4),
  ],async m=>({role:'assistant',content:m.content}));
  assert.equal(actual.length,2);assert.equal(actual[0].replies.length,0);
  assert.equal(actual[1].user.id,'u2');assert.equal(actual[1].replies[0].id,'answer');
});

test('收尾显示多轮回复时仍保留系统核验失败的说明，缺少对应任务则不动其他历史',()=>{
  const source=messages();source[3]={...source[3],taskStatus:'unverified',content:'第二次的后续说明\n\n> 系统核验提示：产物未核实'};
  const actual=reconcileDshTurns(source,turns,options);
  assert.match(actual[4].content,/系统核验提示：产物未核实/);assert.equal(actual[4].taskStatus,'unverified');
  assert.deepEqual(reconcileDshTurns(actual,turns,options),actual);
  assert.equal(reconcileDshTurns(source,turns,{...options,userId:'other-root'}),source);
});

test('真实下一轮尚无回复时保留独立占位，部分输出转为正式回复不重复，旧轮活动不串到新轮',()=>{
  const first=[turns[0]];
  let current=reconcileDshTurns(messages(),first,{...options,live:true});
  current[2]={...current[2],activities:[{id:'first-tool'}]};
  const awaiting=[turns[0],{...turns[1],replies:[]}];
  current=reconcileDshTurns(current,awaiting,{...options,live:true});
  assert.equal(current[2].content,'第一次回复');assert.equal(current[2].activities[0].id,'first-tool');
  assert.equal(current[4].content,'');assert.equal(current[4].activities,undefined);
  const stable=current[4].id;
  current=reconcileDshTurns(current,[turns[0],{...turns[1],replies:[{...reply('temporary','第二轮片段'),partial:true,reasoning:'独立思考'}]}],{...options,live:true});
  assert.equal(current[4].id,stable);assert.equal(current[4].dshMessageId,undefined);assert.equal(current[4].reasoning,'独立思考');
  current=reconcileDshTurns(current,turns,{...options,live:true});
  assert.equal(current[4].id,stable);assert.equal(current[4].dshMessageId,'a2');assert.equal(current.filter(m=>m.role==='assistant'&&m.runId==='run').length,2);
});

test('停止时保存最后一轮片段和停止说明，未正式提交的回复没有官方消息编号，重放不重复',()=>{
  const partial=[turns[0],{...turns[1],replies:[{...reply('temporary','尚未写完'),partial:true}]}];
  let current=reconcileDshTurns(messages(),partial,{...options,live:true});
  current[4]={...current[4],content:'尚未写完\n\n已按你的要求停止。',taskStatus:'cancelled'};
  const saved=reconcileDshTurns(current,partial,options);
  assert.equal(saved[2].content,'第一次回复');assert.equal(saved[4].content,'尚未写完\n\n已按你的要求停止。');
  assert.equal(saved[4].dshMessageId,undefined);assert.equal(saved[4].dshStreaming,false);
  assert.deepEqual(reconcileDshTurns(saved,partial,options),saved);
});


test('实际停止与进度更新落到当前用户回合，前一轮以及别的运行不被覆盖',()=>{
  let current=reconcileDshTurns(messages(),turns,{...options,live:true});
  current.push({id:'foreign',role:'assistant',runId:'other-run',dshTurnId:turns[1].user.id,content:'另一任务'});
  current=patchDshAssistant(current,{...options,turnId:turns[1].user.id},message=>({...message,content:'第二次的后续说明\n\n已按你的要求停止。',taskStatus:'cancelled'}));
  const final=reconcileDshTurns(current,turns,options);
  assert.equal(final[2].content,'第一次回复');assert.equal(final[2].taskStatus,'done');
  assert.equal(final[4].content,'第二次回复\n\n第二次的后续说明\n\n已按你的要求停止。');assert.equal(final[4].taskStatus,'cancelled');
  assert.equal(final.at(-1).content,'另一任务');assert.deepEqual(reconcileDshTurns(final,turns,options),final);
});


test('停止留下的队列先执行时不覆盖新提交的要求，旧附件归原队列，新要求等待再进入实际记录',()=>{
  const native=[{id:'previous-answer',role:'assistant',content:'上次任务已停止'},
    {id:'kept-queue',role:'user',content:'上次保留的要求',dshAttachments:[{type:'file',receiptId:'kept-file'}]},
    {id:'native-new',role:'user',content:'本次新要求',displayContent:'本次新要求'},
    {id:'new-placeholder',role:'assistant',runId:'new-run',content:''}];
  const nextOptions={userId:'native-new',assistantId:'new-placeholder',runId:'new-run',live:true};
  const kept={user:{id:'kept-queue',text:'上次保留的要求',createdAt:time},replies:[reply('kept-answer','先回答保留要求')]};
  let current=reconcileDshTurns(native,[kept],nextOptions);
  assert.deepEqual(current.map(m=>m.content),['上次任务已停止','上次保留的要求','先回答保留要求','本次新要求']);
  const fresh={user:{id:'official-new',text:'本次新要求',createdAt:time},replies:[reply('new-answer','再回答新要求')]};
  current=reconcileDshTurns(current,[kept,fresh],nextOptions);
  assert.deepEqual(current.map(m=>m.content),['上次任务已停止','上次保留的要求','先回答保留要求','本次新要求','再回答新要求']);
  assert.equal(current[1].dshAttachments[0].receiptId,'kept-file');assert.equal(current[3].id,'native-new');assert.equal(current[3].displayContent,'本次新要求');
  assert.deepEqual(reconcileDshTurns(current,[kept,fresh],nextOptions),current);
});
