import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import { createOfficialDshContext } from './official-context.mts';
import { installFileHandleBridge } from './file-handles.mts';
import { registerPluginModules } from '../plugin-module-cache.mts';
import { randomUUID } from 'node:crypto';
import { persistenceProxy } from './persistence-proxy.mts';
import { mountDshProfile } from './profile.mts';
import { createPtcProxy } from './ptc-proxy.mts';
import { attachmentProxy } from './attachments.mts';
import { readSessionFamily } from './session-family.mts';
import { readSessionImage } from './session-images.mts';
import { createSessionHistory } from './session-history.mts';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { DEFAULT_MAX_IMAGE_BYTES } from '@deepseek-ai/dsh-attachment-local';
import { remoteErrorOf, RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { createInputAdmission } from './input-admission.mts';
import { createChildControl } from './child-control.mts';
import { installModelSelection } from '@deepseek-ai/dsh-agent';

installFileHandleBridge();
const send = (value: any) => process.send?.(value);
const errorText = (error: any): string => String(error?.message || error)
  + (error?.resource ? `（${error.resource}）` : '')
  + (error?.cause ? `：${errorText(error.cause)}` : '')
  + (Array.isArray(error?.errors) ? `：${error.errors.map(errorText).join('；')}` : '');
const waits = new Map<string, any>();
let ctx: any;
let handle: any;
let busy = false;
let closing = false;
let taskContext = '';
let inputOpen = false;
let childOnly = false;
let inputLifetime = new AbortController();
const calls = new Map<string, AbortController>();
// 在官方存储开始取字节时再打开文件，避免异步准备期间读取错误成为未监听事件。
async function* fileChunks(filePath: string) { for await (const chunk of createReadStream(filePath)) yield chunk; }
process.on('message', (call: any) => {
  if (call.type !== 'parent-result') return;
  const wait = waits.get(call.id); if (!wait) return;
  waits.delete(call.id);
  if (call.error) wait.reject(new Error(call.error)); else wait.resolve(call.value);
});
function ask(kind: string, value: any, signal?: AbortSignal): Promise<any> {
  signal?.throwIfAborted();
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const abort = () => { waits.delete(id); send({ type: 'cancel-request', id }); reject(signal.reason); };
    waits.set(id, { resolve: (result: any) => { signal?.removeEventListener('abort', abort); resolve(result); },
      reject: (error: any) => { signal?.removeEventListener('abort', abort); reject(error); } });
    signal?.addEventListener('abort', abort, { once: true });
    send({ type: kind, id, ...value });
  });
}
class ParentModel extends LlmAdapter {
  async *stream(options: any) {
    const { signal, ...request } = options;
    // 一次只取一个块，由父进程保存提供方凭据与网络请求；插件拿不到应用设置。
    const id = await ask('model-open', { request }, signal);
    try {
      while (true) {
        const next = await ask('model-next', { streamId: id }, signal);
        if (next.done) return;
        yield next.value;
      }
    } finally { send({ type: 'model-close', streamId: id }); }
  }
}
process.once('message', async (input: any) => {
  try {
    registerPluginModules(input.profileDir);
    const ptc = createPtcProxy(ask);
    ctx = await createOfficialDshContext({ ...input, ptc, attachments: attachmentProxy(ask), persistence: persistenceProxy((action, payload, signal) =>
      ask('persistence', { action, payload }, signal)) });
    const sessionHistory = createSessionHistory(ctx, input.sessionId, input.workspacePath);
    ctx.llm.registerAdapter(['dyworker'], new ParentModel());
    ctx.on('user-questions/request', (request: any) => {
      if (!request.agent || request.agent !== handle?.agent) throw new Error('提问必须属于当前正在运行的根任务');
      return ask('user-question', { sessionId: request.agent.id, questions: request.questions }, request.signal);
    }, { global: true });
    ctx.systemPrompt.context({ name: 'dyworker-task', order: 20, text: () => taskContext });
    const grants = new Map<any, string>();
    const questionTool = ctx.tools.get('ask_user_question');
    const workflowTool = ctx.tools.get('workflow');
    const fixedControls = new Map(['job_list', 'job_output', 'job_kill'].map(name => [name, ctx.tools.get(name)]));
    const fixedExtraTools = new Map<string, any>();
    const fingerprint = (exec: any) => JSON.stringify([exec.agent?.id, exec.name, exec.arguments]);
    ctx.on('tools/pre-execute', async (exec: any, next: any) => {
      if (exec.name === 'ask_user_question' && ctx.tools.get(exec.name, exec.agent) !== questionTool)
        throw new Error('不能替换应用提供的用户提问工具');
      if (exec.name === 'workflow' && ctx.tools.get(exec.name, exec.agent) !== workflowTool)
        throw new Error('不能替换应用提供的工作流工具');
      if (fixedControls.has(exec.name) && ctx.tools.get(exec.name, exec.agent) !== fixedControls.get(exec.name))
        throw new Error('不能替换应用提供的后台任务工具');
      if (fixedExtraTools.has(exec.name) && ctx.tools.get(exec.name, exec.agent) !== fixedExtraTools.get(exec.name))
        throw new Error('不能替换应用提供的工作模板或记忆工具');
      const signature = fingerprint(exec);
      const allowed = await ask('tool-approval', { tool: { sessionId: exec.agent?.id, callId: exec.callId,
        name: exec.name, args: exec.arguments } }, exec.signal);
      if (allowed === true) grants.set(exec.token, signature);
      return next();
    });
    // 官方最终检查在所有可扩展策略之后执行；未经过父进程允许的调用没有许可。
    ctx.tools.guard((exec: any) => {
      const signature = grants.get(exec.token); grants.delete(exec.token);
      return signature === fingerprint(exec) ? undefined : 'DYWorker 未允许此操作';
    });
    for (const tool of input.extraTools || []) {
      ctx.tools.register({ name: tool.name, description: tool.description || tool.name,
        parameters: tool.parameters || { type: 'object', properties: {} },
        execute: async (args: any, exec: any) => {
          if (input.fixedExtraTools?.includes(tool.name) && ['sleep_until', 'finish_task'].includes(tool.name)) {
            if (exec.agent !== handle.agent) throw new Error('子任务不能挂起或结束根任务');
            if (ctx.agents.list().some((child: any) => child !== exec.agent && child.status === 'running')
              || ctx.jobs.list(exec.agent.id).some((job: any) => ['running', 'stopping'].includes(job.status)))
              throw new Error('所属后台工作或子任务仍在执行，请先等待实际完成');
          }
          const value = await ask('extra-tool', { tool: { sessionId: exec.agent.id, callId: exec.callId, name: tool.name, args } }, exec.signal);
          if (value.control === true) exec.concludeTurn();
          return { text: value.text };
        },
        output: { schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
          render: (_args: any, value: any) => [{ type: 'text', text: value.text }] },
      });
      if (input.fixedExtraTools?.includes(tool.name)) fixedExtraTools.set(tool.name, ctx.tools.get(tool.name));
    }
    await mountDshProfile(ctx, input);
    ctx.on('session/event', (session: any, event: any) => send({ type: 'session-event', sessionId: session.id, event }));
    const exists = await ctx.sessionPersistence.stat(input.sessionId);
    if (exists && exists.header.cwd !== input.workspacePath) throw new Error('已保存的 DSH 会话属于另一个工作目录');
    handle = exists
      ? await ctx.agents.resume({ resumeSessionId: input.sessionId, agentOptions: { provider: 'dyworker', model: input.model || 'selected' } })
      : await ctx.agents.create({ sessionId: input.sessionId, meta: { cwd: input.workspacePath },
        agentOptions: { provider: 'dyworker', model: input.model || 'selected' } });
    send({ type: 'ready', schemas: ctx.tools.schemas(), routes: ctx.connection.list() });
    const inputAdmission = createInputAdmission(ctx, handle.agent, () => inputOpen && !closing && !childOnly);
    const childControl = createChildControl(ctx, input.sessionId, () => inputOpen && !closing);
    let restoredParents: any[] = [];
    let releaseChildModel: (() => void) | undefined;
    process.on('message', async (call: any) => {
      if (call.type === 'abort-call') { calls.get(call.id)?.abort(new Error('插件请求已取消')); return; }
      if (call.type === 'cancel') { for (const controller of calls.values()) controller.abort(new Error('任务已停止'));
        handle.agent.cancel({ kind: 'user' }); return; }
      if (call.type !== 'request') return;
      const controller = new AbortController(); calls.set(call.id, controller);
      try {
        if (closing) throw new Error('DSH 会话正在关闭');
        const agent = handle.agent;
        let result: any;
        if (call.action === 'snapshot') result = { header: agent.session.header, events: agent.session.snapshotEvents(),
          projections: ctx.sessionProjections.snapshot(agent.session), status: agent.status, jobs: ctx.jobs.list(agent.id) };
        else if (call.action === 'session-image') result = await readSessionImage(ctx, input.sessionId, call.payload, controller.signal);
        else if (['history-page', 'history-open', 'history-next', 'history-close', 'history-list', 'history-control-open', 'history-state', 'history-search', 'session-rename'].includes(call.action))
          result = await sessionHistory.request(call.action, call.payload, controller.signal);
        else if (call.action === 'session-command') {
          const signal = AbortSignal.any([controller.signal,inputLifetime.signal]);
          if (!inputOpen || closing) throw new RemoteError('dyworker/input-unavailable','此任务没有正在接收命令的授权运行',{sessionId:input.sessionId});
          if(typeof call.payload.line !== 'string' || !Array.isArray(call.payload.attachments))
            throw new RemoteError('gateway/bad-request','命令必须包含文字和附件列表',{});
          await sessionHistory.request('history-page',{address:call.payload.address,throughSeq:-1},signal);
          const targetId = call.payload.address.kind === 'session' ? input.sessionId : call.payload.address.childSessionId;
          const target = ctx.agents.get(targetId);
          if(!target || (targetId === input.sessionId && childOnly))
            throw new RemoteError('dyworker/input-unavailable','命令所属任务没有当前执行资格',{sessionId:targetId});
          result = await ctx.commands.execute(target,call.payload.line,call.payload.attachments,signal);
          await ctx.sessionPersistence.flush();
        }
        else if (call.action === 'input-snapshot') result = inputAdmission.snapshot();
        else if (call.action === 'input-admit') result = await inputAdmission.admit(call.payload, controller.signal);
        else if (call.action === 'input-update-queue') result = await inputAdmission.update(call.payload);
        else if (call.action === 'input-cancel') result = inputAdmission.cancel();
        else if (call.action === 'start-child') {
          // 只有宿主的新授权运行调用此内部入口，公开只读操作不会转发它。
          if (busy || inputOpen) throw new Error('此 DSH 会话已有运行中的任务');
          inputLifetime = new AbortController(); inputOpen = true; childOnly = true;
          // 原子任务描述保留创建时的模型；新执行显式选择当前模型，并由官方组件记录切换说明。
          releaseChildModel = installModelSelection(ctx, {current:{provider:'dyworker',model:input.model || 'selected'},assembled:undefined});
          const signal = AbortSignal.any([controller.signal, inputLifetime.signal]);
          try {
            restoredParents = await childControl.resumeParents(call.payload.prompt, signal,
              { provider: 'dyworker', model: input.model || 'selected' });
            result = await childControl.prompt(call.payload.prompt, signal, new Map(call.payload.files || []));
          } catch (error) {
            inputOpen = false; inputLifetime.abort(error);
            for (const parent of restoredParents.reverse()) await parent.dispose();
            restoredParents = []; childOnly = false;
            releaseChildModel?.(); releaseChildModel = undefined;
            throw error;
          }
        }
        else if (call.action === 'child-prompt' || call.action === 'child-interrupt') {
          const signal = AbortSignal.any([controller.signal, inputLifetime.signal]);
          result = call.action === 'child-prompt' ? await childControl.prompt(call.payload, signal)
            : await childControl.interrupt(call.payload, signal);
        }
        else if(call.action==='history-fork-seed')result=await sessionHistory.request(call.action,call.payload,controller.signal);
        else if (call.action === 'family' || call.action === 'child-snapshot') {
          result = await readSessionFamily(ctx, input.sessionId, controller.signal,
            call.action === 'child-snapshot' ? String(call.payload.childId || '') : undefined);
          if (call.action === 'child-snapshot') result.control = { rootSessionId: input.sessionId,
            parentSessionId: result.header.parentSession, childSessionId: result.header.id,
            mode: result.projections.values.subagent?.mode ?? 'unknown',
            running: ctx.agents.get(result.header.id)?.status === 'running',
            available: inputOpen && !closing && !!ctx.agents.get(result.header.parentSession) };
        }
        else if (call.action === 'ptc-binding') result = await ptc.invoke(call.payload);
        else if (call.action === 'session-file-refs') {
          const owner = String(call.payload.sessionId || '');
          const family = await readSessionFamily(ctx, input.sessionId, controller.signal);
          if (!family.byId[owner]) throw new Error('附件读取任务不属于本会话');
          const observed = await ctx.sessionQuery.observeSession(owner, { signal: controller.signal });
          try {
            const live = ctx.agents.get(owner);
            const messages = [...observed.events.filter((event: any) => event.type === 'user/message').map((event: any) => event.data),
              ...(live?.inbox.nextTurn ?? []), ...(live?.inbox.nextStep ?? [])];
            result = messages.flatMap((message: any) => (message.content || []).filter((part: any) => part.type === 'file').map((part: any) => part.attachment));
          } finally { observed[Symbol.dispose](); }
        }
        else if (call.action === 'resolve-file-receipts') {
          result = call.payload.ids.map((id: string) => {
            const file = ctx.fileUploads.resolve(agent, id);
            if (!file) throw new Error('文件上传凭据不存在或属于其他会话');
            return file;
          });
        }
        else if (call.action === 'browser-upload') {
          try { result = { ok: true, value: await ctx.fileUploads.uploadStream({ sessionId: agent.id,
            data: fileChunks(call.payload.file.filePath), signal: controller.signal, name: call.payload.file.name }) }; }
          catch (error: any) { const failure = remoteErrorOf(error); result = { ok: false, error: failure
            ? { code: failure.code, message: failure.message, details: failure.details }
            : { code: 'gateway/internal', message: errorText(error), details: {} } }; }
        }
        else if (call.action === 'command-attachments') {
          result = [];
          for (const file of call.payload.files) {
            controller.signal.throwIfAborted();
            if (file.image) {
              if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mediaType)) throw new Error('插件命令仅支持 PNG、JPEG、WebP 和 GIF 图片');
              if ((await fs.stat(file.filePath)).size > DEFAULT_MAX_IMAGE_BYTES) throw new Error('图片超过 DSH 允许的 20 MB');
              const data = await fs.readFile(file.filePath);
              await ctx.attachments.validateImage({ data, mediaType: file.mediaType, name: file.name });
              result.push({ type: 'image', mediaType: file.mediaType, data: data.toString('base64'), name: file.name });
            } else {
              const upload = await ctx.fileUploads.uploadStream({ sessionId: agent.id, data: fileChunks(file.filePath),
                signal: controller.signal, name: file.name });
              result.push({ type: 'file', receiptId: upload.receiptId });
            }
          }
        }
        else if (call.action === 'route') result = await ctx.connection.dispatch({ ...call.payload, signal: controller.signal });
        else if (call.action === 'context') { taskContext = String(call.payload.text || ''); result = true; }
        else if (call.action === 'settings-describe') result = ctx.settings.describe({ redactSecrets: true });
        else if (call.action === 'settings-update') {
          await ctx.settings.update(call.payload.namespace, call.payload.patch, call.payload.revision);
          result = ctx.settings.describe({ redactSecrets: true });
        }
        else if (call.action === 'settings-mutate') {
          await ctx.settings.mutate(call.payload.namespace, call.payload.ops, call.payload.revision);
          result = ctx.settings.describe({ redactSecrets: true });
        }
        else if (call.action === 'inject') {
          agent.inject(createUserMessage({ content: [{ type: 'text', text: String(call.payload.text) }],
            source: { kind: 'dyworker-context' } } as any));
          await ctx.sessionPersistence.flush(); result = true;
        } else if (call.action === 'prompt' || call.action === 'compact') {
          if (busy) throw new Error('此 DSH 会话已有运行中的任务');
          busy = true;
          try {
            if (call.action === 'prompt') {
              inputLifetime = new AbortController(); inputOpen = true;
              agent.followup(createUserMessage({ content: call.payload.content || [{ type: 'text', text: String(call.payload.text) }], source: { kind: 'user' } }));
              // 任务入口保留模型及审批生命周期，直到所属后台工作和其完成通知也收尾。
              while (true) {
                await agent.whenIdle(); controller.signal.throwIfAborted();
                const children = ctx.agents.list().filter((child: any) => child !== agent && child.status === 'running');
                if (children.length) await Promise.all(children.map((child: any) => child.whenIdle()));
                if (!children.length && agent.status === 'idle') break;
              }
              result = { events: agent.session.snapshotEvents(), projections: ctx.sessionProjections.snapshot(agent.session), status: agent.status,
                jobs: ctx.jobs.list(agent.id) };
            } else result = await ctx.compaction.compactNow(agent, controller.signal);
            await ctx.sessionPersistence.flush();
          } finally { busy = false; }
        } else if (call.action === 'wait-jobs') {
          const agent = handle.agent;
          while (true) {
            const jobs = ctx.jobs.list(agent.id).filter((job: any) => ['running', 'stopping'].includes(job.status));
            if (jobs.length) await new Promise<void>((resolve, reject) => {
              const cleanup = () => { off(); controller.signal.removeEventListener('abort', abort); };
              const check = () => { if (jobs.every((job: any) => !['running', 'stopping'].includes(ctx.jobs.get(job.id, agent.id).status))) { cleanup(); resolve(); } };
              const abort = () => { cleanup(); reject(controller.signal.reason); };
              const off = ctx.jobs.events.subscribe({ owner: agent.id }, check);
              controller.signal.addEventListener('abort', abort, { once: true }); check();
              if (controller.signal.aborted) abort();
            });
            await new Promise(resolve => setImmediate(resolve));
            await agent.whenIdle();
            const children = ctx.agents.list().filter((child: any) => child !== agent && child.status === 'running');
            if (children.length) await Promise.all(children.map((child: any) => child.whenIdle()));
            if (!children.length && agent.status === 'idle') {
              const remainingJobs = ctx.jobs.list(agent.id).filter((job: any) => ['running', 'stopping'].includes(job.status));
              if (!remainingJobs.length) {
                // An idle child may still own an Activation whose release
                // delivers a final notice to its parent. Keep this run open
                // until the original parent-chain release and ensuing work settle.
                // The root remains resident for later runs. A forest-wide
                // admission cutoff is only for parents leaving the registry.
                for(const parent of [agent,...restoredParents.map(parent=>parent.agent)]) {
                  const children=await ctx.subagents.listChildren(parent.id,controller.signal);
                  await ctx.subagents.drainContinuableChildren(parent,children.map((child:any)=>child.id));
                }
                await agent.whenIdle();controller.signal.throwIfAborted();
                if(agent.status==='idle'&&!ctx.agents.list().some((child:any)=>child!==agent&&child.status==='running')
                  &&!ctx.jobs.list(agent.id).some((job:any)=>['running','stopping'].includes(job.status)))break;
              }
            }
          }
          // Agent idle 不代表 continuable Activation 已释放：其关闭后仍要给直接父任务交付通知。
          // 用官方父链收尾先等待这些后代释放，再关闭临时恢复的父任务；通知由官方以 inject 保存。
          if (restoredParents.length) await ctx.subagents.drainContinuableDescendants(restoredParents.map(parent => parent.agent));
          for (const parent of restoredParents.reverse()) await parent.dispose();
          restoredParents = [];
          inputOpen = false;
          inputLifetime.abort(new Error('所属任务本轮已结束'));
          releaseChildModel?.(); releaseChildModel = undefined;
          childOnly = false;
          result = true;
        } else if (call.action === 'close') {
          closing = true; inputLifetime.abort(new Error('所属任务已关闭')); await sessionHistory.dispose();
          // Descendants can still append their settled notice to the root inbox.
          // Drain them while every direct parent's writer is alive, then retire parents.
          await ctx.subagents.drainContinuableDescendants([handle.agent,...restoredParents.map(parent=>parent.agent)]);
          for(const parent of restoredParents.reverse()) await parent.dispose();restoredParents=[];
          await handle.dispose(); await ctx.fiber.dispose(); result = true;
        } else throw new Error(`不支持的 DSH 操作：${call.action}`);
        send({ type: 'response', id: call.id, value: result });
      } catch (error: any) { const remote = remoteErrorOf(error); send({ type: 'response', id: call.id, error: errorText(error),
        ...(remote ? {errorCode:remote.code,errorDetails:remote.details}: {}) }); }
      finally { calls.delete(call.id); }
    });
  } catch (error: any) {
    await ctx?.fiber.dispose().catch(() => {});
    send({ type: 'startup-error', error: errorText(error) });
  }
});
