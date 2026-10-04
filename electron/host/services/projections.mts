// sessionProjections 服务：DSH 的会话投影（把会话日志折成派生视图）。
//
// dsh-context 主机半边 inject 了它，并用 projections.stateOf(session, "contextTimeline") 取投影。
// 我们还没有实现"折叠会话日志成投影"这一层，所以这里**如实返回 undefined**——
// dsh-context 的 detail 路由对 undefined 的处理是回复 { ok: true, value: null }，
// 因此插件界面会渲染"空"而不是"加载失败"。等真正实现投影后替换这一个方法即可。
//
// 注意：这不是假的成功——stateOf 返回 undefined 的语义就是"还没有这个投影"，
// 与 DSH 在投影未就绪时的行为一致。

import { Service } from "@deepseek-ai/cordis";

export class SessionProjectionsService extends Service {
  static name = "sessionProjections";

  constructor(ctx: any) {
    super(ctx, "sessionProjections");
  }

  /** 目前一律「还没有投影」；实现折叠后在这里按 key 返回真实视图 */
  stateOf(_session: unknown, _key: string): undefined {
    return undefined;
  }

  /** 插件可能问"有哪些投影键"，给空列表而不是抛错 */
  keysOf(_session: unknown): string[] {
    return [];
  }
}

/** 会话投影缓存：DSH 里用来避免重复折叠，我们先用同名空实现满足 inject */
export class SessionProjectionCacheService extends Service {
  static name = "sessionProjectionCache";

  private readonly entries = new Map<string, unknown>();

  constructor(ctx: any) {
    super(ctx, "sessionProjectionCache");
  }

  get(key: string): unknown {
    return this.entries.get(String(key));
  }

  set(key: string, value: unknown): void {
    this.entries.set(String(key), value);
  }

  delete(key: string): void {
    this.entries.delete(String(key));
  }
}
