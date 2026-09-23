import type { MessageAnnotation } from "./types";

const QUOTE_MAX_LENGTH = 2000;

// 选区文本往往带换行/缩进等多余空白，落库与展示前先归一化
export function normalizeQuote(text: string): string {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, QUOTE_MAX_LENGTH);
}

// 拼进发给模型的 content：引用文本与评论都进入正文，模型据此理解用户意图
export function formatAnnotationsForPrompt(annotations: MessageAnnotation[]): string {
  if (!annotations.length) return "";
  const lines = annotations.map((annotation, index) => {
    const quote = `  ${index + 1}. 所选文本：「${annotation.quote}」`;
    const comment = annotation.comment.trim()
      ? `\n     评论：${annotation.comment.trim()}`
      : "";
    return quote + comment;
  });
  return `\n\n【引用注释】\n${lines.join("\n")}`;
}
