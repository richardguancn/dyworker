import {
  parseModelContextOverride,
  resolveModelContextLimit,
  type ContextLimitOverride,
} from '../electron/model-context.ts';
import { reasoningProvider } from '../electron/model-reasoning.ts';
import { isGlmNativeVisionModel } from '../electron/model-vision.ts';

export interface ProviderPreset {
  id: string;
  name: string;
  endpoint: string;
  models: string[];
  defaultModel: string;
  keyHint: string;
  contextLimits: Record<string, number>;
  defaultContextLimit: number;
}

export const providerPresets: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek（深度求索）",
    endpoint: "https://api.deepseek.com/responses",
    models: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-vision-exp"],
    defaultModel: "deepseek-v4-flash",
    keyHint: "platform.deepseek.com 申请",
    contextLimits: { "deepseek-v4-flash": 1048576, "deepseek-v4-pro": 1048576, "deepseek-v4-flash-vision-exp": 1048576 },
    defaultContextLimit: 1048576,
  },
  {
    id: "kimi",
    name: "Kimi（编程套餐）",
    endpoint: "https://api.kimi.com/coding/v1/chat/completions",
    models: ["k3", "kimi-k2-0905-preview"],
    defaultModel: "k3",
    keyHint: "platform.moonshot.cn 或 Kimi 编程套餐",
    contextLimits: {
      k3: 1048576,
      "kimi-k2-0905-preview": 262144,
    },
    defaultContextLimit: 1048576,
  },
  {
    id: "kimi-open",
    name: "Kimi（开放平台）",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    models: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6"],
    defaultModel: "kimi-k3",
    keyHint: "platform.moonshot.cn 申请（sk- 开头）",
    contextLimits: {
      "kimi-k3": 1048576,
      "kimi-k2.7-code": 262144,
      "kimi-k2.6": 262144,
    },
    defaultContextLimit: 1048576,
  },
  {
    id: "glm",
    name: "GLM（智谱）",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    models: ["glm-5.3", "glm-5.3-flash", "glm-5.2", "glm-5.1", "glm-4.6", "glm-4.5-air", "glm-4-flash"],
    defaultModel: "glm-5.3",
    keyHint: "open.bigmodel.cn 申请",
    contextLimits: {
      "glm-5.3": 1048576,
      "glm-5.3-flash": 1048576,
      "glm-5.2": 204800,
      "glm-5.1": 204800,
      "glm-4.6": 204800,
      "glm-4.5-air": 131072,
      "glm-4-flash": 131072,
    },
    defaultContextLimit: 1048576,
  },
  {
    id: "qwen",
    name: "通义千问（百炼）",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    models: ["qwen3.8-max", "qwen3.7-max", "qwen3.7-plus", "qwen3.8-flash", "qwen3.7-flash", "qwen-plus", "qwen-turbo"],
    defaultModel: "qwen3.7-plus",
    keyHint: "bailian.console.aliyun.com 申请",
    contextLimits: {
      "qwen3.8-max": 262144,
      "qwen3.7-max": 262144,
      "qwen3.7-plus": 262144,
      "qwen3.8-flash": 1048576,
      "qwen3.7-flash": 1048576,
      "qwen-plus": 131072,
      "qwen-turbo": 1000000,
    },
    defaultContextLimit: 131072,
  },
  {
    id: "minimax",
    name: "MiniMax",
    endpoint: "https://api.minimaxi.com/v1/chat/completions",
    models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2.1-highspeed", "MiniMax-M2"],
    defaultModel: "MiniMax-M3",
    keyHint: "platform.minimaxi.com 申请；海外站改地址为 api.minimax.io",
    contextLimits: {
      "MiniMax-M3": 1048576,
      "MiniMax-M2.7": 204800,
      "MiniMax-M2.7-highspeed": 204800,
      "MiniMax-M2.5": 204800,
      "MiniMax-M2.5-highspeed": 204800,
      "MiniMax-M2.1": 204800,
      "MiniMax-M2.1-highspeed": 204800,
      "MiniMax-M2": 204800,
    },
    defaultContextLimit: 204800,
  },
  {
    id: "openai",
    name: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    models: ["gpt-5.6", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.3-codex", "gpt-5.2"],
    defaultModel: "gpt-5.6",
    keyHint: "platform.openai.com 申请",
    contextLimits: { "gpt-5.6": 400000, "gpt-5.6-terra": 400000, "gpt-5.6-luna": 400000, "gpt-5.3-codex": 400000, "gpt-5.2": 400000 },
    defaultContextLimit: 400000,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    models: ["gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash"],
    defaultModel: "gemini-3.1-pro-preview",
    keyHint: "aistudio.google.com 申请",
    contextLimits: { "gemini-3.1-pro-preview": 1048576, "gemini-3-pro-preview": 1048576, "gemini-3-flash-preview": 1048576, "gemini-2.5-pro": 1048576, "gemini-2.5-flash": 1048576 },
    defaultContextLimit: 1048576,
  },
  {
    id: "xai",
    name: "xAI Grok",
    endpoint: "https://api.x.ai/v1/chat/completions",
    models: ["grok-4.6", "grok-4.5", "grok-4-1-fast-reasoning", "grok-4-1-fast"],
    defaultModel: "grok-4.6",
    keyHint: "console.x.ai 申请",
    contextLimits: { "grok-4.6": 500000, "grok-4.5": 500000, "grok-4-1-fast-reasoning": 2097152, "grok-4-1-fast": 2097152 },
    defaultContextLimit: 500000,
  },
  {
    id: "qwen-local",
    name: "Qwen（本地部署）",
    // 默认 vLLM 端口；Ollama 为 11434、LM Studio 为 1234，按实际服务改地址即可
    endpoint: "http://192.16.6.138:8000/v1/chat/completions",
    models: ["Qwen3.8-27B"],
    defaultModel: "Qwen3.8-27B",
    keyHint: "本地服务通常无需真实 Key，随意填写即可",
    // 官方原生 262,144（可扩展至 1M）；本地上限以 vLLM 启动参数 --max-model-len 为准，
    // 主进程会探测 /models 的 max_model_len 并按较小值钳制
    contextLimits: { "Qwen3.8-27B": 262144 },
    defaultContextLimit: 262144,
  },
  {
    id: "doubao",
    name: "豆包（火山引擎）",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    models: ["doubao-seed-evolving", "doubao-seed-1-6-250615", "doubao-seed-1-6-flash-250715"],
    defaultModel: "doubao-seed-evolving",
    keyHint: "火山方舟控制台；也可填推理接入点 ep-xxx",
    contextLimits: { "doubao-seed-evolving": 1048576, "doubao-seed-1-6-250615": 262144, "doubao-seed-1-6-flash-250715": 262144 },
    defaultContextLimit: 262144,
  },
  {
    id: "custom",
    name: "自定义（OpenAI 兼容）",
    endpoint: "",
    models: [],
    defaultModel: "",
    keyHint: "自建或第三方 OpenAI 兼容服务",
    contextLimits: {},
    defaultContextLimit: 131072,
  },
];

export function matchProvider(endpoint: string): string {
  const value = String(endpoint || "").trim();
  if (!value) return "custom";
  const preset = providerPresets.find((item) => item.id !== "custom" && item.endpoint === value);
  return preset?.id || reasoningProvider(value) || "custom";
}

export { isGlmNativeVisionModel, parseModelContextOverride };

// 按 baseurl 判断是否走 Responses API：路径以 /responses 结尾即按 Responses 请求，
// DeepSeek 官方根地址（不带路径）自动视为 Responses；其余按 OpenAI Chat Completions。
export function usesResponsesApi(endpoint: string): boolean {
  const value = String(endpoint || "").trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.hostname === "api.deepseek.com" && (url.pathname === "" || url.pathname === "/")) return true;
    return /\/responses\/?$/.test(url.pathname);
  } catch {
    return /\/responses\/?(?:[?#].*)?$/.test(value);
  }
}

// 模型上下文上限（用于用量圆环与运行时上下文裁剪；优先后缀，其次按模型的覆盖设置，最后回退内置参考值）
export function modelContextLimit(
  model: string,
  endpoint: string,
  overrides?: ContextLimitOverride[],
): number {
  return resolveModelContextLimit({ model, endpoint, overrides });
}
