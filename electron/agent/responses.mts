// Responses 请求、用量与流式响应转换。
import { createModelStreamParser } from '../model-stream.mts';
import { messageText } from "./messages.mts";
import { modelTransportError,watchStreamIdle } from "./model-transport.mts";
import { MODEL_IDLE_TIMEOUT_MS } from "./shared.mts";

function responsesContent(role, content) {
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (part?.type === "text") {
      return { type: role === "assistant" ? "output_text" : "input_text", text: String(part.text || "") };
    }
    if (part?.type === "image_url" || part?.type === "input_image") {
      // DeepSeek 视觉模型（Responses API）只允许 user / developer 消息携带图片；
      // assistant / system 消息里的图片块会被服务端拒绝（400），降级为文本占位，避免请求失败。
      if (role === "assistant" || role === "system") {
        return { type: role === "assistant" ? "output_text" : "input_text", text: "[图片已省略：该消息角色不支持携带图片]" };
      }
      const imageUrl = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      return { type: "input_image", image_url: String(imageUrl || ""), ...(part.image_url?.detail ? { detail: part.image_url.detail } : {}) };
    }
    return part;
  });
}

export function responsesInput(messages) {
  const input = [];
  for (const message of messages || []) {
    if (message?.role === "tool") {
      // function_call_output 的 output 支持字符串或内容块列表；
      // 含图片时保留数组结构，与 DeepSeek 视觉模型的 Responses API 对齐。
      const output = Array.isArray(message.content)
        ? responsesContent("user", message.content)
        : messageText(message);
      input.push({
        type: "function_call_output",
        call_id: String(message.tool_call_id || ""),
        output,
      });
      continue;
    }
    if (!["user", "assistant", "system", "developer"].includes(message?.role)) continue;
    const content = message.content;
    if ((typeof content === "string" && content) || (Array.isArray(content) && content.length)) {
      input.push({ role: message.role, content: responsesContent(message.role, content) });
    }
    if (message.role === "assistant") {
      for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        if (call?.type !== "function" || !call.function?.name) continue;
        input.push({
          type: "function_call",
          call_id: String(call.id || ""),
          name: String(call.function.name),
          arguments: String(call.function.arguments || ""),
        });
      }
    }
  }
  return input;
}

function responsesTools(tools) {
  return (tools || []).map((tool) => {
    if (tool?.type !== "function" || !tool.function) return tool;
    return {
      type: "function",
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
      ...(tool.function.strict !== undefined ? { strict: tool.function.strict } : {}),
    };
  });
}

/**
 * 供应商用量里的缓存与推理 token：各家字段名不同，取到哪个算哪个。
 *   OpenAI / DeepSeek：prompt_tokens_details.cached_tokens、prompt_cache_hit_tokens
 *   Anthropic 风格：cache_read_input_tokens / cache_creation_input_tokens
 *   推理：completion_tokens_details.reasoning_tokens
 * 拿不到就不带这些字段——界面据此显示"未记录"，而不是编一个数。
 */
export function readUsageExtras(usage) {
  if (!usage || typeof usage !== "object") return {};
  const promptDetails = usage.prompt_tokens_details || usage.input_tokens_details || {};
  const completionDetails = usage.completion_tokens_details || usage.output_tokens_details || {};
  const cacheRead = Number(
    usage.prompt_cache_hit_tokens ?? usage.cached_tokens ?? promptDetails.cached_tokens
      ?? usage.cache_read_input_tokens ?? usage.cacheReadTokens ?? NaN,
  );
  const cacheWrite = Number(
    usage.prompt_cache_creation_input_tokens ?? usage.cache_creation_input_tokens
      ?? promptDetails.cache_write_tokens ?? usage.cacheWriteTokens ?? NaN,
  );
  const reasoning = Number(
    completionDetails.reasoning_tokens ?? usage.reasoning_tokens ?? usage.reasoningTokens ?? NaN,
  );
  const out: { cacheRead?: number; cacheWrite?: number; reasoning?: number } = {};
  if (Number.isFinite(cacheRead) && cacheRead >= 0) out.cacheRead = cacheRead;
  if (Number.isFinite(cacheWrite) && cacheWrite >= 0) out.cacheWrite = cacheWrite;
  if (Number.isFinite(reasoning) && reasoning >= 0) out.reasoning = reasoning;
  return out;
}

export function normalizedUsage(usage, responsesApi) {
  if (!usage || typeof usage !== "object") return null;
  if (!responsesApi) return usage;
  const prompt = Number(usage.input_tokens) || 0;
  const completion = Number(usage.output_tokens) || 0;
  return {
    ...usage,
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: Number(usage.total_tokens) || prompt + completion,
  };
}

