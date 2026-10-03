// 运行期域插件：**创建 + 挂载 + 停机**三件事都由插件负责。
//
// 与上一版的区别：此前壳层先 new 出对象、插件只包一层清理；现在插件在 apply 时
// 调工厂创建实例，实例的存活期 = 插件 fiber 的存活期，main 不再持有模块级域对象。
// 工厂里的依赖（IPC/收件箱等领域回调）仍由壳层以闭包注入——这些回调本就是桌面壳
// 的领域，硬搬进 host 收益为负。
//
// 依赖顺序用 cordis inject 声明：运营消息中心需要用量统计的网络客户端，
// 声明 inject: ["telemetryController"] 后，用量统计没就绪它就不会 apply——
// 漏接依赖会「不激活」，而不是运行期读到 undefined。
import { Service } from "@deepseek-ai/cordis";
import type { createBackgroundTasksManager } from "../../background-tasks.mts";
import type { createChannelManager } from "../../channels/manager.mts";
import type { createRemoteMessagesManager } from "../../remote-messages.mts";
import type { createTelemetryController } from "../../telemetry.mts";

// 运行期域实例的 ctx 类型：实例由各域模块的工厂创建（域模块保持不 import cordis），
// 这里用 ReturnType 引用其形状（import type 会被完全擦除，不引入运行期耦合）。
declare module "@deepseek-ai/cordis" {
  interface Context {
    channelManager: ReturnType<typeof createChannelManager>;
    telemetryController: ReturnType<typeof createTelemetryController>;
    remoteMessages: ReturnType<typeof createRemoteMessagesManager>;
    backgroundTasksManager: ReturnType<typeof createBackgroundTasksManager>;
  }
}

// 通用生命周期服务：包装域对象，dispose 时调用其停止方法。
export class ManagedLifecycleService extends Service {
  disposeAction;

  constructor(ctx, name, disposeAction) {
    super(ctx, name);
    this.disposeAction = disposeAction;
    ctx.effect(() => () => {
      // 返回 promise：cordis 会 await 它，disposeHost(ctx) 解析完成即代表域停机完成
      // （旧 before-quit 手工链是 await 这些停止动作的）。此前用 `void` 丢弃，
      // 退出时渠道/统计/运营消息的收尾可能还没跑完进程就结束了。
      // 单个域停机失败只告警，不阻断整条清理链。
      try {
        return Promise.resolve(this.disposeAction?.()).catch((error) => {
          console.warn(`[host] ${name} dispose failed:`, error);
        });
      } catch (error) {
        console.warn(`[host] ${name} dispose failed:`, error);
      }
    });
  }
}

// 运行期域插件统一形态：
//   name/serviceName —— 插件名与服务名（serviceName 即 ctx.<serviceName>）
//   create(ctx)      —— 在 apply 时创建域对象（可读取已 inject 的依赖）
//   stop(instance)   —— dispose 时的停机动作，返回值会被 await
//   inject           —— 可选：cordis 依赖声明，未就绪则不 apply
function runtimeDomainPlugin({ name, serviceName, create, stop, inject }: any) {
  return {
    name,
    ...(inject ? { inject } : {}),
    apply(ctx: any) {
      const instance = create(ctx);
      new ManagedLifecycleService(ctx, name, () => stop(instance));
      ctx.provide(serviceName, instance);
    },
  };
}

// 渠道域（ctx.channelManager）：QQ/微信适配器
export function channelsPlugin(createManager) {
  return runtimeDomainPlugin({
    name: "channels",
    serviceName: "channelManager",
    create: () => createManager(),
    stop: (manager) => manager?.stopAll?.(),
  });
}

// 用量统计域（ctx.telemetryController）：活动跟踪落盘与网络收尾
export function telemetryPlugin(createController) {
  return runtimeDomainPlugin({
    name: "telemetry",
    serviceName: "telemetryController",
    create: () => createController(),
    stop: (controller) => controller?.shutdown?.(),
  });
}

// 运营消息域（ctx.remoteMessages）：SSE 订阅与定时拉取停止。
// 依赖用量统计的客户端，故 inject telemetryController。
export function remoteMessagesPlugin(createManager) {
  return runtimeDomainPlugin({
    name: "remote-messages",
    serviceName: "remoteMessages",
    inject: ["telemetryController"],
    create: (ctx) => createManager(ctx),
    stop: (manager) => manager?.stop?.(),
  });
}

// 后台任务域（ctx.backgroundTasksManager）：清理运行中的后台任务与计时器
export function backgroundTasksPlugin(createManager) {
  return runtimeDomainPlugin({
    name: "background-tasks",
    serviceName: "backgroundTasksManager",
    create: () => createManager(),
    stop: (manager) => manager?.cleanupAll?.(),
  });
}
