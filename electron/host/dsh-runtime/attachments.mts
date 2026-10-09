import LocalAttachments from '@deepseek-ai/dsh-attachment-local';
const encoded = (input: any) => ({ ...input, data: Buffer.from(input.data).toString('base64') });
/** 图片解码和转换由宿主完成；文件仍使用官方流式保存，不在 IPC 中缓存整份文件。 */
export function attachmentProxy(ask: any) {
  return class extends LocalAttachments {
    saveFile(input: any): Promise<any> {
      return this.saveFileStream({ name: input.name, data: (async function* () { yield input.data; })() });
    }
    async saveFileStream(input: any) {
      const id = await ask('attachment', { action: 'upload-open', name: input.name }, input.signal);
      try {
        for await (const chunk of input.data) {
          input.signal?.throwIfAborted();
          for (let at = 0; at < chunk.length; at += 65536)
            await ask('attachment', { action: 'upload-write', uploadId: id, data: Buffer.from(chunk.subarray(at, at + 65536)).toString('base64') }, input.signal);
        }
        return await ask('attachment', { action: 'upload-close', uploadId: id }, input.signal);
      } catch (error) { await ask('attachment', { action: 'upload-abort', uploadId: id }).catch(() => {}); throw error; }
    }
    validateImage(input: any): Promise<void> { return ask('attachment', { action: 'validate-image', inputs: [encoded(input)] }); }
    saveImage(input: any): Promise<any> { return ask('attachment', { action: 'save-images', inputs: [encoded(input)] }).then((refs: any[]) => refs[0]); }
    saveImages(inputs: any[]): Promise<any> { return ask('attachment', { action: 'save-images', inputs: inputs.map(encoded) }); }
    async readImage(ref: any, signal?: AbortSignal): Promise<any> {
      const image = await ask('attachment', { action: 'read-image', ref }, signal);
      return { ...image, data: Buffer.from(image.data, 'base64') };
    }
    async readImageRequest(ref: any, target: any, signal?: AbortSignal): Promise<any> {
      const image = await ask('attachment', { action: 'read-request-image', ref, target }, signal);
      return { ...image, data: Buffer.from(image.data, 'base64') };
    }
  };
}

/** 已由原生入口接收的图片字节转为官方上传内容；不把 URL 或路径当作图片字节。 */
export function nativeDshContent(content: any): any[] {
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content ?? '') }];
  return content.map(part => {
    if (part?.type === 'dsh-file-receipt' && typeof part.receiptId === 'string' && part.receiptId) return {type:'file-receipt', receiptId:part.receiptId};
    if (['text', 'input_text'].includes(part?.type)) return { type: 'text', text: String(part.text || '') };
    if (part?.type === 'image_url' || part?.type === 'input_image') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      const match = String(url || '').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/);
      if (!match) throw new Error('DSH 图片需要已上传的 PNG、JPEG、WebP 或 GIF 字节，请重新添加图片');
      return { type: 'image', mediaType: match[1], data: match[2], ...(part.name ? { name: String(part.name) } : {}) };
    }
    if (part?.type === 'input_file' && typeof part.file_data === 'string') {
      const match = part.file_data.match(/^data:[^;,]*;base64,([A-Za-z0-9+/]*={0,2})$/);
      if (!match) throw new Error('DSH 文件需要已上传的文件字节');
      return { type: 'encoded-file', data: match[1], name: String(part.filename || 'attachment') };
    }
    throw new Error(`DSH 不支持此附件内容：${part?.type || '未知类型'}`);
  });
}
