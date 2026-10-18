import { Context } from '@deepseek-ai/cordis';

let sandbox: Promise<any> | undefined;
async function provider() {
  return sandbox ??= (async () => {
    // DSH 与宿主有独立的 sessions 服务；动态加载避免第三方类型把两者合并。
    const moduleName = '@deepseek-ai/dsh-sandbox-local';
    const { default: LocalSandbox } = await import(moduleName);
    const ctx = new Context();
    try { await ctx.plugin(LocalSandbox); await ctx.fiber.await(); return ctx; }
    catch (error) { await ctx.fiber.dispose(); sandbox = undefined; throw error; }
  })();
}

// 复用 DSH 官方文件写入隔离。网络与读取不在此后端的承诺范围内，仍须完整审核。
// 仅明确批准的本次 host 执行或用户选中的 full-access 可绕过；后端故障绝不裸跑。
export async function prepareCommandExecution(command: string, { workspacePath, mode = 'workspace-write', signal }: any) {
  signal?.throwIfAborted();
  const argv = process.platform === 'win32'
    ? ['cmd.exe', '/d', '/s', '/c', String(command)] : ['/bin/bash', '-lc', String(command)];
  if (mode === 'danger-full-access') return { argv, enforcement: 'explicit-host-grant' };
  const ctx = await provider();
  signal?.throwIfAborted();
  return ctx.sandbox.confine(argv, { mode: mode === 'read-only' ? 'read-only' : 'workspace-write', workspaceRoot: workspacePath }, signal);
}
