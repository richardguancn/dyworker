// 工作记录、上下文压缩与溢出处理。
import { contentForContext,estimateMessagesTokens,estimateTextTokens,messageText,sanitizeToolCalls } from "./messages.mts";
import { requestModel } from "./model-request.mts";
import { summarizationSettings } from "./model-settings.mts";
import { MODEL_NETWORK_RETRY_BASE_DELAY_MS,WORKING_CONTEXT_ITEM_LIMIT,WORKING_CONTEXT_LIMIT,clipped } from "./shared.mts";
import { toolSummary } from "./tool-summary.mts";

export function limitWorkingContext(text) {
  if (text.length <= WORKING_CONTEXT_LIMIT) return text;
  const headLength = 8 * 1024;
  const tailLength = WORKING_CONTEXT_LIMIT - headLength;
  return `${text.slice(0, headLength)}\n…（较早的工作记录已收缩）…\n${text.slice(-tailLength)}`;
}

function workingContextRecords(messages): string[] {
  const toolNames = new Map();
  for (const message of messages || []) {
    if (message?.role !== "assistant") continue;
    for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
      if (!call?.id || !call?.function?.name) continue;
      let args = {};
      try {
        args = JSON.parse(String(call.function.arguments || "{}"));
      } catch { }
      toolNames.set(String(call.id), toolSummary(String(call.function.name), args));
    }
  }
  return (messages || [])
    .filter((message) => message?.role === "tool")
    .map((message) => {
      const name = toolNames.get(String(message.tool_call_id || "")) || "工具操作";
      const content = clipped(contentForContext(message.content), WORKING_CONTEXT_ITEM_LIMIT);
      return `【${name}】\n${content}`;
    })
    .filter((record) => record.trim());
}

function buildWorkingContext(messages) {
  const records = workingContextRecords(messages);
  return records.length ? limitWorkingContext(records.slice(-12).join("\n\n")) : "";
}

// 只删除当前请求已逐字携带的完整记录。旧会话仅有摘要、记录被截短、或结果已变化时保留。
// 不按文件名去重：同一路径在不同时间读取的结果可能不同。
export function remainingWorkingContext(previous, conversation) {
  const messages = (conversation || []).flatMap(message =>
    message?.role === "assistant" && message.executedMessages?.length ? message.executedMessages : [message]);
  let remaining = String(previous || "").trim();
  // 与最终请求采用相同的配对修复；孤立的工具结果不会发送，不能据此删除备份记录。
  for (const record of new Set(workingContextRecords(sanitizeToolCalls(messages)))) {
    let start = 0;
    while ((start = remaining.indexOf(record, start)) !== -1) {
      const end = start + record.length;
      if ((start === 0 || remaining.slice(start - 2, start) === "\n\n")
        && (end === remaining.length || remaining.slice(end, end + 2) === "\n\n")) {
        remaining = (remaining.slice(0, start) + remaining.slice(end)).trim();
        start = 0;
      } else start = end;
    }
  }
  return remaining;
}

export function mergeWorkingContext(previous, messages) {
  const current = buildWorkingContext(messages);
  const parts = [remainingWorkingContext(previous, messages), current].filter(Boolean);
  return parts.length ? limitWorkingContext(parts.join("\n\n")) : "";
}

// microcompact：上下文逼近上限时，把较早的工具结果替换成占位符，只留最近 6 条完整结果。
// 需要旧内容时模型可重新调用工具；工具消息的结构（role/tool_call_id）保持不变，协议配对不受影响。
// force：服务端已判定上下文超限时强制裁剪，不再看本地估算阈值（估算可能偏低）。
const PRUNE_KEEP_RECENT_TOOL_RESULTS = 6;

export function pruneOldToolResults(messages, contextLimit = 128000, force = false) {
  // 阈值取「上限的 55%」与「上限 -20k」的较大者：大上下文保持原行为（-20k），
  // 小上下文服务器（如 vLLM max_model_len=32k）也能在超限前触发裁剪
  const threshold = Math.max(Math.floor(contextLimit * 0.55), Math.floor(contextLimit) - 20000);
  if (!force && estimateMessagesTokens(messages) <= threshold) return false;
  const toolIndexes = messages.reduce((list, message, index) => (message?.role === "tool" ? [...list, index] : list), []);
  const stale = toolIndexes.slice(0, Math.max(0, toolIndexes.length - PRUNE_KEEP_RECENT_TOOL_RESULTS));
  let pruned = false;
  for (const index of stale) {
    const content = String(messages[index]?.content || "");
    if (content.length <= 300 || content.includes("较早的工具结果已省略")) continue;
    const headline = content.split("\n")[0].slice(0, 80);
    messages[index].content = `${headline}\n…（较早的工具结果已省略以节省上下文；如需再次查看，请重新调用相应工具）`;
    pruned = true;
  }
  return pruned;
}

