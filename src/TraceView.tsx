// 原生轨迹视图（对齐 DSH 官方「轨迹」的观感与结构）。
//
// 为什么不用官方插件：官方那个组件要跑起来，得把 DSH 的客户端会话层、20+ 服务、会话事件总线
// 整套搬过来（实测就是靠仿造这层壳才勉强渲染）；收益不值这个代价，所以轨迹原生实现，
// 数据只来自我们自己的两处：TraceEvent 流（含落盘历史回放）与会话消息。
//
// 结构（照官方三段）：
//   工具栏    时长（实际时长 / 等宽）· 轮次（展开 / 收起所有轮次）· 调用（展开 / 收起所有调用）+ 搜索
//     ↓
//   时间条    三道泳道：输入（用户消息）/ 模型（一次请求，浅色=首 token 前，深色=生成）/ 工具（失败标红）
//     ↓
//   台账      轮次头 → 用户行 / 助手行（其下挂工具行）/ 标记行；点哪行右边就显示哪行的检查面板
//   检查面板  标题「助手 第 N 轮 · 第 M 步」，页签 概述 / 预览 / 原始内容；
//             概述里有 来源 / 状态 / Token + 可折叠的 预览（思考）与 请求计时
//             （开始时间 / 总时长 / 首 token 延迟 / 生成 / 吞吐量）
//
// 组件用 React.createElement 而不是 JSX：与仓库其它插件相关组件保持一致，便于 Node 侧测试。

import * as React from "react";
import type { TraceEvent } from "./types";
import {
  formatDuration,
  formatTokens,
  buildTraceModel,
  layoutTraceSpans,
  type TraceMarker,
  type TraceRequest,
  type TraceSpan,
  type TraceSpanLane,
  type TraceToolCall,
  type TraceTurn,
} from "./traceModel";

// 选中态用全局唯一键（runId#seq）：跨 run 时 seq 会重置，只用 seq 会同时点亮好几条记录
type Selection = { kind: "input" | "request" | "tool"; key: string; seq: number } | null;

const h = React.createElement;

/** 时间条三道（顺序即渲染顺序，官方也是这个顺序） */
const LANES: Array<{ id: TraceSpanLane; label: string }> = [
  { id: "input", label: "输入" },
  { id: "model", label: "模型" },
  { id: "tool", label: "工具" },
];
const LANE_STEP = 14; // 每道高度（官方 CSS 也是 14px 一道）

const BADGE: Record<string, string> = {
  input: "用户",
  assistant: "助手",
  tool: "工具",
  system: "系统",
  compaction: "已压缩",
  plan: "计划更新",
  file: "文件变更",
  end: "任务结束",
};

// —— 小工具 ——

