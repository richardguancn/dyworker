import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMcpDiscovery, discoverMcpTools } from '../electron/host/mcp-discovery.mts';

const tools = Array.from({length: 25}, (_, i) => ({type:'function', function:{name:`mcp__sample__tool_${i}`, description:`【MCP:示例】工具 ${i}`, parameters:{type:'object'}}}));
test('大型工具集支持检索、分页，系统操作工具保持可用', () => {
 const computer = {type:'function', function:{name:'mcp__computer-use__get_app_state'}};
 const prepared = prepareMcpDiscovery([...tools, computer]);
 assert.equal(prepared.deferred.length, 25);
 assert.ok(prepared.initial.includes(computer));
 assert.equal(discoverMcpTools(prepared.deferred, 'tool_17', 0).tools[0].function.name, 'mcp__sample__tool_17');
 assert.equal(discoverMcpTools(prepared.deferred, '', 8).tools.length, 8);
 assert.equal(discoverMcpTools(prepared.deferred, '不存在', 0).total, 0);
 assert.equal(prepareMcpDiscovery(tools.slice(0, 2)).deferred.length, 0);
});
