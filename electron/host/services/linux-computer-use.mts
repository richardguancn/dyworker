import { Service } from '@deepseek-ai/cordis';
import { McpClient } from '../../mcp.mts';
import fs from 'node:fs';
import path from 'node:path';

declare module '@deepseek-ai/cordis' { interface Context { linuxComputerUse: LinuxComputerUseService } }

/** Each task owns a separate upstream process and element snapshot namespace. */
export class LinuxComputerUseService extends Service {
  clients = new Map<string, any>();
  pending = new Map<string, Promise<any>>();
  command = '';
  active = false;
  constructor(ctx) { super(ctx, 'linuxComputerUse'); }

  async mount(ctx, binDir: string, platform = process.platform, arch = process.arch) {
    if (platform !== 'linux') throw new Error('此插件仅支持 Linux');
    const architecture = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : '';
    if (!architecture) throw new Error(`Linux 电脑操作暂不支持此处理器：${arch}`);
    this.command = path.join(binDir.replace(/app\.asar(?=\/|$)/, 'app.asar.unpacked'), architecture, 'computer-use-linux');
    if (!fs.existsSync(this.command)) throw new Error('Linux 电脑操作程序缺失，请重新安装应用');
    const probe = this.newClient();
    try {
      await probe.connect();
      const tools = probe.tools.filter(tool => tool.name !== 'run_shell');
      if (!tools.length) throw new Error('Linux 电脑操作没有提供可用工具');
      this.active = true;
      for (const tool of tools) {
        ctx.effect(() => ctx.tools.register({
          plugin: 'dyworker-linux-computer-use', name: tool.name,
          description: `【Linux 本机应用操作】${tool.description || tool.name}`,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
          handler: async (args, execution) => {
            const result = await this.call(tool.name, args, execution);
            return { ok: !result.isError, result: result.text, images: result.images };
          },
        }));
      }
    } finally { await probe.close(); }
    ctx.effect(() => async () => { this.active = false; await this.closeAll(); });
  }

  newClient() {
    const env = { ...process.env };
    delete env.COMPUTER_USE_LINUX_ENABLE_SHELL;
    return new McpClient({ command: this.command, args: ['mcp'], env, requestTimeoutMs: 60000 });
  }

  async client(key: string) {
    if (!this.active) throw new Error('Linux 电脑操作插件已停用');
    const existing = this.clients.get(key);
    if (existing?.process) return existing;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const opening = (async () => {
      const client = this.newClient();
      try {
        await client.connect();
        if (!this.active) throw new Error('Linux 电脑操作插件已停用');
        this.clients.set(key, client);
        return client;
      } catch (error) { await client.close(); throw error; }
    })();
    this.pending.set(key, opening);
    try { return await opening; } finally { this.pending.delete(key); }
  }

  async call(tool: string, args: any, execution: any) {
    const session = String(execution.sessionId || ''), run = String(execution.runId || '');
    if (!session || !run) throw new Error('本机操作需要所属任务');
    const key = JSON.stringify([session, run]);
    execution.signal?.throwIfAborted();
    const client = await this.client(key);
    if (execution.signal?.aborted) { await this.closeKey(key); execution.signal.throwIfAborted(); }
    let closing: Promise<void> | undefined;
    const abort = () => { closing = this.closeKey(key); };
    execution.signal?.addEventListener('abort', abort, { once: true });
    try { return await client.callTool(tool, args, { signal: execution.signal }); }
    finally { execution.signal?.removeEventListener('abort', abort); if (closing) await closing; }
  }

  async closeKey(key: string) {
    const client = this.clients.get(key);
    this.clients.delete(key);
    if (client) await client.close();
  }
  async stopRun(sessionId: string, runId: string) {
    const key = JSON.stringify([sessionId, runId]);
    await this.pending.get(key)?.catch(() => {});
    await this.closeKey(key);
  }
  async closeAll() {
    await Promise.allSettled([...this.pending.values()]);
    await Promise.allSettled([...this.clients.keys()].map(key => this.closeKey(key)));
  }
}
