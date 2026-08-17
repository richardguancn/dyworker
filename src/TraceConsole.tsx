// trace-console 视图层：轨迹控制台。
// 布局：顶部模式工具栏（耗时/轮次/调用）+ 泳道时间线（输入/模型/工具）/ 左侧明细列表（Turn 分割、虚拟化）/ 右侧检查器。
// 数据：内存中本会话的 TraceEvent[]（主进程每次任务结束异步落盘 userData/traces/<sessionId>.jsonl）。
// 耗时推导：tool-result→tool-call、model-response→model-request 按 parentSeq 配对，差值即真实耗时；
// 进行中的未配对记录画成刻度线，不虚构时长。
// 老会话降级：无轨迹数据时切换「日志」视图显示原有四类 debug-log 扁平列表。
import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Hash, History, Layers, Search, Terminal, Trash2, X } from "lucide-react";
import type { DebugLogEntry, TraceEvent } from "./types";

export interface TraceConsoleProps {
  traces: TraceEvent[];
  logs: DebugLogEntry[];
  sessionId?: string;
  onClear: () => void;
  onClose: () => void;
  /** 外部追加轨迹（历史回放合并），由 App.tsx 注入去重合并逻辑 */
  onAppendTraces?: (records: TraceEvent[]) => void;
}

// 轨迹记录在控制台内的唯一键：跨 run 时 seq 会重置，用 runId+seq 区分
function traceKey(trace: TraceEvent): string {
  return `${trace.runId || ""}:${trace.seq}`;
}

// —— 类型徽标与配色 ——

const TRACE_KIND_LABEL: Record<TraceEvent["kind"], string> = {
  "model-request": "模型请求",
  "model-response": "模型响应",
  "tool-call": "工具调用",
  "tool-result": "工具结果",
  "token-usage": "Token 用量",
  activity: "活动",
  "activity-update": "活动更新",
  "plan-update": "计划更新",
  "file-change": "文件变更",
  "agent-finished": "任务结束",
};

// 时间线条块配色：模型=紫、工具=橙（与列表徽标同族）
const TIMELINE_LANE_COLOR = { model: "#8b5cf6", tool: "#e8930c", input: "#9aa4b2" } as const;
// 「轮次」模式下按轮次循环取色，直观看清每轮边界
const TURN_PALETTE = ["#4f8ef7", "#8b5cf6", "#2fb5c9", "#e8930c", "#3fb27f", "#e05b9b", "#d4b106", "#79cfdf"];

const TRACE_TARGET_LABEL: Record<TraceEvent["target"], string> = {
  model: "模型",
  tool: "工具",
  system: "系统",
};

type TraceFilter = "all" | TraceEvent["target"];

function traceTime(trace: TraceEvent): string {
  const time = new Date(trace.time);
  return `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}:${String(time.getSeconds()).padStart(2, "0")}`;
}

