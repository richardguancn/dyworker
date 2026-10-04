// 插件 HTTP 路由的 IPC 桥：渲染端对 /api/* 的 fetch 送到这里，由 connection 服务执行插件注册的 handler。
//
// 通道名即契约，改名前要同步 electron/preload.cjs。

export function pluginApiIpcPlugin() {
  return {
    name: "plugin-api-ipc",
    inject: ["ipc", "connection"],
    apply(ctx: any) {
      ctx.effect(() => ctx.ipc.handle("plugin-api:fetch", (_event: unknown, payload: any) =>
        ctx.connection.dispatch({
          path: String(payload?.path || ""),
          method: String(payload?.method || "GET"),
          body: typeof payload?.body === "string" ? payload.body : undefined,
          headers: payload?.headers,
        })));

      // 让界面能看到"插件注册了哪些接口"，便于排查
      ctx.effect(() => ctx.ipc.handle("plugin-api:routes", () => ({ routes: ctx.connection.list() })));
    },
  };
}
