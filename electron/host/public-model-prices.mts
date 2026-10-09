/** Public price data only: no caller URL, headers, credentials or redirects. */
export const PUBLIC_MODEL_PRICES_PATH = '/api/dyworker/public-model-prices';
export async function readPublicModelPrices(signal: AbortSignal, fetchImpl: typeof fetch = fetch) {
  const lifetime = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  lifetime.throwIfAborted();
  const response = await fetchImpl('https://models.dev/api.json', {
    method: 'GET', credentials: 'omit', redirect: 'error',
    headers: { accept: 'application/json' }, signal: lifetime,
  });
  if (!response.ok) throw new Error(`模型价格资料读取失败：${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('模型价格资料没有响应内容');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      lifetime.throwIfAborted();
      const { value, done } = await reader.read();
      lifetime.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32 * 1024 * 1024) throw new Error('模型价格资料超过读取限制');
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型价格资料格式无效');
    return { status: 200, headers: { 'content-type': 'application/json' }, body };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
