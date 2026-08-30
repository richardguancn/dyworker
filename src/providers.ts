export interface ProviderPreset {
  id: string;
  name: string;
  endpoint: string;
  models: string[];
  defaultModel: string;
  keyHint: string;
  contextLimits: Record<string, number>;
  defaultContextLimit: number;
  // 可配置的推理强度档位（依据各厂商官方 API 文档；空/缺省表示该厂商不支持强度参数）。
  // "off" 统一表示关闭思考；实际请求参数由主进程按厂商映射（见 electron/agent.mjs reasoningRequestParams）。
  reasoningEfforts?: string[];
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
    // 官方 thinking_mode 文档：Chat Completions 顶层 reasoning_effort（low/high/max，medium→high、xhigh→max）；
    // Responses API 为 reasoning.effort（none/low/high/max）
    reasoningEfforts: ["off", "low", "high", "max"],
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
    // K3 官方支持 low/high/max（默认 max，推理 token 消耗大）
    reasoningEfforts: ["low", "high", "max"],
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
    reasoningEfforts: ["low", "high", "max"],
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
    defaultContextLimit: 204800,
    // 官方文档：GLM-5.2 及以上支持 reasoning_effort（GLM-5.3 仅 low/high/max，默认 max）；
    // GLM-5.3 强制开启思考（thinking disabled 会报错），"off" 仅适用于 4.x 系列
    reasoningEfforts: ["off", "low", "high", "max"],
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
    // 百炼 OpenAI 兼容模式：enable_thinking 开关 + reasoning_effort 档位（各模型取值不同，如 qwen3.8-max 为 low/medium/xhigh）
    reasoningEfforts: ["off", "low", "medium", "high"],
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
    // 官方 OpenAI 兼容文档：M3 用 thinking.type（disabled/adaptive）控制思考；M2.x 系列思考不可关闭
    reasoningEfforts: ["off", "adaptive"],
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
    // Chat Completions 顶层 reasoning_effort；Responses API 为 reasoning.effort。各模型支持档位不同（gpt-5.2 含 none/xhigh，5.3-codex 含 xhigh）
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
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
    // Gemini OpenAI 兼容层：reasoning_effort（low/medium/high）
    reasoningEfforts: ["low", "medium", "high"],
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
    // Grok 4.5/4.6 支持 reasoning_effort（low/medium/high，默认 high）
    reasoningEfforts: ["low", "medium", "high"],
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
    // vLLM 部署 Qwen3 通过 chat_template_kwargs.enable_thinking 控制思考开关，
    // 本地部署没有云端那套档位（low/high 等是百炼服务端参数），只有开/关
    reasoningEfforts: ["off", "on"],
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
    // 官方文档：seed-1.6 用 thinking.type（enabled/disabled/auto）；doubao-seed-evolving 支持
    // reasoning_effort（none/minimal/low/medium/high/xhigh/max，默认 high）。auto 仅 seed-1.6 生效
    reasoningEfforts: ["off", "auto", "low", "medium", "high"],
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
    // 自建网关/中转大多透传 OpenAI 标准 reasoning_effort；不支持的服务会忽略该参数
    reasoningEfforts: ["off", "low", "medium", "high"],
  },
];

export function matchProvider(endpoint: string): string {
  const value = String(endpoint || "").trim();
  if (!value) return "custom";
  const preset = providerPresets.find((item) => item.id !== "custom" && item.endpoint === value);
  return preset?.id || "custom";
}

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

// 模型名上下文覆盖语法：k3[1M]、Qwen3.8-27B[256K]、model[131072]。
// 方括号后缀只影响本地上下文管理（用量圆环、裁剪/压缩阈值）；
// 实际请求由主进程剥离后缀再发给服务端，与 electron/agent.mjs 的 bareModelName 保持同一语法。
export function parseModelContextOverride(model: string): { name: string; contextLimit: number | null } {
  const raw = String(model || "").trim();
  const match = raw.match(/^(.*?)\s*\[([0-9]+(?:\.[0-9]+)?)\s*([kKmM])?\]$/);
  if (!match) return { name: raw, contextLimit: null };
  const unit = match[3]?.toLowerCase();
  const value = Number(match[2]) * (unit === "m" ? 1048576 : unit === "k" ? 1024 : 1);
  return { name: match[1].trim(), contextLimit: Number.isFinite(value) && value > 0 ? Math.floor(value) : null };
}

// 模型上下文上限（用于用量圆环；为公开资料的近似值，仅作参考）
export function modelContextLimit(model: string, endpoint: string): number {
  const parsed = parseModelContextOverride(model);
  if (parsed.contextLimit) return parsed.contextLimit;
  const name = parsed.name.toLowerCase();
  const preset = providerPresets.find((item) => item.id === matchProvider(endpoint));
  if (!name) return preset?.defaultContextLimit || 131072;
  for (const item of providerPresets) {
    const exact = item.contextLimits[name];
    if (exact) return exact;
  }
  for (const item of providerPresets) {
    const fuzzy = Object.keys(item.contextLimits).find((key) => name.includes(key.toLowerCase()) || key.toLowerCase().includes(name));
    if (fuzzy) return item.contextLimits[fuzzy];
  }
  return preset?.defaultContextLimit || 131072;
}
