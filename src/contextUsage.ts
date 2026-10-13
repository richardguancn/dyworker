interface AttachmentLike {
  size?: number;
  isImage?: boolean;
  name?: string;
  path?: string;
  mimeType?: string;
}

interface MessageLike {
  content?: string;
  attachments?: AttachmentLike[];
  role?: string;
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
    if (message.role === 'assistant') continue;
    for (const attachment of message.attachments || []) {
      const bytes = Math.max(0, Number(attachment.size) || 0);
      const textFile = attachment.mimeType?.startsWith('text/') || /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|jsx|ts|tsx|py|sql|yaml|yml|log)$/i.test(attachment.path || attachment.name || '');
      // 大文件及办公附件发送的是说明/文件引用，不能把整份二进制文件大小计入窗口。
      tokens += attachment.isImage ? (bytes <= 12 * 1024 * 1024 ? 1024 : 64)
        : textFile && bytes <= 2 * 1024 * 1024 ? Math.ceil(bytes / 4) : 64;
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
