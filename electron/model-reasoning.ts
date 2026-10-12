// 浏览器与主进程共用的模型思考配置。保持无 Node/Electron 依赖。
// 来源与模型限制见 docs/research/reasoning-effort-2026-10-12.md。
export type ReasoningKind = 'deepseek' | 'kimi' | 'glm' | 'qwen' | 'qwen-local' | 'minimax' | 'doubao' | 'standard';
export interface ReasoningOverride {
  endpoint: string;
  model: string;
  kind: ReasoningKind;
  options: Array<{ value: string; label: string }>;
  defaultEffort: string;
}
export const reasoningKinds: ReasoningKind[] = ['standard', 'deepseek', 'kimi', 'glm', 'qwen', 'qwen-local', 'minimax', 'doubao'];
export function reasoningModelKey(endpoint: string, model: string): string {
  return JSON.stringify([String(endpoint || '').trim().replace(/\/+$/, ''), String(model || '').trim()]);
}

// 只保存合法且互不重复的档位。空列表明确表示不支持调整，不能退回内置猜测。
export function normalizeReasoningOverrides(value: unknown): ReasoningOverride[] {
  const result: ReasoningOverride[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item !== 'object') continue;
    const endpoint = String(item.endpoint || '').trim();
    const model = String(item.model || '').trim();
    const key = reasoningModelKey(endpoint, model);
    if (!endpoint || !model || seen.has(key) || !Array.isArray(item.options) || !reasoningKinds.includes(item.kind)) continue;
    const options: ReasoningOverride['options'] = [];
    for (const option of item.options.slice(0, 32)) {
      const value = String(option?.value || '').trim();
      const label = String(option?.label || '').trim();
      if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(value) || !label || label.length > 80 || options.some(entry => entry.value === value)) continue;
      options.push({ value, label });
    }
    const defaultEffort = String(item.defaultEffort || '').trim();
    result.push({ endpoint, model, kind: item.kind, options,
      defaultEffort: options.some(option => option.value === defaultEffort) ? defaultEffort : '' });
    seen.add(key);
  }
  return result;
}

export function findReasoningOverride(overrides: unknown, endpoint: string, model: string): ReasoningOverride | undefined {
  const key = reasoningModelKey(endpoint, model);
  return normalizeReasoningOverrides(overrides).find(item => reasoningModelKey(item.endpoint, item.model) === key);
}

export function updateReasoningOverride(overrides: unknown, endpoint: string, model: string, override: ReasoningOverride | null): ReasoningOverride[] {
  const key = reasoningModelKey(endpoint, model);
  const remaining = normalizeReasoningOverrides(overrides).filter(item => reasoningModelKey(item.endpoint, item.model) !== key);
  return override ? normalizeReasoningOverrides([...remaining, { ...override, endpoint, model }]) : remaining;
}

export interface ModelReasoningConfig {
  kind: ReasoningKind;
  efforts: string[];
  defaultEffort: string;
  labels: Record<string, string>;
  aliases: Record<string, string>;
  description: string;
  source?: 'builtin' | 'unknown' | 'custom';
}

const labels: Record<string, string> = {
  off: '关闭思考', on: '开启思考', auto: '自动决定', adaptive: '自适应思考',
  minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', ultra: '极高',
};
const deepseekMapping = [
  ['minimal', 'low'], ['low', 'low'], ['medium', 'high'], ['high', 'high'],
  ['xhigh', 'high'], ['max', 'max'], ['ultra', 'max'],
].map(([requested, actual]) => ({ requested, actual }));

