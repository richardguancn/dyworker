export function isLocalModelEndpoint(endpoint: unknown): boolean {
  try {
    const url = new URL(String(endpoint ?? '').trim());
    return ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

export function hasConfiguredModel(settings: any): boolean {
  return ['endpoint', 'model'].every(key => typeof settings?.[key] === 'string' && Boolean(settings[key].trim()))
    && (typeof settings.apiKey === 'string' && Boolean(settings.apiKey.trim()) || isLocalModelEndpoint(settings.endpoint));
}

// DSH 必须运行真实模型；缺少设置时不能降级成原生演示任务。
export function assertDshModelSettings(runtime: unknown, settings: any) {
  if (runtime !== 'dsh') return;
  if (!hasConfiguredModel(settings)) {
    throw new Error('DSH 任务需要完整的模型服务设置，请填写服务地址、模型名称和密钥后重试；本机免密服务可以不填密钥');
  }
}
