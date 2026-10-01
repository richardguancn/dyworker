// IPC 域插件：应用更新（app-update:*）。
// 更新器实例在 whenReady 后才创建、重启场景下还会被替换，故经 getter 注入；
// 版本号取 app.getVersion()（由壳层以 appVersion 注入）。
export function appUpdateIpcPlugin(deps) {
  return {
    name: "ipc:app-update",
    apply(ctx) {
      const { trustedHandle, getUpdater, appVersion } = deps;
      const unavailable = () => ({ ok: false, state: "unavailable", error: "更新服务尚未准备好" });

      trustedHandle("app-update:status", () => getUpdater()?.getStatus() || {
        state: "unavailable",
        currentVersion: appVersion(),
      });

      trustedHandle("app-update:check", () => getUpdater()?.check() || unavailable());
      trustedHandle("app-update:download", () => getUpdater()?.download() || unavailable());
      trustedHandle("app-update:install", () => getUpdater()?.install() || unavailable());
    },
  };
}
