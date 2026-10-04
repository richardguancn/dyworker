// 原生轨迹视图（替代 DSH 官方轨迹插件）。
//
// 为什么不再用插件：官方那个组件要跑起来，得把 DSH 的客户端会话层、20+ 服务、会话事件总线
// 整套搬过来（实测就是靠仿造这层壳才勉强渲染）。收益不值这个代价，所以轨迹改为原生实现，
// 数据只来自我们自己的两处：TraceEvent 流（含落盘历史回放）与会话消息。
//
// 结构对齐官方「轨迹」：
//   工具栏指标（生成时长 / 轮次 / 调用 / 输入 / 模型 / 工具）
//   → 时长条形图（每轮一根，可点选）
//   → 轮次行（USER / ASSISTANT 正文预览）
//   → 请求行（模型/端点/耗时/token，点开右侧检查面板：预览 / 摘要 / 原文）
//   → 工具调用与结果（参数、结果、耗时、错误态）
//   → 标记（压缩 / 会话结束 / 计划更新 / 文件变更）
//   → 搜索（用户输入、回复、工具名/参数/结果）
//
// 组件用 React.createElement 而不是 JSX：与仓库其它插件相关组件保持一致，便于 Node 侧测试。

import * as React from "react";
import type { TraceEvent } from "./types";
import { buildTraceModel, formatDuration, formatTokens, traceMatches, type TraceMarker, type TraceRequest, type TraceToolCall, type TraceTurn } from "./traceModel";

type Selection = { kind: "request" | "tool"; seq: number } | null;

const h = React.createElement;

/** 一轮的时长条：宽度按"该轮生成时长 / 最长轮时长"取比例 */
function DurationBars({ turns, current, onPick }: { turns: TraceTurn[]; current: number | null; onPick: (turn: number) => void }) {
  const peak = Math.max(1, ...turns.map((turn) => turn.durationMs || 0));
  return h(
    "div",
    { className: "trv-trace-bars", role: "list", "aria-label": "每轮生成时长" },
    turns.map((turn) =>
      h(
        "button",
        {
          key: turn.turn,
          type: "button",
          role: "listitem",
          className: `trv-trace-bar ${current === turn.turn ? "on" : ""}`,
          title: `第 ${turn.turn} 轮 · ${formatDuration(turn.durationMs)} · ${turn.toolCount} 次工具调用`,
          onClick: () => onPick(turn.turn),
        },
        h("span", {
          className: "trv-trace-bar-fill",
          style: { height: `${Math.max(8, Math.round(((turn.durationMs || 0) / peak) * 100))}%` },
        }),
        h("span", { className: "trv-trace-bar-label" }, String(turn.turn)),
      ),
    ),
  );
}

