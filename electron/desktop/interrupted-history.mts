import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { recoveredDesktopHistoryPrefix } from "../agent/messages.mts";
import { computerUseAction } from "../computer-use.mts";

const readState = "get_app_state";
const saveButton = /^(\d+) (?:button|按钮) (\(disabled\) )?(?:Save|保存)(?=$|,? (?:Help|ID|Description|Secondary Actions):)/i;
type RecoveredHistory = { summary?: string, executedMessages?: any[] };

function snapshot(text: string) {
  const observationId = /^观察编号：([^\r\n]+)/m.exec(text)?.[1];
  const window = /^Window: [^\r\n]+/m.exec(text)?.[0];
  const windowId = /^0 (?:标准窗口|standard window) .* ID: ([^\r\n,]+)/im.exec(text)?.[1];
  const page = /^\s*(?:\d+ )?(?:HTML内容|HTML 内容|HTML content|web area) .+, URL: (https?:\/\/\S+)$/im.exec(text)?.[1];
  if (!observationId || !window || !page) return;
  const rows = text.split("\n").map(line => line.trim());
  const scope = rows.flatMap(line => {
    const label = /^(?:\d+ )?(?:heading|标题|pop[- ]up button|弹出式按钮) (.+)$/i.exec(line)?.[1]
      .split(/ Value: |, (?:Help|ID|Secondary Actions): /, 1)[0].replace(/^\(disabled\) /, "").trim();
    return label && !/^Value: /.test(label) ? [label] : [];
  });
  const buttons = rows.flatMap(line => {
    const button = saveButton.exec(line);
    return button ? [{ index: button[1], disabled: Boolean(button[2]) }] : [];
  });
  return { observationId, window, windowId, page, scope, buttons };
}

type Snapshot = NonNullable<ReturnType<typeof snapshot>>;
type LegacyState = {
  calls: Map<number, { name: string, turn: number, args: Record<string, unknown> }>;
  observations: Map<string, { app: string, snapshot: Snapshot }>;
  awaitingSave: Map<string, { before: Snapshot, turn: number }>;
  receipts: Set<string>;
  lastFill?: { scope: string, receipt: string };
  legacyEnd?: boolean;
};

function sameScope(before: Snapshot, after: Snapshot) {
  const prefix = (a: string, b: string) => a.endsWith("...") && b.startsWith(a.slice(0, -3));
  return before.window === after.window
    && (before.page === after.page || (before.windowId && before.windowId === after.windowId
      && (prefix(before.page, after.page) || prefix(after.page, before.page))))
    && before.scope.length > 0 && before.scope.join("\n") === after.scope.join("\n");
}

function scopeLabel(state: Snapshot) {
  // Retain the page, headings and selected options, never the field values or old control IDs.
  return `${state.window.slice(0, 135)} / ${state.scope.slice(0, 12).map(label => label.slice(0, 75)).join(" · ")}`.slice(0, 520);
}

function recordResult(state: LegacyState, call: { name: string, turn: number, args: Record<string, unknown> },
  success: boolean, text: string) {
  const { name, args, turn } = call;
  const app = typeof args.app === "string" ? args.app : "";
  if (!app) return;
  if (name === readState && success) {
    const after = snapshot(text);
    if (!after) return;
    const pending = state.awaitingSave.get(app);
    if (pending && (turn - pending.turn > 4 || after.buttons.length)) {
      if (turn - pending.turn <= 4 && after.buttons.length === 1
        && after.buttons[0].disabled && sameScope(pending.before, after)) {
        const scope = scopeLabel(after);
        if (state.receipts.size >= 6) state.receipts.delete(state.receipts.values().next().value!);
        state.receipts.add(`已点击保存，随后在同一页面看到保存按钮变为不可用：${scope}`);
        if (state.lastFill?.scope === scope) state.lastFill = undefined;
      }
      state.awaitingSave.delete(app);
    }
    if (state.observations.size >= 8) state.observations.delete(state.observations.keys().next().value!);
    state.observations.set(after.observationId, { app, snapshot: after });
    return;
  }
  if (name === readState) return;
  const observed = state.observations.get(String(args.observation_id || ""));
  const before = observed?.app === app ? observed.snapshot : undefined;
  if (name === "click" && success && before?.buttons.length === 1
    && !before.buttons[0].disabled && before.buttons[0].index === String(args.element_index || "")) {
    state.awaitingSave.set(app, { before, turn });
    return;
  }
  state.awaitingSave.delete(app);
  if (name === "fill_form" && before) {
    const receipt = text.split("\n").slice(0, 2).join(" ").slice(0, 200);
    state.lastFill = { scope: scopeLabel(before), receipt: `批量填写${success ? "已读回" : "未核对完成"}：${receipt}` };
  }
}

