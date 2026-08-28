// 会话检索工具（list_sessions / search_sessions / read_session）：只读工具的定义与纯函数实现。
// 数据源是会话存档（sessions.json）里的会话与消息，当前规模下全内存扫描毫秒级足够；
// 未来若迁 SQLite FTS5，只需替换这三个函数的实现，工具定义与 Agent 调用方式不变。
// 不依赖 electron，方便用 node --test 直接测试；main.mjs 负责读档并把处理器接到
// createExtraToolRouter 的工具路由上（桌面 / 定时 / 续跑 / 渠道四条路径共用）。

export const SESSION_TOOL_NAMES = new Set(["list_sessions", "search_sessions", "read_session"]);

// 输出体积护栏：工具结果会进入模型上下文，超长会挤掉真正的工作内容
const LIST_DEFAULT_LIMIT = 15;
const LIST_MAX_LIMIT = 50;
const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 50;
const READ_DEFAULT_MESSAGES = 20;
const READ_MAX_MESSAGES = 100;
const LIST_PREVIEW_CHARS = 80;
const SNIPPET_CONTEXT_CHARS = 40;
const READ_MESSAGE_CHARS = 800;
const READ_TOTAL_CHARS = 24000;

const clampInt = (value, fallback, max) => {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(num, max);
};

// content 按类型定义是 string；数组形状只作防御性兼容（多模态分段）
function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

