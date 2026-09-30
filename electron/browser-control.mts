// DYWorker 浏览器控制权管理器（BrowserControlManager）
// 职责：四元组联合隔离 (ownerSessionId, runId, tabId, leaseEpoch)、接管抢占保护、在途与已完成 actionId 并发去重、断点挂起、运行限额与状态广播
import { BrowserPageAdapter } from "./browser-page-adapter.mts";

export const CONTROL_STATUS = Object.freeze({
  IDLE: "idle",
  ACQUIRING: "acquiring",
  RUNNING: "running",
  AWAITING_APPROVAL: "awaiting_approval",
  HUMAN_CONTROL: "human_control",
  PAUSED: "paused",
  COMPLETED: "completed",
  STOPPED: "stopped",
  FAILED: "failed"
});

const MAX_ACTION_COUNT = 60;
const MAX_RUNTIME_MS = 10 * 60 * 1000;
// 打开预占的有效期限：超过期限视为旧请求已失效，允许新请求接替并撤销旧凭据
const OPEN_RESERVATION_TTL_MS = 30000;

export class BrowserControlManager {
  onStateChange;
session;
actionQueue;
inFlightActionIds;
completedActionIds;
openReservation;
openTokenCounter;
constructor({ onStateChange } = {} as any) {
    this.onStateChange = onStateChange || (() => {});
    this.session = null;
    this.actionQueue = Promise.resolve();

    // actionId 去重缓存：包含正在执行中的 (inFlight) 和已完成的 (completed)
    this.inFlightActionIds = new Map();
    this.completedActionIds = new Map();

    // 打开操作在途预占锁，防止多任务并发打开产生导航副作用
    this.openReservation = null;
    this.openTokenCounter = 0;
  }

  /**
   * 预占浏览器打开权限，防止多个任务并发调用 openPanel 产生非法的页面导航。
   * 预占绑定唯一请求凭据 (token)：过期、被替换、停止或接管后，旧凭据立即失效，
   * 持有失效凭据的请求在实际导航前必须被拦截 (C2_expired_open_stays_revoked)。
   * @returns {{ token: string }} 本次预占的取消凭据
   */
  reserveOpen({ ownerSessionId, runId, tabId } = {} as any) {
    if (this.session && this.session.status === CONTROL_STATUS.HUMAN_CONTROL) {
      throw new Error("HUMAN_TAKEOVER: 页面当前处于人工接管中，未获得用户继续许可前禁止进行自动操作");
    }
    if (this.session && this.session.status === CONTROL_STATUS.RUNNING) {
      if (this.session.ownerSessionId && ownerSessionId && this.session.ownerSessionId !== ownerSessionId) {
        throw new Error(`TARGET_BUSY: 当前浏览器正被任务 ${this.session.ownerSessionId} 占用，禁止跨任务抢占`);
      }
      if (this.session.ownerSessionId === ownerSessionId && this.session.runId && runId && this.session.runId !== runId) {
        throw new Error(`TARGET_BUSY: 当前浏览器正由新代次任务 ${this.session.runId} 运行中，旧代次禁止抢占`);
      }
    }

    if (this.openReservation) {
      const res = this.openReservation;
      if (Date.now() - res.reservedAt < OPEN_RESERVATION_TTL_MS) {
        if (res.ownerSessionId && ownerSessionId && res.ownerSessionId !== ownerSessionId) {
          throw new Error(`TARGET_BUSY: 当前浏览器正被任务 ${res.ownerSessionId} 占用，禁止跨任务抢占`);
        }
        if (res.ownerSessionId === ownerSessionId && res.runId && runId && res.runId !== runId) {
          throw new Error(`TARGET_BUSY: 当前浏览器正由新代次任务 ${res.runId} 运行中，旧代次禁止抢占`);
        }
      }
      // 预占已过期或被同身份新请求接替：直接替换记录，旧凭据因不再匹配当前预占而失效
    }

    this.openTokenCounter += 1;
    const token = `open_${Date.now()}_${this.openTokenCounter}_${Math.random().toString(36).slice(2, 8)}`;
    this.openReservation = {
      token,
      ownerSessionId: String(ownerSessionId || ""),
      runId: String(runId || ""),
      tabId: String(tabId || ""),
      reservedAt: Date.now()
    };
    return { token };
  }

