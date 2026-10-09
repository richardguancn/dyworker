import { RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { readSessionFamily } from './session-family.mts';
import { applyChildComposition, foldSubagentDescriptor, resolveChildDepth } from '@deepseek-ai/dsh-subagent';
import { isChildPrompt } from './child-request.mts';

const fail = (code: ConstructorParameters<typeof RemoteError>[0], message: string, details: any = {}): never => { throw new RemoteError(code, message, details); };

/** 先核对根目录和精确父任务，再调用官方可续跑子任务控制；只读进程没有执行资格。 */
export function createChildControl(ctx: any, rootId: string, open: () => boolean) {
  const pending = new Map<string, Promise<any>>();
  const assertOpen = () => { if (!open()) fail('subagent/parent-unavailable', '所属任务本轮已经结束，不能继续子任务', { parentSessionId: rootId }); };
  const resolve = async (payload: any, signal: AbortSignal) => {
    assertOpen(); signal.throwIfAborted();
    if (typeof payload?.childSessionId !== 'string' || !payload.childSessionId
      || typeof payload.parentSessionId !== 'string' || !payload.parentSessionId || payload.mode !== 'continuable')
      fail('gateway/bad-request', '子任务地址无效');
    const family = await readSessionFamily(ctx, rootId, signal);
    const child = family.byId[payload.childSessionId];
    if (!child?.parentId || child.parentId !== payload.parentSessionId)
      fail('subagent/unauthorized', '此子任务不属于指定的父任务', { childSessionId: payload.childSessionId });
    if (child.projectionValues.subagent?.mode !== 'continuable')
      fail('subagent/not-resumable', '此子任务只提供记录阅读', { childSessionId: payload.childSessionId });
    signal.throwIfAborted(); assertOpen();
    return child;
  };
  return {
    async prompt(payload: any, signal: AbortSignal, preparedFiles?: Map<string, any>) {
      if (!isChildPrompt(payload)) fail('gateway/bad-request','子任务提交格式无效');
      await resolve(payload, signal);
      if (!ctx.agents.get(payload.parentSessionId))
        fail('subagent/parent-unavailable', '直接父任务当前没有执行资格', { parentSessionId: payload.parentSessionId });
      const key = JSON.stringify([payload.childSessionId, payload.requestId]);
      if (pending.has(key)) return pending.get(key)!;
      const operation = (async () => {
        const observed = await ctx.sessionQuery.observeSession(payload.childSessionId, { signal });
        try {
          const agent = ctx.agents.get(payload.childSessionId);
          const prior = [...(agent?.inbox.nextTurn ?? []), ...(agent?.inbox.nextStep ?? []),
            ...observed.events.filter((event: any) => event.type === 'user/message').map((event: any) => event.data)]
            .find((message: any) => message.source?.kind === 'user' && message.source.rpcId === payload.requestId);
          signal.throwIfAborted(); assertOpen();
          if (prior) return { messageId: prior.id };
        } finally { observed[Symbol.dispose](); }
        const root = ctx.agents.get(rootId);
        if (!root) fail('subagent/parent-unavailable', '所属任务已结束');
        const ids: string[] = [];
        const content = payload.content.map((part: any) => {
          if (part?.type === 'text' && typeof part.text === 'string') return { type: 'text', text: part.text };
          if (part?.type === 'file' && typeof part.receiptId === 'string') {
            const staged = ctx.fileUploads.resolve(root, part.receiptId);
            const file = preparedFiles?.get(part.receiptId) ?? staged;
            if (!file) fail('subagent/attachment-invalid', '文件凭据不存在或属于其他会话', { reason: 'FILE_NOT_STAGED' });
            if (staged) ids.push(part.receiptId); return { type: 'file', attachment: file };
          }
          if (part?.type === 'image' && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(part.mediaType)
            && typeof part.data === 'string' && part.data && part.data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(part.data))
            return { type: 'image', mediaType: part.mediaType, data: part.data, ...(typeof part.name === 'string' ? { name: part.name } : {}) };
          fail('gateway/bad-request', '子任务内容包含无效附件');
        });
        if (!content.some((part: any) => part.type !== 'text' || part.text.trim())) fail('gateway/bad-request', '消息和附件均为空');
        signal.throwIfAborted(); assertOpen();
        // 上传属于根会话；子任务真正接收后由其历史持有文件，释放根会话的暂存凭据。
        const bindingId = JSON.stringify(['child', payload.childSessionId, payload.requestId]);
        const binding = ctx.fileUploads.bindPrompt(root, [...new Set(ids)], bindingId);
        let receipt;
        try {
          receipt = await ctx.subagents.prompt({ requestId: payload.requestId, parentSessionId: payload.parentSessionId,
          childSessionId: payload.childSessionId, mode: 'continuable', delivery: payload.delivery,
          content,
          ...(payload.clientTimeZone !== undefined ? { clientTimeZone: payload.clientTimeZone } : {}) }, signal);
          binding.commit(); ctx.fileUploads.retirePrompt(root, bindingId);
        } finally { binding[Symbol.dispose](); }
        await ctx.sessionPersistence.flush();
        return receipt;
      })();
      pending.set(key, operation);
      void operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
      return operation;
    },
    async resumeParents(payload: any, signal: AbortSignal, agentOptions: any) {
      const child = await resolve(payload, signal);
      const family = await readSessionFamily(ctx, rootId, signal);
      const ancestors: any[] = [];
      let id = child.parentId;
      while (id !== rootId) {
        const parent = family.byId[id];
        if (!parent?.parentId || parent.projectionValues.subagent?.mode !== 'continuable')
          fail('subagent/not-resumable', '直接父任务不能恢复执行', { childSessionId: id });
        ancestors.unshift(parent); id = parent.parentId;
      }
      const handles: any[] = [];
      try {
        for (const ancestor of ancestors) {
          signal.throwIfAborted(); assertOpen();
          if (!ctx.agents.get(ancestor.id)) {
            const observed = await ctx.sessionQuery.observeSession(ancestor.id,{signal});
            try {
              const descriptor = foldSubagentDescriptor(observed.events.slice(observed.inheritedEventCount));
              if (!descriptor || descriptor.mode !== 'continuable') fail('subagent/not-resumable','父任务恢复记录无效',{childSessionId:ancestor.id});
              const parent = ctx.agents.get(ancestor.parentId);
              const composition = {persona:'persona' in descriptor ? descriptor.persona : undefined,
                toolFilter:'toolFilter' in descriptor ? descriptor.toolFilter : undefined};
              handles.push(await ctx.agents.resume({resumeSessionId:ancestor.id,parentAgent:parent,
                agentOptions:{...agentOptions,subagentDepth:resolveChildDepth(parent,undefined)},signal,
                setup:(childCtx: any)=>applyChildComposition(childCtx,parent,composition)}));
            } finally {observed[Symbol.dispose]();}
          }
        }
        return handles;
      } catch (error) {
        for (const handle of handles.reverse()) await handle.dispose();
        throw error;
      }
    },
    async interrupt(payload: any, signal: AbortSignal) {
      await resolve(payload, signal);
      return ctx.subagents.interruptByParent(payload.childSessionId, payload.parentSessionId, 'continuable');
    },
  };
}
