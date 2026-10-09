import { Service } from "@deepseek-ai/cordis";

export interface PluginRoute {
  path: string;
  methods?: string[];
  requestBody?: string;
  fetch?: (request: Request) => Response | Promise<Response>;
  handler?: (request: Request) => Response | Promise<Response>;
}
export interface RouteDispatchResult { status: number; headers: Record<string, string>; body: string }
interface RouteEntry { route: PluginRoute; owner: object; calls: Set<Promise<unknown>>; controllers: Set<AbortController> }
export class PluginRouteRegistry {
  readonly entries = new Map<string, RouteEntry>();
  register(route: PluginRoute, owner: object): () => Promise<void> {
    const handler = route?.fetch ?? route?.handler;
    if (!/^\/api(?:\/|$)/.test(route?.path || "") || typeof handler !== "function") throw new Error("插件接口需要 /api 路径和处理函数");
    const methods = (route.methods?.length ? route.methods : ["GET"]).map(m => String(m).toUpperCase());
    const keys = methods.map(m => `${m} ${route.path}`);
    if (keys.some(key => this.entries.has(key))) throw new Error(`插件接口已被注册：${route.path}`);
    const entry: RouteEntry = { route: { ...route, methods, fetch: handler }, owner, calls: new Set(), controllers: new Set() };
    for (const key of keys) this.entries.set(key, entry);
    let stopping: Promise<void>;
    return () => stopping ??= this.remove(entry);
  }
  async remove(entry: RouteEntry) {
    for (const [key, current] of this.entries) if (current === entry) this.entries.delete(key);
    for (const controller of entry.controllers) controller.abort(new Error("插件接口已停用"));
    await Promise.allSettled([...entry.calls]);
  }
  async clear(owner?: object, routePath?: string) {
    const entries = [...new Set(this.entries.values())].filter(e => (!owner || e.owner === owner) && (!routePath || e.route.path === routePath));
    await Promise.all(entries.map(e => this.remove(e)));
  }
  list() { return [...new Set(this.entries.values())].map(e => `${e.route.methods.join("/")} ${e.route.path}`); }
  async dispatch(input: { path: string; method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal }): Promise<RouteDispatchResult> {
    const url = new URL(String(input?.path || "/"), "http://plugin.local");
    const method = String(input?.method || "GET").toUpperCase();
    const entry = this.entries.get(`${method} ${url.pathname}`);
    const response = (status: number, error: string) => ({ status, headers: { "content-type": "application/json" }, body: JSON.stringify({ error }) });
    if (!entry) return response(404, `没有匹配的插件路由：${method} ${url.pathname}`);
    const controller = new AbortController();
    const onAbort = () => controller.abort(input.signal.reason);
    if (input.signal?.aborted) onAbort(); else input.signal?.addEventListener("abort", onAbort, { once: true });
    entry.controllers.add(controller);
    const task = (async () => {
      try {
        controller.signal.throwIfAborted();
        const request = new Request(url, { method, headers: input.headers, signal: controller.signal,
          body: ["GET", "HEAD"].includes(method) ? undefined : input.body });
        const result = await entry.route.fetch(request);
        const body = await result.text();
        controller.signal.throwIfAborted();
        return { status: result.status, headers: Object.fromEntries(result.headers), body };
      } catch (error: any) { return response(controller.signal.aborted ? 410 : 500, String(error?.message || error)); }
    })();
    entry.calls.add(task);
    try { return await task; }
    finally { entry.calls.delete(task); entry.controllers.delete(controller); input.signal?.removeEventListener("abort", onAbort); }
  }
}

/** 每个宿主拥有自己的注册表；服务包装对象只读取这个稳定对象，不替换实例字段。 */
export class ConnectionService extends Service {
  readonly registry = new PluginRouteRegistry();
  constructor(ctx: any) {
    super(ctx, "connection");
    ctx.effect(() => () => this.registry.clear());
  }
  get fetch() { return { register: (route: PluginRoute) => this.register(route), unregister: (routePath: string) => this.unregister(routePath) }; }
  get routes() { return [...new Set(this.registry.entries.values())].map(e => e.route); }
  register(route: PluginRoute) {
    const dispose = this.registry.register(route, this.ctx.fiber);
    // 注册自身也受调用方 fiber 生命周期管理，即使插件忘记再用 effect 包装。
    this.ctx.effect(() => dispose);
    return dispose;
  }
  unregister(routePath: string) { return this.registry.clear(this.ctx.fiber, routePath); }
  list() { return this.registry.list(); }
  matches(routePath: string, method = 'GET') {
    const url = new URL(routePath, 'http://plugin.local');
    return this.registry.entries.has(`${method.toUpperCase()} ${url.pathname}`);
  }
  dispatch(input: Parameters<PluginRouteRegistry["dispatch"]>[0]) { return this.registry.dispatch(input); }
}

// 纯函数调用者的独立注册表，不与任何 Cordis 宿主共享。
const standalone = new PluginRouteRegistry();
const standaloneOwner = {};
export const registerPluginRoute = (route: PluginRoute) => standalone.register(route, standaloneOwner);
export const unregisterPluginRoute = (routePath: string) => standalone.clear(standaloneOwner, routePath);
export const clearPluginRoutes = () => standalone.clear();
export const listPluginRoutes = () => standalone.list();
export const dispatchPluginRoute = (input: Parameters<PluginRouteRegistry["dispatch"]>[0]) => standalone.dispatch(input);
