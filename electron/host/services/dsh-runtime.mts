import { Service } from '@deepseek-ai/cordis';
import { OfficialDshSession } from '../dsh-runtime/full-session.mts';
import { generateWithDyworker } from '../dsh-runtime/model-adapter.mts';
import { createDshApproval } from '../dsh-runtime/approval.mts';
import { createHash, randomUUID } from 'node:crypto';
import { DshPluginBridge } from '../dsh-runtime/bridge.mts';
import path from 'node:path';
import fs from 'node:fs/promises';
import { loadProjectInstructions, verifyTaskEvidence, toolDefinitions, pickDeliveryText } from '../../agent.mts';
import { selectWikiPages } from '../../memory-wiki.mts';
import { answerDshQuestions } from '../dsh-runtime/user-questions.mts';
import { dshNativeSkills } from '../dsh-runtime/native-skills.mts';
import { createDshTrace } from '../dsh-runtime/trace.mts';
import { nativeDshContent } from '../dsh-runtime/attachments.mts';
import { isChildPrompt } from '../dsh-runtime/child-request.mts';
import { readAttachmentTool, readNativeAttachment } from '../dsh-runtime/native-attachments.mts';
import { createLiveDshTurns } from '../dsh-runtime/live-turns.mts';
import { searchDshSessions } from '../dsh-runtime/global-search.mts';
import {listDshSessions} from '../dsh-runtime/global-catalog.mts';
import { birthDshTask } from '../dsh-runtime/task-birth.mts';
import {readDshForkSource} from '../dsh-runtime/fork-source.mts';

declare module '@deepseek-ai/cordis' { interface Context { dshRuntime: DshRuntimeService; } }

