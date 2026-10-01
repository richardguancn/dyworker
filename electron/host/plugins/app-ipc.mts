// IPC 域插件：应用初始状态（app:initial-state）。
// 聚合会话、工作区条目、设置与置顶路径；各来源经 deps 注入（会话存档走 ctx.sessions）。

export function appIpcPlugin(deps) {
  return {
    name: "ipc:app",
    inject: ["sessions"],
    apply(ctx) {
      const { trustedHandle, readAllSessions, defaultSessions, readJson, dataFile, listWorkspace, readSettings, getMainWindow, platform } = deps;

trustedHandle("app:initial-state", async () => {
  // 全新安装时保留默认欢迎会话；已有存档（拆分文件或迁移数据）则原样返回
  const loaded: any[] = (await readAllSessions()) || [];
  const sessions = loaded.length ? loaded : defaultSessions();
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
