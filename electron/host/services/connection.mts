// connection 服务：DSH 插件用它注册自己的 HTTP 路由。
//
// 实测（dsh-context 主机半边）：
//   const register = c.get("connection").fetch.register.bind(connection.fetch);
//   register({ path: "/api/dsh-context/detail", methods: ["POST"], requestBody: "buffered", fetch: handler });
// handler 收到一个 Request，返回 Response。
//
// 我们不跑真实 HTTP 服务：路由收集在这里，渲染端对 /api/* 的 fetch 经 IPC 进来，
// 由本服务匹配并执行 handler，再把响应序列化回去。这样插件代码不用改，也不开监听端口。

import { Service } from "@deepseek-ai/cordis";

export interface PluginRoute {
  path: string;
  methods: string[];
  requestBody?: string;
  handler: (request: Request) => Response | Promise<Response>;
  dispose?: () => void;
}

export interface RouteDispatchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export class ConnectionService extends Service {
  static name = "connection";

  routes: PluginRoute[] = [];

  constructor(ctx: any) {
    super(ctx, "connection");
  }

  /** 给插件用的门面：connection.fetch.register(...) */
  get fetch() {
    return {
      register: (route: any) => this.register(route),
      unregister: (path: string) => this.unregister(path),
    };
  }

  /** 插件注册一条路由；返回注销函数（cordis effect 会调它） */
  register(route: PluginRoute): () => void {
    if (!route?.path || typeof route.handler !== "function") return () => undefined;
    const entry: PluginRoute = {
      path: String(route.path),
      methods: (Array.isArray(route.methods) && route.methods.length ? route.methods : ["GET"]).map((m) => String(m).toUpperCase()),
      requestBody: route.requestBody,
      handler: route.handler,
    };
    this.routes.push(entry);
    return () => this.unregister(entry.path);
  }

  unregister(path: string): void {
    const key = String(path);
    this.routes = this.routes.filter((entry) => entry.path !== key);
  }

  list(): string[] {
    return this.routes.map((entry) => `${entry.methods.join("/")} ${entry.path}`);
  }

  /** 执行一条已注册的路由；没有匹配的返回 404（渲染端据此如实报错） */
  async dispatch(input: { path: string; method?: string; body?: string; headers?: Record<string, string> }): Promise<RouteDispatchResult> {
    const method = String(input?.method || "GET").toUpperCase();
    const route = this.routes.find((entry) => entry.path === input?.path && entry.methods.includes(method));
    if (!route) {
      return { status: 404, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: `没有匹配的插件路由：${method} ${input?.path}` }) };
    }
    try {
      const request = new Request(`http://plugin.local${input.path}`, {
        method,
        headers: input.headers || { "content-type": "application/json" },
        body: method === "GET" || method === "HEAD" ? undefined : (input.body ?? ""),
      });
      const response = await route.handler(request);
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
}
