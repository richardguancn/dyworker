// 上下文插件 · 主机半边
//
// 三条路由：
//   POST /api/dyworker-context/detail   { sessionId } → 单个会话的上下文全景
//   POST /api/dyworker-context/browser  { sessionId } → 上下文元素（含正文）
//   POST /api/dyworker-context/balance  { days }      → 跨会话用量（仪表盘用）
//
// 数据来自三处，各管一段，谁也不假装能包办：
//   1. sessionProjections 的 contextTimeline：当前上下文构成、每请求占用、元素清单；
//   2. 会话落盘的 trace 事件流：逐请求真实用量（含缓存/推理 token）、工具定义估算体积、
//      首 token 时刻、上下文事件（压缩/剪枝/计划/文件变更）、工具调用与文件活动、子 Agent 分支；
//   3. 会话记录本身：标题、工作区、模型、上下文窗口、累计用量。
//
// 估算与真实的边界写在字段名与界面上：真实用量走 prompt/completion/cacheRead，
// 分类构成用「固定密度启发式」把真实 prompt 按各类体积比例分摊（≈），界面上如实标注。

import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

export const name = "dyworker-context";
export const inject = ["connection", "sessions", "sessionProjections", "storage"];

const DETAIL_ROUTE = "/api/dyworker-context/detail";
const BROWSER_ROUTE = "/api/dyworker-context/browser";
const BALANCE_ROUTE = "/api/dyworker-context/balance";
/** 逐请求明细要读 trace：文件太大时只读尾部，避免把主进程卡住 */
const TRACE_TAIL_BYTES = 24 * 1024 * 1024;
/** 仪表盘里给多少个会话算构成环（投影要把消息折一遍，太多会拖慢主进程） */
const COMPOSITION_LIMIT = 16;
/** 浏览器单个元素返回的正文上限 */
const ELEMENT_TEXT_LIMIT = 4000;
/** 浏览器最多返回多少个元素 */
const ELEMENT_LIMIT = 400;

const CATEGORY_KEYS = ["system", "tools", "user", "inject", "skill", "assistant", "tool"];
/** 价目文件名（放在插件数据目录里）；没有它就如实显示"未配置价目" */
const PRICE_FILE = "context-prices.json";
/** Agent 网络要扫全文：超过这个大小就跳过（避免一次读取把主进程拖住） */
const AGENT_SCAN_MAX_BYTES = 400 * 1024 * 1024;
/** 全文扫描结果按 (size, mtime) 缓存，3 秒轮询不会反复读同一个大文件 */
const agentCache = new Map();

