/** 只沿根任务的官方子任务目录读取，冷历史不恢复模型执行资格。 */
const SUMMARY_KEYS = ['title', 'contextTimeline', 'contextHeaders', 'contextActivity', 'contextPressure',
  'contextBreakdown', 'tokenUsage', 'subagent', 'subagentTiming', 'subagentCatalog'];

export async function readSessionFamily(ctx: any, rootId: string, signal: AbortSignal, childId?: string) {
  const byId: Record<string, any> = {};
  const queue = [{ id: rootId, parentId: undefined as string | undefined, label: undefined as string | undefined }];
  let selected: any;
  for (let index = 0; index < queue.length; index++) {
    signal.throwIfAborted();
    const item = queue[index];
    if (byId[item.id]) throw new Error('子任务目录存在重复归属或循环');
    const observed = await ctx.sessionQuery.observeSession(item.id, { signal });
    try {
      if (item.parentId && observed.header.parentSession !== item.parentId)
        throw new Error('子任务存档不属于目录中声明的父任务');
      const values = observed.projections?.values || {};
      const title = typeof values.title === 'string' && values.title ? values.title : undefined;
      const prompt = observed.events.find((event: any) => event.type === 'user/message' && event.data?.source?.kind === 'user')?.data?.content
        ?.filter((block: any) => block.type === 'text').map((block: any) => block.text).join(' ').trim().slice(0, 80);
      const titleSource = observed.events.findLast((event:any)=>event.type === 'session/title')?.data?.source?.kind;
      const displayTitle = (titleSource === 'fallback' ? item.label : undefined) || title || item.label || prompt || item.id;
      byId[item.id] = { id: item.id, rootSessionId: rootId, ...(title ? { title } : {}), displayTitle,
        cwd: observed.header.cwd, ...(item.parentId ? { parentId: item.parentId, origin: 'subagent' } : {}),
        running: ctx.agents.get(item.id)?.status === 'running', blank: observed.cursor < 0,
        updatedAt: observed.events.at(-1)?.time ?? observed.header.createdAt,
        projectionValues: Object.fromEntries(SUMMARY_KEYS.filter(key => key in values).map(key => [key, values[key]])) };
      if (item.id === childId) selected = { header: observed.header, events: observed.events,
        projections: { values: byId[item.id].projectionValues } };
      for (const child of values.subagentCatalog || []) {
        if (typeof child.id !== 'string' || !child.id) throw new Error('子任务目录中的身份无效');
        queue.push({ id: child.id, parentId: item.id, label: child.label });
      }
    } finally { observed[Symbol.dispose](); }
  }
  if (childId !== undefined) {
    if (childId === rootId || !selected) throw new Error('此子任务不属于指定的根任务');
    return selected;
  }
  return { rootSessionId: rootId, byId };
}
