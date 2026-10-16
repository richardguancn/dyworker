// DYWorker 渲染基准夹具
//
// 目的：用真实 App 组件 + 真实 markdown/样式管线，量化「一次 App 重渲染」的成本。
// 做法：先装一个 stub 的 window.dyworker 桥，再动态 import 真实 App（保证桥在模块体执行前就位），
//       然后用 React <Profiler> 记录每次 commit 的 actualDuration。
// 不接主进程、不联网、不碰真实用户数据。

import { StrictMode, Profiler, createElement } from "react";
import { createRoot } from "react-dom/profiling";
import "katex/dist/katex.min.css";
import "@src/styles.css";
import "@src/appearance/appearance.css";
import "@src/layout.css";
import "@xterm/xterm/css/xterm.css";
import "@src/terminal.css";

// 错误捕获：把栈存起来供运行器读取（渲染进程 console 只能拿到短消息）
const captured: string[] = [];
(window as any).__errors = captured;
window.addEventListener("error", (event) => {
  captured.push(String((event as any).error?.stack || event.message));
});
window.addEventListener("unhandledrejection", (event) => {
  captured.push(String((event as any).reason?.stack || (event as any).reason));
});
const originalError = console.error;
console.error = (...args: unknown[]) => {
  captured.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" ").slice(0, 1200));
  originalError(...args);
};

// ---------------------------------------------------------------- 种子数据

const LOREM_CN = [
  "根据现有资料，这项工作的关键路径是先确认口径，再拆分到可交付的粒度。",
  "从数据上看，前三个季度的增速稳定，但边际贡献在收窄，需要重新评估投产比。",
  "建议把风险点单列一张表，按影响面排序，避免在评审时反复来回。",
  "这里有一个容易被忽略的前提：上游系统尚未完成接口改造，排期需要预留缓冲。",
];

function markdownChunk(seed: number): string {
  return [
    `## 第 ${seed} 节 · 结论与建议`,
    "",
    LOREM_CN[seed % LOREM_CN.length],
    "",
    "- 口径统一：以财务确认口径为准",
    "- 交付粒度：按周拆分，单周不超过 5 个交付物",
    "- 风险台账：影响面 × 发生概率，双维度排序",
    "",
    "| 指标 | 本期 | 上期 | 变化 |",
    "| --- | ---: | ---: | ---: |",
    `| 营收 | ${1200 + seed * 7} | ${1100 + seed * 5} | +${2 + (seed % 9)}% |`,
    `| 成本 | ${700 + seed * 3} | ${680 + seed * 4} | +${1 + (seed % 5)}% |`,
    "",
    "换算成公式即 $R = \\frac{P \\times Q}{C}$，其中 $C$ 为加权平均成本。",
    "",
    "```ts",
    `export function summarize(rows: Row[], seed = ${seed}) {`,
    "  return rows",
    "    .filter((row) => row.amount > 0)",
    "    .reduce((sum, row) => sum + row.amount * (1 + seed / 1000), 0);",
    "}",
    "```",
    "",
    LOREM_CN[(seed + 1) % LOREM_CN.length],
  ].join("\n");
}

function userChunk(seed: number): string {
  return `请把第 ${seed} 部分的结论整理成一份可以发给领导的简报，重点说明风险与排期。`;
}

// settleLast=true 用于复现「唤醒续跑窗口」误判：把**最后一条**助手消息标成已定稿
// （taskStatus=done），于是会话里只剩更早的历史助手消息没有 taskStatus。
// 续跑只置位 runningSessionIds、并不新建占位气泡（main.mts 的 wake:status），
// 因此"向前回溯找最近一条没有 taskStatus 的助手消息"会命中历史消息。
function makeMessages(count: number, settleLast = false) {
  const messages = [];
  for (let index = 0; index < count; index += 1) {
    const isUser = index % 2 === 0;
    messages.push({
      id: `m-${index}`,
      role: isUser ? "user" : "assistant",
      content: isUser ? userChunk(index / 2) : markdownChunk(Math.floor(index / 2)),
      createdAt: new Date(Date.now() - (count - index) * 60_000).toISOString(),
      ...(settleLast && index === count - 1 && !isUser ? { taskStatus: "done" } : {}),
    });
  }
  return messages;
}

