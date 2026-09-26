import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {verifyTaskEvidence,requestModel,runAgent} from '../../../electron/agent.mjs';
const settings={endpoint:'https://api.kimi.com/coding/v1/chat/completions',model:'k3',apiKey:'synthetic-only'};
const tool=(name,args,id='call-test')=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const message=(content,tools)=>({role:'assistant',content,...(tools?{tool_calls:tools}:{})});
const json=m=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({choices:[{message:m,finish_reason:m.tool_calls?'tool_calls':'stop'}]})});
async function run(t,{user,messages,files={}}){
 const dir=await mkdtemp(path.join(os.tmpdir(),'k3-acceptance-case-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const [name,value]of Object.entries(files))await writeFile(path.join(dir,name),value);
 let index=0;const requests=[];const events=[];
 const result=await runAgent({settings,workspacePath:dir,conversation:[{role:'user',content:user}],approvalMode:'full-access',emit:e=>events.push(e),fetchImpl:async(_url,opt)=>{requests.push(JSON.parse(opt.body));assert.ok(index<messages.length,'模型不应出现额外循环');return json(messages[index++]);}});
 return{result,requests,events,dir};
}
test('普通说明：尚未上传，不应被判虚报',async t=>{
 const {result}=await run(t,{user:'只写提纲，先不上传',messages:[message('已起草，尚未执行上传。')]});assert.equal(result.status,'done');
});
test('无操作：声称已创建指定文件，必须拦截',async t=>{
 const {result,dir}=await run(t,{user:'创建 result.txt，写入验收',messages:[message('已创建 result.txt 并检查通过。')]});assert.deepEqual(await readdir(dir),[]);assert.notEqual(result.status,'done');
});
test('只读命令：读取旧上传日志，不能证明本次上传',async t=>{
 const {result}=await run(t,{user:'请上传本次新文章',files:{'upload.log':'旧草稿编号：OLD-DRAFT-1234'},messages:[message(null,[tool('run_command',{command:'cat upload.log'})]),message('新文章已上传，草稿编号：OLD-DRAFT-1234')]});assert.notEqual(result.status,'done');
});
test('部分上传成功：不能宣称所有文章均上传',()=>{
 const c=verifyTaskEvidence({finalText:'四篇全部上传成功。',executedTools:[{name:'upload_draft',status:'success',result:'{"media_id":"first-one"}'},{name:'upload_draft',status:'error',result:'失败：上传拒绝'}]});assert.equal(c.verified,false);
});
test('表格编号：凭空填写的草稿ID必须拦截',()=>{
 const c=verifyTaskEvidence({finalText:'已上传。\n| 篇目 | 草稿 ID |\n|---|---|\n| 新文章 | FAKE-DRAFT-1234 |',executedTools:[{name:'upload_draft',status:'success',result:'{"media_id":"REAL-DRAFT-5678"}'}]});assert.equal(c.verified,false);
});
test('明确交付：计划尚未执行，不能报完成',async t=>{
 const {result}=await run(t,{user:'创建 result.txt 并验证',messages:[message(null,[tool('update_plan',{steps:[{title:'创建文件',status:'pending'}]})]),message(null,[tool('finish_task',{summary:'好了，请查收。',evidence:'已检查。',completed:true})])]});assert.notEqual(result.status,'done');
});
test('其他文件写入成功不能证明目标文件已写入',async t=>{
 const {result,dir}=await run(t,{user:'创建 target.txt',messages:[message(null,[tool('write_file',{path:'other.txt',content:'无关文件'})]),message('已创建文件 target.txt。')]});assert.deepEqual(await readdir(dir),['other.txt']);assert.notEqual(result.status,'done');
});
test('真实命令写入文件：不能一律判定没有写入',async t=>{
 const {result,dir}=await run(t,{user:'写入 result.txt',messages:[message(null,[tool('run_command',{command:"printf 'ok' > result.txt"})]),message('已创建文件 result.txt。')]});assert.equal(await readFile(path.join(dir,'result.txt'),'utf8'),'ok');assert.equal(result.status,'done');
});
test('审核拒绝：服务端回显短凭据也必须脱敏',async()=>{
 let count=0;const marker='TEST_SECRET_42';
 await assert.rejects(requestModel({settings,messages:[],tools:false,fetchImpl:async()=>{count++;return{ok:false,status:400,text:async()=>JSON.stringify({error:{type:'content_filter',message:`blocked; api_key=${marker}`}})}}}),e=>{assert.equal(count,1);assert.equal(e.message.includes(marker),false);return true;});
});
test('正向：普通聊天正常结束',async t=>{
 const{result}=await run(t,{user:'你好',messages:[message('你好，有什么需要帮助？')]});assert.equal(result.status,'done');
});
test('正向：同轮工具执行后保留K3思考',async t=>{
 const first={...message(null,[tool('get_datetime',{})]),reasoning_content:'SYNTHETIC_STEP_1'};
 const{result,requests}=await run(t,{user:'查询时间',messages:[first,message('时间已查询。')]});assert.equal(result.status,'done');assert.equal(requests[1].messages.find(m=>m.tool_calls)?.reasoning_content,'SYNTHETIC_STEP_1');
});
test('正向：流式思考字段保留',async()=>{
 const encoder=new TextEncoder();const r=await requestModel({settings,messages:[],tools:false,fetchImpl:async()=>({ok:true,headers:{get:()=> 'text/event-stream'},body:new ReadableStream({start(c){c.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'SYNTHETIC_REASONING',content:'答案'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));c.close();}})})});assert.equal(r.reasoning_content,'SYNTHETIC_REASONING');
});
test('正向：未完成计划保持原状态',async t=>{
 const{result}=await run(t,{user:'制定计划',messages:[message(null,[tool('update_plan',{steps:[{title:'开始',status:'in_progress'},{title:'核对',status:'pending'}]})]),message('计划已列出。')]});assert.deepEqual(result.plan.map(s=>s.status),['in_progress','pending']);
});