export function messageFromResponses(result) {
  if (result?.error) {
    throw new Error(`模型服务返回错误：${result.error.message || JSON.stringify(result.error)}`);
  }
  if (result?.status === "failed") throw new Error("模型生成失败");
  if (result?.status === "incomplete") {
    const reason = result.incomplete_details?.reason;
    // 长度截断不再终止任务：解析已收到的内容并打 truncated 标记，由 runAgent 决定拦截工具调用
    if (reason !== "max_output_tokens") {
      throw new Error(`模型输出未完成${reason ? `（${reason}）` : ""}`);
    }
  }
  let content = "";
  const toolCalls = [];
  for (const item of Array.isArray(result?.output) ? result.output : []) {
    if (item?.type === "message") {
      for (const part of Array.isArray(item.content) ? item.content : []) {
        if ((part?.type === "output_text" || part?.type === "text") && typeof part.text === "string") content += part.text;
      }
      continue;
    }
    if (item?.type === "function_call" && item.name) {
      toolCalls.push({
        id: String(item.call_id || item.id || `call-${toolCalls.length}`),
        type: "function",
        function: { name: String(item.name), arguments: String(item.arguments || "") },
      });
    }
  }
  const message: any = { role: "assistant", content: content || null };
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (result?.status === "incomplete" && result?.incomplete_details?.reason === "max_output_tokens") {
    message.truncated = true;
  }
  return message;
}

export function responsesPayload({ model, messages, tools, stream, reasoning }) {
  const payload: any = { model, input: responsesInput(messages), stream };
  if (reasoning) payload.reasoning = reasoning;
  if (tools !== false) {
    payload.tools = responsesTools(tools);
    payload.tool_choice = "auto";
  }
  return payload;
}

export async function readResponsesStream(response, { onText, onUsage, idleTimeoutMs = MODEL_IDLE_TIMEOUT_MS, onReasoning = null, signal = null }) {
  const reader = response.body.getReader();
  const idleWatch = watchStreamIdle(reader, idleTimeoutMs, signal);
  const decoder = new TextDecoder();
  let content = "";
  let reasoning = "";
  let terminalResponse = null;
  let failure = null;
  const toolCalls = new Map();

  const toolKey = (event, item) => String(
    item?.id || event?.item_id || item?.call_id
      || (event?.output_index !== undefined ? event.output_index : toolCalls.size),
  );
  const storeTool = (event, item, replaceArguments = false) => {
    if (item?.type !== "function_call" && !event?.type?.startsWith("response.function_call_arguments.")) return;
    const key = toolKey(event, item);
    const current = toolCalls.get(key) || {
      id: String(item?.call_id || item?.id || ""),
      type: "function",
      function: { name: String(item?.name || ""), arguments: "" },
    };
    if (item?.call_id || item?.id) current.id = String(item.call_id || item.id);
    if (item?.name) current.function.name = String(item.name);
    if (item?.arguments !== undefined) {
      current.function.arguments = replaceArguments ? String(item.arguments || "") : current.function.arguments + String(item.arguments || "");
    }
    toolCalls.set(key, current);
  };

  const applyEvent = (event) => {
    if (!event || typeof event !== "object") return;
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      content += event.delta;
      onText?.(content);
    } else if (/reasoning(_summary)?(_text)?\.delta$/.test(String(event.type || "")) && typeof event.delta === "string") {
      // 推理模型的思考增量（response.reasoning_text.delta / reasoning_summary_text.delta）：
      // 不进正文，单独透出做进度展示
      reasoning += event.delta;
      onReasoning?.(reasoning);
    } else if (event.type === "response.output_item.added") {
      storeTool(event, event.item);
    } else if (event.type === "response.output_item.done") {
      storeTool(event, event.item, true);
    } else if (event.type === "response.function_call_arguments.delta") {
      storeTool(event, { type: "function_call", arguments: event.delta });
    } else if (event.type === "response.function_call_arguments.done") {
      storeTool(event, { type: "function_call", arguments: event.arguments }, true);
    } else if (["response.completed", "response.incomplete"].includes(event.type)) {
      terminalResponse = event.response || null;
    } else if (event.type === "response.failed") {
      failure = event.response?.error || event.error || { message: "模型生成失败" };
      terminalResponse = event.response || null;
    }
  };

  const consumeBlock = (block) => {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;
    let event;
    try { event = JSON.parse(data); } catch { return; }
    applyEvent(event);
  };

  const parser = createModelStreamParser(consumeBlock);
  try {
    while (!terminalResponse && !failure) {
      const { done, value } = await reader.read();
      if (done) break;
      idleWatch.reset();
      parser.feed(decoder.decode(value, { stream: true }));
    }
  } finally {
    idleWatch.dispose();
  }
  idleWatch.throwIfTripped();
  parser.finish(decoder.decode());

  if (failure) throw new Error(`模型生成失败：${failure.message || JSON.stringify(failure)}`);
  if (terminalResponse) {
    if (terminalResponse.usage) onUsage?.(normalizedUsage(terminalResponse.usage, true));
    const message = messageFromResponses(terminalResponse);
    // 个别实现终态 response 不含输出文本时，用流式增量兜底，避免已收到的内容丢失
    if (!message.content && content) message.content = content;
    return message;
  }
  throw modelTransportError("模型流式响应意外中断，未收到终止事件", "MODEL_STREAM_INTERRUPTED");
}
