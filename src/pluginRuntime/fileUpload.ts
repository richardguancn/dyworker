import { Service, type Context } from '@deepseek-ai/cordis';
import { awaitInput } from './inputTriggers.ts';
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol';

interface UploadBridge {
  (request: { action: string; sessionId: string; uploadId?: string; data?: string; name?: string }): Promise<any>;
}
const base64 = (bytes: Uint8Array) => {
  let result = ''; for (let at = 0; at < bytes.length; at += 32768) result += String.fromCharCode(...bytes.subarray(at, at + 32768));
  return btoa(result);
};

/** 官方 FileUploadService 的浏览器字节入口；磁盘保存和会话凭据由官方服务处理。 */
export class BrowserFileUpload extends Service {
  private operations = new Set<AbortController>();
  private disposed = false;
  private bridge: UploadBridge;
  private owns: (id: string) => boolean;
  constructor(ctx: Context, bridge: UploadBridge, owns: (id: string) => boolean) {
    super(ctx, 'fileUpload');
    this.bridge = bridge; this.owns = owns;
    ctx.effect(() => () => { this.disposed = true; for (const operation of this.operations) operation.abort(new Error('附件上传服务已关闭')); });
  }
  async upload(sessionId: string, data: Blob | Uint8Array | ReadableStream<Uint8Array>, name?: string,
    signal?: AbortSignal, onProgress?: (value: { loaded: number; total?: number }) => void) {
    if (this.disposed || !this.owns(sessionId)) throw new Error('附件需要仍被保留的 DSH 根会话');
    if (!(data instanceof Blob) && !(data instanceof Uint8Array) && !(data instanceof ReadableStream)) throw new TypeError('附件需要浏览器文件、字节或字节流');
    const controller = new AbortController(); this.operations.add(controller);
    const active = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let uploadId: string | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => {
      if (uploadId) void this.bridge({ action: 'cancel', sessionId, uploadId }).catch(() => {});
      if (reader) void reader.cancel(active.reason).catch(() => {});
    };
    active.addEventListener('abort', cancel, { once: true });
    const invoke = async (action: string, extra: any = {}) => {
      active.throwIfAborted();
      const result = await awaitInput(this.bridge({ action, sessionId, uploadId, ...extra }), active);
      if (!result?.ok) throw new Error(result?.error || '附件上传失败');
      return result.value;
    };
    try {
      active.throwIfAborted();
      // 取消可能发生在窗口还未收到编号时，迟到编号仍必须立即释放。
      const opened = this.bridge({ action: 'open', sessionId, name }).then(result => {
        if (result?.ok) { uploadId = result.value; if (active.aborted) cancel(); }
        return result;
      });
      const result = await awaitInput(opened, active);
      if (!result?.ok || typeof uploadId !== 'string') throw new Error(result?.error || '附件上传没有开始');
      const total = data instanceof Blob ? data.size : data instanceof Uint8Array ? data.length : undefined;
      const stream = data instanceof Blob ? data.stream() : data instanceof Uint8Array
        ? new ReadableStream<Uint8Array>({ start(target) { target.enqueue(data); target.close(); } }) : data;
      reader = stream.getReader(); let loaded = 0;
      onProgress?.({ loaded, ...(total === undefined ? {} : { total }) });
      while (true) {
        const item = await awaitInput(reader.read(), active); if (item.done) break;
        if (!(item.value instanceof Uint8Array)) throw new TypeError('附件流返回的不是字节');
        for (let at = 0; at < item.value.length; at += 65536) {
          const chunk = item.value.subarray(at, at + 65536);
          await invoke('write', { data: base64(chunk) }); loaded += chunk.length;
          onProgress?.({ loaded, ...(total === undefined ? {} : { total }) });
        }
      }
      const completed = await invoke('finish');
      if (completed?.ok === false && typeof completed.error?.code === 'string' && typeof completed.error?.message === 'string'
        && completed.error?.details && typeof completed.error.details === 'object')
        return { ok: false as const, error: new RemoteError(completed.error.code, completed.error.message, completed.error.details) };
      const value = completed?.value;
      if (completed?.ok !== true || typeof value?.receiptId !== 'string' || typeof value?.file?.attachmentId !== 'string'
        || typeof value.file.name !== 'string' || !Number.isSafeInteger(value.file.bytes) || value.file.bytes < 0) throw new Error('附件上传返回的凭据无效');
      return { ok: true as const, value };
    } catch (error) { cancel(); throw error; }
    finally { active.removeEventListener('abort', cancel); this.operations.delete(controller); reader?.releaseLock(); }
  }
}
