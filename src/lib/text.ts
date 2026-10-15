// 文本处理与会话摘要工具。原先内联在 App.tsx，消息渲染、输入框镜像、技能提炼共用。
// 除 copyTextToClipboard（剪贴板）外都是纯函数。
import { createConversationIndex, createTextCache } from "../performanceCache";
import { formatMessageTime } from "./format";
import type { ChatMessage, SessionRecord } from "../types";

// 项目会话列表默认最多平铺的条数，超出后折叠为「展开显示」。
export const WORKSPACE_SESSION_LIMIT = 5;

export function displayWorkspace(path: string) {
  if (!path) return "选择工作文件夹";
  const chunks = path.split(/[\\/]/).filter(Boolean);
  return chunks.at(-1) || path;
}

export function pathDirname(filePath: string) {
  const index = filePath.lastIndexOf("/");
  return index > 0 ? filePath.slice(0, index) : filePath;
}

export function shortTitle(content: string) {
  const title = content.replace(/[#*`>\n]/g, " ").replace(/\s+/g, " ").trim();
  return title.length > 28 ? `${title.slice(0, 28)}…` : title || "新任务";
}

// @「标题」会话引用发给模型时的上下文块：标题/id/更新时间 + 最近几条对话摘要。
// 只内联尾部摘要（单条 400 字、总预算 1600 字），更早的内容让模型按 id 用
// read_session 工具自取，避免整段历史灌进上下文（对齐 session-tools.mts 的体积护栏）
const SESSION_REF_MESSAGE_CHARS = 400;
const SESSION_REF_TOTAL_CHARS = 1600;

export function formatSessionReference(session: SessionRecord): string {
  const messages = session.messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.content.trim())
    .map((message) => ({ role: message.role, text: message.content.replace(/\s+/g, " ").trim() }));
  // 从最新往前取，超预算即止，最后倒回时间顺序
  const picked: typeof messages = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = messages[i].text.length > SESSION_REF_MESSAGE_CHARS
      ? `${messages[i].text.slice(0, SESSION_REF_MESSAGE_CHARS)}…`
      : messages[i].text;
    if (picked.length && used + text.length > SESSION_REF_TOTAL_CHARS) break;
    used += text.length;
    picked.push({ ...messages[i], text });
  }
  picked.reverse();
  const lines = picked.map((item) => `[${item.role === "user" ? "用户" : "助手"}] ${item.text}`);
  return [
    `【引用会话「${session.title}」｜id=${session.id}｜更新于 ${formatMessageTime(session.updatedAt)}｜共 ${session.messages.length} 条消息】`,
    ...lines,
    `以上是尾部摘要；需要该会话更早的完整上下文时，用 read_session 工具按 sessionId=${session.id} 读取。`,
  ].join("\n");
}

// 模型偶尔会把其他 agent 框架的控制标记（如 ::git-stage{cwd="..."}）原样输出到回复里，
// 展示、复制、生成标题时都应当过滤掉，避免用户看到原始指令文本。
const CONTROL_MARKER_PATTERN = /::[a-zA-Z][\w‐‑‒–—-]*(?:\{[^{}]*\})?/g;

