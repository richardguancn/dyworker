// DYWorker 主进程 Cordis 宿主。
// 参照 deepseek-harness（dsh）的框架用法但不引入 plugin-loader/YAML 组合：
// 桌面应用的插件清单由宿主代码装配。核心约束：
//   - 本文件与 services/ 均不 import electron，保证 node --test 直测；
//     平台能力（safeStorage、目录）由 createHost 配置注入。
//   - createHost 内同步构造各 Service（cordis 注册为 effect，需 await 根
//     fiber 激活后方可经 ctx.<name> 访问）。
//   - disposeHost 逆序执行各 fiber 的 effect 清理（flush、停定时器、断监听）。
import { Context } from "@deepseek-ai/cordis";
import { AuditService } from "./services/audit.mts";
import { SettingsService } from "./services/settings.mts";
import { SessionsService } from "./services/session-archive.mts";
import { AgentService } from "./services/agent.mts";
import { mountPluginHost } from "./plugin-host.mts";
import { IpcService } from "./services/ipc.mts";
import { StorageService } from "./services/storage.mts";
import { WindowService } from "./services/window.mts";
import { ToolsService } from "./services/tools.mts";
import { ConnectionService } from "./services/connection.mts";
import { SessionProjectionCacheService, SessionProjectionsService } from "./services/projections.mts";
import { RulesService } from "./services/rules.mts";
import { SkillsService } from "./services/skills.mts";
import { MemoryService } from "./services/memory.mts";
import { InboxService } from "./services/inbox.mts";
import { SchedulerService } from "./services/scheduler.mts";
import path from "node:path";

export interface HostOptions {
  /** 内置插件目录（随应用分发，默认启用，可在插件页停用） */
  builtinPluginsDir?: string;
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
    // meta.manual：本轮是用户点「立即执行」还是到点自动跑（壳层用它给运行会话打标）
    runScheduledTask?: (record: any, meta?: { manual?: boolean }) => Promise<void> | void;
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
  // 契约服务（ctx.ipc / ctx.storage / ctx.window）的壳层能力。
  // 不传时服务仍会注册，但调用对应能力会给出"壳层未注入"的明确错误——
  // 这样单测可以只注入需要的部分。
  contracts?: {
    // 统一做来源校验的 IPC 注册/注销原语
    ipcRegister?: (channel: string, handler: any) => void;
    ipcUnregister?: (channel: string) => void;
    getMainWindow?: () => any;
    getWebContents?: () => any[];
    dialog?: any;
    shell?: any;
    clipboard?: any;
    nativeImage?: any;
    nativeTheme?: any;
  };
  // 插件宿主（ctx.plugins）：装载官方 cordis loader，插件树落在 pluginsDir。
  // 默认不挂载——测试与不关心插件的调用方不必建目录/读树；
  // 壳层在启动时传 mountPlugins: true 打开。
  pluginsDir?: string;
  mountPlugins?: boolean;
}

export async function createHost(options: HostOptions) {
  const ctx = new Context();
  ctx.provide("hostOptions", options);
  const contracts = options.contracts || {};
  // 契约服务：插件只 inject 这些，而不是壳层内部 deps 大包
  new IpcService(ctx, {
    register: contracts.ipcRegister,
    unregister: contracts.ipcUnregister,
  });
  new StorageService(ctx, {
    root: path.join(options.pluginsDir || path.join(options.userDataDir, "plugins"), "data"),
    hostDir: options.userDataDir,
  });
  new WindowService(ctx, contracts);
  new ToolsService(ctx);
  // DSH 宿主服务适配：插件的主机半边靠它们注册 HTTP 路由、读会话、取投影
  // （实测 dsh-context 用 connection.fetch.register / sessions.get / sessionProjections.stateOf）
  new ConnectionService(ctx);
  new SessionProjectionsService(ctx);
  new SessionProjectionCacheService(ctx);

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
  // 插件宿主（可选）：官方 loader + 树文件，见 host/plugin-host.mts 的挂载顺序说明
  if (options.mountPlugins) {
    await mountPluginHost(ctx, options.pluginsDir || path.join(options.userDataDir, "plugins"), {
      builtinDir: options.builtinPluginsDir,
    });
  }
  const registered = await Promise.resolve(options.registerService?.(ctx) || []);
  if (Array.isArray(registered) && registered.length) await Promise.all(registered);
  return ctx;
}

export async function disposeHost(ctx: Context) {
  await ctx.fiber.dispose();
}
