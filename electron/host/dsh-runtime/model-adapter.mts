import { requestModel, sanitizeEndpointUrl } from '../../agent.mts';
import { fileHandleText, requestImageHandleText, offloadedImageText } from '@deepseek-ai/dsh-llm';

async function admitProviderImage(part: any, attachments: any, signal?: AbortSignal) {
  if (!attachments) throw new Error('当前任务没有模型图片保存入口');
  signal?.throwIfAborted();
  const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
  let mediaType: string, encoded: string;
  if (url !== undefined) {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(String(url));
    if (!match) throw new Error('模型返回的图片需要实际 PNG、JPEG、WebP 或 GIF 字节，不能使用远程地址');
    [, mediaType, encoded] = match;
  } else {
    mediaType = part.mediaType ?? part.mimeType; encoded = part.data;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType) || typeof encoded !== 'string')
      throw new Error('模型返回的图片格式或字节无效');
  }
  const data = Buffer.from(encoded, 'base64');
  if (!data.length || data.toString('base64') !== encoded) throw new Error('模型返回的图片字节编码无效');
  const attachment = await attachments.saveImage({ mediaType, data, ...(typeof part.name === 'string' ? { name: part.name } : {}) });
  signal?.throwIfAborted(); return attachment;
}

// 凭据始终由 DYWorker 提供方保管；仅向 DSH 返回模型内容、工具调用与用量。
export function toProviderMessages(messages: any[], options: any = {}) {
  return messages.map(message => {
    const blocks = Array.isArray(message.content) ? message.content : [];
    const text = blocks.filter(block => block.type === 'text').map(block => block.text || '').join('\n');
    const reasoning = blocks.filter(block => block.type === 'reasoning').map(block => block.text || '').join('\n');
    const calls = blocks.filter(block => block.type === 'tool-call');
    const unsupported = blocks.filter(block => !['text', 'reasoning', 'tool-call', 'image', 'file'].includes(block.type));
    if (unsupported.length) throw new Error(`DSH 模型桥暂不支持这些内容：${unsupported.map(block => block.type).join('、')}`);
    const mixed = blocks.some(block => ['image', 'file'].includes(block.type));
    const content = mixed ? blocks.flatMap(block => {
      if (block.type === 'text') return [{ type: 'text', text: block.text || '' }];
      if (block.type === 'file') {
        if (!options.attachments) throw new Error('当前任务没有附件读取入口');
        return [{ type: 'text', text: fileHandleText(block.attachment, options.attachments.fileHostPath(block.attachment)) }];
      }
      if (block.type === 'image') {
        if (!options.attachments) throw new Error('当前任务没有图片读取入口');
        const ref = block.attachment;
        const access = { readonlyPath: options.attachments.imageHostPath(ref) };
        if (block.offloaded) return [{ type: 'text', text: offloadedImageText(ref, access) }];
        const version = options.images?.get(ref.attachmentId);
        if (!version) throw new Error('图片附件没有完成实际读取');
        return [{ type: 'text', text: requestImageHandleText(ref, version, access) },
          { type: 'image_url', image_url: { url: `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}` } }];
      }
      return [];
    }) : text || (calls.length ? null : '');
    return { role: message.role, content,
      ...(reasoning ? { reasoning_content: reasoning } : {}),
      ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function',
        function: { name: call.name, arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments) } })) } : {}),
      ...(message.role === 'tool' ? { tool_call_id: message.source?.callId } : {}) };
  });
}
export async function* generateWithDyworker(settings: any, request: any, options: any = {}) {
  if (request.model !== settings.model) throw new Error('DSH 请求的模型与此会话绑定的模型不一致');
  const images = new Map();
  for (const message of request.messages || []) for (const block of message.content || []) {
    if (block.type !== 'image' || block.offloaded || images.has(block.attachment.attachmentId)) continue;
    if (!options.attachments) throw new Error('当前任务没有图片读取入口');
    const ref = block.attachment;
    const version = await options.attachments.readImageRequest(ref, { width: ref.width, height: ref.height,
      maxBytes: 4 * 1024 * 1024 }, request.signal);
    images.set(ref.attachmentId, version);
  }
  const messages = toProviderMessages(request.messages || [], { ...options, images });
  if (request.system) messages.unshift({ role: 'system', content: request.system });
  let usage: any;
  const tools = request.tools?.length ? request.tools.map(tool => ({ type: 'function', function: tool })) : false;
  options.onRequest?.({ endpoint: sanitizeEndpointUrl(settings.endpoint), model: settings.model, messages, tools,
    dshMessageSources: [...(request.system ? [null] : []), ...(request.messages || []).map((message: any) => message.source?.kind || null)] });

  const queue: any[] = [];
  let resolveQueue: (() => void) | null = null;
  const pushQueue = (item: any) => {
    queue.push(item);
    if (resolveQueue) { resolveQueue(); resolveQueue = null; }
  };

  let index = 0;
  let textIndex = -1;
  let reasoningIndex = -1;
  let currentText = '';
  let currentReasoning = '';

  const resultPromise = requestModel({ settings, messages, tools, signal: request.signal, fetchImpl: options.fetchImpl || fetch,
    onText: (value: string) => {
      options.onText?.(value);
      if (textIndex === -1) {
        textIndex = index++;
        pushQueue({ type: 'block-start', index: textIndex, blockType: 'text' });
      }
      const delta = value.slice(currentText.length);
      currentText = value;
      if (delta) pushQueue({ type: 'text-delta', index: textIndex, text: delta });
    },
    onReasoning: (value: string) => {
      options.onReasoning?.(value);
      if (reasoningIndex === -1) {
        reasoningIndex = index++;
        pushQueue({ type: 'block-start', index: reasoningIndex, blockType: 'reasoning' });
      }
      const delta = value.slice(currentReasoning.length);
      currentReasoning = value;
      if (delta) pushQueue({ type: 'reasoning-delta', index: reasoningIndex, text: delta });
    },
    onUsage: value => { usage = value; options.onUsage?.(value); }
  });

  resultPromise.then(() => pushQueue({ done: true })).catch((err) => pushQueue({ error: err }));

  while (true) {
    if (queue.length === 0) await new Promise<void>(resolve => { resolveQueue = resolve; });
    const item = queue.shift();
    if (item.error) throw item.error;
    if (item.done) break;
    yield item;
  }

  const result = await resultPromise;
  options.onResponse?.(result);

  if (reasoningIndex !== -1) {
    yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: currentReasoning } };
  } else if (result.reasoning_content || result.reasoning) {
    reasoningIndex = index++;
    const text = result.reasoning_content || result.reasoning;
    yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' };
    yield { type: 'reasoning-delta', index: reasoningIndex, text };
    yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text } };
  }

  let textFinished = false;
  if (Array.isArray(result.content)) {
    for (const part of result.content) {
      if (part.type === 'image_url' || part.type === 'image') {
        if (textIndex !== -1 && !textFinished) {
          yield { type: 'block-end', index: textIndex, block: { type: 'text', text: currentText } };
          textFinished = true;
        }
        const imgIndex = index++;
        const attachment = await admitProviderImage(part, options.attachments, request.signal);
        yield { type: 'block-start', index: imgIndex, blockType: 'image' };
        yield { type: 'block-end', index: imgIndex, block: { type: 'image', attachment } };
      } else if (part.type === 'text' || part.type === 'output_text') {
        if (textFinished) {
          textIndex = index++;
          currentText = '';
          yield { type: 'block-start', index: textIndex, blockType: 'text' };
          textFinished = false;
        } else if (textIndex === -1) {
          textIndex = index++;
          yield { type: 'block-start', index: textIndex, blockType: 'text' };
        }
        if (typeof part.text !== 'string') throw new Error('模型返回的文字内容格式无效');
        currentText += part.text;
        if (part.text) yield { type: 'text-delta', index: textIndex, text: part.text };
      } else throw new Error(`DSH 模型桥暂不支持返回的内容：${String(part.type)}`);
    }
  } else if (result.content && typeof result.content === 'string') {
    if (textIndex === -1) {
      textIndex = index++;
      yield { type: 'block-start', index: textIndex, blockType: 'text' };
    }
    const text = result.content;
    const delta = text.slice(currentText.length);
    currentText = text;
    if (delta) yield { type: 'text-delta', index: textIndex, text: delta };
  } else if (result.content != null && typeof result.content !== 'string') throw new Error('模型返回的内容格式无效');

  if (textIndex !== -1 && !textFinished) {
    yield { type: 'block-end', index: textIndex, block: { type: 'text', text: currentText } };
  }

  for (const call of result.tool_calls || []) {
    const callIndex = index++;
    yield { type: 'block-start', index: callIndex, blockType: 'tool-call' };
    const args = call.function?.arguments || '{}';
    yield { type: 'tool-call-delta', index: callIndex, id: call.id, name: call.function?.name, argumentsDelta: args };
    yield { type: 'block-end', index: callIndex, block: { type: 'tool-call', id: call.id, name: call.function?.name, arguments: args } };
  }

  if (usage) yield { type: 'usage', usage: { inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens) || 0,
    outputTokens: Number(usage.completion_tokens ?? usage.output_tokens) || 0,
    ...(Number.isFinite(usage.prompt_cache_hit_tokens) ? { cacheReadTokens: usage.prompt_cache_hit_tokens } : {}) } };
  yield { type: 'finish', reason: { kind: result.truncated ? 'max-tokens' : result.tool_calls?.length ? 'tool-calls' : 'stop' } };
}
