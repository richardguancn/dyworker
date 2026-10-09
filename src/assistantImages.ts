import type { Attachment, ChatMessage } from './types.ts';

/** 只显示已交付的助手图片字节；工具图片、远程地址和文本里的地址不作为图片结果。 */
export function assistantImageAttachments(message: Pick<ChatMessage, 'executedMessages'>): Attachment[] {
  const result: Attachment[] = [];
  for (const item of message.executedMessages || []) {
    if (item.role !== 'assistant' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type !== 'image_url') continue;
      const url = part.image_url?.url;
      const match = typeof url === 'string' ? /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url) : null;
      if (!match || match[2].length % 4 !== 0) continue;
      const padding = match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0;
      result.push({ name: `助手返回图片 ${result.length + 1}`, path: '', previewUrl: url, mimeType: match[1],
        size: match[2].length / 4 * 3 - padding, isImage: true });
    }
  }
  return result;
}
