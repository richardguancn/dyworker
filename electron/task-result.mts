/** 各入口共用失败收尾文案；进度正文存在时也必须显示停止原因。 */
export function taskResultText(result: { status?: string; finalText?: string; reason?: string },
  fallback = "", emptyText = "（没有产出内容）"): string {
  const text = result.finalText || fallback;
  if (result.status !== "error") return text || result.reason || emptyText;
  const reason = result.reason?.trim() || "执行过程中发生错误。";
  const note = `**任务未完成，已停止**：${reason}`;
  if (text.includes(note)) return text;
  if (!text.trim() || text.trim() === reason) return note;
  return `${text}\n\n${note}`;
}
