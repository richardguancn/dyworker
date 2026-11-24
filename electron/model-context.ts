// 浏览器与主进程共用的模型上下文上限配置。保持无 Node/Electron 依赖。
import { reasoningProvider } from './model-reasoning.ts';
import { normalizeCapabilityEndpoint } from './model-vision.ts';

export const DEFAULT_CONTEXT_LIMIT = 131072;
export const MIN_CONTEXT_LIMIT = 1024;
export const MAX_CONTEXT_LIMIT = 1_073_741_824;

export interface ContextLimitOverride {
  endpoint: string;
  model: string;
  contextLimit: number;
}

interface ProviderContextEntry {
  endpoint?: string;
  defaultLimit: number;
  models: Record<string, number>;
}

const PROVIDER_CONTEXT_SPECS: Record<string, ProviderContextEntry> = {
  deepseek: {
    endpoint: 'https://api.deepseek.com/responses',
    defaultLimit: 1048576,
    models: {
      'deepseek-v4-flash': 1048576,
      'deepseek-v4-pro': 1048576,
      'deepseek-v4-flash-vision-exp': 1048576,
    },
  },
  kimi: {
    endpoint: 'https://api.kimi.com/coding/v1/chat/completions',
    defaultLimit: 1048576,
    models: {
      k3: 1048576,
      'kimi-k2-0905-preview': 262144,
    },
  },
  'kimi-open': {
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    defaultLimit: 1048576,
    models: {
      'kimi-k3': 1048576,
      'kimi-k2.7-code': 262144,
      'kimi-k2.6': 262144,
    },
  },
  glm: {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultLimit: 1048576,
    models: {
      'glm-5.3': 1048576,
      'glm-5.3-flash': 1048576,
      'glm-5.2': 204800,
      'glm-5.1': 204800,
      'glm-4.6': 204800,
      'glm-4.5-air': 131072,
      'glm-4-flash': 131072,
    },
  },
  qwen: {
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultLimit: 131072,
    models: {
      'qwen3.8-max': 262144,
      'qwen3.7-max': 262144,
      'qwen3.7-plus': 262144,
      'qwen3.8-flash': 1048576,
      'qwen3.7-flash': 1048576,
      'qwen-plus': 131072,
      'qwen-turbo': 1000000,
    },
  },
  minimax: {
    endpoint: 'https://api.minimaxi.com/v1/chat/completions',
    defaultLimit: 204800,
    models: {
      'minimax-m3': 1048576,
      'minimax-m2.7': 204800,
      'minimax-m2.7-highspeed': 204800,
      'minimax-m2.5': 204800,
      'minimax-m2.5-highspeed': 204800,
      'minimax-m2.1': 204800,
      'minimax-m2.1-highspeed': 204800,
      'minimax-m2': 204800,
    },
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultLimit: 400000,
    models: {
      'gpt-5.6': 400000,
      'gpt-5.6-terra': 400000,
      'gpt-5.6-luna': 400000,
      'gpt-5.3-codex': 400000,
      'gpt-5.2': 400000,
    },
  },
  gemini: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultLimit: 1048576,
    models: {
      'gemini-3.1-pro-preview': 1048576,
      'gemini-3-pro-preview': 1048576,
      'gemini-3-flash-preview': 1048576,
      'gemini-2.5-pro': 1048576,
      'gemini-2.5-flash': 1048576,
    },
  },
  xai: {
    endpoint: 'https://api.x.ai/v1/chat/completions',
    defaultLimit: 500000,
    models: {
      'grok-4.6': 500000,
      'grok-4.5': 500000,
      'grok-4-1-fast-reasoning': 2097152,
      'grok-4-1-fast': 2097152,
    },
  },
  'qwen-local': {
    endpoint: 'http://192.16.6.138:8000/v1/chat/completions',
    defaultLimit: 262144,
    models: {
      'qwen3.8-27b': 262144,
    },
  },
  doubao: {
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    defaultLimit: 262144,
    models: {
      'doubao-seed-evolving': 1048576,
      'doubao-seed-1-6-250615': 262144,
      'doubao-seed-1-6-flash-250715': 262144,
    },
  },
};

function sanitizeContextLimit(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num < MIN_CONTEXT_LIMIT || num > MAX_CONTEXT_LIMIT) return null;
  return Math.floor(num);
}

// 解析手工输入的上下文上限：支持 1M、100M、2.5M、256K、131072、1,000,000 等写法。
export function parseContextLimitInput(raw: string): number | null {
  const cleaned = String(raw || '').trim().replace(/,/g, '');
  if (!cleaned) return null;
  const match = cleaned.match(/^([0-9]+(?:\.[0-9]+)?)\s*([kKmM])?$/);
  if (!match) return null;
  const unit = match[2]?.toLowerCase();
  const multiplier = unit === 'm' ? 1048576 : unit === 'k' ? 1024 : 1;
  return sanitizeContextLimit(Number(match[1]) * multiplier);
}

export function formatContextLimitInput(limit: number): string {
  const safe = Math.floor(Number(limit) || 0);
  if (!Number.isFinite(safe) || safe <= 0) return '';
  if (safe >= 1048576 && safe % 1048576 === 0) return `${safe / 1048576}M`;
  if (safe >= 1024 && safe % 1024 === 0) return `${safe / 1024}K`;
  return String(safe);
}

