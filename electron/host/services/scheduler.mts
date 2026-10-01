// 定时计划与自我唤醒服务 ctx.scheduler：把 main.mts 里的计划存储、到期判定、
// 唤醒登记与两个定时器收编为 cordis 服务。
//
// 职责边界：
//   - 存储与纯逻辑：schedules.json（含旧字段迁移）/ wakes.json 的读写、到期推进、
//     运行历史、中断恢复；
//   - 调度循环：10s tick + 动态近邻唤醒定时器，以及"忙碌时跳过"的判定；
//   - 不拥有任务执行本身：真正跑 agent 的 runScheduledTask / resumeWake 仍在壳层，
//     经 hooks 回调注入（它们要用 ctx.agent/会话存档等桌面领域）。
//
// 忙碌状态（原 runningScheduledTask）由本服务持有并对外可读：渠道排队守卫也要看它，
// 所以是跨域共享状态，必须只有一个所有者。
//
// 本文件不依赖 electron：平台事件（睡眠/解锁）由壳层监听后调用本服务的 due 检查。
import { Service } from "cordis";
import path from "node:path";
import crypto from "node:crypto";
import { readJson, writeJson } from "../io.mts";
import { normalizeApprovalMode } from "../../settings.mts";

declare module "cordis" {
  interface Context {
    scheduler: SchedulerService;
  }
}

export const RECURRENCES = ["once", "hourly", "daily", "weekly"];

// 重复方式 → 间隔秒数；未知/缺失按每天处理
const RECURRENCE_SECONDS = { hourly: 3600, weekly: 7 * 86400, daily: 86400 };

// 由当前执行时间推算下一次执行时间（保持原语义：非法时间戳从 now 起算，且结果严格大于 now）
export function nextOccurrence(recurrence, currentIso, now) {
  const seconds = RECURRENCE_SECONDS[recurrence] || 86400;
  let next = new Date(currentIso);
  if (Number.isNaN(next.getTime())) next = new Date(now.getTime() + seconds * 1000);
  while (next <= now) next = new Date(next.getTime() + seconds * 1000);
  return next.toISOString();
}

// 运行历史：每次执行追加一条（时间/结果/关联会话 id），保留最近 10 条
function appendScheduleHistory(item, entry) {
  if (!Array.isArray(item.history)) item.history = [];
  item.history.unshift(entry);
  item.history = item.history.slice(0, 10);
}

export class SchedulerService extends Service {
  dir;
  running = false;
  runningWakeSessions = new Set();
  schedulerTimer = null;
  bootTimer = null;
  wakeTimer = null;
  // 壳层注入：关机判定、忙碌判定、会话活跃判定、任务执行、渲染端广播
  hooks;

  constructor(ctx, config = {} as any) {
    super(ctx, "scheduler");
    this.dir = config.dir;
    this.hooks = {
      isShuttingDown: config.isShuttingDown || (() => false),
      isSessionBusy: config.isSessionBusy || (() => false),
      isSystemBusy: config.isSystemBusy || (() => false),
      runScheduledTask: config.runScheduledTask || (async () => {}),
      resumeWake: config.resumeWake || (async () => {}),
      broadcast: config.broadcast || (() => {}),
      now: config.now || (() => new Date()),
    };
    // 定时器属宿主资源：dispose 时一并清掉（原先只在 before-quit 手工清 schedulerTimer，
    // wakeTimer 与启动 tick 都没人管）
    ctx.effect(() => () => this.stop());
  }

  file(name) {
    return path.join(this.dir, name);
  }

  now() {
    return this.hooks.now();
  }

  // ---- 定时计划存储 ----

