// 模型消息整理、图片上下文和用量估算。
import { detectProvider } from "../providers.mts";
import { computerUseAction, computerUseWindowHeader, isComputerUseTool } from "../computer-use.mts";
import { MODEL_IMAGE_DATA_URL_MAX_CHARS, MODEL_TOTAL_IMAGES_MAX_CHARS, compressImageDataUrlForModel } from "../local-image.mts";
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

const VIEW_IMAGE_INTRO_PREFIX = "这是 view_image 实际读取的图片。";
const INTERFACE_SCREENSHOT_PREFIXES = [
  "这是刚刚读取到的本机应用界面截图",
  "这是刚刚读取到的右侧内置浏览器页面截图",
];

function isInterfaceScreenshotMessage(message) {
  if (message?.role !== "user" || !Array.isArray(message?.content)) return false;
  const parts = message.content;
  return parts.some((part) => imagePartFromContent(part))
    && parts.some((part) =>
      part?.type === "text"
      && INTERFACE_SCREENSHOT_PREFIXES.some((prefix) => String(part?.text || "").startsWith(prefix)));
}

export function isViewImageMessage(message) {
  if (message?.role !== "user" || !Array.isArray(message?.content)) return false;
  const parts = message.content;
  return parts.some((part) => imagePartFromContent(part))
    && parts.some((part) =>
      part?.type === "text"
      && String(part?.text || "").startsWith(VIEW_IMAGE_INTRO_PREFIX));
}

export function isToolImageMessage(message) {
  return isInterfaceScreenshotMessage(message) || isViewImageMessage(message);
}

export function isSyntheticToolImageContext(message) {
  if (message?.role !== "user") return false;
  const text = contentForContext(message.content).trimStart();
  return text.startsWith(VIEW_IMAGE_INTRO_PREFIX)
    || INTERFACE_SCREENSHOT_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function isDesktopScreenshotRecord(message) {
  return message?.role === "user" && contentForContext(message.content)
    .startsWith("这是刚刚读取到的本机应用界面截图");
}

const desktopInteractionSteps = new Set([
  "get_app_state", "get_shared_app_state", "click", "press_key", "type_text", "set_value",
  "scroll", "drag", "select_text", "perform_secondary_action",
]);
export const isTransientDesktopTool = (name: string) => desktopInteractionSteps.has(computerUseAction(name));
const desktopHistoryPrefix = "[早前桌面操作记录]";
export const recoveredDesktopHistoryPrefix = "[从该轮停止前的本地日志恢复的历史记录]";
const desktopProgressPattern = /已(?:成功)?(?:保存|提交|上传|关联|添加|完成|核对|验证)|保存成功|提交成功|上传成功|saved|submitted|uploaded|verified/i;
const verifiedDesktopSave = /^已点击「(?:保存|Save)」，页面上的保存按钮已变为不可用，已填写字段读回一致。/i;
const desktopHistoryKeep = 10;

// Collapse complete UI-only exchanges. Keep other tool work, user messages, and
// explicit results (e.g. fill_form) as-is. This only edits the model's copy.
export function compactDesktopHistory(messages) {
  const groups: { start: number, end: number, notes: string[], count: number }[] = [];
  let liveCount = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "assistant" && typeof message.content === "string"
      && message.content.startsWith(desktopHistoryPrefix + "\n")) {
      groups.push({ start: index, end: index + 1, count: 0, notes: message.content.split("\n").slice(2) });
      continue;
    }
    const calls = message?.role === "assistant" && message.tool_calls;
    if (!calls?.length || !calls.every(call => isTransientDesktopTool(call.function?.name))) continue;
    const pending = new Set(calls.map(call => call.id));
    let end = index + 1;
    while (messages[end]?.role === "tool" && pending.delete(messages[end].tool_call_id)) end++;
    if (pending.size) continue;
    if (liveCount++ < desktopHistoryKeep) continue;
    while (isDesktopScreenshotRecord(messages[end])) end++;
    const notes = messageText(message).split("\n").map(line => line.trim()).filter(line => desktopProgressPattern.test(line));
    // A verified save is evidence even if the model never described it before stopping.
    const clickIds = new Set(calls.filter(call => computerUseAction(call.function?.name) === "click").map(call => call.id));
    for (const reply of messages.slice(index + 1, end)) {
      if (reply.role !== "tool" || !clickIds.has(reply.tool_call_id)) continue;
      const lines = messageText(reply).split("\n");
      if (lines[0] !== "成功" || !verifiedDesktopSave.test(lines[1] || "")) continue;
      const scope = lines.filter(line => /^(?:Window:|标题 |heading |弹出式按钮 |pop[- ]up button )/i.test(line))
        .map(line => line.split(" Value: ", 1)[0]);
      notes.push(`${lines[1]} ${scope.slice(-8).join(" · ")}`.trim());
    }
    groups.push({ start: index, end, notes, count: calls.length });
  }
  if (!groups.some(group => group.count)) return;

  // Process from the tail so earlier ranges keep their original offsets.
  for (let index = 0; index < groups.length;) {
    const newest = groups[index++];
    let start = newest.start;
    let changed = newest.count > 0;
    const notes = [...newest.notes].reverse();
    while (groups[index]?.end === start) {
      const older = groups[index++];
      start = older.start;
      changed ||= older.count > 0;
      notes.push(...[...older.notes].reverse());
    }
    if (!changed) continue;
    const unique = [...new Set(notes.map(note => note.slice(0, verifiedDesktopSave.test(note) ? 280 : 180)))];
    const verified = unique.filter(note => verifiedDesktopSave.test(note)).slice(0, 8);
    const recent = [...verified.reverse(), ...unique.filter(note => !verifiedDesktopSave.test(note)).slice(0, 8).reverse()];
    messages.splice(start, newest.end - start, {
      role: "assistant",
      content: [desktopHistoryPrefix,
        "早前的界面、点击和键入步骤已归档。以下是当时的进度陈述，续跑须以当前页面核对。",
        ...recent,
      ].join("\n"),
    });
  }
}

