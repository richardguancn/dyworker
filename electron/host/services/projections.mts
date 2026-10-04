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
import { estimateMessagesTokens } from "../../agent.mts";

/** 与会话投影相关的常量：DSH 的键名是固定的字面量 */
export const CONTEXT_TIMELINE_KEY = "contextTimeline";

/** 投影里的一条界面节点（对应 DSH TimelineState.surface 的元素） */
interface SurfaceNode {
  seq: number;
  cat: "user" | "inject" | "skill" | "assistant" | "tool";
  tokens: number;
  tool?: string;
  imgs?: number;
}

/**
 * 把**我们自己的**会话记录折成 DSH 的 contextTimeline 投影状态。
 *
 * 为什么由我们折：DSH 的投影引擎依赖它自己的会话日志格式与事件流，我们没有那套数据；
 * 但消费端（dsh-context 的 buildTimelineDetail / headFieldsOf / detailCollectionsOf）
 * 只要求这个状态对象有若干字段，形状可以直接从它的实现里读出来：
 *   sums{user,inject,skill,assistant,tool} / systemTokens / toolsTokens /
 *   surface[] / requests[] / events[] / archived[] / fileOps[] / spans[] / detailRev
 * 因此我们按同样的语义折自己的消息流即可——它是**我们数据的真实投影**，不是占位假数据。
 */
export function foldContextTimeline(session: any) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  if (!messages.length) return undefined;

  const sums = { user: 0, inject: 0, skill: 0, assistant: 0, tool: 0 };
  const surface: SurfaceNode[] = [];
  const requests: Array<{ turn: number; seq: number; total: number; prompt: number }> = [];
  let systemTokens = 0;
  let toolsTokens = 0;
  let turn = 0;
  let promptTokens = 0;
  let seq = 0;

  for (const message of messages) {
    const role = String(message?.role || "");
    const tokens = estimateMessagesTokens([message]);
    seq += 1;

    if (role === "system") {
      // 系统提示词单独计：它不进 surface，但算在上下文占用里
      systemTokens += tokens;
      continue;
    }

    // 分类对照 DSH 的 categoryOf：assistant/tool 按 role，其余按 source.kind 区分技能注入与普通注入
    const sourceKind = String(message?.source?.kind || "");
    const cat: SurfaceNode["cat"] = role === "assistant"
      ? "assistant"
      : role === "tool"
        ? "tool"
        : sourceKind === "skill-invocation" || sourceKind === "skill-catalog"
          ? "skill"
          : sourceKind === "injection" || sourceKind === "inject"
            ? "inject"
            : "user";
    const tool = cat === "tool" ? String(message?.toolName || message?.name || message?.tool_calls?.[0]?.function?.name || "") : undefined;
    const imgs = Array.isArray(message?.content)
      ? message.content.filter((part: any) => part?.type === "image_url").length
      : 0;

    sums[cat] += tokens;
    surface.push({ seq, cat, tokens, ...(tool ? { tool } : {}), ...(imgs ? { imgs } : {}) });

    if (cat === "user" || cat === "inject" || cat === "skill") {
      promptTokens += tokens;
      continue;
    }

    if (cat === "tool") {
      // 工具结果是本次请求的一部分，计入 tools 占用
      toolsTokens += tokens;
      continue;
    }

    // 助手消息 = 一次请求的产出：记一条 request（total 是当时的上下文占用）
    if (cat === "assistant") {
      turn += 1;
      const total = systemTokens + toolsTokens + sums.user + sums.inject + sums.skill;
      requests.push({ turn, seq, total, prompt: promptTokens });
      promptTokens = 0;
    }
  }

  return {
    surface,
    sums,
    systemTokens,
    toolsTokens,
    requests,
    turnRuns: turn,
    events: [],
    archived: [],
    callNames: {},
    fileOps: [],
    spans: [],
    // 修订号按消息数取：会话增长就换版本，客户端据此判断是否需要重新取详情
    detailRev: messages.length,
  };
}