// 自动 compact 摘要（借鉴 Claude Code autocompact）：microcompact 之后仍逼近上限时，
// 压缩和审核同样记账：缺少服务端用量时估算，并携带实际调用的模型。
export async function requestAuxiliaryModel(options) {
  let usageSeen = false;
  const message = await requestModel({ ...options, onUsage: (usage) => {
    const prompt = Number(usage?.prompt_tokens);
    const completion = Number(usage?.completion_tokens);
    if (!Number.isFinite(prompt) || prompt < 0 || !Number.isFinite(completion) || completion < 0) return;
    usageSeen = true;
    options.onUsage?.({ ...usage, model: options.settings.model, estimated: false });
  } });
  if (!usageSeen) options.onUsage?.({
    model: options.settings.model,
    prompt_tokens: estimateMessagesTokens(options.messages),
    completion_tokens: estimateTextTokens(messageText(message)),
    estimated: true,
  });
  return message;
}

// 用一次独立的无工具模型请求把早前对话压缩为结构化摘要。
// 保留系统提示、原始任务和最近 keepRecent 条消息；失败时省略早前记录，不中断任务。
export async function compactConversation({ messages, settings, fetchImpl, signal, onSummary = null, onUsage = null, keepRecent = 12, contextLimit = null, networkRetryBaseDelayMs = MODEL_NETWORK_RETRY_BASE_DELAY_MS }) {
  const firstUser = messages.findIndex(message => message?.role === 'user');
  const prefix = Math.max(2, firstUser + 1);
  if (contextLimit && estimateMessagesTokens(messages) > contextLimit * 0.7) {
    // 大消息不能只按条数保留：十二条记录本身可能已超过整个窗口。
    keepRecent = Math.min(keepRecent, Math.max(1, messages.length - prefix - 1));
    while (keepRecent > 1 && estimateMessagesTokens(messages.slice(-keepRecent)) > contextLimit * 0.2) keepRecent--;
  } else if (messages.length < keepRecent + 8) return false;
  let cut = messages.length - keepRecent;
  const latestUser = messages.findLastIndex(message => message?.role === 'user');
  if (latestUser >= prefix) cut = Math.min(cut, latestUser);
  // 保留区不能以 tool 消息开头，也不能把 assistant(tool_calls) 与它的工具结果对切开
  while (cut > prefix && (messages[cut]?.role === "tool" || (messages[cut - 1]?.role === "assistant" && messages[cut - 1]?.tool_calls?.length))) cut -= 1;
  if (cut <= prefix) return false;
  const old = messages.slice(prefix, cut);
  const serialized = clipped(old.map((message) => {
    const body = contentForContext(message?.content);
    const calls = (message?.tool_calls || [])
      .map((call) => `${call?.function?.name}(${clipped(String(call?.function?.arguments || ""), 200)})`)
      .join(" ");
    return `[${message?.role}] ${clipped(body, 1500)}${calls ? `\n调用工具：${calls}` : ""}`;
  }).join("\n\n"), 60000);
  const summaryPrompt = "你是上下文压缩器。以下是政务办公助手执行一个任务的早前工作记录。请压缩为结构化中文摘要，包含四节：\n"
    + "1) 用户需求与红线（原始要求、格式与口径约束、涉及的文号、用户明确禁止的事——关键短语逐字保留）\n"
    + "2) 已完成的工作（含产出文件的路径）\n"
    + "3) 当前进展与中间结论（已查到的事实、数据、来源网址）\n"
    + "4) 下一步要做的事\n"
    + "只输出摘要正文，不要评论，不要寒暄。\n\n" + serialized;
  let summary;
  try {
    // 压缩是纯文本摘要，仅在模型明确支持时关闭或降低思考强度。
    const maxOutputTokens = Math.max(1, Math.min(4096, Math.floor((contextLimit || 128000) / 8)));
    const message = await requestAuxiliaryModel({ settings: summarizationSettings(settings), messages: [{ role: "user", content: summaryPrompt }], fetchImpl, signal, tools: false, maxOutputTokens, onUsage, retryBaseDelayMs: networkRetryBaseDelayMs });
    // 篇幅上限包含部分模型的思考用量。摘要被截断时不能拿残缺内容覆盖原始记录。
    if (message.truncated) return false;
    summary = messageText(message).trim();
    if (!summary) throw new Error("摘要为空");
  } catch {
    summary = `（早前 ${old.length} 条工作记录因上下文空间不足已省略；如需旧的文件内容请重新读取相应文件）`;
  }
  messages.splice(prefix, cut - prefix, { role: "user", content: `[上下文压缩] 以下是本次任务早前工作的摘要，请在此基础上继续：\n\n${summary}` });
  onSummary?.(summary);
  return true;
}

// 服务端判定上下文超限的识别：本地估算偏低、模型不在上下文表（默认 128k 估高）或中转网关
// 截断时，端点会以 400/413 返回 context_length_exceeded 类错误。此时应强制压缩后重试，
// 而不是直接把任务报错终止。各家服务商文案不同，覆盖中英文常见写法。
const CONTEXT_OVERFLOW_PATTERN = /context[_ ]?length|maximum context|context window|too many tokens|prompt is too long|input (length|tokens)|reduce the length|length.*exceed|exceed.*(length|limit|token)|token.*(超限|超过|超出)|上下文.*(超限|过长|超出|超过)|长度.*(超限|超出|超过)|max.*tokens/i;

export function isContextOverflowError(error) {
  const status = Number(error?.status);
  // 401/403/429 等是鉴权与限流，绝不按上下文超限处理
  if ([401, 403, 404, 429].includes(status)) return false;
  const text = error instanceof Error ? error.message : String(error || "");
  return CONTEXT_OVERFLOW_PATTERN.test(text);
}
