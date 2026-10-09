// 上下文插件的界面实现：会话区「上下文」标签 + 右侧面板「上下文仪表盘」。
//
// 对照 dsh-context 的九个面：上下文统计 KPI、插件信息、Token 统计、耗时统计、
// 当前上下文、上下文浏览器、上下文事件、文件活动、Agent 网络、上下文趋势。
// 真实值与估算值分得很清：真实用量带 tok 直出，估算值一律带 ≈ 并注明口径。

import * as React from "react";
import { EChart } from "./echarts";

const DETAIL_ROUTE = "/api/dyworker-context/detail";
const BROWSER_ROUTE = "/api/dyworker-context/browser";
const BALANCE_ROUTE = "/api/dyworker-context/balance";
const POLL_MS = 3000;
/** 热力图覆盖 8 周；柱状图在其中截取所选区间 */
const HEATMAP_DAYS = 56;

export const CATEGORIES = [
  { key: "system", label: "系统提示词", color: "#6b7280" },
  { key: "tools", label: "工具定义", color: "#e8930c" },
  { key: "user", label: "用户消息", color: "#2f6fed" },
  { key: "inject", label: "注入内容", color: "#9333ea" },
  { key: "skill", label: "技能注入", color: "#14b8a6" },
  { key: "assistant", label: "助手消息", color: "#8b5cf6" },
  { key: "tool", label: "工具结果", color: "#0d9488" },
];
const OUTPUT_CATEGORY = { key: "output", label: "输出", color: "#ec4899" };
const ALL_CATEGORIES = [...CATEGORIES, OUTPUT_CATEGORY];

const TIMING_PARTS = [
  { key: "waitMs", label: "模型等待", color: "#2f6fed" },
  { key: "thinkingMs", label: "模型思考 ≈", color: "#a855f7" },
  { key: "outputMs", label: "模型输出 ≈", color: "#8b5cf6" },
  { key: "toolMs", label: "工具执行", color: "#e8930c" },
  { key: "overheadMs", label: "其他开销", color: "#6b7280" },
];

const EVENT_KINDS = [
  { key: "inject", label: "注入" },
  { key: "compaction", label: "压缩" },
  { key: "prune", label: "剪枝" },
  { key: "switch", label: "切换" },
  { key: "plan", label: "计划" },
  { key: "file", label: "文件" },
];

const FILE_KINDS = [
  { key: "reads", label: "读取" },
  { key: "writes", label: "写入" },
  { key: "searches", label: "搜索" },
  { key: "images", label: "图片" },
];

// ── 小工具 ────────────────────────────────────────────────────────
function formatTokens(value: number | null | undefined): string {
  const number = Number(value) || 0;
  if (number < 1000) return String(Math.round(number));
  if (number < 1_000_000) return `${(number / 1000).toFixed(number < 10_000 ? 1 : 0)}k`;
  return `${(number / 1_000_000).toFixed(1)}M`;
}

function formatDuration(ms: number | null | undefined): string {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  const minutes = Math.floor(value / 60_000);
  if (minutes < 60) return `${minutes}m${String(Math.round((value % 60_000) / 1000)).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d${String(hours % 24).padStart(2, "0")}h`;
}

function formatClock(value: string | null | undefined): string {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return "—";
  const date = new Date(ms);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value > 0 && value < 0.001) return "<0.1%";
  return `${(value * 100).toFixed(1)}%`;
}

function oneLine(text: string, limit = 120): string {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function categoryOf(key: string) {
  return ALL_CATEGORIES.find((item) => item.key === key);
}

function colorOf(key: string, fallback = "#6b7280"): string {
  return categoryOf(key)?.color || fallback;
}

function labelOf(key: string): string {
  return categoryOf(key)?.label || key;
}

// ── 基础块 ────────────────────────────────────────────────────────
function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" | "quiet" }) {
  return (
    <div className="dyw-ctx-kpi" title={hint}>
      <span className="dyw-ctx-kpi-label">{label}</span>
      <strong className={`dyw-ctx-kpi-value ${tone || ""}`}>{value}</strong>
    </div>
  );
}

/** 分类环（Token 统计 / 耗时统计 / 仪表盘会话卡共用）：ECharts 环形图 + 居中叠字 */
function Ring({ parts, size = 108, center }: { parts: Array<{ key: string; label: string; color: string; value: number }>; size?: number; center?: React.ReactNode }) {
  const total = parts.reduce((sum, part) => sum + (Number(part.value) || 0), 0);
  const option = React.useMemo(() => ({
    animation: false,
    tooltip: {
      trigger: "item",
      formatter: (params: any) => `${params.name} ${formatTokens(params.value)} tok（${total ? formatPercent(params.value / total) : "—"}）`,
    },
    series: [{
      type: "pie",
      radius: ["62%", "88%"],
      center: ["50%", "50%"],
      avoidLabelOverlap: false,
      label: { show: false },
      labelLine: { show: false },
      itemStyle: { borderWidth: 0 },
      data: parts.filter((part) => (Number(part.value) || 0) > 0).map((part) => ({
        name: part.label,
        value: Number(part.value) || 0,
        itemStyle: { color: part.color },
      })),
    }],
  }), [parts, total]);
  return (
    <EChart
      className="dyw-ctx-ring"
      option={option}
      height={size}
      overlay={center ? <div className="dyw-ctx-ring-center">{center}</div> : null}
    />
  );
}

/** 从 agents 里取选中项（主 Agent 用 main） */
function list0(agents: any[], id: string) {
  return (agents || []).find((agent) => agent.id === id) || (agents || [])[0] || null;
}

function LegendRow({ label, color, value, percent, note }: { label: string; color: string; value: string; percent?: string; note?: string }) {
  return (
    <div className="dyw-ctx-legend-row">
      <i style={{ background: color }} />
      <span className="dyw-ctx-legend-name">{label}</span>
      <span className="dyw-ctx-legend-value">{value}</span>
      {percent ? <span className="dyw-ctx-legend-percent">{percent}</span> : null}
      {note ? <span className="dyw-ctx-legend-note">{note}</span> : null}
    </div>
  );
}

/** 堆叠条：当前上下文 / 趋势 */
function StackBar({ parts, total, windowTokens, height = 14 }: { parts: Array<{ key: string; value: number }>; total?: number; windowTokens?: number; height?: number }) {
  const sum = total || parts.reduce((acc, part) => acc + (Number(part.value) || 0), 0) || 1;
  const free = windowTokens && windowTokens > sum ? windowTokens - sum : 0;
  return (
    <div className="dyw-ctx-bar" style={{ height }}>
      {parts.map((part) => {
        const value = Number(part.value) || 0;
        if (value <= 0) return null;
        return (
          <span
            key={part.key}
            className="dyw-ctx-bar-piece"
            style={{ width: `${(value / (sum + free)) * 100}%`, background: colorOf(part.key) }}
            title={`${labelOf(part.key)} ${formatTokens(value)} tok`}
          />
        );
      })}
      {free > 0 ? <span className="dyw-ctx-bar-free" title={`空闲窗口 ${formatTokens(free)} tok`} /> : null}
    </div>
  );
}

