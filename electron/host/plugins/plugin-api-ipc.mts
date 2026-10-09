// 插件 HTTP 路由的 IPC 桥：渲染端对 /api/* 的 fetch 送到这里，由 connection 服务执行插件注册的 handler。
//
// 通道名即契约，改名前要同步 electron/preload.cjs。
import { PUBLIC_MODEL_PRICES_PATH, readPublicModelPrices } from '../public-model-prices.mts';

export function pluginApiIpcPlugin() {
  return {
    name: "plugin-api-ipc",
    inject: ["ipc", "connection"],
    apply(ctx: any) {
      const pending = new Map();
      ctx.effect(() => () => { for (const controller of pending.values()) controller.abort(); pending.clear(); });
      ctx.effect(() => ctx.ipc.handle("plugin-api:cancel", (event: any, requestId: string) => {
        const key = `${event?.sender?.id || 0}:${requestId}`;
        pending.get(key)?.abort(new Error("插件请求已取消"));
        return { ok: true };
      }));
      ctx.effect(() => ctx.ipc.handle("plugin-api:fetch", async (event: any, payload: any) => {
        const key = `${event?.sender?.id || 0}:${payload?.requestId || ""}`;
        if (pending.has(key)) throw new Error("重复的插件请求标识");
        const controller = new AbortController(); pending.set(key, controller);
        try {
          if (payload?.path === PUBLIC_MODEL_PRICES_PATH) {
            if (payload.method !== 'GET' || payload.body !== undefined)
              return { status: 405, body: JSON.stringify({ error: '模型价格资料只允许读取' }) };
            return await readPublicModelPrices(controller.signal);
          }
          let body;
          try { body = JSON.parse(payload?.body || '{}'); } catch {}
          const url = new URL(String(payload?.path || '/'), 'http://dyworker.local');
          const sessionId = body?.sessionId || url.searchParams.get('sessionId');
          const session = sessionId ? ctx.get('sessions')?.get(sessionId) : null;
          // 原生插件仍使用自身接口（如轨迹读取），不能因所属会话方式而错送到 DSH。
          if (session?.runtime === 'dsh' && !ctx.connection.matches(String(payload?.path || ''), String(payload?.method || 'GET')))
            return await ctx.get('dshRuntime').request(sessionId, 'route', {
            path: String(payload?.path || ''), method: String(payload?.method || 'GET'), body: payload?.body,
            headers: payload?.headers,
          }, { signal: controller.signal });
          return await ctx.connection.dispatch({
          path: String(payload?.path || ""),
          method: String(payload?.method || "GET"),
          body: typeof payload?.body === "string" ? payload.body : undefined,
          headers: payload?.headers,
          signal: controller.signal,
        }); } finally { pending.delete(key); }
      }));

      // 让界面能看到"插件注册了哪些接口"，便于排查
      ctx.effect(() => ctx.ipc.handle("plugin-api:routes", () => ({ routes: ctx.connection.list() })));
    },
  };
}
