// 原生轨迹视图的数据模型。
//
// 数据源只有两样，都是我们自己的：
//   1. TraceEvent 流（会话级 append-only，落盘 userData/traces/<id>.jsonl，可回放）
//   2. 会话消息（补用户输入/助手正文这两处 trace 里没有的字段）
//
// 为什么单独一层：轨迹视图要按"轮次 → 步进 → 请求 → 工具调用"组织，还要算时长、
// token、模型、工具清单、压缩/结束标记。把归一化抽成纯函数，UI 只管画，测试也扎得住。
//
// 事件形状（实测）：
//   model-request  content=JSON{endpoint,model,messages…}  direction=in  target=model
//   model-response content=JSON{role,content…}             parentSeq→请求
//   token-usage    usage={prompt,completion,estimated}     parentSeq→请求
//   tool-call      content=参数 JSON
//   tool-result    content=结果文本  parentSeq→调用  title 里带"成功/失败"
//   activity/activity-update  activityKind=thinking|<工具名> phase=plan|execute|verify|deliver
//   plan-update / file-change / agent-finished / context-compacted

import type { TraceEvent } from "./types";

export interface TraceToolCall {
  seq: number;
  name: string;
  args: string;
  result: string;
  error: boolean;
  startedAt: string;
  durationMs: number | null;
  resultSeq: number | null;
}

export interface TraceRequest {
  seq: number;
  time: string;
  endpoint: string;
  model: string;
  /** 本轮用户输入（从请求载荷里取最后一条 user 消息，取不到就空串） */
  prompt: string;
  /** 助手回复正文 */
  reply: string;
  promptTokens: number | null;
  completionTokens: number | null;
  estimated: boolean;
  durationMs: number | null;
  tools: TraceToolCall[];
  /** 原始事件，供"原文"页签 */
  raw: { request: TraceEvent | null; response: TraceEvent | null; usage: TraceEvent | null };
}

export interface TraceStep {
  turn: number;
  step: number;
  requests: TraceRequest[];
  durationMs: number | null;
  startedAt: string | null;
}

export interface TraceTurn {
  turn: number;
  steps: TraceStep[];
  prompt: string;
  reply: string;
  startedAt: string | null;
  durationMs: number | null;
  toolCount: number;
  toolNames: string[];
}

export type TraceMarkerKind = "compaction" | "session-end" | "plan-update" | "phase" | "file-change";

export interface TraceMarker {
  seq: number;
  time: string;
  turn: number;
  kind: TraceMarkerKind;
  title: string;
  detail: string;
}

export interface TraceMetrics {
  /** 事件流的墙钟跨度（首末事件时间差），不是"生成耗时" */
  spanMs: number;
  /** 真正花在模型生成上的时间（各请求时长之和） */
  activeMs: number;
  turns: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  models: string[];
  tools: string[];
  requests: number;
}

export interface TraceModel {
  turns: TraceTurn[];
  markers: TraceMarker[];
  /** 按轮次归好的标记：轮内标记内嵌到对应轮次，turn<=0 的归到会话级 */
  markersByTurn: Map<number, TraceMarker[]>;
  sessionMarkers: TraceMarker[];
  metrics: TraceMetrics;
  /** 没有归属轮次的零散事件（例如任务开始前的活动） */
  loose: TraceEvent[];
}

