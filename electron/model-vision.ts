// 浏览器与主进程共用的模型视觉能力配置。保持无 Node/Electron 依赖。
import { reasoningProvider } from './model-reasoning.ts';

export type VisionMode = 'native' | 'service';
export type VisionModeSelection = 'auto' | VisionMode;

export interface VisionOverride {
  endpoint: string;
  model: string;
  mode: VisionMode;
}

export interface ModelVisionConfig {
  mode: VisionMode;
  selection: VisionModeSelection;
  source: 'auto' | 'custom';
  builtinMode: VisionMode;
}

const CONTEXT_SUFFIX_PATTERN = /^(.*?)\s*\[([0-9]+(?:\.[0-9]+)?)\s*([kKmM])?\]$/;

function stripModelSuffix(model: string): string {
  const raw = String(model || '').trim();
  const match = raw.match(CONTEXT_SUFFIX_PATTERN);
  return match ? match[1].trim() : raw;
}

function bareModelKey(model: string): string {
  return stripModelSuffix(model).toLowerCase();
}

export function normalizeCapabilityEndpoint(endpoint: string): string {
  const raw = String(endpoint || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.hostname.toLowerCase() === 'api.deepseek.com' && (url.pathname === '' || url.pathname === '/')) {
      url.pathname = '/responses';
      url.search = '';
      url.hash = '';
      return url.toString();
    }
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    const formatted = url.toString();
    return url.pathname === '/' && !raw.endsWith('/') ? formatted.replace(/\/$/, '') : formatted.replace(/\/+$/, '');
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

export function visionModelKey(endpoint: string, model: string): string {
  return JSON.stringify([normalizeCapabilityEndpoint(endpoint), bareModelKey(model)]);
}

// GLM 多模态判定：不再用狭隘白名单封锁后续新模型（如 glm-5.4 及以上），
// 仅对明确已知为纯文本的历史版本（glm-5.3 / 5.2 / 5.1 / 5 / 4.x 非 V 版）返回 false，
// 已知多模态版（glm-5.3-flash、*v 系）与后续新一代 GLM 模型默认视为原生支持图片。
export function isGlmNativeVisionModel(model: string): boolean {
  const bare = stripModelSuffix(model).trim();
  if (!/^glm-/i.test(bare)) return false;
  if (/^glm-(?:5\.3-flash|\d+(?:\.\d+)?v)(?=[-_]|$)/i.test(bare)) return true;
  if (/^glm-(?:5\.[0-3]|5|4(?:\.[0-7])?)(?=[-_]|$)/i.test(bare)) return false;
  return true;
}

export function inferBuiltinVisionMode({ endpoint = '', model = '' }: {
  endpoint?: string;
  model?: string;
}): VisionMode {
  const bare = bareModelKey(model);
  if (!bare) return 'native';
  // 已知历史纯文本模型：DeepSeek V4 Flash / Pro（不含 vision 版）
  if (bare === 'deepseek-v4-flash' || bare === 'deepseek-v4-pro') return 'service';
  // 仅对智谱官方云端端点下已知历史纯文本 GLM 模型默认启用视觉服务；
  // 自建网关（vLLM 等）透传或新一代模型（如 glm-5.4）默认原样直通。
  const provider = reasoningProvider(endpoint);
  if (provider === 'glm' && /^glm-/.test(bare) && !isGlmNativeVisionModel(bare)) {
    return 'service';
  }
  return 'native';
}

export function normalizeVisionOverrides(value: unknown): VisionOverride[] {
  const result: VisionOverride[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { endpoint?: unknown; model?: unknown; mode?: unknown };
    const endpoint = String(record.endpoint || '').trim();
    const model = stripModelSuffix(String(record.model || ''));
    const mode = record.mode === 'native' || record.mode === 'service' ? record.mode : null;
    if (!endpoint || !model || !mode) continue;
    const key = visionModelKey(endpoint, model);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ endpoint, model, mode });
  }
  return result;
}

export function findVisionOverride(
  overrides: unknown,
  endpoint: string,
  model: string,
): VisionOverride | undefined {
  const key = visionModelKey(endpoint, model);
  return normalizeVisionOverrides(overrides).find((item) => visionModelKey(item.endpoint, item.model) === key);
}

export function updateVisionOverride(
  overrides: unknown,
  endpoint: string,
  model: string,
  mode: VisionMode | null,
): VisionOverride[] {
  const cleanEndpoint = String(endpoint || '').trim();
  const cleanModel = stripModelSuffix(model);
  const key = visionModelKey(cleanEndpoint, cleanModel);
  const remaining = normalizeVisionOverrides(overrides).filter(
    (item) => visionModelKey(item.endpoint, item.model) !== key,
  );
  if (!mode || !cleanEndpoint || !cleanModel) return remaining;
  return normalizeVisionOverrides([...remaining, { endpoint: cleanEndpoint, model: cleanModel, mode }]);
}

export function resolveModelVisionConfig({
  endpoint = '',
  model = '',
  overrides,
}: {
  endpoint?: string;
  model?: string;
  overrides?: unknown;
}): ModelVisionConfig {
  const builtinMode = inferBuiltinVisionMode({ endpoint, model });
  const saved = findVisionOverride(overrides, endpoint, model);
  if (saved) {
    return {
      mode: saved.mode,
      selection: saved.mode,
      source: 'custom',
      builtinMode,
    };
  }
  return {
    mode: builtinMode,
    selection: 'auto',
    source: 'auto',
    builtinMode,
  };
}
