// IPC 域插件：定时计划与自我唤醒（schedules:* / wakes:*）。
// 领域能力在 ctx.scheduler；任务执行本身仍由壳层经 hooks 提供。
export function schedulesIpcPlugin(deps) {
  return {
    name: "ipc:schedules",
    inject: ["scheduler"],
    apply(ctx) {
      const { trustedHandle } = deps;

      trustedHandle("schedules:list", () => ctx.scheduler.list());

      trustedHandle("schedules:save", (_event, payload) => ctx.scheduler.save(payload));

      trustedHandle("schedules:delete", (_event, id) => ctx.scheduler.remove(id));

      trustedHandle("schedules:set-enabled", (_event, payload) => ctx.scheduler.setEnabled(payload));

      // 立即执行：把 nextRun 拨到现在并触发一次到期检查
      trustedHandle("schedules:trigger-now", (_event, id) => ctx.scheduler.triggerNow(id));

      // 用户在桌面取消某个会话的自我唤醒（渠道「停止」也会走同一入口）
      trustedHandle("wakes:cancel-for-session", async (_event, sessionId) => {
        await ctx.scheduler.cancelForSession(String(sessionId || ""));
        return { ok: true };
      });
    },
  };
}
