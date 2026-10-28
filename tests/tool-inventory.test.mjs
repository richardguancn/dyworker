import test from 'node:test';
import assert from 'node:assert/strict';
import { toolInventory } from '../electron/agent/tool-inventory.mts';
import { createDshTrace } from '../electron/host/dsh-runtime/trace.mts';

test('请求明细按工具服务归类，不记录参数定义', () => {
 const definitions=[{type:'function',function:{name:'mcp__abc-123__lookup',description:'【MCP:示例】查找',parameters:{secret:'not-recorded'}}},{type:'function',function:{name:'read_file'}}];
 const groups=toolInventory(definitions);
 assert.deepEqual(groups,[{name:'工具服务：示例',tools:['lookup']},{name:'其他工具',tools:['read_file']}]);
 assert.ok(!JSON.stringify(groups).includes('not-recorded'));
 const events=[]; const trace=createDshTrace('root', event=>events.push(event));
 trace.request('root',{messages:[{role:'system',content:'系统'},{role:'user',content:'你好'}],tools:definitions});
 const context=events[0].trace.context;
 assert.deepEqual(context.toolGroups,groups); assert.equal(context.tools,2); assert.ok(context.toolsTokens>0); assert.ok(context.systemTokens>0);
});
