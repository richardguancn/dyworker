import { promises as fs } from 'node:fs';
import path from 'node:path';

/** 分批写入完整原始记录，避免把整个运行的轨迹一直攒到任务结束。 */
export function createTraceWriter(file: string, {
  delayMs = 1000, batchBytes = 256 * 1024, storage = fs,
  onError = (error: unknown) => console.warn('[trace] 保存失败，将重试', error),
} = {}) {
  let pending: string[] = [];
  let pendingBytes = 0;
  let working: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let ready = false;
  let writtenBytes = 0;
  const schedule = () => {
    // close 只停止接收新记录；收尾失败的记录仍须在进程存活期间自动重试。
    if (timer || !pending.length) return;
    timer = setTimeout(() => { timer = null; void flush().catch(onError); }, delayMs);
    timer.unref?.();
  };
  const flush = (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (working) return working;
    working = Promise.resolve().then(async () => {
      while (pending.length) {
        const batch = pending;
        const bytes = pendingBytes;
        pending = []; pendingBytes = 0;
        try {
          if (!ready) { await storage.mkdir(path.dirname(file), { recursive: true }); ready = true; }
          await storage.appendFile(file, batch.join(''), 'utf8');
          writtenBytes += bytes;
        } catch (error) {
          pending = [...batch, ...pending]; pendingBytes += bytes;
          throw error;
        }
      }
    }).finally(() => { working = null; schedule(); });
    return working;
  };
  return {
    push(record: unknown) {
      if (closed) throw new Error('轨迹写入器已关闭');
      const line = JSON.stringify(record) + '\n';
      pending.push(line); pendingBytes += Buffer.byteLength(line);
      if (pendingBytes >= batchBytes) void flush().catch(onError);
      else schedule();
    },
    flush,
    async close() {
      closed = true;
      await flush();
    },
    stats: () => ({ pendingBytes, writtenBytes }),
  };
}
