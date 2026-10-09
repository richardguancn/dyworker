import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { spawnPluginProcess, terminatePluginProcess } from './process.mts';
import { Context } from '@deepseek-ai/cordis';
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import { PtcExecutor } from './ptc-executor.mts';
import LocalAttachments from '@deepseek-ai/dsh-attachment-local';
import { StreamedAttachmentUpload } from './streamed-upload.mts';

// 一个进程只拥有一个根会话及其子任务；强制停止不影响别的会话。
export class OfficialDshSession {
  readonly options: any;
  child: any;
  pending = new Map<string, any>();
  streams = new Map<string, any>();
  attachmentUploads = new Map<string, StreamedAttachmentUpload>();
  attachmentUploadRequests = new Map<string, string>();
  attachmentUploadOperations = new Set<Promise<any>>();
  operations = new Set<Promise<any>>();
  requests = new Map<string, AbortController>();
  extraGrants = new Map<string, string>();
  ptcGrants = new Map<string, string>();
  ptcExecutor: PtcExecutor;
  persistenceContext: any;
  sessionHeaders = new Map<string, any>();
  handles = new Map<string, any>();
  forwardedEventSeq = new Map<string, number>();
  retiredEvents = new Map<string, Map<number, any>>();
  retiringSessions = new Map<string, Promise<void>>();
  stopping: Promise<void>;
  lifecycle = new AbortController();
  constructor(options: any) { this.options = options; }
  ownsSession(id: string) {
    if (id === this.options.sessionId) return true;
    const visited = new Set<string>();
    while (id && !visited.has(id)) {
      visited.add(id);
      const header = this.sessionHeaders.get(id);
      if (!header || path.resolve(header.cwd || '') !== path.resolve(this.options.workspacePath)) return false;
      id = header.parentSession;
      if (id === this.options.sessionId) return true;
    }
    return false;
  }
  async start(signal?: AbortSignal) {
    signal = signal ? AbortSignal.any([signal, this.lifecycle.signal]) : this.lifecycle.signal;
    signal?.throwIfAborted();
    if (this.child) throw new Error('DSH 会话已经启动');
    await fs.mkdir(this.options.dataDir, { recursive: true });
    const input = { profileDir: this.options.profileDir, sessionId: this.options.sessionId, model: this.options.model,
      plugins: (this.options.plugins || []).map(({ id, entryUrl, config, options }: any) => ({ id, entryUrl, config, options })),
      extraTools: this.options.extraTools || [],
      fixedExtraTools: this.options.fixedExtraTools || [],
      dataDir: await fs.realpath(this.options.dataDir), workspacePath: await fs.realpath(this.options.workspacePath) };
    this.options.workspacePath = input.workspacePath;
    this.persistenceContext = new Context();
    try {
      await this.persistenceContext.plugin(Persistence, { root: path.join(input.dataDir, 'sessions'), compression: 'none' });
      await this.persistenceContext.plugin(LocalAttachments, { dshHome: path.join(input.dataDir, 'attachment-home') });
      signal.throwIfAborted();
      this.child = spawnPluginProcess('full-worker', input);
    } catch (error) { await this.persistenceContext.fiber.dispose(); throw error; }
    let stderr = '';
    this.child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
    this.child.on('message', (message: any) => {
      const operation = this.receive(message, input); this.operations.add(operation);
      void operation.finally(() => this.operations.delete(operation)).catch(error => {
        for (const wait of this.pending.values()) wait.reject(error);
        this.pending.clear(); void this.stop();
      });
    });
    this.child.on('exit', () => {
      for (const wait of this.pending.values()) wait.reject(Object.assign(new Error(`DSH 进程已经退出：${stderr}`),{code:'dyworker/history-carrier-lost',details:{}}));
      this.pending.clear();
      for (const controller of this.requests.values()) controller.abort(new Error('DSH 会话已停止'));
    });
    // IPC 在 connected 检查后仍可能断开；启动后的 error 也必须有人接收。
    this.child.on('error', error => {
      for (const wait of this.pending.values()) wait.reject(error);
      this.pending.clear();
      for (const controller of this.requests.values()) controller.abort(error);
      void this.stop().catch(() => {});
    });
    try {
      return await new Promise<any>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); this.child.off('message', listener); this.child.off('error', fail);
          this.child.off('exit', exited); signal?.removeEventListener('abort', fail); };
        const fail = (error?: any) => { cleanup(); reject(signal?.aborted ? signal.reason : error || new Error('DSH 启动失败')); };
        const exited = () => fail(new Error(`DSH 启动时退出：${stderr}`));
        const listener = (value: any) => { if (value.type === 'ready') { cleanup(); resolve(value); }
          else if (value.type === 'startup-error') fail(new Error(`${value.error}${stderr.trim() ? `：${stderr.trim()}` : ''}`)); };
        const timer = setTimeout(() => fail(new Error('DSH 启动超时')), 20_000);
        this.child.on('message', listener); this.child.once('error', fail); this.child.once('exit', exited);
        signal?.addEventListener('abort', fail, { once: true }); this.child.send(input);
      });
    } catch (error) { await this.stop(); throw error; }
  }
  async receive(message: any, input: any) {
    if (message.type === 'response') {
      const wait = this.pending.get(message.id); if (!wait) return;
      this.pending.delete(message.id);
      if (message.error) wait.reject(Object.assign(new Error(message.error),
        ...(message.errorCode ? [{code:message.errorCode,details:message.errorDetails}] : []))); else wait.resolve(message.value);
      return;
    }
    if (message.type === 'session-event') {
      const live = [...this.handles.values()].some(handle => handle.id === message.sessionId && handle.access === 'write');
      if (!live) {
        await this.retiringSessions.get(message.sessionId);
        // 关闭写入句柄与末尾通知可能交错；仅放行关闭前已经实际存储、尚未转发的原记录。
        const remaining = this.retiredEvents.get(message.sessionId);
        const stored = remaining?.get(message.event?.seq);
        if (!this.ownsSession(message.sessionId) || !stored || !isDeepStrictEqual(stored,message.event))
          throw new Error(`会话事件不属于此运行环境的写入句柄：${message.sessionId}（${message.event?.type}，序号 ${message.event?.seq}，已转发 ${this.forwardedEventSeq.get(message.sessionId) ?? -1}，待通知 ${[...(remaining?.keys() ?? [])].slice(-12).join(',')}）`);
        remaining.delete(message.event.seq);
        if (!remaining.size) this.retiredEvents.delete(message.sessionId);
      }
      this.forwardedEventSeq.set(message.sessionId,Math.max(this.forwardedEventSeq.get(message.sessionId) ?? -1,message.event.seq));
      this.persistenceContext.emit('session/event', { id: message.sessionId }, message.event);
      if (message.event?.type === 'tool/result') this.extraGrants.delete(message.event.data?.message?.source?.callId);
      if (message.event?.type === 'tool/result') this.ptcGrants.delete(message.event.data?.message?.source?.callId);
      this.options.onEvent?.(message); return;
    }
    if (message.type === 'cancel-request') {
      this.requests.get(message.id)?.abort(new Error('请求已取消'));
      // upload-open 的响应可能在取消后才到达；即使子进程尚不知道编号也能释放上传。
      const uploadId = this.attachmentUploadRequests.get(message.id);
      if (uploadId) {
        this.attachmentUploads.get(uploadId)?.abort(new Error('请求已取消'));
        this.attachmentUploads.delete(uploadId); this.attachmentUploadRequests.delete(message.id);
      }
      return;
    }
    if (message.type === 'model-close') {
      const stream = this.streams.get(message.streamId); this.streams.delete(message.streamId);
      stream?.controller.abort(); void stream?.iterator.return?.(); return;
    }
    if (!['model-open', 'model-next', 'tool-approval', 'extra-tool', 'ptc-run', 'user-question', 'file-handle', 'persistence', 'attachment'].includes(message.type)) return;
    if (this.lifecycle.signal.aborted) {
      if (this.child?.connected) this.child.send({ type: message.type === 'file-handle' ? 'file-handle-result' : 'parent-result',
        id: message.id, error: 'DSH 会话已停止' });
      return;
    }
    const controller = new AbortController(); this.requests.set(message.id, controller);
    try {
      let value: any;
      if (message.type === 'persistence') {
        const service = this.persistenceContext.sessionPersistence;
        const payload = message.payload || {};
        if (message.action === 'create' || message.action === 'open') {
          if (message.action === 'create' && (path.resolve(payload.header?.cwd || '') !== input.workspacePath
            || (payload.header?.id !== input.sessionId && !this.ownsSession(payload.header?.parentSession))))
            throw new Error('新会话不属于此运行环境的工作目录和任务');
          const handle = message.action === 'create' ? await service.create(payload.header,
            { inheritedEventCount: payload.inheritedEventCount, signal: controller.signal })
            : await service.open(payload.id, payload.access, { signal: controller.signal });
          const key = randomUUID(); this.handles.set(key, handle); this.sessionHeaders.set(handle.id, handle.header);
          value = { key, id: handle.id, header: handle.header, access: handle.access, inheritedEventCount: handle.inheritedEventCount };
        } else if (message.action === 'stat') value = await service.stat(payload.id, { signal: controller.signal });
        else if (message.action === 'list') value = await service.list({ signal: controller.signal });
        else if (message.action === 'flush') { await service.flush(); value = true; }
        else if (message.action === 'session-flush') {
          await this.persistenceContext.parallel('session/flush', { id: payload.id }); value = true;
        }
        else {
          const handle = this.handles.get(payload.key);
          if (!handle && message.action === 'handle-close') { value = true; }
          else if (!handle) throw new Error('会话句柄已关闭或不属于此运行环境');
          else if (message.action === 'handle-read') value = await handle.read(payload.offset, payload.length, { signal: controller.signal });
          else if (message.action === 'handle-append') { await handle.append(payload.events, { signal: controller.signal }); value = true; }
          else if (message.action === 'handle-flush') { await handle.flush({ signal: controller.signal }); value = true; }
          else if (message.action === 'handle-close') {
            if (handle.access === 'write') {
              const retirement = (async () => {
                // close 会继续排空关闭期间到达的真实事件；必须读关闭后的最终日志，不能提前快照。
                await handle.close(); this.handles.delete(payload.key);
                const reader = await service.open(handle.id,'read');
                try {
                  const saved = await reader.read();
                  const last = this.forwardedEventSeq.get(handle.id) ?? -1;
                  const pending = saved.events.filter((event: any)=>event.seq > last);
                  const remaining = this.retiredEvents.get(handle.id) ?? new Map();
                  for (const event of pending) remaining.set(event.seq,event);
                  if (remaining.size) this.retiredEvents.set(handle.id,remaining);
                } finally { await reader.close(); }
              })();
              this.retiringSessions.set(handle.id,retirement);
              try { await retirement; }
              finally { if (this.retiringSessions.get(handle.id) === retirement) this.retiringSessions.delete(handle.id); }
            } else { await handle.close(); this.handles.delete(payload.key); }
            value = true;
          }
          else throw new Error('未知的会话持久化操作');
        }
      } else if (message.type === 'attachment') {
        const store = this.persistenceContext.attachments;
        controller.signal.throwIfAborted();
        if (message.action === 'upload-open') {
          const id = randomUUID(); const upload = new StreamedAttachmentUpload(store, message.name);
          this.attachmentUploadOperations.add(upload.result);
          void upload.result.finally(() => this.attachmentUploadOperations.delete(upload.result)).catch(() => {});
          this.attachmentUploads.set(id, upload); this.attachmentUploadRequests.set(message.id, id); value = id;
        } else if (['upload-write', 'upload-close', 'upload-abort'].includes(message.action)) {
          const upload = this.attachmentUploads.get(message.uploadId);
          if (!upload) throw new Error('附件上传已结束');
          for (const [requestId, uploadId] of this.attachmentUploadRequests) if (uploadId === message.uploadId) this.attachmentUploadRequests.delete(requestId);
          if (message.action === 'upload-abort') { upload.abort(); this.attachmentUploads.delete(message.uploadId); value = true; }
          else {
            const abort = () => upload.abort(controller.signal.reason);
            controller.signal.addEventListener('abort', abort, { once: true });
            try {
              if (message.action === 'upload-write') {
                if (typeof message.data !== 'string' || message.data.length > 87384) throw new Error('附件分块过大');
                await upload.write(Buffer.from(message.data, 'base64')); value = true;
              } else value = await upload.end();
            } finally { controller.signal.removeEventListener('abort', abort);
              if (message.action === 'upload-close') this.attachmentUploads.delete(message.uploadId); }
          }
        } else if (message.action === 'save-images' || message.action === 'validate-image') {
          const inputs = (message.inputs || []).map((item: any) => ({ ...item, data: Buffer.from(item.data, 'base64') }));
          if (message.action === 'validate-image') { await store.validateImage(inputs[0]); value = true; }
          else value = await store.saveImages(inputs);
        } else if (message.action === 'read-image' || message.action === 'read-request-image') {
          const image = message.action === 'read-image' ? await store.readImage(message.ref, controller.signal)
            : await store.readImageRequest(message.ref, message.target, controller.signal);
          value = { ...image, data: Buffer.from(image.data).toString('base64') };
        } else throw new Error('未开放的附件操作');
      } else if (message.type === 'model-open') {
        if (!this.options.generate) throw new Error('没有接入模型提供方');
        const streamId = randomUUID();
        const iterator = this.options.generate({ ...message.request, signal: controller.signal })[Symbol.asyncIterator]();
        this.streams.set(streamId, { iterator, controller }); value = streamId;
      } else if (message.type === 'model-next') {
        const stream = this.streams.get(message.streamId); if (!stream) throw new Error('模型请求已结束');
        const aborted = () => stream.controller.abort(controller.signal.reason);
        controller.signal.addEventListener('abort', aborted, { once: true });
        try { value = await stream.iterator.next(); }
        finally { controller.signal.removeEventListener('abort', aborted); }
      } else if (message.type === 'tool-approval') {
        // 身份及工作目录由父进程确定；插件不能要求换到另一会话或权限模式。
        value = this.ownsSession(message.tool?.sessionId) && typeof this.options.approve === 'function'
          && await this.options.approve({ ...message.tool, dshSessionId: message.tool.sessionId,
            sessionId: input.sessionId, workspacePath: input.workspacePath, signal: controller.signal }) === true;
        if (value && input.extraTools.some((tool: any) => tool.name === message.tool.name))
          this.extraGrants.set(message.tool.callId, JSON.stringify([message.tool.sessionId, message.tool.name, message.tool.args]));
        if (value && message.tool.name === 'workflow') this.ptcGrants.set(message.tool.callId,
          JSON.stringify([message.tool.sessionId, message.tool.name, message.tool.args]));
      } else if (message.type === 'ptc-run') {
        const owner = message.spec?.sandboxPolicy?.sessionId ?? input.sessionId;
        if (!this.ownsSession(owner)) throw new Error('工作流不属于当前会话');
        const grant = this.ptcGrants.get(message.tool?.callId); this.ptcGrants.delete(message.tool?.callId);
        const authorized = grant && grant === JSON.stringify([owner, message.tool.name, message.tool.args]);
        if (!authorized && !(typeof this.options.approve === 'function' && await this.options.approve({
          sessionId: input.sessionId, workspacePath: input.workspacePath, name: 'run_code', args: { code: message.spec.program },
          callId: message.runId, signal: controller.signal }))) throw new Error('DYWorker 未允许此工作流运行');
        this.ptcExecutor ??= new PtcExecutor(input.workspacePath);
        value = await this.ptcExecutor.run(message.spec, (global: string, member: string, args: any) =>
          this.request('ptc-binding', { runId: message.runId, global, member, args }, { signal: controller.signal }), controller.signal);
      } else if (message.type === 'user-question') {
        if (message.sessionId !== input.sessionId || typeof this.options.onQuestion !== 'function')
          throw new Error('当前任务没有可用的用户提问入口');
        value = await this.options.onQuestion(message.questions, controller.signal);
        controller.signal.throwIfAborted();
      } else if (message.type === 'extra-tool') {
        const grant = this.extraGrants.get(message.tool?.callId); this.extraGrants.delete(message.tool?.callId);
        if (!grant || grant !== JSON.stringify([message.tool.sessionId, message.tool.name, message.tool.args])
          || typeof this.options.onExtraTool !== 'function') throw new Error('此应用工具调用没有有效授权');
        controller.signal.throwIfAborted();
        const result = await this.options.onExtraTool(message.tool.name, message.tool.args,
          { sessionId: message.tool.sessionId, callId: message.tool.callId, signal: controller.signal });
        controller.signal.throwIfAborted();
        value = result?.control === true && input.fixedExtraTools?.includes(message.tool.name)
          && ['sleep_until', 'finish_task'].includes(message.tool.name) && message.tool.sessionId === input.sessionId
          ? { text: String(result.text || ''), control: true } : { text: typeof result === 'string' ? result : JSON.stringify(result) ?? 'null' };
      } else {
        const file = await fs.realpath(String(message.file));
        const roots = [input.workspacePath, input.dataDir];
        if (!roots.some(root => { const relative = path.relative(root, file); return relative === ''
          || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); })) throw new Error('文件操作越出会话允许的目录');
        const stat = await fs.stat(file);
        if (message.operation === 'sync' && (stat.isFile() || stat.isDirectory())) {
          const handle = await fs.open(file, stat.isDirectory() ? 'r' : 'r+');
          try { await handle.sync(); } finally { await handle.close(); }
        } else if (message.operation === 'chmod' && stat.isFile() && Number.isInteger(message.mode)
          && message.mode >= 0 && message.mode <= 0o777) await fs.chmod(file, message.mode);
        else throw new Error('不支持的文件操作');
      }
      if (this.child.connected && !controller.signal.aborted) this.child.send(message.type === 'file-handle'
        ? { type: 'file-handle-result', id: message.id } : { type: 'parent-result', id: message.id, value });
    } catch (error: any) {
      if (this.child.connected) this.child.send({ type: message.type === 'file-handle' ? 'file-handle-result' : 'parent-result',
        id: message.id, error: String(error?.message || error) });
    } finally { this.requests.delete(message.id); }
  }
  request(action: string, payload: any = {}, { signal, timeoutMs = action === 'history-next' ? 86_400_000 : 120_000 }: any = {}) {
    signal?.throwIfAborted();
    if (!this.child?.connected || this.stopping) return Promise.reject(Object.assign(new Error('DSH 会话未启动或已停止'),{code:'dyworker/history-carrier-lost',details:{}}));
    const id = randomUUID();
    return new Promise<any>((resolve, reject) => {
      let cancelling = false;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(id); };
      const abort = async () => {
        if (cancelling) return;
        cancelling = true; this.pending.delete(id);
        // 界面取数的取消只终止自身，不能因切换标签停止该会话的任务。
        if (['snapshot', 'family', 'child-snapshot', 'session-image', 'history-page', 'history-open', 'history-next', 'history-close', 'history-list', 'history-control-open', 'history-state', 'history-search', 'history-fork-seed', 'session-rename', 'session-command', 'settings-describe', 'route', 'ptc-binding', 'browser-upload', 'input-snapshot', 'input-admit', 'input-update-queue', 'input-cancel', 'child-prompt', 'child-interrupt'].includes(action)) {
          if (this.child?.connected) this.child.send({ type: 'abort-call', id });
        } else await this.cancel();
        cleanup(); reject(signal?.reason || new Error('DSH 操作超时'));
      };
      const timer = setTimeout(() => void abort(), timeoutMs);
      this.pending.set(id, { resolve: (value: any) => { cleanup(); resolve(value); }, reject: (error: any) => { cleanup(); reject(error); } });
      signal?.addEventListener('abort', abort, { once: true }); this.child.send({ type: 'request', id, action, payload });
    });
  }
  async cancel() {
    if (this.child?.connected) this.child.send({ type: 'cancel' });
    // 官方协作取消先收尾；事件循环阻塞时也必须有确定停止。
    await Promise.race([new Promise(resolve => this.child?.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 100))]);
    await this.stop();
  }
  stop() {
    return this.stopping ??= (async () => {
      this.lifecycle.abort(new Error('DSH 会话已停止'));
      for (const upload of this.attachmentUploads.values()) upload.abort();
      // 已取消的编号可能已移除，但磁盘操作尚未退出；必须等实际存储也停止。
      await Promise.allSettled([...this.attachmentUploadOperations]);
      this.attachmentUploads.clear();
      this.attachmentUploadRequests.clear();
      for (const controller of this.requests.values()) controller.abort(new Error('DSH 会话已停止'));
      for (const stream of this.streams.values()) stream.controller.abort(new Error('DSH 会话已停止'));
      await terminatePluginProcess(this.child);
      await Promise.allSettled([...this.operations]);
      this.streams.clear();
      this.extraGrants.clear();
      this.ptcGrants.clear();
      await this.ptcExecutor?.close();
      await Promise.all([...this.handles.values()].map(handle => handle.close())); this.handles.clear();
      await this.persistenceContext?.fiber.dispose(); this.sessionHeaders.clear();
      this.forwardedEventSeq.clear(); this.retiredEvents.clear(); this.retiringSessions.clear();
    })();
  }
  async close() {
    if (!this.child?.connected || this.stopping) return this.stop();
    try { await this.request('close', {}, { timeoutMs: 5000 }); }
    catch (error: any) { if (!['EPIPE', 'ERR_IPC_CHANNEL_CLOSED','dyworker/history-carrier-lost'].includes(error?.code)) throw error; }
    finally { await this.stop(); }
  }
}
