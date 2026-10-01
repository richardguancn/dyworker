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
import { RulesService } from "./services/rules.mts";
import { SkillsService } from "./services/skills.mts";
import { MemoryService } from "./services/memory.mts";
import { InboxService } from "./services/inbox.mts";
import { SchedulerService } from "./services/scheduler.mts";
import path from "node:path";

export interface HostOptions {
  userDataDir: string;
  // 用户主目录（文件技能 SKILL.md 的发现范围），由壳层注入
  homeDir?: string;
  // Electron safeStorage（duck-typed，测试可注入假实现）
  safeStorage?: any;
  // 读设置后依次应用领域修正（模型目录等），由壳层注册
  settingsMigrators?: Array<(settings: any) => any>;
  // 代理服务的领域解析器（记忆/技能/唤醒/MCP 等，见 services/agent.mts）
  agentResolvers?: any;
  startBackgroundTask?: any;
  // 收件箱与渲染端/系统通知的边界（壳层注入，host 不 import electron）：
  // broadcast：收件箱有变化时通知渲染端刷新；notify：新条目弹系统通知（含点击聚焦）
  inboxBroadcast?: () => void;
  inboxNotify?: (item: any) => void;
  // 调度服务的壳层边界：忙碌/关机判定、任务执行、渲染端广播
  schedulerHooks?: {
    isShuttingDown?: () => boolean;
    isSessionBusy?: (sessionId: string) => boolean;
    isSystemBusy?: () => boolean;
    runScheduledTask?: (record: any) => Promise<void> | void;
    resumeWake?: (wake: any) => Promise<void> | void;
    broadcast?: () => void;
  };
  // 运行期服务注册器：壳层可把带生命周期的域对象（渠道管理器、用量统计、
  // 运营消息等）挂进宿主，dispose 时统一清理。返回 ctx.plugin(...) 的 fiber
  // 数组，createHost 会等它们激活后再返回。
  //
  // 重要约束：回调在 createHost 内部、`await ctx.fiber.await()` 之后同步执行，
  // 即仍处于调用方的顶层 await 期间。此时调用方模块中位于该 await 之后的
  // const/let 仍处于 TDZ，在回调里引用会抛 ReferenceError。因此这里只能引用
  // 调用 createHost 之前已完成初始化的绑定（import、函数声明、earlier const）；
  // 在 await 之后才创建的对象请在创建点直接 ctx.plugin(...) 挂载。
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
  new RulesService(ctx, {
    filePath: path.join(options.userDataDir, "standing-rules.json"),
  });
  new SkillsService(ctx, {
    dir: options.userDataDir,
    homeDir: options.homeDir || "",
  });
  new MemoryService(ctx, {
    dir: options.userDataDir,
  });
  new InboxService(ctx, {
    dir: options.userDataDir,
    broadcast: options.inboxBroadcast,
    notify: options.inboxNotify,
  });
  new SchedulerService(ctx, {
    dir: options.userDataDir,
    ...(options.schedulerHooks || {}),
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