function formatStamp(iso) {
  const date = new Date(String(iso || ""));
  if (Number.isNaN(date.getTime())) return "未知时间";
  const pad = (num) => String(num).padStart(2, "0");
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const ymd = sameYear ? "" : `${date.getFullYear()}-`;
  return `${ymd}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 最近一次任务终态：从消息尾部往前找第一条带 taskStatus 的消息
function lastTaskStatus(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const status = messages[index]?.taskStatus;
    if (status) return String(status);
  }
  return "";
}

function collapseSpace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function preview(text, max = LIST_PREVIEW_CHARS) {
  const flat = collapseSpace(text);
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}

function snippetAround(text, keyword) {
  const flat = collapseSpace(text);
  const index = flat.toLowerCase().indexOf(keyword.toLowerCase());
  if (index < 0) return preview(flat, SNIPPET_CONTEXT_CHARS * 2);
  const start = Math.max(0, index - SNIPPET_CONTEXT_CHARS);
  const end = Math.min(flat.length, index + keyword.length + SNIPPET_CONTEXT_CHARS);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

function sortByRecency(sessions) {
  return [...sessions].sort((a, b) => {
    if (Boolean(b?.pinned) !== Boolean(a?.pinned)) return Boolean(b?.pinned) ? 1 : -1;
    return String(b?.updatedAt || "").localeCompare(String(a?.updatedAt || ""));
  });
}

function sessionsWithData(sessions) {
  // 空消息会话（刚建还没跑过任务）对检索没有价值，一并排除
  return (Array.isArray(sessions) ? sessions : []).filter((session) => Array.isArray(session?.messages) && session.messages.length > 0);
}

// ---- list_sessions ----

function listSessionsSummary(sessions, args = {}) {
  const query = collapseSpace(args.query).toLowerCase();
  let pool = sessionsWithData(sessions);
  if (query) {
    pool = pool.filter((session) => {
      if (collapseSpace(session?.title).toLowerCase().includes(query)) return true;
      return session.messages.some((message) => messageText(message).toLowerCase().includes(query));
    });
  }
  const limit = clampInt(args.limit, LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT);
  const top = sortByRecency(pool).slice(0, limit);
  if (!top.length) return { text: "没有找到匹配的会话。可以用 search_sessions 按关键词搜正文，或不带 query 列出最近会话。" };
  const lines = top.map((session, index) => {
    const messages = session.messages;
    const lastUser = [...messages].reverse().find((message) => message?.role === "user");
    const status = lastTaskStatus(session);
    const flags = [session?.channel === "qq" ? "QQ" : session?.channel === "wechat" ? "微信" : "", session?.archived ? "已归档" : ""].filter(Boolean);
    const head = [
      `${index + 1}. 「${collapseSpace(session?.title) || "未命名会话"}」`,
      `id=${session?.id}`,
      `更新 ${formatStamp(session?.updatedAt)}`,
      `${messages.length}条消息`,
      status ? `最近任务:${status}` : "",
      flags.length ? `[${flags.join("/")}]` : "",
    ].filter(Boolean).join(" · ");
    const ask = lastUser ? `\n   最近请求:${preview(messageText(lastUser))}` : "";
    return `${head}${ask}`;
  });
  const hidden = pool.length - top.length;
  return { text: `${lines.join("\n")}${hidden > 0 ? `\n(还有 ${hidden} 个更早的会话未列出，可加 query 过滤)` : ""}` };
}

// ---- search_sessions ----

function searchSessions(sessions, args = {}) {
  const keyword = collapseSpace(args.keyword);
  if (!keyword) {
    return { error: "缺少搜索关键词。请告诉我要在历史会话里找什么词，比如 search_sessions({ keyword: \"请款函\" })。" };
  }
  const limit = clampInt(args.limit, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT);
  const blocks = [];
  let hits = 0;
  for (const session of sortByRecency(sessionsWithData(sessions))) {
    if (hits >= limit) break;
    const lines = [];
    for (const message of session.messages) {
      if (hits >= limit) break;
      const text = messageText(message);
      if (!text || !text.toLowerCase().includes(keyword.toLowerCase())) continue;
      hits += 1;
      const roleLabel = message?.role === "user" ? "用户" : message?.role === "assistant" ? "助手" : String(message?.role || "消息");
      lines.push(`- [${roleLabel} ${formatStamp(message?.createdAt)}] ${snippetAround(text, keyword)}`);
    }
    if (lines.length) {
      blocks.push(`「${collapseSpace(session?.title) || "未命名会话"}」(id=${session?.id},更新 ${formatStamp(session?.updatedAt)})\n${lines.join("\n")}`);
    }
  }
  if (!blocks.length) return { text: `历史会话里没有找到包含「${keyword}」的内容。` };
  const moreSessions = hits >= limit ? "\n(命中较多，已截断；可换更精确的关键词)" : "";
  return { text: `在历史会话中找到「${keyword}」：\n\n${blocks.join("\n\n")}${moreSessions}` };
}

// ---- read_session ----

function readSessionTranscript(sessions, args = {}) {
  const sessionId = collapseSpace(args.sessionId);
  if (!sessionId) {
    return { error: "缺少会话 id。请先用 list_sessions 或 search_sessions 拿到会话 id。" };
  }
  const session = sessionsWithData(sessions).find((item) => String(item?.id) === sessionId);
  if (!session) return { text: `没有找到 id 为 ${sessionId} 的会话，可能已被删除。可以重新 list_sessions 确认。` };
  const messages = session.messages
    .filter((message) => (message?.role === "user" || message?.role === "assistant") && collapseSpace(messageText(message)))
    .map((message) => ({ role: message.role, createdAt: message?.createdAt, text: collapseSpace(messageText(message)) }));
  const take = clampInt(args.lastN, READ_DEFAULT_MESSAGES, READ_MAX_MESSAGES);
  // 从最新往前取，整体再受字符预算约束，最后倒回时间顺序
  const picked = [];
  let used = 0;
  let omitted = 0;
  for (let index = messages.length - 1; index >= 0 && picked.length < take; index -= 1) {
    const item = messages[index];
    const text = item.text.length > READ_MESSAGE_CHARS ? `${item.text.slice(0, READ_MESSAGE_CHARS)}…(该条已截断)` : item.text;
    if (picked.length && used + text.length > READ_TOTAL_CHARS) {
      omitted = index + 1;
      break;
    }
    used += text.length;
    picked.push({ ...item, text });
  }
  picked.reverse();
  const header = `会话「${collapseSpace(session?.title) || "未命名会话"}」· 更新 ${formatStamp(session?.updatedAt)} · 共 ${messages.length} 条消息${
    omitted ? `，因篇幅只保留最近 ${picked.length} 条（更早的 ${omitted} 条已省略）` : ""
  }：`;
  const body = picked.map((item) => `[${item.role === "user" ? "用户" : "助手"} ${formatStamp(item.createdAt)}] ${item.text}`).join("\n\n");
  return { text: `${header}\n\n${body}` };
}

// ---- 工具定义与分发 ----

const stringArg = (description) => ({ type: "string", description });

// 工具定义形状与 electron/channels/media-tools.mjs 一致
export function sessionToolDefinitions() {
  const tool = (name, description, properties, required) => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
  });
  return [
    tool(
      "list_sessions",
      "列出本机的历史会话（含 QQ/微信渠道发起的会话），按最近更新排序。用于回答「之前那个会话/任务的进度或结果」这类问题：每条会话带最近任务状态（done/error/cancelled 等）。可用 query 按标题或正文过滤，返回的 id 可用于 read_session 查看详情。",
      {
        query: stringArg("可选：过滤词，匹配会话标题或消息正文"),
        limit: stringArg("可选：最多返回几条，默认 15"),
      },
    ),
    tool(
      "search_sessions",
      "在所有历史会话的消息正文里按关键词搜索，返回命中片段（含所属会话、角色与时间）。用于「引用某个会话的上下文」「之前说过 XX 是什么」这类跨会话检索。",
      {
        keyword: stringArg("要搜索的关键词"),
        limit: stringArg("可选：最多返回几条命中，默认 20"),
      },
      ["keyword"],
    ),
    tool(
      "read_session",
      "读取某个会话的最近对话正文（用户与助手的完整消息，按时间顺序），用于把历史会话的结论或上下文引入当前任务。先用 list_sessions / search_sessions 拿到会话 id。",
      {
        sessionId: stringArg("目标会话 id"),
        lastN: stringArg("可选：读最近几条消息，默认 20"),
      },
      ["sessionId"],
    ),
  ];
}

// 只读分发：任何失败都返回 ok:false 的文本说明，不抛出——工具结果会直接进模型上下文。
// 三个实现函数统一返回 { error? } 或 { text }
export function handleSessionTool(name, args, { sessions } = {}) {
  if (!SESSION_TOOL_NAMES.has(String(name))) {
    return { ok: false, result: `没有找到会话工具：${name}` };
  }
  try {
    const payload = args && typeof args === "object" ? args : {};
    const outcome = name === "list_sessions"
      ? listSessionsSummary(sessions, payload)
      : name === "search_sessions"
        ? searchSessions(sessions, payload)
        : readSessionTranscript(sessions, payload);
    return outcome.error
      ? { ok: false, result: outcome.error }
      : { ok: true, result: outcome.text };
  } catch (error) {
    return { ok: false, result: `会话工具执行失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
