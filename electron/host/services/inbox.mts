// 审批收件箱服务 ctx.inbox：无人值守任务（唤醒续跑 / 定时任务 / IM 渠道）的
// 审批与提问挂起在这里，用户在桌面收件箱或 IM 里决议后原地恢复任务。
//
// 语义（与 main.mts 收编前完全一致，逐条有测试钉住）：
//   - create(partial) 返回的 promise 上挂 itemId：渠道审批要靠它把 IM 回复路由回来；
//     不能用 async 包装内层 promise——外层包装会吞掉 .itemId。
//   - 落盘共用一条串行队列（create/settle/sweep 都是 read-modify-write，
//     不排队会互相覆盖：条目丢失，或已处理条目复活成 pending 钉子户）。
//   - 等待必须有界：无人处理时任务连同其身后的渠道队列/全局守卫会永久悬死。
//   - 孤儿兜底：pending 条目若已无等待 promise（任务提前退出/计时器丢失），
//     列表读取前自动落盘为已失效，避免界面出现点不动的钉子户。
//
// 与 electron 的边界：系统通知与渲染端广播由壳层以回调注入（本文件不 import electron）。
import { Service } from "@deepseek-ai/cordis";
import path from "node:path";
import crypto from "node:crypto";
import { readJson, writeJson } from "../io.mts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    inbox: InboxService;
  }
}

// 挂起条目的等待上限：渠道交互 10 分钟；无人值守的定时/唤醒续跑放宽到 2 小时。
export const CHANNEL_PENDING_TIMEOUT_MS = 10 * 60 * 1000;
export const UNATTENDED_PENDING_TIMEOUT_MS = 2 * 3600 * 1000;

// 已处理/已失效条目只保留最近 100 条，pending 永不丢弃
const SETTLED_RETENTION = 100;
const ORPHAN_RESOLUTION = "任务已结束，该事项自动失效";
const SHUTDOWN_RESOLUTION = "应用在等待处理期间关闭，任务已终止";

export class InboxService extends Service {
  dir;
  broadcast;
  notify;
  pending = new Map();
  persistQueue = Promise.resolve();

  constructor(ctx, config = {} as any) {
    super(ctx, "inbox");
    this.dir = config.dir;
    // 壳层注入：广播"收件箱有变化"、弹系统通知（含点击聚焦）
    this.broadcast = config.broadcast || (() => {});
    this.notify = config.notify || (() => {});
  }

  file() {
    return path.join(this.dir, "inbox.json");
  }

  async read() {
    const items = await readJson(this.file(), []);
    return Array.isArray(items) ? items : [];
  }

  async write(items) {
    const pending = items.filter((item) => item.status === "pending");
    const settled = items.filter((item) => item.status !== "pending").slice(-SETTLED_RETENTION);
    await writeJson(this.file(), [...pending, ...settled]);
  }

