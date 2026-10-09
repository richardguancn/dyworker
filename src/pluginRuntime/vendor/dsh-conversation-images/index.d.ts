import type { Context } from '@deepseek-ai/cordis';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
export class HistoricalImageCache {
  constructor(ctx: Context, sessions: {binding(id: string): {ctx: Context; session: {readAttachment(id: string): Promise<any>}} | undefined});
  resolve(id: string, attachment: ImageAttachmentRef): Promise<string>;
  peek(id: string, attachment: ImageAttachmentRef): string | undefined;
  seed(id: string, attachment: ImageAttachmentRef, url: string): boolean;
}
