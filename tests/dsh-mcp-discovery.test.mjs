import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OfficialDshSession } from '../electron/host/dsh-runtime/full-session.mts';

test('DSH 实际运行按需查找工具，审批后执行，并在下一次任务重新收起', { timeout: 30000 }, async t => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-dsh-discovery-'));
 const workspace = path.join(dir, 'work'), profile = path.join(dir, 'profile'), data = path.join(dir, 'data');
 await Promise.all([fs.mkdir(workspace), fs.mkdir(profile), fs.mkdir(data)]);
 const extraTools = Array.from({length:25}, (_, i) => ({name:`mcp__sample__tool_${i}`, description:`【MCP:示例服务】工具 ${i}`,
  parameters:{type:'object', properties:{value:{type:'string'}}, required:['value']}}));
 const requests=[], approvals=[], calls=[];
 let stage=0;
 const runtime = new OfficialDshSession({profileDir:profile,dataDir:data,workspacePath:workspace,sessionId:'mcp-lazy',plugins:[],extraTools,
  approve:async tool=>{approvals.push(tool.name);return true;},
  onExtraTool:async(name,args)=>{calls.push({name,args});return {ok:true,result:'执行成功'};},
  async *generate(request){
   requests.push(request.tools.map(tool=>tool.name));
   let block;
   if(stage++===0) block={type:'tool-call',id:'find',name:'discover_mcp_tools',arguments:JSON.stringify({query:'tool_17'})};
   else if(stage===2) block={type:'tool-call',id:'invoke',name:'mcp__sample__tool_17',arguments:JSON.stringify({value:'输入'})};
   else block={type:'text',text:'完成'};
   yield {type:'block-start',index:0,blockType:block.type};
   yield block.type==='tool-call'?{type:'tool-call-delta',index:0,id:block.id,name:block.name,argumentsDelta:block.arguments}:{type:'text-delta',index:0,text:block.text};
   yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:block.type==='tool-call'?'tool-calls':'stop'}};
  }});
 t.after(async () => { await runtime.close(); await fs.rm(dir, {recursive:true, force:true}); });
 await runtime.start();
 const first=await runtime.request('prompt',{text:'使用示例工具'});
 assert.ok(first.events.some(event=>event.type==='tool/result' && JSON.stringify(event).includes('执行成功')));
 assert.ok(requests[0].includes('discover_mcp_tools'));
 assert.ok(!requests[0].includes('mcp__sample__tool_17'));
 assert.ok(requests[1].includes('mcp__sample__tool_17'));
 assert.equal(requests[1].filter(name=>name.startsWith('mcp__sample__')).length,1);
 assert.ok(approvals.includes('mcp__sample__tool_17'));
 assert.deepEqual(calls,[{name:'mcp__sample__tool_17',args:{value:'输入'}}]);
 const prior=requests.length;
 await runtime.request('prompt',{text:'第二次任务'});
 assert.ok(!requests[prior].includes('mcp__sample__tool_17'));
});
