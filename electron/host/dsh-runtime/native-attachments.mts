import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../../agent.mts';

export const readAttachmentTool = { function: { name: 'read_attachment', description: '读取本会话实际上传的文件并提取文字。使用消息中附件的 attachment_id；不接受文件路径。支持范围与应用的文件读取一致，图片已经直接提供给模型。', parameters: {
  type: 'object', properties: { attachment_id: { type: 'string', description: '本会话文件附件的真实编号' } }, required: ['attachment_id'], additionalProperties: false,
} } };

/** 只接收实际执行任务已存储的文件引用；验证字节后复制到插件不可写的临时目录再解析。 */
export async function readNativeAttachment(store: any, refs: Map<string, any>, args: any, signal: AbortSignal) {
  signal.throwIfAborted();
  const ref = refs.get(String(args.attachment_id || ''));
  if (!ref) throw new Error('此文件不是本会话已上传的附件');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-read-attachment-'));
  try {
    const file = path.join(dir, path.basename(store.fileHostPath(ref)));
    const handle = await fs.open(file, 'wx', 0o600);
    try { for await (const chunk of store.readFileStream(ref, signal)) { signal.throwIfAborted(); await handle.writeFile(chunk); } }
    finally { await handle.close(); }
    signal.throwIfAborted();
    const workspace = new Workspace(dir, { trustTempDirs: false, trustSkillRoots: false, signal });
    const text = await workspace.readFile(path.basename(file));
    signal.throwIfAborted();
    return `附件：${ref.name}\n${text}`;
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

export function rememberFileAttachments(content: any[], refs: Map<string, any>) {
  for (const part of content || []) if (part?.type === 'file' && part.attachment?.attachmentId)
    refs.set(part.attachment.attachmentId, part.attachment);
}