function Marker({ marker }: { marker: TraceMarker }) {
  const labels: Record<TraceMarker["kind"], string> = {
    compaction: "上下文压缩",
    "session-end": "会话结束",
    "plan-update": "计划更新",
    "file-change": "文件变更",
    phase: "阶段",
  };
  return h(
    "div",
    { className: `trv-trace-marker ${marker.kind}` },
    h("span", { className: "trv-trace-marker-dot" }),
    h("strong", null, labels[marker.kind] || marker.title),
    h("span", { className: "trv-trace-marker-title" }, marker.title),
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return h("div", { className: "trv-trace-metric", title: hint }, h("span", { className: "trv-trace-metric-label" }, label), h("strong", null, value));
}

function ToolRow({ call, onPick, active }: { call: TraceToolCall; onPick: () => void; active: boolean }) {
  const args = call.args.replace(/\s+/g, " ").slice(0, 90);
  const result = call.result.replace(/\s+/g, " ").slice(0, 90);
  return h(
    "button",
    { type: "button", className: `trv-trace-tool ${call.error ? "bad" : ""} ${active ? "on" : ""}`, onClick: onPick, title: "点击查看参数与结果全文" },
    h("span", { className: "trv-trace-tool-name" }, call.name),
    h("span", { className: "trv-trace-tool-args" }, args || "（无参数）"),
    h("span", { className: "trv-trace-tool-result" }, call.error ? `✗ ${result}` : result || "（无输出）"),
    h("span", { className: "trv-trace-tool-time" }, formatDuration(call.durationMs)),
  );
}

function StepBlock({
  request,
  selection,
  onSelect,
  query,
}: {
  request: TraceRequest;
  selection: Selection;
  onSelect: (next: Selection) => void;
  query: string;
}) {
  const tokens = request.promptTokens === null && request.completionTokens === null
    ? ""
    : `${formatTokens(request.promptTokens || 0)} → ${formatTokens(request.completionTokens || 0)}`;
  const reply = request.reply.replace(/\s+/g, " ");
  return h(
    "div",
    { className: "trv-trace-step" },
    h(
      "button",
      {
        type: "button",
        className: `trv-trace-request ${selection?.kind === "request" && selection.seq === request.seq ? "on" : ""}`,
        onClick: () => onSelect({ kind: "request", seq: request.seq }),
      },
      h("span", { className: "trv-trace-request-model" }, request.model || "模型未知"),
      h("span", { className: "trv-trace-request-endpoint" }, request.endpoint.replace(/^https?:\/\//, "")),
      h("span", { className: "trv-trace-request-time" }, formatDuration(request.durationMs)),
      tokens ? h("span", { className: "trv-trace-request-tokens" }, tokens) : null,
    ),
    reply ? h("div", { className: "trv-trace-reply" }, reply.slice(0, 160) || "") : null,
    request.tools.length
      ? h(
          "div",
          { className: "trv-trace-tools" },
          request.tools.map((call) =>
            h(ToolRow, {
              key: call.seq,
              call,
              active: selection?.kind === "tool" && selection.seq === call.seq,
              onPick: () => onSelect({ kind: "tool", seq: call.seq }),
            }),
          ),
        )
      : null,
  );
}

/** 右侧检查面板：预览 / 摘要 / 原文 三个页签（对齐官方的 request 详情） */
function Inspector({ model, selection, onClose }: { model: any; selection: Selection; onClose: () => void }) {
  const [tab, setTab] = React.useState<"preview" | "summary" | "raw">("preview");
  React.useEffect(() => { setTab("preview"); }, [selection?.kind, selection?.seq]);
  if (!selection) return null;

  let title = "";
  let preview = "";
  let summary = "";
  let raw = "";
  if (selection.kind === "request") {
    const request = model.requestsById.get(selection.seq) as TraceRequest | undefined;
    if (!request) return null;
    title = `请求 #${request.seq}`;
    preview = request.reply || request.prompt || "（无内容）";
    summary = [
      request.model ? `模型：${request.model}` : "",
      request.endpoint ? `端点：${request.endpoint}` : "",
      request.promptTokens !== null ? `输入 token：${formatTokens(request.promptTokens)}` : "",
      request.completionTokens !== null ? `输出 token：${formatTokens(request.completionTokens)}` : "",
      request.durationMs !== null ? `生成时长：${formatDuration(request.durationMs)}` : "",
      `工具调用：${request.tools.length} 次`,
    ].filter(Boolean).join("\n");
    raw = [request.raw.request?.content || "", request.raw.response?.content || ""].filter(Boolean).join("\n\n");
  } else {
    const call = model.toolsBySeq.get(selection.seq) as TraceToolCall | undefined;
    if (!call) return null;
    title = `工具 ${call.name} #${call.seq}`;
    preview = call.result || "（无输出）";
    summary = [
      `参数：${call.args}`.slice(0, 600),
      `结果：${call.result.slice(0, 600)}`,
      `耗时：${formatDuration(call.durationMs)}`,
      `状态：${call.error ? "失败" : "成功"}`,
    ].join("\n");
    raw = `参数原文：\n${call.args}\n\n结果原文：\n${call.result}`;
  }

  return h(
    "aside",
    { className: "trv-trace-inspector" },
    h(
      "header",
      null,
      h("strong", null, title),
      h(
        "span",
        { className: "trv-trace-inspector-actions" },
        h(
          "button",
          {
            type: "button",
            className: "plugins-text-button",
            title: "复制当前页签内容",
            onClick: () => {
              const body = tab === "preview" ? preview : tab === "summary" ? summary : raw;
              void navigator.clipboard?.writeText(body || "");
            },
          },
          "复制",
        ),
        h("button", { type: "button", className: "plugins-text-button", onClick: onClose }, "关闭"),
      ),
    ),
    h(
      "div",
      { className: "trv-trace-inspector-tabs" },
      (["preview", "summary", "raw"] as const).map((key) =>
        h("button", { key, type: "button", className: `plugin-category-chip ${tab === key ? "on" : ""}`, onClick: () => setTab(key) },
          key === "preview" ? "预览" : key === "summary" ? "摘要" : "原文"),
      ),
    ),
    h("pre", { className: "trv-trace-inspector-body" }, tab === "preview" ? preview : tab === "summary" ? summary : raw || "（没有保留原文）"),
  );
}

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
  // 模型只暴露 turns/markers/metrics；检查面板要按 seq 取原始对象，这里补两张索引
  const index = React.useMemo(() => {
    const requestsById = new Map<number, TraceRequest>();
    const toolsBySeq = new Map<number, TraceToolCall>();
    for (const turn of model.turns) {
      for (const step of turn.steps) {
        for (const request of step.requests) {
          requestsById.set(request.seq, request);
          for (const call of request.tools) toolsBySeq.set(call.seq, call);
        }
      }
    }
    return { requestsById, toolsBySeq };
  }, [model]);

  const [query, setQuery] = React.useState("");
  const [selection, setSelection] = React.useState<Selection>(null);
  const [focusTurn, setFocusTurn] = React.useState<number | null>(null);
  const scroller = React.useRef<HTMLDivElement | null>(null);

  const visible = model.turns.filter((turn) => traceMatches(turn, query));
  const { metrics } = model;

  const jumpTo = (turn: number) => {
    setFocusTurn(turn);
    const target = scroller.current?.querySelector(`[data-turn="${turn}"]`);
    if (target && "scrollIntoView" in target) (target as HTMLElement).scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return h(
    "div",
    { className: "trv-trace-view" },
    h(
      "div",
      { className: "trv-trace-view-toolbar" },
      h(Metric, { label: "生成时长", value: formatDuration(metrics.activeMs), hint: `墙钟跨度 ${formatDuration(metrics.spanMs)}` }),
      h(Metric, { label: "轮次", value: String(metrics.turns) }),
      h(Metric, { label: "调用", value: String(metrics.calls), hint: `${metrics.requests} 次模型请求` }),
      h(Metric, { label: "输入", value: formatTokens(metrics.promptTokens), hint: "累计输入 token" }),
      h(Metric, { label: "模型", value: metrics.models.length ? metrics.models.join(" / ") : "—" }),
      h(Metric, { label: "工具", value: String(metrics.tools.length), hint: metrics.tools.slice(0, 12).join("、") }),
      h(Metric, {
        label: "标记",
        value: String(model.markers.length),
        hint: `压缩 ${model.markers.filter((m) => m.kind === "compaction").length} · 结束 ${model.markers.filter((m) => m.kind === "session-end").length} · 计划 ${model.markers.filter((m) => m.kind === "plan-update").length}`,
      }),
      h(
        "label",
        { className: "trv-trace-view-search" },
        h("input", {
          value: query,
          placeholder: "搜索轨迹：输入、回复、工具、参数、结果",
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
        }),
        query ? h("button", { type: "button", className: "plugins-text-button", onClick: () => setQuery("") }, "清除") : null,
      ),
      onClose ? h("button", { type: "button", className: "plugins-text-button", onClick: onClose }, "收起") : null,
    ),

    metrics.turns ? h(DurationBars, { turns: model.turns, current: focusTurn, onPick: jumpTo }) : null,

    h(
      "div",
      { className: "trv-trace-view-body" },
      h(
        "div",
        { className: "trv-trace-view-scroll", ref: scroller },
        !model.turns.length
          ? h("p", { className: "plugins-empty" }, sessionId ? "这个会话还没有轨迹记录（发起任务后就会出现）。" : "先选一个会话。")
          : visible.length === 0
            ? h("p", { className: "plugins-empty" }, "没有匹配的轨迹，换个关键词试试。")
            : visible.map((turn) =>
                h(
                  "section",
                  { className: `trv-trace-turn ${focusTurn === turn.turn ? "on" : ""}`, key: turn.turn, "data-turn": turn.turn },
                  h(
                    "header",
                    { className: "trv-trace-turn-head" },
                    h("span", { className: "trv-trace-turn-no" }, `Turn ${turn.turn}`),
                    h("span", { className: "trv-trace-turn-time" }, formatDuration(turn.durationMs)),
                    turn.toolCount ? h("span", { className: "trv-trace-turn-tools" }, `${turn.toolCount} 次调用`) : null,
                  ),
                  turn.prompt
                    ? h("div", { className: "trv-trace-user" }, h("span", { className: "trv-trace-role user" }, "USER"), h("span", { className: "trv-trace-text" }, turn.prompt.slice(0, 220)))
                    : null,
                  turn.reply
                    ? h("div", { className: "trv-trace-assistant" }, h("span", { className: "trv-trace-role assistant" }, "ASSISTANT"), h("span", { className: "trv-trace-text" }, turn.reply.slice(0, 220)))
                    : null,
                  turn.steps.flatMap((step) =>
                    step.requests.map((request) =>
                      h(StepBlock, { key: request.seq, request, selection, onSelect: setSelection, query }),
                    ),
                  ),
                  // 轮内标记（压缩/计划/文件变更/结束）跟着这一轮走，不再全堆在列表末尾
                  (model.markersByTurn.get(turn.turn) || []).map((marker) =>
                    h(Marker, { key: `m-${marker.kind}-${marker.seq}`, marker }),
                  ),
                ),
              ),
        model.sessionMarkers.length
          ? h(
              "div",
              { className: "trv-trace-markers" },
              model.sessionMarkers.map((marker) => h(Marker, { key: `s-${marker.kind}-${marker.seq}`, marker })),
            )
          : null,
      ),
      h(Inspector, { model: index, selection, onClose: () => setSelection(null) }),
    ),
  );
}
