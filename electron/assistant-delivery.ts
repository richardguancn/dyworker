type Reply = {
  role: string;
  content?: unknown;
  tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
};

// 更新已完成的计划、保存记忆只是在收尾，不应把同轮的完整答复降为过程说明。
// 只取最终回复前连续的收尾轮；后面还有实际操作、计划未完成或参数不完整时不提升。
export function resolveAssistantDelivery(messages: Reply[], finalText: string) {
  const replies = messages.filter(entry => entry.role === "assistant");
  const terminalCalls = replies.at(-1)?.tool_calls || [];
  if (!replies.length || terminalCalls.some(call => call.function?.name !== "finish_task")) {
    return { text: finalText, promotedReplyIndexes: [] as number[] };
  }
  const promotedReplyIndexes: number[] = [];
  for (let index = replies.length - 2; index >= 0; index--) {
    const calls = replies[index].tool_calls || [];
    if (!calls.length || !calls.every(call => {
      if (call.function?.name === "save_memory") return true;
      if (call.function?.name !== "update_plan") return false;
      try {
        const steps = JSON.parse(call.function.arguments || "{}").steps;
        return Array.isArray(steps) && steps.length > 0 && steps.every(step => step.status === "completed");
      } catch {
        return false;
      }
    })) break;
    const content = replies[index].content;
    if (typeof content === "string" && content.trim()) {
      promotedReplyIndexes.unshift(index);
    }
  }
  const parts = promotedReplyIndexes.map(index => (replies[index].content as string).trim());
  parts.push(finalText.trim());
  let text = "";
  for (const part of parts) {
    if (!part || text.includes(part)) continue;
    text = part.includes(text) ? part : `${text}\n\n${part}`;
  }
  return { text, promotedReplyIndexes };
}
