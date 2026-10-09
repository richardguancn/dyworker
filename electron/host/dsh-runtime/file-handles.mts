// Electron 内置 Node 可能禁止权限模型中的 fchmod/fsync。
// 保留官方 fs-local 的原子发布流程；受限操作按实际路径交给宿主检查后执行。
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';

export function installFileHandleBridge() {
  if (!(process as any).permission) return;
  const originalOpen = fs.open;
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  process.on('message', (message: any) => {
    if (message.type !== 'file-handle-result') return;
    const call = pending.get(message.id); if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error)); else call.resolve();
  });
  const request = (operation: string, file: any, mode?: any) => new Promise<void>((resolve, reject) => {
    const id = randomUUID(); pending.set(id, { resolve, reject });
    process.send?.({ type: 'file-handle', id, operation, file: String(file), mode });
  });
  fs.open = (async (file: any, ...args: any[]) => {
    const handle = await (originalOpen as any)(file, ...args);
    for (const [method, operation] of [['chmod', 'chmod'], ['sync', 'sync']] as const) {
      const original = handle[method].bind(handle);
      (handle as any)[method] = async (...params: any[]) => {
        try { return await (original as any)(...params); }
        catch (error: any) {
          if (error.code !== 'ERR_ACCESS_DENIED' || !(process as any).permission.has('fs.write', String(file))) throw error;
          return request(operation, file, params[0]);
        }
      };
    }
    return handle;
  }) as any;
  syncBuiltinESMExports();
}