const SESSION_ID = "bench-session";
const RUN_ID = "bench-run";
const BENCH_PARAMS = new URLSearchParams(location.search);
const MESSAGE_COUNT = Number(BENCH_PARAMS.get("messages") || 120);

const seedSession = {
  id: SESSION_ID,
  title: "性能基准会话",
  // channel 置位是为了走 channelRun 流式归约分支（与渠道会话同一条重渲染路径）
  channel: "qq",
  workspacePath: "",
  createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  updatedAt: new Date().toISOString(),
  messages: makeMessages(MESSAGE_COUNT, BENCH_PARAMS.get("settlelast") === "1"),
};

const initialState = {
  sessions: [seedSession],
  activeSessionId: SESSION_ID,
  workspacePath: "",
  workspaceEntries: [],
  settings: {
    identity: "general",
    endpoint: "http://127.0.0.1:1/chat/completions",
    apiKey: "bench",
    model: "bench-model",
    transcriptionEndpoint: "",
    visionEndpoint: "",
    visionModel: "",
    visionApiKey: "",
    approvalMode: "interactive",
  },
  pinnedWorkspacePaths: [],
  platform: BENCH_PARAMS.get("platform") || "darwin",
  windowMaximized: false,
};

// ---------------------------------------------------------------- stub 桥

const listeners: Record<string, ((payload: any) => void) | null> = {};
const never = () => undefined;
const resolveUndefined = () => Promise.resolve(undefined);

const agentListeners = new Set<(event: any) => void>();
listeners.agentEvent = event => { for (const callback of agentListeners) callback(event); };
let desktopRequest: any = null;
let desktopResolve: ((value: any) => void) | null = null;
let desktopCancelled = false;

const explicit: Record<string, any> = {
  platform: BENCH_PARAMS.get("platform") || "darwin",
  getInitialState: () => Promise.resolve(initialState),
  saveSessions: () => Promise.resolve({ ok: true }),
  saveSettings: resolveUndefined,
  savePinnedWorkspaces: resolveUndefined,
  refreshWorkspace: () => Promise.resolve([]),
  listTraces: () => Promise.resolve([]),
  refreshMemories: () => Promise.resolve([]),
  refreshSkills: () => Promise.resolve([]),
  getPendingWakes: () => Promise.resolve([]),
  onWindowStateChange: (cb: any) => { listeners.windowState = cb; return () => { listeners.windowState = null; }; },
  onAgentEvent: (cb: any) => { agentListeners.add(cb); return () => { agentListeners.delete(cb); }; },
  sendTask: (payload: any) => {
    desktopRequest = payload;
    listeners.agentEvent?.({ sessionId: payload.sessionId, runId: payload.runId, event: { type: "queue-start" } });
    return new Promise(resolve => { desktopResolve = resolve; });
  },
  cancelTask: (sessionId: string, runId: string) => {
    desktopCancelled = true;
    const result = { status: "cancelled", finalText: "桌面停止检查" };
    listeners.agentEvent?.({ sessionId, runId, event: { type: "agent-finished", result } });
    desktopResolve?.({ ok: true, result });
    return Promise.resolve({ ok: true });
  },
  onChannelsStatus: (cb: any) => { listeners.channelsStatus = cb; return () => { listeners.channelsStatus = null; }; },
  onBrowserPanelRequest: () => never,
  onBrowserControlState: () => never,
  onBrowserControlResumed: () => never,
  onAppearanceReset: () => never,
  getAppearance: () => Promise.resolve({ theme: "light", settings: {} }),
  getAppearanceCapabilities: () => Promise.resolve({}),
};

