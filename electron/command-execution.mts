import { Context } from '@deepseek-ai/cordis';
import { protectionUnavailable, requireCommandProtection } from './command-protection.mts';

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
  if (!['workspace-write', 'read-only', 'danger-full-access'].includes(mode)) {
    throw protectionUnavailable('无法识别本次执行权限，命令未执行');
  }
  const argv = process.platform === 'win32'
    ? ['cmd.exe', '/d', '/s', '/c', String(command)] : ['/bin/bash', '-lc', String(command)];
  if (mode === 'danger-full-access') return { argv, enforcement: 'explicit-host-grant' };
  // 当前固定版本的 Windows 后端始终报告 partial，且已有真实越界写入记录。
  // 在 confine 物化常驻 ACL/Low 标签之前停止，不能先改真实目录权限再拒绝启动。
  if (process.platform === 'win32') {
    throw protectionUnavailable('当前 Windows 执行保护尚不能保证文件写入范围，受限命令暂不可用，命令未执行；没有自动扩大权限');
  }
  const ctx = await provider();
  signal?.throwIfAborted();
  const confined = await ctx.sandbox.confine(argv, { mode, workspaceRoot: workspacePath }, signal);
  signal?.throwIfAborted();
  return requireCommandProtection(confined, mode);
}
