// 渠道（QQ/微信）会话的流式气泡归约助手（纯函数，渲染端与单测共用）。
//
// 背景：渠道任务运行期间，主进程把关键 agent 事件以 { sessionId, runId, channelRun: true, event }
// 信封实时转发过来，渲染端据此维护一个流式占位气泡；任务收尾时主进程再 sessions:append
// 最终落库消息（带同一 runId）。不做归约的话，同一条助手回复会在桌面会话里显示两次。
// 另外桌面端在渠道会话里直接发起的运行也走 agent:event（没有 channelRun 标记），
// 渠道归约器必须把它拒之门外，否则桌面运行也会被复制出一个气泡。

// 流式占位气泡登记：runId → 占位消息位置
export interface ChannelStreamRef {
  sessionId: string;
  messageId: string;
}

export type ChannelStreamRuns = Map<string, ChannelStreamRef>;

// 只消费渠道运行转发的事件；桌面端 runTask 的信封不带 channelRun 字段
export function isChannelRunEnvelope(envelope: unknown): boolean {
  return Boolean(envelope) && (envelope as { channelRun?: unknown }).channelRun === true;
}

export function registerStreamMessage(runs: ChannelStreamRuns, runId: string, ref: ChannelStreamRef): void {
  if (!runId) return;
  runs.set(runId, ref);
}

export function forgetStreamMessage(runs: ChannelStreamRuns, runId: string): void {
  runs.delete(runId);
}

// 会话维度清理（兜底：运行异常结束、没有等到收尾 append 时调用方按会话清）
export function forgetSessionStream(runs: ChannelStreamRuns, sessionId: string): void {
  for (const [runId, ref] of runs) {
    if (ref.sessionId === sessionId) runs.delete(runId);
  }
}

// 取走一次 runId 对应的占位位置（delete-on-read）：收尾 append 只能替换一次，
// 同一 runId 的后续 append 退化为普通追加。必须在 setState updater 外调用——
// updater 在 StrictMode 下会被双调，映射清理放里面会导致两次归约结果不一致。
export function takeStreamMessage(runs: ChannelStreamRuns, runId: string): ChannelStreamRef | null {
  if (!runId) return null;
  const ref = runs.get(runId) || null;
  if (ref) runs.delete(runId);
  return ref;
}

interface AppendMessage {
  id?: string;
}

// 收尾消息落库归约（纯函数，可安全放进 setState updater）：
// placeholderMessageId 命中消息列表 → 原位替换（保留占位 id，React key 与「已处理」折叠
// 状态稳定）；未命中（无占位、桌面运行、占位已被清掉）→ 原样追加。
export function reconcileChannelAppend<T extends AppendMessage>(
  messages: T[],
  placeholderMessageId: string | null,
  incoming: T[],
): { messages: T[]; replacedMessageId: string | null } {
  const index = placeholderMessageId ? messages.findIndex((message) => message.id === placeholderMessageId) : -1;
  if (index < 0) {
    return { messages: [...messages, ...incoming], replacedMessageId: null };
  }
  const replacement = incoming.map((message, offset) => ({
    ...message,
    id: offset === 0 ? placeholderMessageId! : message.id,
  }));
  return {
    messages: [...messages.slice(0, index), ...replacement, ...messages.slice(index + 1)],
    replacedMessageId: placeholderMessageId,
  };
}
