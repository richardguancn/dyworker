// IPC 域插件：审计日志（audit:open）。
// 审计落盘在 ctx.audit 服务里；这里只负责"用系统默认程序打开文件"这一桌面动作。
//
// 【契约层样板】本插件是内置插件迁移到契约服务（ctx.ipc / ctx.storage / ctx.window）
// 的参考实现：不再接收壳层 deps 大包，只声明 inject；通道用 ctx.effect 绑定生命周期，
// 插件停用/卸载时通道会被注销（否则重新启用会撞 Electron 的 second handler）。
export function auditIpcPlugin() {
  return {
    name: "ipc:audit",
    inject: ["audit", "ipc", "storage", "window"],
    apply(ctx) {
      ctx.effect(() => ctx.ipc.handle("audit:open", async () => {
        // 路径来自审计服务本身（userData 根），不要用 storage 的相对名——
        // 那会落在插件数据目录里，打开的是另一个文件。
        const auditPath = ctx.audit.file();
        if (!auditPath) throw new Error("审计日志路径不可用");
        if (!(await ctx.storage.exists(auditPath))) await ctx.storage.writeText(auditPath, "");
        return ctx.window.shell.openPath(auditPath);
      }));
    },
  };
}