/** 本地时刻（毫秒级），请求计时面板的「开始时间」按官方格式显示 */
function formatClock(value: string | null | undefined): string {
  const ms = Date.parse(String(value ?? ""));
  if (!Number.isFinite(ms)) return "未记录";
  const date = new Date(ms);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** 计时值：官方口径 <1s 显示毫秒、<10s 两位小数、更长一位小数；没有值就写官方那几句「不可用」 */
function formatTiming(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "未记录";
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)} 秒`;
  return `${(ms / 1000).toFixed(1)} 秒`;
}

/** 时刻范围（时间条 tooltip 用，毫秒级） */
function formatClockShort(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const date = new Date(ms);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function oneLine(text: string, limit = 200): string {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function firstLine(text: string, limit = 200): string {
  const line = String(text || "").split("\n").map((part) => part.trim()).filter(Boolean)[0] || "";
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}

/** 搜索：空格分词、全部命中才算命中（官方口径） */
function matches(needle: string, ...fields: Array<string | null | undefined>): boolean {
  const terms = needle.split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = fields.map((field) => String(field || "").toLowerCase()).join("\n");
  return terms.every((term) => haystack.includes(term));
}

function Icon({ path, size = 14 }: { path: string; size?: number }) {
  return h(
    "svg",
    { className: "trv-trace-icon", viewBox: "0 0 16 16", width: size, height: size, fill: "none", "aria-hidden": "true" },
    h("path", { d: path, stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" }),
  );
}

const ICON_CLOCK = "M8 3.2A4.8 4.8 0 1 1 3.2 8 4.8 4.8 0 0 1 8 3.2Zm0 2.2V8l2.2 1.4";
const ICON_TURNS = "M2.6 4.4h10.8M2.6 8h10.8M2.6 11.6h6.6";
const ICON_CALLS = "M3.4 4.5 5.6 6.7 3.4 8.9M6.6 9.4h6";
const ICON_SEARCH = "M7.2 3.2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm3 7 2.6 2.6";
const ICON_CARET = "M5.2 4.4 2.6 7l2.6 2.6M10.8 4.4 13.4 7l-2.6 2.6";
const ICON_CLOSE = "M4 4l8 8M12 4l-8 8";

// —— 工具栏 ——

function Toggle({
  icon,
  label,
  value,
  pressed,
  ariaLabel,
  hint,
  onClick,
}: {
  icon: string;
  label: string;
  value?: string;
  pressed: boolean;
  ariaLabel: string;
  hint: string;
  onClick: () => void;
}) {
  return h(
    "button",
    {
      type: "button",
      className: `trv-trace-toggle ${pressed ? "on" : ""}`,
      "aria-pressed": pressed,
      "aria-label": ariaLabel,
      title: hint,
      onClick,
    },
    h(Icon, { path: icon }),
    h("span", { className: "trv-trace-toggle-label" }, label),
    value ? h("span", { className: "trv-trace-toggle-value" }, value) : null,
  );
}

function Toolbar({
  metrics,
  markers,
  equalWidth,
  onEqualWidth,
  turnsCollapsed,
  onTurnsCollapsed,
  callsCollapsed,
  onCallsCollapsed,
  query,
  onQuery,
  onClose,
}: {
  metrics: { spanMs: number; activeMs: number; turns: number; calls: number; requests: number; promptTokens: number; completionTokens: number; models: string[]; tools: string[] };
  markers: TraceMarker[];
  equalWidth: boolean;
  onEqualWidth: (next: boolean) => void;
  turnsCollapsed: boolean;
  onTurnsCollapsed: (next: boolean) => void;
  callsCollapsed: boolean;
  onCallsCollapsed: (next: boolean) => void;
  query: string;
  onQuery: (next: string) => void;
  onClose?: () => void;
}) {
  const metricHint = [
    `生成时长 ${formatDuration(metrics.activeMs)}（墙钟 ${formatDuration(metrics.spanMs)}）`,
    `输入 ${formatTokens(metrics.promptTokens)} tok · 输出 ${formatTokens(metrics.completionTokens)} tok`,
    `模型 ${metrics.models.length ? metrics.models.join(" / ") : "—"}`,
    `工具 ${metrics.tools.length} 种`,
    `标记 ${markers.length}（压缩 ${markers.filter((marker) => marker.kind === "compaction").length} · 结束 ${markers.filter((marker) => marker.kind === "session-end").length} · 计划 ${markers.filter((marker) => marker.kind === "plan-update").length}）`,
  ].join("\n");

  return h(
    "div",
    { className: "trv-trace-toolbar", role: "toolbar", "aria-label": "轨迹工具栏" },
    h(
      "div",
      { className: "trv-trace-toolbar-actions" },
      h(Toggle, {
        icon: ICON_CLOCK,
        label: "时长",
        value: formatDuration(metrics.activeMs),
        // 官方语义：按下 = 用真实时长画块宽；默认按下（截图里就是这种宽度不等的画法）
        pressed: !equalWidth,
        ariaLabel: "使用实际时长",
        hint: `${metricHint}\n\n${equalWidth ? "当前：等宽操作（点一下按实际时长）" : "当前：实际时长（点一下改等宽）"}`,
        onClick: () => onEqualWidth(!equalWidth),
      }),
      h(Toggle, {
        icon: ICON_TURNS,
        label: "轮次",
        value: String(metrics.turns),
        pressed: turnsCollapsed,
        ariaLabel: turnsCollapsed ? "展开所有轮次" : "收起所有轮次",
        hint: turnsCollapsed ? "展开所有轮次" : "收起所有轮次",
        onClick: () => onTurnsCollapsed(!turnsCollapsed),
      }),
      h(Toggle, {
        icon: ICON_CALLS,
        label: "调用",
        value: String(metrics.calls),
        pressed: callsCollapsed,
        ariaLabel: callsCollapsed ? "展开所有调用" : "收起所有调用",
        hint: callsCollapsed ? "展开所有调用" : "收起所有调用",
        onClick: () => onCallsCollapsed(!callsCollapsed),
      }),
    ),
    h(
      "label",
      { className: "trv-trace-search" },
      h(Icon, { path: ICON_SEARCH, size: 13 }),
      h("input", {
        value: query,
        placeholder: "搜索",
        "aria-label": "搜索轨迹",
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => onQuery(event.target.value),
      }),
      query
        ? h("button", { type: "button", className: "trv-trace-clear", title: "清除", onClick: () => onQuery("") }, h(Icon, { path: ICON_CLOSE, size: 11 }))
        : null,
    ),
    onClose ? h("button", { type: "button", className: "trv-trace-close", title: "收起轨迹", onClick: onClose }, h(Icon, { path: ICON_CLOSE, size: 12 })) : null,
  );
}

// —— 时间条（三道泳道） ——

function Timeline({
  model,
  selection,
  onSelect,
  query,
  equalWidth,
}: {
  model: ReturnType<typeof buildTraceModel>;
  selection: Selection;
  onSelect: (next: Selection) => void;
  query: string;
  equalWidth: boolean;
}) {
  // 压缩空闲后的布局：长会话（隔天继续 / 等审批）才不会被空档压成一堆
  const layout = React.useMemo(() => layoutTraceSpans(model.spans, { compressIdle: true }), [model.spans]);
  if (!layout) return null;
  const span = Math.max(1, layout.endMs);
  const pct = (ms: number) => (ms / span) * 100;
  const needle = query.trim().toLowerCase();

  const isCurrent = (item: TraceSpan) =>
    selection?.kind === item.ref.kind && selection.key === item.ref.key;
  const spanMatches = (item: TraceSpan) => matches(needle, item.label);

  return h(
    "div",
    { className: "trv-trace-timeline" },
    h(
      "div",
      { className: "trv-trace-lane-labels", "aria-hidden": "true" },
      LANES.map((lane) => h("span", { key: lane.id, style: { top: `${LANES.indexOf(lane) * LANE_STEP + 3}px` } }, lane.label)),
    ),
    h(
      "div",
      { className: "trv-trace-lane-track", role: "list", "aria-label": "轨迹时间条" },
      model.turns.map((turn) => {
        const first = layout.items.find((entry) => entry.turn === turn.turn);
        if (!first) return null;
        return h("div", {
          key: `b-${turn.turn}`,
          className: "trv-trace-turn-boundary",
          style: { left: `${pct(first.offsetStartMs)}%` },
          title: `第 ${turn.turn} 轮`,
        });
      }),
      layout.items.map((item) => {
        const laneIndex = LANES.findIndex((lane) => lane.id === item.lane);
        const left = Math.max(0, Math.min(100, pct(item.offsetStartMs)));
        const widthPct = equalWidth ? 0.8 : Math.max(0.35, pct(item.offsetEndMs) - left);
        const ttft = item.offsetFirstTokenMs !== null && item.offsetEndMs > item.offsetStartMs
          ? Math.max(4, Math.min(96, ((item.offsetFirstTokenMs - item.offsetStartMs) / (item.offsetEndMs - item.offsetStartMs)) * 100))
          : null;
        const timing = item.firstTokenMs !== null
          ? ` · 首 token ${formatTiming(item.firstTokenMs - item.startMs)} · 生成 ${formatTiming(item.endMs - item.firstTokenMs)}`
          : "";
        return h("button", {
          key: item.id,
          type: "button",
          role: "listitem",
          className: "trv-trace-span",
          "data-lane": item.lane,
          "data-error": item.error ? "true" : undefined,
          "data-current": isCurrent(item) ? "true" : undefined,
          "data-match": needle && !spanMatches(item) ? "false" : undefined,
          "data-ttft": ttft !== null ? "true" : undefined,
          style: { left: `${left}%`, width: `${widthPct}%`, top: `${laneIndex * LANE_STEP + 3}px`, ...(ttft !== null ? { ["--trv-ttft" as any]: `${ttft}%` } : {}) },
          title: `${item.label}\n${formatClockShort(item.startMs)} → ${formatClockShort(item.endMs)}\n总计 ${formatDuration(Math.max(0, item.endMs - item.startMs))}${timing}`,
          onClick: () => onSelect(item.ref),
        });
      }),
    ),
  );
}

// —— 台账行 ——

function Row({
  rowKey,
  badge,
  kind,
  text,
  result,
  time,
  error,
  active,
  indent,
  hint,
  onClick,
}: {
  rowKey: string;
  badge: string;
  kind: string;
  text: string;
  result?: string;
  time: string;
  error?: boolean;
  active: boolean;
  indent?: boolean;
  hint: string;
  onClick: () => void;
}) {
  return h(
    "button",
    {
      type: "button",
      className: `trv-trace-row ${active ? "on" : ""} ${indent ? "indent" : ""} ${error ? "bad" : ""}`,
      "data-row": rowKey,
      title: hint,
      onClick,
    },
    h("span", { className: `trv-trace-badge ${kind}` }, badge),
    h("span", { className: "trv-trace-row-text" }, text || "无内容"),
    result ? h("span", { className: "trv-trace-row-arrow" }, "→") : null,
    result ? h("span", { className: "trv-trace-row-result" }, result) : null,
    h("span", { className: "trv-trace-row-time" }, time),
  );
}

function TurnSection({
  turn,
  markers,
  selection,
  onSelect,
  query,
  collapsed,
  callsCollapsed,
}: {
  turn: TraceTurn;
  markers: TraceMarker[];
  selection: Selection;
  onSelect: (next: Selection) => void;
  query: string;
  collapsed: boolean;
  callsCollapsed: boolean;
}) {
  const needle = query.trim().toLowerCase();
  const isCurrent = (kind: "input" | "request" | "tool", key: string) =>
    selection?.kind === kind && selection.key === key;

  const requestRows = turn.steps.flatMap((step) =>
    step.requests.map((request) => {
      const assistantText = oneLine(request.reply || request.reasoning || (request.tools.length ? "（仅工具调用）" : ""));
      const assistantHit = matches(needle, request.reply, request.reasoning, request.model, request.prompt, `第 ${turn.turn} 轮`, `第 ${step.step + 1} 步`);
      const toolRows = request.tools
        .filter((call) => matches(needle, call.name, call.args, call.result))
        .map((call) =>
          h(Row, {
            key: `t-${call.seq}`,
            rowKey: `tool-${call.key}`,
            badge: BADGE.tool,
            kind: "tool",
            text: `${call.name} ${oneLine(call.args, 90)}`,
            // 官方口径：没结果的工具行写「无输出」，还在跑写「等待中」
            result: call.result ? firstLine(call.result, 110) : call.endedAt ? "无输出" : "等待中",
            time: call.durationMs === null ? "" : formatDuration(call.durationMs),
            error: call.error,
            active: isCurrent("tool", call.key),
            indent: true,
            hint: `工具 ${call.name} #${call.seq} · ${call.error ? "失败" : call.endedAt ? "成功" : "等待中"} · ${formatDuration(call.durationMs)}`,
            onClick: () => onSelect({ kind: "tool", key: call.key, seq: call.seq }),
          }),
        );
      const toolsHidden = (callsCollapsed || !toolRows.length) && request.tools.length > 0;
      // 该助手行本身没命中，但工具命中时也要留（否则搜索会把结果藏掉）
      if (!assistantHit && !toolRows.length) return null;
      const rows: React.ReactNode[] = [
        h(Row, {
          key: `r-${request.seq}`,
          rowKey: `request-${request.key}`,
          badge: BADGE.assistant,
          kind: "assistant",
          text: assistantText,
          time: request.durationMs === null ? "" : formatDuration(request.durationMs),
          active: isCurrent("request", request.key),
          hint: `请求 #${request.seq} · ${request.model || "模型未知"} · ${formatDuration(request.durationMs)} · 输出 ${request.completionTokens === null ? "—" : `${formatTokens(request.completionTokens)} tok`}`,
          onClick: () => onSelect({ kind: "request", key: request.key, seq: request.seq }),
        }),
      ];
      if (toolsHidden) {
        rows.push(
          h(
            "div",
            { key: `c-${request.seq}`, className: "trv-trace-collapsed" },
            `${request.tools.length} 个工具调用 · ${[...new Set(request.tools.map((call) => call.name))].slice(0, 6).join(", ")}`,
          ),
        );
      } else {
        rows.push(...toolRows);
      }
      return rows;
    }),
  );

  const inputHit = matches(needle, turn.prompt, `第 ${turn.turn} 轮`);
  const markerRows = markers
    .filter((marker) => matches(needle, marker.title, marker.detail))
    .map((marker) =>
      h(Row, {
        key: `m-${marker.kind}-${marker.seq}`,
        rowKey: `marker-${marker.kind}-${marker.seq}`,
        badge: marker.kind === "compaction" ? BADGE.compaction : marker.kind === "plan-update" ? BADGE.plan : marker.kind === "session-end" ? BADGE.end : BADGE.file,
        kind: "marker",
        text: oneLine(marker.detail || marker.title, 160),
        time: marker.time ? new Date(Date.parse(marker.time)).toLocaleTimeString("zh-CN", { hour12: false }) : "",
        active: false,
        hint: marker.title,
        onClick: () => onSelect(null),
      }),
    );

  const rows = [
    ...(turn.prompt && inputHit
      ? [
          h(Row, {
            key: `in-${turn.turn}`,
            rowKey: `input-${turn.turn}`,
            badge: BADGE.input,
            kind: "user",
            text: oneLine(turn.prompt),
            time: "",
            active: isCurrent("input", `input#${turn.turn}`),
            hint: `第 ${turn.turn} 轮用户输入 · ${formatClock(turn.inputAt)}`,
            onClick: () => onSelect({ kind: "input", key: `input#${turn.turn}`, seq: turn.turn }),
          }),
        ]
      : []),
    ...requestRows,
    ...markerRows,
  ].filter(Boolean);

  if (!rows.length) return null;

  return h(
    "section",
    { className: "trv-trace-turn", "data-turn": turn.turn },
    h(
      "header",
      { className: "trv-trace-turn-head" },
      h("span", { className: "trv-trace-turn-no" }, `第 ${turn.turn} 轮`),
      h("span", { className: "trv-trace-turn-meta" }, `${turn.toolCount} 次调用 · ${formatDuration(turn.durationMs)}`),
    ),
    collapsed
      ? h("div", { className: "trv-trace-collapsed" }, `${turn.steps.length} 个步骤 · ${turn.toolCount} 个工具调用`)
      : h("div", { className: "trv-trace-turn-rows" }, rows),
  );
}

