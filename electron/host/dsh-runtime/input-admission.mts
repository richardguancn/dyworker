import { createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm';
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import type { MessageId } from '@deepseek-ai/dsh-llm';

// 官方会话控制器未整体装入；保留其队列失败约定，应用授权结束使用独立失败码。
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'session/attachment-invalid': { readonly reason: string };
    'session/queue-item-not-found': { readonly itemId: MessageId };
    'session/steer-unavailable': { readonly itemId: MessageId };
    'dyworker/input-unavailable': { readonly sessionId: string };
  }
}

const fail = (code: ConstructorParameters<typeof RemoteError>[0], text: string, details: any = {}) => { throw new RemoteError(code, text, details); };
const textParts = (parts: any) => Array.isArray(parts) && parts.length > 0
  && parts.every(part => part?.type === 'text' && typeof part.text === 'string') && parts.some(part => part.text.trim());

/** 应用正在授权的任务内，使用官方 Agent、Inbox、附件和上传凭据接收入队内容。 */
export function createInputAdmission(ctx: any, agent: any, open: () => boolean) {
  const pending = new Map<string, Promise<any>>();
  const assertOpen = () => { if (!open() || ctx.agents.get(agent.id) !== agent) fail('dyworker/input-unavailable', '此任务已结束接收，输入未发送', { sessionId: agent.id }); };
  const known = (id: string) => [...agent.inbox.nextTurn, ...agent.inbox.nextStep,
    ...agent.session.snapshotEvents().filter((event: any) => event.type === 'user/message').map((event: any) => event.data)]
    .find((message: any) => message.source?.kind === 'user' && message.source.rpcId === id);
  return {
    snapshot: () => ({status:agent.status, inbox:ctx.sessionProjections.snapshot(agent.session, ['inbox']).values.inbox}),
    admit(payload: any, signal: AbortSignal) {
      assertOpen(); signal.throwIfAborted();
      if (!payload || !['queue','steer'].includes(payload.mode) || typeof payload.requestId !== 'string' || !payload.requestId
        || payload.requestId.length > 200 || !Array.isArray(payload.content) || !payload.content.length
        || payload.content.length > 100) fail('gateway/bad-request', '输入提交格式无效');
      const prior = known(payload.requestId);
      if (prior) return Promise.resolve({accepted:true,messageId:prior.id});
      if (pending.has(payload.requestId)) return pending.get(payload.requestId)!;
      const operation = (async () => {
        const receiptIds: string[] = [];
        const parts = payload.content.map((part: any) => {
          if (part?.type === 'text' && typeof part.text === 'string') return {type:'text',text:part.text};
          if (part?.type === 'file' && typeof part.receiptId === 'string') {
            const file = ctx.fileUploads.resolve(agent, part.receiptId);
            if (!file) fail('session/attachment-invalid','文件凭据不存在或属于其他会话',{reason:'FILE_NOT_STAGED'});
            receiptIds.push(part.receiptId); return {type:'file',attachment:file};
          }
          if (part?.type === 'image' && ['image/png','image/jpeg','image/webp','image/gif'].includes(part.mediaType)
            && typeof part.data === 'string' && part.data && part.data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(part.data))
            return {type:'image',mediaType:part.mediaType,data:part.data,...(typeof part.name === 'string'?{name:part.name}:{})};
          fail('gateway/bad-request','输入内容包含未支持的附件或字段');
        });
        if (!parts.some((part: any) => part.type !== 'text' || part.text.trim())) fail('gateway/bad-request','消息和附件均为空');
        const content = await ctx.attachments.admitPromptContent(parts);
        signal.throwIfAborted(); assertOpen();
        const duplicate = known(payload.requestId);
        if (duplicate) return {accepted:true,messageId:duplicate.id};
        const message = createUserMessage({content,source:{kind:'user',rpcId:payload.requestId}});
        const binding = ctx.fileUploads.bindPrompt(agent, [...new Set(receiptIds)], payload.requestId);
        try {
          if (payload.mode === 'steer') agent.steer(message); else agent.followup(message);
          binding.commit();
        } finally { binding[Symbol.dispose](); }
        await ctx.sessionPersistence.flush();
        return {accepted:true,messageId:message.id};
      })();
      pending.set(payload.requestId, operation);
      void operation.finally(() => { if (pending.get(payload.requestId) === operation) pending.delete(payload.requestId); }).catch(() => {});
      return operation;
    },
    async update(payload: any) {
      assertOpen();
      if (typeof payload?.itemId !== 'string' || !['edit','remove','steer'].includes(payload?.action?.kind)) fail('gateway/bad-request','队列操作格式无效');
      const queued = agent.inbox.nextTurn.find((message: any) => message.id === payload.itemId);
      const steering = agent.inbox.nextStep.find((message: any) => message.id === payload.itemId);
      const message = queued ?? steering;
      if (!message) fail('session/queue-item-not-found','此消息已经不在等待队列',{itemId:payload.itemId});
      if (payload.action.kind === 'steer' && (!queued || agent.status !== 'running')) fail('session/steer-unavailable','当前步骤已结束，不能即时补充',{itemId:payload.itemId});
      if (payload.action.kind === 'edit') {
        if (!textParts(payload.action.content)) fail('gateway/bad-request','队列替换仅接受非空文字');
        agent.inbox.replace(payload.itemId, freezeMessage({...message,content:payload.action.content.map((part: any) => ({type:'text',text:part.text}))}));
      } else {
        agent.inbox.remove(payload.itemId);
        if (payload.action.kind === 'steer') agent.steer(message);
        else if (message.source?.kind === 'user' && message.source.rpcId) ctx.fileUploads.retirePrompt(agent, message.source.rpcId);
      }
      await ctx.sessionPersistence.flush();return {accepted:true};
    },
    cancel() { assertOpen(); agent.cancel({kind:'user'},{keepInbox:true});return {accepted:true}; },
  };
}
