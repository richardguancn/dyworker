import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** 窗口提供的字节暂存；随机编号绑定根会话与窗口，不接受调用者提供的磁盘路径。 */
export class BrowserUploads {
  private rows = new Map<string, any>();
  private closed = false;
  private pending = new Set<Promise<any>>();
  open(owner: string, sender: number, dataDir: string, name: string | undefined, commit: (file: any, signal: AbortSignal) => Promise<any>) {
    const operation = this.create(owner, sender, dataDir, name, commit); this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {}); return operation;
  }
  private async create(owner: string, sender: number, dataDir: string, name: string | undefined, commit: (file: any, signal: AbortSignal) => Promise<any>) {
    if (this.closed) throw new Error('附件上传服务已关闭');
    if (name !== undefined && typeof name !== 'string') throw new Error('附件名称无效');
    const directory = path.join(dataDir, 'browser-uploads'); await fs.mkdir(directory, { recursive: true });
    const id = randomUUID(), filePath = path.join(directory, id);
    const handle = await fs.open(filePath, 'wx', 0o600);
    if (this.closed) { await handle.close(); await fs.rm(filePath, { force: true }); throw new Error('附件上传服务已关闭'); }
    this.rows.set(id, { owner, sender, handle, filePath, name, commit, controller: new AbortController(), busy: false, finishing: false });
    return id;
  }
  private row(owner: string, sender: number, id: string) {
    const row = this.rows.get(id);
    if (!row || row.owner !== owner || row.sender !== sender) throw new Error('附件上传不属于当前会话和窗口');
    row.controller.signal.throwIfAborted(); return row;
  }
  async write(owner: string, sender: number, id: string, data: string) {
    const row = this.row(owner, sender, id);
    if (row.busy || row.finishing || typeof data !== 'string' || data.length > 87384) throw new Error('附件分块顺序或大小无效');
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > 65536 || bytes.toString('base64') !== data) throw new Error('附件分块编码无效');
    row.busy = true;
    row.pending = (async () => {
      let offset = 0;
      while (offset < bytes.length) {
        row.controller.signal.throwIfAborted();
        const { bytesWritten } = await row.handle.write(bytes, offset, bytes.length - offset);
        if (!bytesWritten) throw new Error('附件写入未完成'); offset += bytesWritten;
      }
      row.controller.signal.throwIfAborted();
    })();
    try { await row.pending; }
    finally { row.busy = false; }
  }
  async finish(owner: string, sender: number, id: string) {
    const row = this.row(owner, sender, id);
    if (row.busy || row.finishing) throw new Error('附件上传尚未写完或正在结束');
    row.finishing = true;
    try {
      await row.handle.close(); row.handle = undefined;
      row.controller.signal.throwIfAborted();
      const value = await row.commit({ filePath: row.filePath, name: row.name }, row.controller.signal);
      row.controller.signal.throwIfAborted(); return value;
    } finally { await this.release(id, row); }
  }
  async cancel(owner: string, sender: number, id: string) {
    const row = this.row(owner, sender, id); await this.release(id, row);
  }
  private release(id: string, row: any) {
    if (row.cleanup) return row.cleanup;
    const operation = (async () => {
      if (this.rows.get(id) === row) this.rows.delete(id);
      row.controller.abort(new Error('附件上传已取消'));
      await row.pending?.catch(() => {});
      await row.handle?.close().catch(() => {}); row.handle = undefined;
      await fs.rm(row.filePath, { force: true });
    })();
    row.cleanup = operation; this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {}); return operation;
  }
  async releaseSender(sender: number) {
    await Promise.all([...this.rows].filter(([, row]) => row.sender === sender).map(([id, row]) => this.release(id, row)));
  }
  async dispose() {
    this.closed = true; await Promise.all([...this.rows].map(([id, row]) => this.release(id, row)));
    await Promise.allSettled([...this.pending]);
  }
}