export function reasoningProvider(endpoint: string): string | null {
  let host: string;
  try { host = new URL(String(endpoint || '').trim()).hostname.toLowerCase(); } catch { return null; }
  if (host === 'api.deepseek.com') return 'deepseek';
  if (['api.kimi.com', 'api.kimi.ai'].includes(host)) return 'kimi';
  if (['api.moonshot.cn', 'api.moonshot.ai'].includes(host)) return 'kimi-open';
  if (host === 'open.bigmodel.cn') return 'glm';
  if (['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'dashscope-us.aliyuncs.com'].includes(host)
    || host.endsWith('.maas.aliyuncs.com')) return 'qwen';
  if (['api.minimaxi.com', 'api.minimax.io'].includes(host)) return 'minimax';
  if (host === 'api.openai.com') return 'openai';
  if (host === 'generativelanguage.googleapis.com') return 'gemini';
  if (host === 'api.x.ai') return 'xai';
  if (/^ark\.[^.]+\.volces\.com$/.test(host)) return 'doubao';
  return null;
}

export function getModelReasoningConfig({ endpoint = '', provider, model = '', overrides }: {
  endpoint?: string; provider?: string | null; model?: string; overrides?: unknown;
}): ModelReasoningConfig {
  const override = findReasoningOverride(overrides, endpoint, model);
  if (override) return {
    kind: override.kind, efforts: override.options.map(option => option.value), defaultEffort: override.defaultEffort,
    labels: Object.fromEntries(override.options.map(option => [option.value, option.label])), aliases: {}, source: 'custom',
    description: override.options.length ? '使用此接入地址和模型的自定义档位。' : '此模型已设为不支持调整思考强度。',
  };
  return getBuiltinReasoningConfig({ endpoint, provider, model });
}

function getBuiltinReasoningConfig({ endpoint = '', provider, model = '' }: {
  endpoint?: string; provider?: string | null; model?: string;
}): ModelReasoningConfig {
  const id = provider ?? reasoningProvider(endpoint);
  const name = String(model || '').trim().replace(/\s*\[[\d.]+\s*[kKmM]?\]$/, '').toLowerCase();
  const config = (kind: ReasoningKind, efforts: string[], defaultEffort = '', description = '',
    aliases: Record<string, string> = {}, customLabels: Record<string, string> = {}): ModelReasoningConfig => ({
    kind, efforts, defaultEffort, description, aliases, labels: { ...labels, ...customLabels },
  });
  switch (id) {
    case 'deepseek':
      return config('deepseek', ['low', 'high', 'max'], 'high', '思考默认开启，支持低、高、最高三档，默认使用高。',
        Object.fromEntries(deepseekMapping.map(item => [item.requested, item.actual])));
    case 'kimi':
    case 'kimi-open':
      if (!name || /^(k3|kimi-k3)(?:[-_]|$)/.test(name)) {
        // 用户要求两种 K3 接入均默认 high；不再将其称为开放平台的厂商默认。
        return config('kimi', ['low', 'high', 'max'], 'high', '默认使用高（high）。支持低、高、最高三档。',
          { minimal: 'low', minimum: 'low', light: 'low', medium: 'high', xhigh: 'max', ultra: 'max' });
      }
      if (id === 'kimi-open' && /^kimi-k2\.6(?:[-_]|$)/.test(name)) {
        return config('kimi', ['off', 'on'], 'on', '该模型支持开启或关闭思考，不支持低、高、最高档位。', { none: 'off' });
      }
      return config('kimi', [], '', '该模型不提供已确认可调的思考强度档位。');
    case 'glm':
      if (!name || /^glm-5\.3(?:[-_]|$)/.test(name)) {
        return config('glm', ['low', 'high', 'max'], 'max', '默认使用深度思考（max）；该模型不能关闭思考。', {},
          { low: '轻量思考', high: '增强思考', max: '深度思考' });
      }
      if (/^glm-5\.2(?:[-_]|$)/.test(name)) {
        return config('glm', ['off', 'high', 'max'], 'max', '默认使用深度思考（max）；旧设置中的低、中对应增强思考。',
          { none: 'off', minimal: 'off', low: 'high', medium: 'high', xhigh: 'max' },
          { high: '增强思考', max: '深度思考' });
      }
      if (/^glm-(5(?:\.[01])?|4\.[567])(?:[-_]|$)/.test(name)) {
        return config('glm', ['off', 'on'], '', '该模型支持思考开关，不提供强度档位。', { none: 'off' });
      }
      return config('glm', [], '', '该模型不提供已确认可调的思考强度档位。');
    case 'qwen':
      if (/^qwen3[.-]8(?:[-_]|$)/.test(name)) {
        return config('qwen', ['off', 'low', 'medium', 'xhigh'], 'xhigh', '默认使用超高（xhigh）。支持关闭、低、中、超高。',
          { none: 'off', minimal: 'low', high: 'xhigh', max: 'xhigh' });
      }
      return config('qwen', [], '', '该模型的思考设置尚未确认，使用模型默认。');
    case 'minimax':
      if (/^minimax-m3\.1-flash-preview(?:[-_]|$)/.test(name)) {
        return config('minimax', ['low', 'medium', 'high', 'xhigh', 'max'], 'max', '默认使用最高（max）；该模型不能关闭思考。');
      }
      if (!name || name === 'minimax-m3') return config('minimax', ['off', 'adaptive'], 'adaptive', '默认开启自适应思考。', { none: 'off', on: 'adaptive' });
      return config('minimax', [], '', '该模型始终开启思考，不提供已确认可调的强度档位。');
    case 'openai':
      if (/^gpt-5\.6(?:[-_]|$)/.test(name)) return config('standard', ['off', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium', '默认使用中（medium）。', { none: 'off' });
      if (/^gpt-5\.3-codex(?:[-_]|$)/.test(name)) return config('standard', ['low', 'medium', 'high', 'xhigh'], '', '支持低、中、高、超高；不支持关闭和最高。');
      if (/^gpt-5\.2(?:[-_]|$)/.test(name)) return config('standard', ['off', 'low', 'medium', 'high', 'xhigh'], 'off', '默认关闭思考。', { none: 'off' });
      return config('standard', [], '', '该模型的思考强度支持范围尚未确认，使用模型默认。');
    case 'gemini':
      if (/^gemini-3\.1-pro(?:[-_]|$)/.test(name)) return config('standard', ['low', 'medium', 'high'], 'high', '默认使用高（high）；不能关闭思考。', { minimal: 'low' });
      if (/^gemini-3-pro(?:[-_]|$)/.test(name)) return config('standard', ['low', 'high'], 'high', '默认使用高（high）；仅支持低、高。');
      if (/^gemini-3-flash(?:[-_]|$)/.test(name)) return config('standard', ['minimal', 'low', 'medium', 'high'], 'high', '默认使用高（high）；最低档仍会思考。');
      if (/^gemini-2\.5-(pro|flash)(?:[-_]|$)/.test(name)) return config('standard', [...(name.includes('-flash') ? ['off'] : []), 'low', 'medium', 'high'], '', '默认使用模型推荐的思考预算。', { none: 'off' });
      return config('standard', [], '', '该模型的思考强度支持范围尚未确认，使用模型默认。');
    case 'xai':
      if (/^grok-4\.[567](?:[-_]|$)/.test(name)) return config('standard', ['low', 'medium', 'high', ...(name.startsWith('grok-4.5') ? [] : ['xhigh'])], 'high', '默认使用高（high）；不能关闭思考。', name.startsWith('grok-4.5') ? { xhigh: 'high' } : {});
      return config('standard', [], '', '该模型的思考强度支持范围尚未确认，使用模型默认。');
    case 'doubao':
      if (name === 'doubao-seed-evolving') return config('doubao', ['off', 'low', 'medium', 'high'], 'high', '默认使用高（high）；不支持自动决定是否思考。', { none: 'off', minimal: 'off', xhigh: 'high', max: 'high' });
      if (name === 'doubao-seed-1-6-250615') return config('doubao', ['off', 'on', 'auto'], '', '该版本支持思考模式，不支持强度档位。', { none: 'off' });
      return config('doubao', [], '', '请确认模型或接入点支持的思考设置；当前使用模型默认。');
    default:
      if (id === 'qwen-local') {
        return config('qwen-local', ['off', 'low', 'medium', 'xhigh'], 'xhigh', '默认开启思考并使用超高（xhigh）；需本地服务支持对应设置。',
          { none: 'off', on: 'xhigh', minimal: 'low', high: 'xhigh', max: 'xhigh' });
      }
      return { ...config('standard', [], '', '尚未确认此服务和模型支持哪些档位。可管理档位，或使用模型默认。'), source: 'unknown' };
  }
}

// 旧设置中的兼容名称折算为实际档位；界面和请求都使用同一结果。
export function selectedReasoningEffort(config: ModelReasoningConfig, effort: string | undefined): string {
  const raw = String(effort || '').trim();
  if (config.efforts.includes(raw)) return raw;
  const alias = config.aliases[raw];
  return alias && config.efforts.includes(alias) ? alias : config.defaultEffort;
}

export function effectiveReasoningEffort(config: ModelReasoningConfig, effort: string | undefined): string {
  return selectedReasoningEffort(config, effort);
}

export function reasoningOptionLabel(config: ModelReasoningConfig, effort: string): string {
  return `${config.labels[effort] || effort}${effort === config.defaultEffort ? ' · 默认' : ''}`;
}