function parseJson(value: unknown): any {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 从（可能被截断的）请求/响应载荷里捡字段。
 * 实测 trace 里的 content 有长度上限，JSON 会在中间被切断（12000 字符左右），
 * 整段 JSON.parse 必然失败——但 model / endpoint 这些字段在**前面**，正则能捞到。
 */
function pickField(text: string, key: string): string {
  const matched = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(text);
  return matched?.[1] ?? "";
}

/** 截断载荷里最后一条 user 消息：取最后一个 "role":"user" 之后最近的 content 文本 */
function pickLastUserText(text: string): string {
  const matches = [...text.matchAll(/"role"\s*:\s*"user"[\s\S]{0,400}?"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
  const last = matches.at(-1)?.[1];
  if (!last) return "";
  try {
    return JSON.parse(`"${last}"`);
  } catch {
    return last;
  }
}

function timeValue(time: unknown): number {
  const parsed = Date.parse(String(time ?? ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function diffMs(from: unknown, to: unknown): number | null {
  const a = timeValue(from);
  const b = timeValue(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

/** 从请求载荷里取最后一条 user 消息的文本（多模态数组取其中 text 片段） */
function lastUserText(payload: any): string {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((part: any) => (typeof part?.text === "string" ? part.text : "")).join("").trim();
    }
  }
  return "";
}

/** 助手回复正文：优先取响应载荷里的 content */
function replyText(payload: any, fallback: string): string {
  const content = payload?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part: any) => (typeof part?.text === "string" ? part.text : "")).join("").trim();
  }
  return fallback;
}

function usageOf(event: TraceEvent | undefined): { prompt: number | null; completion: number | null; estimated: boolean } {
  if (!event) return { prompt: null, completion: null, estimated: false };
  const raw: any = (event as any).usage ?? parseJson((event as any).content);
  const value = typeof raw === "string" ? parseJson(raw) : raw;
  const prompt = Number(value?.prompt ?? value?.prompt_tokens ?? value?.input);
  const completion = Number(value?.completion ?? value?.completion_tokens ?? value?.output);
  return {
    prompt: Number.isFinite(prompt) ? prompt : null,
    completion: Number.isFinite(completion) ? completion : null,
    estimated: Boolean(value?.estimated),
  };
}

/** 工具名：优先 title（"调用工具 run_command" / "工具 run_command 成功"），退回 activityKind */
function toolNameOf(event: TraceEvent): string {
  const title = String(event.title || "");
  const matched = /工具\s+(\S+?)(?:\s|$)/.exec(title);
  if (matched?.[1]) return matched[1];
  return String((event as any).activityKind || "tool");
}

const MARKER_TITLES: Record<string, TraceMarkerKind> = {
  "context-compacted": "compaction",
  compacted: "compaction",
  "agent-finished": "session-end",
  "plan-update": "plan-update",
  "file-change": "file-change",
};

/**
 * 会话消息兜底：trace 里的请求载荷会被截断，用户输入经常捞不全；
 * 而会话消息里的用户输入是完整的。按顺序把第 N 条用户消息配给第 N 轮（回合顺序一致）。
 */
function userMessagesOf(messages: any[] | undefined): string[] {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => String(message?.role || "") === "user")
    .map((message) => {
      const content = message?.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content.map((part: any) => (typeof part?.text === "string" ? part.text : "")).join("").trim();
      }
      return "";
    })
    .filter((text) => text.trim().length > 0);
}

export function buildTraceModel(traces: TraceEvent[], options: { messages?: any[] } = {}): TraceModel {
  const events = [...(Array.isArray(traces) ? traces : [])].sort((a, b) => Number(a.seq) - Number(b.seq));
  const turns = new Map<number, { steps: Map<number, TraceStep> }>();
  const markers: TraceMarker[] = [];
  const loose: TraceEvent[] = [];

  /** 请求按 seq 建索引，供响应/用量按 parentSeq 回填 */
  const requests = new Map<number, TraceRequest>();
  const toolCalls = new Map<number, TraceToolCall>();
  /** 每个轮次最近一次请求：工具调用属于"发起它的那次请求"，而工具事件自己的 step 往往更大 */
  const lastRequestByTurn = new Map<number, TraceRequest>();

  const stepOf = (turn: number, step: number): TraceStep => {
    const bucket = turns.get(turn) || { steps: new Map<number, TraceStep>() };
    turns.set(turn, bucket);
    let entry = bucket.steps.get(step);
    if (!entry) {
      entry = { turn, step, requests: [], durationMs: null, startedAt: null };
      bucket.steps.set(step, entry);
    }
    return entry;
  };

  for (const event of events) {
    const turn = Number(event.turn ?? 0);
    const step = Number(event.step ?? 0);
    const marker = MARKER_TITLES[String(event.kind)];

    if (event.kind === "model-request") {
      const raw = String(event.content || "");
      const payload = parseJson(raw);
      const request: TraceRequest = {
        seq: Number(event.seq),
        time: String(event.time || ""),
        endpoint: String(payload?.endpoint || pickField(raw, "endpoint") || ""),
        model: String(payload?.model || pickField(raw, "model") || ""),
        prompt: payload ? lastUserText(payload) : pickLastUserText(raw),
        reply: "",
        promptTokens: null,
        completionTokens: null,
        estimated: false,
        durationMs: null,
        tools: [],
        raw: { request: event, response: null, usage: null },
      };
      requests.set(request.seq, request);
      lastRequestByTurn.set(turn, request);
      stepOf(turn, step).requests.push(request);
      continue;
    }

    if (event.kind === "model-response") {
      const parent = Number(event.parentSeq);
      const request = Number.isFinite(parent) ? requests.get(parent) : undefined;
      if (request) {
        request.reply = replyText(parseJson(event.content), String(event.content || ""));
        request.durationMs = diffMs(request.time, event.time);
        request.raw.response = event;
      } else {
        loose.push(event);
      }
      continue;
    }

    if (event.kind === "token-usage") {
      const parent = Number(event.parentSeq);
      const request = Number.isFinite(parent) ? requests.get(parent) : undefined;
      const usage = usageOf(event);
      if (request) {
        request.promptTokens = usage.prompt;
        request.completionTokens = usage.completion;
        request.estimated = usage.estimated;
        request.raw.usage = event;
      }
      continue;
    }

    if (event.kind === "tool-call") {
      const call: TraceToolCall = {
        seq: Number(event.seq),
        name: toolNameOf(event),
        args: String(event.content || ""),
        result: "",
        error: false,
        startedAt: String(event.time || ""),
        durationMs: null,
        resultSeq: null,
      };
      toolCalls.set(call.seq, call);
      // 归属：同一轮最近的那次请求；没有请求就退到本步进里最后一个请求
      const owner = lastRequestByTurn.get(turn) || stepOf(turn, step).requests.at(-1);
      if (owner) owner.tools.push(call);
      continue;
    }

    if (event.kind === "tool-result") {
      const parent = Number(event.parentSeq);
      const call = Number.isFinite(parent) ? toolCalls.get(parent) : undefined;
      if (call) {
        call.result = String(event.content || "");
        call.error = /失败|错误|error/i.test(String(event.title || ""));
        call.durationMs = diffMs(call.startedAt, event.time);
        call.resultSeq = Number(event.seq);
      } else {
        loose.push(event);
      }
      continue;
    }

    if (marker) {
      markers.push({
        seq: Number(event.seq),
        time: String(event.time || ""),
        turn,
        kind: marker,
        title: String(event.title || event.kind),
        detail: String(event.content || ""),
      });
      continue;
    }

    if (event.kind === "activity" && (event as any).phase === "plan") continue; // 计划阶段进展不单独标记
    if (turn <= 0) loose.push(event);
  }

  // 组装轮次：按 turn 升序，步进按 step 升序
  const orderedTurns: TraceTurn[] = [...turns.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, bucket]) => {
      const steps = [...bucket.steps.values()].sort((a, b) => a.step - b.step);
      for (const step of steps) {
        const times = step.requests.map((request) => timeValue(request.time)).filter(Number.isFinite);
        step.startedAt = times.length ? new Date(Math.min(...times)).toISOString() : null;
        const durations = step.requests.map((request) => request.durationMs).filter((value): value is number => value !== null);
        step.durationMs = durations.length ? durations.reduce((sum, value) => sum + value, 0) : null;
      }
      const calls = steps.flatMap((step) => step.requests.flatMap((request) => request.tools));
      const first = steps.map((step) => step.startedAt).filter(Boolean).sort()[0] || null;
      const total = steps.map((step) => step.durationMs).filter((value): value is number => value !== null);
      return {
        turn,
        steps,
        prompt: steps.flatMap((step) => step.requests).reverse().find((request) => request.prompt)?.prompt || "",
        reply: steps.flatMap((step) => step.requests).reverse().find((request) => request.reply)?.reply || "",
        startedAt: first,
        durationMs: total.length ? total.reduce((sum, value) => sum + value, 0) : null,
        toolCount: calls.length,
        toolNames: [...new Set(calls.map((call) => call.name))],
      };
    });

  const allRequests = [...requests.values()];
  const allCalls = [...toolCalls.values()];
  const promptTokens = allRequests.reduce((sum, request) => sum + (request.promptTokens || 0), 0);
  const completionTokens = allRequests.reduce((sum, request) => sum + (request.completionTokens || 0), 0);
  const requestDurations = allRequests.map((request) => request.durationMs).filter((value): value is number => value !== null);
  const firstTime = events.map((event) => timeValue(event.time)).filter(Number.isFinite).sort()[0];
  const lastTime = events.map((event) => timeValue(event.time)).filter(Number.isFinite).sort().at(-1);

  // 用户输入兜底：trace 载荷截断时用会话消息补（按轮次顺序对应）
  const sessionUserMessages = userMessagesOf(options.messages);
  orderedTurns.forEach((turn, index) => {
    if (!turn.prompt && sessionUserMessages[index]) turn.prompt = sessionUserMessages[index];
  });

  const sortedMarkers = markers.sort((a, b) => a.seq - b.seq);
  const markersByTurn = new Map<number, TraceMarker[]>();
  const sessionMarkers: TraceMarker[] = [];
  const turnNumbers = new Set(orderedTurns.map((turn) => turn.turn));
  for (const marker of sortedMarkers) {
    // 轮内标记内嵌到该轮；会话级（turn<=0 或轮次不存在）单独收集
    if (marker.turn > 0 && turnNumbers.has(marker.turn)) {
      const list = markersByTurn.get(marker.turn) || [];
      list.push(marker);
      markersByTurn.set(marker.turn, list);
    } else {
      sessionMarkers.push(marker);
    }
  }

  return {
    turns: orderedTurns,
    markers: sortedMarkers,
    markersByTurn,
    sessionMarkers,
    loose,
    metrics: {
      spanMs: Number.isFinite(firstTime) && Number.isFinite(lastTime) ? (lastTime as number) - (firstTime as number) : 0,
      activeMs: requestDurations.reduce((sum, value) => sum + value, 0),
      turns: orderedTurns.length,
      calls: allCalls.length,
      requests: allRequests.length,
      promptTokens,
      completionTokens,
      models: [...new Set(allRequests.map((request) => request.model).filter(Boolean))],
      tools: [...new Set(allCalls.map((call) => call.name))].sort(),
    },
  };
}

/** 关键词过滤：命中标题、用户输入、回复、工具名/参数/结果 */
export function traceMatches(turn: TraceTurn, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    turn.prompt,
    turn.reply,
    ...turn.toolNames,
    ...turn.steps.flatMap((step) =>
      step.requests.flatMap((request) => [
        request.model,
        request.endpoint,
        request.reply,
        ...request.tools.flatMap((call) => [call.name, call.args, call.result]),
      ]),
    ),
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

/** 人类可读的时长 */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m${rest.toString().padStart(2, "0")}s`;
}

/** token 数紧凑显示（K/M 两档：累计输入常见到百万级，"95428k" 这种读不出来） */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
}