// ── 数据 ─────────────────────────────────────────────────────────
function useDetail(sessionId: string) {
  const [detail, setDetail] = React.useState<any>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => { setDetail(null); setError(""); }, [sessionId]);

  const load = React.useCallback(async () => {
    if (!sessionId) return;
    try {
      const response = await fetch(DETAIL_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const payload = await response.json();
      if (!payload?.ok) { setError(String(payload?.error || `接口返回 ${response.status}`)); return; }
      setDetail(payload.value);
      setError("");
    } catch (fetchError: any) {
      setError(String(fetchError?.message || fetchError));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  React.useEffect(() => {
    if (!sessionId) return undefined;
    setLoading(true);
    void load();
    const timer = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [sessionId, load]);

  return { detail, error, loading, reload: load };
}

/** 当前上下文：系统提示词/工具定义来自请求载荷估算，消息类来自会话投影 */
function mergeCurrent(timelineCurrent: any, lastRequest: any): Record<string, number> | null {
  if (!timelineCurrent && !lastRequest?.context) return null;
  const merged: Record<string, number> = {};
  for (const category of CATEGORIES) {
    const fromTimeline = Number(timelineCurrent?.[category.key]) || 0;
    const fromRequest = category.key === "system"
      ? Number(lastRequest?.context?.systemTokens) || 0
      : category.key === "tools"
        ? Number(lastRequest?.context?.toolsTokens) || 0
        : 0;
    merged[category.key] = Math.max(fromTimeline, fromRequest);
  }
  merged.total = CATEGORIES.reduce((sum, category) => sum + merged[category.key], 0);
  return merged;
}

// ── 卡片：上下文统计 / Token 统计 / 耗时统计 ───────────────────────
function StatsBand({ detail }: { detail: any }) {
  const trace = detail.trace || {};
  const counts = trace.counts || {};
  const timelineCounts = detail.timeline?.counts || {};
  const session = detail.session || {};
  const cacheRate = counts.cacheHitRate;
  return (
    <div className="dyw-ctx-kpis wide">
      <Kpi label="轮次" value={String(timelineCounts.turns ?? session.userMessages ?? 0)} hint="上下文投影里的轮次数" />
      <Kpi label="步数" value={String(timelineCounts.steps ?? counts.requestCount ?? 0)} hint="模型请求数（每一步一次请求）" />
      <Kpi label="用户输入" value={String(session.userMessages ?? 0)} />
      <Kpi label="工具调用" value={`${counts.toolCalls ?? 0}${counts.toolFailed ? ` · 失败 ${counts.toolFailed}` : ""}`} />
      <Kpi
        label="缓存命中"
        value={typeof cacheRate === "number" ? formatPercent(cacheRate) : "未记录"}
        hint={typeof cacheRate === "number"
          ? `命中 ${formatTokens(counts.cacheRead)} tok / 输入 ${formatTokens(counts.promptTokens)} tok（供应商回报）`
          : "供应商没有回报缓存字段：老 trace 里没有，新会话会带上"}
      />
      {detail.cost?.total !== null && detail.cost?.total !== undefined ? (
        <Kpi
          label="费用"
          value={`${detail.cost.currency === "CNY" ? "¥" : "$"}${Number(detail.cost.total).toFixed(2)}`}
          hint={`按 ${detail.cost.source} 里的价目 × 真实用量计算；已计价请求 ${detail.cost.pricedRequests}${detail.cost.unpricedRequests ? ` · 未配价 ${detail.cost.unpricedRequests}` : ""}`}
        />
      ) : (
        <Kpi
          label="费用"
          value="未配置价目"
          tone="quiet"
          hint={`把模型单价写进插件数据目录的 ${detail.cost?.source || "context-prices.json"} 就会按真实用量算钱；本插件不内置价目，也不猜单价`}
        />
      )}
      <p className="dyw-ctx-note">
        口径：KPI / Token / 耗时 / 事件 / 趋势 / 文件活动都按 trace 的「尾部窗口」折叠
        （超大会话只统计近段，避免每 3 秒读上百 MB；老 trace 的窗口更小）；
        「只有 Agent 网络」按 mtime 缓存做全文扫描。两者范围不同，数值不必逐项相等。
      </p>
    </div>
  );
}

function TokenStats({ trace }: { trace: any }) {
  const split = trace.tokenSplit || {};
  const parts = ALL_CATEGORIES.map((category) => ({ ...category, value: Number(split[category.key]) || 0 }));
  const inputTotal = CATEGORIES.reduce((sum, category) => sum + (Number(split[category.key]) || 0), 0);
  const output = Number(split.output) || 0;
  const total = inputTotal + output;
  return (
    <section className="dyw-ctx-card">
      <h4>Token 统计 <em className="dyw-ctx-note">分类为 ≈ 估算，合计与输出为真实用量</em></h4>
      <div className="dyw-ctx-split">
        <span className="dyw-ctx-ring-slot"><Ring parts={parts} center={<><strong>{formatTokens(total)}</strong><span>总用量</span></>} /></span>
        <div className="dyw-ctx-legend">
          {parts.filter((part) => part.value > 0).sort((a, b) => b.value - a.value).map((part) => (
            <LegendRow
              key={part.key}
              label={part.label}
              color={part.color}
              value={`≈${formatTokens(part.value)}`}
              percent={total ? formatPercent(part.value / total) : ""}
              note={part.key === "output" ? `${formatTokens(part.value)} · 含思考${Number(trace.counts?.reasoning) ? ` ${formatTokens(trace.counts.reasoning)}` : ""}` : undefined}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function TimingStats({ trace }: { trace: any }) {
  const timing = trace.timing || {};
  const parts = TIMING_PARTS.map((part) => ({ ...part, value: Number(timing[part.key]) || 0 }));
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  const requestCount = Number(trace.counts?.requestCount) || 0;
  const throughput = Number(timing.throughput);
  return (
    <section className="dyw-ctx-card">
      <h4>耗时统计 <em className="dyw-ctx-note">活跃时长 {formatDuration(timing.spanMs)}（含等待，非纯生成）</em></h4>
      <div className="dyw-ctx-split">
        <span className="dyw-ctx-ring-slot"><Ring parts={parts} center={<><strong>{formatDuration(timing.waitMs + timing.generateMs + timing.toolMs)}</strong><span>活跃时长</span></>} /></span>
        <div className="dyw-ctx-legend">
          {parts.map((part) => (
            <LegendRow key={part.key} label={part.label} color={part.color} value={formatDuration(part.value)} percent={formatPercent(part.value / total)} />
          ))}
          <LegendRow label="吞吐量" color="#94a3b8" value={Number.isFinite(throughput) && throughput > 0 ? `${throughput.toFixed(1)} tok/s` : "未记录"} note="输出 token / 生成时长" />
        </div>
      </div>
      {requestCount ? <RequestStrip trace={trace} /> : null}
    </section>
  );
}

/** 每次请求的耗时（真实时长）：ECharts 堆叠柱 = 等待 / 生成 / 其他，带缩放条 */
function RequestStrip({ trace }: { trace: any }) {
  const requests: any[] = trace.requests || [];
  const option = React.useMemo(() => {
    const labels = requests.map((request) => `#${request.seq}`);
    const pick = (field: string, fallback: (request: any) => number) => requests.map((request) => {
      const value = Number(request[field]);
      return Number.isFinite(value) ? value : fallback(request);
    });
    const wait = pick("firstTokenMs", () => 0);
    const generate = pick("generationMs", () => 0);
    const other = requests.map((request, index) => Math.max(0, (Number(request.durationMs) || 0) - wait[index] - generate[index]));
    return {
      animation: false,
      grid: { left: 44, right: 10, top: 8, bottom: 26 },
      tooltip: {
        trigger: "axis",
        formatter: (items: any[]) => {
          const index = items?.[0]?.dataIndex ?? 0;
          const request = requests[index] || {};
          return [
            `请求 #${request.seq} · 第 ${request.turn} 轮第 ${request.step + 1} 步`,
            `总计 ${formatDuration(request.durationMs)}`,
            `等待 ${formatDuration(wait[index])} · 生成 ${formatDuration(generate[index])} · 其他 ${formatDuration(other[index])}`,
            `${request.model || ""} ${formatClock(request.time)}`,
          ].join("<br/>");
        },
      },
      xAxis: { type: "category", data: labels, axisLabel: { show: false }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { formatter: (value: number) => formatDuration(value), fontSize: 9 } },
      dataZoom: [{ type: "slider", height: 12, bottom: 4, brushSelect: false }],
      series: [
        { name: "等待", type: "bar", stack: "ms", data: wait, itemStyle: { color: "#2f6fed" }, barCategoryGap: "10%" },
        { name: "生成", type: "bar", stack: "ms", data: generate, itemStyle: { color: "#8b5cf6" } },
        { name: "其他", type: "bar", stack: "ms", data: other, itemStyle: { color: "#6b7280" } },
      ],
    };
  }, [requests]);
  if (!requests.length) return null;
  return <EChart className="dyw-ctx-strip-chart" option={option} height={92} />;
}

// ── 当前上下文 ────────────────────────────────────────────────────
function CurrentContext({ detail }: { detail: any }) {
  const session = detail.session || {};
  const requests: any[] = detail.trace?.requests || [];
  const lastRequest = requests[requests.length - 1];
  const merged = mergeCurrent(detail.timeline?.current, lastRequest);
  const windowTokens = Number(session.contextTokens) || 0;
  if (!merged) return <p className="dyw-ctx-empty">还没有上下文投影（会话里发一条消息就有了）。</p>;
  const total = merged.total || 0;
  return (
    <section className="dyw-ctx-card">
      <h4>当前上下文 <em className="dyw-ctx-note">{session.model || "模型未知"} · ≈ 估算口径</em></h4>
      <div className="dyw-ctx-current-head">
        <strong>{formatTokens(total)} / {windowTokens ? formatTokens(windowTokens) : "?"} tokens</strong>
        <span className="dyw-ctx-current-ratio">{windowTokens ? `${Math.round((total / windowTokens) * 100)}% 上下文已用` : ""}</span>
      </div>
      <StackBar parts={CATEGORIES.map((category) => ({ key: category.key, value: merged[category.key] }))} total={total} windowTokens={windowTokens} />
      <div className="dyw-ctx-legend two-col">
        {CATEGORIES.map((category) => (
          <LegendRow
            key={category.key}
            label={category.label}
            color={category.color}
            value={`≈${formatTokens(merged[category.key])}`}
            percent={total ? formatPercent(merged[category.key] / total) : ""}
          />
        ))}
      </div>
      <p className="dyw-ctx-note">
        系统提示词 / 工具定义按请求载荷估算（工具定义由主进程在请求时记录，见 trace 的 context 字段）；
        工具定义缺失时按未记录处理，不编数。
      </p>
    </section>
  );
}

// ── 上下文浏览器（当前 / 比前步 / 比前轮）────────────────────────
function ContextBrowser({ sessionId, requests }: { sessionId: string; requests: any[] }) {
  const [data, setData] = React.useState<any>(null);
  const [error, setError] = React.useState("");
  const [mode, setMode] = React.useState<"current" | "step" | "turn">("current");
  const [openCategory, setOpenCategory] = React.useState<string>("");
  const [expanded, setExpanded] = React.useState<number | null>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(BROWSER_ROUTE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const payload = await response.json();
        if (cancelled) return;
        if (!payload?.ok) { setError(String(payload?.error || `接口返回 ${response.status}`)); return; }
        setData(payload.value);
      } catch (fetchError: any) {
        if (!cancelled) setError(String(fetchError?.message || fetchError));
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  if (error) return <p className="dyw-ctx-empty">{error}</p>;
  if (!data) return <p className="dyw-ctx-empty">正在读取上下文元素…</p>;

  const elements: any[] = data.elements || [];
  const last = requests[requests.length - 1];
  const prevStep = requests[requests.length - 2];
  const prevTurnLast = [...requests].reverse().find((request) => request.turn !== last?.turn);
  // 会话消息里不含 system，主进程记的消息数含 system：减 1 对齐下标
  const offset = 1;
  const boundaryOf = (request: any) => {
    const count = Number(request?.context?.messages);
    if (!Number.isFinite(count) || count <= 0) return null;
    return Math.max(0, count - offset);
  };
  const currentBoundary = boundaryOf(last);
  const baselineBoundary = mode === "current" ? null : mode === "step" ? boundaryOf(prevStep) : boundaryOf(prevTurnLast);
  // 没有边界信息（老 trace 没记消息数）时退化为"全部都在窗口里"，不假装能算 diff
  const inWindow = (element: any, boundary: number | null) => (boundary === null ? true : element.index < boundary);
  const isNew = (element: any) => mode === "current"
    ? false
    : baselineBoundary === null
      ? false
      : !inWindow(element, baselineBoundary) && inWindow(element, currentBoundary);
  const isDropped = (element: any) => mode === "current"
    ? false
    : baselineBoundary === null || currentBoundary === null
      ? false
      : inWindow(element, baselineBoundary) && !inWindow(element, currentBoundary);
  const needle = query.trim().toLowerCase();
  const matches = (element: any) => !needle
    || `${element.text || ""}\n${element.reasoning || ""}\n${element.tool || ""}`.toLowerCase().includes(needle);

  const rows = CATEGORIES.map((category) => {
    const list = elements.filter((element) => element.category === category.key && matches(element));
    const fresh = list.filter(isNew);
    const dropped = list.filter(isDropped);
    return {
      key: category.key,
      label: category.label,
      color: category.color,
      count: list.length,
      tokens: list.reduce((sum, element) => sum + (element.tokens || 0), 0),
      newCount: fresh.length,
      newTokens: fresh.reduce((sum, element) => sum + (element.tokens || 0), 0),
      droppedCount: dropped.length,
      droppedTokens: dropped.reduce((sum, element) => sum + (element.tokens || 0), 0),
      list,
    };
  }).filter((row) => row.count > 0);

  const expandedRow = rows.find((row) => row.key === openCategory);
  const totalTokens = elements.reduce((sum, element) => sum + (element.tokens || 0), 0);
  const addedTotal = elements.filter(isNew);
  const droppedTotal = elements.filter(isDropped);
  // 压缩/剪枝会替换或重建消息：消息数变少时，掉出窗口的元素就是被移出的部分
  const compactionDrop = currentBoundary !== null && baselineBoundary !== null && currentBoundary < baselineBoundary;

  return (
    <div className="dyw-ctx-browser">
      <div className="dyw-ctx-toolbar">
        {([["current", "当前（下一次请求）"], ["step", "比前步"], ["turn", "比前轮"]] as const).map(([key, label]) => (
          <button key={key} type="button" className={`dyw-ctx-chip ${mode === key ? "on" : ""}`} onClick={() => setMode(key)}>
            {label}
          </button>
        ))}
        <span className="dyw-ctx-toolbar-gap" />
        <span className="dyw-ctx-note">
          {mode === "current"
            ? `${elements.length} 项 · ≈${formatTokens(totalTokens)} tok`
            : `新增 ${addedTotal.length} 项 · ≈${formatTokens(addedTotal.reduce((sum, element) => sum + (element.tokens || 0), 0))} tok`
              + (compactionDrop
                ? ` ｜ 移出 ${droppedTotal.length} 项 · ≈−${formatTokens(droppedTotal.reduce((sum, element) => sum + (element.tokens || 0), 0))} tok（窗口从 ${baselineBoundary} 条缩到 ${currentBoundary} 条）`
                : "")}
        </span>
      </div>
      <input className="dyw-ctx-search" value={query} placeholder="在元素正文里搜索" onChange={(event) => setQuery(event.target.value)} />
      <ul className="dyw-ctx-catlist">
        {rows.map((row) => (
          <li key={row.key}>
            <button type="button" className="dyw-ctx-catrow" onClick={() => { setOpenCategory(openCategory === row.key ? "" : row.key); setExpanded(null); }}>
              <span className="dyw-ctx-caret">{openCategory === row.key ? "▾" : "▸"}</span>
              <i style={{ background: row.color }} />
              <span className="dyw-ctx-legend-name">{row.label}</span>
              <span className="dyw-ctx-list-meta">{row.count} 项</span>
              {mode !== "current" && row.newCount ? <span className="dyw-ctx-delta up">+{row.newCount}</span> : null}
              {mode !== "current" && row.droppedCount ? <span className="dyw-ctx-delta down">−{row.droppedCount}</span> : null}
              <span className="dyw-ctx-list-meta">≈{formatTokens(row.tokens)}</span>
              {mode !== "current" && row.newTokens ? <span className="dyw-ctx-delta up">+{formatTokens(row.newTokens)}</span> : null}
              {mode !== "current" && row.droppedTokens ? <span className="dyw-ctx-delta down">−{formatTokens(row.droppedTokens)}</span> : null}
            </button>
            {expandedRow?.key === row.key ? (
              <ul className="dyw-ctx-elements">
                {row.list.map((element: any) => (
                  <li key={element.index}>
                    <button type="button" className="dyw-ctx-element" onClick={() => setExpanded(expanded === element.index ? null : element.index)}>
                      <span className={`dyw-ctx-tag cat-${element.category}`}>#{element.index}</span>
                      <span className="dyw-ctx-list-meta">≈{formatTokens(element.tokens)} tok{element.tool ? ` · ${element.tool}` : ""}</span>
                      {isNew(element) && mode !== "current" ? <span className="dyw-ctx-delta up">新增</span> : null}
                      {isDropped(element) && mode !== "current" ? <span className="dyw-ctx-delta down">已移出</span> : null}
                      <span className="dyw-ctx-list-text">{expanded === element.index ? "收起" : oneLine(element.text) || "（无正文）"}</span>
                    </button>
                    {expanded === element.index ? (
                      <div className="dyw-ctx-element-body">
                        {element.reasoning ? <div className="dyw-ctx-element-reasoning"><b>思考</b>{element.reasoning}</div> : null}
                        <pre>{element.text || "（无正文）"}</pre>
                        {element.truncated ? <span className="dyw-ctx-list-meta">正文过长，已截断</span> : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── 上下文事件 ────────────────────────────────────────────────────
function ContextEvents({ events }: { events: any[] }) {
  const [kind, setKind] = React.useState("all");
  const counts = EVENT_KINDS.reduce((acc, item) => {
    acc[item.key] = events.filter((event) => event.kind === item.key).length;
    return acc;
  }, {} as Record<string, number>);
  const visible = events.filter((event) => kind === "all" || event.kind === kind).slice(-120).reverse();
  return (
    <div className="dyw-ctx-events">
      <div className="dyw-ctx-toolbar">
        <button type="button" className={`dyw-ctx-chip ${kind === "all" ? "on" : ""}`} onClick={() => setKind("all")}>全部 {events.length}</button>
        {EVENT_KINDS.map((item) => (
          <button key={item.key} type="button" className={`dyw-ctx-chip ${kind === item.key ? "on" : ""}`} onClick={() => setKind(item.key)}>
            {item.label} {counts[item.key] || 0}
          </button>
        ))}
      </div>
      {visible.length ? (
        <ul className="dyw-ctx-list">
          {visible.map((event, index) => (
            <li key={`${event.at}-${index}`}>
              <span className={`dyw-ctx-tag ${event.kind}`}>{EVENT_KINDS.find((item) => item.key === event.kind)?.label || event.kind}</span>
              {event.producer ? <span className="dyw-ctx-tag producer">{event.producer}</span> : null}
              <span className="dyw-ctx-list-meta">第 {event.turn} 轮 · 第 {event.step + 1} 步 · {formatClock(event.at)}</span>
              {event.delta ? <span className={`dyw-ctx-delta ${event.delta > 0 ? "up" : "down"}`}>{event.delta > 0 ? "+" : ""}{formatTokens(event.delta)}</span> : null}
              <span className="dyw-ctx-list-text">{oneLine(event.detail, 160)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dyw-ctx-empty">
          {kind === "all"
            ? "这一类还没有事件（聚焦到子 Agent 时，它的事件可能不在 trace 尾部窗口内）。"
            : "这一类还没有事件。"}
        </p>
      )}
    </div>
  );
}

// ── 文件活动 ──────────────────────────────────────────────────────
function FileActivity({ fileOps }: { fileOps: any[] }) {
  const [kind, setKind] = React.useState("all");
  const [sort, setSort] = React.useState<"ops" | "recent" | "path">("ops");
  const [query, setQuery] = React.useState("");
  const totals = FILE_KINDS.reduce((acc, item) => {
    acc[item.key] = fileOps.reduce((sum, entry) => sum + (entry[item.key] || 0), 0);
    return acc;
  }, {} as Record<string, number>);
  const needle = query.trim().toLowerCase();
  const visible = fileOps
    .filter((entry) => (kind === "all" || entry[kind] > 0) && (!needle || String(entry.path).toLowerCase().includes(needle)))
    .sort((a, b) => sort === "ops"
      ? b.ops - a.ops
      : sort === "recent"
        ? String(b.lastAt).localeCompare(String(a.lastAt))
        : String(a.path).localeCompare(String(b.path)));
  const totalAdded = fileOps.reduce((sum, entry) => sum + (entry.added || 0), 0);
  const totalRemoved = fileOps.reduce((sum, entry) => sum + (entry.removed || 0), 0);
  return (
    <div className="dyw-ctx-files">
      <div className="dyw-ctx-toolbar">
        <button type="button" className={`dyw-ctx-chip ${kind === "all" ? "on" : ""}`} onClick={() => setKind("all")}>全部 {fileOps.length}</button>
        {FILE_KINDS.map((item) => (
          <button key={item.key} type="button" className={`dyw-ctx-chip ${kind === item.key ? "on" : ""}`} onClick={() => setKind(item.key)}>
            {item.label} {totals[item.key] || 0}
          </button>
        ))}
        <span className="dyw-ctx-toolbar-gap" />
        {([["ops", "按次数"], ["recent", "按最近"], ["path", "按路径"]] as const).map(([key, label]) => (
          <button key={key} type="button" className={`dyw-ctx-chip ${sort === key ? "on" : ""}`} onClick={() => setSort(key)}>{label}</button>
        ))}
      </div>
      <div className="dyw-ctx-toolbar">
        <span className="dyw-ctx-list-meta">
          {fileOps.length} 个文件 · <b className="up">+{totalAdded}</b> <b className="down">−{totalRemoved}</b> 行
        </span>
        <span className="dyw-ctx-toolbar-gap" />
        <input className="dyw-ctx-search inline" value={query} placeholder="按路径过滤" onChange={(event) => setQuery(event.target.value)} />
      </div>
      {visible.length ? (
        <ul className="dyw-ctx-list">
          {visible.slice(0, 80).map((entry) => (
            <li key={entry.path} title={entry.path}>
              <span className="dyw-ctx-list-meta ops">{entry.ops}</span>
              {FILE_KINDS.filter((item) => entry[item.key] > 0).map((item) => (
                <span key={item.key} className={`dyw-ctx-tag file-${item.key}`}>{item.label} {entry[item.key]}</span>
              ))}
              {entry.added ? <span className="dyw-ctx-delta up">+{entry.added}</span> : null}
              {entry.removed ? <span className="dyw-ctx-delta down">−{entry.removed}</span> : null}
              <span className="dyw-ctx-list-text mono">{entry.path}</span>
              <span className="dyw-ctx-list-meta">{formatClock(entry.lastAt)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="dyw-ctx-empty">这次会话还没有文件活动。</p>}
    </div>
  );
}

// ── Agent 网络 ────────────────────────────────────────────────────
function AgentNetwork({ agents, session, onPick }: { agents: any[]; session: any; onPick?: (agent: any) => void }) {
  const [selected, setSelected] = React.useState<string>("main");
  React.useEffect(() => { onPick?.(list0(agents, selected)); }, [selected]);
  const list = agents?.length ? agents : [];
  if (list.length <= 1) {
    return <p className="dyw-ctx-empty">这次会话没有子 Agent（单 Agent 运行）。</p>;
  }
  const windowTokens = Number(session.contextTokens) || 0;
  const main = list[0];
  const children = list.slice(1);
  const current = list.find((agent) => agent.id === selected) || main;
  const width = 560;
  const height = 220 + (children.length > 4 ? 60 : 0);
  const columns = Math.min(children.length, 5);
  return (
    <div className="dyw-ctx-network">
      <div className="dyw-ctx-toolbar">
        <span className="dyw-ctx-chip on">{list.length} 个 Agent</span>
        <span className="dyw-ctx-chip">上下文合计 {formatTokens(list.reduce((sum, agent) => sum + (agent.prompt || 0), 0))}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="dyw-ctx-graph" role="img" aria-label="Agent 网络">
        {children.map((child, index) => {
          const x = ((index + 0.5) / columns) * width;
          return <line key={child.id} x1={width / 2} y1={92} x2={x} y2={160} stroke={index % 2 ? "#3fb27f" : "#e04b4b"} strokeWidth="1.5" opacity="0.7" />;
        })}
        <g className="node main" onClick={() => { setSelected("main"); onPick?.(main); }} style={{ cursor: "pointer" }}>
          <circle cx={width / 2} cy={62} r={30} fill="none" stroke="var(--border)" strokeWidth="8" />
          <circle
            cx={width / 2}
            cy={62}
            r={30}
            fill="none"
            stroke="#2f6fed"
            strokeWidth="8"
            strokeDasharray={`${Math.min(1, windowTokens ? (main.prompt || 0) / windowTokens : 0.2) * 2 * Math.PI * 30} ${2 * Math.PI * 30}`}
            transform={`rotate(-90 ${width / 2} 62)`}
          />
          <text x={width / 2} y={66} textAnchor="middle" className="dyw-ctx-graph-value">
            {windowTokens ? `${Math.round(Math.min(1, (main.prompt || 0) / windowTokens) * 100)}%` : "—"}
          </text>
          <text x={width / 2} y={112} textAnchor="middle" className="dyw-ctx-graph-label">{oneLine(main.title || "本会话", 24)}</text>
          <text x={width / 2} y={130} textAnchor="middle" className="dyw-ctx-graph-meta">{formatTokens(main.prompt || 0)} tok</text>
        </g>
        {children.map((child, index) => {
          const x = ((index + 0.5) / columns) * width;
          const share = main.prompt ? Math.min(1, (child.prompt || 0) / main.prompt) : 0;
          return (
            <g key={child.id} className="node" onClick={() => { setSelected(child.id); onPick?.(child); }} style={{ cursor: "pointer" }}>
              <circle cx={x} cy={192} r={22} fill="none" stroke="var(--border)" strokeWidth="6" />
              <circle cx={x} cy={192} r={22} fill="none" stroke={index % 2 ? "#3fb27f" : "#e04b4b"} strokeWidth="6"
                strokeDasharray={`${Math.max(0.05, share) * 2 * Math.PI * 22} ${2 * Math.PI * 22}`} transform={`rotate(-90 ${x} 192)`} />
              <text x={x} y={196} textAnchor="middle" className="dyw-ctx-graph-value">{Math.round(share * 100)}%</text>
              <text x={x} y={232} textAnchor="middle" className="dyw-ctx-graph-label">{oneLine(child.title || "子 Agent", 22)}</text>
              <text x={x} y={248} textAnchor="middle" className="dyw-ctx-graph-meta">{formatTokens(child.prompt || 0)} tok</text>
            </g>
          );
        })}
      </svg>
      <div className="dyw-ctx-network-footer">
        <b>{oneLine(current.title, 28)}</b>
        <span className="dyw-ctx-list-meta">
          {formatTokens(current.prompt || 0)} tok 输入 · {formatTokens(current.completion || 0)} 输出 · {current.requests} 次请求 · {formatClock(current.firstAt)} → {formatClock(current.lastAt)}
        </span>
        <span className="dyw-ctx-list-meta">子 Agent 与主 Agent 在同一个会话里（按 trace 的 depth 分支分组）</span>
      </div>
    </div>
  );
}

// ── 趋势（DNA 堆叠 / 全量·增量 / 步骤·轮次）──────────────────────
function ContextTrend({ requests }: { requests: any[] }) {
  const [mode, setMode] = React.useState<"dna" | "plain">("dna");
  const [scale, setScale] = React.useState<"total" | "delta">("total");
  const [granularity, setGranularity] = React.useState<"step" | "turn">("step");
  const [pinned, setPinned] = React.useState<number | null>(null);
  const [hovered, setHovered] = React.useState<number | null>(null);
  const active = pinned !== null ? pinned : hovered;
  if (!requests?.length) {
    return <p className="dyw-ctx-empty">还没有请求记录（聚焦到子 Agent 时，它的请求可能在 trace 尾部窗口之外——只有 Agent 网络是全文扫描）。</p>;
  }

  const points = granularity === "step"
    ? requests.map((request) => ({ key: `${request.runId}-${request.seq}`, request, label: `#${request.seq}`, split: request.split || {}, total: request.splitTotal || request.prompt || 0 }))
    : Object.values(requests.reduce((acc: Record<string, any>, request) => {
        const entry = acc[request.turn] || { key: `turn-${request.turn}`, label: `第 ${request.turn} 轮`, split: {}, total: 0, requests: 0, turn: request.turn };
        for (const category of CATEGORIES) entry.split[category.key] = (entry.split[category.key] || 0) + (Number(request.split?.[category.key]) || 0);
        entry.total += Number(request.splitTotal || request.prompt || 0);
        entry.requests += 1;
        acc[request.turn] = entry;
        return acc;
      }, {})).sort((a: any, b: any) => a.turn - b.turn);

  const values = points.map((point: any, index: number) => {
    if (scale === "total") return { ...point, display: point.total, negative: false };
    const previous = points[index - 1];
    const previousTotal = previous ? previous.total : 0;
    const delta = point.total - previousTotal;
    return { ...point, display: Math.abs(delta), negative: delta < 0, delta };
  });
  // ECharts 堆叠柱：全量 = 各类构成（DNA），增量 = 相对上一步的净变化（负值向下）
  const trendOption = React.useMemo(() => {
    const labels = values.map((point: any) => point.label);
    const series = scale === "delta"
      ? [{
          name: "变化",
          type: "bar",
          data: values.map((point: any) => (point.negative ? -point.display : point.display)),
          itemStyle: { color: (params: any) => (Number(params.value) < 0 ? "#e04b4b" : "#2f6fed") },
        }]
      : (mode === "dna"
        ? CATEGORIES.map((category) => ({
            name: category.label,
            type: "bar",
            stack: "total",
            data: values.map((point: any) => Number(point.split?.[category.key]) || 0),
            itemStyle: { color: category.color },
          }))
        : [{ name: "上下文", type: "bar", data: values.map((point: any) => point.total), itemStyle: { color: "#2f6fed" } }]);
    return {
      animation: false,
      grid: { left: 48, right: 10, top: mode === "dna" ? 28 : 10, bottom: 24 },
      legend: mode === "dna" && scale === "total" ? { top: 2, itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 10 } } : undefined,
      tooltip: {
        trigger: "axis",
        formatter: (items: any[]) => {
          const index = items?.[0]?.dataIndex ?? 0;
          const point: any = values[index] || {};
          return [
            `${point.label}${scale === "delta" ? "（相对上一步）" : ""}`,
            `≈${formatTokens(point.display)} tok`,
            point.request ? `第 ${point.request.turn} 轮第 ${point.request.step + 1} 步 · ${point.request.model || ""}` : `${point.requests || 0} 次请求`,
          ].join("<br/>");
        },
      },
      xAxis: { type: "category", data: labels, axisLabel: { fontSize: 9, interval: Math.max(0, Math.floor(labels.length / 24)), hideOverlap: true }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { fontSize: 9, formatter: (value: number) => formatTokens(Math.abs(value)) }, splitLine: { lineStyle: { opacity: 0.25 } } },
      dataZoom: labels.length > 60 ? [{ type: "inside" }] : undefined,
      series,
    };
  }, [values, mode, scale]);

  return (
    <div className="dyw-ctx-trend-wrap">
      <div className="dyw-ctx-toolbar">
        <button type="button" className={`dyw-ctx-chip ${mode === "dna" ? "on" : ""}`} onClick={() => setMode("dna")}>DNA 模式</button>
        <button type="button" className={`dyw-ctx-chip ${mode === "plain" ? "on" : ""}`} onClick={() => setMode("plain")}>单色</button>
        <span className="dyw-ctx-toolbar-gap" />
        {([["step", "步骤"], ["turn", "轮次"]] as const).map(([key, label]) => (
          <button key={key} type="button" className={`dyw-ctx-chip ${granularity === key ? "on" : ""}`} onClick={() => setGranularity(key)}>{label}</button>
        ))}
        {([["total", "全量"], ["delta", "增量"]] as const).map(([key, label]) => (
          <button key={key} type="button" className={`dyw-ctx-chip ${scale === key ? "on" : ""}`} onClick={() => setScale(key)}>{label}</button>
        ))}
      </div>
      <span className="dyw-ctx-trend-probe" data-hover={hovered ?? -1} data-pinned={pinned ?? -1} data-points={values.length} hidden />
      <EChart
        className="dyw-ctx-trend-chart"
        height={200}
        option={trendOption}
        onEvents={{
          click: (params: any) => {
            const index = Number(params?.dataIndex);
            if (Number.isFinite(index)) setPinned(pinned === index ? null : index);
          },
          mouseover: (params: any) => setHovered(Number(params?.dataIndex)),
          mousemove: (params: any) => {
            const index = Number(params?.dataIndex);
            if (Number.isFinite(index)) setHovered(index);
          },
          globalout: () => setHovered(null),
        }}
      />
      <div className="dyw-ctx-toolbar" />
      {active !== null && values[active] ? (
        <div className="dyw-ctx-pin">
          <div className="dyw-ctx-pin-head">
            <b>{values[active].label}</b>
            {pinned === null ? <span className="dyw-ctx-list-meta">预览（点柱子可固定）</span> : null}
            <span className="dyw-ctx-list-meta">
              {values[active].request
                ? `第 ${values[active].request.turn} 轮第 ${values[active].request.step + 1} 步 · ${values[active].request.model || "模型未知"} · ${formatClock(values[active].request.time)} · ${formatDuration(values[active].request.durationMs)}`
                : `${values[active].requests} 次请求`}
            </span>
            {values[active].request?.prompt !== null && values[active].request?.prompt !== undefined ? (
              <span className="dyw-ctx-list-meta">
                真实：输入 {formatTokens(values[active].request.prompt)} tok
                {values[active].request.cacheRead ? ` · 缓存命中 ${formatTokens(values[active].request.cacheRead)}` : ""}
                {` · 输出 ${formatTokens(values[active].request.completion || 0)}`}
                {values[active].request.reasoning ? ` · 推理 ${formatTokens(values[active].request.reasoning)}` : ""}
              </span>
            ) : null}
          </div>
          <div className="dyw-ctx-legend two-col">
            {CATEGORIES.map((category) => {
              const value = Number(values[active].split?.[category.key]) || 0;
              return <LegendRow key={category.key} label={category.label} color={category.color} value={`≈${formatTokens(value)}`} percent={values[active].total ? formatPercent(value / values[active].total) : ""} />;
            })}
          </div>
          {pinned !== null ? <button type="button" className="dyw-ctx-chip" onClick={() => setPinned(null)}>取消固定</button> : null}
        </div>
      ) : null}
      <p className="dyw-ctx-note">
        每根柱子是一次请求（或一轮）的构成；构成按体积比例分摊真实输入 token（≈），
        「增量」显示相对上一步的变化（负值向下）。<b>点柱子可固定明细</b>（真实用量 + 分类构成）。
      </p>
    </div>
  );
}

// ── 插件信息卡 ────────────────────────────────────────────────────
function PluginInfoCard({ plugin }: { plugin: any }) {
  return (
    <section className="dyw-ctx-card plugin-info">
      <h4>插件信息 <em className="dyw-ctx-note">自研内置插件</em></h4>
      <div className="dyw-ctx-info-row"><span>插件</span><b>{plugin?.name || "dyworker-context"} {plugin?.version ? `(v${plugin.version})` : ""}</b></div>
      <div className="dyw-ctx-info-row"><span>位置</span><b>会话区标签 + 右侧面板 + 仪表盘</b></div>
      <div className="dyw-ctx-info-row"><span>路由</span><b>/detail · /browser · /balance</b></div>
      <p className="dyw-ctx-note">{plugin?.description || "上下文洞察：构成、趋势、事件、文件活动、Agent 网络"}</p>
    </section>
  );
}

// ── 会话区「上下文」标签 ─────────────────────────────────────────
export interface ContextViewProps {
  sessionId?: string;
  session?: { messages?: unknown[] } | null;
  variant?: "tab" | "panel";
}

export function ContextView(props: ContextViewProps) {
  const sessionId = String(props.sessionId || "");
  const variant = props.variant || "tab";
  const { detail, error, loading } = useDetail(sessionId);
  // 注意：hook 必须在提前 return 之前——放到 return 之后会变成"两次渲染的 hook 数量不同"（实测直接崩）
  const [focusedAgent, setFocusedAgent] = React.useState<string>("main");

  if (!sessionId) return <p className="plugins-empty">先选一个会话。</p>;
  if (error) return <p className="plugins-empty">上下文数据没取到：{error}</p>;
  if (!detail) return <p className="plugins-empty">{loading ? "正在读取上下文…" : "还没有数据。"}</p>;

  const session = detail.session || {};
  const trace = detail.trace || {};
  const requests: any[] = trace.requests || [];
  // 点 Agent 节点后，趋势/事件聚焦到那个 Agent（主 Agent = 无 branchId 的请求/事件）
  const agentRequests = requests.filter((request) => (focusedAgent === "main" ? !request.branchId : request.branchId === focusedAgent));
  const agentEvents = (trace.events || []).filter((event: any) => (focusedAgent === "main" ? !event.branchId : event.branchId === focusedAgent));

  return (
    <div className={`dyw-ctx ${variant === "panel" ? "panel" : "tab"}`}>
      <div className="dyw-ctx-head">
        <strong>{session.title || "（无标题会话）"}</strong>
        <span className="dyw-ctx-head-meta">
          {session.model || "模型未知"} · 窗口 {formatTokens(session.contextTokens)} tok · 更新于 {formatClock(session.updatedAt)}
        </span>
      </div>

      <StatsBand detail={detail} />

      <div className="dyw-ctx-columns">
        <TokenStats trace={trace} />
        <TimingStats trace={trace} />
      </div>

      <div className="dyw-ctx-columns">
        <CurrentContext detail={detail} />
        <PluginInfoCard plugin={detail.plugin} />
      </div>

      <section className="dyw-ctx-card">
        <h4>上下文浏览器 <em className="dyw-ctx-note">当前 / 比前步 / 比前轮</em></h4>
        <ContextBrowser sessionId={sessionId} requests={requests} />
      </section>

      <div className="dyw-ctx-columns">
        <section className="dyw-ctx-card">
          <h4>
            上下文事件
            {focusedAgent !== "main" ? <em className="dyw-ctx-note">已聚焦：{list0(trace.agents || [], focusedAgent)?.title || focusedAgent}</em> : null}
          </h4>
          <ContextEvents events={agentEvents} />
        </section>
        <section className="dyw-ctx-card">
          <h4>文件活动 <em className="dyw-ctx-note">读取 / 写入 / 搜索 / 图片</em></h4>
          <FileActivity fileOps={trace.fileOps || []} />
        </section>
      </div>

      <section className="dyw-ctx-card">
        <h4>Agent 网络 <em className="dyw-ctx-note">主 Agent 与子 Agent（按 trace 分支）</em></h4>
        <AgentNetwork agents={trace.agents || []} session={session} onPick={(agent: any) => setFocusedAgent(agent?.id || "main")} />
      </section>

      <section className="dyw-ctx-card">
        <h4>
          上下文趋势
          {focusedAgent !== "main" ? <em className="dyw-ctx-note">已聚焦：{list0(trace.agents || [], focusedAgent)?.title || focusedAgent}（{agentRequests.length} 次请求）</em> : null}
        </h4>
        <ContextTrend requests={agentRequests.length ? agentRequests : requests} />
      </section>
    </div>
  );
}

// ── 跨会话仪表盘（右侧面板标签）────────────────────────────────
export function ContextDashboard(props: { openSession?: (sessionId: string) => void }) {
  const [days, setDays] = React.useState(7);
  const [sort, setSort] = React.useState<"recent" | "tokens">("recent");
  const [data, setData] = React.useState<any>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(BALANCE_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days: HEATMAP_DAYS }),
      });
      const payload = await response.json();
      if (!payload?.ok) { setError(String(payload?.error || `接口返回 ${response.status}`)); return; }
      setData(payload.value);
      setError("");
    } catch (fetchError: any) {
      setError(String(fetchError?.message || fetchError));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  if (error) return <p className="plugins-empty">仪表盘数据没取到：{error}</p>;
  if (!data) return <p className="plugins-empty">{loading ? "正在汇总跨会话用量…" : "还没有数据。"}</p>;

  const series: any[] = data.series || [];
  const slice = series.slice(-days);
  const totals = slice.reduce((sum, day) => ({
    prompt: sum.prompt + day.prompt,
    completion: sum.completion + day.completion,
    requests: sum.requests + day.requests,
    active: sum.active + (day.prompt || day.completion ? 1 : 0),
  }), { prompt: 0, completion: 0, requests: 0, active: 0 });
  const peak = Math.max(1, ...slice.map((day) => Math.max(day.prompt, day.completion)));
  const cards: any[] = [...(data.cards || [])];
  if (sort === "tokens") cards.sort((a, b) => (b.prompt + b.completion) - (a.prompt + a.completion));
  const groups: any[] = data.groups || [];
  // 热力图：列 = 周，行 = 星期几（周一在上），值 = 当日输入 token
  const heatOption = (() => {
    const max = Math.max(1, ...series.map((day: any) => day.prompt));
    const cells: Array<[number, number, number]> = [];
    const columns: string[] = [];
    const weekIndex = new Map<string, number>();
    for (const day of series) {
      const date = new Date(`${day.date}T00:00:00`);
      const key = `${date.getFullYear()}-${Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / (7 * 24 * 3600 * 1000))}`;
      if (!weekIndex.has(key)) {
        weekIndex.set(key, columns.length);
        columns.push(day.date.slice(5));
      }
      const weekday = (date.getDay() + 6) % 7; // 周一 = 0
      cells.push([weekIndex.get(key) as number, weekday, day.prompt]);
    }
    return {
      animation: false,
      grid: { left: 30, right: 8, top: 8, bottom: 22 },
      tooltip: {
        formatter: (params: any) => {
          const day: any = series[params.data?.[0] + (params.data?.[1] ?? 0) * 0] || null;
          return `${day?.date || ""}<br/>输入 ≈${formatTokens(params.data?.[2])} tok`;
        },
      },
      xAxis: { type: "category", data: columns, axisLabel: { fontSize: 8, hideOverlap: true }, axisTick: { show: false }, splitArea: { show: false } },
      yAxis: { type: "category", data: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"], axisLabel: { fontSize: 9 }, axisTick: { show: false } },
      visualMap: { min: 0, max, show: false, inRange: { color: ["#eef2f7", "#c7d7f5", "#8fb0ec", "#2f6fed"] } },
      series: [{ type: "heatmap", data: cells, itemStyle: { borderWidth: 1, borderColor: "transparent" }, emphasis: { itemStyle: { borderColor: "var(--ink)" } } }],
    };
  })();

  return (
    <div className="dyw-ctx dash">
      <div className="dyw-ctx-head">
        <strong>上下文仪表盘</strong>
        <span className="dyw-ctx-head-meta">跨会话用量与上下文构成 · {data.range?.days} 天窗口 · {data.totals?.note || ""}</span>
      </div>

      <div className="dyw-ctx-toolbar">
        {[7, 30, 56].map((value) => (
          <button key={value} type="button" className={`dyw-ctx-chip ${days === value ? "on" : ""}`} onClick={() => setDays(value)}>
            {value === 56 ? "8 周" : `${value} 天`}
          </button>
        ))}
        <span className="dyw-ctx-toolbar-gap" />
        <button type="button" className={`dyw-ctx-chip ${sort === "recent" ? "on" : ""}`} onClick={() => setSort("recent")}>按最近</button>
        <button type="button" className={`dyw-ctx-chip ${sort === "tokens" ? "on" : ""}`} onClick={() => setSort("tokens")}>按用量</button>
        <button type="button" className="dyw-ctx-chip" onClick={() => { setData(null); void load(); }}>刷新</button>
      </div>

      <div className="dyw-ctx-kpis">
        <Kpi label="会话数" value={String(data.totals?.sessions ?? 0)} />
        <Kpi label={`输入 token（${days} 天）`} value={formatTokens(totals.prompt)} />
        <Kpi label="输出 token" value={formatTokens(totals.completion)} />
        <Kpi label="请求数" value={String(totals.requests)} />
        <Kpi label="活跃天数" value={`${totals.active}/${days}`} />
      </div>

      <section className="dyw-ctx-card">
        <h4>每日用量（输入 / 输出）</h4>
        <EChart
          height={200}
          option={{
            animation: false,
            grid: { left: 52, right: 12, top: 30, bottom: 24 },
            legend: { top: 2, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 10 } },
            tooltip: {
              trigger: "axis",
              formatter: (items: any[]) => {
                const index = items?.[0]?.dataIndex ?? 0;
                const day: any = slice[index] || {};
                return [`${day.date}`, `输入 ≈${formatTokens(day.prompt)} tok`, `输出 ≈${formatTokens(day.completion)} tok`, `请求 ${day.requests} · 会话 ${day.sessions}`].join("<br/>");
              },
            },
            xAxis: { type: "category", data: slice.map((day: any) => day.date.slice(5)), axisLabel: { fontSize: 9, hideOverlap: true }, axisTick: { show: false } },
            yAxis: { type: "value", axisLabel: { fontSize: 9, formatter: (value: number) => formatTokens(value) }, splitLine: { lineStyle: { opacity: 0.25 } } },
            series: [
              { name: "输入", type: "bar", data: slice.map((day: any) => day.prompt), itemStyle: { color: "#2f6fed" } },
              { name: "输出", type: "bar", data: slice.map((day: any) => day.completion), itemStyle: { color: "#8b5cf6" } },
            ],
          }}
        />
      </section>

      <section className="dyw-ctx-card">
        <h4>活跃热力图（8 周，按输入 token）</h4>
        <EChart
          height={150}
          option={heatOption}
        />
      </section>

      <section className="dyw-ctx-card">
        <h4>会话（{cards.length}）</h4>
        <div className="dyw-ctx-cards">
          {cards.slice(0, 60).map((card) => (
            <button
              key={card.id}
              type="button"
              className={`dyw-ctx-card-item ${card.pinned ? "pinned" : ""}`}
              title={`${card.title || "（无标题）"}\n${card.workspacePath || "（无工作区）"}\n输入 ${formatTokens(card.prompt)} tok · 输出 ${formatTokens(card.completion)} tok\n请求 ${card.requests} · 轮次 ${card.turns} · 窗口 ${formatTokens(card.contextTokens)}`}
              onClick={() => props.openSession?.(card.id)}
            >
              <span className="dyw-ctx-ring-slot mini">
                <Ring
                  size={46}
                  parts={CATEGORIES.map((category) => ({ ...category, value: Number(card.composition?.[category.key]) || 0 }))}
                />
              </span>
              <span className="dyw-ctx-card-text">
                <strong>{card.title || "（无标题会话）"}</strong>
                <em>{card.workspacePath ? card.workspacePath.split("/").filter(Boolean).pop() : "（无工作区）"} · {card.contextModel || "模型未知"}</em>
                <span className="dyw-ctx-list-meta">
                  {formatTokens(card.prompt + card.completion)} tok · {card.requests} 请求 · {card.turns} 轮 · {formatClock(card.updatedAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
        {groups.length ? (
          <p className="dyw-ctx-note">
            工作区分组：{groups.slice(0, 6).map((group) => `${group.name} ${formatTokens(group.prompt + group.completion)} tok/${group.cards.length} 会话`).join(" · ")}
          </p>
        ) : null}
      </section>
    </div>
  );
}
