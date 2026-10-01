// IPC 域插件：IM 渠道（channels:*）。
// 领域能力在 ctx.channelManager（渠道适配器的启停、状态快照）；
// 其余渠道逻辑（任务执行、收件箱决议）仍在 main——它们耦合桌面 IPC/会话领域，
// 后续按域继续上收。本插件只做通道映射。
export function channelsIpcPlugin(deps) {
  return {
    name: "ipc:channels",
    inject: ["channelManager"],
    apply(ctx) {
      const { trustedHandle } = deps;

      trustedHandle("channels:get-status", () => ctx.channelManager.status());
    },
  };
}
