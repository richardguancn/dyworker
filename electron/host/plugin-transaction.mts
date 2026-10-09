import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const queues = new Map<string, Promise<unknown>>();
/** 暂存目录完成下载与验证后才切换；失败时恢复整个依赖组合和锁文件。 */
export async function transactPluginProfile(dir: string, prepare: (stage: string) => Promise<any>,
  activate: (prepared: any) => Promise<any>, restore: () => Promise<void>, idle: () => boolean = () => true,
  beforeSwitch: () => Promise<void | (() => void | Promise<void>)> = async () => {}) {
  const previous = queues.get(dir) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    if (!idle()) return { ok: false, stage: "busy", error: "插件工具正在执行，请在任务结束后安装或更新" };
    const stem = path.join(path.dirname(dir), `.${path.basename(dir)}-${randomUUID()}`);
    const stage = stem + "-staging", backup = stem + "-backup";
    await fs.cp(dir, stage, { recursive: true, dereference: false });
    let switched = false;
    let releaseSwitch: void | (() => void | Promise<void>);
    try {
      const prepared = await prepare(stage);
      if (!prepared.ok) return { ...prepared, rolledBack: true };
      if (!idle()) return { ok: false, stage: "busy", error: "任务已开始执行，本次安装未切换", rolledBack: true };
      releaseSwitch = await beforeSwitch();
      if (!idle()) return { ok: false, stage: 'busy', error: '任务已开始执行，本次安装未切换', rolledBack: true };
      await fs.rename(dir, backup);
      try { await fs.rename(stage, dir); } catch (error) { await fs.rename(backup, dir); throw error; }
      switched = true;
      const result = await activate(prepared);
      if (!result.ok) throw Object.assign(new Error(result.error || "插件启动失败"), { result });
      await fs.rm(backup, { recursive: true, force: true });
      return { ...result, transaction: "committed" };
    } catch (error: any) {
      if (switched) {
        await fs.rm(dir, { recursive: true, force: true });
        await fs.rename(backup, dir);
        await restore();
      }
      return { ...(error.result || {}), ok: false, error: String(error.message || error), rolledBack: true };
    } finally {
      try { await fs.rm(stage, { recursive: true, force: true }); }
      finally { if (releaseSwitch) await releaseSwitch(); }
    }
  });
  queues.set(dir, operation);
  try { return await operation; }
  finally { if (queues.get(dir) === operation) queues.delete(dir); }
}
