// 模型消息整理、图片上下文和用量估算。
import { detectProvider } from "../providers.mts";
import { bareModelName } from "./model-discovery.mts";
import { imagePartFromContent } from "./vision.mts";

/**
 * 校验并修复发送给模型的 messages 中的 tool_calls 与 tool 消息配对关系：
 * 1. 严格确保每一个 assistant 消息中的每个 tool_call (call.id) 在随后的消息中都有对应的 role: "tool" (tool_call_id === call.id)
 * 2. 如果缺少 tool 回复（例如前序任务异常、取消、finish_task 未回填或历史记录被截断）：
 *    - 自动为缺失的 tool_call_id 补齐占位回复：role: "tool", tool_call_id: id, content: "（操作已结束或未产生输出）"
 * 3. 严格确保每一个 role: "tool" 消息前面，必须有对应的 assistant 消息且其 tool_calls 包含该 id；
 *    - 剔除孤立的、没有匹配的 tool 消息，防止端点报错 unexpected tool response。
 * 4. 剔除空 tool_calls 属性（tool_calls: []），避免部分服务端 400。
 */
export function sanitizeToolCalls(messages) {
  if (!Array.isArray(messages)) return [];
  const result = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;

    if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const copy = { ...msg };
      const callIds = new Set(msg.tool_calls.map((c) => String(c?.id || "")).filter(Boolean));
      result.push(copy);

      // 收集接下来的 tool 消息，直到下一个 assistant 或 user
      const existingToolCallIds = new Set();
      let j = i + 1;
      while (j < messages.length && messages[j]?.role === "tool") {
        const toolMsg = messages[j];
        const callId = String(toolMsg?.tool_call_id || "");
        if (callIds.has(callId)) {
          existingToolCallIds.add(callId);
          result.push(toolMsg);
        }
        j++;
      }
      i = j - 1; // 跳过已处理的 tool 消息

      // 检查是否有缺失的 tool_call，自动补齐占位
      for (const call of msg.tool_calls) {
        const id = String(call?.id || "");
        if (id && !existingToolCallIds.has(id)) {
          result.push({
            role: "tool",
            tool_call_id: id,
            content: "（操作已结束或未产生输出）",
          });
        }
      }
      continue;
    }

    if (msg.role === "tool") {
      // 孤立的 tool 消息（前面没有匹配的 assistant tool_calls），丢弃以防服务端报错
      continue;
    }

    if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length === 0) {
      const copy = { ...msg };
      delete copy.tool_calls;
      result.push(copy);
      continue;
    }

    result.push(msg);
  }

  return result;
}

export function adaptMessagesForModel(messages, settings) {
  const sanitized = sanitizeToolCalls(messages);
  const providerId = detectProvider(settings?.endpoint);
  const modelName = bareModelName(settings?.model).toLowerCase();
  // 识别已知明确支持或要求 reasoning_content 的场景：
  // 1) Kimi 全系（K3 / Kimi Coding / Moonshot）
  // 2) DeepSeek 全系（R1 等思考模型）
  // 3) 模型名称明确包含思考特征（k3, r1, reasoning, think, qwq）
  // 4) 本地/自建端点（detectProvider 返回 null）
  const isThinkingModelOrEndpoint =
    providerId === "kimi" ||
    providerId === "kimi-open" ||
    providerId === "deepseek" ||
    providerId === null ||
    /k3|r1|reasoner|reasoning|thinking|qwq/i.test(modelName);

  if (isThinkingModelOrEndpoint) {
    return sanitized;
  }

  // 对于已知标准严格的外部接口（如 OpenAI 官方端点、Gemini、xAI、MiniMax 等非思考端点），
  // 在浅拷贝副本中临时剔除 reasoning_content，避免服务端校验报 400 额外参数错误。
  // 注意：这只影响发送给服务端的临时 payload，不影响持久化和跨轮历史存储。
  return sanitized.map((message) => {
    if (message?.role === "assistant" && Object.prototype.hasOwnProperty.call(message, "reasoning_content")) {
      const copy = { ...message };
      delete copy.reasoning_content;
      return copy;
    }
    return message;
  });
}

