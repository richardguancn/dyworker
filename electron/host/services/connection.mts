import { Service } from "@deepseek-ai/cordis";

// connection 服务：DSH 插件用它注册自己的 HTTP 路由。
//
// 实测（dsh-context 主机半边）：
//   const register = c.get("connection").fetch.register.bind(connection.fetch);
//   register({ path: "/api/dsh-context/detail", methods: ["POST"], requestBody: "buffered", fetch: handler });
// handler 收到一个 Request，返回 Response。
//
// 我们不跑真实 HTTP 服务：路由收集在这里，渲染端对 /api/* 的 fetch 经 IPC 进来，
// 由本服务匹配并执行 handler，再把响应序列化回去。这样插件代码不用改，也不开监听端口。


export interface PluginRoute {
  path: string;
  methods: string[];
  requestBody?: string;
  /** DSH 的字段名就是 fetch；handler 只是我们内部叫法，两个都接 */
  fetch?: (request: Request) => Response | Promise<Response>;
  handler?: (request: Request) => Response | Promise<Response>;
  dispose?: () => void;
}

export interface RouteDispatchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// 路由表放在模块级：cordis 交给插件的 connection 是**包装后的对象**（实测
// `connection === 服务实例` 为 false），实例字段会被写到另一个对象上，导致
// 插件注册成功但路由表为空。用模块级注册表就与 this 的身份无关。
const registeredRoutes = new Map<string, PluginRoute>();

function routeKey(path: string, method: string): string {
  return `${String(method || "GET").toUpperCase()} ${String(path)}`;
}

/** 注册一条插件路由（模块级：不依赖 this，cordis 交给插件的包装对象不会带走它） */
export function registerPluginRoute(route: PluginRoute): () => void {
  // 关键：DSH 插件注册时把处理函数放在 **fetch** 字段上
  // （register({ path, methods, requestBody, fetch })）。只认 handler 会把插件的路由全部丢掉。
  const handler = route?.fetch ?? route?.handler;
  if (!route?.path || typeof handler !== "function") return () => undefined;
  const path = String(route.path);
  const methods = (Array.isArray(route.methods) && route.methods.length ? route.methods : ["GET"]).map((m) => String(m).toUpperCase());
  const entry: PluginRoute = { path, methods, requestBody: route.requestBody, fetch: handler, handler };
  for (const method of methods) registeredRoutes.set(routeKey(path, method), entry);
  // 返回的 disposer 刻意**不注销**：实测插件注册进来的路由会被 cordis 的 inject fiber
  // 重启带走（"注册→立刻注销"循环），路由永远留不住。插件重新注册会覆盖同一个 key，
  // 因此保留是安全的；真正卸载用 clearPluginRoutes()（由宿主在禁用/卸载插件时调用）。
  return () => undefined;
}

/** 清空所有插件路由（宿主在插件禁用/卸载时调用） */
export function clearPluginRoutes(): void {
  registeredRoutes.clear();
}

/** 注销一条插件路由 */
export function unregisterPluginRoute(path: string): void {
  const key = String(path);
  for (const [routeId, entry] of registeredRoutes) {
    if (entry.path === key) registeredRoutes.delete(routeId);
  }
}

/** 当前注册的路由 */
export function listPluginRoutes(): string[] {
  const seen = new Map<string, PluginRoute>();
  for (const entry of registeredRoutes.values()) seen.set(entry.path, entry);
  return [...seen.values()].map((entry) => `${entry.methods.join("/")} ${entry.path}`);
}

/**
 * connection 服务（cordis Service 子类）。
 *
 * 路由表与处理逻辑都在**模块级**（registeredRoutes / registerPluginRoute / dispatchPluginRoute）：
 * 一是与 this 的身份无关，二是普通对象服务会让 cordis 的 inject fiber 反复重启
 * （实测"注册→立刻注销"循环，路由永远留不住），所以必须用规范的服务形态。
 */
export class ConnectionService extends Service {
  static name = "connection";

  /** 插件用的门面：connection.fetch.register({ path, methods, requestBody, fetch }) */
  fetch: {
    register: (route: any) => () => void;
    unregister: (path: string) => void;
  };

  constructor(ctx: any) {
    super(ctx, "connection");
    this.fetch = {
      register: (route: any) => registerPluginRoute(route),
      unregister: (path: string) => unregisterPluginRoute(path),
    };
  }

  /** 当前注册的路由（只读视图） */
  get routes(): PluginRoute[] {
    return [...registeredRoutes.values()];
  }

  register(route: PluginRoute): () => void {
    return registerPluginRoute(route);
  }

  unregister(path: string): void {
    unregisterPluginRoute(path);
  }

  list(): string[] {
    return listPluginRoutes();
  }

  async dispatch(input: { path: string; method?: string; body?: string; headers?: Record<string, string> }): Promise<RouteDispatchResult> {
    return dispatchPluginRoute(input);
  }
}

/** 执行一条已注册的路由；没有匹配的返回 404（渲染端据此如实报错） */
export async function dispatchPluginRoute(input: { path: string; method?: string; body?: string; headers?: Record<string, string> }): Promise<RouteDispatchResult> {
  const method = String(input?.method || "GET").toUpperCase();
  const route = registeredRoutes.get(routeKey(String(input?.path || ""), method));
  if (!route) {
    return { status: 404, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: `没有匹配的插件路由：${method} ${input?.path}` }) };
  }
  try {
    const request = new Request(`http://plugin.local${input.path}`, {
      method,
      headers: input.headers || { "content-type": "application/json" },
      body: method === "GET" || method === "HEAD" ? undefined : (input.body ?? ""),
    });
    const response = await (route.fetch ?? route.handler)!(request);
    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    return { status: response.status, headers, body };
  } catch (error: any) {
    return {
      status: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: String(error?.message || error) }),
    };
  }
}
