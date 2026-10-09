// 自研内置插件（轨迹 / 上下文）的契约测试。
//
// 三层都钉住，因为它们坏掉的方式完全不同：
//   1) 包形状：builtin-plugins/ 下的目录必须能被宿主扫描、解析出主机半边与客户端入口；
//   2) 客户端 bundle：真实产物能被模块加载器执行、只 require 宿主提供的模块、
//      并最终在插槽表里留下「轨迹 / 上下文」的贡献；
//   3) 主机半边路由：用假 ctx 直接跑 handler，断言返回形状与边界（非法 id、缺会话、
//      文件不存在、分页）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { createClientRuntime } from "../src/pluginRuntime/index.ts";
import { ClientPluginHost } from "../src/pluginRuntime/clientHost.ts";
import { resolveClientEntries } from "../electron/host/plugin-client.mts";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const builtinRoot = path.join(repoRoot, "builtin-plugins");
const PLUGINS = ["dyworker-trajectory", "dyworker-context"];

async function readManifest(name) {
  const dir = path.join(builtinRoot, name);
  const manifest = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
  return { dir, manifest };
}

function installDomStub() {
  const noop = () => {};
  const element = () => ({
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, removeAttribute: noop, appendChild: noop, removeChild: noop, remove: noop,
    addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
  });
  globalThis.window = {
    location: { origin: "http://localhost", href: "http://localhost/", pathname: "/", search: "", hash: "" },
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    setTimeout, clearTimeout, innerWidth: 1440, innerHeight: 900,
  };
  globalThis.document = {
    addEventListener: noop, removeEventListener: noop, createElement: element,
    documentElement: element(), body: element(), head: element(),
    querySelector: () => null, querySelectorAll: () => [],
  };
}

