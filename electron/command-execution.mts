import { Context } from '@deepseek-ai/cordis';
import { protectionUnavailable, requireCommandProtection } from './command-protection.mts';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
  const windows = process.platform === 'win32';
  const bridge = fileURLToPath(new URL('./scripts/windows_command_runner.cjs', import.meta.url))
    .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  const argv = windows ? [process.execPath, bridge, Buffer.from(String(command), 'utf8').toString('base64')]
    : ['/bin/bash', '-lc', String(command)];
  const env = windows ? { ELECTRON_RUN_AS_NODE: '1' } : undefined;
  const bridgeFailure = { allowedExitCodes: [127], fatalSignatures: ['dyworker-command-runner: '] };
  if (mode === 'danger-full-access') return { argv, env, enforcement: 'explicit-host-grant',
    ...(windows ? { denialSignatures: [], runnerFailureRules: [bridgeFailure] } : {}) };
  const ctx = await provider();
  signal?.throwIfAborted();
  const confined = await ctx.sandbox.confine(argv, { mode, workspaceRoot: workspacePath }, signal);
  signal?.throwIfAborted();
  // 仅识别当前固定官方 Windows runner；不是接受所有 partial，更不是退回 host。
  const expectedRunner = windows ? fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-sandbox-windows-acl/runner')) : '';
  const nativeWindows = windows && confined.argv?.[0] === process.execPath
    && path.normalize(confined.argv?.[1] || '') === path.normalize(expectedRunner);
  requireCommandProtection(confined, mode, nativeWindows ? 'windows-acl' : undefined);
  return { ...confined, env, runnerFailureRules: [...confined.runnerFailureRules, ...(windows ? [bridgeFailure] : [])] };
}