const bridge = new Proxy(explicit, {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    const name = String(prop);
    // 订阅类方法（onXxx）必须返回「退订函数」，而不是 Promise——
    // App 里普遍是 `const off = bridge.onX(cb); return () => off?.()` 的写法
    if (name.startsWith("on")) {
      return (cb: any) => {
        listeners[name] = cb;
        return () => { listeners[name] = null; };
      };
    }
    // 其余桥方法默认解析为「空数组」：数组同时支持 .filter/.map/.length/属性访问，
    // 比 undefined 宽容得多，避免污染 App 的 state（例如 setInboxItems(undefined) 会直接崩渲染）
    return () => Promise.resolve([]);
  },
});

(window as any).dyworker = bridge;

// ---------------------------------------------------------------- 测量

type Commit = { phase: string; actual: number; base: number; at: number };

const commits: Commit[] = [];
let profiling = true;

function onRender(_id: string, phase: string, actual: number, base: number) {
  if (!profiling) return;
  commits.push({ phase, actual, base, at: performance.now() });
}

function stats(values: number[]) {
  if (!values.length) return { n: 0, min: 0, p50: 0, p95: 0, max: 0, mean: 0, total: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const total = sorted.reduce((sum, v) => sum + v, 0);
  return {
    n: sorted.length,
    min: +sorted[0].toFixed(2),
    p50: +pick(0.5).toFixed(2),
    p95: +pick(0.95).toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
    mean: +(total / sorted.length).toFixed(2),
    total: +total.toFixed(2),
  };
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- 与构建无关的独立探针（不依赖 React Profiler）----
const longTasks: number[] = [];
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push(entry.duration);
  }).observe({ entryTypes: ["longtask"] });
} catch {
  // 不支持 longtask 就跳过
}

// 事件循环延迟：setInterval(16ms) 的实际间隔减去预期，超过 0 的部分即主线程被占住的时间
function startLagSampler() {
  const samples: number[] = [];
  let last = performance.now();
  const timer = window.setInterval(() => {
    const now = performance.now();
    samples.push(Math.max(0, now - last - 16));
    last = now;
  }, 16);
  return {
    stop() {
      window.clearInterval(timer);
      return samples;
    },
  };
}

// 强制同步布局：读 scrollHeight 会触发一次 style recalc + layout
function forcedLayoutMs() {
  const started = performance.now();
  void document.documentElement.scrollHeight;
  void document.body.offsetHeight;
  return performance.now() - started;
}

async function idleRerenders(count: number) {
  const before = commits.length;
  for (let index = 0; index < count; index += 1) {
    listeners.windowState?.(index % 2 === 0);
    await nextFrame();
  }
  return commits.slice(before).map((c) => c.actual);
}

function emitRun(event: any) {
  listeners.agentEvent?.({ sessionId: SESSION_ID, runId: RUN_ID, channelRun: true, event });
}
function emitText(text: string) {
  emitRun({ type: "dsh-conversation", turns: [{
    user: { id: "bench-live-user", text: "请生成本次性能检查报告", createdAt: "2026-10-15T00:00:00.000Z" },
    replies: [{ id: "bench-live-reply", text, partial: true, createdAt: "2026-10-15T00:00:01.000Z", executedMessages: [] }],
  }] });
}
function assertStreaming() {
  if (!document.querySelector(".streaming-markdown")) throw new Error("持续输出正文没有出现，不能记录为有效性能结果");
}

