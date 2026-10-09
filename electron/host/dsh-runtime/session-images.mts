import path from 'node:path';
import { readSessionFamily } from './session-family.mts';
import { referencedImage } from './vendor/referenced-image.mts';

/** 公开调用只接受任务和不透明图片编号；真实描述来自官方日志，不能由界面传入路径或图片引用。 */
export async function readSessionImage(ctx: any, rootId: string, payload: any, signal: AbortSignal) {
  const target = payload?.targetSessionId ?? rootId;
  const id = payload?.attachmentId;
  if (typeof target !== 'string' || !target || typeof id !== 'string' || !id || id.length > 512)
    throw new Error('历史图片读取需要有效的任务和图片编号');
  signal.throwIfAborted();
  const rootHeader = ctx.agents.get(rootId)?.session.header;
  if (!rootHeader) throw new Error('历史图片所属根任务不可用');
  let source: any;
  if (target !== rootId) source = await readSessionFamily(ctx, rootId, signal, target);
  else {
    const observed = await ctx.sessionQuery.observeSession(rootId, {signal});
    try { source = {header: observed.header, events: observed.events}; }
    finally { observed[Symbol.dispose](); }
  }
  if (source.header.id !== target || path.resolve(source.header.cwd || '') !== path.resolve(rootHeader.cwd || ''))
    throw new Error('历史图片所属任务不属于本工作目录');
  const ref = referencedImage(source.events, id);
  if (!ref) throw Object.assign(new Error('此图片未出现在所选任务的记录中'),
    {code:'session/attachment-invalid', details:{reason:'ATTACHMENT_NOT_REFERENCED'}});
  const stored = await ctx.attachments.readImage(ref, signal);
  signal.throwIfAborted();
  return {attachment:stored.ref, data:Buffer.from(stored.data).toString('base64')};
}
