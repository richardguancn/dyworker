type Reply = {
  role: string;
  content?: unknown;
  tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
};

// 更新已完成的计划、保存记忆、保存或更新工作模板只是在收尾，不应把同轮的完整答复降为过程说明。
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
      if (["save_memory", "save_skill", "update_skill"].includes(call.function?.name || "")) return true;
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
  const warningIndex = finalText.indexOf("\n\n> ⚠️ **系统核验提示**：");
  const warning = warningIndex >= 0 ? finalText.slice(warningIndex) : "";
  // 正式交付明确声明答案来源；不以先后顺序、篇幅或工具种类推断哪段更完整。
  // previous_reply 仅允许引用紧邻结束前、没有后续实际操作的非空收尾轮。
  if (terminalCalls.length === 1) {
    try {
      const args = JSON.parse(terminalCalls[0].function?.arguments || "{}");
      const source = args.answer_source;
      const index = promotedReplyIndexes.at(-1);
      const selected = source === "current_reply" ? replies.at(-1)?.content
        : source === "summary" ? args.summary
        : source === "previous_reply" && index !== undefined ? replies[index].content : null;
      if (typeof selected === "string" && selected.trim()) {
        return {
          text: selected.trim() + warning,
          promotedReplyIndexes: source === "previous_reply" ? [index!] : [],
        };
      }
    } catch { /* 旧记录或无效声明不能导致内容丢失。 */ }
  }
  // 未声明来源的交付（旧存档，或模型没写 answer_source）：正文只取"最完整的一段"。
  // 旧存档的 message.content 是运行期把收尾轮与末轮拼起来的结果，先按当时的拼接规则拆回分段，
  // 再逐段比长度：拼着显示会把同一份结论说两遍（用户看到的"两段完成回复"），
  // 只按先后顺序取又会把完整正文留在过程里（此前踩过的"答复被收尾话挤走"）。
  // 没选中的段落不进正文，但仍留在过程里可以展开，不删任何内容。
  if (!parts.length) return { text: finalText, promotedReplyIndexes };
  let tail = (warningIndex >= 0 ? finalText.slice(0, warningIndex) : finalText).trim();
  let storedJoin = "";
  for (const part of parts) {
    if (!part || storedJoin.includes(part)) continue;
    storedJoin = part.includes(storedJoin) ? part : `${storedJoin}\n\n${part}`;
  }
  if (storedJoin && tail.startsWith(storedJoin)) tail = tail.slice(storedJoin.length).trim();
  const candidates = [
    ...promotedReplyIndexes.map((index, offset) => ({ index, text: parts[offset] })),
    ...(tail ? [{ index: undefined as number | undefined, text: tail }] : []),
  ];
  const chosen = candidates.reduce((best, item) => (item.text.length > best.text.length ? item : best));
  return {
    text: `${chosen.text}${warning}`.trim(),
    promotedReplyIndexes: chosen.index === undefined ? [] : [chosen.index],
  };
}