async function waitUntil(check: () => boolean, reason: string) {
  const deadline = performance.now() + 5000;
  while (!check()) { if (performance.now() > deadline) throw new Error(reason); await sleep(20); }
}
async function checkRuntimeRoutes() {
  const input = document.querySelector('textarea[placeholder="描述要完成的工作"]') as HTMLTextAreaElement;
  if (!input) throw new Error("找不到桌面输入框");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '检查持续输出与停止');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(50);
  (document.querySelector('[aria-label="发送"]') as HTMLButtonElement).click();
  await waitUntil(() => Boolean(desktopRequest), '桌面发送未进入真实页面处理流程');
  const turns = (text: string) => [{ user: { id: `route-user-${text}`, text: '检查持续输出与停止', createdAt: '2026-10-15T00:00:00.000Z' },
    replies: [{ id: `route-reply-${text}`, text, partial: true, createdAt: '2026-10-15T00:00:01.000Z', executedMessages: [] }] }];
  const eventFor = (sessionId: string, runId: string, route: string, event: any) => listeners.agentEvent?.({
    sessionId, runId, ...(route === 'schedule' ? { scheduleRun: true } : route === 'wake' ? { wakeRun: true } : {}), event,
  });
  eventFor(desktopRequest.sessionId, desktopRequest.runId, 'desktop', { type: 'dsh-conversation', turns: turns('**桌面持续输出**') });
  await waitUntil(() => Boolean(document.querySelector('.streaming-markdown strong')), '桌面持续输出没有显示');
  (document.querySelector('[aria-label="停止当前任务"]') as HTMLButtonElement).click();
  await waitUntil(() => !document.querySelector('.streaming-markdown'), '桌面停止后未收口');
  if (!desktopCancelled) throw new Error('停止没有传到取消入口');
  listeners.onScheduleRunStarted?.({ sessionId: 'route-schedule', runId: 'route-schedule-run', title: '计划性能检查', prompt: '检查计划输出' });
  await sleep(50);
  (document.querySelector('.session-item[title="计划性能检查"]') as HTMLButtonElement).click();
  await sleep(50);
  eventFor('route-schedule', 'route-schedule-run', 'schedule', { type: 'dsh-conversation', turns: turns('**计划持续输出**') });
  await waitUntil(() => Boolean(document.querySelector('.streaming-markdown strong')), '计划持续输出没有显示');
  eventFor('route-schedule', 'route-schedule-run', 'schedule', { type: 'agent-finished', result: {status: 'cancelled', finalText: '计划持续输出'} });
  await waitUntil(() => !document.querySelector('.streaming-markdown'), '计划结束后未收口');
  (document.querySelector('.session-item[title="性能基准会话"]') as HTMLButtonElement).click();
  await sleep(50);
  listeners.onWakeStatus?.({ sessionId: SESSION_ID, runId: 'route-wake-run', status: 'running', wakeAt: new Date().toISOString() });
  await sleep(50);
  eventFor(SESSION_ID, 'route-wake-run', 'wake', { type: 'dsh-conversation', turns: turns('**唤醒持续输出**') });
  await waitUntil(() => Boolean(document.querySelector('.streaming-markdown strong')), '唤醒持续输出没有显示');
  eventFor(SESSION_ID, 'route-wake-run', 'wake', { type: 'agent-finished', result: {status: 'cancelled', finalText: '唤醒持续输出'} });
  await waitUntil(() => !document.querySelector('.streaming-markdown'), '唤醒结束后未收口');
  return { desktop: true, desktopStop: desktopCancelled, schedule: true, wake: true };
}

async function checkPanelDrag() {
  const handle = document.querySelector('[aria-label="调整左侧面板宽度"]')!;
  const shell = document.querySelector('.app-shell')!;
  const before = parseFloat(getComputedStyle(shell).getPropertyValue('--sidebar-width'));
  const start = handle.getBoundingClientRect().x;
  const beforeCommits = commits.length;
  handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: start }));
  for (let index = 1; index <= 20; index++) {
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: start + index * 3 }));
    await nextFrame();
  }
  const duringCommits = commits.length - beforeCommits;
  const during = parseFloat(getComputedStyle(shell).getPropertyValue('--sidebar-width'));
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: start + 60 }));
  await nextFrame(); await nextFrame();
  const after = parseFloat(getComputedStyle(shell).getPropertyValue('--sidebar-width'));
  if (during <= before || after !== during) throw new Error('面板拖动没有生效或松手后宽度没有保持');
  return { before, during, after, duringCommits, totalCommits: commits.length - beforeCommits };
}

