// 统一模型请求入口。
import { createModelStreamParser } from '../model-stream.mts';
import { detectProvider } from "../providers.mts";
import { adaptToolsForModel } from '../tool-schema.mts';
import { adaptMessagesForModel } from "./messages.mts";
import { bareModelName,isResponsesEndpoint,normalizeModelEndpoint } from "./model-discovery.mts";
import { reasoningRequestParams,responsesReasoningParams } from "./model-settings.mts";
import { modelTransportError,parseModelJson,postChat,watchStreamIdle } from "./model-transport.mts";
import { messageFromResponses,normalizedUsage,readResponsesStream,responsesPayload } from "./responses.mts";
import { MODEL_IDLE_TIMEOUT_MS,MODEL_NETWORK_RETRY_BASE_DELAY_MS,MODEL_NETWORK_RETRY_LIMIT,MODEL_STATUS_RETRY_BASE_DELAY_MS,MODEL_STATUS_RETRY_LIMIT } from "./shared.mts";
import { toolDefinitionsWith } from "./tool-definitions.mts";
import { isDeepSeekNativeVisionModel,rewriteImagesForTextModel,validateImagesForNativeVisionModel } from "./vision.mts";

// 优先流式（SSE），端点不支持时回退普通响应；onText 回调收到逐步累积的正文
// tools 可整体覆盖工具列表（子代理需要裁掉 dispatch_agent，防止无限递归派发）
// onTransport(mode) 回报实际使用的传输方式："sse"（流式）或 "json"（端点不支持流式时的回退）
// onUsage(usage) 回报端点返回的真实 token 用量（SSE 模式经 stream_options.include_usage 请求）
export async function requestModel({ settings, messages, fetchImpl, signal = null, onText = null, onReasoning = null, extraTools = [], tools = null, maxOutputTokens = undefined, onTransport = null, onUsage = null, onRetry = null, retryBaseDelayMs = MODEL_NETWORK_RETRY_BASE_DELAY_MS, retryLimit = MODEL_NETWORK_RETRY_LIMIT, statusRetryBaseDelayMs = MODEL_STATUS_RETRY_BASE_DELAY_MS, statusRetryLimit = MODEL_STATUS_RETRY_LIMIT, idleTimeoutMs = MODEL_IDLE_TIMEOUT_MS }) {
  if (maxOutputTokens !== undefined && (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1)) {
    throw new Error("模型输出上限必须是正整数");
  }
  // tools === false 表示完全不带工具（用于上下文压缩等纯文本请求），避免端点对空 tools 数组报错
  const effectiveEndpoint = normalizeModelEndpoint(settings.endpoint);
  const responsesApi = isResponsesEndpoint(effectiveEndpoint);
  const sanitizedMessages = isDeepSeekNativeVisionModel(settings)
    ? validateImagesForNativeVisionModel(messages)
    : messages;
  const rewrittenMessages = await rewriteImagesForTextModel({ settings, messages: sanitizedMessages, fetchImpl, signal });
  const modelMessages = adaptMessagesForModel(rewrittenMessages, settings);
  const selectedTools = tools === false ? false : adaptToolsForModel(tools || toolDefinitionsWith(extraTools), settings);
  // 模型名可能带上下文覆盖后缀（如 k3[1M]），发给服务端前剥离
  const apiModel = bareModelName(settings.model);
  // 推理强度参数：按厂商官方 API 文档映射（档位由设置界面限定，见 reasoningRequestParams 注释）
  const providerId = detectProvider(settings.endpoint);
  const reasoningParams = reasoningRequestParams({ provider: providerId, effort: settings.reasoningEffort, model: settings.model, endpoint: settings.endpoint, overrides: settings.reasoningOverrides });
  const basePayload: any = responsesApi
    ? responsesPayload({
        model: apiModel,
        messages: modelMessages,
        tools: tools === false ? false : selectedTools,
        stream: false,
        reasoning: responsesReasoningParams({ provider: providerId, effort: settings.reasoningEffort, model: settings.model, endpoint: settings.endpoint, overrides: settings.reasoningOverrides }),
      })
    : {
        model: apiModel,
        messages: modelMessages,
        ...reasoningParams,
      };
  // 仅传递调用方明确提供的预算，不给正常任务回复增加截断限制。
  // OpenAI Chat 使用 completion 上限，其余兼容 Chat 服务使用通用 max_tokens。
  if (maxOutputTokens !== undefined) {
    basePayload[responsesApi ? "max_output_tokens" : providerId === "openai" ? "max_completion_tokens" : "max_tokens"] = maxOutputTokens;
  }
  if (!responsesApi && tools !== false) {
    basePayload.tools = selectedTools;
    basePayload.tool_choice = "auto";
  }
  const postModel = async (payload) => {
    const post = (body) => postChat({ settings, payload: body, fetchImpl, signal, endpoint: effectiveEndpoint,
      retryBaseDelayMs, retryLimit, statusRetryBaseDelayMs, statusRetryLimit, onRetry });
    try {
      return await post(payload);
    } catch (error: any) {
      // 兼容网关可能只接受 Chat 的另一种上限字段。只有服务明确拒绝该字段才换写法，
      // 预算原值始终保留；不因参数错误取消限制，也不对 Responses 使用 Chat 参数。
      const parameter = Object.hasOwn(payload, "max_tokens") ? "max_tokens" : "max_completion_tokens";
      if (responsesApi || maxOutputTokens === undefined || ![400, 422].includes(error?.status)
        || !String(error?.message).includes(parameter)
        || !/unsupported|not supported|unknown parameter|unrecognized|不支持|未知参数/i.test(String(error?.message))) throw error;
      const alternative = parameter === "max_tokens" ? "max_completion_tokens" : "max_tokens";
      const compatible = { ...payload, [alternative]: maxOutputTokens };
      delete compatible[parameter];
      delete basePayload[parameter];
      basePayload[alternative] = maxOutputTokens;
      return await post(compatible);
    }
  };
  let response;
  try {
    const streamPayload = responsesApi
      ? { ...basePayload, stream: true }
      : { ...basePayload, stream: true, stream_options: { include_usage: true } };
    response = await postModel(streamPayload);
  } catch (error: any) {
    if (error?.contentFiltered || /content_filter|considered high risk|data_inspection_failed|risk_control/i.test(error?.message || "")) {
      throw error;
    }
    if (error?.status !== 400 && error?.status !== 404 && error?.status !== 422) throw error;
    response = await postModel(basePayload);
  }

  const contentType = response.headers?.get?.("content-type") || "";
  if (!contentType.includes("text/event-stream") || !response.body?.getReader) {
    onTransport?.("json");
    const result = await parseModelJson(response, "模型服务");
    if (responsesApi) {
      if (result?.usage) onUsage?.(normalizedUsage(result.usage, true));
      return messageFromResponses(result);
    }
    const message = result?.choices?.[0]?.message;
    if (!message || typeof message !== "object") throw new Error("模型服务没有返回结果");
    if (result?.usage) onUsage?.(result.usage);
    if (result?.choices?.[0]?.finish_reason === "length") message.truncated = true;
    return message;
  }

  onTransport?.("sse");
  if (responsesApi) return readResponsesStream(response, { onText, onUsage, idleTimeoutMs, onReasoning, signal });
  const reader = response.body.getReader();
  const idleWatch = watchStreamIdle(reader, idleTimeoutMs, signal);
  const decoder = new TextDecoder();
  let content = "";
  let reasoning = "";
  let usage = null;
  let finishReason = null;
  let completed = false;
  const toolCalls = new Map();

  const applyDelta = (delta) => {
    if (!delta) return;
    // 推理模型的思考流：vLLM/DeepSeek 标准字段 reasoning_content，部分部署用 reasoning。
    // 不进正文（否则会污染最终回复与后续上下文），单独经 onReasoning 透出做进度展示
    const reasoningPiece = typeof delta.reasoning_content === "string" && delta.reasoning_content
      ? delta.reasoning_content
      : (typeof delta.reasoning === "string" ? delta.reasoning : "");
    if (reasoningPiece) {
      reasoning += reasoningPiece;
      onReasoning?.(reasoning);
    }
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      onText?.(content);
    }
    for (const part of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const index = part.index ?? 0;
      const current = toolCalls.get(index) || { id: "", type: "function", function: { name: "", arguments: "" } };
      if (part.id) current.id = part.id;
      if (part.function?.name) current.function.name += part.function.name;
      if (part.function?.arguments) current.function.arguments += part.function.arguments;
      toolCalls.set(index, current);
    }
  };

  const consumeBlock = (block) => {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") { completed = true; continue; }
      let chunk;
      try { chunk = JSON.parse(data); } catch { continue; }
      if (chunk?.usage) usage = chunk.usage;
      const choice = chunk?.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      applyDelta(choice?.delta);
    }
  };

  const parser = createModelStreamParser(consumeBlock);
  try {
    while (!completed) {
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
  // 接收完终止标记才允许执行工具，避免断流时执行半截参数或把半句正文当作完成。
  // 兼容只发 finish_reason 后关闭连接、没有 [DONE] 的服务。
  if (!completed && !finishReason) {
    throw modelTransportError("模型流式响应意外中断，未收到终止事件", "MODEL_STREAM_INTERRUPTED");
  }

  if (usage) onUsage?.(usage);
  const message: any = { role: "assistant", content: content || null };
  if (reasoning) message.reasoning_content = reasoning;
  const calls = [...toolCalls.values()].filter((call) => call.function.name);
  if (calls.length) message.tool_calls = calls;
  if (finishReason === "length") message.truncated = true;
  return message;
}