/**
 * 把投影状态折成**客户端线格式视图**。
 *
 * 为什么需要两套：DSH 客户端拿到的投影是 `buildTimelineView` 的结果——
 *   { ...headFieldsOf(state), ...detailCollectionsOf(state, bounds) }
 * 即 `current/images/toolCalls/humanInputs/counts/last` + `requests/events/nodes/archive/...` **都在顶层**；
 * 而插件主机半边的 detail 路由要的是**原始状态**（它自己再调 buildTimelineDetail）。
 * 两者语义不同，所以分别提供：stateOf 给插件路由，viewOf 给客户端的 useProjection。
 *
 * 客户端 `timelineOf` 的校验要求：current 的 8 个字段都是有限数字，
 * requests/events/nodes/archive 都是对象数组（systems/timing 可省略）。
 */
export function timelineWireView(state: any, maxNodes = 200) {
  if (!state) return null;
  const surfaceTotal = state.sums.user + state.sums.inject + state.sums.skill + state.sums.assistant + state.sums.tool;
  const overflowCount = Math.max(0, state.surface.length - maxNodes);
  const overflow = state.surface.slice(0, overflowCount);
  const tail = state.surface.slice(overflowCount);
  const pinned = overflow.filter((node: any) => node.cat === "inject" || node.cat === "skill");
  const nodes = pinned.length ? [...pinned, ...tail] : tail;
  const turns = new Set<number>();
  for (const request of state.requests) turns.add(request.turn ?? 0);
  let injects = 0;
  let compactions = 0;
  let prunes = 0;
  for (const event of state.events) {
    if (event.kind === "inject") injects += 1;
    else if (event.kind === "compaction") compactions += 1;
    else if (event.kind === "prune") prunes += 1;
  }
  const last = state.requests[state.requests.length - 1];
  return {
    ok: true,
    current: {
      system: state.systemTokens,
      tools: state.toolsTokens,
      user: state.sums.user,
      inject: state.sums.inject,
      skill: state.sums.skill,
      assistant: state.sums.assistant,
      tool: state.sums.tool,
      total: surfaceTotal + state.systemTokens + state.toolsTokens,
    },
    images: state.surface.reduce((sum: number, node: any) => sum + (node.imgs ?? 0), 0),
    toolCalls: state.surface.reduce((sum: number, node: any) => (node.cat === "tool" || (node.cat === "skill" && node.tool !== undefined) ? sum + 1 : sum), 0),
    humanInputs: state.sums.user,
    counts: { turns: turns.size, steps: state.requests.length, injects, compactions, prunes },
    ...(last ? { last: { seq: last.seq, total: last.total, ...(typeof last.prompt === "number" ? { prompt: last.prompt } : {}) } } : {}),
    detailRev: state.detailRev ?? 0,
    requests: state.requests.map((request: any) => ({ ...request })),
    events: state.events.map((event: any) => ({ ...event })),
    nodes: nodes.map((node: any) => ({ ...node })),
    droppedNodes: overflowCount - pinned.length,
    archive: state.archived.map((node: any) => ({ ...node })),
    fileOps: state.fileOps.map((entry: any) => ({ ...entry })),
    spans: state.spans.map((entry: any) => ({ ...entry })),
  };
}

export class SessionProjectionsService extends Service {
  static name = "sessionProjections";

  constructor(ctx: any) {
    super(ctx, "sessionProjections");
  }

  /**
   * 取某个会话的投影。目前只实现 contextTimeline（dsh-context 的「上下文」面板要的那个）。
   * 空会话如实返回 undefined——它的语义就是"还没有这个投影"。
   */
  stateOf(session: unknown, key: string): unknown {
    if (String(key || "") !== CONTEXT_TIMELINE_KEY) return undefined;
    return foldContextTimeline(session);
  }

  /**
   * 客户端要的**线格式视图**（useProjection 的返回值）。
   * 与 stateOf 的区别见 timelineWireView 注释。
   */
  viewOf(session: unknown, key: string): unknown {
    if (String(key || "") !== CONTEXT_TIMELINE_KEY) return null;
    return timelineWireView(foldContextTimeline(session));
  }

  /** 插件可能问"有哪些投影键" */
  keysOf(session: unknown): string[] {
    return foldContextTimeline(session) ? [CONTEXT_TIMELINE_KEY] : [];
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