// 会话内搜索：用真实快捷键打开搜索并输入命中词，确认命中高亮落到实际消息行、
// 滚动定位后可见区域内确实有内容，而不是只更新命中计数。
async function checkConversationSearch() {
  const rowsBefore = document.querySelectorAll('.message-row').length;
  if (!rowsBefore) throw new Error('消息行未渲染，无法检查搜索');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, ctrlKey: true, bubbles: true }));
  await waitUntil(() => Boolean(document.querySelector('.conversation-search')), '搜索框没有打开');
  const input = document.querySelector('.conversation-search input') as HTMLInputElement;
  if (!input) throw new Error('找不到搜索输入框');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '风险');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitUntil(() => (document.querySelector('.conversation-search-count')?.textContent || '').includes('/'), '命中计数没有出现');
  const countText = document.querySelector('.conversation-search-count')!.textContent || '';
  const total = Number(countText.split('/').pop()!.trim()) || 0;
  if (!total) throw new Error(`搜索没有命中任何内容：${countText}`);
  const rowsAfter = document.querySelectorAll('.message-row').length;
  if (rowsAfter !== rowsBefore) throw new Error(`搜索打开后消息行数量变化：${rowsBefore} → ${rowsAfter}`);
  const viewport = document.querySelector('.conversation-viewport')!;
  const viewportRect = viewport.getBoundingClientRect();
  const scrollViewport = viewport as HTMLElement;
  const matchRow = () => {
    const highlights = (CSS as any).highlights as Map<string, any> | undefined;
    const current = highlights?.get('conversation-search-current');
    const firstRange = current ? [...current][0] : null;
    return firstRange ? (firstRange.startContainer.parentElement?.closest?.('.message-row') ?? null) : null;
  };
  const rowOffset = () => {
    const row = matchRow();
    if (!row) return Number.POSITIVE_INFINITY;
    const rect = row.getBoundingClientRect();
    return Math.abs((rect.top + rect.bottom) / 2 - (viewportRect.top + viewportRect.bottom) / 2);
  };
  // 平滑滚动是异步的：轮询到位或超时，避免把滚动动画的中间状态当成结果
  const deadline = performance.now() + 5000;
  while (rowOffset() > viewportRect.height / 2 && performance.now() < deadline) await sleep(100);
  const overlap = (row: Element) => {
    const rect = row.getBoundingClientRect();
    return Math.min(rect.bottom, viewportRect.bottom) - Math.max(rect.top, viewportRect.top);
  };
  const visibleRows = [...document.querySelectorAll('.message-row')].filter(row => overlap(row) > 8).length;
  const diagnostics = `scrollTop=${scrollViewport.scrollTop}, scrollHeight=${scrollViewport.scrollHeight}, clientHeight=${scrollViewport.clientHeight}, 可见行=${visibleRows}, 命中行偏移=${Math.round(rowOffset())}`;
  if (visibleRows < 1) throw new Error(`搜索定位后可见区域内没有任何消息行（${diagnostics}）`);
  const highlights = (CSS as any).highlights as Map<string, any> | undefined;
  const all = highlights?.get('conversation-search');
  if (!matchRow()) throw new Error('当前命中没有落到消息行上');
  const offset = rowOffset();
  if (offset > viewportRect.height / 2) throw new Error(`当前命中行不在可见区域中间附近（${diagnostics}）`);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(120);
  return { rows: rowsAfter, total, visibleRows, highlightRanges: all ? [...all].length : 0, currentOffset: +offset.toFixed(1) };
}

// 按主进程真实的 50ms 合流节流节奏推送流式正文
async function streamTokens(tokenCount: number, intervalMs = 50) {
  const before = commits.length;
  emitRun({ type: "queue-start" });
  await sleep(30);
  const base = markdownChunk(7);
  let text = "";
  const started = performance.now();
  for (let index = 0; index < tokenCount; index += 1) {
    text += base.slice((index * 37) % base.length, ((index * 37) % base.length) + 12);
    emitText(text);
    await sleep(intervalMs);
  }
  assertStreaming();
  const elapsed = performance.now() - started;
  return { commits: commits.slice(before).map((c) => c.actual), elapsedMs: +elapsed.toFixed(0) };
}

