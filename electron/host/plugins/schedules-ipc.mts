// IPC 域插件：定时计划与自我唤醒（schedules:* / wakes:*）。
// 领域能力在 ctx.scheduler；任务执行本身仍由壳层经 hooks 提供。
export function schedulesIpcPlugin(deps) {
  return {
    name: "ipc:schedules",
    inject: ["scheduler"],
    apply(ctx) {
      const { trustedHandle, resumeWake, isSessionBusy } = deps;

      trustedHandle("schedules:list", () => ctx.scheduler.list());

      trustedHandle("schedules:save", (_event, payload) => ctx.scheduler.save(payload));

      trustedHandle("schedules:delete", (_event, id) => ctx.scheduler.remove(id));

      trustedHandle("schedules:set-enabled", (_event, payload) => ctx.scheduler.setEnabled(payload));

      // 立即执行：把 nextRun 拨到现在并触发一次到期检查
      trustedHandle("schedules:trigger-now", (_event, id) => ctx.scheduler.triggerNow(id));

      // 渲染端启动/会话切换时拉取"挂起中"会话（气泡上的 sleeping 标记是历史留痕，
      // 取消唤醒后不会变，重启也读不出来，只有主进程的 wakes.json 是权威状态）
      trustedHandle("wakes:list-pending", () => ctx.scheduler.listPending());

      // 用户在挂起卡片上点「立即继续」：取走该会话的待唤醒并立刻续跑，不等约定时间
      trustedHandle("wakes:resume-now", async (_event, sessionId) => {
        const sid = String(sessionId || "");
        if (!sid) return { ok: false, error: "会话标识无效" };
        if (typeof isSessionBusy === "function" && isSessionBusy(sid)) {
          return { ok: false, error: "这个会话正在执行任务，请等它结束后再继续" };
        }
        // 调度道的串行锁归后台任务（定时计划/其他会话续跑）所有：此时手动插队会让
        // resumeWake 收尾把 running 误置为 false，等于替别人解锁，可能并发跑起第二个后台任务
        if (ctx.scheduler.running) {
          return { ok: false, error: "后台任务正在执行，稍后再点「立即继续」（任务仍会到点自动唤醒）" };
        }
        const pending = await ctx.scheduler.claimPendingForSession(sid);
        if (!pending) return { ok: false, error: "这个会话没有待唤醒的挂起任务" };
        // manual：界面要说"已按你的要求立即继续"，不能说成"已到点自动唤醒"
        await resumeWake(pending, { manual: true });
        return { ok: true };
      });

      // 用户在桌面取消某个会话的自我唤醒（渠道「停止」也会走同一入口）
      trustedHandle("wakes:cancel-for-session", async (_event, sessionId) => {
        await ctx.scheduler.cancelForSession(String(sessionId || ""));
        return { ok: true };
      });
    },
  };
}
