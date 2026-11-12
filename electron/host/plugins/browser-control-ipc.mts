// IPC 域插件：浏览器控制权（browser-control:*）。
// 控制器实例由壳层创建（依赖 mainWindow/webview 登记），经 deps 注入。

export function browserControlIpcPlugin(deps) {
  return {
    name: "ipc:browser-control",
    apply(ctx) {
      const { trustedHandle, browserControlManager, getMainWindow, backgroundBrowserHandoffs } = deps;

trustedHandle("browser-control:takeover", () => browserControlManager.takeover());

trustedHandle("browser-control:resume", (_event, payload) => {
  const result = browserControlManager.resume(payload);
  // 窗口可能在插件 apply 之后才创建/重建，这里每次现取
  const mainWindow = getMainWindow();
  if (result.ok && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("browser-control:resumed", {
      ownerSessionId: browserControlManager.session?.ownerSessionId,
      runId: browserControlManager.session?.runId,
      tabId: browserControlManager.session?.tabId,
    });
  }
  return result;
});

trustedHandle("browser-control:stop", () => browserControlManager.stop());

trustedHandle("browser-control:status", () => browserControlManager.getStatus());
trustedHandle('browser-control:validate-switch', (_event, request) => {
  const reservation = browserControlManager.openReservation;
  return Boolean(reservation && browserControlManager.isOpenReservationValid(request?.token)
    && reservation.ownerSessionId === String(request?.ownerSessionId || '') && reservation.tabId === String(request?.tabId || ''));
});
trustedHandle('background-browser-handoff:list', () => backgroundBrowserHandoffs.list());
trustedHandle('background-browser-handoff:show', (_event, id) => backgroundBrowserHandoffs.show(id));
trustedHandle('background-browser-handoff:ready', (_event, id) => backgroundBrowserHandoffs.ready(id));
trustedHandle('background-browser-handoff:choose-file', (_event, id) => backgroundBrowserHandoffs.chooseFile(id));
trustedHandle('background-browser-handoff:discard', (_event, id) => backgroundBrowserHandoffs.discard(id));
    },
  };
}