export function omitHistoricalToolImage(message) {
  const localImage = message?.role === "user" && Array.isArray(message?.content)
    && message.content.some((part) => part?.type === "text"
      && String(part.text || "").startsWith(VIEW_IMAGE_INTRO_PREFIX));
  if (!localImage && !isInterfaceScreenshotMessage(message)) return message;
  // 只改本次模型输入，不改会话存档；已有识别文字与工具结果继续保留。
  return { ...message, content: message.content.map((part) => imagePartFromContent(part)
    ? { type: "text", text: "[历史工具图片已省略：当前文字模型无法读取原图。请利用已有文字记录；若任务必须重新看图，需使用视觉能力，不得假装已看到原图。]" }
    : part) };
}

export function hasInterfaceImages(messages) {
  return (messages || []).some(isInterfaceScreenshotMessage);
}

export function hasToolImages(messages) {
  return (messages || []).some(isToolImageMessage);
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
    const images = message.content.filter((part) => imagePartFromContent(part));
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

export function replaceViewImagesWithText(messages, keepLatestCount = 0) {
  const keepIndexes = new Set<number>();
  const limit = Math.max(0, Math.floor(Number(keepLatestCount) || 0));
  if (limit > 0) {
    for (let index = messages.length - 1; index >= 0 && keepIndexes.size < limit; index -= 1) {
      if (isViewImageMessage(messages[index])) keepIndexes.add(index);
    }
  }
  let replaced = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (keepIndexes.has(index) || !isViewImageMessage(message)) continue;
    const images = message.content.filter((part) => imagePartFromContent(part));
    if (!images.length) continue;
    const text = message.content
      .filter((part) => part?.type === "text")
      .map((part) => String(part?.text || ""))
      .filter(Boolean)
      .join("\n");
    message.content = `${text}${text ? "\n" : ""}[此前通过 view_image 查看的图片已省略；如需重新查看，请再次调用 view_image]`;
    replaced += images.length;
  }
  return replaced;
}

export function replaceAllToolImagesWithText(messages) {
  return replaceInterfaceImagesWithText(messages, false) + replaceViewImagesWithText(messages, 0);
}

export function replaceOlderUserImagesWithText(messages, keepLatestUserMessage = true) {
  let latestUserIndex = -1;
  if (keepLatestUserMessage) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === "user" && !isSyntheticToolImageContext(message)) {
        latestUserIndex = index;
        break;
      }
    }
  }
  let replaced = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (index === latestUserIndex || !Array.isArray(message?.content)) continue;
    if (!message.content.some((part) => imagePartFromContent(part))) continue;
    let countInMessage = 0;
    message.content = message.content.map((part) => {
      if (!imagePartFromContent(part)) return part;
      countInMessage += 1;
      return { type: "text", text: "[较早历史消息中的图片已省略以控制请求体积]" };
    });
    replaced += countInMessage;
  }
  return replaced;
}

function partImageUrl(part) {
  if (part?.type === "image_url") {
    return typeof part.image_url === "string" ? part.image_url : String(part.image_url?.url || "");
  }
  if (part?.type === "input_image") {
    return String(part.image_url || "");
  }
  return "";
}

function measureTotalImageChars(messages) {
  let total = 0;
  for (const message of messages || []) {
    if (!Array.isArray(message?.content)) continue;
    for (const part of message.content) {
      if (imagePartFromContent(part)) total += partImageUrl(part).length;
    }
  }
  return total;
}

