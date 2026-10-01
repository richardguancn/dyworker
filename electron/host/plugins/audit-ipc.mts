// IPC 域插件：审计日志（audit:open）。
// 审计落盘在 ctx.audit 服务里；这里只负责"用系统默认程序打开文件"这一桌面动作。
export function auditIpcPlugin(deps) {
  return {
    name: "ipc:audit",
    inject: ["audit"],
    apply(ctx) {
      const { trustedHandle, dataFile, existsSync, fs, shell } = deps;

      trustedHandle("audit:open", async () => {
        const auditPath = dataFile("audit.jsonl");
        if (!existsSync(auditPath)) await fs.writeFile(auditPath, "", "utf8");
        return shell.openPath(auditPath);
      });
    },
  };
}