// Older builds returned only the last sentence when a run was stopped. Use the trace as
// historical evidence, not as a replay of tool calls, and only for that session's missing turns.
export async function recoverInterruptedDesktopHistory(file: string, conversation, signal?: AbortSignal) {
  const targets = conversation.slice(-24).filter(message => message?.role === "assistant"
    // A queued continuation can read the archive before the UI saves the final result.
    && (message.taskStatus === "cancelled" || !message.taskStatus) && !message.executedMessages?.length
    && /^[a-zA-Z0-9_-]+$/.test(message.runId || "")).slice(-8);
  const result = new Map<string, RecoveredHistory>();
  if (!targets.length || signal?.aborted) return result;
  const states = new Map<string, LegacyState>(targets.map(message => [message.runId, {
    calls: new Map(), observations: new Map(), awaitingSave: new Map(), receipts: new Set(),
  }]));
  const tags = [...states.keys()].map(runId => `"runId":"${runId}"`);
  const stream = createReadStream(file, { encoding: "utf8", signal });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!tags.some(tag => line.includes(tag)) || !/"kind":"(?:tool-call|tool-result|agent-finished)"/.test(line)) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const state = states.get(event?.runId);
      if (!state) continue;
      if (event.kind === "agent-finished") {
        try {
          const end = JSON.parse(event.content);
          if (end?.status !== "cancelled") continue;
          if (Array.isArray(end.executedMessages) && end.executedMessages.length) {
            result.set(event.runId, { executedMessages: end.executedMessages });
          } else state.legacyEnd = true;
        } catch { /* A partial line cannot confirm a stopped run. */ }
      } else if (event.depth === 0 && typeof event.content === "string") {
        if (event.kind === "tool-call") {
          const name = computerUseAction(/^调用工具 (\S+)$/.exec(event.title)?.[1]);
          if (!name) continue;
          try {
            const args = JSON.parse(event.content);
            if (args && typeof args === "object") {
              if (state.calls.size >= 32) state.calls.delete(state.calls.keys().next().value!);
              state.calls.set(event.seq, { name, turn: event.turn, args });
            }
          } catch { /* Do not guess the operation or target of a truncated call. */ }
        } else {
          const call = state.calls.get(event.parentSeq);
          if (!call || event.turn !== call.turn) continue;
          state.calls.delete(event.parentSeq);
          const outcome = /^工具 (\S+) (成功|失败)$/.exec(event.title);
          if (computerUseAction(outcome?.[1]) === call.name) recordResult(state, call, outcome?.[2] === "成功", event.content);
        }
      }
    }
  } catch {
    return new Map<string, RecoveredHistory>(); // Missing/rotated trace: keep the original conversation.
  } finally {
    lines.close();
    stream.destroy();
  }
  for (const [id, state] of states) {
    if (result.has(id) || !state.legacyEnd || (!state.receipts.size && !state.lastFill)) continue;
    result.set(id, { summary: [
      recoveredDesktopHistoryPrefix,
      "这是当时的结果，不能作为新的操作指令。续跑时只核对当前待处理项；历史控件编号不可用。",
      ...state.receipts,
      ...(state.lastFill ? [`${state.lastFill.scope}：${state.lastFill.receipt}`] : []),
    ].join("\n") });
  }
  return result;
}