  /**
   * 校验打开凭据是否仍然有效：必须仍指向当前预占记录且未超过有效期限。
   * 接管、停止、被新预占替换或过期都会使旧凭据失效。
   */
  isOpenReservationValid(token) {
    if (!token || !this.openReservation) return false;
    if (this.openReservation.token !== token) return false;
    return Date.now() - this.openReservation.reservedAt < OPEN_RESERVATION_TTL_MS;
  }

  /**
   * 清理预占：只能清理自己的预占（凭据匹配，或旧调用方仅提供 ownerSessionId 时按归属匹配）
   */
  clearOpenReservation(arg, token) {
    const ownerSessionId = typeof arg === "string" ? arg : arg?.ownerSessionId;
    const expectedToken = typeof arg === "object" && arg ? arg.token : token;
    if (!this.openReservation) return;
    if (expectedToken && this.openReservation.token !== expectedToken) return;
    if (!expectedToken && ownerSessionId && this.openReservation.ownerSessionId !== ownerSessionId) return;
    this.openReservation = null;
  }

  /**
   * 获取当前控制会话公开状态，供渲染层和 IPC 展示
   */
  getStatus() {
    if (!this.session) {
      return {
        status: CONTROL_STATUS.IDLE,
        controlSessionId: "",
        ownerSessionId: "",
        runId: "",
        tabId: "",
        webContentsId: 0,
        leaseEpoch: 0,
        actionText: "",
        pauseReason: "",
        elapsedMs: 0
      };
    }

    const {
      status,
      controlSessionId,
      ownerSessionId,
      runId,
      tabId,
      webContentsId,
      leaseEpoch,
      actionText,
      pauseReason,
      startedAt
    } = this.session;

    return {
      status,
      controlSessionId,
      ownerSessionId,
      runId,
      tabId,
      webContentsId,
      leaseEpoch,
      actionText: actionText || "",
      pauseReason: pauseReason || "",
      elapsedMs: startedAt ? Date.now() - startedAt : 0
    };
  }

  broadcastState() {
    try {
      this.onStateChange(this.getStatus());
    } catch (err: any) {
      // 忽略广播错误
    }
  }

