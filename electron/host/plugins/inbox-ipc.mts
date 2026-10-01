// IPC 域插件：审批收件箱（inbox:*）。
// 领域能力在 ctx.inbox（条目落盘、决议恢复、孤儿兜底）。
export function inboxIpcPlugin(deps) {
  return {
    name: "ipc:inbox",
    inject: ["inbox"],
    apply(ctx) {
      const { trustedHandle } = deps;

      // 列表读取前服务会先做孤儿兜底（避免点不动的 pending 钉子户）
      trustedHandle("inbox:list", () => ctx.inbox.list());

      // 决议挂起条目（收件箱 UI 与 IM 渠道共用同一入口）
      trustedHandle("inbox:resolve", async (_event, payload) =>
        ctx.inbox.resolve(String(payload?.id || ""), { approved: payload?.approved, answer: payload?.answer }));

      trustedHandle("inbox:dismiss", (_event, id) => ctx.inbox.dismiss(id));
    },
  };
}
