/** Only genuine root user messages start visible turns; injected context stays in the official log. */
export async function visibleDshTurns(events: any[], decodeAssistant: (message: any) => Promise<any>) {
  const turns: any[] = [];
  let current: any;
  for (const event of events) {
    if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
      const message = event.data;
      current = {user: {id:message.id, text:(message.content || []).filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('\n'),
        createdAt:new Date(event.time).toISOString()}, replies:[]};
      turns.push(current);
    } else if (event.type === 'assistant/message' && current) {
      const message = event.data?.message;
      if (!message?.id) continue;
      const executed = await decodeAssistant(message);
      const content = (message.content || []).filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('\n');
      const hasImage = (message.content || []).some((part:any)=>part.type==='image'||part.type==='image_url');
      // Tool-only steps remain in the official log; they do not create empty chat bubbles.
      if (content || hasImage) current.replies.push({id:message.id, text:content, createdAt:new Date(event.time).toISOString(),
        executedMessages:[executed]});
    }
  }
  return turns;
}
