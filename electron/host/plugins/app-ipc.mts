// IPC 域插件：应用初始状态（app:initial-state）。
// 聚合会话、工作区条目、设置与置顶路径；各来源经 deps 注入（会话存档走 ctx.sessions）。

export function appIpcPlugin(deps) {
  return {
    name: "ipc:app",
    inject: ["sessions"],
    apply(ctx) {
      const { trustedHandle, readAllSessions, readJson, dataFile, listWorkspace, readSettings, getMainWindow, platform } = deps;

trustedHandle("app:initial-state", async () => {
  // 无存档时由界面展示未发送的新任务，不生成欢迎对话占用任务列表。
  const sessions: any[] = (await readAllSessions()) || [];
  const workspacePath = sessions.find((session) => session.workspacePath)?.workspacePath || "";
  const pinnedWorkspacePaths = await readJson(dataFile("workspace-pins.json"), []);
  return {
    sessions,
    activeSessionId: await ctx.sessions.getActiveId(),
    workspacePath,
    workspaceEntries: await listWorkspace(workspacePath),
    settings: await readSettings(),
    pinnedWorkspacePaths: Array.isArray(pinnedWorkspacePaths)
      ? pinnedWorkspacePaths.filter((item) => typeof item === "string" && item.trim())
      : [],
    platform: process.platform,
    windowShadow: false, // 兼容旧界面字段；系统阴影无需透明留白
    windowMaximized: getMainWindow()?.isMaximized() ?? false,
  };
});
    },
  };
}
