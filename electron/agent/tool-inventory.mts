// 只记录实际发送的工具名及归属，不记录工具参数或连接信息。
export function toolInventory(tools: any[]) {
  const groups = new Map<string, string[]>();
  for (const item of tools || []) {
    const tool = item?.function || item;
    const name = String(tool?.name || '');
    if (!name) continue;
    const service = /^【MCP:([^】]+)】/.exec(String(tool.description || ''))?.[1];
    const group = service ? `工具服务：${service}` : name.startsWith('mcp__computer-use__') ? '本机操作' : name.startsWith('plugin__') ? '插件工具' : '其他工具';
    const display = name.startsWith('mcp__') ? name.replace(/^mcp__[^_]+__/, '') : name;
    const values = groups.get(group) || []; values.push(display); groups.set(group, values);
  }
  return [...groups].map(([name, tools]) => ({name, tools}));
}
