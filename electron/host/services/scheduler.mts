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
import { Service } from "@deepseek-ai/cordis";
import path from "node:path";
import crypto from "node:crypto";
import { readJson, writeJson } from "../io.mts";
import { normalizeApprovalMode } from "../../settings.mts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    scheduler: SchedulerService;
  }
}

export const RECURRENCES = ["once", "hourly", "daily", "weekly"];

// 重复方式 → 间隔秒数；未知/缺失按每天处理
const RECURRENCE_SECONDS = { hourly: 3600, weekly: 7 * 86400, daily: 86400 };

// 唤醒到期但被忙碌守卫推迟时的重试间隔。
// 不能用 0：已到期的唤醒会算出 wait = max(0, target-now) = 0 → setTimeout(0) 立刻重跑，
// 仍是忙碌 → 再算 0，于是就变成每秒上千次读 wakes.json 的紧循环
// （真实事故：27K 个打开句柄 + 主进程 100% CPU + 内存暴涨）。
const WAKE_DEFERRED_RETRY_MS = 10_000;

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
  // checkDueSchedules 的重入保护：从「读 schedules.json」到「写回 running 标记」
  // 之间有两处 await，10s tick / 1.5s bootTimer / powerMonitor resume|unlock /
  // triggerNow 四个调用方可以并发进入读到同一个 due 项，各自都去执行一次。
  // 真实事故里两次派生会话只隔 5.301s（小于 10s tick），就是这条竞态。
  scheduling = false;
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
    const runtime = payload?.runtime ?? "dyworker";
    if (!["dyworker","dsh"].includes(runtime)) return {ok:false,error:"任务运行方式无效"};
    const nextRun = new Date(payload?.nextRun || "");
    if (!name || !prompt) return { ok: false, error: "计划名称和任务内容不能为空" };
    if (!workspacePath) return { ok: false, error: "请先选择工作文件夹" };
    if (!RECURRENCES.includes(recurrence)) return { ok: false, error: "重复方式无效" };
    if (Number.isNaN(nextRun.getTime())) return { ok: false, error: "首次执行时间无效" };
    const items = await this.list();
    const existing = payload?.id ? items.find((item) => String(item.id) === String(payload.id)) : null;
    if (existing) {
      Object.assign(existing, {
        name, prompt, workspacePath, recurrence, runtime,
        nextRun: nextRun.toISOString(),
        allowWorkspaceWrites: Boolean(payload?.allowWorkspaceWrites),
        updatedAt: this.now().toISOString(),
      });
    } else {
      const nowIso = this.now().toISOString();
      items.push({
        id: crypto.randomUUID(),
        name, prompt, workspacePath, recurrence, runtime,
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
    // 挂起中的计划不能"立即执行"：它的那个会话还在等唤醒，此时再起一轮就是两个
    // 实例并行跑同一任务（真实事故里模型自己写下"同目录有另一个同一任务的执行实例
    // 正在并行跑流程"），而且旧的 pending 唤醒到点还会再续跑一次，等于跑三遍。
    // 要立刻推进请用挂起横幅上的「立即继续」——那条路径有会话占用与全局忙碌双守卫，
    // 并且会先把唤醒记录取走再续跑。
    const wakes = await this.readWakes();
    const suspended = wakes.some((wake) =>
      wake.status === "pending" && String(wake.scheduleId) === String(id));
    if (item.lastStatus === "sleeping" && suspended) {
      return { ok: false, error: "这个任务已挂起等待唤醒，请用「立即继续」或先取消挂起" };
    }
    item.enabled = true;
    item.nextRun = this.now().toISOString();
    await this.writeScheduleList(items);
    // 只等调度决策落盘，不等任务跑完（IPC 不能挂到任务结束）。
    // 返回值带回"这一轮到底有没有立刻派发"：忙碌守卫（桌面任务执行中/已有后台任务在跑）
    // 会把这次点击推迟到下一个 tick，界面据此说"已排队"而不是谎报"已开始执行"。
    const due = await this.checkDueSchedules({ awaitRun: false, manual: true });
    return { ok: true, started: Boolean(due) };
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

  async markFinished(id, success, summary, sessionId = "", outcome = "") {
    const items = await this.list();
    const item = items.find((entry) => String(entry.id) === String(id));
    if (!item) return;
    const now = this.now();
    item.lastStatus = outcome === "cancelled" ? "cancelled" : success ? "success" : "failed";
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
    const now = this.now();
    item.lastStatus = "sleeping";
    item.lastSummary = `已挂起，将于 ${new Date(wake.wakeAt).toLocaleString("zh-CN")} 自动唤醒继续（原因：${String(wake.reason || "").slice(0, 120)}）`;
    item.updatedAt = now.toISOString();
    // 挂起 = 本轮已交棒给自我唤醒机制，本轮到期额度必须在此消耗掉。
    //
    // 不变量：到期判定是 `enabled && nextRun <= now`（见 checkDueSchedules），因此
    // "本轮已结束"的唯一表达方式就是推进 nextRun。此前推进 nextRun 只发生在
    // markFinished 里，而挂起路径在壳层提前 return、永不经过 markFinished
    // （main.mts 的 runScheduledTask：status === "sleeping" 时直接 return），
    // 于是 nextRun 永远停在过去 → 每 10s tick 都判定"到期" → 每轮再新建一个会话
    // 跑同一任务。真实事故：一个每日计划在 7 分钟内派生出 8 个并发会话，
    // 各自拉起同一套 3677 帧 ffmpeg 渲染，把机器和界面一起拖垮。
    //
    // nextOccurrence 对已处于未来的 nextRun 是幂等的（while 循环不进入），
    // 所以唤醒续跑结束后再由 markFinished 收尾不会二次推进。
    // 唤醒若丢失，nextRun 已推进到下一次真实到期时间，任务仍会按周期恢复，不会卡死。
    //
    // 这里**不能**对 recurrence === "once" 直接 enabled = false：挂起只是"暂停"，
    // 而唤醒是"先落 fired 再执行"（见 checkDueWakes），落盘之后若续跑失败不会重试，
    // 计划就被永久停用、任务再也跑不起来。once 的真正停用交给续跑收尾的
    // markFinished（它只对已完成的运行生效）。
    item.nextRun = nextOccurrence(item.recurrence, item.nextRun, now);
    appendScheduleHistory(item, {
      at: now.toISOString(),
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

  // 渲染端"挂起中"状态的权威数据源：气泡上的 taskStatus=sleeping 只是历史留痕，
  // 用户取消唤醒后不会自己变，重启后也读不出"是否还挂着"，所以一律回主进程问。
  async listPending() {
    const wakes = await this.readWakes();
    return wakes
      .filter((wake) => wake.status === "pending")
      .map((wake) => ({
        sessionId: String(wake.sessionId || ""),
        wakeAt: String(wake.wakeAt || ""),
        reason: String(wake.reason || ""),
      }));
  }

  // 用户点「立即继续」：把该会话的待唤醒一次性取走（pending → fired）交给壳层立刻续跑，
  // 取不到返回 null。与 checkDueWakes 同一语义——先落盘再执行，中途退出也不会重复唤醒。
  async claimPendingForSession(sessionId) {
    const wakes = await this.readWakes();
    const target = wakes.find((wake) => wake.status === "pending" && String(wake.sessionId) === String(sessionId));
    if (!target) return null;
    target.status = "fired";
    target.firedAt = this.now().toISOString();
    await this.writeWakes(wakes);
    // 被取走的那条可能正是最近的一条闹钟，重新对齐
    void this.scheduleNextWakeCheck();
    return target;
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
  async scheduleNextWakeCheck({ minDelayMs = 0 } = {} as any) {
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
    // 最长等待 2 小时，到期触发后再次动态对齐。
    // minDelayMs 用于"已到期但被推迟"的场景：给一个正的退避，避免 0 延迟自旋。
    const delay = Math.max(Math.min(minWaitMs, 2 * 3600 * 1000), minDelayMs);
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

    let deferred = false;
    for (const due of dueList) {
      if (this.hooks.isShuttingDown()) break;
      const sid = String(due.sessionId || "");
      // 若目标会话正处于前台活跃或已在唤醒运行中，暂缓该会话唤醒（不阻碍其他会话）
      if (this.hooks.isSessionBusy(sid) || this.runningWakeSessions.has(sid)) { deferred = true; continue; }
      // 若已有正在执行计算/工具的后台调度任务，串行排队
      if (this.running) { deferred = true; break; }

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
    // 被推迟的唤醒仍在 pending 且已到期：必须退避重试，否则会 0 延迟自旋
    void this.scheduleNextWakeCheck({ minDelayMs: deferred ? WAKE_DEFERRED_RETRY_MS : 0 });
  }

  // awaitRun=false：只等「调度决策落盘」，不等 runScheduledTask 跑完。
  // triggerNow 经 IPC 同步返回，不能把 invoke 挂到任务结束（可能几十分钟），
  // 但也必须等状态写入再返回——否则调用方拿到 ok 时状态还没落盘，
  // 且那次写盘会在调用方之后继续跑（与目录清理/后续写形成竞态）。
  // 返回值：本轮真正派发的计划（被忙碌守卫拦下时返回 null，调用方据此区分"已开始执行"与"已排队"）。
  // meta.manual 透传给壳层：开始运行时的 schedules:run-started 用它区分「立即执行」与到点自动跑。
  async checkDueSchedules(options: { awaitRun?: boolean; manual?: boolean } = {}) {
    const awaitRun = options.awaitRun !== false;
    const manual = options.manual === true;
    if (this.hooks.isShuttingDown() || this.running || this.hooks.isSystemBusy() || this.scheduling) return null;
    const now = this.now();
    let due = null;
    // 重入保护只覆盖「读 → 挑 due → 写回 running」这段窗口，不跨 runScheduledTask：
    // 后者会在审批/提问等待期间主动释放 this.running（避免调度死锁），若这里把锁
    // 一直握到运行结束，其他已到期的计划在长达 2 小时的审批等待里都得不到执行。
    this.scheduling = true;
    try {
      const items = await this.list();
      // 挂起中且唤醒仍在册的计划，本轮尚未结束（那个会话在等唤醒），不能再触发
      // 一次——否则会与挂起中的会话并行跑同一任务。只看 lastStatus 不够：
      // 唤醒若已被消费或取消，说明挂起实际已不成立，应让计划按 nextRun 正常恢复，
      // 否则续跑失败会把计划永久卡死（nextRun 虽已推进，但每次到期都会被这里跳过）。
      const wakes = await this.readWakes();
      const suspendedScheduleIds = new Set(
        wakes
          .filter((wake) => wake.status === "pending" && wake.scheduleId)
          .map((wake) => String(wake.scheduleId)),
      );
      due = items.find((item) =>
        item.enabled
        && item.nextRun
        && new Date(item.nextRun) <= now
        && !(item.lastStatus === "sleeping" && suspendedScheduleIds.has(String(item.id)))) || null;
      if (due) {
        due.lastStatus = "running";
        due.lastRun = now.toISOString();
        due.updatedAt = now.toISOString();
        await this.writeScheduleList(items);
      }
    } finally {
      this.scheduling = false;
    }
    if (!due) return null;
    if (awaitRun) {
      await this.hooks.runScheduledTask(due, { manual });
    } else {
      // 交棒但不等待：运行异常由壳层自身收尾（runScheduledTask 有 try/catch/finally），
      // 这里只兜住同步抛出，避免产生未处理的 rejection
      try {
        void Promise.resolve(this.hooks.runScheduledTask(due, { manual })).catch(() => {});
      } catch {
        // 同步抛出同样忽略：状态已落 running，下一轮 recoverInterrupted 会兜底
      }
    }
    return due;
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