  async list() {
    const items = await readJson(this.file("schedules.json"), []);
    const list = Array.isArray(items) ? items : [];
    // 兼容旧版（DYWork 时代）定时计划字段：workspace → workspacePath、schedule.type → recurrence；
    // 缺失 allowWorkspaceWrites 时按只读处理（不擅自授予写权限）。检测到旧字段自动归一化并回写，
    // 避免升级后计划因拿不到工作目录而每次执行失败。
    let changed = false;
    for (const item of list) {
      if (!item.workspacePath && item.workspace) {
        item.workspacePath = String(item.workspace);
        changed = true;
      }
      if (!item.recurrence && item.schedule?.type) {
        item.recurrence = String(item.schedule.type);
        changed = true;
      }
      if (item.allowWorkspaceWrites === undefined) {
        item.allowWorkspaceWrites = false;
        changed = true;
      }
    }
    if (changed) await writeJson(this.file("schedules.json"), list);
    return list;
  }

  async writeScheduleList(items) {
    await writeJson(this.file("schedules.json"), items);
  }

  // 新建或更新一条计划；校验与 main 收编前一致（错误文案保持）
  async save(payload) {
    const name = String(payload?.name || "").trim();
    const prompt = String(payload?.prompt || "").trim();
    const workspacePath = String(payload?.workspacePath || "").trim();
    const recurrence = String(payload?.recurrence || "daily");
    const nextRun = new Date(payload?.nextRun || "");
    if (!name || !prompt) return { ok: false, error: "计划名称和任务内容不能为空" };
    if (!workspacePath) return { ok: false, error: "请先选择工作文件夹" };
    if (!RECURRENCES.includes(recurrence)) return { ok: false, error: "重复方式无效" };
    if (Number.isNaN(nextRun.getTime())) return { ok: false, error: "首次执行时间无效" };
    const items = await this.list();
    const existing = payload?.id ? items.find((item) => String(item.id) === String(payload.id)) : null;
    if (existing) {
      Object.assign(existing, {
        name, prompt, workspacePath, recurrence,
        nextRun: nextRun.toISOString(),
        allowWorkspaceWrites: Boolean(payload?.allowWorkspaceWrites),
        updatedAt: this.now().toISOString(),
      });
    } else {
      const nowIso = this.now().toISOString();
      items.push({
        id: crypto.randomUUID(),
        name, prompt, workspacePath, recurrence,
        nextRun: nextRun.toISOString(),
        lastRun: "",
        enabled: true,
        allowWorkspaceWrites: Boolean(payload?.allowWorkspaceWrites),
        lastStatus: "",
        lastSummary: "",
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
    await this.writeScheduleList(items);
    this.hooks.broadcast();
    return { ok: true };
  }

  async remove(id) {
    const items = await this.list();
    await this.writeScheduleList(items.filter((item) => String(item.id) !== String(id)));
    this.hooks.broadcast();
    return { ok: true };
  }

  async setEnabled(payload) {
    const items = await this.list();
    const item = items.find((entry) => String(entry.id) === String(payload?.id));
    if (!item) return { ok: false };
    item.enabled = Boolean(payload?.enabled);
    item.updatedAt = this.now().toISOString();
    await this.writeScheduleList(items);
    this.hooks.broadcast();
    return { ok: true };
  }

  // 立即执行：把 nextRun 拨到现在并触发一次到期检查
  async triggerNow(id) {
    const items = await this.list();
    const item = items.find((entry) => String(entry.id) === String(id));
    if (!item) return { ok: false, error: "没有找到这个定时任务" };
    if (item.lastStatus === "running") return { ok: false, error: "这个任务正在执行" };
    item.enabled = true;
    item.nextRun = this.now().toISOString();
    await this.writeScheduleList(items);
    void this.checkDueSchedules();
    return { ok: true };
  }

  // 上次运行中被关掉：标为失败并安排立即重跑，避免计划卡在 running 永不触发
  async recoverInterrupted() {
    const items = await this.list();
    let recovered = false;
    for (const item of items) {
      if (item.lastStatus !== "running") continue;
      item.lastStatus = "failed";
      item.lastSummary = "应用在上次执行过程中关闭，任务已恢复等待重新执行";
      item.nextRun = this.now().toISOString();
      item.enabled = true;
      recovered = true;
    }
    if (recovered) await this.writeScheduleList(items);
  }

  async markFinished(id, success, summary, sessionId = "") {
    const items = await this.list();
    const item = items.find((entry) => String(entry.id) === String(id));
    if (!item) return;
    const now = this.now();
    item.lastStatus = success ? "success" : "failed";
    item.lastSummary = String(summary || "").slice(0, 500);
    item.updatedAt = now.toISOString();
    appendScheduleHistory(item, {
      at: now.toISOString(),
      status: item.lastStatus,
      summary: item.lastSummary,
      sessionId: String(sessionId || ""),
    });
    if (item.recurrence === "once") item.enabled = false;
    else item.nextRun = nextOccurrence(item.recurrence, item.nextRun, now);
    await this.writeScheduleList(items);
  }

  async markSleeping(id, wake, sessionId = "") {
    const items = await this.list();
    const item = items.find((entry) => String(entry.id) === String(id));
    if (!item) return;
    item.lastStatus = "sleeping";
    item.lastSummary = `已挂起，将于 ${new Date(wake.wakeAt).toLocaleString("zh-CN")} 自动唤醒继续（原因：${String(wake.reason || "").slice(0, 120)}）`;
    item.updatedAt = this.now().toISOString();
    appendScheduleHistory(item, {
      at: this.now().toISOString(),
      status: "sleeping",
      summary: item.lastSummary,
      sessionId: String(sessionId || ""),
    });
    await this.writeScheduleList(items);
  }

  // ---- 唤醒记录 ----
  // wakes.json 条目：{ id, sessionId, scheduleId?, workspacePath, approvalMode, wakeAt, reason,
  //   prompt, finalText, status: "pending" | "fired" | "cancelled", createdAt, firedAt? }
  // pending → fired 一次性转移，杜绝重复唤醒；会话被删除/任务被取消时置 cancelled。

  async readWakes() {
    const wakes = await readJson(this.file("wakes.json"), []);
    return Array.isArray(wakes) ? wakes : [];
  }

  async writeWakes(wakes) {
    const pending = wakes.filter((wake) => wake.status === "pending");
    const settled = wakes.filter((wake) => wake.status !== "pending").slice(-50);
    await writeJson(this.file("wakes.json"), [...pending, ...settled]);
  }

  async hasPendingForSession(sessionId) {
    const wakes = await this.readWakes();
    return wakes.some((wake) => wake.status === "pending" && String(wake.sessionId) === String(sessionId));
  }

  async registerWake({ sessionId, scheduleId = null, workspacePath, approvalMode, wake, prompt, finalText }) {
    if (!sessionId || !workspacePath || !wake?.wakeAt) return;
    const wakes = await this.readWakes();
    if (wakes.some((entry) => entry.status === "pending" && String(entry.sessionId) === String(sessionId))) return;
    wakes.push({
      id: crypto.randomUUID(),
      sessionId: String(sessionId),
      ...(scheduleId ? { scheduleId: String(scheduleId) } : {}),
      workspacePath: String(workspacePath),
      approvalMode: normalizeApprovalMode(approvalMode),
      wakeAt: wake.wakeAt,
      reason: String(wake.reason || "等待约定时间").slice(0, 300),
      prompt: String(prompt || "").slice(0, 2000),
      finalText: String(finalText || "").slice(0, 1500),
      status: "pending",
      createdAt: this.now().toISOString(),
    });
    await this.writeWakes(wakes);
    void this.scheduleNextWakeCheck();
  }

  async cancelForSession(sessionId) {
    const wakes = await this.readWakes();
    let changed = false;
    for (const wake of wakes) {
      if (wake.status === "pending" && String(wake.sessionId) === String(sessionId)) {
        wake.status = "cancelled";
        changed = true;
      }
    }
    if (changed) {
      await this.writeWakes(wakes);
      void this.scheduleNextWakeCheck();
    }
  }

  // ---- 调度循环 ----

  // 动态近邻定时器：只为最近的一条 pending 唤醒设闹钟，最长 2 小时后再对齐
  async scheduleNextWakeCheck() {
    if (this.hooks.isShuttingDown()) return;
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    const wakes = await this.readWakes();
    const pending = wakes.filter((wake) => wake.status === "pending" && wake.wakeAt);
    if (!pending.length) return;
    const nowMs = this.now().getTime();
    let minWaitMs = Infinity;
    for (const wake of pending) {
      const target = new Date(wake.wakeAt).getTime();
      if (Number.isNaN(target)) continue;
      const wait = Math.max(0, target - nowMs);
      if (wait < minWaitMs) minWaitMs = wait;
    }
    if (!Number.isFinite(minWaitMs)) return;
    // 最长等待 2 小时，到期触发后再次动态对齐
    const delay = Math.min(minWaitMs, 2 * 3600 * 1000);
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      void this.checkDueWakes().then(() => this.scheduleNextWakeCheck());
    }, delay);
    if (typeof this.wakeTimer.unref === "function") this.wakeTimer.unref();
  }

  async checkDueWakes() {
    if (this.hooks.isShuttingDown()) return;
    const now = this.now();
    const wakes = await this.readWakes();
    const dueList = wakes.filter((wake) => wake.status === "pending" && wake.wakeAt && new Date(wake.wakeAt) <= now);
    if (!dueList.length) return;

    for (const due of dueList) {
      if (this.hooks.isShuttingDown()) break;
      const sid = String(due.sessionId || "");
      // 若目标会话正处于前台活跃或已在唤醒运行中，暂缓该会话唤醒（不阻碍其他会话）
      if (this.hooks.isSessionBusy(sid) || this.runningWakeSessions.has(sid)) continue;
      // 若已有正在执行计算/工具的后台调度任务，串行排队
      if (this.running) break;

      // 先落盘 fired 再执行：pending → fired 一次性转移，应用中途退出也不会重复唤醒
      due.status = "fired";
      due.firedAt = now.toISOString();
      await this.writeWakes(wakes);

      this.runningWakeSessions.add(sid);
      try {
        await this.hooks.resumeWake(due);
      } catch (error: any) {
        console.error(`[wakes] 唤醒执行异常 (${sid}):`, error);
      } finally {
        this.runningWakeSessions.delete(sid);
      }
    }
    void this.scheduleNextWakeCheck();
  }

  async checkDueSchedules() {
    if (this.hooks.isShuttingDown() || this.running || this.hooks.isSystemBusy()) return;
    const now = this.now();
    const items = await this.list();
    const due = items.find((item) => item.enabled && item.nextRun && new Date(item.nextRun) <= now);
    if (!due) return;
    due.lastStatus = "running";
    due.lastRun = now.toISOString();
    due.updatedAt = now.toISOString();
    await this.writeScheduleList(items);
    await this.hooks.runScheduledTask(due);
  }

  // 启动调度：先恢复中断的计划，再挂 10s tick 与首帧补偿检查。
  // 平台事件（睡眠恢复/解锁）由壳层监听后调用 checkDueWakes/checkDueSchedules。
  async start() {
    await this.recoverInterrupted();
    if (this.hooks.isShuttingDown()) return;
    // 同一 tick 先看到点的主动唤醒（self-wake）再到期的定时计划；两者共用忙碌守卫，串行执行
    const tick = () => void this.checkDueWakes().then(() => this.checkDueSchedules());
    this.schedulerTimer = setInterval(tick, 10_000);
    this.bootTimer = setTimeout(tick, 1500);
    // 等近邻唤醒定时器真正挂上再返回，调用方拿到的状态是确定的
    await this.scheduleNextWakeCheck();
  }

  stop() {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.schedulerTimer = null;
    this.bootTimer = null;
    this.wakeTimer = null;
  }
}
