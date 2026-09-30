// DYWorker 主进程 Cordis 宿主。
// 参照 deepseek-harness（dsh）的框架用法但不引入 plugin-loader/YAML 组合：
// 桌面应用的插件清单由宿主代码装配。核心约束：
//   - 本文件与 services/ 均不 import electron，保证 node --test 直测；
//     平台能力（safeStorage、目录）由 createHost 配置注入。
//   - createHost 内同步构造各 Service（cordis 注册为 effect，需 await 根
//     fiber 激活后方可经 ctx.<name> 访问）。
//   - disposeHost 逆序执行各 fiber 的 effect 清理（flush、停定时器、断监听）。
import { Context } from "cordis";
import { AuditService } from "./services/audit.mts";
import { SettingsService } from "./services/settings.mts";
import { SessionsService } from "./services/session-archive.mts";
import { AgentService } from "./services/agent.mts";
import path from "node:path";

export interface HostOptions {
  userDataDir: string;
  // Electron safeStorage（duck-typed，测试可注入假实现）
  safeStorage?: any;
  // 读设置后依次应用领域修正（模型目录等），由壳层注册
  settingsMigrators?: Array<(settings: any) => any>;
  // 代理服务的领域解析器（记忆/技能/唤醒/MCP 等，见 services/agent.mts）
  agentResolvers?: any;
  startBackgroundTask?: any;
  // 运行期服务注册器：壳层在 whenReady 阶段把带生命周期的域对象
  // （渠道管理器、用量统计、运营消息等）挂进宿主，dispose 时统一清理。
  // 返回 ctx.plugin(...) 的 fiber 数组，createHost 会等它们激活后再返回
  registerService?: (ctx: Context) => any[] | void;
}

export async function createHost(options: HostOptions) {
  const ctx = new Context();
  ctx.provide("hostOptions", options);
  new AuditService(ctx, { filePath: path.join(options.userDataDir, "audit.jsonl") });
  new SettingsService(ctx, {
    settingsFile: path.join(options.userDataDir, "settings.json"),
    safeStorage: options.safeStorage,
    migrators: options.settingsMigrators || [],
  });
  new SessionsService(ctx, {
    dir: path.join(options.userDataDir, "sessions"),
    legacyFile: path.join(options.userDataDir, "sessions.json"),
  });
  new AgentService(ctx, {
    resolvers: options.agentResolvers || {},
    startBackgroundTask: options.startBackgroundTask || ((p) => p),
  });
  await ctx.fiber.await();
  const registered = await Promise.resolve(options.registerService?.(ctx) || []);
  if (Array.isArray(registered) && registered.length) await Promise.all(registered);
  return ctx;
}

export async function disposeHost(ctx: Context) {
  await ctx.fiber.dispose();
}
