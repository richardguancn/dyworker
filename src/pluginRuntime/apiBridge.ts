// 把插件对 /api/* 的 fetch 桥到主进程，交给插件自己注册的路由处理。
//
// 为什么需要它：DSH 客户端插件按约定直接 fetch("/api/<插件名>/...")，而我们的页面不是
// http 源（打包后是 file://），相对路径的 fetch 到不了任何 HTTP 服务。
// 我们不为此开监听端口：在主进程收集插件注册的路由（connection.fetch.register），
// 渲染端把同源 /api/* 的 fetch 经 IPC 送进去执行，再合成一个 Response 回来。
// 插件代码一行不用改，也不新增网络面。

export interface PluginApiFetchPayload {
  requestId?: string;
  path: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
}

export interface PluginApiFetchResult {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

export interface PluginApiBridgeTarget {
  pluginApiFetch?: (payload: PluginApiFetchPayload) => Promise<PluginApiFetchResult>;
  pluginApiCancel?: (requestId: string) => Promise<unknown>;
}

const DEFAULT_HEADERS = { "content-type": "application/json" };

function requestUrl(input: unknown): string {
  if (typeof input === "string") return input;
  const anyInput = input as any;
  if (anyInput && typeof anyInput.url === "string") return anyInput.url;
  return String(input ?? "");
}

/** 是否是插件的 API 路由（同源 /api/*） */
export function isPluginApiPath(url: string): boolean {
  return /^\/api(\/|$|\?)/.test(String(url || ""));
}

/**
 * 安装 fetch 拦截。
 * 只接管同源 /api/*，其余请求原样透传；返回复原函数。
 */
export function installPluginApiBridge(target: any = globalThis, bridge?: PluginApiBridgeTarget): () => void {
  if (!target || typeof target.fetch !== "function") return () => undefined;
  const original = target.fetch;

  const patched = async (input: unknown, init?: any): Promise<Response> => {
    const url = requestUrl(input);
    const modelPrices = url === 'https://models.dev/api.json';
    if (!isPluginApiPath(url) && !modelPrices) return original.call(target, input as any, init);

    const api = bridge || (target as any).dyworker;
    const path = modelPrices ? '/api/dyworker/public-model-prices' : String(url) || "/api";
    const method = String(init?.method || (input as any)?.method || "GET").toUpperCase();
    const body = typeof init?.body === "string"
      ? init.body
      : typeof (input as any)?.body === "string"
        ? (input as any).body
        : input instanceof Request && !["GET", "HEAD"].includes(method) ? await input.clone().text() : undefined;
    const headers = Object.fromEntries(new Headers(init?.headers || (input as any)?.headers || {}).entries());
    const signal = init?.signal || (input as any)?.signal;
    signal?.throwIfAborted();
    if (modelPrices && (method !== 'GET' || body !== undefined))
      return new Response(JSON.stringify({ error: '模型价格资料只允许读取' }), { status: 405, headers: DEFAULT_HEADERS });
    const requestId = crypto.randomUUID();
    const abort = () => { void api?.pluginApiCancel?.(requestId); };

    if (typeof api?.pluginApiFetch !== "function") {
      // 没有桥（例如网页环境）：如实报错，而不是让插件拿到一个假的成功响应
      return new Response(JSON.stringify({ error: "插件 API 桥未安装" }), { status: 502, headers: DEFAULT_HEADERS });
    }

    try {
      signal?.addEventListener("abort", abort, { once: true });
      const result = await api.pluginApiFetch({ requestId, path, method, body, headers: modelPrices ? {} : headers });
      signal?.throwIfAborted();
      return new Response(result?.body ?? "", {
        status: result?.status || 200,
        headers: result?.headers || DEFAULT_HEADERS,
      });
    } catch (error: any) {
      if (signal?.aborted) throw signal.reason;
      return new Response(JSON.stringify({ error: String(error?.message || error) }), { status: 502, headers: DEFAULT_HEADERS });
    } finally { signal?.removeEventListener("abort", abort); }
  };

  target.fetch = patched;
  return () => {
    if (target.fetch === patched) target.fetch = original;
  };
}