// —— 检查面板 ——

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return h(
    "div",
    { className: "trv-trace-field", title: hint },
    h("span", { className: "trv-trace-field-label" }, label),
    h("span", { className: "trv-trace-field-value" }, value),
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children?: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  React.useEffect(() => { setOpen(defaultOpen); }, [title, defaultOpen]);
  return h(
    "div",
    { className: "trv-trace-section" },
    h(
      "button",
      { type: "button", className: "trv-trace-section-head", "aria-expanded": open, onClick: () => setOpen(!open) },
      h(Icon, { path: ICON_CARET, size: 12 }),
      h("span", null, title),
    ),
    open ? h("div", { className: "trv-trace-section-body" }, children) : null,
  );
}

function Inspector({ model, selection, onClose }: { model: any; selection: Selection; onClose: () => void }) {
  const [tab, setTab] = React.useState<"summary" | "preview" | "raw">("summary");
  React.useEffect(() => { setTab("summary"); }, [selection?.kind, selection?.key]);
  if (!selection) return null;

  let badge = "";
  let badgeKind = "";
  let title = "";
  let source = "";
  let status = "未记录";
  let statusKind = "";
  let tokens = "";
  let preview = "";
  let thinking = "";
  let raw = "";
  const timing: Array<{ label: string; value: string }> = [];

  if (selection.kind === "input") {
    const turn = (model.turns as TraceTurn[]).find((item) => item.turn === selection.seq);
    if (!turn) return null;
    badge = BADGE.input;
    badgeKind = "user";
    title = `用户 第 ${turn.turn} 轮`;
    source = `第 ${turn.turn} 轮输入`;
    status = "已完成";
    statusKind = "ok";
    preview = turn.prompt || "无内容";
    raw = JSON.stringify({ turn: turn.turn, prompt: turn.prompt, inputAt: turn.inputAt, durationMs: turn.durationMs }, null, 2);
    timing.push({ label: "开始时间", value: formatClock(turn.inputAt) });
    timing.push({ label: "时长", value: formatTiming(turn.durationMs) });
  } else if (selection.kind === "request") {
    const request = model.requestsByKey.get(selection.key) as TraceRequest | undefined;
    if (!request) return null;
    const completed = request.status === "completed";
    const tokenAt = request.firstTokenMs;
    badge = BADGE.assistant;
    badgeKind = "assistant";
    title = `助手 第 ${request.turn} 轮 · 第 ${request.step + 1} 步`;
    source = `请求 #${request.seq}`;
    // 官方口径：失败 / 等待中 / 已完成
    status = request.status === "failed" ? "失败" : completed ? "已完成" : "等待中";
    statusKind = request.status === "failed" ? "bad" : completed ? "ok" : "";
    tokens = request.completionTokens === null ? "—" : `${formatTokens(request.completionTokens)} tok`;
    thinking = request.reasoning;
    preview = request.reply || request.reasoning || "（仅工具调用）";
    raw = [request.raw.request?.content, request.raw.response?.content, request.raw.usage?.content].filter(Boolean).join("\n\n");
    timing.push({ label: "开始时间", value: request.time ? formatClock(request.time) : "不可用" });
    timing.push({
      label: "总时长",
      value: request.durationMs === null ? (completed ? "未记录" : "等待中") : formatTiming(request.durationMs),
    });
    // 首 token 延迟 / 生成 / 吞吐量：缺哪一段就说清缺什么，不编数（官方那几句兜底文案）
    timing.push({
      label: "首 token 延迟",
      value: tokenAt === null ? "首 token 时间不可用" : formatTiming(tokenAt),
    });
    timing.push({
      label: "生成",
      value: tokenAt === null
        ? "首 token 时间不可用"
        : request.generationMs === null
          ? (completed ? "未记录" : "等待中")
          : formatTiming(request.generationMs),
    });
    timing.push({
      label: "吞吐量",
      value: request.completionTokens === null
        ? "输出 token 数不可用"
        : tokenAt === null || request.generationMs === null
          ? "首 token 时间不可用"
          : request.generationMs <= 0
            ? "时长过短"
            : `${request.throughput && Number.isFinite(request.throughput) ? request.throughput.toFixed(1) : "—"} tok/s`,
    });
  } else {
    const call = model.toolsByKey.get(selection.key) as TraceToolCall | undefined;
    if (!call) return null;
    badge = BADGE.tool;
    badgeKind = "tool";
    title = `工具 ${call.name} #${call.seq}`;
    source = `调用 #${call.seq}`;
    status = call.error ? "失败" : call.endedAt ? "已完成" : "等待中";
    statusKind = call.error ? "bad" : call.endedAt ? "ok" : "";
    preview = call.result || "无输出";
    raw = `参数原文：\n${call.args}\n\n结果原文：\n${call.result}`;
    timing.push({ label: "开始时间", value: formatClock(call.startedAt) });
    timing.push({ label: "时长", value: call.durationMs === null ? (call.endedAt ? "未记录" : "等待中") : formatTiming(call.durationMs) });
  }

  const body = tab === "preview"
    ? preview
    : tab === "raw"
      ? raw || "（没有保留原文）"
      : "";

  const copyText = tab === "summary" ? [title, source, status, tokens, thinking, preview].filter(Boolean).join("\n") : body;

  return h(
    "aside",
    { className: "trv-trace-inspector" },
    h(
      "header",
      { className: "trv-trace-inspector-head" },
      h("span", { className: `trv-trace-badge ${badgeKind}` }, badge),
      h("strong", { className: "trv-trace-inspector-title" }, title),
      h(
        "span",
        { className: "trv-trace-inspector-actions" },
        h(
          "button",
          {
            type: "button",
            className: "plugins-text-button",
            title: "复制当前页签内容",
            onClick: () => { void navigator.clipboard?.writeText(copyText || ""); },
          },
          "复制",
        ),
        h("button", { type: "button", className: "trv-trace-close", title: "关闭", onClick: onClose }, h(Icon, { path: ICON_CLOSE, size: 12 })),
      ),
    ),
    h(
      "div",
      { className: "trv-trace-inspector-tabs", role: "tablist" },
      ([["summary", "概述"], ["preview", "预览"], ["raw", "原始内容"]] as const).map(([key, label]) =>
        h(
          "button",
          { key, type: "button", role: "tab", "aria-selected": tab === key, className: `trv-trace-tab ${tab === key ? "on" : ""}`, onClick: () => setTab(key) },
          label,
        ),
      ),
    ),
    tab !== "summary"
      ? h("pre", { className: "trv-trace-inspector-body" }, body || "（没有保留原文）")
      : h(
          "div",
          { className: "trv-trace-inspector-body" },
          h(
            "div",
            { className: "trv-trace-fields" },
            h(Field, { label: "来源", value: source }),
            h(Field, { label: "状态", value: status, hint: statusKind === "bad" ? "这一步失败了" : undefined }),
            tokens ? h(Field, { label: "Token", value: tokens, hint: "本次请求的输出 token" }) : null,
          ),
          // 预览：思考折叠在预览里面（官方就是这样两层），正文另起一段
          preview || thinking
            ? h(
                Section,
                { title: "预览" },
                thinking
                  ? h(
                      Section,
                      { title: "思考", defaultOpen: false },
                      h("div", { className: "trv-trace-thinking" }, thinking.length > 2000 ? `${thinking.slice(0, 2000)}…` : thinking),
                    )
                  : null,
                preview
                  ? h("div", { className: "trv-trace-thinking" }, preview.length > 2000 ? `${preview.slice(0, 2000)}…` : preview)
                  : null,
              )
            : null,
          timing.length
            ? h(
                Section,
                { title: selection.kind === "request" ? "请求计时" : "计时" },
                h(
                  "div",
                  { className: "trv-trace-fields" },
                  timing.map((item) => h(Field, { key: item.label, label: item.label, value: item.value })),
                ),
              )
            : null,
        ),
  );
}

