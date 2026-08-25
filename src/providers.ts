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
    models: ["glm-4.6", "glm-4.5-air", "glm-4-flash"],
    defaultModel: "glm-4.6",
    keyHint: "open.bigmodel.cn 申请",
    contextLimits: { "glm-4.6": 204800, "glm-4.5-air": 131072, "glm-4-flash": 131072 },
    defaultContextLimit: 131072,
  },
  {
    id: "qwen",
    name: "通义千问（阿里）",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    models: ["qwen-max", "qwen-plus", "qwen-turbo"],
    defaultModel: "qwen-plus",
    keyHint: "bailian.console.aliyun.com 申请",
    contextLimits: { "qwen-max": 131072, "qwen-plus": 131072, "qwen-turbo": 1000000 },
    defaultContextLimit: 131072,
  },
  {
    id: "qwen-local",
    name: "Qwen（本地部署）",
    // 默认 vLLM 端口；Ollama 为 11434、LM Studio 为 1234，按实际服务改地址即可
    endpoint: "http://192.16.6.138:8000/v1/chat/completions",
    models: ["Qwen3.8-27B"],
    defaultModel: "Qwen3.8-27B",
    keyHint: "本地服务通常无需真实 Key，随意填写即可",
    // 官方标称 1M 上下文，但本地上限以 vLLM 启动参数 --max-model-len 为准（当前部署 32K）
    contextLimits: { "Qwen3.8-27B": 32768 },
    defaultContextLimit: 32768,
  },
  {
    id: "doubao",
    name: "豆包（火山引擎）",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    models: ["doubao-seed-1-6-250615", "doubao-seed-1-6-flash-250715"],
    defaultModel: "doubao-seed-1-6-250615",
    keyHint: "火山方舟控制台；也可填推理接入点 ep-xxx",
    contextLimits: { "doubao-seed-1-6-250615": 262144, "doubao-seed-1-6-flash-250715": 262144 },
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

// 模型上下文上限（用于用量圆环；为公开资料的近似值，仅作参考）
export function modelContextLimit(model: string, endpoint: string): number {
  const name = String(model || "").trim().toLowerCase();
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