  // 创建挂起条目并返回决议 promise（promise 上带 itemId，渠道审批按 id 路由 IM 回复）
  create(partial) {
    const item = {
      id: crypto.randomUUID(),
      kind: partial.kind === "question" ? "question" : "approval",
      sessionId: String(partial.sessionId || ""),
      ...(partial.scheduleId ? { scheduleId: String(partial.scheduleId) } : {}),
      ...(partial.tool ? { tool: String(partial.tool) } : {}),
      ...(partial.title ? { title: String(partial.title).slice(0, 200) } : {}),
      ...(partial.details ? { details: String(partial.details).slice(0, 2000) } : {}),
      ...(partial.impact ? { impact: String(partial.impact).slice(0, 800) } : {}),
      ...(partial.question ? { question: String(partial.question).slice(0, 1000) } : {}),
      ...(Array.isArray(partial.options) && partial.options.length ? { options: partial.options.map(String).slice(0, 5) } : {}),
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    // pending 上挂 itemId 元数据（收件箱登记用），类型放宽为 any
    const pending: any = new Promise<any>((resolve) => {
      this.pending.set(item.id, resolve);
    });
    pending.itemId = item.id;
    this.persistQueue = this.persistQueue.then(async () => {
      const items = await this.read();
      items.push(item);
      await this.write(items);
      this.broadcast();
      this.notify(item);
    }).catch(() => { });
    return pending;
  }

  // 与 create 共用同一落盘队列：settle 是 read-modify-write，
  // 不排队会与创建写入互相覆盖（条目丢失或复活成 pending 钉子户）
  async settle(id, status, resolution) {
    const run = this.persistQueue.then(async () => {
      const items = await this.read();
      const item = items.find((entry) => String(entry.id) === String(id));
      if (!item || item.status !== "pending") return null;
      item.status = status;
      if (resolution) item.resolution = resolution;
      item.resolvedAt = new Date().toISOString();
      await this.write(items);
      this.broadcast();
      return item;
    });
    this.persistQueue = run.catch(() => { });
    return run;
  }

  // 兜底清"钉子户"：pending 条目的等待 promise 已不在登记表里（任务提前退出、
  // 计时器丢失等），界面会永远显示为待处理且无法删除。读取列表前自动落盘为已失效。
  async sweepOrphaned() {
    const run = this.persistQueue.then(async () => {
      const items = await this.read();
      let changed = false;
      for (const item of items) {
        if (item.status !== "pending" || this.pending.has(item.id)) continue;
        item.status = "expired";
        item.resolution = ORPHAN_RESOLUTION;
        item.resolvedAt = new Date().toISOString();
        changed = true;
      }
      if (changed) {
        await this.write(items);
        this.broadcast();
      }
    });
    this.persistQueue = run.catch(() => { });
    return run;
  }

  // 立即以失效处理挂起条目：解决等待中的 promise（ok:false）并落盘留痕
  expireNow(id, reason) {
    const resolve = this.pending.get(id);
    this.pending.delete(id);
    if (resolve) resolve({ ok: false, reason });
    void this.settle(id, "expired", reason);
  }

  // await 挂起条目并附加上限；超时按拒绝/未回答处理，任务据此正常收尾
  awaitWithTimeout(pending, reason, timeoutMs = CHANNEL_PENDING_TIMEOUT_MS) {
    let timer = null;
    const timeout = new Promise<any>((resolve) => {
      timer = setTimeout(() => {
        this.expireNow(pending.itemId, reason);
        resolve({ ok: false, reason, timedOut: true });
      }, timeoutMs);
      // 不让计时器拖住进程退出
      if (typeof timer.unref === "function") timer.unref();
    });
    return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
  }

  // 应用退出：所有挂起条目以拒绝解决（任务循环正常收尾），条目标记已失效
  async expireAll(reason) {
    const items = await this.read();
    let changed = false;
    for (const item of items) {
      if (item.status !== "pending") continue;
      item.status = "expired";
      item.resolution = reason;
      changed = true;
      const resolve = this.pending.get(item.id);
      if (resolve) {
        this.pending.delete(item.id);
        resolve({ ok: false, reason });
      }
    }
    if (changed) await this.write(items);
  }

  // 重启后：上一次运行残留的 pending 条目所对应的任务早已退出，标记为已失效
  async expireOrphaned() {
    const items = await this.read();
    let changed = false;
    for (const item of items) {
      if (item.status !== "pending") continue;
      item.status = "expired";
      item.resolution = SHUTDOWN_RESOLUTION;
      changed = true;
    }
    if (changed) await this.write(items);
  }

  async list() {
    await this.sweepOrphaned();
    return await this.read();
  }

  // 决议挂起条目（收件箱 UI 与 IM 渠道共用）；via 标注决议来源，留痕可审计
  async resolve(id, { approved, answer, via = "desktop" } = {} as any) {
    const resolve = this.pending.get(id);
    if (!resolve) return { ok: false, error: "该事项已处理或已失效" };
    const items = await this.read();
    const item = items.find((entry) => String(entry.id) === id);
    if (!item || item.status !== "pending") return { ok: false, error: "该事项已处理或已失效" };
    const suffix = via === "desktop" ? "" : `(来自 ${via})`;
    if (item.kind === "question") {
      const text = String(answer || "").trim();
      if (!text) return { ok: false, error: "回答不能为空" };
      this.pending.delete(id);
      await this.settle(id, "resolved", `已回答：${text.slice(0, 200)}${suffix}`);
      resolve({ ok: true, answer: text });
    } else {
      const ok = Boolean(approved);
      this.pending.delete(id);
      await this.settle(id, "resolved", `${ok ? "已允许" : "已拒绝"}${suffix}`);
      resolve({ ok, reason: ok ? "" : "用户拒绝了这次操作" });
    }
    return { ok: true };
  }

  async dismiss(id) {
    const items = await this.read();
    const item = items.find((entry) => String(entry.id) === String(id));
    if (item?.status === "pending") return { ok: false, error: "待处理事项不能移除，请先处理" };
    await this.write(items.filter((entry) => String(entry.id) !== String(id)));
    this.broadcast();
    return { ok: true };
  }
}
