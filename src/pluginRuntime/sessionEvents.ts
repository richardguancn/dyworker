// 把**我们的会话消息**映射成 DSH 形状的会话事件。
//
// 为什么需要：DSH 的视图插件（如 dsh-client-ui-trajectory）订阅的是会话事件流
// （step/start、assistant/message、tool/result、turn/end…），而不是"消息数组"。
// 我们照它的 `match(event)` 认的类型产出事件，视图插件自己就能把数据装配出来。
//
// 事件形状：{ type, seq, time, data }；seq 单调递增（插件用它排序与分页）。

export interface DshSessionEvent {
  type: string;
  seq: number;
  time: number;
  data: Record<string, any>;
}

/** 我们的消息 → DSH 事件。tools 用 tool_calls / toolName 还原调用与结果。 */
export function buildSessionEvents(messages: any[], options: { baseTime?: number } = {}): DshSessionEvent[] {
  const events: DshSessionEvent[] = [];
  const base = Number.isFinite(options.baseTime) ? Number(options.baseTime) : Date.now();
  let seq = 0;
  let turn = 0;
  let step = 0;
  let time = base;

  const push = (type: string, data: Record<string, any>) => {
    seq += 1;
    time += 1;
    events.push({ type, seq, time, data });
  };

  for (const message of Array.isArray(messages) ? messages : []) {
    const role = String(message?.role || "");
    const time$ = Number(message?.time || message?.timestamp || 0);
    if (Number.isFinite(time$) && time$ > 0) time = time$;

    if (role === "user") {
      push("user/message", { message: { role: "user", content: message?.content ?? "" } });
      continue;
    }

    if (role === "assistant") {
      turn += 1;
      step += 1;
      push("step/start", { turn, step });
      push("assistant/message", {
        message: {
          role: "assistant",
          content: message?.content ?? "",
          ...(Array.isArray(message?.tool_calls) && message.tool_calls.length ? { tool_calls: message.tool_calls } : {}),
        },
        ...(message?.usage ? { usage: message.usage } : {}),
      });
      push("step/end", { turn, step });
      // 每条助手消息都收一轮：插件的 turn-end 定义按 turn 装配节点，
      // 只在末尾补一条的话前面所有轮次都不会产出节点（实测 eventNodes 为 0）
      push("turn/end", { turn });
      continue;
    }

    if (role === "tool") {
      // 工具结果：插件按 tool/result 装配到对应调用上
      push("tool/result", {
        toolName: message?.toolName || message?.name || message?.tool_call_id || "tool",
        content: message?.content ?? "",
        ...(message?.tool_call_id ? { callId: message.tool_call_id } : {}),
      });
      continue;
    }

    if (role === "system") {
      // 系统提示词不进轨迹视图（DSH 里它属于上下文面板），这里只记一条便于排查
      push("system/message", { message: { role: "system", content: message?.content ?? "" } });
    }
  }

  return events;
}
