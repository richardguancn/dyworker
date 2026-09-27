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


test('批量上传：一次工具真实返回四篇成功应放行',()=>{const r=verifyTaskEvidence({finalText:'四篇全部上传成功。',executedTools:[{name:'upload_drafts',status:'success',result:JSON.stringify({success:true,count:4,articles:[{media_id:'real1'},{media_id:'real2'},{media_id:'real3'},{media_id:'real4'}]})}]});assert.equal(r.verified,true);});
test('仅打印上传字样不能冒充上传',async t=>{const{result}=await run(t,{user:'上传文章',messages:[message(null,[tool('run_command',{command:"printf 'upload success'"})]),message('已上传成功。')]});assert.notEqual(result.status,'done');});
test('根目录文件不能用子目录同名文件代替',async t=>{const{result,dir}=await run(t,{user:'在工作区根目录创建 result.txt',messages:[message(null,[tool('write_file',{path:'sub/result.txt',content:'test'})]),message('已创建 result.txt')]});assert.deepEqual(await readdir(dir),['sub']);assert.notEqual(result.status,'done');});
test('只打印重定向文本不能证明重写旧文件',async t=>{const{result,dir}=await run(t,{user:'重写 result.txt 为新内容',files:{'result.txt':'旧内容'},messages:[message(null,[tool('run_command',{command:"printf '> result.txt'"})]),message('已写入 result.txt')]});assert.equal(await readFile(path.join(dir,'result.txt'),'utf8'),'旧内容');assert.notEqual(result.status,'done');});
test('文件混合说明：未生成B不能掩盖虚报A',()=>assert.equal(verifyTaskEvidence({finalText:'已生成 a.txt，尚未生成 b.txt。'}).verified,false));
test('正常提及文件不是写入声明',()=>assert.equal(verifyTaskEvidence({finalText:'文件 notes.txt 的用途是记录笔记。'}).verified,true));
test('连接词：未上传B不能掩盖虚报A',()=>assert.equal(verifyTaskEvidence({finalText:'A已上传但B尚未上传。'}).verified,false));
