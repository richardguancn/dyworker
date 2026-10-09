import { SessionPersistence } from '@deepseek-ai/dsh-session-persistence';

// 官方 JSONL 后端含原生文件锁，在可信父进程运行；插件进程只获得所属环境的会话句柄。
export function persistenceProxy(request: (action: string, payload: any, signal?: AbortSignal) => Promise<any>) {
  class RemoteHandle {
    id: any; header: any; access: any; inheritedEventCount: any; key: string;
    constructor(value: any) { Object.assign(this, value); }
    async read(offset?: any, length?: any, options?: any) {
      const result = await request('handle-read', { key: this.key, offset, length }, options?.signal);
      // IPC 创建了独立副本，不能把父进程的 frozen 标记当成本地已冻结事实。
      return { ...result, eventState: 'detached' };
    }
    async append(events: any, options?: any) { await request('handle-append', { key: this.key, events }, options?.signal); }
    async flush(options?: any) { await request('handle-flush', { key: this.key }, options?.signal); }
    async close() { await request('handle-close', { key: this.key }); }
    async [Symbol.asyncDispose]() { await this.close(); }
  }
  return class ParentPersistence extends SessionPersistence {
    constructor(ctx: any) {
      super(ctx);
      ctx.on('session/flush', (session: any) => request('session-flush', { id: session.id }));
    }
    async create(header: any, options?: any): Promise<any> {
      return new RemoteHandle(await request('create', { header, inheritedEventCount: options?.inheritedEventCount }, options?.signal));
    }
    async open(id: any, access: any, options?: any): Promise<any> {
      return new RemoteHandle(await request('open', { id, access }, options?.signal));
    }
    async stat(id: any, options?: any) { return request('stat', { id }, options?.signal); }
    async list(options?: any) { return request('list', {}, options?.signal); }
    async flush() { await request('flush', {}); }
  };
}
