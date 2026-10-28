// 大型 MCP 工具集先提供检索入口；选中的工具仍使用原名和原审批流程。
export function prepareMcpDiscovery(extraTools: any[]) {
  const deferred = extraTools.filter(tool => {
    const name = String(tool?.function?.name || '');
    return name.startsWith('mcp__') && !name.startsWith('mcp__computer-use__');
  });
  if (deferred.length < 20) return { initial: extraTools, deferred: [] as any[] };
  const services = [...new Set(deferred.map(tool => /^【MCP:([^】]+)】/.exec(tool.function.description || '')?.[1]).filter(Boolean))];
  const discovery = { type: 'function', function: {
    name: 'discover_mcp_tools',
    description: `查找并加载已启用工具服务中的具体工具。需要使用以下服务时先调用：${services.join('、')}。用英文工具名称或用途关键词搜索；可用空关键词列出并分页。`,
    parameters: { type: 'object', properties: {
      query: { type: 'string', description: '工具名称、服务名称或用途关键词；空字符串列出全部' },
      offset: { type: 'integer', description: '从第几个匹配结果开始，默认 0' },
    }, required: ['query'] },
  } };
  const hidden = new Set(deferred);
  return { initial: [...extraTools.filter(tool => !hidden.has(tool)), discovery], deferred };
}

export function discoverMcpTools(deferred: any[], query: string, offset: number) {
  const words = String(query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = deferred.filter(tool => {
    const value = `${tool.function.name} ${tool.function.description || ''}`.toLocaleLowerCase();
    return words.every(word => value.includes(word));
  });
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  return { tools: matches.slice(start, start + 8), total: matches.length, offset: start };
}