function formatDuration(ms: number): string {
  if (ms < 1) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

// 内容压成单行预览（列表行内「→ 结果」用），长度交给 CSS 截断
function oneLine(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

// parentSeq 配对表：key 为「发起端」（tool-call / model-request），value 为配对的「结束端」（tool-result / model-response）
function buildPairs(traces: TraceEvent[]): Map<string, TraceEvent> {
  const pairs = new Map<string, TraceEvent>();
  for (const trace of traces) {
    if (trace.parentSeq === undefined) continue;
    if (trace.kind !== "tool-result" && trace.kind !== "model-response") continue;
    const parentKey = `${trace.runId || ""}:${trace.parentSeq}`;
    if (!pairs.has(parentKey)) pairs.set(parentKey, trace);
  }
  return pairs;
}

// —— 泳道时间线 ——

type TimelineMode = "duration" | "turns" | "calls";

const TIMELINE_MODES: { id: TimelineMode; label: string; icon: typeof Clock }[] = [
  { id: "duration", label: "耗时", icon: Clock },
  { id: "turns", label: "轮次", icon: Layers },
  { id: "calls", label: "调用", icon: Hash },
];

const TIMELINE_LANES: { id: TimelineItem["lane"]; label: string }[] = [
  { id: "input", label: "输入" },
  { id: "model", label: "模型" },
  { id: "tool", label: "工具" },
];

interface TimelineItem {
  key: string;
  lane: "input" | "model" | "tool";
  trace: TraceEvent;
  startMs: number;
  endMs?: number; // 有配对结束端才有；无配对画刻度线
  turn: number;
  tip: string;
}

function buildTimelineItems(traces: TraceEvent[], pairs: Map<string, TraceEvent>): TimelineItem[] {
  const items: TimelineItem[] = [];
  let currentTurn = -1;
  for (const trace of traces) {
    const ms = Date.parse(trace.time);
    if (trace.turn !== currentTurn) {
      currentTurn = trace.turn;
      items.push({
        key: `turn:${traceKey(trace)}`,
        lane: "input",
        trace,
        startMs: ms,
        turn: trace.turn,
        tip: `第 ${trace.turn} 轮开始 · ${traceTime(trace)}`,
      });
    }
    const lane = trace.kind === "model-request" ? "model" : trace.kind === "tool-call" ? "tool" : null;
    if (!lane) continue;
    const end = pairs.get(traceKey(trace));
    const endMs = end ? Date.parse(end.time) : undefined;
    const durationText = endMs !== undefined ? ` · 耗时 ${formatDuration(Math.max(0, endMs - ms))}` : " · 进行中";
    items.push({
      key: traceKey(trace),
      lane,
      trace,
      startMs: ms,
      endMs,
      turn: trace.turn,
      tip: `${TRACE_KIND_LABEL[trace.kind]} · ${trace.title || "(无标题)"}${durationText}`,
    });
  }
  return items;
}

function LaneTimeline({ items, mode, selectedKey, onPick }: {
  items: TimelineItem[];
  mode: TimelineMode;
  selectedKey?: string;
  onPick: (trace: TraceEvent) => void;
}) {
  if (!items.length) return null;
  const startMs = items[0].startMs;
  const endMs = items.reduce((max, item) => Math.max(max, item.endMs ?? item.startMs), startMs + 1);
  const span = endMs - startMs;
  // 「调用」模式：忽略真实时间，按事件顺序等宽排布（x = 全局序号）
  const orderByKey = new Map(items.map((item, index) => [item.key, index]));
  const slotPct = 100 / Math.max(1, items.length);
  return (
    <div className="trace-timeline" aria-label="轨迹时间线">
      {TIMELINE_LANES.map((lane) => (
        <div className="trace-lane" key={lane.id}>
          <span className="trace-lane-label">{lane.label}</span>
          <div className="trace-lane-track">
            {items.filter((item) => item.lane === lane.id).map((item) => {
              const isSpan = item.endMs !== undefined && item.endMs > item.startMs;
              let leftPct: number;
              let widthPct: number | undefined;
              if (mode === "calls") {
                leftPct = (orderByKey.get(item.key) || 0) * slotPct;
                widthPct = isSpan ? Math.max(0.5, slotPct * 0.72) : undefined;
              } else {
                leftPct = ((item.startMs - startMs) / span) * 100;
                widthPct = isSpan ? Math.max(0.35, ((item.endMs as number) - item.startMs) / span * 100) : undefined;
              }
              const color = mode === "turns" ? TURN_PALETTE[item.turn % TURN_PALETTE.length] : TIMELINE_LANE_COLOR[item.lane];
              return (
                <button
                  type="button"
                  key={item.key}
                  className={`${isSpan ? "trace-lane-bar" : "trace-lane-tick"} ${selectedKey === traceKey(item.trace) ? "selected" : ""}`}
                  style={{ left: `${leftPct}%`, width: widthPct !== undefined ? `${Math.min(100 - leftPct, widthPct)}%` : undefined, background: color }}
                  title={item.tip}
                  aria-label={item.tip}
                  onClick={() => onPick(item.trace)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// —— 列表行（虚拟化：固定行高，只挂载可见行）——

const ROW_H = 30;
const TURN_ROW_H = 26;

interface FlatRow {
  kind: "turn" | "record";
  turn?: number;
  trace?: TraceEvent;
  seq?: number;
}

function flattenRows(traces: TraceEvent[]): FlatRow[] {
  const rows: FlatRow[] = [];
  let currentTurn = 0;
  for (const trace of traces) {
    if (trace.turn !== currentTurn) {
      currentTurn = trace.turn;
      rows.push({ kind: "turn", turn: currentTurn });
    }
    rows.push({ kind: "record", trace, seq: trace.seq });
  }
  return rows;
}

function rowHeight(row: FlatRow): number {
  return row.kind === "turn" ? TURN_ROW_H : ROW_H;
}

// —— 右侧检查器 ——

type InspectorTab = "summary" | "preview" | "raw";

const INSPECTOR_TABS: { id: InspectorTab; label: string }[] = [
  { id: "summary", label: "摘要" },
  { id: "preview", label: "预览" },
  { id: "raw", label: "原始" },
];

function capContent(content: string): string {
  return content.length > 12000 ? `${content.slice(0, 12000)}\n…（内容过长已截断，上限 12k）` : content;
}

function prettyMaybeJson(content: string): string {
  const text = content.trim();
  if (!text || !/^[{\[]/.test(text)) return content;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return content;
  }
}

function TraceInspector({ trace, pairs, byKey, onClose }: {
  trace: TraceEvent;
  pairs: Map<string, TraceEvent>;
  byKey: Map<string, TraceEvent>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<InspectorTab>("summary");
  // 耗时：发起端（请求/调用）取配对结束端差值；结束端（响应/结果）反查发起端差值
  const paired = pairs.get(traceKey(trace));
  const parent = trace.parentSeq !== undefined ? byKey.get(`${trace.runId || ""}:${trace.parentSeq}`) : undefined;
  const durationMs = paired
    ? Math.max(0, Date.parse(paired.time) - Date.parse(trace.time))
    : parent
      ? Math.max(0, Date.parse(trace.time) - Date.parse(parent.time))
      : undefined;
  const isInitiator = trace.kind === "model-request" || trace.kind === "tool-call";
  const statusText = trace.status || (isInitiator ? (paired ? "已完成" : "进行中") : "—");
  const fields: { label: string; value: string }[] = [
    { label: "时间", value: `${traceTime(trace)}.${String(Date.parse(trace.time) % 1000).padStart(3, "0")}` },
    { label: "轮次", value: `第 ${trace.turn} 轮 · step ${trace.step}` },
    { label: "来源", value: trace.depth ? `子代理 · 深度 ${trace.depth}` : "主代理" },
    { label: "方向", value: trace.direction === "in" ? "↓ 进入" : "↑ 返回" },
    { label: "状态", value: statusText },
    { label: "耗时", value: durationMs !== undefined ? formatDuration(durationMs) : "—" },
    ...(trace.usage
      ? [{ label: "Token", value: `输入 ${trace.usage.prompt.toLocaleString()} / 输出 ${trace.usage.completion.toLocaleString()}${trace.usage.estimated ? "（估算）" : ""}` }]
      : []),
    ...(trace.parentSeq !== undefined ? [{ label: "关联", value: `← #${trace.parentSeq}` }] : []),
    ...(trace.runId ? [{ label: "Run", value: trace.runId }] : []),
  ];
  return (
    <div className="trace-side">
      <div className="trace-side-head">
        <span className={`trace-kind-badge kind-${trace.kind}`}>{TRACE_KIND_LABEL[trace.kind]}</span>
        <span className="trace-side-sub">第 {trace.turn} 轮 · {TRACE_TARGET_LABEL[trace.target]}</span>
        <button type="button" className="icon-button subtle tiny" aria-label="关闭详情" onClick={onClose}><X size={13} /></button>
      </div>
      <div className="trace-side-tabs" role="tablist">
        {INSPECTOR_TABS.map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            key={item.id}
            className={`trace-side-tab ${tab === item.id ? "active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="trace-side-body">
        {tab === "summary" && (
          <>
            <div className="trace-side-title">{trace.title || "（无标题）"}</div>
            <div className="trace-fields">
              {fields.map((field) => (
                <div className="trace-field" key={field.label}>
                  <span className="trace-field-label">{field.label}</span>
                  <span className="trace-field-value">{field.value}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {tab === "preview" && (
          trace.content
            ? <pre className="trace-side-pre">{capContent(prettyMaybeJson(trace.content))}</pre>
            : <div className="trace-empty">（无内容）</div>
        )}
        {tab === "raw" && <pre className="trace-side-pre">{capContent(JSON.stringify(trace, null, 2))}</pre>}
      </div>
    </div>
  );
}

// —— 主组件 ——

export function TraceConsole({ traces, logs, sessionId, onClear, onClose, onAppendTraces }: TraceConsoleProps) {
  const [view, setView] = useState<"trace" | "log">(traces.length ? "trace" : "log");
  const [mode, setMode] = useState<TimelineMode>("duration");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TraceFilter>("all");
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [loadingHistory, setLoadingHistory] = useState(false);
  const listBodyRef = useRef<HTMLDivElement>(null);
  // 最新 traces 镜像：loadHistory 分页递归时用 ref 去重，避免闭包捕获过期的 props
  const tracesRef = useRef(traces);
  tracesRef.current = traces;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);

  const pairs = useMemo(() => buildPairs(traces), [traces]);
  const byKey = useMemo(() => new Map(traces.map((trace) => [traceKey(trace), trace])), [traces]);
  const timelineItems = useMemo(() => buildTimelineItems(traces, pairs), [traces, pairs]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return traces.filter((trace) => {
      if (filter !== "all" && trace.target !== filter) return false;
      if (!query) return true;
      return (trace.title || "").toLowerCase().includes(query) || (trace.content || "").toLowerCase().includes(query);
    });
  }, [traces, search, filter]);

  const rows = useMemo(() => flattenRows(filtered), [filtered]);
  const rowOffsets = useMemo(() => {
    const offsets: number[] = [];
    let total = 0;
    for (const row of rows) {
      offsets.push(total);
      total += rowHeight(row);
    }
    offsets.push(total);
    return offsets;
  }, [rows]);
  const totalHeight = rowOffsets[rowOffsets.length - 1] || 0;

  // 虚拟化窗口
  const { startIndex, endIndex } = useMemo(() => {
    if (!rows.length) return { startIndex: 0, endIndex: 0 };
    let start = 0;
    while (start < rows.length && rowOffsets[start + 1] <= scrollTop) start += 1;
    const endLimit = scrollTop + viewportH;
    let end = start;
    while (end < rows.length && rowOffsets[end + 1] <= endLimit) end += 1;
    // 上下各留 3 行缓冲
    return { startIndex: Math.max(0, start - 3), endIndex: Math.min(rows.length, end + 3) };
  }, [rows, rowOffsets, scrollTop, viewportH]);

  const visibleRows = rows.slice(startIndex, endIndex);
  const selected = selectedKey !== undefined ? traces.find((trace) => traceKey(trace) === selectedKey) : undefined;

  const pickRecord = (trace: TraceEvent) => {
    setSelectedKey(traceKey(trace));
    // 滚动列表让该行可见（跨 run 时 seq 会重置，用 runId+seq 定位）
    const index = rows.findIndex((row) => row.trace && traceKey(row.trace) === traceKey(trace));
    if (index >= 0 && listBodyRef.current) {
      const offset = rowOffsets[index];
      listBodyRef.current.scrollTop = Math.max(0, offset - 60);
    }
  };

  // 分页读取本会话落盘 jsonl 直到读完（每次 2000 条），去重合并交给 App.tsx 注入的逻辑
  const loadHistory = () => {
    if (!sessionId || loadingHistory) return;
    setLoadingHistory(true);
    const page = (offset: number) => {
      void window.dyworker?.readTraces?.({ sessionId, offset, limit: 2000 }).then((result) => {
        if (result?.ok && Array.isArray(result.records)) {
          const known = new Set(tracesRef.current.map((trace) => traceKey(trace)));
          const fresh = result.records.filter((record) => !known.has(traceKey(record)));
          if (fresh.length) onAppendTraces?.(fresh);
          const next = offset + result.records.length;
          if (result.records.length && next < (result.total || 0)) {
            page(next);
            return;
          }
        }
        setLoadingHistory(false);
      }).catch(() => setLoadingHistory(false));
    };
    page(0);
  };

  // 打开控制台即自动载入本会话落盘历史：重启后内存轨迹为空，不用再手动点历史按钮
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current || !sessionId) return;
    autoLoadedRef.current = true;
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 历史载入完成后自动从「日志」切回「轨迹」视图（初始 view 取决于挂载时 traces.length）
  useEffect(() => {
    if (traces.length && view === "log") setView("trace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traces.length]);

  return (
    <div className="trace-console">
      <div className="trace-console-header">
        <Terminal size={14} />
        <strong>轨迹控制台</strong>
        <div className="trace-view-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === "trace"}
            className={`trace-view-tab ${view === "trace" ? "active" : ""}`}
            onClick={() => { setView("trace"); if (traces.length && !selectedKey) setSelectedKey(traceKey(traces[traces.length - 1])); }}
          >
            轨迹
            <span className="trace-tab-count">{traces.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "log"}
            className={`trace-view-tab ${view === "log" ? "active" : ""}`}
            onClick={() => setView("log")}
          >
            日志
            <span className="trace-tab-count">{logs.length}</span>
          </button>
        </div>
        <span className="debug-console-spacer" />
        {sessionId && (
          <button type="button" className="icon-button subtle tiny" aria-label="载入本会话历史轨迹" title="载入本会话历史轨迹（回放落盘记录）" onClick={() => void loadHistory()} disabled={loadingHistory}>
            <History size={13} />
          </button>
        )}
        <button type="button" className="icon-button subtle tiny" aria-label="清空控制台" onClick={onClear}><Trash2 size={13} /></button>
        <button type="button" className="icon-button subtle tiny" aria-label="关闭控制台" onClick={onClose}><X size={14} /></button>
      </div>

      {view === "trace" ? (
        <>
          {traces.length === 0 ? (
            <div className="debug-console-body">
              <div className="debug-console-empty">
                暂无轨迹数据。发起任务后，这里会按「轮次 → 步骤 → 记录」展示模型请求/响应、工具调用/结果、活动、计划与文件变更的完整时间线；
                任务结束后主进程会把记录落盘到 userData/traces/，可点右上角历史按钮回放。
              </div>
            </div>
          ) : (
            <>
              <div className="trace-toolbar">
                <div className="trace-mode-tabs" role="tablist" aria-label="时间线模式">
                  {TIMELINE_MODES.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={mode === item.id}
                        key={item.id}
                        className={`trace-mode-tab ${mode === item.id ? "active" : ""}`}
                        title={{ duration: "按真实时间比例绘制条长", turns: "按轮次着色，看清每轮边界", calls: "忽略时间，按调用顺序等宽排布" }[item.id]}
                        onClick={() => setMode(item.id)}
                      >
                        <Icon size={11} />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
                <span className="trace-toolbar-count">{filtered.length} / {traces.length} 条</span>
                <select value={filter} onChange={(event) => setFilter(event.target.value as TraceFilter)} aria-label="按目标筛选">
                  <option value="all">全部</option>
                  <option value="model">模型</option>
                  <option value="tool">工具</option>
                  <option value="system">系统</option>
                </select>
                <div className="trace-search">
                  <Search size={12} />
                  <input
                    type="search"
                    placeholder="搜索标题或内容…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label="搜索轨迹"
                  />
                </div>
              </div>
              <LaneTimeline items={timelineItems} mode={mode} selectedKey={selectedKey} onPick={pickRecord} />
              <div className="trace-body">
                <div
                  className="trace-list"
                  ref={(node) => {
                    if (node && node.clientHeight !== viewportH) setViewportH(node.clientHeight);
                    if (node && listBodyRef.current !== node) listBodyRef.current = node;
                  }}
                  onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                >
                  {/* 滚动容器是外层 .trace-list（有限高度）；.trace-list-body 只做内容撑杆（height=totalHeight），行项绝对定位 */}
                  <div className="trace-list-body" style={{ height: totalHeight, position: "relative" }}>
                    {visibleRows.map((row, i) => {
                      const index = startIndex + i;
                      if (row.kind === "turn") {
                        return (
                          <div className="trace-turn" key={`turn-${index}`} style={{ height: TURN_ROW_H, top: rowOffsets[index], position: "absolute", left: 0, right: 0 }}>
                            第 {row.turn} 轮
                            <span className="trace-turn-line" />
                          </div>
                        );
                      }
                      const trace = row.trace!;
                      const selectedRow = traceKey(trace) === selectedKey;
                      // 工具调用行内联预览配对结果（参考 UI 的 bash {...} → 结果 样式）
                      const resultPreview = trace.kind === "tool-call" ? pairs.get(traceKey(trace)) : undefined;
                      return (
                        <button
                          type="button"
                          className={`trace-row ${selectedRow ? "selected" : ""}`}
                          key={traceKey(trace)}
                          style={{ height: ROW_H, top: rowOffsets[index], position: "absolute", left: 0, right: 0 }}
                          onClick={() => setSelectedKey(traceKey(trace))}
                          title={trace.title || TRACE_KIND_LABEL[trace.kind]}
                        >
                          <span className="trace-indent" style={{ width: Math.min(48, (trace.depth || 0) * 14) }} />
                          {trace.parentSeq !== undefined && <span className="trace-child-mark">↳</span>}
                          <span className={`trace-kind-badge kind-${trace.kind}`}>{TRACE_KIND_LABEL[trace.kind]}</span>
                          <span className="trace-direction">{trace.direction === "in" ? "↓" : "↑"}</span>
                          <span className="trace-row-title">{trace.title || "(无标题)"}</span>
                          {resultPreview && <span className="trace-row-preview">→ {oneLine(resultPreview.content || "")}</span>}
                          <span className="trace-row-time">{traceTime(trace)}</span>
                        </button>
                      );
                    })}
                    {!visibleRows.length && <div className="trace-empty-row">无匹配记录</div>}
                  </div>
                </div>
                {selected && (
                  <TraceInspector trace={selected} pairs={pairs} byKey={byKey} onClose={() => setSelectedKey(undefined)} />
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="debug-console-body">
          {logs.length === 0 ? (
            <div className="debug-console-empty">暂无日志。发起任务后，这里会显示每一轮模型请求的消息内容、响应（SSE 流式或 JSON）以及每次工具调用的参数与结果。</div>
          ) : logs.map((entry) => (
            <details className={`debug-entry debug-${entry.kind}`} key={entry.id}>
              <summary>
                <span className="debug-entry-kind">{debugKindLabels(entry.kind)}</span>
                <span className="debug-entry-time">{entry.time.slice(11, 19)}</span>
                <span className="debug-entry-title">{entry.title}</span>
              </summary>
              <pre>{entry.content}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function debugKindLabels(kind: DebugLogEntry["kind"]): string {
  const labels: Record<DebugLogEntry["kind"], string> = {
    "model-request": "模型请求",
    "model-response": "模型响应",
    "tool-call": "工具调用",
    "tool-result": "工具结果",
  };
  return labels[kind];
}
