// IPC 域插件：用量统计与运营消息（telemetry:* / system-messages:*）。
// 领域能力在 ctx.telemetryController / ctx.remoteMessages（运行期域插件创建）。
//
// 注意挂载时机：这两个服务在 whenReady 才创建，因此本插件必须在那之后、**窗口创建
// 之前**挂载——否则 inject 未满足期间渲染端已经能发 IPC，会拿到
// 「No handler registered」。main.mts 里运营域初始化已前移到 createWindow() 之前。
export function telemetryIpcPlugin(deps) {
  return {
    name: "ipc:telemetry",
    inject: ["telemetryController", "remoteMessages"],
    apply(ctx) {
      const { trustedHandle } = deps;

      trustedHandle("telemetry:status", async () => ctx.telemetryController?.status() || {
        configured: false,
        statsEnabled: false,
        messagesEnabled: false,
        registered: false,
      });

      // 「删除此安装已上传数据」：撤销凭据并触发服务端删除流程，本地队列一并清除
      trustedHandle("telemetry:delete-data", async () => {
        if (!ctx.telemetryController) return { ok: false, error: "运营服务尚未初始化" };
        try {
          return await ctx.telemetryController.deleteInstallationData();
        } catch (error: any) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });

      trustedHandle("system-messages:list", () => ctx.remoteMessages?.listMessages() || []);

      // 只有用户实际打开对应消息才记「已读」
      trustedHandle("system-messages:mark-read", (_event, messageId) =>
        ctx.remoteMessages?.markRead(String(messageId || "")) || Promise.resolve({ ok: false }));

      // 用户点击消息内的跳转才记「已点击」；跳转仅允许 https 白名单地址（openBrowserExternal 校验）
      trustedHandle("system-messages:mark-clicked", (_event, messageId) =>
        ctx.remoteMessages?.markClicked(String(messageId || "")) || Promise.resolve({ ok: false }));
    },
  };
}