// 模型名上下文覆盖语法：k3[1M]、Qwen3.8-27B[256K]、model[131072]。
// 方括号后缀只影响本地上下文管理；实际请求由主进程剥离后缀再发给服务端。
export function parseModelContextOverride(model: string): { name: string; contextLimit: number | null } {
  const raw = String(model || '').trim();
  const match = raw.match(/^(.*?)\s*\[([0-9]+(?:\.[0-9]+)?)\s*([kKmM])?\]$/);
  if (!match) return { name: raw, contextLimit: null };
  const unit = match[3]?.toLowerCase();
  const value = Number(match[2]) * (unit === 'm' ? 1048576 : unit === 'k' ? 1024 : 1);
  return {
    name: match[1].trim(),
    contextLimit: Number.isFinite(value) && value > 0 ? Math.floor(value) : null,
  };
}

export function contextModelKey(endpoint: string, model: string): string {
  const bare = parseModelContextOverride(model).name.toLowerCase();
  return JSON.stringify([normalizeCapabilityEndpoint(endpoint), bare]);
}

export function normalizeContextLimitOverrides(value: unknown): ContextLimitOverride[] {
  const result: ContextLimitOverride[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { endpoint?: unknown; model?: unknown; contextLimit?: unknown };
    const endpoint = String(record.endpoint || '').trim();
    const model = parseModelContextOverride(String(record.model || '')).name;
    const contextLimit = sanitizeContextLimit(record.contextLimit);
    if (!endpoint || !model || !contextLimit) continue;
    const key = contextModelKey(endpoint, model);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ endpoint, model, contextLimit });
  }
  return result;
}

export function findContextLimitOverride(
  overrides: unknown,
  endpoint: string,
  model: string,
): ContextLimitOverride | undefined {
  const key = contextModelKey(endpoint, model);
  return normalizeContextLimitOverrides(overrides).find((item) => contextModelKey(item.endpoint, item.model) === key);
}

export function updateContextLimitOverride(
  overrides: unknown,
  endpoint: string,
  model: string,
  contextLimit: number | null,
): ContextLimitOverride[] {
  const cleanEndpoint = String(endpoint || '').trim();
  const cleanModel = parseModelContextOverride(model).name;
  const key = contextModelKey(cleanEndpoint, cleanModel);
  const remaining = normalizeContextLimitOverrides(overrides).filter(
    (item) => contextModelKey(item.endpoint, item.model) !== key,
  );
  const validLimit = sanitizeContextLimit(contextLimit);
  if (!validLimit || !cleanEndpoint || !cleanModel) return remaining;
  return normalizeContextLimitOverrides([
    ...remaining,
    { endpoint: cleanEndpoint, model: cleanModel, contextLimit: validLimit },
  ]);
}

function matchContextProvider(endpoint: string): string | null {
  const trimmed = String(endpoint || '').trim();
  if (!trimmed) return null;
  for (const [id, spec] of Object.entries(PROVIDER_CONTEXT_SPECS)) {
    if (spec.endpoint && spec.endpoint === trimmed) return id;
  }
  return reasoningProvider(trimmed);
}

// 仅做合理参考回退：优先当前厂商精准匹配，再跨厂商精准匹配，再当前厂商精确前缀，最后厂商默认上限。
export function builtinModelContextLimit(model: string, endpoint: string): number {
  const name = parseModelContextOverride(model).name.toLowerCase();
  const providerId = matchContextProvider(endpoint);
  const preset = providerId ? PROVIDER_CONTEXT_SPECS[providerId] : undefined;
  if (!name) return preset?.defaultLimit || DEFAULT_CONTEXT_LIMIT;

  if (preset) {
    if (preset.models[name]) return preset.models[name];
    const sameProviderFuzzy = Object.keys(preset.models).find(
      (key) => name.startsWith(`${key}-`) || name.startsWith(`${key}_`),
    );
    if (sameProviderFuzzy) return preset.models[sameProviderFuzzy];
  }

  for (const spec of Object.values(PROVIDER_CONTEXT_SPECS)) {
    if (spec.models[name]) return spec.models[name];
  }
  for (const spec of Object.values(PROVIDER_CONTEXT_SPECS)) {
    const fuzzy = Object.keys(spec.models).find(
      (key) => name.includes(key) || key.includes(name),
    );
    if (fuzzy) return spec.models[fuzzy];
  }
  return preset?.defaultLimit || DEFAULT_CONTEXT_LIMIT;
}

export function explicitModelContextLimit({
  model = '',
  endpoint = '',
  overrides,
}: {
  model?: string;
  endpoint?: string;
  overrides?: unknown;
}): number | null {
  const suffix = parseModelContextOverride(model).contextLimit;
  if (suffix) return suffix;
  return findContextLimitOverride(overrides, endpoint, model)?.contextLimit ?? null;
}

export function resolveModelContextLimit({
  model = '',
  endpoint = '',
  overrides,
  serverContextLimit,
}: {
  model?: string;
  endpoint?: string;
  overrides?: unknown;
  serverContextLimit?: number | null;
}): number {
  const serverLimit = Number(serverContextLimit);
  const hasServerLimit = Number.isFinite(serverLimit) && serverLimit > 0;
  const explicit = explicitModelContextLimit({ model, endpoint, overrides });
  if (explicit) {
    return hasServerLimit ? Math.min(explicit, Math.max(8000, Math.floor(serverLimit))) : explicit;
  }
  if (hasServerLimit) {
    return Math.max(8000, Math.floor(serverLimit));
  }
  return builtinModelContextLimit(model, endpoint);
}
