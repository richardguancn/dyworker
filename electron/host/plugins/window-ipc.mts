// IPC 域插件：窗口控制（window:*）。
// 只做通道映射到 BrowserWindow 动作；主窗口句柄由壳层以 getter 注入（窗口会被重建）。
export function windowIpcPlugin(deps) {
  return {
    name: "ipc:window",
    apply(ctx) {
      const { trustedHandle, getMainWindow } = deps;

      trustedHandle("window:minimize", () => getMainWindow()?.minimize());
      trustedHandle("window:toggle-maximize", () => {
        const mainWindow = getMainWindow();
        if (!mainWindow) return;
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
      });
      trustedHandle("window:close", () => getMainWindow()?.close());
    },
  };
}