function safeSessionId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 200) return "";
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return "";
  return id;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function parseJson(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function diffMs(from, to) {
  const a = Date.parse(String(from || ""));
  const b = Date.parse(String(to || ""));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

/** 粗略 token 估算：CJK 约 1 字 1 token，ASCII 约 4 字符 1 token（界面上的 ≈ 就是这个口径） */
function estimateTokens(value) {
  const text = String(value ?? "");
  let cjk = 0;
  for (const char of text) {
    if (/[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(char)) cjk += 1;
  }
  return Math.round(cjk + (text.length - cjk) / 4);
}

/** 单条消息的估算（含 4 token 结构开销，与 agent 内的估算口径一致） */
function estimateMessageTokens(message) {
  if (!message) return 0;
  const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
  const calls = message.tool_calls ? JSON.stringify(message.tool_calls) : "";
  return estimateTokens(content) + estimateTokens(calls) + 4;
}

/** 会话消息 → 上下文类别（与宿主投影 foldContextTimeline 的口径一致） */
function categoryOf(message) {
  const role = String(message?.role || "");
  if (role === "system") return "system";
  if (role === "assistant") return "assistant";
  if (role === "tool") return "tool";
  const sourceKind = String(message?.source?.kind || "");
  if (sourceKind === "skill-invocation" || sourceKind === "skill-catalog") return "skill";
  if (sourceKind === "injection" || sourceKind === "inject") return "inject";
  return "user";
}

/** 消息正文抽成纯文本（数组内容取 text 片段） */
function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  }
  return "";
}

/** 读会话的 trace 事件（尾部一段），解析失败的行直接跳过（半截行） */
async function readTrace(ctx, sessionId) {
  const base = String(ctx.storage?.hostDir || "");
  if (!base) return [];
  const file = path.join(base, "traces", `${sessionId}.jsonl`);
  let handle;
  try {
    handle = await fs.open(file, "r");
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - TRACE_TAIL_BYTES);
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const text = buffer.toString("utf8");
    // 从尾部截断时第一行可能是半截：丢掉它
    const lines = text.split("\n");
    if (start > 0) lines.shift();
    const records = [];
    for (const line of lines) {
      if (!line) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // 正在追加写：跳过
      }
    }
    return records;
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** trace 文件信息（不存在返回 null） */
async function traceStat(ctx, sessionId) {
  const base = String(ctx.storage?.hostDir || "");
  if (!base) return null;
  const file = path.join(base, "traces", `${sessionId}.jsonl`);
  try {
    const stat = await fs.stat(file);
    return { file, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * Agent 网络要的是**整份** trace 里的分支（子 Agent 的 run 可能在文件很前面，
 * 尾部窗口读不到——实测 110MB 的会话里 depth>0 的事件全在前 40000 行）。
 * 所以这里全文流式扫一遍，只累加每个 run 的账，不保留事件；结果按 (size, mtime) 缓存。
 */
async function scanAgents(fileInfo, session) {
  const cached = agentCache.get(fileInfo.file);
  const key = `${fileInfo.size}:${Math.round(fileInfo.mtimeMs)}`;
  if (cached?.key === key) return cached.agents;
  if (fileInfo.size > AGENT_SCAN_MAX_BYTES) return null;

  // 子 Agent 的判定用 branch.parentId，而不是 runId/depth：
  // 实测转发进同一个 runId 的事件里，主 Agent depth 0、子 Agent depth 2 且带 branch
  // （branch.parentId = 派发它的那次 dispatch_agent 活动 id）。按 runId 分组会把子 Agent 吃掉。
  const runs = new Map();
  const mainRunIds = new Set();
  const stream = createReadStream(fileInfo.file, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const runId = String(event?.runId || "");
      if (!runId) continue;
      const branchId = String(event?.branch?.parentId || "");
      mainRunIds.add(runId);
      const key = branchId ? `branch:${branchId}` : `run:${runId}`;
      const depth = branchId ? Number(event?.branch?.depth) || 1 : 0;
      const existing = runs.get(key);
      const run = existing || { id: key, depth, prompt: 0, completion: 0, requests: 0, firstAt: "", lastAt: "", title: "" };
      if (!run.firstAt) run.firstAt = String(event.time || "");
      run.lastAt = String(event.time || run.lastAt);
      if (event.branch?.title && !run.title) run.title = String(event.branch.title).split("\n")[0];
      if (event.kind === "model-request") run.requests += 1;
      if (event.kind === "token-usage") {
        run.prompt += Number(event.usage?.prompt) || 0;
        run.completion += Number(event.usage?.completion) || 0;
      }
      runs.set(key, run);
    }
  } finally {
    reader.close();
    stream.close();
  }

  const list = [...runs.values()];
  const mainRuns = list.filter((run) => run.id.startsWith("run:"));
  const childRuns = list.filter((run) => run.id.startsWith("branch:"));
  const mainNode = mainRuns.length
    ? {
        prompt: mainRuns.reduce((total, run) => total + run.prompt, 0),
        completion: mainRuns.reduce((total, run) => total + run.completion, 0),
        requests: mainRuns.reduce((total, run) => total + run.requests, 0),
        firstAt: mainRuns[0].firstAt,
        lastAt: mainRuns[mainRuns.length - 1].lastAt,
      }
    : { prompt: 0, completion: 0, requests: 0, firstAt: "", lastAt: "" };
  const agents = [{
    id: "main",
    title: String(session?.title || "本会话"),
    depth: 0,
    parentId: null,
    prompt: mainNode.prompt,
    completion: mainNode.completion,
    requests: mainNode.requests,
    firstAt: mainNode.firstAt,
    lastAt: mainNode.lastAt,
    runs: mainRuns.length,
  }];
  for (const child of childRuns) {
    agents.push({
      // 事件/请求里的 branchId 是原始 parentId：节点 id 去掉 "branch:" 前缀才匹配得上
      id: child.id.startsWith("branch:") ? child.id.slice("branch:".length) : child.id,
      title: child.title ? String(child.title).slice(0, 40) : `子 Agent ${String(child.id).slice(0, 8)}`,
      depth: child.depth,
      parentId: "main",
      prompt: child.prompt,
      completion: child.completion,
      requests: child.requests,
      firstAt: child.firstAt,
      lastAt: child.lastAt,
      runs: 1,
    });
  }
  agentCache.set(fileInfo.file, { key, agents });
  return agents;
}

/**
 * 价目：读插件数据目录里的 context-prices.json（不存在就返回 null，界面显示未配置）。
 * 走 storage.resolve() 拿路径（它保证不会越出插件数据根），再直接读文件——
 * 不依赖 storage 服务是否暴露 readJson（实测插件拿到的门面上没有这个方法）。
 */
async function readPrices(ctx) {
  let file = "";
  try {
    file = String(ctx.storage?.resolve?.(PRICE_FILE) || "");
  } catch {
    return null;
  }
  if (!file) return null;
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.models && typeof parsed.models === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** 费用：真实用量 × 配置价目（没配到的模型单独计数，不猜单价） */
function computeCost(prices, requests) {
  if (!prices?.models) return null;
  const per = 1_000_000;
  let total = 0;
  let pricedRequests = 0;
  let unpricedRequests = 0;
  const models = new Set();
  for (const request of requests) {
    const price = prices.models[String(request.model || "")];
    if (!price) {
      unpricedRequests += 1;
      continue;
    }
    const prompt = Number(request.prompt) || 0;
    const completion = Number(request.completion) || 0;
    const cacheRead = Number(request.cacheRead) || 0;
    const inputPrice = Number(price.input) || 0;
    const outputPrice = Number(price.output) || 0;
    const cachePrice = Number.isFinite(Number(price.cacheRead)) ? Number(price.cacheRead) : inputPrice;
    total += (Math.max(0, prompt - cacheRead) * inputPrice + cacheRead * cachePrice + completion * outputPrice) / per;
    pricedRequests += 1;
    models.add(String(request.model || ""));
  }
  if (!pricedRequests) return null;
  return {
    total,
    currency: String(prices.currency || "USD"),
    pricedRequests,
    unpricedRequests,
    models: [...models],
    source: String(prices.source || PRICE_FILE),
  };
}

// ── 工具分类（文件活动 / 工具统计共用）──────────────────────────────
const READ_TOOLS = /^(read_|list_|glob$|grep$|open_|view_)/;
const WRITE_TOOLS = /^(write_|edit_|append_|create_|delete_|move_|copy_)/;
const SEARCH_TOOLS = /search/;
const IMAGE_TOOLS = /image/;

function fileOpKind(name) {
  const tool = String(name || "");
  if (IMAGE_TOOLS.test(tool)) return "images";
  if (WRITE_TOOLS.test(tool)) return "writes";
  if (READ_TOOLS.test(tool)) return "reads";
  if (SEARCH_TOOLS.test(tool)) return "searches";
  return "";
}

function countLines(value) {
  const text = String(value ?? "");
  if (!text) return 0;
  return text.split("\n").length;
}

/** 从工具参数里取路径与行数增减（拿不到就不计，不猜） */
function fileOpDetail(name, argsText) {
  const args = parseJson(argsText) || {};
  const target = String(args.path || args.file || args.file_path || args.target || args.pattern || "");
  const detail = { path: target, added: 0, removed: 0 };
  const tool = String(name || "");
  if (tool.startsWith("write_file") || tool.startsWith("append_file") || tool.startsWith("create_")) {
    detail.added = countLines(args.content ?? args.text ?? "");
  } else if (tool.startsWith("edit_")) {
    detail.removed = countLines(args.old_string ?? args.oldText ?? args.search ?? "");
    detail.added = countLines(args.new_string ?? args.newText ?? args.replace ?? "");
  }
  return detail;
}

/**
 * 把 trace 事件折成上下文插件要的几段。
 * 真实值：逐请求用量（含缓存/推理）、首 token、工具耗时、文件活动、子 Agent 分支。
 * 估算值：工具定义体积、分类构成（按体积比例分摊真实 prompt）。
 */
function foldTrace(records, session) {
  const sessionMessages = Array.isArray(session?.messages) ? session.messages : [];
  const requests = new Map(); // runId#seq → request
  const firstTokens = new Map(); // runId#seq → time
  const tools = new Map(); // runId#seq → call
  const events = [];
  const fileOps = new Map();
  const runStats = new Map();
  const times = [];
  let lastRequestPayload = null;
  let previousModel = "";

  const keyOf = (event) => `${String(event?.runId || "")}#${Number(event?.seq)}`;
  const parentKey = (event) => `${String(event?.runId || "")}#${Number(event?.parentSeq)}`;
  const runOf = (event) => String(event?.runId || "");

  for (const event of records) {
    const time = String(event?.time || "");
    const at = Date.parse(time);
    if (Number.isFinite(at)) times.push(at);
    const turn = Number(event?.turn) || 0;
    const step = Number(event?.step) || 0;
    const runId = runOf(event);
    const depth = Number(event?.depth) || 0;
    const kind = String(event?.kind || "");

    // 每个 run 的账（Agent 网络用）
    const run = runStats.get(runId) || {
      id: runId || "main",
      depth,
      prompt: 0,
      completion: 0,
      requests: 0,
      firstAt: time,
      lastAt: time,
      title: "",
    };
    run.depth = Math.min(run.depth, depth);
    run.lastAt = time || run.lastAt;
    if (event?.branch?.title && !run.title) run.title = String(event.branch.title);
    runStats.set(runId, run);

    if (kind === "model-request") {
      const raw = String(event.content || "");
      const payload = parseJson(raw) || {};
      if (payload.messages) lastRequestPayload = payload;
      // 载荷写日志时被截断（12000 字符），整段 JSON.parse 必然失败——model 在**最前面**，
      // 用正则兜底取，否则逐请求的模型名全空（费用算不出、切换事件也检测不到）
      const model = String(payload.model || /"model"\s*:\s*"([^"]*)"/.exec(raw)?.[1] || "");
      if (model && previousModel && model !== previousModel) {
        events.push({ kind: "switch", at: time, turn, step, producer: "设置：模型", detail: `${previousModel} → ${model}`, delta: null, branchId: String(event?.branch?.parentId || "") });
      }
      if (model) previousModel = model;
      requests.set(keyOf(event), {
        seq: Number(event.seq),
        turn,
        step,
        runId,
        branchId: String(event?.branch?.parentId || ""),
        time,
        model,
        prompt: null,
        completion: null,
        cacheRead: null,
        cacheWrite: null,
        reasoning: null,
        durationMs: null,
        firstTokenMs: null,
        generationMs: null,
        context: event.context || null,
      });
      run.requests += 1;
      continue;
    }
    if (kind === "model-first-token") {
      const parent = Number(event.parentSeq);
      const parentId = Number.isFinite(parent) ? `${runId}#${parent}` : "";
      if (parentId && !firstTokens.has(parentId)) firstTokens.set(parentId, time);
      continue;
    }
    if (kind === "model-response") {
      const request = requests.get(parentKey(event));
      if (request) request.durationMs = diffMs(request.time, time);
      continue;
    }
    if (kind === "token-usage") {
      const request = requests.get(parentKey(event));
      const usage = event.usage || parseJson(event.content) || {};
      const prompt = Number(usage.prompt ?? usage.prompt_tokens ?? usage.input);
      const completion = Number(usage.completion ?? usage.completion_tokens ?? usage.output);
      const cacheRead = Number(usage.cacheRead);
      const cacheWrite = Number(usage.cacheWrite);
      const reasoning = Number(usage.reasoning);
      run.prompt += Number.isFinite(prompt) ? prompt : 0;
      run.completion += Number.isFinite(completion) ? completion : 0;
      if (request) {
        if (Number.isFinite(prompt)) request.prompt = prompt;
        if (Number.isFinite(completion)) request.completion = completion;
        if (Number.isFinite(cacheRead)) request.cacheRead = cacheRead;
        if (Number.isFinite(cacheWrite)) request.cacheWrite = cacheWrite;
        if (Number.isFinite(reasoning)) request.reasoning = reasoning;
      }
      continue;
    }
    if (kind === "tool-call") {
      const matched = /工具\s+(\S+?)(?:\s|$)/.exec(String(event.title || ""));
      const name = matched?.[1] || String(event.activityKind || "tool");
      const call = { seq: Number(event.seq), turn, step, time, name, args: String(event.content || ""), durationMs: null, error: false };
      tools.set(keyOf(event), call);
      // 文件活动：按工具名归类，路径与行数从参数里取
      const opKind = fileOpKind(name);
      if (opKind) {
        const detail = fileOpDetail(name, call.args);
        const pathKey = detail.path || `（无路径 · ${name}）`;
        const entry = fileOps.get(pathKey) || { path: pathKey, reads: 0, writes: 0, searches: 0, images: 0, added: 0, removed: 0, ops: 0, lastAt: time, tools: {} };
        entry[opKind] += 1;
        entry.ops += 1;
        entry.added += detail.added;
        entry.removed += detail.removed;
        entry.lastAt = time || entry.lastAt;
        entry.tools[name] = (entry.tools[name] || 0) + 1;
        fileOps.set(pathKey, entry);
      }
      continue;
    }
    if (kind === "tool-result") {
      const call = tools.get(parentKey(event));
      if (call) {
        call.durationMs = diffMs(call.time, time);
        call.error = /失败|错误|error/i.test(String(event.title || ""));
      }
      continue;
    }
    if (kind === "context-compacted") {
      events.push({ kind: "compaction", at: time, turn, step, producer: "agent：自动压缩", detail: String(event.content || "").slice(0, 400), delta: null, branchId: String(event?.branch?.parentId || "") });
      continue;
    }
    if (kind === "context-pruned") {
      const payload = parseJson(event.content) || {};
      events.push({
        kind: "prune",
        at: time,
        turn,
        step,
        producer: payload.reason === "overflow" ? "agent：microcompact（服务端超限）" : "agent：microcompact",
        detail: String(event.title || "上下文剪枝"),
        delta: Number(payload.reclaimed) ? -Math.abs(Number(payload.reclaimed)) : null,
        branchId: String(event?.branch?.parentId || ""),
      });
      continue;
    }
    if (kind === "plan-update") {
      events.push({ kind: "plan", at: time, turn, step, producer: "agent：计划", detail: String(event.content || "").slice(0, 400), delta: null, branchId: String(event?.branch?.parentId || "") });
      continue;
    }
    if (kind === "file-change") {
      const changes = parseJson(event.content);
      const list = Array.isArray(changes) ? changes : [];
      const paths = list.map((change) => String(change?.path || change?.file || "")).filter(Boolean);
      // 文件变更事件也是文件活动的真实来源（不只有 read_file/write_file 这类工具调用）
      for (const change of list) {
        const filePath = String(change?.path || change?.file || "");
        if (!filePath) continue;
        const entry = fileOps.get(filePath) || { path: filePath, reads: 0, writes: 0, searches: 0, images: 0, added: 0, removed: 0, ops: 0, lastAt: time, tools: {} };
        entry.writes += 1;
        entry.ops += 1;
        entry.added += Number(change?.added) || 0;
        entry.removed += Number(change?.removed) || 0;
        entry.lastAt = time || entry.lastAt;
        entry.tools["file-change"] = (entry.tools["file-change"] || 0) + 1;
        fileOps.set(filePath, entry);
      }
      events.push({ kind: "file", at: time, turn, step, producer: "工具：文件变更", detail: paths.slice(0, 8).join("\n"), delta: null, branchId: String(event?.branch?.parentId || "") });
      continue;
    }
  }

  // 逐请求派生：首 token 延迟 / 生成时长
  for (const request of requests.values()) {
    const tokenAt = firstTokens.get(`${request.runId}#${request.seq}`);
    if (!tokenAt) continue;
    request.firstTokenMs = diffMs(request.time, tokenAt);
    const responseAt = request.durationMs !== null ? Date.parse(request.time) + request.durationMs : NaN;
    request.generationMs = Number.isFinite(responseAt) ? Math.max(0, responseAt - Date.parse(tokenAt)) : null;
  }

  const requestList = [...requests.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const toolList = [...tools.values()];

  // 累计分类：把每次请求的真实 prompt 按各类体积比例分摊（估算）
  const split = { system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0 };
  const offsets = sessionMessages.some((message) => String(message?.role || "") === "system") ? 0 : 1;
  let promptTotal = 0;
  let completionTotal = 0;
  let cacheReadTotal = 0;
  let cacheWriteTotal = 0;
  let reasoningTotal = 0;
  let waitMs = 0;
  let generateMs = 0;
  /** 有生成时长的那几次请求的输出 token：吞吐量只按它们算（否则被"没有首 token 的请求"稀释成假高值） */
  let generationOutputTokens = 0;
  let thinkingMs = 0;
  let outputMs = 0;
  let modelMs = 0;
  for (const request of requestList) {
    const realPrompt = Number(request.prompt) || 0;
    promptTotal += realPrompt;
    completionTotal += Number(request.completion) || 0;
    cacheReadTotal += Number(request.cacheRead) || 0;
    cacheWriteTotal += Number(request.cacheWrite) || 0;
    reasoningTotal += Number(request.reasoning) || 0;
    modelMs += Number(request.durationMs) || 0;
    waitMs += Number(request.firstTokenMs) || 0;
    const generation = Number(request.generationMs) || 0;
    generateMs += generation;
    // 生成时长按推理 token 占比拆「思考 / 输出」：既没有推理 token 也没有首 token 时不拆（如实留 0）
    const reasoning = Number(request.reasoning) || 0;
    const completionForSplit = Number(request.completion) || 0;
    if (generation > 0) generationOutputTokens += Number(request.completion) || 0;
    if (generation > 0 && reasoning > 0 && completionForSplit > 0) {
      const share = Math.min(1, reasoning / completionForSplit);
      thinkingMs += generation * share;
      outputMs += generation * (1 - share);
    } else {
      outputMs += generation;
    }

    const count = Number(request.context?.messages);
    const upto = Number.isFinite(count) && count > 0
      ? sessionMessages.slice(0, Math.max(0, count - offsets))
      : sessionMessages;
    const raw = {
      system: Number(request.context?.systemTokens) || 0,
      tools: Number(request.context?.toolsTokens) || 0,
      user: 0,
      inject: 0,
      skill: 0,
      assistant: 0,
      tool: 0,
    };
    if (!raw.system) {
      for (const message of upto) if (categoryOf(message) === "system") raw.system += estimateMessageTokens(message);
    }
    for (const message of upto) {
      const category = categoryOf(message);
      if (category === "system") continue;
      raw[category] += estimateMessageTokens(message);
    }
    const rawTotal = CATEGORY_KEYS.reduce((sum, key) => sum + (raw[key] || 0), 0) || 1;
    const factor = (realPrompt || rawTotal) / rawTotal;
    const requestSplit = {};
    for (const key of CATEGORY_KEYS) {
      const value = Math.round((raw[key] || 0) * factor);
      requestSplit[key] = value;
      split[key] += value;
    }
    // 每个请求自己的一份构成（趋势 DNA 用）；total 是该请求的真实输入 + 输出
    request.split = requestSplit;
    request.splitTotal = CATEGORY_KEYS.reduce((sum, key) => sum + requestSplit[key], 0) + (Number(request.completion) || 0);
  }

  // 上下文事件的 token 变化：压缩/剪枝前后各取一次真实 prompt 差值
  const ordered = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const event of ordered) {
    if (event.kind !== "compaction" && event.kind !== "prune") continue;
    if (event.delta !== null && event.delta !== undefined) continue;
    const at = Date.parse(event.at);
    const before = [...requestList].reverse().find((request) => Number(request.prompt) && Date.parse(request.time) <= at);
    const after = requestList.find((request) => Number(request.prompt) && Date.parse(request.time) > at);
    if (before && after) event.delta = Number(after.prompt) - Number(before.prompt);
  }

  // 真实存在的注入：长期目标与工作资料快照（代码里每轮都会注入）
  if (session?.goal) {
    const first = requestList[0];
    ordered.push({
      kind: "inject",
      at: first?.time || String(session.createdAt || ""),
      turn: first?.turn || 0,
      step: first?.step || 0,
      producer: "会话：长期目标",
    detail: `上下文注入 · goal：${String(session.goal).slice(0, 120)}`,
      delta: null,
    });
  }
  // 会话记录里的系统消息（如果有）也是真实注入
  for (const [index, message] of sessionMessages.filter((item) => String(item?.role || "") === "system").slice(0, 20).entries()) {
    const first = requestList[0];
    ordered.push({
      kind: "inject",
      at: first?.time || String(session?.createdAt || ""),
      turn: first?.turn || 0,
      step: first?.step || 0,
      producer: "会话：系统消息",
      detail: `系统消息注入 #${index}：${String(messageText(message)).slice(0, 100)}`,
      delta: estimateMessageTokens(message),
    });
  }
  if (session?.workingContext) {
    const last = requestList[requestList.length - 1];
    ordered.push({
      kind: "inject",
      at: last?.time || String(session.updatedAt || ""),
      turn: last?.turn || 0,
      step: last?.step || 0,
      producer: "会话：工作资料快照",
      detail: `状态快照 · 工作资料：${String(session.workingContext).slice(0, 120)}`,
      delta: null,
    });
  }

  const spanMs = times.length ? Math.max(...times) - Math.min(...times) : 0;
  const toolMs = toolList.reduce((sum, item) => sum + (item.durationMs || 0), 0);

  // Agent 网络：本会话的 run 分组（子 Agent 是 depth>0 的 run）
  const runs = [...runStats.values()].filter((run) => run.id);
  const mainRuns = runs.filter((run) => run.depth === 0);
  const childRuns = runs.filter((run) => run.depth > 0);
  const sumRuns = (list, key) => list.reduce((sum, run) => sum + (run[key] || 0), 0);
  const agents = [{
    id: "main",
    title: String(session?.title || "本会话"),
    depth: 0,
    parentId: null,
    prompt: sumRuns(mainRuns, "prompt"),
    completion: sumRuns(mainRuns, "completion"),
    requests: sumRuns(mainRuns, "requests"),
    firstAt: mainRuns[0]?.firstAt || "",
    lastAt: mainRuns[mainRuns.length - 1]?.lastAt || "",
  }];
  for (const child of childRuns) {
    agents.push({
      // 事件/请求里的 branchId 是原始 parentId：节点 id 去掉 "branch:" 前缀才匹配得上
      id: child.id.startsWith("branch:") ? child.id.slice("branch:".length) : child.id,
      title: child.title ? String(child.title).slice(0, 40) : `子 Agent ${String(child.id).slice(0, 8)}`,
      depth: child.depth,
      parentId: "main",
      prompt: child.prompt,
      completion: child.completion,
      requests: child.requests,
      firstAt: child.firstAt,
      lastAt: child.lastAt,
    });
  }

  return {
    requests: requestList,
    prompt: foldPrompt(lastRequestPayload),
    tools: {
      total: toolList.length,
      failed: toolList.filter((item) => item.error).length,
      byName: countBy(toolList.map((item) => item.name)),
    },
    events: ordered.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
    fileOps: [...fileOps.values()].sort((a, b) => b.ops - a.ops),
    agents,
    /** 事件/请求里的分支 id 形如 branch:<parentId>，与 agents[].id 一致（主 Agent 为 main） */
    timing: {
      spanMs,
      modelMs,
      waitMs,
      generateMs,
      /** 生成时长里按推理 token 占比拆出来的思考/输出（≈ 估算） */
      thinkingMs,
      outputMs,
      toolMs,
      overheadMs: Math.max(0, spanMs - modelMs - toolMs),
      throughput: generateMs > 0 ? (generationOutputTokens / generateMs) * 1000 : null,
    },
    counts: {
      requestCount: requestList.length,
      toolCalls: toolList.length,
      toolFailed: toolList.filter((item) => item.error).length,
      promptTokens: promptTotal,
      completionTokens: completionTotal,
      cacheRead: cacheReadTotal,
      cacheWrite: cacheWriteTotal,
      reasoning: reasoningTotal,
      cacheHitRate: promptTotal > 0 && cacheReadTotal > 0 ? cacheReadTotal / promptTotal : null,
    },
    tokenSplit: { ...split, output: completionTotal, total: CATEGORY_KEYS.reduce((sum, key) => sum + split[key], 0) + completionTotal },
  };
}

function countBy(values) {
  const out = {};
  for (const value of values) out[value] = (out[value] || 0) + 1;
  return out;
}

/**
 * 载荷被截断时的兜底折算：整段 JSON.parse 必然失败（12000 字符砍断），
 * 但 `"role": "xxx"` 标记都在，按标记切段仍能算出各角色的体量。
 */
function foldPromptFromText(raw) {
  const text = String(raw || "");
  const hits = [...text.matchAll(/"role"\s*:\s*"([a-z]+)"/g)];
  if (!hits.length) return null;
  const sums = { system: 0, tools: 0, user: 0, assistant: 0, tool: 0, inject: 0, skill: 0 };
  hits.forEach((hit, index) => {
    const start = (hit.index || 0) + hit[0].length;
    const end = index + 1 < hits.length ? hits[index + 1].index : text.length;
    const tokens = estimateTokens(text.slice(start, end));
    const role = hit[1];
    if (role === "system") sums.system += tokens;
    else if (role === "tool") sums.tool += tokens;
    else if (role === "assistant") sums.assistant += tokens;
    else sums.user += tokens;
  });
  const total = Object.values(sums).reduce((sum, value) => sum + value, 0);
  return { sums, total, messages: hits.length, estimated: true, toolsRecorded: false };
}

function foldPrompt(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  if (!messages.length) return foldPromptFromText(payload?.__raw);
  const sums = { system: 0, tools: 0, user: 0, assistant: 0, tool: 0, inject: 0, skill: 0 };
  for (const message of messages) {
    const role = String(message?.role || "");
    const content = typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "");
    const tokens = estimateTokens(content) + estimateTokens(message?.tool_calls ? JSON.stringify(message.tool_calls) : "");
    if (role === "system") sums.system += tokens;
    else if (role === "tool") sums.tool += tokens;
    else if (role === "assistant") sums.assistant += tokens;
    else sums.user += tokens;
  }
  const total = Object.values(sums).reduce((sum, value) => sum + value, 0);
  return { sums, total, messages: messages.length, estimated: true, toolsRecorded: false };
}

/** 会话消息 → 浏览器元素（含正文） */
function browserPayload(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const elements = [];
  messages.forEach((message, index) => {
    if (elements.length >= ELEMENT_LIMIT) return;
    const category = categoryOf(message);
    const text = messageText(message);
    const reasoning = typeof message?.reasoning === "string" ? message.reasoning : "";
    const tool = category === "tool"
      ? String(message?.toolName || message?.name || message?.tool_calls?.[0]?.function?.name || "")
      : "";
    elements.push({
      index,
      role: String(message?.role || ""),
      category,
      tool,
      tokens: estimateMessageTokens(message),
      chars: text.length,
      text: text.length > ELEMENT_TEXT_LIMIT ? `${text.slice(0, ELEMENT_TEXT_LIMIT)}…` : text,
      ...(reasoning ? { reasoning: reasoning.length > ELEMENT_TEXT_LIMIT ? `${reasoning.slice(0, ELEMENT_TEXT_LIMIT)}…` : reasoning } : {}),
      truncated: text.length > ELEMENT_TEXT_LIMIT,
    });
  });
  return elements;
}

/** 单会话全景 */
async function detail(ctx, request) {
  let payload = {};
  try {
    payload = await request.json();
  } catch {
    // 空 body：当作缺参数处理
  }
  const sessionId = safeSessionId(payload?.sessionId);
  if (!sessionId) return jsonResponse({ ok: false, error: "sessionId 缺失或非法" }, 400);
  const session = ctx.sessions.get(sessionId);
  if (!session) return jsonResponse({ ok: false, error: "会话不存在" }, 404);

  const timeline = ctx.sessionProjections?.viewOf(session, "contextTimeline") || null;
  const trace = foldTrace(await readTrace(ctx, sessionId), session);
  // Agent 网络用全文扫描（尾部窗口读不到很早的子 Agent run），结果按 mtime 缓存
  const fileInfo = await traceStat(ctx, sessionId);
  if (fileInfo) {
    try {
      const agents = await scanAgents(fileInfo, session);
      if (agents) trace.agents = agents;
    } catch (error) {
      // 扫描失败会退化成"窗口内那份"（只有主 Agent）——把原因带出去，别无声降级
      trace.agentScanError = String(error?.message || error);
    }
  }
  const prices = await readPrices(ctx);
  let pricePath = "";
  let priceError = "";
  try {
    pricePath = String(ctx.storage?.resolve?.(PRICE_FILE) || "");
  } catch (error) {
    priceError = String(error?.message || error);
  }
  const computed = computeCost(prices, trace.requests);
  const cost = computed
    ? { ...computed, path: pricePath }
    : {
        total: null,
        currency: String(prices?.currency || ""),
        pricedRequests: 0,
        unpricedRequests: trace.requests.length,
        source: PRICE_FILE,
        path: pricePath,
        error: priceError,
      };
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const userMessages = messages.filter((message) => String(message?.role || "") === "user").length;

  return jsonResponse({
    ok: true,
    value: {
      plugin: pluginInfo || (pluginInfo = await readPluginInfo()) || null,
      session: {
        id: sessionId,
        title: String(session.title || ""),
        workspacePath: String(session.workspacePath || ""),
        model: String(session.contextModel || ""),
        endpoint: String(session.contextEndpoint || ""),
        createdAt: String(session.createdAt || ""),
        updatedAt: String(session.updatedAt || ""),
        contextTokens: Number(session.contextTokens) || 0,
        contextTokensExact: Boolean(session.contextTokensExact),
        messages: messages.length,
        userMessages,
        goal: String(session.goal || ""),
        hasWorkingContext: Boolean(session.workingContext),
        tokenStats: session.tokenStats || { prompt: 0, completion: 0, requests: 0 },
      },
      timeline,
      trace,
      cost,
    },
  });
}

/** 上下文浏览器：一个会话的全部元素（含正文） */
async function browser(ctx, request) {
  let payload = {};
  try {
    payload = await request.json();
  } catch {
    // 缺参数按 400 处理
  }
  const sessionId = safeSessionId(payload?.sessionId);
  if (!sessionId) return jsonResponse({ ok: false, error: "sessionId 缺失或非法" }, 400);
  const session = ctx.sessions.get(sessionId);
  if (!session) return jsonResponse({ ok: false, error: "会话不存在" }, 404);
  const elements = browserPayload(session);
  return jsonResponse({
    ok: true,
    value: {
      session: { id: sessionId, title: String(session.title || ""), contextTokens: Number(session.contextTokens) || 0 },
      elements,
      counts: {
        total: elements.length,
        byCategory: elements.reduce((acc, element) => {
          acc[element.category] = (acc[element.category] || 0) + 1;
          return acc;
        }, {}),
      },
    },
  });
}

/** 跨会话用量汇总（仪表盘）：按会话最后活跃日归集到每一天 */
async function balance(ctx, request) {
  let payload = {};
  try {
    payload = await request.json();
  } catch {
    // 默认 7 天
  }
  const days = Math.max(1, Math.min(90, Number(payload?.days) || 7));
  // 注意：宿主 sessions.loadAll() 返回的是 **Promise**（archive 装载是异步的），
  // 直接当数组用会永远是空的——仪表盘全 0 就是这个坑（实测踩过）。
  let sessions = [];
  try {
    sessions = typeof ctx.sessions.loadAll === "function" ? await ctx.sessions.loadAll() : [];
  } catch {
    sessions = [];
  }
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const dayMap = new Map();
  const cards = [];
  const byId = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session || session.archived) continue;
    byId.set(String(session.id || ""), session);
    const stats = session.tokenStats || { prompt: 0, completion: 0, requests: 0 };
    const updatedAt = String(session.updatedAt || "");
    const updatedMs = Date.parse(updatedAt);
    const messages = Array.isArray(session.messages) ? session.messages : [];
    cards.push({
      id: String(session.id || ""),
      title: String(session.title || ""),
      workspacePath: String(session.workspacePath || ""),
      updatedAt,
      createdAt: String(session.createdAt || ""),
      prompt: Number(stats.prompt) || 0,
      completion: Number(stats.completion) || 0,
      requests: Number(stats.requests) || 0,
      contextTokens: Number(session.contextTokens) || 0,
      contextModel: String(session.contextModel || ""),
      messages: messages.length,
      turns: messages.filter((message) => String(message?.role || "") === "user").length,
      pinned: Boolean(session.pinned),
    });
    if (Number.isFinite(updatedMs) && updatedMs >= since) {
      const day = updatedAt.slice(0, 10);
      const entry = dayMap.get(day) || { date: day, prompt: 0, completion: 0, requests: 0, sessions: new Set() };
      entry.prompt += Number(stats.prompt) || 0;
      entry.completion += Number(stats.completion) || 0;
      entry.requests += Number(stats.requests) || 0;
      entry.sessions.add(String(session.id || ""));
      dayMap.set(day, entry);
    }
  }

  // 连续 days 天（含今天），没有用量的日子补 0——图上要看到空档
  const series = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(Date.now() - index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const entry = dayMap.get(date);
    series.push({
      date,
      prompt: entry ? entry.prompt : 0,
      completion: entry ? entry.completion : 0,
      requests: entry ? entry.requests : 0,
      sessions: entry ? entry.sessions.size : 0,
    });
  }

  const totals = cards.reduce((sum, card) => ({
    prompt: sum.prompt + card.prompt,
    completion: sum.completion + card.completion,
    requests: sum.requests + card.requests,
  }), { prompt: 0, completion: 0, requests: 0 });

  const groups = new Map();
  for (const card of cards) {
    const key = card.workspacePath || "";
    const group = groups.get(key) || { path: key, name: key ? key.split("/").filter(Boolean).pop() : "（无工作区）", cards: [], prompt: 0, completion: 0 };
    group.cards.push(card);
    group.prompt += card.prompt;
    group.completion += card.completion;
    groups.set(key, group);
  }

  cards.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  // 用量最大的若干个会话补一个构成环（上下文窗口去哪儿了）
  const ringTargets = [...cards].sort((a, b) => (b.prompt + b.completion) - (a.prompt + a.completion)).slice(0, COMPOSITION_LIMIT);
  for (const card of ringTargets) {
    const session = byId.get(card.id);
    if (!session) continue;
    try {
      const view = ctx.sessionProjections?.viewOf(session, "contextTimeline");
      if (view?.current) card.composition = view.current;
    } catch {
      // 单个会话折不出来不影响整张仪表盘
    }
  }

  return jsonResponse({
    ok: true,
    value: {
      range: { days, since: new Date(since).toISOString() },
      totals: { ...totals, sessions: cards.length, note: "按会话最后活跃日归集" },
      series,
      cards,
      groups: [...groups.values()].sort((a, b) => b.prompt - a.prompt),
    },
  });
}