/** 每个根会话拥有一个官方运行进程；应用的其他任务继续使用原有运行方式。 */
export class DshRuntimeService extends Service {
  config: any;
  sessions = new Map<string, { runtime: OfficialDshSession; busy: boolean; version: string; ownerIds: string[]; ready?: Promise<any>; activeInput?: {signal:AbortSignal} }>();
  opening = new Map<string, Promise<any>>();
  private retiring=new Map<string,Promise<void>>();
  private closed=false;
  private nativeWrites = Promise.resolve();
  private overviewPending?: Promise<any>;
  private searchLifetime=new AbortController();
  private searches=new Set<Promise<any>>();
  private historyCarriers=new Map<string,{rootId:string;runtime:OfficialDshSession}>();
  private authorizingRuns=0;
  private profileSwitch?:{settled:Promise<void>;release:()=>void};
  private profileSwitchGeneration=0;
  private carrierLost() {return Object.assign(new Error('历史读取所属运行环境已经更换，请重新建立连接'),{code:'dyworker/history-carrier-lost',details:{}});}
  private summaryFile(id: string) { return path.join(this.config.dir, createHash('sha256').update(id).digest('hex'), 'overview.json'); }
  private async saveOverview(id: string, snapshot: any) {
    if (!snapshot?.projections?.values) return;
    const value = { projectionValues: Object.fromEntries(['contextTimeline', 'contextHeaders', 'contextActivity']
      .filter(key => key in snapshot.projections.values).map(key => [key, snapshot.projections.values[key]])) };
    const file = this.summaryFile(id);
    const encoded = JSON.stringify(value);
    if (await fs.readFile(file, 'utf8').catch(() => '') === encoded) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, encoded); await fs.rename(temporary, file);
  }
  /** 根会话列表只携带真实投影，不把消息或授权入口暴露给跨会话页面。 */
  overview() {
    if (this.overviewPending) return this.overviewPending;
    const operation = (async () => {
      const records = (await this.ctx.sessions.loadAll()).filter((session: any) => session.runtime === 'dsh');
      const byId: Record<string, any> = {};
      // 冷存档逐个恢复，避免为整个历史同时启动运行进程。
      for (const session of records) {
        let cached = await fs.readFile(this.summaryFile(session.id), 'utf8').then(JSON.parse).catch(() => null);
        const existing = this.sessions.get(session.id);
        if (!cached || existing) {
          let viewed: any;
          try {
            const snapshot = await this.request(session.id, 'snapshot');
            viewed = this.sessions.get(session.id);
            cached = await fs.readFile(this.summaryFile(session.id), 'utf8').then(JSON.parse);
          } catch { /* 缺少插件或存档损坏时仅呈现元信息，不编造统计。 */ }
          finally {
            if (!existing && viewed && !viewed.busy && this.sessions.get(session.id) === viewed) await this.close(session.id);
          }
        }
        byId[session.id] = { id: session.id, title: session.title, cwd: session.workspacePath,
          updatedAt: Date.parse(session.updatedAt) || 0, blank: !session.messages?.length,
          running: this.sessions.get(session.id)?.busy === true,
          ...(cached?.projectionValues ? { projectionValues: cached.projectionValues } : {}) };
      }
      return { ids: records.map((session: any) => session.id), byId };
    })();
    this.overviewPending = operation;
    void operation.finally(() => { if (this.overviewPending === operation) this.overviewPending = undefined; }).catch(() => {});
    return operation;
  }
  // 两种任务入口共用这条写入队列，保存技能时互不覆盖。
  writeNative(job: () => Promise<any>) {
    const operation = this.nativeWrites.then(job);
    this.nativeWrites = operation.then(() => {}, () => {});
    return operation;
  }
  constructor(ctx: any, config: any) {
    super(ctx, 'dshRuntime'); this.config = config;
    ctx.effect(() => async () => {
      this.closed=true;
      this.searchLifetime.abort(new Error('插件任务读取入口已关闭'));
      this.profileSwitch?.release();
      await Promise.allSettled([...this.searches]);
      await this.nativeWrites;
      await Promise.all([...this.sessions.keys()].map(id => this.close(id)));
      await Promise.all([...this.retiring.values()]);
      await Promise.allSettled([...this.opening.values()]);
    });
  }
  async close(id: string) {
    const entry = this.sessions.get(id); if (!entry) {await this.retiring.get(id);return;}
    this.sessions.delete(id);
    for(const [streamId,owner]of this.historyCarriers)if(owner.runtime===entry.runtime)this.historyCarriers.delete(streamId);
    const pending=entry.runtime.close();this.retiring.set(id,pending);
    try{await pending;}finally{if(this.retiring.get(id)===pending)this.retiring.delete(id);}
  }
  async stopOwners(ids: string[]) {
    await Promise.all([...this.sessions.entries()].filter(([, entry]) => entry.ownerIds.some(id => ids.includes(id)))
      .map(([id]) => this.close(id)));
  }
  async closeIdle() { await Promise.all([...this.sessions.entries()].filter(([, entry]) => !entry.busy).map(([id]) => this.close(id))); }
  get busy() { return this.authorizingRuns > 0 || this.opening.size > 0 || [...this.sessions.values()].some(entry => entry.busy); }
  /** Keep readonly recovery outside the real dependency-switch interval. */
  async suspendViewsForProfileSwitch(){
    if(this.closed)throw this.carrierLost();
    if(this.profileSwitch)throw new Error('插件正在切换，请等待安装完成');
    if(this.busy)throw new Error('插件任务正在执行，本次安装未切换');
    this.profileSwitchGeneration++;
    let resolve!:()=>void;
    const phase={settled:new Promise<void>(done=>{resolve=done;}),release:()=>{
      if(this.profileSwitch===phase)this.profileSwitch=undefined;
      resolve();
    }};
    this.profileSwitch=phase;
    try{await this.closeIdle();if(this.closed)throw this.carrierLost();return phase.release;}
    catch(error){phase.release();throw error;}
  }
  private async waitForProfileSwitch(signal?:AbortSignal){
    const lifetime=AbortSignal.any([this.searchLifetime.signal,...(signal?[signal]:[])]);
    while(this.profileSwitch){
      lifetime.throwIfAborted();const phase=this.profileSwitch;
      await new Promise<void>((resolve,reject)=>{
        const abort=()=>{cleanup();reject(lifetime.reason);};
        const cleanup=()=>lifetime.removeEventListener('abort',abort);
        lifetime.addEventListener('abort',abort,{once:true});
        phase.settled.then(()=>{cleanup();resolve();});
        if(lifetime.aborted)abort();
      });
    }
    lifetime.throwIfAborted();if(this.closed)throw this.carrierLost();
  }
  async run(options: any) {
    if(this.profileSwitch)throw new Error('插件正在切换，请等待安装完成后再执行任务');
    this.authorizingRuns++;
    try{return await this.runAuthorized(options);}
    finally{this.authorizingRuns--;}
  }
  private async runAuthorized(options: any) {
    if(this.closed)throw this.carrierLost();
    const { sessionId, signal, settings, emit = () => {} } = options;
    if (!sessionId || !options.workspacePath) throw new Error('DSH 会话需要选择工作目录');
    signal.throwIfAborted();
    const childPrompt = options.childPrompt;
    const preparedChildFiles = new Map<string, any>();
    let priorChild: any;
    if (childPrompt) {
      if (!isChildPrompt(childPrompt)) throw Object.assign(new Error('子任务提交格式无效'),{code:'gateway/bad-request',details:{}});
      priorChild = await this.request(sessionId, 'child-snapshot', {childId:childPrompt.childSessionId}, {signal});
      if (priorChild.header.parentSession !== childPrompt.parentSessionId
        || priorChild.projections.values.subagent?.mode !== 'continuable') throw new Error('子任务地址或继续方式无效');
      const received = priorChild.events.find((event: any) => event.type === 'user/message'
        && event.data.source?.kind === 'user' && event.data.source.rpcId === childPrompt.requestId);
      if (received) {
        options.onChildAdmitted?.({messageId:received.data.id});
        return {status:'done',finalText:'',dshTurns:[],executedMessages:[]};
      }
      const ids = Array.isArray(childPrompt.content) ? [...new Set<string>(childPrompt.content
        .filter((part: any) => part?.type === 'file' && typeof part.receiptId === 'string').map((part: any) => part.receiptId))] : [];
      if (ids.length) {
        const files = await this.request(sessionId, 'resolve-file-receipts', {ids}, {signal});
        ids.forEach((id, index) => preparedChildFiles.set(id, files[index]));
      }
    }
    const latest = options.conversation?.at(-1);
    const content = latest?.role === 'user' ? latest.content : options.prompt;
    const nativeContent = childPrompt ? [] : nativeDshContent(content ?? options.prompt ?? '');
    // 凭据属于上传时的确切 Agent；在重建运行入口前核对并取出真实持久文件。
    const uploaded = nativeContent.filter(part => part.type === 'file-receipt');
    if (uploaded.length) {
      const refs = await this.request(sessionId, 'resolve-file-receipts', {ids:uploaded.map(part => part.receiptId)}, {signal});
      let index = 0;
      for (let at = 0; at < nativeContent.length; at++) if (nativeContent[at].type === 'file-receipt') nativeContent[at] = {type:'file', attachment:refs[index++]};
    }
    const prompt = Array.isArray(content) ? content.map((part: any) => String(part.text || '')).join('\n')
      : String(content ?? options.prompt ?? '');
    const specification = await this.ctx.plugins.dshSessionPlugins();
    const readSkills = () => options.resolvers.readSkills?.(options.workspacePath) ?? this.ctx.skills.read(options.workspacePath);
    const nativeSkills = dshNativeSkills(await readSkills(), { read: readSkills, signal, emit,
      append: (item: any) => this.writeNative(async () => { signal.throwIfAborted(); return this.ctx.skills.append(item); }),
      update: (item: any) => this.writeNative(async () => { signal.throwIfAborted(); return this.ctx.skills.update(item); }) });
    const memoryTools = [...toolDefinitions().filter(tool => ['save_memory', 'sleep_until', 'finish_task'].includes(tool.function.name)), readAttachmentTool];
    const controls = new Map<string, any>();
    let outcome: any;
    // 原样 DSH 工具已在该环境注册；只转接本应用和 MCP 的其他工具。
    const extraTools = [...nativeSkills.tools, ...memoryTools, ...(options.extraTools || [])].map((tool: any) => tool.function ?? tool).filter((tool: any, index: number, all: any[]) =>
      all.findIndex(candidate => candidate.name === tool.name) === index &&
      !specification.some((plugin: any) => tool.name?.startsWith(`plugin__${plugin.id.replace(/[^a-zA-Z0-9_]/g, '_')}__`)));
    const version = JSON.stringify([options.workspacePath, settings.model, specification, extraTools]);
    const hooks = await options.resolvers.readHooks(options.workspacePath);
    const standingRules=await options.resolvers.readStandingRules();
    if (this.opening.has(sessionId)) await this.opening.get(sessionId);
    await this.retiring.get(sessionId);
    signal.throwIfAborted();if(this.closed)throw this.carrierLost();
    let entry = this.sessions.get(sessionId);
    if (entry?.busy) throw new Error('此 DSH 会话已有运行中的任务');
    if (entry && entry.version !== version) { await this.close(sessionId); entry = undefined; }
    const targets = new Map<string, any>();
    const fileInspector = new DshPluginBridge({});
    const nativeToolNames = [...nativeSkills.tools, ...memoryTools].map(tool => tool.function.name);
    const approval = createDshApproval({ ...options, hooks, nativeToolNames, nativeToolAliases: { read_attachment: 'read_file' },
      standingRules,
      beforeToolExecute: ({ name, args }: any) => this.ctx.waterfall('tools/pre-execute', name, args, null, () => null),
      audit: (item: any) => options.resolvers.auditRecord({ ...item, sessionId, approvalMode: options.approvalMode }),
      onUsage: (usage: any) => emit({ type: 'token-usage', model: usage.model || settings.model,
        prompt: Number(usage.prompt_tokens) || 0, completion: Number(usage.completion_tokens) || 0, estimated: Boolean(usage.estimated) }),
    });
    if (!entry) {
      const runtime = new OfficialDshSession({ profileDir: this.ctx.plugins.dir,
        dataDir: path.join(this.config.dir, createHash('sha256').update(sessionId).digest('hex')),
        workspacePath: options.workspacePath, sessionId, model: settings.model, plugins: specification, extraTools, fixedExtraTools: nativeToolNames,
        mods:this.ctx.get('mods') });
      entry = { runtime, busy: true, version, ownerIds: specification.map((item: any) => item.id) };
      this.sessions.set(sessionId, entry);
    } else entry.busy = true;
    const runtime = entry.runtime;
    entry.activeInput = {signal};
    runtime.options.onExtraTool = async (name: string, args: any, execution: any = {}) => {
      signal.throwIfAborted();
      if (name === 'read_attachment') {
        const files = await runtime.request('session-file-refs', { sessionId: execution.sessionId }, { signal });
        const refs = new Map<string, any>(files.map((file: any) => [file.attachmentId, file]));
        return readNativeAttachment(runtime.persistenceContext.attachments, refs, args, signal);
      }
      if (nativeSkills.owns(name)) return nativeSkills.execute(name, args);
      if (name === 'sleep_until' || name === 'finish_task') {
        if (execution.sessionId !== sessionId) throw new Error('子任务不能挂起或结束根任务');
        if (outcome || controls.size) throw new Error('本轮已经请求挂起或结束任务');
        let control: any;
        if (name === 'sleep_until') {
          if (typeof options.resolvers.hasPendingWakeForSession !== 'function') throw new Error('当前环境没有唤醒登记入口');
          if (await options.resolvers.hasPendingWakeForSession(sessionId)) throw new Error('本次任务已经有一个等待中的挂起');
          let wakeAt: Date;
          if (args.minutes != null && args.minutes !== '') {
            const minutes = Number(args.minutes);
            if (!Number.isFinite(minutes) || minutes < 1 || minutes > 720) throw new Error('minutes 需在 1-720 之间');
            wakeAt = new Date(Date.now() + minutes * 60000);
          } else wakeAt = new Date(String(args.wake_at || ''));
          if (Number.isNaN(wakeAt.getTime())) throw new Error('wake_at 时间格式无效，请用 ISO 格式或改用 minutes');
          if (wakeAt.getTime() <= Date.now()) throw new Error('唤醒时间必须晚于当前时间');
          if (wakeAt.getTime() - Date.now() > 12 * 3600 * 1000) throw new Error('挂起最长 12 小时，请缩短等待时间');
          control = { kind: 'sleep', wake: { wakeAt: wakeAt.toISOString(), reason: String(args.reason || '').trim() || '等待约定时间' } };
        } else {
          const summary = String(args.summary || '').trim();
          if (!summary) throw new Error('交付内容不能为空');
          control = { kind: 'finish', finish: { summary, evidence: String(args.evidence || ''), ...(args.goalAchieved === true ? { goalAchieved: true } : {}) } };
        }
        controls.set(execution.callId, control);
        return { text: name === 'sleep_until' ? `本轮已挂起，等待宿主登记唤醒：${control.wake.wakeAt}` : '本轮已结束，等待宿主核对交付证据', control: true };
      }
      if (name === 'save_memory') {
        const content = String(args.content || '').trim();
        if (!content) throw new Error('记忆内容不能为空');
        const record = await this.writeNative(async () => {
          signal.throwIfAborted();
          return this.ctx.memory.append({ category: String(args.category || '常用信息'), content,
            name: String(args.name || '').trim().slice(0, 30), kind: String(args.kind || 'fact'),
            scope: String(args.scope || 'global'), relation: String(args.relation || 'extends'),
            relatedMemoryId: String(args.related_memory_id || '') }, options.workspacePath, sessionId);
        });
        if (!record) throw new Error('记忆未保存');
        emit({ type: 'memory-saved', item: record, persisted: true });
        return `记忆已保存，编号：${record.id}`;
      }
      if (typeof options.onExtraTool !== 'function') throw new Error('当前任务没有可用的应用工具入口');
      return options.onExtraTool(name, args);
    };
    runtime.options.onQuestion = (questions: any[], requestSignal: AbortSignal) => answerDshQuestions(questions,
      options.requestUserInput, AbortSignal.any([signal, requestSignal]));
    const toolRecords = new Map<string, any>();
    const trace = createDshTrace(sessionId, emit);
    let text = ''; let reasoning = ''; let activityCount = 0;
      const decodeAssistant = async (message: any) => {
        const blocks = (message.content || []).filter((block:any)=>['text','image','image_url'].includes(block.type));
        if (blocks.length === 1 && blocks[0].type === 'text') return {role:'assistant',content:blocks[0].text};
        return {role:'assistant',content:await Promise.all(blocks.map(async (block:any)=> {
          if (block.type === 'text') return {type:'text',text:block.text};
          const image = await runtime.persistenceContext.attachments.readImage(block.attachment);
          return {type:'image_url',image_url:{url:`data:${block.attachment.mediaType};base64,${Buffer.from(image.data).toString('base64')}`}};
        }))};
      };
    const liveTurns = createLiveDshTurns(decodeAssistant, turns => emit({type:'dsh-conversation',turns}));
    runtime.options.approve = async (tool: any) => {
      const allowed = await approval(tool);
      if (allowed && typeof tool.args?.path === 'string' && !targets.has(tool.args.path))
        targets.set(tool.args.path, await fileInspector.fileSnapshot(options.workspacePath, tool.args.path));
      return allowed;
    };
    runtime.options.generate = (request: any) => {
      let traceRequest: any; let liveRequest: string | undefined;
      return generateWithDyworker(settings, { ...request,
      signal: AbortSignal.any([request.signal, signal].filter(Boolean)) }, {
      fetchImpl: options.fetchImpl,
      attachments: runtime.persistenceContext?.attachments,
      onRequest: (payload: any) => { traceRequest = trace.request(request.sessionId, payload); if (request.sessionId === sessionId && request.purpose !== 'compaction') liveRequest = liveTurns.start(request); },
      onResponse: (message: any) => trace.response(request.sessionId, traceRequest, message),
      onText: (value: string) => { if (request.sessionId === sessionId && request.purpose !== 'compaction') { text = value; liveTurns.text(liveRequest,value); emit({ type: 'assistant-text', text }); } },
      onReasoning: (value: string) => { if (request.sessionId === sessionId && request.purpose !== 'compaction') { reasoning = value; liveTurns.reasoning(liveRequest,value); emit({ type: 'assistant-reasoning', text: reasoning }); } },
      onUsage: (usage: any) => {
        trace.usage(request.sessionId, traceRequest, usage);
        emit({ type: 'token-usage', model: usage.model || settings.model, prompt: Number(usage.prompt_tokens) || 0,
          completion: Number(usage.completion_tokens) || 0, estimated: Boolean(usage.estimated) });
        if (request.sessionId === sessionId && request.purpose !== 'compaction') emit({ type: 'context-usage',
          used: Number(usage.prompt_tokens) || 0, completion: Number(usage.completion_tokens) || 0, estimated: Boolean(usage.estimated) });
      },
      });
    };
    runtime.options.onEvent = ({ sessionId: owner, event }: any) => {
      trace.event(owner, event);
      if (owner === sessionId) liveTurns.event(event);
      const data = event.data || {};
      if (event.type === 'tool/call') {
        let args: any;
        try { args = typeof data.arguments === 'string' ? JSON.parse(data.arguments) : data.arguments; } catch { args = {}; }
        toolRecords.set(`${owner}:${data.callId}`, { name: data.name, args, status: 'running' });
        activityCount++; emit({ type: 'activity', activity: { id: `${owner}:${data.callId || event.id || event.seq}`,
          kind: 'run_command', title: `DSH：${data.name || data.call?.name || '工具操作'}`, detail: String(data.arguments || '{}'),
          status: 'running', createdAt: new Date().toISOString() } });
      }
      if (event.type === 'tool/result') {
        const key = `${owner}:${data.message?.source?.callId}`;
        const record = toolRecords.get(key);
        if (record) { record.status = data.message?.isError ? 'error' : 'success';
          record.result = (data.message?.content || []).filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n'); }
        const callId = data.message?.source?.callId;
        if (owner === sessionId && controls.has(callId)) {
          if (!data.message?.isError) outcome = controls.get(callId);
          controls.delete(callId);
        }
        emit({ type: 'activity-update', id: key, status: data.message?.isError ? 'error' : 'success', detail: JSON.stringify(data.message?.content ?? data.error ?? '') });
      }
      if (['compaction/summary', 'compaction/prune'].includes(event.type)) emit({ type: 'context-compacted' });
      options.onDshEvent?.({ sessionId: owner, event });
    };
    try {
      entry.ready ??= runtime.start(signal);
      await entry.ready;
      const prior = await runtime.request('snapshot', {}, { signal });
      const admitted: any[] = [];
      for (const part of nativeContent) {
        signal.throwIfAborted();
        admitted.push(part.type === 'encoded-file' ? { type: 'file', attachment: await runtime.persistenceContext.attachments.admitEncodedFile(part) } : part);
      }
      const dshContent = await runtime.persistenceContext.attachments.admitPromptContent(admitted);
      // 分支/导入会话的实际可见历史作为明确的导入材料，不冒充已有 DSH 事件。
      if (!childPrompt && !prior.events.some((event: any) => event.type === 'user/message') && options.conversation?.length > 1) {
        const imported = options.conversation.slice(0, -1).map((message: any) => `${message.role}：${typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}`).join('\n\n');
        await runtime.request('inject', { text: `以下是此会话导入的历史记录：\n${imported}` }, { signal });
      }
      const instructions = await loadProjectInstructions(options.workspacePath);
      const memoryPages = await options.resolvers.readMemoryPages?.(sessionId) ?? [];
      const pages = selectWikiPages(memoryPages, { workspacePath: options.workspacePath, query: prompt, limit: 3 });
      const sessionMemory = memoryPages.find((page: any) => page.relPath === 'pages/session.md');
      if (sessionMemory && !pages.includes(sessionMemory)) pages.unshift(sessionMemory);
      const context = [options.goal ? `当前长期目标：${options.goal}。继续推进尚未完成的工作并验证结果；只有整个目标已达成，才在 finish_task 中设置 goalAchieved=true。完成本轮的一部分工作不代表目标达成。用户当前要求优先。` : '当前没有进行中的长期目标。历史目标可能已暂停、删除或完成，不要自行恢复执行。', options.workingContext,
        nativeSkills.context,
        instructions ? `工作区 AGENTS.md 的约定；若与用户当前要求冲突，以当前要求为准：\n${instructions}` : '',
        pages.length ? `相关长期记忆仅作为背景；若与用户当前要求冲突，以当前要求为准：\n${pages.map((page: any) => `## ${page.title}\n${String(page.content || '').slice(0, 2600)}`).join('\n\n')}` : ''];
      await runtime.request('context', { text: context.filter(Boolean).join('\n\n') }, { signal });
      if (childPrompt) {
        const receipt = await runtime.request('start-child', {prompt:childPrompt,files:[...preparedChildFiles]}, {signal});
        options.onChildAdmitted?.(receipt);
      } else await runtime.request('prompt', { content: dshContent }, { signal, timeoutMs: 24 * 60 * 60 * 1000 });
      // 应用入口的工具路由和取消监听由 AgentService 在返回时释放。
      // 在独立后台入口接管它们之前，必须等待所属工作及完成通知，不能把旧授权留给下一轮。
      await runtime.request('wait-jobs', {}, { signal, timeoutMs: 24 * 60 * 60 * 1000 });
      const result = await runtime.request('snapshot', {}, { signal });
      await this.saveOverview(sessionId, result);
      const childResult = childPrompt ? await runtime.request('child-snapshot', {childId:childPrompt.childSessionId}, {signal}) : undefined;
      const events = childResult ? childResult.events.slice(priorChild.events.length) : result.events.slice(prior.events.length);
      const ended = [...events].reverse().find((event: any) => event.type === 'turn/end');
      const reason = ended?.data?.reason;
      const messages = events.filter((event: any) => event.type === 'assistant/message').map((event: any) => event.data.message);
      const dshTurns = await liveTurns.seal();
      text = [...messages].reverse().map((message: any) => (message.content || []).map((block: any) => block.type === 'text' ? block.text : (block.type === 'image' || block.type === 'image_url') ? '[包含图片]' : '').filter(Boolean).join('\n')).find(Boolean) || text;
      if (outcome?.kind === 'finish') text = pickDeliveryText((messages.at(-1)?.content || [])
        .map((block: any) => block.type === 'text' ? block.text : (block.type === 'image' || block.type === 'image_url') ? '[包含图片]' : '').filter(Boolean).join('\n'), outcome.finish.summary, text);
      if (reason?.kind === 'error') return { dshTurns, status: 'error', finalText: text, reason: reason.error?.message || 'DSH 任务执行失败' };
      if (reason?.kind === 'aborted') return { dshTurns, status: 'cancelled', finalText: text };
      if (reason?.kind !== 'completed') return { dshTurns, status: 'paused', finalText: text, reason: reason?.kind === 'max-tokens' ? '模型回复达到长度限制' : 'DSH 任务没有完成' };
      const changes = []; const receipts = [];
      for (const [file, before] of targets) {
        const after = await fileInspector.fileSnapshot(options.workspacePath, file);
        if (after?.exists && after.sha256 !== before?.sha256) {
          changes.push({ path: after.path, added: 0, removed: 0, diff: `${before?.exists ? '修改' : '创建'}文件，${after.sizeBytes} 字节；已读取实际文件核对。` });
          receipts.push({ path: after.path, sha256: after.sha256, sizeBytes: after.sizeBytes });
        }
      }
      if (changes.length) emit({ type: 'file-change', changes });
      const executedTools = [...toolRecords.values()];
      const todos = [...result.events].reverse().find((event: any) => event.type === 'todo/write')?.data?.todos;
      const verification = verifyTaskEvidence({ finalText: outcome?.kind === 'finish' ? `${text}\n${outcome.finish.summary}` : text,
        executedTools, fileChanges: changes, workspacePath: options.workspacePath, planSteps: todos,
        isExplicitFinish: outcome?.kind === 'finish' });
      if (outcome?.kind === 'sleep') {
        await this.close(sessionId);
        return { dshTurns, status: 'sleeping', finalText: text, wake: outcome.wake, executedTools, changes, hostReceipts: receipts };
      }
      return { status: verification.verified ? 'done' : verification.verdict === 'failed' ? 'error' : 'unverified',
        finalText: verification.verified ? text : `${text}\n\n> ⚠️ **系统核验提示**：${verification.reason}`.trim(),
        ...(verification.verified ? {} : { reason: verification.reason }), verification, executedTools, changes, hostReceipts: receipts,
        ...(verification.verified && outcome?.kind === 'finish' ? { finish: outcome.finish,
          ...(options.goal && outcome.finish.goalAchieved ? { goalAchieved: true } : {}) } : {}),
        dsh: { sessionId, eventCount: events.length, activityCount }, dshTurns,
        executedMessages: await Promise.all(messages.map(async (message: any) => {
          const contentBlocks = (message.content || []).filter((block: any) => block.type === 'text' || block.type === 'image' || block.type === 'image_url');
          if (contentBlocks.length === 0) return { role: 'assistant', content: '' };
          if (contentBlocks.length === 1 && contentBlocks[0].type === 'text') return { role: 'assistant', content: contentBlocks[0].text };
          return { role: 'assistant', content: (await Promise.all(contentBlocks.map(async (block: any) => {
            if (block.type === 'text') return { type: 'text', text: block.text };
            if (block.type === 'image' || block.type === 'image_url') {
              const image = await runtime.persistenceContext.attachments.readImage(block.attachment, signal);
              const url = `data:${block.attachment.mediaType};base64,${Buffer.from(image.data).toString('base64')}`;
              return { type: 'image_url', image_url: { url } };
            }
            return null;
          }))).filter(Boolean) };
        })) };
    } catch (error) {
      const dshTurns = await liveTurns.seal();
      await this.close(sessionId);
      if (signal.aborted) return { dshTurns, status: 'cancelled', finalText: text };
      if (dshTurns.length) return {dshTurns,status:'error',finalText:text,reason:error instanceof Error ? error.message : String(error)};
      throw error;
    } finally {
      await liveTurns.seal().catch(()=>{});
      // 先撤销本轮授权再允许新任务，避免迟到的清理覆盖下一轮模型入口。
      runtime.options.approve = async () => false;
      runtime.options.onExtraTool = undefined;
      runtime.options.onQuestion = undefined;
      runtime.options.generate = async function* () { throw new Error('当前 DSH 会话没有已授权的模型任务'); };
      entry.activeInput = undefined;
      entry.busy = false;
    }
  }
  async request(sessionId: string, action: string, payload: any = {}, options: any = {}) {
    if(this.closed&&action!=='history-close')throw this.carrierLost();
    if(action==='session-create'||action==='session-fork')return this.writeNative(async()=>{
      const signal=AbortSignal.any([this.searchLifetime.signal,...(options.signal?[options.signal]:[])]);signal.throwIfAborted();
      if(action==='session-create')return birthDshTask({dir:this.config.dir,archive:this.ctx.sessions,request:payload,
        defaultSessionId:payload.defaultSessionId,signal});
      if(!payload.address||typeof payload.sourceRootId!=='string')throw new Error('复制任务需要原任务的确切地址');
      const sourceRecord=await this.ctx.sessions.getAsync(payload.sourceRootId);
      if(sourceRecord?.runtime!=='dsh')throw new Error('原任务不是已保存的 DSH 任务');
      const authority={id:sourceRecord.id,createdAt:sourceRecord.createdAt,workspacePath:sourceRecord.workspacePath};
      const active=this.sessions.get(sourceRecord.id)?.runtime;
      if(active){
        const source=await active.request('history-fork-seed',payload,{signal});
        return birthDshTask({dir:this.config.dir,archive:this.ctx.sessions,request:{},signal,sourceRecord:authority,
          fork:{...source,store:active.persistenceContext.attachments}});
      }
      const source=await readDshForkSource({dataDir:path.join(this.config.dir,createHash('sha256').update(sourceRecord.id).digest('hex')),
        rootId:sourceRecord.id,cwd:await fs.realpath(sourceRecord.workspacePath),payload,signal,
        });
      try{
        return await birthDshTask({dir:this.config.dir,archive:this.ctx.sessions,request:{},signal,sourceRecord:authority,
          fork:{...source.source,store:source.store}});
      }finally{await source.dispose();}
    });
    if(action==='global-search'||action==='global-list'){
      const signal=AbortSignal.any([this.searchLifetime.signal,...(options.signal?[options.signal]:[])]);
      const corpus={dir:this.config.dir,signal,roots:()=>this.ctx.sessions.loadAll(),active:(id:string)=>this.sessions.get(id)?.runtime,ready:async(id:string,runtime:any,signal:AbortSignal)=>{
        const entry=this.sessions.get(id);if(entry?.runtime!==runtime)throw this.carrierLost();
        if(!entry.ready)return;
        await new Promise<void>((resolve,reject)=>{
          const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
          if(signal.aborted)abort();
          Promise.resolve(entry.ready).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
        });
      }};
      const pending=(async()=>{
        await this.waitForProfileSwitch(signal);signal.throwIfAborted();
        if(action==='global-search')return searchDshSessions({...corpus,query:payload.query});
        const readGeneration=async()=>{
          const plugins=await this.ctx.plugins.dshSessionPlugins();
          let lock:string|null=null;
          try{lock=await fs.readFile(path.join(this.ctx.plugins.dir,'package-lock.json'),'utf8');}
          catch(error:any){if(error.code!=='ENOENT')throw error;}
          signal.throwIfAborted();
          return {plugins,signature:JSON.stringify([plugins,lock,this.profileSwitchGeneration])};
        };
        const generation=await readGeneration();
        const result=await listDshSessions({...corpus,pluginCache:{profileDir:this.ctx.plugins.dir,plugins:generation.plugins}});
        await this.waitForProfileSwitch(signal);
        if((await readGeneration()).signature!==generation.signature)throw new Error('读取期间插件已变化，请重新读取');
        return result;
      })();
      this.searches.add(pending);
      try{return await pending;}finally{this.searches.delete(pending);}
    }
    if(action === 'session-rename') return this.writeNative(async()=>{
      const accepted = await this.requestDirect(sessionId,action,payload,options);
      if(payload.address?.kind === 'session') {
        const current = await this.ctx.sessions.getAsync(sessionId);
        if(current?.runtime !== 'dsh') throw new Error('标题所属任务已经删除');
        await this.ctx.sessions.replace({...current,title:accepted.title,titleCustom:true});
      }
      return accepted;
    });
    return this.requestDirect(sessionId,action,payload,options);
  }
  private async requestDirect(sessionId:string,action:string,payload:any,options:any) {
    let entry = this.sessions.get(sessionId);
    if(action==='history-close'||action==='history-next'){
      const owned=this.historyCarriers.get(payload.streamId);
      if(!owned||owned.rootId!==sessionId){if(action==='history-close')return false;throw this.carrierLost();}
      if(action==='history-close'){
        this.historyCarriers.delete(payload.streamId);
        return owned.runtime.request(action,payload,options).catch(()=>false);
      }
      if(entry?.runtime!==owned.runtime){this.historyCarriers.delete(payload.streamId);throw this.carrierLost();}
      try{
        const result=await owned.runtime.request(action,payload,options);options.signal?.throwIfAborted();
        if(this.sessions.get(sessionId)?.runtime!==owned.runtime)throw this.carrierLost();
        if(result.done)this.historyCarriers.delete(payload.streamId);
        return result;
      }catch(error:any){
        // A rejected concurrent read does not release the first reader's handle.
        if(error?.code!=='gateway/bad-request'||options.signal?.aborted)this.historyCarriers.delete(payload.streamId);
        if(!owned.runtime.child?.connected&&this.sessions.get(sessionId)?.runtime===owned.runtime)await this.close(sessionId);
        throw error;
      }
    }
    if (['input-admit','input-update-queue','input-cancel','child-prompt','child-interrupt','session-command'].includes(action)) {
      // 冷历史和只读进程没有模型资格，公开输入不能唤醒它们或借用已经结束的授权。
      const code = action.startsWith('child-') ? 'subagent/parent-unavailable' : 'dyworker/input-unavailable';
      const details = action.startsWith('child-') ? {parentSessionId:sessionId} : {sessionId};
      const active = entry?.activeInput;
      if (!entry?.busy || !active || active.signal.aborted) throw Object.assign(new Error('此任务没有正在接收输入的授权运行'),{code,details});
      let result;
      try { result = await entry.runtime.request(action, payload, {...options,
        signal:AbortSignal.any([active.signal, ...(options.signal ? [options.signal] : [])])}); }
      catch (error) {
        if (active.signal.aborted) throw Object.assign(new Error('此任务的授权运行已经结束，输入未发送'),{code,details});
        throw error;
      }
      // 已经提交到原任务的确认不能因随后任务完成而变成失败，防止调用者重复发送。
      return result;
    }
    await this.waitForProfileSwitch(options.signal);
    entry=this.sessions.get(sessionId);
    if (!entry) {
      if (!this.opening.has(sessionId)) {
        const pending = this.openForView(sessionId);
        this.opening.set(sessionId, pending);
        void pending.finally(() => { if (this.opening.get(sessionId) === pending) this.opening.delete(sessionId); }).catch(() => {});
      }
      entry = await this.opening.get(sessionId);
    }
    await entry.ready;
    options.signal?.throwIfAborted();
    if(this.sessions.get(sessionId)!==entry)throw this.carrierLost();
    if (action === 'compact') {
      if(this.profileSwitch)throw new Error('插件正在切换，请等待安装完成后再压缩上下文');
      if (entry.busy) throw new Error('此 DSH 会话已有运行中的任务');
      entry.busy = true;
      try {
        const settings = await this.ctx.settings.read();
        entry.runtime.options.generate = (request: any) => generateWithDyworker(settings, { ...request,
          signal: AbortSignal.any([request.signal, options.signal].filter(Boolean)) }, { attachments: entry.runtime.persistenceContext.attachments,
          fetchImpl: options.fetchImpl });
        const result = await entry.runtime.request(action, payload, options);
        await this.saveOverview(sessionId, await entry.runtime.request('snapshot', {}, options));
        return result;
      }
      finally { entry.busy = false; entry.runtime.options.generate = async function* () { throw new Error('当前 DSH 会话没有已授权的模型任务'); }; }
    }
    let result:any;
    try {result=await entry.runtime.request(action,payload,options);}
    catch(error){
      if(!entry.runtime.child?.connected&&this.sessions.get(sessionId)===entry)await this.close(sessionId);
      throw error;
    }
    if(action==='history-open'||action==='history-control-open'){
      if(this.sessions.get(sessionId)!==entry){
        await entry.runtime.request('history-close',{streamId:result.streamId}).catch(()=>{});throw this.carrierLost();
      }
      this.historyCarriers.set(result.streamId,{rootId:sessionId,runtime:entry.runtime});
    }else if(['history-page','history-list','history-state','history-search','session-image'].includes(action)&&this.sessions.get(sessionId)!==entry)
      throw this.carrierLost();
    if (action === 'snapshot') await this.saveOverview(sessionId, result);
    if (action === 'inject') await this.saveOverview(sessionId, await entry.runtime.request('snapshot', {}, options));
    return result;
  }
  /** 只由原生附件授权调用，不在通用界面操作白名单里开放文件路径。 */
  async commandAttachments(sessionId: string, prepare: (dataDir: string) => Promise<any>) {
    await this.request(sessionId, 'snapshot');
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error('附件所属 DSH 会话已经关闭');
    const staged = await prepare(entry.runtime.options.dataDir);
    try { return await entry.runtime.request('command-attachments', { files: staged.files }); }
    finally { await staged.dispose(); }
  }
  private async openForView(sessionId: string) {
      await this.retiring.get(sessionId);
      if(this.closed||this.profileSwitch)throw this.carrierLost();
      const session = await this.ctx.sessions.getAsync(sessionId);
      if (session?.runtime !== 'dsh' || !session.workspacePath) throw new Error('此会话不是已保存的 DSH 插件会话');
      const settings = await this.ctx.settings.read();
      const specification = await this.ctx.plugins.dshSessionPlugins();
      if(this.closed||this.profileSwitch)throw this.carrierLost();
      // A newly authorized run can claim the root during the asynchronous reads.
      // Reuse that actual owner instead of replacing it with a second cold worker.
      const existing=this.sessions.get(sessionId);
      if(existing){await existing.ready;return existing;}
      const runtime = new OfficialDshSession({ profileDir: this.ctx.plugins.dir, sessionId, model: settings.model,
        workspacePath: session.workspacePath, plugins: specification, mods:this.ctx.get('mods'),
        dataDir: path.join(this.config.dir, createHash('sha256').update(sessionId).digest('hex')),
        approve: async () => false, async *generate() { throw new Error('当前 DSH 会话没有已授权的模型任务'); } });
      const entry = { runtime, busy: true, version: JSON.stringify([session.workspacePath, settings.model, specification]), ownerIds: specification.map((item: any) => item.id), ready: runtime.start() };
      this.sessions.set(sessionId, entry);
      try { await entry.ready; return entry; }
      catch (error) { await this.close(sessionId); throw error; }
      finally { entry.busy = false; }
  }
}
