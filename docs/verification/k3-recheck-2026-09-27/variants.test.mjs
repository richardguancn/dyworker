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

test('混合陈述：未上传B不能掩盖虚报A',()=>assert.equal(verifyTaskEvidence({finalText:'A已上传，B尚未上传。'}).verified,false));
test('只读工具：查询草稿不能当上传',()=>assert.equal(verifyTaskEvidence({finalText:'已上传，草稿编号：OLD12345',executedTools:[{name:'wechat_get_draft',isReadOnly:true,status:'success',result:'OLD12345'}]}).verified,false));
test('数量：仅上传一篇不能声明四篇全部成功',()=>assert.equal(verifyTaskEvidence({finalText:'四篇全部上传成功。',executedTools:[{name:'upload_draft',status:'success',result:'{"media_id":"REAL1234"}'}]}).verified,false));
test('目录：同名文件不能冒充另一目录',()=>assert.equal(verifyTaskEvidence({finalText:'已创建 a/result.txt',executedTools:[{name:'write_file',status:'success',args:{path:'b/result.txt'}}]}).verified,false));
test('旧文件：查询时间不能证明本次写入',async t=>{const{result}=await run(t,{user:'重写 result.txt 为新内容',files:{'result.txt':'旧内容'},messages:[message(null,[tool('run_command',{command:'date'})]),message('已写入 result.txt')]});assert.notEqual(result.status,'done');});
test('中文文件名：无操作不能声明已生成',async t=>{const{result}=await run(t,{user:'生成 报告.txt',messages:[message('已生成 报告.txt')]});assert.notEqual(result.status,'done');});
test('JSON敏感字段：短值必须脱敏',async()=>{await assert.rejects(requestModel({settings,messages:[],tools:false,fetchImpl:async()=>({ok:false,status:400,text:async()=>JSON.stringify({error:{type:'content_filter',api_key:'SHORTKEY42'}})})}),e=>{assert.equal(e.message.includes('SHORTKEY42'),false);return true;});});
test('跨轮正向：保存再恢复工具记录',async t=>{const{result}=await run(t,{user:'查询时间',messages:[{...message(null,[tool('get_datetime',{})]),reasoning_content:'THINK123'},message('时间已查询')]});const restored=JSON.parse(JSON.stringify(result.executedMessages));let req;await runAgent({settings,conversation:[{role:'user',content:'查时间'},{role:'assistant',content:result.finalText,executedMessages:restored},{role:'user',content:'继续'}],fetchImpl:async(u,o)=>{req=JSON.parse(o.body);return json(message('好的'));}});assert.equal(req.messages.filter(m=>m.role==='tool').length,1);assert.equal(req.messages.find(m=>m.tool_calls)?.reasoning_content,'THINK123');});
test('后台续接：存档重建不能丢弃操作链',async()=>{const s=await readFile(new URL('../../../electron/main.mjs',import.meta.url),'utf8');const start=s.indexOf('async function visibleConversationForSession(');const end=s.indexOf('\nasync function workingContextForSession(',start);assert.ok(start>0&&end>start);const fn=new Function('readAllSessions',s.slice(start,end)+';return visibleConversationForSession;')(async()=>[{id:'test',messages:[{role:'assistant',content:'已查时间',executedMessages:[{role:'assistant',content:'',reasoning_content:'THINK123',tool_calls:[tool('get_datetime',{})]},{role:'tool',tool_call_id:'call-test',content:'时间结果'}]}]}]);const r=await fn('test','','');assert.ok(r.some(m=>m.executedMessages?.length||m.tool_calls),'后台重建后必须保留完整工具链');});
