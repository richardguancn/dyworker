// Hide the upstream's internal kickoff and handoff messages from the user chat.
export function conversationMessages(history: any): Array<{ key: string; role: string; text: string; who?: string }> {
  if (Array.isArray(history.groupLog)) return history.groupLog.filter((line: any) => !line.kind && line.text)
    .map((line: any) => ({ key: `group-${line.seq}`, role: line.who === 'User' ? 'user' : 'assistant', who: line.who === 'User' ? '你' : line.who, text: line.text }));
  return (history.events || []).flatMap((event: any) => {
    const message = event.type === 'assistant/message' ? event.data?.message : event.type === 'user/message' ? event.data : null;
    if (!message || message.source?.handoff || message.source?.role === 'kickoff' || message.source?.kind === 'runtime-context') return [];
    const text = (message.content || []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n');
    return text ? [{ key: `${event.sessionId || ""}-${event.seq}-${message.id}`, role: event.type === 'user/message' ? 'user' : 'assistant', text }] : [];
  });
}