// 端点不回 usage 时的 token 估算：中文/全角按 1 token，其余约 4 字符 1 token，每条消息加 4 个结构开销
export function estimateTextTokens(text) {
  if (!text) return 0;
  const value = String(text);
  // 逐字符按码点区间计数，与原正则等价；不用 match，
  // 避免长上下文（几十万字）每轮分配几十万元素的临时数组
  let cjk = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      (code >= 0x3000 && code <= 0x9fff)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe30 && code <= 0xfe4f)
      || (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk += 1;
    }
  }
  return cjk + Math.ceil((value.length - cjk) / 4);
}

export function contentForContext(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (part?.type === "text") return String(part.text || "");
    if (part?.type === "image_url") return "[界面截图]";
    return "";
  }).filter(Boolean).join("\n");
}

function isInterfaceScreenshotMessage(message) {
  if (message?.role !== "user" || !Array.isArray(message?.content)) return false;
  const parts = message.content;
  return parts.some((part) => part?.type === "image_url")
    && parts.some((part) =>
      part?.type === "text"
      && (String(part?.text || "").startsWith("这是刚刚读取到的本机应用界面截图")
        || String(part?.text || "").startsWith("这是刚刚读取到的右侧内置浏览器页面截图")));
}

export function omitHistoricalToolImage(message) {
  const localImage = message?.role === "user" && Array.isArray(message?.content)
    && message.content.some((part) => part?.type === "text"
      && String(part.text || "").startsWith("这是 view_image 实际读取的图片。"));
  if (!localImage && !isInterfaceScreenshotMessage(message)) return message;
  // 只改本次模型输入，不改会话存档；已有识别文字与工具结果继续保留。
  return { ...message, content: message.content.map((part) => imagePartFromContent(part)
    ? { type: "text", text: "[历史工具图片已省略：当前文字模型无法读取原图。请利用已有文字记录；若任务必须重新看图，需使用视觉能力，不得假装已看到原图。]" }
    : part) };
}

export function hasInterfaceImages(messages) {
  return messages.some(isInterfaceScreenshotMessage);
}

export function replaceInterfaceImagesWithText(messages, keepLatest = false) {
  let latestIndex = -1;
  if (keepLatest) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (isInterfaceScreenshotMessage(messages[index])) {
        latestIndex = index;
        break;
      }
    }
  }
  let replaced = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (index === latestIndex || !isInterfaceScreenshotMessage(message)) continue;
    const images = message.content.filter((part) => part?.type === "image_url");
    if (!images.length) continue;
    const text = message.content
      .filter((part) => part?.type === "text")
      .map((part) => String(part?.text || ""))
      .filter(Boolean)
      .join("\n");
    message.content = `${text}${text ? "\n" : ""}[此前界面截图已移除，请以最新状态为准]`;
    replaced += images.length;
  }
  return replaced;
}

export function messagesForDebug(messages) {
  return (messages || []).map((message) => ({
    ...message,
    content: Array.isArray(message?.content)
      ? message.content.map((part) => part?.type === "image_url"
        ? { type: "image_url", image_url: { url: `[界面截图 ${String(part?.image_url?.url || "").length} 字符]` } }
        : part)
      : message?.content,
  }));
}

export function estimateMessagesTokens(messages) {
  let tokens = 0;
  for (const message of messages || []) {
    tokens += 4;
    tokens += estimateTextTokens(contentForContext(message?.content));
    if (Array.isArray(message?.content)) {
      tokens += message.content.filter((part) => part?.type === "image_url").length * 1_000;
    }
    for (const call of message?.tool_calls || []) {
      tokens += estimateTextTokens(call?.function?.name) + estimateTextTokens(call?.function?.arguments);
    }
  }
  return tokens;
}

export function messageText(message) {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.filter((part) => part?.type === "text").map((part) => part.text).join("\n");
  }
  return "";
}