// 一条真实长度的助手回复：约 16k 字符，含标题/列表/表格/代码块/行内公式
function buildLongDoc(): string {
  const parts: string[] = [];
  for (let index = 0; parts.join("\n").length < 16_000; index += 1) {
    parts.push(markdownChunk(index));
  }
  return parts.join("\n\n");
}

const displayText = (text: string) => text.replace(/\s/g, "");

// 在计时前独立渲染参考正文，随后移除。不能只匹配重复段落的末句。
async function referenceDisplayText(content: string) {
  const reference = document.createElement("div");
  reference.style.display = "none";
  document.body.append(reference);
  const root = createRoot(reference);
  try {
    const { InteractiveMessage } = await import("@src/InteractiveMessage");
    root.render(createElement(InteractiveMessage, { content }));
    await waitUntil(() => Boolean(reference.textContent), "参考正文未完成显示");
    return displayText(reference.textContent || "");
  } finally {
    root.unmount();
    reference.remove();
  }
}

// 关键实验：把一条「逐字增长的完整 Markdown 回复」按 20 次/秒推给 App，
// 记录每次 commit 的耗时随正文长度的变化 —— 用于判定 O(n²) 全量重解析是否成立
async function streamLongDoc(totalChars: number, intervalMs = 50, chunkSize = 40, withStart = true, expectedDisplay = "") {
  const before = commits.length;
  const doc = buildLongDoc();
  let text = "";
  const series: Array<{ len: number; commitMs: number; t: number }> = [];
  const started = performance.now();
  // 先起一个渠道运行：只有 runningSessionIds 置位后，App 才会把这条助手消息
  // 判定为「未定稿」（streamingAssistantIndex），从而走到流式渲染分支。
  // withStart=false 是对照组：不置位 → streaming 恒为 false → 走 Markdown 路径，
  // 用于证明差异来自本次修复而不是夹具本身。
  if (withStart) {
    listeners.agentEvent?.({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      channelRun: true,
      event: { type: "queue-start" },
    });
    await sleep(30);
  }
  while (text.length < totalChars) {
    text = doc.slice(0, Math.min(doc.length, text.length + chunkSize));
    emitText(text);
    await sleep(intervalMs);
    const last = commits[commits.length - 1];
    series.push({
      len: text.length,
      commitMs: last ? +last.actual.toFixed(1) : 0,
      t: +(performance.now() - started).toFixed(0),
    });
  }
  // 事件已送完不代表正文已经画完：繁忙时 deferred 内容仍可能落后。
  // 对照参考正文的全部文字，避免重复末句使尚未显示完的内容提前通过。
  const catchupStarted = performance.now();
  const completedNode = () => [...document.querySelectorAll('.streaming-markdown')]
    .find(node => displayText(node.textContent || "") === expectedDisplay);
  if (withStart) {
    await waitUntil(() => Boolean(completedNode()), '持续输出正文未显示完整，不能作为等量输出的对照');
  }
  const displayCatchupMs = +(performance.now() - catchupStarted).toFixed(1);
  if (withStart) assertStreaming();
  const streamedMs = +(performance.now() - started).toFixed(0);
  // 流式途中（消息尚未定稿）抽样 DOM：验证未定稿正文确实渲染成了 Markdown，
  // 而不是像修复前那样把 `**加粗**`、``` 围栏原样显示成源码。
  const streamingNode = withStart ? completedNode() : document.querySelector(".streaming-markdown");
  const streamMarkup = streamingNode ? {
    strong: streamingNode.querySelectorAll("strong").length,
    pre: streamingNode.querySelectorAll("pre").length,
    table: streamingNode.querySelectorAll("table").length,
    inlineCode: streamingNode.querySelectorAll("code").length,
    // textContent 里残留 "**" 说明定稿/未定稿路径有块没被解析
    literalBoldMarkers: (streamingNode.textContent || "").split("**").length - 1,
    // 块渲染后，每个已收尾块都会产生独立的块级元素；数量随正文增长
    blockElements: streamingNode.querySelectorAll("p, h1, h2, h3, pre, table, ul, ol").length,
  } : null;
  // 收尾：消息定稿（taskStatus 落地 → streaming 转 false），测量一次性解析的代价
  const settleBefore = commits.length;
  listeners.agentEvent?.({
    sessionId: SESSION_ID,
    runId: RUN_ID,
    channelRun: true,
    event: { type: "agent-finished", result: { status: "canceled", finalText: text } },
  });
  await sleep(600);
  const settleCommits = commits.slice(settleBefore).map((c) => c.actual);
  return {
    series,
    all: commits.slice(before, settleBefore).map((c) => c.actual),
    settleCommits,
    streamMarkup,
    elapsedMs: streamedMs,
    finalLen: text.length,
    streamDisplayComplete: withStart && Boolean(streamingNode),
    expectedDisplayLength: expectedDisplay.length,
    displayCatchupMs,
  };
}

