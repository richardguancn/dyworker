import type { ActivityRecord, Attachment } from './types.ts';
import { localImagePathFromSource } from '../electron/local-image-path.mts';

/** 只使用工具明确返回的图片记录，不从命令文本猜测路径。 */
export function processImageAttachments(activity: Pick<ActivityRecord, 'detail' | 'status'>): Attachment[] {
  if (activity.status !== 'success' || !activity.detail) return [];
  try {
    const data = JSON.parse(activity.detail);
    if (!Array.isArray(data?.images)) return [];
    return data.images.flatMap((image: any) => {
      if (typeof image?.path !== 'string') return [];
      const path = localImagePathFromSource(image.path);
      if (!path) return [];
      return [{ path, name: typeof image.name === 'string' ? image.name : path.split(/[\\/]/).pop() || '图片', isImage: true, size: 0, mimeType: 'image/*' }];
    });
  } catch { return []; }
}
