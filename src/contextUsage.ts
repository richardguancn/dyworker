interface AttachmentLike {
  size?: number;
  isImage?: boolean;
}

interface MessageLike {
  content?: string;
  attachments?: AttachmentLike[];
}

export function formatTokenCount(value: number) {
  const safe = Math.max(0, Math.round(Number(value) || 0));
  if (safe >= 1_000_000) {
    const millions = safe / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`;
  }
  if (safe >= 1000) return `${Math.round(safe / 1000)}k`;
  return String(safe);
}

export function estimateTextTokens(text: string) {
  if (!text) return 0;
  const cjk = (text.match(/[　-鿿豈-﫿︰-﹏＀-￯]/g) || []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

export function estimateSessionTokens(messages: MessageLike[], workingContext = "") {
  let tokens = 3;
  tokens += estimateTextTokens(String(workingContext || ""));
  for (const message of messages || []) {
    tokens += 4 + estimateTextTokens(String(message.content || ""));
    for (const attachment of message.attachments || []) {
      tokens += attachment.isImage ? 1024 : Math.ceil(Math.max(0, Number(attachment.size) || 0) / 4);
    }
  }
  return tokens;
}

export function contextUsageSummary(used: number, limit: number) {
  const safeUsed = Math.max(0, Math.round(Number(used) || 0));
  const safeLimit = Math.max(1, Math.round(Number(limit) || 1));
  const ratio = Math.min(1, safeUsed / safeLimit);
  const percent = Math.round(ratio * 100);
  return {
    ratio,
    percent,
    percentLabel: safeUsed > 0 && percent === 0 ? "不足 1%" : `${percent}%`,
    usedLabel: formatTokenCount(safeUsed),
    limitLabel: formatTokenCount(safeLimit),
  };
}
