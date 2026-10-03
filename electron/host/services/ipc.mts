// 契约服务 ctx.ipc：插件注册渲染端通道的唯一入口。
//
// 为什么要有它：原先每个 IPC 插件都从壳层收一个 `trustedHandle` 函数——
// 那是应用内部实现，不是契约，第三方插件接不上。这里把它收成服务：
//   - 注册时统一做**来源校验**（不受信任的渲染端调用直接拒绝），
//     插件无法绕过这道校验；
//   - 返回**注销函数**：插件停用/卸载时必须能撤掉通道，否则再次启用会
//     撞上 Electron 的 "second handler for channel" 直接崩。
//     用法：ctx.effect(() => ctx.ipc.handle("demo:ping", () => "pong"))
//
// 与 electron 的边界：本文件不 import electron，注册/注销原语由壳层注入。
import { Service } from "@deepseek-ai/cordis";

declare module "@deepseek-ai/cordis" {
  interface Context {
    ipc: IpcService;
  }
}

export class IpcService extends Service {
  register;
  unregister;
  channels = new Set();

  constructor(ctx, config = {} as any) {
    super(ctx, "ipc");
    this.register = config.register;
    this.unregister = config.unregister || (() => {});
  }

  /**
   * 注册一个 IPC 通道。
   * @param channel 通道名（与 preload 暴露的名字一致）
   * @param handler (event, ...args) => result；来源校验已在外层统一完成
   * @returns 注销函数，交给 ctx.effect 以绑定到插件生命周期
   */
  handle(channel, handler) {
    const name = String(channel || "").trim();
    if (!name) throw new Error("IPC 通道名不能为空");
    if (this.channels.has(name)) throw new Error(`IPC 通道已注册：${name}`);
    if (typeof this.register !== "function") throw new Error("壳层未注入 IPC 注册能力");
    this.register(name, handler);
    this.channels.add(name);
    return () => this.unregisterChannel(name);
  }

  unregisterChannel(channel) {
    const name = String(channel || "");
    if (!this.channels.has(name)) return false;
    try {
      this.unregister(name);
    } finally {
      this.channels.delete(name);
    }
    return true;
  }

  /** 当前由插件注册的通道（排查重复注册/未释放用） */
  registered() {
    return [...this.channels];
  }
}
