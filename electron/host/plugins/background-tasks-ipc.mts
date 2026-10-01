// IPC 域插件：后台任务（background-tasks:*）。
// 领域能力在 ctx.backgroundTasksManager（由 backgroundTasksPlugin 创建 + 停机），
// 本插件只做通道映射；依赖用 inject 声明——该服务在模块层挂载，早于窗口创建，
// 所以 inject 不会拖到渲染端开始发 IPC 之后才注册通道。
export function backgroundTasksIpcPlugin(deps) {
  return {
    name: "ipc:background-tasks",
    inject: ["backgroundTasksManager"],
    apply(ctx) {
      const { trustedHandle } = deps;

      trustedHandle("background-tasks:list", (_event, sessionId) => ctx.backgroundTasksManager.listTasks(sessionId));
      trustedHandle("background-tasks:start", (_event, payload) => ctx.backgroundTasksManager.startTask(payload));
      trustedHandle("background-tasks:stop", async (_event, taskId) => ({ ok: await ctx.backgroundTasksManager.stopTask(taskId) }));
      trustedHandle("background-tasks:restart", async (_event, taskId) => ctx.backgroundTasksManager.restartTask(taskId));
      trustedHandle("background-tasks:get-logs", (_event, taskId) => ctx.backgroundTasksManager.getTaskLogs(taskId));
    },
  };
}
