import { Context } from '@deepseek-ai/cordis';
import Sessions from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import FileSystem from '@deepseek-ai/dsh-fs-local';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import LocalSandbox from '@deepseek-ai/dsh-sandbox-local';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import NodePtcRuntime from '@deepseek-ai/dsh-ptc-runtime-node';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const unpack = (file: string) => file.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);

/** 官方 Node 执行器在父进程运行；插件进程仍不能自行创建子进程。 */
export class PtcExecutor {
  ctx: any;
  ready: Promise<any>;
  readonly workspacePath: string;
  constructor(workspacePath: string) { this.workspacePath = workspacePath; }
  async initialize() {
    const workspace = await fs.realpath(this.workspacePath);
    const bootstrap = unpack(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-ptc-runtime-node/process')));
    const modules = path.dirname(path.dirname(path.dirname(path.dirname(bootstrap))));
    const executable = await fs.realpath(process.execPath);
    class RestrictedSandbox extends LocalSandbox {
      async confine(argv: string[], policy: any, signal: AbortSignal) {
        if (await fs.realpath(argv[0]) !== executable) throw new Error('工作流只能使用应用提供的程序执行器');
        const protectedArgv = [argv[0], '--permission', `--allow-fs-read=${modules}`, `--allow-fs-read=${workspace}`,
          ...(policy.mode === 'workspace-write' ? [`--allow-fs-write=${workspace}`] : []), ...argv.slice(1)];
        return super.confine(protectedArgv, policy, signal);
      }
    }
    const ctx = this.ctx = new Context();
    try {
      await ctx.plugin(Sessions); await ctx.plugin(Projections);
      await ctx.plugin(FileSystem, { cwd: workspace });
      await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: workspace });
      await ctx.plugin(LocalSubprocess); await ctx.plugin(RestrictedSandbox);
      const spawn = ctx.subprocess.spawn.bind(ctx.subprocess);
      ctx.subprocess.spawn = (spec: any) => spawn({ ...spec, env: { ...spec.env, ELECTRON_RUN_AS_NODE: '1', NODE_NO_WARNINGS: '1' } });
      await ctx.plugin(NodePtcRuntime, { bootstrapPath: bootstrap, nodeExecutable: executable,
        timeoutMs: 120_000, maxTimeoutMs: 600_000, graceMs: 1000 });
      await ctx.fiber.await();
      return ctx;
    } catch (error) { await ctx.fiber.dispose(); throw error; }
  }
  async run(spec: any, invoke: any, signal: AbortSignal) {
    signal.throwIfAborted();
    const workspace = await fs.realpath(this.workspacePath);
    if (await fs.realpath(spec.cwd) !== workspace || path.resolve(spec.sandboxPolicy?.workspaceRoot || '') !== workspace)
      throw new Error('工作流运行目录必须属于当前会话');
    if (!['read-only', 'workspace-write'].includes(spec.sandboxPolicy?.mode)) throw new Error('工作流不支持扩大到工作目录以外的访问');
    const ctx = await (this.ready ??= this.initialize());
    signal.throwIfAborted();
    const bindings = spec.bindings.map((binding: any) => {
      const functions = Object.create(null);
      for (const member of binding.names) functions[member] = (args: any) => invoke(binding.global, member, args);
      return { global: binding.global, functions, ...(binding.errorClass ? { errorClass: binding.errorClass } : {}) };
    });
    return ctx.ptcRuntime.run(ctx.ptcRuntime.resolve({ ...spec, bindings, signal,
      sandboxPolicy: { ...spec.sandboxPolicy, workspaceRoot: workspace } }));
  }
  async close() {
    await this.ready?.catch(() => {});
    await this.ctx?.fiber.dispose();
  }
}
