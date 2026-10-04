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
export function buildSessionEvents(
  messages: any[],
  options: { baseTime?: number; provider?: string; model?: string } = {},
): DshSessionEvent[] {
  const events: DshSessionEvent[] = [];
  const base = Number.isFinite(options.baseTime) ? Number(options.baseTime) : Date.now();
  let seq = 0;
  let turn = 0;
  let step = 0;
  let time = base;

  // DSH 的 message.content 是**内容块数组**（插件会直接遍历它；
  // 传字符串会抛 "content is not iterable"）。字符串统一包成文本块。
  const asContent = (content: any): any[] => {
    if (Array.isArray(content)) return content;
    if (typeof content === "string" && content) return [{ type: "text", text: content }];
    return [];
  };

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
      // source.kind 是插件判定"用户输入 vs 注入内容"的依据（trajectory-input-message 直接读它）
      // 注意：插件读的是**顶层 data.content**（不是 data.message.content），
      // 且必须是内容块数组——缺了会在渲染期抛 "content is not iterable"。
      push("user/message", {
        id: String(message?.id || `user-${seq + 1}`),
        content: asContent(message?.content),
        message: { role: "user", content: asContent(message?.content) },
        source: { kind: String(message?.source?.kind || "user") },
      });
      continue;
    }

    if (role === "assistant") {
      turn += 1;
      step += 1;
      push("step/start", { turn, step });
      // source/message.id 是**必需**的：插件装配节点时直接读
      // event.data.message.source.provider/model，缺了它会抛错、节点全丢
      // （实测就是这里导致 eventNodes 一直是 0）。拿不到真实值时如实写 unknown。
      const source = message?.source || {
        provider: String(message?.provider || options.provider || "unknown"),
        model: String(message?.model || options.model || "unknown"),
      };
      // turn/step 与 usage 都是插件装配时的**必读**字段：
      //   match 用 data.turn:data.step 生成节点 key（缺了就是 undefined:undefined）
      //   finalNode 直接读 data.usage（缺了会抛错、节点全丢）
      push("assistant/message", {
        turn,
        step,
        usage: message?.usage && typeof message.usage === "object"
          ? message.usage
          : { input: 0, output: 0 },
        message: {
          id: String(message?.id || `assistant-${seq + 1}`),
          role: "assistant",
          content: asContent(message?.content),
          source,
          ...(Array.isArray(message?.tool_calls) && message.tool_calls.length ? { tool_calls: message.tool_calls } : {}),
        },
      });
      // 助手发起的工具调用要单独发 tool/call：插件的工具定义靠它建"调用节点"，
      // 没有它后面的 tool/result 就没有可更新的目标（视图里工具那一段会整段消失）
      for (const call of Array.isArray(message?.tool_calls) ? message.tool_calls : []) {
        const callId = String(call?.id || call?.function?.name || `call-${seq + 1}`);
        push("tool/call", {
          callId,
          toolName: String(call?.function?.name || call?.name || "tool"),
          arguments: call?.function?.arguments ?? "{}",
        });
      }
      push("step/end", { turn, step });
      // 每条助手消息都收一轮：插件的 turn-end 定义按 turn 装配节点，
      // 只在末尾补一条的话前面所有轮次都不会产出节点（实测 eventNodes 为 0）
      // reason 也是必读：插件按 reason.kind === "error" 决定是否标记错误
      push("turn/end", { turn, reason: { kind: "completed" } });
      continue;
    }

    if (role === "tool") {
      // 工具结果：插件按 tool/result 装配到对应调用上
      // 结果要包成**消息**，且 source.callId 与 tool/call 的 callId 对应
      // （插件的 match 直接读 event.data.message.source.callId）
      const callId = String(message?.tool_call_id || message?.toolName || message?.name || "call");
      push("tool/result", {
        callId,
        message: {
          role: "tool",
          content: asContent(message?.content),
          source: { callId, ...(message?.toolName ? { toolName: message.toolName } : {}) },
        },
      });
      continue;
    }

    if (role === "system") {
      // 系统提示词不进轨迹视图（DSH 里它属于上下文面板），这里只记一条便于排查
      push("system/message", { message: { role: "system", content: asContent(message?.content) } });
    }
  }

  return events;
}