// —— 视图 ——

export function TraceView({
  traces,
  messages,
  sessionId,
  onClose,
}: {
  traces: TraceEvent[];
  messages?: any[];
  sessionId?: string;
  onClose?: () => void;
}) {
  const model = React.useMemo(() => buildTraceModel(traces, { messages }), [traces, messages]);
  // 检查面板要按 seq 取原始对象（模型只暴露 turns/spans），这里补索引
  const index = React.useMemo(() => {
    const requestsByKey = new Map<string, TraceRequest>();
    const toolsByKey = new Map<string, TraceToolCall>();
    for (const turn of model.turns) {
      for (const step of turn.steps) {
        for (const request of step.requests) {
          requestsByKey.set(request.key, request);
          for (const call of request.tools) toolsByKey.set(call.key, call);
        }
      }
    }
    return { requestsByKey, toolsByKey, turns: model.turns };
  }, [model]);

  const [query, setQuery] = React.useState("");
  const [selection, setSelection] = React.useState<Selection>(null);
  const [equalWidth, setEqualWidth] = React.useState(false);
  const [turnsCollapsed, setTurnsCollapsed] = React.useState(false);
  const [callsCollapsed, setCallsCollapsed] = React.useState(false);
  const [collapsedTurns, setCollapsedTurns] = React.useState<Set<number>>(new Set());
  const scroller = React.useRef<HTMLDivElement | null>(null);

  // 时间条上点一个跨度 → 选中它，并把台账里那一行滚进视野（两边是同一份选中态）
  const pick = (next: Selection) => {
    setSelection(next);
    if (!next) return;
    const selector = `[data-row="${next.kind}-${next.key}"]`;
    const target = scroller.current?.querySelector(selector);
    if (target && "scrollIntoView" in target) (target as HTMLElement).scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const allCollapsed = turnsCollapsed ? new Set(model.turns.map((turn) => turn.turn)) : collapsedTurns;

  return h(
    "div",
    { className: "trv-trace-view" },
    h(Toolbar, {
      metrics: model.metrics,
      markers: model.markers,
      equalWidth,
      onEqualWidth: setEqualWidth,
      turnsCollapsed,
      onTurnsCollapsed: setTurnsCollapsed,
      callsCollapsed,
      onCallsCollapsed: setCallsCollapsed,
      query,
      onQuery: setQuery,
      onClose,
    }),
    h(Timeline, { model, selection, onSelect: pick, query, equalWidth }),
    h(
      "div",
      { className: "trv-trace-body" },
      h(
        "div",
        { className: "trv-trace-scroll", ref: scroller },
        !model.turns.length
          ? h("p", { className: "plugins-empty" }, sessionId ? "这个会话还没有轨迹记录（发起任务后就会出现）。" : "先选一个会话。")
          : h(
              "div",
              { className: "trv-trace-ledger" },
              model.turns.map((turn) =>
                h(TurnSection, {
                  key: turn.turn,
                  turn,
                  markers: model.markersByTurn.get(turn.turn) || [],
                  selection,
                  onSelect: pick,
                  query,
                  collapsed: allCollapsed.has(turn.turn),
                  callsCollapsed,
                }),
              ),
              model.sessionMarkers.length
                ? h(
                    "div",
                    { className: "trv-trace-session-markers" },
                    model.sessionMarkers.map((marker) =>
                      h(Row, {
                        key: `s-${marker.kind}-${marker.seq}`,
                        rowKey: `session-${marker.kind}-${marker.seq}`,
                        badge: marker.kind === "compaction" ? BADGE.compaction : marker.kind === "session-end" ? BADGE.end : BADGE.plan,
                        kind: "marker",
                        text: oneLine(marker.detail || marker.title, 160),
                        time: marker.time ? new Date(Date.parse(marker.time)).toLocaleTimeString("zh-CN", { hour12: false }) : "",
                        active: false,
                        hint: marker.title,
                        onClick: () => setSelection(null),
                      }),
                    ),
                  )
                : null,
            ),
      ),
      h(Inspector, { model: index, selection, onClose: () => setSelection(null) }),
    ),
  );
}
