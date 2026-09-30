// 运行期域对象的生命周期挂载（cordis 化）：
// 渠道管理器、用量统计、运营消息中心原本是 main.mjs 的模块级单例，
// 手工在 before-quit 里按正确顺序停机。现在统一经 registerRuntimeServices
// 挂进宿主——对象创建仍在壳层（它们的回调依赖 main 的 IPC/收件箱领域），
// 宿主只负责「dispose 时逆序清理」这一件事。
import { Service } from "cordis";

// 通用生命周期服务：包装已存在的域对象，dispose 时调用其停止方法。
// 这类对象由壳层创建后传入（创建参数依赖大量 main 内回调，硬搬进 host
// 收益为负）；挂载的意义是让清理链进入统一的 dispose 顺序。
export class ManagedLifecycleService extends Service {
  disposeAction;

  constructor(ctx, name, disposeAction) {
    super(ctx, name);
    this.disposeAction = disposeAction;
    ctx.effect(() => () => {
      void this.disposeAction?.();
    });
  }
}

// 渠道域（ctx.channels）：QQ/微信适配器的启动与全量停止
export function channelsPlugin(manager) {
  return {
    name: "channels",
    apply(ctx: any) {
      new ManagedLifecycleService(ctx, "channels", () => manager.stopAll());
      ctx.provide("channelManager", manager);
    },
  };
}

// 用量统计域（ctx.telemetry）：活动跟踪落盘与网络收尾
export function telemetryPlugin(controller) {
  return {
    name: "telemetry",
    apply(ctx: any) {
      new ManagedLifecycleService(ctx, "telemetry", () => controller?.shutdown?.());
      ctx.provide("telemetryController", controller);
    },
  };
}

// 运营消息域（ctx.remoteMessages）：SSE 订阅与定时拉取停止
export function remoteMessagesPlugin(manager) {
  return {
    name: "remote-messages",
    apply(ctx: any) {
      new ManagedLifecycleService(ctx, "remoteMessages", () => manager?.stop?.());
      ctx.provide("remoteMessages", manager);
    },
  };
}

// 后台任务域（ctx.backgroundTasks）：清理运行中的后台任务与计时器
export function backgroundTasksPlugin(manager) {
  return {
    name: "background-tasks",
    apply(ctx: any) {
      new ManagedLifecycleService(ctx, "backgroundTasks", () => manager.cleanupAll());
      ctx.provide("backgroundTasksManager", manager);
    },
  };
}