  /**
   * 获取并锁定浏览器控制权
   * 补充要求 1：若当前处于人工接管中，严禁未获许可强行夺权！
   */
  async acquireControl({
    ownerSessionId,
    runId,
    tabId,
    webContents,
    workspacePath = ""
  }) {
    if (!webContents || webContents.isDestroyed?.()) {
      throw new Error("TARGET_UNAVAILABLE: 目标标签页不可用或已关闭");
    }

    // 严密防御：若当前会话处于接管状态，严禁擅自覆盖夺权 (F1 / 补充要求 1)
    if (this.session && this.session.status === CONTROL_STATUS.HUMAN_CONTROL) {
      throw new Error("HUMAN_TAKEOVER: 页面当前处于人工接管中，未获得用户继续许可前禁止重新获取控制");
    }

    // 严密防御：若同一窗口下已有处于运行态的其他任务，直接拒绝跨任务抢占 (F2 / 补充要求 2)
    if (this.session && this.session.status === CONTROL_STATUS.RUNNING) {
      if (this.session.ownerSessionId && ownerSessionId && this.session.ownerSessionId !== ownerSessionId) {
        throw new Error(`TARGET_BUSY: 当前浏览器已被任务 ${this.session.ownerSessionId} 占用，禁止跨任务抢占`);
      }
    }

    // 释放旧适配器
    if (this.session?.adapter) {
      this.session.adapter.dispose();
    }

    const leaseEpoch = (this.session?.leaseEpoch || 0) + 1;
    const controlSessionId = `ctrl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const abortController = new AbortController();
    const adapter = new BrowserPageAdapter(webContents);

    this.session = {
      controlSessionId,
      ownerSessionId: String(ownerSessionId || ""),
      runId: String(runId || ""),
      tabId: String(tabId || ""),
      webContentsId: webContents.id,
      webContents,
      workspacePath,
      leaseEpoch,
      status: CONTROL_STATUS.RUNNING,
      actionText: "助手正在准备操作...",
      pauseReason: "",
      startedAt: Date.now(),
      actionCount: 0,
      adapter,
      abortController
    };

    this.inFlightActionIds.clear();
    this.completedActionIds.clear();

    // 监听 webContents 销毁
    webContents.once("destroyed", () => {
      if (this.session?.webContentsId === webContents.id) {
        this.pause({ reason: "目标网页已关闭" });
      }
    });

    this.openReservation = null;
    this.broadcastState();
    return this.session;
  }

  /**
   * 用户主动接管：同步使当前租约失效，撤销后续执行，释放按键
   */
  takeover({ reason = "已由你接管" } = {} as any) {
    this.openReservation = null;
    if (!this.session) return { ok: false, result: "当前没有活跃的浏览器控制会话" };

    // 同步递增 leaseEpoch，使所有在途和排队中的动作立即失效
    this.session.leaseEpoch += 1;
    this.session.status = CONTROL_STATUS.HUMAN_CONTROL;
    this.session.actionText = "用户接管中";
    this.session.pauseReason = reason;

    // 中断当前等待
    this.session.abortController.abort();
    this.session.abortController = new AbortController();

    // 关键：同步切断 adapter 的 CDP 执行检查器，并在被接管瞬间释放按键 (F1_protocol_await_boundary)
    if (this.session.adapter) {
      try {
        this.session.adapter.setLeaseChecker(() => false);
        void this.session.adapter.releaseInputState();
      } catch {
        // 忽略释放异常
      }
    }

    this.broadcastState();
    return { ok: true, status: CONTROL_STATUS.HUMAN_CONTROL };
  }

  /**
   * 恢复控制：由用户界面显式点击“继续交给助手”触发（补充要求 4）
   */
  resume({ ownerSessionId, runId } = {} as any) {
    if (!this.session) return { ok: false, result: "没有可恢复的控制会话" };
    if (this.session.webContents?.isDestroyed?.()) {
      return { ok: false, result: "目标网页已关闭，无法恢复" };
    }

    if (ownerSessionId && this.session.ownerSessionId !== ownerSessionId) {
      return { ok: false, result: "会话身份不匹配，无法恢复控制" };
    }

    this.session.leaseEpoch += 1;
    this.session.runId = runId || this.session.runId;
    this.session.status = CONTROL_STATUS.RUNNING;
    this.session.actionText = "助手正在重新观察页面...";
    this.session.pauseReason = "";
    this.session.abortController = new AbortController();

    // 关键修复 (F8_resume_limit)：人工恢复后重置连续动作计数与计时器，给予新配额
    this.session.actionCount = 0;
    this.session.startedAt = Date.now();

    // 恢复后使适配器的前序观察强制过期，必须重新 observe
    if (this.session.adapter) {
      this.session.adapter.currentObservation = null;
      this.session.adapter.setLeaseChecker(() => this.session?.status === CONTROL_STATUS.RUNNING);
    }

    this.broadcastState();
    return { ok: true, status: CONTROL_STATUS.RUNNING, leaseEpoch: this.session.leaseEpoch };
  }

  /**
   * 停止控制会话
   */
  stop({ reason = "用户已停止操作" } = {} as any) {
    // 停止必须撤销在途打开预占，失去权限的旧请求不得再发起导航 (C2)
    this.openReservation = null;
    if (!this.session) return { ok: true };

    this.session.leaseEpoch += 1;
    this.session.status = CONTROL_STATUS.STOPPED;
    this.session.actionText = "";
    this.session.pauseReason = reason;
    this.session.abortController.abort();

    if (this.session.adapter) {
      try {
        void this.session.adapter.releaseInputState();
      } catch {
        // 忽略
      }
      try {
        this.session.adapter.dispose();
      } catch {
        // 忽略
      }
      this.session.adapter = null;
    }

    this.inFlightActionIds.clear();
    this.completedActionIds.clear();

    this.broadcastState();
    return { ok: true, status: CONTROL_STATUS.STOPPED };
  }

  /**
   * 暂停控制（切页、窗口最小化、网络异常等）
   */
  pause({ reason = "已暂停" } = {} as any) {
    if (!this.session || this.session.status === CONTROL_STATUS.STOPPED) return;

    this.session.leaseEpoch += 1;
    this.session.status = CONTROL_STATUS.PAUSED;
    this.session.actionText = "";
    this.session.pauseReason = reason;
    this.session.abortController.abort();

    if (this.session.adapter) {
      try {
        void this.session.adapter.releaseInputState();
      } catch {
        // 忽略
      }
    }

    this.broadcastState();
  }

  /**
   * 标记完成
   */
  complete({ resultSummary = "任务已完成" } = {} as any) {
    if (!this.session) return;
    this.session.status = CONTROL_STATUS.COMPLETED;
    this.session.actionText = resultSummary;
    this.broadcastState();
  }

  setActionText(text) {
    if (this.session) {
      this.session.actionText = String(text || "");
      this.broadcastState();
    }
  }

  /**
   * 校验调用者身份与当前四元组归属（修复 F2 / 补充要求 2）
   */
  checkTaskOwnership(context = {} as any) {
    if (!this.session) {
      return { ok: false, error: "TARGET_UNAVAILABLE: 尚未绑定受控浏览器页面" };
    }
    const { ownerSessionId, runId } = context || {};
    if (ownerSessionId && this.session.ownerSessionId && this.session.ownerSessionId !== ownerSessionId) {
      return { ok: false, error: `TARGET_UNAVAILABLE: 当前浏览器已被任务 ${this.session.ownerSessionId} 占用，禁止跨任务访问` };
    }
    if (runId && this.session.runId && this.session.runId !== runId) {
      return { ok: false, error: `TARGET_UNAVAILABLE: 任务代次已过期（当前 runId 不匹配）` };
    }
    return { ok: true };
  }

  /**
   * 检查运行限额（补充要求 7）
   */
  checkLimits() {
    if (!this.session) return { ok: true };
    if (this.session.actionCount >= MAX_ACTION_COUNT) {
      this.pause({ reason: `已达到最大连续动作限额 (${MAX_ACTION_COUNT})，请人工确认后继续` });
      return { ok: false, error: "LIMIT_REACHED: 已达到最大连续动作限额，请人工确认后继续" };
    }
    if (this.session.startedAt && Date.now() - this.session.startedAt > MAX_RUNTIME_MS) {
      this.pause({ reason: "已达到单次任务最大运行时间 (10 分钟)，请人工确认后继续" });
      return { ok: false, error: "LIMIT_REACHED: 已达到单次任务最大运行时间，请人工确认后继续" };
    }
    return { ok: true };
  }

  /**
   * 串行队列执行，带上下文校验与双代次防护
   */
  async runExclusive(taskFn, { description = "", context = {} } = {} as any) {
    if (this.session.status === CONTROL_STATUS.HUMAN_CONTROL) {
      return { ok: false, errorCode: "HUMAN_TAKEOVER", result: "页面已被用户接管，请等待用户交还控制权" };
    }

    if (this.session.status === CONTROL_STATUS.PAUSED || this.session.status === CONTROL_STATUS.STOPPED) {
      return { ok: false, errorCode: "CONTROL_INACTIVE", result: `控制已暂停或停止：${this.session.pauseReason}` };
    }

    const ownerCheck = this.checkTaskOwnership(context);
    if (!ownerCheck.ok) {
      return { ok: false, errorCode: "TARGET_UNAVAILABLE", result: ownerCheck.error };
    }

    const limits = this.checkLimits();
    if (!limits.ok) {
      return { ok: false, errorCode: "LIMIT_REACHED", result: limits.error };
    }

    const expectedEpoch = this.session.leaseEpoch;
    const signal = this.session.abortController.signal;

    const checkLease = () => {
      return this.session?.leaseEpoch === expectedEpoch && !signal.aborted && this.session?.status === CONTROL_STATUS.RUNNING;
    };

    if (this.session?.adapter) {
      this.session.adapter.setLeaseChecker(checkLease);
    }

    // 串行排队
    const currentTask = this.actionQueue.then(async () => {
      if (!checkLease()) {
        return { ok: false, errorCode: "LEASE_REVOKED", result: "操作已取消或代次已失效" };
      }

      if (description) {
        this.setActionText(description);
      }

      try {
        const res = await taskFn(this.session.adapter, { signal, checkLease, session: this.session });
        if (this.session) {
          this.session.actionCount += 1;
        }
        return res;
      } catch (err: any) {
        if (err.message.includes("LEASE_REVOKED") || !checkLease()) {
          return { ok: false, errorCode: "LEASE_REVOKED", result: "操作执行期间已被接管或取消" };
        }
        return { ok: false, errorCode: "EXECUTION_ERROR", result: `执行异常: ${err.message}` };
      } finally {
        if (this.session?.status === CONTROL_STATUS.RUNNING) {
          this.setActionText("正在等待下一步...");
        }
      }
    });

    this.actionQueue = currentTask.catch(() => {});
    return currentTask;
  }

  /**
   * 观察当前页面
   */
  async observe({ mode = "auto", captureScreenshot = true, context = {} } = {} as any) {
    return this.runExclusive(
      async (adapter) => {
        const obs = await adapter.observe({
          mode,
          captureScreenshot,
          workspacePath: this.session.workspacePath
        });
        return {
          ok: true,
          result: obs.summary,
          images: obs.images,
          data: {
            controlSessionId: this.session.controlSessionId,
            tabId: this.session.tabId,
            observationId: obs.observationId,
            documentEpoch: obs.documentEpoch,
            viewportEpoch: obs.viewportEpoch,
            url: obs.url,
            title: obs.title,
            viewport: obs.viewport,
            elements: obs.elements
          }
        };
      },
      { description: "正在观察页面...", context }
    );
  }

  /**
   * 读取正文
   */
  async readText({ context = {} } = {} as any) {
    return this.runExclusive(
      async (adapter) => {
        return await adapter.readPageText();
      },
      { description: "正在读取正文...", context }
    );
  }

  /**
   * 执行交互动作（包含在途与已完成 actionId 并发去重，修复 F7 / 补充要求 5）
   */
  async act({ observationId, actionId, action, context = {} }) {
    // 强制要求 observationId，严禁回退缓存 (F7)
    if (!observationId || typeof observationId !== "string") {
      return { ok: false, errorCode: "STALE_OBSERVATION", result: "必须提供有效的 observationId 参数" };
    }

    // 严格检查任务归属：非本任务调用者严禁查询在途或已完成动作缓存 (F2_cross_owner_cached_action)
    const ownerCheck = this.checkTaskOwnership(context);
    if (!ownerCheck.ok) {
      return { ok: false, errorCode: "TARGET_UNAVAILABLE", result: ownerCheck.error };
    }

    // actionId 严格去重与并发合并
    if (actionId) {
      const aid = String(actionId);
      if (this.completedActionIds.has(aid)) {
        return { ...this.completedActionIds.get(aid), idempotent: true };
      }
      if (this.inFlightActionIds.has(aid)) {
        // 并发相同请求直接等待第一次的同一个 Promise
        return await this.inFlightActionIds.get(aid);
      }
    }

    const actionDesc = action?.type ? `正在执行 ${action.type}` : "正在操作页面";

    const taskPromise = this.runExclusive(
      async (adapter, { signal, checkLease }) => {
        const result = await adapter.act({ observationId, action }, { signal, checkLease });
        return result;
      },
      { description: actionDesc, context }
    );

    if (actionId) {
      const aid = String(actionId);
      this.inFlightActionIds.set(aid, taskPromise);
    }

    try {
      const res = await taskPromise;
      if (actionId) {
        const aid = String(actionId);
        this.inFlightActionIds.delete(aid);
        this.completedActionIds.set(aid, res);
      }
      return res;
    } catch (err: any) {
      if (actionId) {
        const aid = String(actionId);
        this.inFlightActionIds.delete(aid);
        this.completedActionIds.set(aid, {
          ok: false,
          errorCode: "EXECUTION_ERROR",
          result: `执行异常: ${err.message}`
        });
      }
      throw err;
    }
  }

  /**
   * 等待条件
   */
  async wait({ condition, timeoutMs = 15000, context = {} }) {
    return this.runExclusive(
      async (adapter, { signal, checkLease }) => {
        const result = await adapter.wait({ condition, timeoutMs, signal, checkLease });
        return result;
      },
      { description: "正在等待页面就绪...", context }
    );
  }

  dispose() {
    this.stop({ reason: "管理器已销毁" });
    this.session = null;
    this.openReservation = null;
    this.actionQueue = Promise.resolve();
    this.inFlightActionIds.clear();
    this.completedActionIds.clear();
  }
}
