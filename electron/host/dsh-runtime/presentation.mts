
/** Reconcile this run only, retaining genuine references, pending input and per-turn progress. */
export function reconcileDshMessages(messages: any[], turns: any[], options: {
  userId: string; assistantId: string; runId: string; live?: boolean; finalContent?:string;
}): any[] {
  if (!turns.length) return messages;
  const anchor = messages.findIndex(message => message.id === options.userId && message.role === 'user');
  const actualUserIds = new Set(turns.map(turn=>turn.user.id));
  const starts = messages.flatMap((message,index)=>message.role==='user' && (actualUserIds.has(message.id || '') || actualUserIds.has(message.dshMessageId || '')) ? [index] : []);
  const start = anchor < 0 ? -1 : Math.min(anchor,...starts);
  const placeholder = messages.find(message => message.id === options.assistantId && message.role === 'assistant');
  const template = [...messages].reverse().find(message => message.role === 'assistant' && message.runId === options.runId && message.dshTurnId)
    || placeholder;
  if (start < 0 || !template) return messages;
  const suffix = messages.slice(start);
  const byId = new Map(suffix.map(message => [message.id,message]));
  const byDshId = new Map(suffix.filter(message=>message.role==='user' && message.dshMessageId).map(message=>[message.dshMessageId,message]));
  const nativeUser = byId.get(options.userId);
  const anchorTurn = nativeUser?.dshMessageId ? turns.findIndex(turn=>turn.user.id===nativeUser.dshMessageId)
    : turns.findIndex(turn=>!byId.has(turn.user.id) && !byDshId.has(turn.user.id));
  const consumed = new Set<string>([options.assistantId]);
  const replyIds = new Set(turns.flatMap(turn => turn.replies.filter((reply:any)=>!reply.partial).map((reply:any) => reply.id)));
  for (const message of suffix) if (message.id && message.role === 'assistant' && message.runId === options.runId
    && (message.dshTurnId || (message.dshMessageId && replyIds.has(message.dshMessageId)))) consumed.add(message.id);
  const visible: any[] = [];
  for (const [index,turn] of turns.entries()) {
    const prior = byId.get(turn.user.id) || byDshId.get(turn.user.id) || (index===anchorTurn ? nativeUser : undefined);
    consumed.add(turn.user.id);
    if (prior?.id) consumed.add(prior.id);
    visible.push({...prior,id:prior?.id || turn.user.id, role:'user', content:turn.user.text,
      createdAt:prior?.createdAt || turn.user.createdAt,dshMessageId:turn.user.id});
    const last = index === turns.length-1;
    const previous = suffix.find(message => message.role==='assistant' && message.runId===options.runId && message.dshTurnId===turn.user.id);
    // The original placeholder's progress belongs to the last turn only when receiving a final batch.
    const own = previous || (last && !template.dshTurnId ? template : undefined);
    const metadata = last && !options.live ? {...own,...template} : own;
    let text = turn.replies.map((reply:any)=>reply.text).filter(Boolean).join('\n\n');
    if (last && !options.live && (options.finalContent !== undefined || (template.taskStatus && template.taskStatus !== 'done')) && (options.finalContent ?? template.content)) {
      const finalContent = options.finalContent ?? template.content;
      const finalReply = turn.replies.at(-1)?.text || '';
      const base = text && finalContent.startsWith(text) ? text : finalReply;
      const note = base && finalContent.startsWith(base) ? finalContent.slice(base.length).trim() : finalContent;
      if (note && !text.endsWith(note)) text = [text,note].filter(Boolean).join('\n\n');
    }
    // Keep a stable placeholder for an actual user turn even before any reply arrives.
    const firstOfficial = turn.replies.find((reply:any)=>!reply.partial);
    const reasoning = turn.replies.map((reply:any)=>reply.reasoning).filter(Boolean).join('\n\n');
    visible.push({...metadata, id:index === 0 ? options.assistantId : `${options.runId}:dsh-turn:${turn.user.id}`,
      dshTurnId:turn.user.id,dshMessageId:firstOfficial?.id,dshStreaming:Boolean(options.live && last),
      role:'assistant',content:text,createdAt:turn.replies.at(-1)?.createdAt || own?.createdAt || turn.user.createdAt,
      runId:options.runId,executedMessages:turn.replies.flatMap((reply:any)=>reply.executedMessages),
      ...(reasoning ? {reasoning} : {}),
      taskStatus:last ? (options.live ? undefined : template.taskStatus) : 'done'});
  }
  const pending = suffix.filter(message => !message.id || !consumed.has(message.id));
  return [...messages.slice(0,start),...visible,...pending];
}

/** Progress and settlement target the current actual user turn, never the first run bubble. */
export function patchDshAssistant(messages:any[],options:{assistantId:string;runId:string;turnId?:string},
  updater:(current:any)=>any) {
  return messages.map(message => (options.turnId
    ? message.role==='assistant' && message.runId===options.runId && message.dshTurnId===options.turnId
    : message.id===options.assistantId) ? updater(message) : message);
}

/** Merge a complete owned run without duplicating live turns or later settlement. */
export function mergeDshTranscript(messages:any[],incoming:any[],placeholderId:string|null=null) {
  const runs=new Set(incoming.filter(message=>message.role==='assistant' && message.runId).map(message=>message.runId));
  const ids=new Set(incoming.map(message=>message.id).filter(Boolean));
  const owns=(message:any)=>Boolean((message.id && ids.has(message.id)) || (placeholderId && message.id===placeholderId)
    || (message.role==='assistant' && message.runId && runs.has(message.runId)));
  const start=messages.findIndex(owns);
  if (start<0) return [...messages,...incoming];
  return [...messages.slice(0,start),...incoming,...messages.slice(start).filter(message=>!owns(message))];
}