export function plainConversationText(content: string) {
  return content
    .replace(CONTROL_MARKER_PATTERN, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripControlMarkers(text: string) {
  const stripped = String(text || "")
    .replace(CONTROL_MARKER_PATTERN, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripped || String(text || "").trim();
}

// 字符串按值比较；缓存只节省文字清理，不承担 Markdown 子组件的更新隔离。
const strippedTextCache = createTextCache();

export function stripControlMarkersCached(text: string) {
  return strippedTextCache.get(String(text || ""), stripControlMarkers);
}

export function messageVisibleText(message: ChatMessage) {
  return stripControlMarkersCached(message.displayContent ?? message.content);
}

export async function copyTextToClipboard(content: string) {
  if (!content) return false;
  try {
    if (window.dyworker?.writeClipboardText) {
      const result = await window.dyworker.writeClipboardText(content);
      if (result.ok) return true;
    }
  } catch {
    // 主进程剪贴板不可用时继续尝试渲染端方案。
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content);
      return true;
    }
  } catch {
    // Electron 的剪贴板权限被系统拦截时，继续尝试兼容方案。
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

export function conversationTurnPreview(userMessage: ChatMessage, assistant?: ChatMessage) {
  const userText = plainConversationText(userMessage.displayContent ?? userMessage.content);
  const assistantText = plainConversationText(assistant?.content || "");
  const title = shortTitle(userText);
  const detail = userText.length > title.length
    ? userText.slice(title.length).trim()
    : assistantText || (userMessage.attachments?.length ? `包含 ${userMessage.attachments.length} 个附件` : "本轮对话");
  return {
    title,
    detail: detail.length > 140 ? `${detail.slice(0, 140)}…` : detail,
  };
}

export const indexConversation = createConversationIndex(conversationTurnPreview);

export function latestWorkingContext(messages: ChatMessage[]): string | undefined {
  const message = [...messages].reverse().find((item) => Object.prototype.hasOwnProperty.call(item, "workingContext"));
  return message ? message.workingContext : undefined;
}

// 把文本中的 @文件名、@「会话标题」 与 /技能名 token 渲染成内联高亮（输入框镜像与用户气泡共用）：
// 引用文件/技能/会话按输入顺序随正文展示，而不是单独堆成一排 chip
export const FILE_TOKEN_REGEX = /@([^\s@]+)/g;
// /技能名 遇空格、@ 或下一个 / 即止；@文件名 允许携带路径（如 @src/pages/list）
export const SKILL_TOKEN_REGEX = /\/([^\s/@]+)/g;
export const INLINE_TOKEN_REGEX = /(@[^\s@]+|\/[^\s/@]+)/g;
// @「标题」会话引用 token：会话标题可含空格，用全角括号定界才能与后续正文无歧义地切分
export const SESSION_TOKEN_REGEX = /@「([^「」@]+)」/g;

// 正文里出现的 /token 名字集合：判断技能引用是否已内联在正文中
export function skillTokensInText(text: string): Set<string> {
  const names = new Set<string>();
  SKILL_TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SKILL_TOKEN_REGEX.exec(text))) names.add(match[1]);
  return names;
}

// ===== 会话「总结为工作模板」 =====
// 转录与导出 Markdown 一致用 displayContent（折叠长粘贴）；超限时按消息边界
// 保留头尾（头留原始需求、尾留最终做法），中间省略。
const SKILL_TRANSCRIPT_LIMIT = 24000;
const SKILL_TRANSCRIPT_HEAD = 6000;

export function buildSkillSummaryTranscript(session: SessionRecord) {
  const parts: string[] = [];
  for (const message of session.messages) {
    const body = (message.displayContent || message.content || "").trim();
    if (!body) continue;
    const speaker = message.role === "user" ? "【用户】" : message.role === "assistant" ? "【助手】" : "【系统】";
    const skillsLine = message.skillsUsed?.length ? `\n（使用技能：${message.skillsUsed.join("、")}）` : "";
    parts.push(`${speaker}${body}${skillsLine}`);
  }
  const full = parts.join("\n\n");
  if (full.length <= SKILL_TRANSCRIPT_LIMIT) return full;
  const headParts: string[] = [];
  let headUsed = 0;
  for (const part of parts) {
    if (headParts.length && headUsed + part.length > SKILL_TRANSCRIPT_HEAD) break;
    if (!headParts.length && part.length > SKILL_TRANSCRIPT_HEAD) {
      // 第一条消息就超头预算：硬截，保证头部始终留有上下文
      headParts.push(part.slice(0, SKILL_TRANSCRIPT_HEAD));
      headUsed = SKILL_TRANSCRIPT_HEAD;
      break;
    }
    headParts.push(part);
    headUsed += part.length + 2;
  }
  const tailBudget = SKILL_TRANSCRIPT_LIMIT - SKILL_TRANSCRIPT_HEAD;
  const tailParts: string[] = [];
  let tailUsed = 0;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (tailParts.length && tailUsed + part.length > tailBudget) break;
    if (!tailParts.length && part.length > tailBudget) {
      tailParts.unshift(part.slice(part.length - tailBudget));
      tailUsed = tailBudget;
      break;
    }
    tailParts.unshift(part);
    tailUsed += part.length + 2;
  }
  const kept = headParts.join("\n\n").length + tailParts.join("\n\n").length;
  return [...headParts, `……（中间省略约 ${Math.max(full.length - kept, 0)} 字）……`, ...tailParts].join("\n\n");
}

// chat:complete 会丢弃 system 消息，提炼指令全部折叠进这一条 user 消息；
// 不传 session，避免侧边聊天的检索工具与提示词污染 JSON 输出
export function buildSkillSummaryMessages(session: SessionRecord): ChatMessage[] {
  return [{
    role: "user",
    content: [
      "你是工作方法提炼助手。阅读下面的会话转录，把这次任务中经过验证的做法提炼成一个可复用的「工作模板」，让以后遇到同类任务时可以直接照做。",
      "",
      "只输出一个 JSON 对象，不要用 Markdown 围栏包裹，不要输出任何解释。JSON 结构：",
      `{"name":"模板名称（10字以内）","description":"一句话简介（40字以内，说明什么时候该用它）","instructions":"执行要求（Markdown 分步，可含检查清单，200-600字）"}`,
      "",
      "提炼要求：",
      "- 泛化掉本次的具体文件名、人名、路径等一次性细节，保留可复用的步骤、工具使用顺序和注意事项；",
      "- 只提炼确实做成、值得重复的做法；如果会话里只是闲聊或没有可复用流程，instructions 里如实说明没有可提炼的流程；",
      "- 用中文。",
      "",
      "----",
      `会话标题：${session.title}`,
      "",
      buildSkillSummaryTranscript(session),
    ].join("\n"),
    createdAt: new Date().toISOString(),
  }];
}

// 模型输出的草稿稳健解析：直接 parse → 去代码围栏 → 取首尾花括号子串
export function parseSkillDraft(text: string) {
  const trimmed = String(text || "").trim();
  const candidates: string[] = [];
  if (trimmed) candidates.push(trimmed);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== "object") continue;
      const draft = {
        name: typeof parsed.name === "string" ? parsed.name.trim() : "",
        description: typeof parsed.description === "string" ? parsed.description.trim() : "",
        instructions: typeof parsed.instructions === "string" ? parsed.instructions.trim() : "",
      };
      if (draft.name || draft.description || draft.instructions) return draft;
    } catch {
      // 尝试下一种截取方式
    }
  }
  return null;
}