/** 插件自身信息：界面上要显示名称与版本（和 dsh-context 的插件信息卡对齐） */
async function readPluginInfo() {
  try {
    const manifest = JSON.parse(await fs.readFile(new URL("./package.json", import.meta.url), "utf8"));
    return { name: String(manifest.name || "dyworker-context"), version: String(manifest.version || ""), description: String(manifest.description || "") };
  } catch {
    return { name: "dyworker-context", version: "", description: "" };
  }
}

let pluginInfo = null;

export function apply(ctx) {
  if (!pluginInfo) void readPluginInfo().then((info) => { pluginInfo = info; });
  ctx.effect(() => ctx.connection.fetch.register({
    path: DETAIL_ROUTE,
    methods: ["POST"],
    requestBody: "buffered",
    fetch: (request) => detail(ctx, request),
  }), "context: detail route");
  ctx.effect(() => ctx.connection.fetch.register({
    path: BROWSER_ROUTE,
    methods: ["POST"],
    requestBody: "buffered",
    fetch: (request) => browser(ctx, request),
  }), "context: browser route");
  ctx.effect(() => ctx.connection.fetch.register({
    path: BALANCE_ROUTE,
    methods: ["POST"],
    requestBody: "buffered",
    fetch: (request) => balance(ctx, request),
  }), "context: balance route");
}