/** 用真实加载器执行 bundle，返回 { exports, missing, requires } */
async function loadRealBundle(name) {
  const { dir } = await readManifest(name);
  const source = await fs.readFile(path.join(dir, "client.js"), "utf8");
  assert.match(source, /window\.__ModuleLoader__\.load\(/, `${name} 的 client.js 必须是 DSH 客户端 bundle 形状`);
  assert.match(source, new RegExp(`id: "${name}"`), "bundle id 必须等于包名（宿主靠它复用同一份实例）");
  const target = {};
  const runtime = createClientRuntime({ target });
  new Function("window", "globalThis", source)(target, globalThis);
  const record = runtime.loader.bundles_()[0];
  assert.equal(record.error, undefined, `bundle 执行失败：${record.error}`);
  assert.deepEqual(record.missing, [], `bundle 请求了宿主没有的模块：${record.missing.join(", ")}`);
  return record;
}

/** 假 cordis ctx：只实现这两个插件用到的服务 */
function makeFakeCtx({ hostDir, sessions = {}, projections = {}, prices = null } = {}) {
  const routes = [];
  const effects = [];
  const ctx = {
    storage: {
      hostDir,
      // 价目走 storage.resolve(名) + 直接读文件（插件门面上没有 readJson）
      resolve: (name) => path.join(hostDir, "plugins", "data", String(name)),
      readJson: async (name) => (String(name) === "context-prices.json" ? prices : null),
    },
    sessions: {
      get: (id) => sessions[String(id)],
      // 真实契约：loadAll 返回 Promise（archive 异步装载）——写成同步数组会掩盖"仪表盘全 0"的 bug
      loadAll: async () => Object.values(sessions),
    },
    sessionProjections: {
      viewOf: (session, key) => (key === "contextTimeline" ? projections[String(session?.id)] ?? null : null),
    },
    connection: { fetch: { register: (route) => { routes.push(route); return () => undefined; } } },
    effect: (fn) => { effects.push(fn()); },
  };
  return { ctx, routes, effects };
}

function post(route, body) {
  return route.fetch(new Request(`http://plugin.local${route.path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }));
}

test("内置插件：包形状能被宿主扫描并解析出两半", async () => {
  // Git 检出的时间不能证明产物是否过期；重新生成并逐字比较内容。
  execFileSync(process.execPath, [path.join(repoRoot, "scripts/build-plugins.mjs"), "--check"], {
    cwd: repoRoot, timeout: 30000, stdio: "pipe",
  });
  for (const name of PLUGINS) {
    const { dir, manifest } = await readManifest(name);
    assert.equal(manifest.name, name);
    assert.equal(manifest.dsh?.client?.platform, "web", `${name} 必须声明 web 客户端平台`);
    assert.ok(manifest.main, `${name} 必须显式声明 main（宿主只读 main / exports["."].default）`);
    await fs.access(path.join(dir, manifest.main));
    const entries = resolveClientEntries(manifest, dir);
    assert.equal(entries[0]?.primary, true, `${name} 的 ./client 必须是主入口`);
    await fs.access(entries[0].file);
    // 主机半边是纯 ESM（builtin 不参与 TS 编译），形状必须是 cordis 插件
    const host = await import(path.join(dir, manifest.main));
    assert.equal(host.name, name);
    assert.ok(Array.isArray(host.inject) && host.inject.length > 0, "主机半边要声明 inject");
    assert.equal(typeof host.apply, "function");
  }
});

test("内置插件：客户端 bundle 在插槽表里留下轨迹 / 上下文的贡献", async () => {
  installDomStub();
  const host = new ClientPluginHost();
  for (const name of PLUGINS) {
    const record = await loadRealBundle(name);
    const loaded = await host.load(record.exports, record.id || name);
    assert.equal(loaded.ok, true, `${name} 容器加载失败：${loaded.error}`);
  }
  const views = host.contributionsFor("conversation.view").map((item) => String(item.meta.key ?? item.meta.id));
  assert.deepEqual(views.sort(), ["context", "trajectory"], "会话区应有「轨迹」「上下文」两个插件视图");
  const panels = host.contributionsFor("sidebar.right.pane.tab").map((item) => String(item.meta.key ?? item.meta.id));
  // 右侧面板只留仪表盘：会话区已有「上下文」标签，紧凑面板重复了
  assert.deepEqual(panels, ["context-dashboard"], "右侧面板只登记「上下文仪表盘」");
  // 标签文案来自插件自己（壳层直接渲染 meta.label()）
  const trajectory = host.contributionsFor("conversation.view").find((item) => item.meta.key === "trajectory");
  assert.equal(trajectory.meta.label(), "轨迹");
  const context = host.contributionsFor("conversation.view").find((item) => item.meta.key === "context");
  assert.equal(context.meta.label(), "上下文");
});

test("轨迹插件主机半边：按 offset 分页读本会话 trace，非法 id 与缺文件都如实回答", async () => {
  const hostDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyw-traj-"));
  const sessionId = "session-demo-1";
  const records = [
    { seq: 1, time: "2026-10-04T10:00:00.000Z", turn: 1, step: 0, kind: "model-request", direction: "in", target: "model", title: "请求模型（第 1 轮）", content: "{}" },
    { seq: 2, time: "2026-10-04T10:00:02.000Z", turn: 1, step: 0, kind: "model-response", direction: "out", target: "model", title: "模型响应", content: "{}", parentSeq: 1 },
    { seq: 3, time: "2026-10-04T10:00:03.000Z", turn: 1, step: 1, kind: "tool-call", direction: "in", target: "tool", title: "调用工具 run_command", content: "{}" },
  ];
  await fs.mkdir(path.join(hostDir, "traces"), { recursive: true });
  await fs.writeFile(path.join(hostDir, "traces", `${sessionId}.jsonl`), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");

  const { ctx, routes } = makeFakeCtx({ hostDir });
  const plugin = await import(path.join(builtinRoot, "dyworker-trajectory", "index.js"));
  plugin.apply(ctx);
  assert.deepEqual(routes.map((route) => route.path), ["/api/dyworker-trajectory/read"]);

  const first = await (await post(routes[0], { sessionId, offset: 0, limit: 2 })).json();
  assert.equal(first.ok, true);
  assert.equal(first.total, 3);
  assert.equal(first.records.length, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.records[0].kind, "model-request");

  const second = await (await post(routes[0], { sessionId, offset: 2, limit: 2 })).json();
  assert.equal(second.records.length, 1);
  assert.equal(second.hasMore, false);

  const bad = await post(routes[0], { sessionId: "../../etc/passwd" });
  assert.equal(bad.status, 400, "带路径分隔的会话 id 必须被拒绝");

  const empty = await (await post(routes[0], { sessionId: "not-there" })).json();
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.records, [], "没有落盘文件时回空数组，不是错误");
  await fs.rm(hostDir, { recursive: true, force: true });
});

test("上下文插件主机半边：detail 汇总构成/事件/文件活动/计时，balance 汇总跨会话用量", async () => {
  const hostDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyw-ctx-"));
  const sessionId = "session-demo-2";
  const records = [
    { runId: "run-a", seq: 1, time: "2026-10-04T10:00:00.000Z", turn: 1, step: 0, kind: "model-request", direction: "in", target: "model", title: "请求模型（第 1 轮）", content: JSON.stringify({ model: "glm-5.3" }), context: { messages: 3, tools: 12, toolsTokens: 7000, systemTokens: 900, promptTokens: 11800 } },
    { runId: "run-a", seq: 9, time: "2026-10-04T10:00:01.500Z", turn: 1, step: 0, kind: "model-first-token", direction: "out", target: "model", title: "首个 token", content: "", parentSeq: 1 },
    { runId: "run-a", seq: 2, time: "2026-10-04T10:00:02.000Z", turn: 1, step: 0, kind: "model-response", direction: "out", target: "model", title: "模型响应", content: "{}", parentSeq: 1 },
    { runId: "run-a", seq: 3, time: "2026-10-04T10:00:02.100Z", turn: 1, step: 0, kind: "token-usage", direction: "out", target: "model", title: "token 用量", content: "", parentSeq: 1, usage: { prompt: 12000, completion: 400, estimated: false, cacheRead: 9000, reasoning: 120 } },
    { runId: "run-a", seq: 4, time: "2026-10-04T10:00:03.000Z", turn: 1, step: 1, kind: "tool-call", direction: "in", target: "tool", title: "调用工具 run_command", content: "{}" },
    { runId: "run-a", seq: 5, time: "2026-10-04T10:00:05.000Z", turn: 1, step: 1, kind: "tool-result", direction: "out", target: "tool", title: "工具 run_command 成功", content: "ok", parentSeq: 4 },
    { runId: "run-a", seq: 6, time: "2026-10-04T10:00:06.000Z", turn: 1, step: 2, kind: "file-change", direction: "out", target: "system", title: "文件变更", content: JSON.stringify([{ path: "/tmp/a.md" }, { path: "/tmp/a.md" }, { path: "/tmp/b.md" }]) },
    { runId: "run-a", seq: 7, time: "2026-10-04T10:00:07.000Z", turn: 1, step: 3, kind: "context-compacted", direction: "out", target: "system", title: "上下文已压缩", content: "摘要" },
    { runId: "run-a", seq: 8, time: "2026-10-04T10:00:08.000Z", turn: 1, step: 3, kind: "context-pruned", direction: "out", target: "system", title: "上下文剪枝", content: JSON.stringify({ reclaimed: 2400, reason: "auto" }) },
    { runId: "run-child", seq: 1, time: "2026-10-04T10:00:09.000Z", turn: 1, step: 4, depth: 1, branch: { parentId: "run-a", title: "子任务：核查", depth: 1 }, kind: "model-request", direction: "in", target: "model", title: "请求模型（第 1 轮）", content: JSON.stringify({ model: "glm-5.3" }), context: { messages: 2, tools: 0, toolsTokens: 0, systemTokens: 800, promptTokens: 900 } },
    { runId: "run-child", seq: 2, time: "2026-10-04T10:00:10.000Z", turn: 1, step: 4, depth: 1, kind: "token-usage", direction: "out", target: "model", title: "token 用量", content: "", parentSeq: 1, usage: { prompt: 900, completion: 120, estimated: false } },
  ];
  await fs.mkdir(path.join(hostDir, "traces"), { recursive: true });
  await fs.writeFile(path.join(hostDir, "traces", `${sessionId}.jsonl`), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");

  const session = {
    id: sessionId,
    title: "示例会话",
    workspacePath: "/Users/demo/ws",
    contextModel: "glm-5.3",
    contextTokens: 128000,
    createdAt: "2026-10-04T09:00:00.000Z",
    updatedAt: new Date().toISOString(),
    messages: [
      { role: "system", content: "你是助手" },
      { role: "user", content: "帮我看下上下文" },
      { role: "assistant", content: "好的" },
    ],
    tokenStats: { prompt: 12000, completion: 400, requests: 1 },
  };
  const projections = {
    [sessionId]: {
      current: { system: 900, tools: 3000, user: 60, inject: 0, skill: 0, assistant: 40, tool: 500, total: 4500 },
      counts: { turns: 1, steps: 1, injects: 0, compactions: 1, prunes: 0 },
      nodes: [{ seq: 1, cat: "user", tokens: 60 }, { seq: 2, cat: "tool", tokens: 500, tool: "run_command" }],
      requests: [{ turn: 1, seq: 3, total: 4500, prompt: 12000 }],
    },
  };
  const { ctx, routes } = makeFakeCtx({ hostDir, sessions: { [sessionId]: session }, projections });
  const plugin = await import(path.join(builtinRoot, "dyworker-context", "index.js"));
  plugin.apply(ctx);
  assert.deepEqual(
    routes.map((route) => route.path).sort(),
    ["/api/dyworker-context/balance", "/api/dyworker-context/browser", "/api/dyworker-context/detail"],
  );

  const detailRoute = routes.find((route) => route.path.endsWith("/detail"));
  const detail = await (await post(detailRoute, { sessionId })).json();
  assert.equal(detail.ok, true);
  assert.equal(detail.value.session.title, "示例会话");
  assert.equal(detail.value.timeline.current.total, 4500, "构成来自 contextTimeline 投影");
  assert.equal(detail.value.trace.requests.length, 2, "主 Agent 与子 Agent 各一次请求");
  assert.equal(detail.value.trace.requests[0].prompt, 12000, "逐请求输入 token 来自 trace");
  assert.equal(detail.value.trace.tools.total, 1);
  assert.equal(detail.value.trace.tools.failed, 0);
  assert.equal(detail.value.trace.events.length, 4, "文件变更 + 压缩 + 剪枝 + 系统消息注入四条上下文事件");
  assert.ok(detail.value.trace.events.some((event) => event.kind === "inject"), "会话里的系统消息计入注入事件");
  assert.ok(detail.value.trace.timing.thinkingMs > 0, "生成时长按推理 token 拆出思考（≈）");
  assert.ok(detail.value.trace.timing.outputMs > 0, "生成时长拆出输出（≈）");
  assert.equal(detail.value.cost.total, null, "没配价目时不编金额");
  assert.equal(detail.value.cost.unpricedRequests, 2, "两次请求都记为未配价");
  assert.deepEqual(
    detail.value.trace.events.map((event) => event.kind).filter((kind) => kind === "file" || kind === "compaction"),
    ["file", "compaction"],
  );
  assert.equal(detail.value.trace.fileOps.length, 2, "两个文件（a.md 变更两次）");
  assert.equal(detail.value.trace.fileOps[0].writes, 2, "文件变更事件计入写入次数");
  assert.equal(detail.value.trace.counts.cacheRead, 9000, "缓存命中 token 从用量里带出来");
  assert.equal(Math.round(detail.value.trace.counts.cacheHitRate * 100), 70, "缓存命中率 = 命中/输入（含子 Agent 的那次请求）");
  assert.ok(detail.value.trace.counts.reasoning >= 120, "推理 token 带出来");
  assert.ok(detail.value.trace.tokenSplit.system > 0, "分类构成里有系统提示词");
  assert.ok(detail.value.trace.tokenSplit.tools > 0, "分类构成里有工具定义");
  assert.ok(detail.value.trace.timing.waitMs >= 1500, "首 token 延迟来自 model-first-token");
  assert.ok(detail.value.trace.timing.generateMs >= 500, "生成时长 = 首 token → 响应");
  // 吞吐量只按"有生成时长"的请求算：夹具里主请求 400 tok / 0.6s，子请求没有首 token 不计入
  assert.ok(detail.value.trace.timing.throughput > 0, "吞吐量 = 有生成时长的输出 token / 生成时长");
  assert.ok(detail.value.trace.timing.throughput < 5000, `吞吐量不该被无首 token 的请求稀释：${detail.value.trace.timing.throughput}`);
  assert.deepEqual(detail.value.trace.events.map((event) => event.kind).filter((kind) => kind === "prune"), ["prune"], "剪枝事件进上下文事件");
  assert.equal(detail.value.trace.agents.length, 2, "主 Agent + 一个子 Agent");
  assert.equal(detail.value.trace.agents[1].parentId, "main");
  assert.equal(detail.value.trace.agents[1].title, "子任务：核查");
  assert.ok(detail.value.trace.timing.modelMs >= 2000, "模型耗时 = 请求→响应");
  assert.ok(detail.value.trace.timing.toolMs >= 2000, "工具耗时 = 调用→结果");

  const missing = await post(detailRoute, { sessionId: "nope" });
  assert.equal(missing.status, 404);

  const balanceRoute = routes.find((route) => route.path.endsWith("/balance"));
  const balance = await (await post(balanceRoute, { days: 7 })).json();
  assert.equal(balance.ok, true);
  assert.equal(balance.value.series.length, 7, "连续 7 天，没有用量的日子补 0");
  assert.equal(balance.value.totals.prompt, 12000);
  assert.equal(balance.value.cards.length, 1);
  assert.equal(balance.value.cards[0].turns, 1);
  assert.equal(balance.value.groups.length, 1);
  assert.equal(balance.value.groups[0].name, "ws");
  const today = balance.value.series[balance.value.series.length - 1];
  assert.equal(today.prompt, 12000, "今天的用量按会话最后活跃日归集");
  assert.equal(balance.value.cards[0].composition?.total, 4500, "用量大的会话卡片带上构成环");

  // 上下文浏览器：元素要带类别、正文与工具名
  const browserRoute = routes.find((route) => route.path.endsWith("/browser"));
  const browser = await (await post(browserRoute, { sessionId })).json();
  assert.equal(browser.ok, true);
  assert.equal(browser.value.elements.length, session.messages.length);
  assert.deepEqual(browser.value.elements.map((element) => element.category), ["system", "user", "assistant"]);
  assert.equal(browser.value.elements[1].text, "帮我看下上下文", "元素要带正文");
  assert.ok(browser.value.elements[0].tokens > 0, "元素要有 token 估算");
  assert.equal(browser.value.counts.byCategory.user, 1);
  const noSession = await post(browserRoute, { sessionId: "../../x" });
  assert.equal(noSession.status, 400, "非法会话 id 要拒绝");
  await fs.rm(hostDir, { recursive: true, force: true });
});

test("上下文插件：配了价目就按真实用量算费用（含缓存单价与未配价计数）", async () => {
  const hostDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyw-price-"));
  const sessionId = "session-price";
  const records = [
    { runId: "run-a", seq: 1, time: "2026-10-04T10:00:00.000Z", turn: 1, step: 0, kind: "model-request", direction: "in", target: "model", title: "请求模型（第 1 轮）", content: JSON.stringify({ model: "glm-5.3" }), context: { messages: 3, tools: 0, toolsTokens: 0, systemTokens: 100, promptTokens: 12000 } },
    { runId: "run-a", seq: 2, time: "2026-10-04T10:00:02.000Z", turn: 1, step: 0, kind: "token-usage", direction: "out", target: "model", title: "token 用量", content: "", parentSeq: 1, usage: { prompt: 12000, completion: 400, cacheRead: 9000 } },
    { runId: "run-b", seq: 1, time: "2026-10-04T10:00:03.000Z", turn: 1, step: 1, kind: "model-request", direction: "in", target: "model", title: "请求模型（第 2 轮）", content: JSON.stringify({ model: "unknown-model" }) },
    { runId: "run-b", seq: 2, time: "2026-10-04T10:00:04.000Z", turn: 1, step: 1, kind: "token-usage", direction: "out", target: "model", title: "token 用量", content: "", parentSeq: 1, usage: { prompt: 1000, completion: 100 } },
  ];
  await fs.mkdir(path.join(hostDir, "traces"), { recursive: true });
  await fs.writeFile(path.join(hostDir, "traces", `${sessionId}.jsonl`), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
  const session = { id: sessionId, title: "计价会话", messages: [{ role: "user", content: "hi" }], tokenStats: { prompt: 0, completion: 0, requests: 0 }, contextTokens: 1000, updatedAt: new Date().toISOString() };
  await fs.mkdir(path.join(hostDir, "plugins", "data"), { recursive: true });
  await fs.writeFile(path.join(hostDir, "plugins", "data", "context-prices.json"), JSON.stringify({
    currency: "USD",
    source: "test-prices",
    models: { "glm-5.3": { input: 1, output: 2, cacheRead: 0.1 } },
  }), "utf8");
  const { ctx, routes } = makeFakeCtx({
    hostDir,
    sessions: { [sessionId]: session },
  });
  const plugin = await import(path.join(builtinRoot, "dyworker-context", "index.js"));
  plugin.apply(ctx);
  const detailRoute = routes.find((route) => route.path.endsWith("/detail"));
  const detail = await (await post(detailRoute, { sessionId })).json();
  // (12000-9000)*1 + 9000*0.1 + 400*2 = 4700（每 1M 单价），未配价的 run-b 不计入
  assert.equal(detail.value.cost.pricedRequests, 1);
  assert.equal(detail.value.cost.unpricedRequests, 1);
  assert.ok(Math.abs(detail.value.cost.total - 4700 / 1_000_000) < 1e-12, `费用=${detail.value.cost.total}`);
  await fs.rm(hostDir, { recursive: true, force: true });
});

test("客户端宿主：插件调 uiConversation.openSession 会桥到壳层的跳转回调", async () => {
  const opened = [];
  const host = new ClientPluginHost({ onOpenSession: (sessionId) => opened.push(sessionId) });
  const record = await host.load({
    name: "jump-demo",
    inject: ["uiConversation"],
    apply(ctx) {
      assert.equal(ctx.uiConversation.openSession("session-a"), true, "有回调时返回 true");
      assert.equal(ctx.uiConversation.openSession(""), false, "空 id 不跳");
    },
  }, "jump-demo");
  assert.equal(record.ok, true, record.error);
  assert.deepEqual(opened, ["session-a"]);
});

test("客户端宿主：停用插件要把它登记的贡献一并收回（不然标签一直留在界面上）", async () => {
  const host = new ClientPluginHost();
  const loaded = await host.load({
    name: "unload-demo",
    inject: ["slots"],
    apply(ctx) {
      ctx.slots.inject("conversation.view", () => ctx.slots.register({
        name: "conversation.view", id: "demo", key: "demo", label: () => "示例",
      }, () => null));
    },
  }, "unload-demo");
  assert.equal(loaded.ok, true, loaded.error);
  assert.deepEqual(host.contributionsFor("conversation.view").map((item) => item.meta.key), ["demo"]);
  assert.deepEqual(host.pluginIdsWithContributions(), ["unload-demo"]);

  assert.equal(await host.unload("unload-demo"), true);
  assert.deepEqual(host.contributionsFor("conversation.view"), [], "停用后贡献要清空");
  assert.deepEqual(host.pluginIdsWithContributions(), []);
  assert.equal(await host.unload("not-loaded"), false, "没加载过的插件卸载返回 false");
});
