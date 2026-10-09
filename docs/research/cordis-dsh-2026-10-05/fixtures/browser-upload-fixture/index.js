export const inject = ['connection', 'commands', 'agents', 'attachments'];
export function apply(ctx) {
  ctx.commands.register({ name: 'browser-upload-read', description: '读回浏览器实际上传', input: { hint: '真实上传文件', attachments: true }, handler: async invocation => {
    const items = [];
    for (const part of invocation.attachments) {
      const chunks = []; for await (const chunk of ctx.attachments.readFileStream(part.attachment)) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks); items.push({ name: part.attachment.name, bytes: bytes.length, text: bytes.toString('utf8') });
    }
    return { kind: 'success', text: JSON.stringify({ sessionId: invocation.agent.id, items }) };
  } });
  ctx.connection.fetch.register({ path: '/api/browser-upload-fixture/read', methods: ['POST'], fetch: async request => {
    const input = await request.json(), agent = ctx.agents.get(input.sessionId);
    if (!agent) return Response.json({ error: '没有实际所属会话' }, { status: 400 });
    const result = await ctx.commands.execute(agent, '/browser-upload-read', input.attachments, request.signal);
    return Response.json(result.result);
  } });
}