export async function enforceModelImageBudget(
  messages,
  options: {
    maxViewImages?: number;
    maxSingleImageChars?: number;
    maxTotalImageChars?: number;
    compressImageDataUrl?: (dataUrl: string) => Promise<string | null>;
  } = {},
) {
  const maxViewImages = Math.max(0, Math.floor(options.maxViewImages ?? 2));
  const maxSingleImageChars = Math.max(1024, Math.floor(options.maxSingleImageChars ?? MODEL_IMAGE_DATA_URL_MAX_CHARS));
  const maxTotalImageChars = Math.max(maxSingleImageChars, Math.floor(options.maxTotalImageChars ?? MODEL_TOTAL_IMAGES_MAX_CHARS));
  const compressImageDataUrl = options.compressImageDataUrl ?? compressImageDataUrlForModel;

  let pruned = replaceViewImagesWithText(messages, maxViewImages);
  let compressed = 0;

  for (const message of messages || []) {
    if (!Array.isArray(message?.content)) continue;
    let changed = false;
    const nextContent = [];
    for (const part of message.content) {
      if (!imagePartFromContent(part)) {
        nextContent.push(part);
        continue;
      }
      const url = partImageUrl(part);
      if (url.length <= maxSingleImageChars) {
        nextContent.push(part);
        continue;
      }
      const compressedUrl = await compressImageDataUrl(url);
      if (compressedUrl && compressedUrl.length <= maxSingleImageChars) {
        changed = true;
        compressed += 1;
        if (part.type === "input_image") {
          nextContent.push({ ...part, image_url: compressedUrl });
        } else {
          const imageUrlObj = typeof part.image_url === "object" && part.image_url
            ? { ...part.image_url, url: compressedUrl }
            : { url: compressedUrl };
          nextContent.push({ ...part, image_url: imageUrlObj });
        }
      } else {
        changed = true;
        pruned += 1;
        nextContent.push({
          type: "text",
          text: "[图片体积超出模型单图限制，已省略；如需查看请压缩图片后重试]",
        });
      }
    }
    if (changed) message.content = nextContent;
  }

  let totalChars = measureTotalImageChars(messages);
  if (totalChars > maxTotalImageChars) {
    for (const message of messages || []) {
      if (totalChars <= maxTotalImageChars) break;
      if (!isToolImageMessage(message)) continue;
      const imageParts = message.content.filter((part) => imagePartFromContent(part));
      if (!imageParts.length) continue;
      const removedChars = imageParts.reduce((sum, part) => sum + partImageUrl(part).length, 0);
      const text = message.content
        .filter((part) => part?.type === "text")
        .map((part) => String(part?.text || ""))
        .filter(Boolean)
        .join("\n");
      const notice = isViewImageMessage(message)
        ? "[此前通过 view_image 查看的图片已省略以控制请求体积；如需重新查看，请再次调用 view_image]"
        : "[此前界面截图已移除，请以最新状态为准]";
      message.content = `${text}${text ? "\n" : ""}${notice}`;
      pruned += imageParts.length;
      totalChars = Math.max(0, totalChars - removedChars);
    }
  }

  if (totalChars > maxTotalImageChars) {
    let latestUserIndex = -1;
    for (let index = (messages?.length || 0) - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === "user" && !isSyntheticToolImageContext(message)) {
        latestUserIndex = index;
        break;
      }
    }
    for (let index = 0; index < (messages?.length || 0); index += 1) {
      if (totalChars <= maxTotalImageChars) break;
      if (index === latestUserIndex) continue;
      const message = messages[index];
      if (!Array.isArray(message?.content) || !message.content.some((part) => imagePartFromContent(part))) continue;
      let changed = false;
      const nextContent = message.content.map((part) => {
        if (!imagePartFromContent(part) || totalChars <= maxTotalImageChars) return part;
        const len = partImageUrl(part).length;
        changed = true;
        pruned += 1;
        totalChars = Math.max(0, totalChars - len);
        return { type: "text", text: "[较早历史消息中的图片已省略以控制请求体积]" };
      });
      if (changed) message.content = nextContent;
    }
  }

  return { pruned, compressed, totalChars };
}

// Keep two complete desktop snapshots per app for comparisons. Older control
// IDs are already unusable and must not be supplied as current evidence.
export function compactDesktopObservations(messages) {
  const desktopCalls = new Set<string>();
  for (const message of messages) {
    for (const call of message?.tool_calls || []) {
      if (isComputerUseTool(call.function?.name)) desktopCalls.add(call.id);
    }
  }
  const retained = new Map<string, number>();
  const omitted = "[旧界面已省略，操作前请重新读取。]";
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "tool" || !desktopCalls.has(message.tool_call_id)
      || typeof message.content !== "string" || !message.content.startsWith("成功\n")
      || message.content.endsWith(omitted)) continue;
    const snapshot = message.content.slice("成功\n".length).replace(/^观察编号：[^\r\n]+\r?\n/, "")
      .replace(/^填写当前网页的文字输入框时，[^\n]+\n/, "");
    const header = computerUseWindowHeader(snapshot);
    if (!header || snapshot.length <= header.length) continue;
    const app = header.split("\n", 1)[0].replace(/ \(pid \d+\)\r?$/, "");
    const count = retained.get(app) || 0;
    if (count < 2) {
      retained.set(app, count + 1);
      continue;
    }
    message.content = `成功\n${header}\n${omitted}`;
  }
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
