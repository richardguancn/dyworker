import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const identity = (stat: any) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
/** 仅原生选择器和实际剪贴板保存可发行；渲染端不能以路径换取读取权限。 */
export class CommandAttachmentGrants {
  private rows = new Map<string, any>();
  async issue(sessionId: string, senderId: number, attachment: any) {
    const filePath = await fs.realpath(attachment.path);
    const stat = await fs.stat(filePath, { bigint: true });
    if (!stat.isFile()) throw new Error('附件不是普通文件');
    const id = randomUUID();
    this.rows.set(id, { sessionId, senderId, filePath, identity: identity(stat), name: attachment.name,
      image: attachment.isImage === true, mediaType: attachment.mimeType });
    return { ...attachment, commandGrantId: id };
  }
  releaseSender(senderId: number) { for (const [id, row] of this.rows) if (row.senderId === senderId) this.rows.delete(id); }
  async stage(sessionId: string, senderId: number, ids: readonly string[], dataDir: string) {
    if (!Array.isArray(ids) || ids.length > 12 || new Set(ids).size !== ids.length) throw new Error('附件清单无效');
    const rows = ids.map(id => {
      const row = this.rows.get(id);
      if (!row || row.sessionId !== sessionId || row.senderId !== senderId) throw new Error('附件不属于当前会话，请重新选择');
      return row;
    });
    const base = path.join(dataDir, 'command-uploads'); await fs.mkdir(base, { recursive: true });
    const dir = await fs.mkdtemp(path.join(base, 'staged-'));
    const dispose = () => fs.rm(dir, { recursive: true, force: true });
    try {
      const files = [];
      for (const [index, row] of rows.entries()) {
        const handle = await fs.open(row.filePath, 'r');
        try {
          const before = await handle.stat({ bigint: true });
          if (!before.isFile() || identity(before) !== row.identity) throw new Error('附件在选择后发生变化，请重新选择');
          const filePath = path.join(dir, String(index));
          await pipeline(handle.createReadStream({ autoClose: false }), createWriteStream(filePath, { flags: 'wx', mode: 0o600 }));
          if (identity(await handle.stat({ bigint: true })) !== row.identity) throw new Error('附件在读取期间发生变化，请重新选择');
          files.push({ filePath, name: row.name, image: row.image, mediaType: row.mediaType });
        } finally { await handle.close(); }
      }
      return { files, dispose };
    } catch (error) { await dispose(); throw error; }
  }
}