async function run() {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") || "all";

  await sleep(600); // 等 App 首屏与各 effect 落地
  const boot = { commits: commits.length, durations: commits.map((c) => c.actual) };

  const out: any = {
    messageCount: MESSAGE_COUNT,
    domNodes: document.getElementsByTagName("*").length,
    boot: stats(boot.durations),
    bootCommitCount: boot.commits,
  };

  if (mode === 'interaction') out.panelDrag = await checkPanelDrag();
  if (mode === 'routes') out.runtimeRoutes = await checkRuntimeRoutes();
  if (mode === 'search') out.conversationSearch = await checkConversationSearch();

  if (mode === "all" || mode === "idle") {
    commits.length = 0;
    await idleRerenders(3); // 预热
    commits.length = 0;
    const durations = await idleRerenders(30);
    out.idle = stats(durations);
    out.idleCommits = durations.length;
  }

  if (mode === "all" || mode === "stream") {
    commits.length = 0;
    longTasks.length = 0;
    const lag = startLagSampler();
    const result = await streamTokens(60, 50); // 3 秒流式，20 次/秒
    const lagSamples = lag.stop();
    out.stream = stats(result.commits);
    out.streamCommits = result.commits.length;
    out.streamElapsedMs = result.elapsedMs;
    out.streamDomNodes = document.getElementsByTagName("*").length;
    out.eventLoopLag = stats(lagSamples);
    out.longTasks = stats(longTasks);
    out.forcedLayoutMs = +forcedLayoutMs().toFixed(2);
  }

  // 长回复流式场景：判定 O(n²) 全量重解析
  if (mode === "longstream") {
    const target = Number(params.get("chars") || 16_000);
    const chunk = Number(params.get("chunk") || 40);
    const withStart = params.get("nostart") !== "1";
    const expectedDisplay = withStart ? await referenceDisplayText(buildLongDoc().slice(0, target)) : "";
    commits.length = 0;
    longTasks.length = 0;
    const lag = startLagSampler();
    const result = await streamLongDoc(target, 50, chunk, withStart, expectedDisplay);
    const lagSamples = lag.stop();
    out.longStream = {
      chunk,
      streamingPath: withStart,
      finalLen: result.finalLen,
      streamDisplayComplete: result.streamDisplayComplete,
      expectedDisplayLength: result.expectedDisplayLength,
      displayCatchupMs: result.displayCatchupMs,
      streamMarkup: result.streamMarkup,
      elapsedMs: result.elapsedMs,
      commits: stats(result.all),
      // 定稿瞬间（streaming 转 false）的提交代价：修复后 Markdown 只在这里解析一次
      settleCommits: result.settleCommits.map((v) => +v.toFixed(1)),
      settleStats: stats(result.settleCommits),
      eventLoopLag: stats(lagSamples),
      longTasks: stats(longTasks),
      domNodes: document.getElementsByTagName("*").length,
      // 抽稀成 12 个采样点，观察耗时随正文长度的增长曲线
      curve: result.series
        .filter((_, index) => index % Math.max(1, Math.floor(result.series.length / 12)) === 0)
        .map((point) => ({ len: point.len, ms: point.commitMs, t: point.t })),
      first10: result.series.slice(0, 10).map((p) => p.commitMs),
      last10: result.series.slice(-10).map((p) => p.commitMs),
    };
  }

  // 截图场景：边流边截图（run-bench 等到 BENCH_SNAPSHOT_READY 再 capturePage），
  // 用于人工核对未定稿正文的 Markdown 排版；开头即用户报告的那段「加粗 + 行内代码」
  if (mode === "snapshot") {
    commits.length = 0;
    const target = Number(params.get("chars") || 900);
    const doc = "**端到端探测全部成功**，还拿到了关键字段：`vid: apiv_4720411979692310529`。"
      + "我脚本里的判断只认 `wxv_` 前缀，会误判成降级——立刻修正：\n\n" + buildLongDoc();
    let text = "";
    listeners.agentEvent?.({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      channelRun: true,
      event: { type: "queue-start" },
    });
    await sleep(120);
    while (text.length < target) {
      text = doc.slice(0, Math.min(doc.length, text.length + 40));
      emitText(text);
      await sleep(20);
    }
    await sleep(500);
    const node = document.querySelector(".streaming-markdown");
    const nodeText = node?.textContent || "";
    out.snapshot = {
      chars: text.length,
      streamingNodes: document.querySelectorAll(".streaming-markdown").length,
      strong: node ? node.querySelectorAll("strong").length : 0,
      tables: node ? node.querySelectorAll("table").length : 0,
      codeBlocks: node ? node.querySelectorAll("pre").length : 0,
      inlineCode: node ? node.querySelectorAll("code").length : 0,
      literalBoldMarkers: nodeText.split("**").length - 1,
      rawFences: nodeText.split("```").length - 1,
    };
    document.title = "BENCH_SNAPSHOT_READY";
    await sleep(Number(params.get("hold") || 5000));
  }

  // 唤醒续跑窗口的误判场景：末条助手消息已定稿，续跑只置位 runningSessionIds、
  // 不新建占位气泡。此时不应有任何消息被当成"未定稿"。
  if (mode === "misclass") {
    const rowCount = document.querySelectorAll(".message-row").length;
    const streamingBefore = document.querySelectorAll(".streaming-markdown").length;
    listeners.onWakeStatus?.({
      sessionId: SESSION_ID,
      status: "running",
      runId: "wake-run-1",
      wakeAt: new Date(Date.now() + 60_000).toISOString(),
      reason: "等待渲染完成",
    });
    await sleep(500);
    const streamingRows = Array.from(document.querySelectorAll(".streaming-markdown"))
      .map((node) => (node.textContent || "").slice(0, 30));
    out.misclass = {
      rowCount,
      streamingBefore,
      streamingDuringWake: streamingRows.length,
      streamingRows,
      markdownDuringWake: document.querySelectorAll(".markdown-content").length,
    };
  }

  out.finalDomNodes = document.getElementsByTagName("*").length;
  // 端到端断言用：定稿后不应残留 .streaming-markdown（未定稿路径），历史消息应仍走 .markdown-content
  out.streamingNodes = document.querySelectorAll(".streaming-markdown").length;
  out.markdownNodes = document.querySelectorAll(".markdown-content").length;
  out.errors = captured.slice(0, 12);
  (window as any).__result = out;
  document.title = "BENCH_DONE";
  return out;
}

(window as any).__perf = { run, commits, listeners, stats, captured, idleRerenders, streamTokens, checkPanelDrag, checkConversationSearch };

// ---------------------------------------------------------------- 挂载

async function bootstrap() {
  // 与真实 src/main.tsx 一致：先初始化外观存储再渲染首帧
  const { bootstrapAppearance } = await import("@src/appearance/controller");
  try {
    await bootstrapAppearance();
  } catch (error) {
    captured.push("bootstrapAppearance failed: " + String(error));
  }
  const { App } = await import("@src/App");
  createRoot(document.getElementById("root")!).render(
    createElement(StrictMode, null, createElement(Profiler, { id: "app", onRender }, createElement(App))),
  );
}

bootstrap().then(() => {
  (window as any).__perfReady = true;
  document.title = "BENCH_READY";
});
