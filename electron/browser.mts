// DYWorker 浏览器协作与 Computer Use 工具集
// 通过 BrowserControlManager 和 BrowserPageAdapter，提供统一的状态管理、代次租约、元素定位与协议级输入
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { isSafeBrowserUrl, isSafeRelativePath } from "./agent.mts";
import { BrowserControlManager, CONTROL_STATUS } from "./browser-control.mts";

export class BrowserAgent {
  openPanel;
closePanel;
getContents;
listTabs;
activateTab;
closeTab;
controlManager;
workspacePath;
downloads;
downloadSession;
downloadHandler;
currentContext;
reservedDownloadPaths;
constructor({ openPanel, closePanel, getContents, listTabs, activateTab, closeTab, controlManager, onStateChange } = {} as any) {
    this.openPanel = openPanel;
    this.closePanel = closePanel;
    this.getContents = getContents;
    this.listTabs = listTabs;
    this.activateTab = activateTab;
    this.closeTab = closeTab;
    this.controlManager = controlManager || new BrowserControlManager({ onStateChange });
    this.workspacePath = "";
    this.downloads = [];
    this.downloadSession = null;
    this.downloadHandler = null;
    this.currentContext = { ownerSessionId: "", runId: "", tabId: "" };
    this.reservedDownloadPaths = new Set();
  }

  setContext({ ownerSessionId = "", runId = "", tabId = "" } = {} as any) {
    this.currentContext = {
      ownerSessionId: String(ownerSessionId || ""),
      runId: String(runId || ""),
      tabId: String(tabId || "")
    };
  }

  setWorkspace(workspacePath) {
    this.workspacePath = String(workspacePath || "");
    this.downloads = [];
    // 严格隔离：仅当控制会话属于本任务代次时，才允许同步工作目录 (F2_old_run_workspace)
    const session = this.controlManager.session;
    if (
      session &&
      session.ownerSessionId === this.currentContext.ownerSessionId &&
      (!this.currentContext.runId || session.runId === this.currentContext.runId)
    ) {
      session.workspacePath = this.workspacePath;
    }
  }

  /**
   * 下载同名安全序号递增生成（补充要求 7，支持内存预留防并发碰撞）
   */
  resolveSafeDownloadPath(dir, filename) {
    if (!this.reservedDownloadPaths) {
      this.reservedDownloadPaths = new Set();
    }
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    let target = path.join(dir, filename);
    let counter = 1;
    while (existsSync(target) || this.reservedDownloadPaths.has(target)) {
      target = path.join(dir, `${base}(${counter})${ext}`);
      counter += 1;
    }
    this.reservedDownloadPaths.add(target);
    return target;
  }

  attachDownloadHandler(contents) {
    if (!contents?.session) return;
    if (this.downloadSession === contents.session && this.downloadHandler) return;
    this.detachDownloadHandler();

    const browserSession = contents.session;
    const webContentsId = contents.id;
    const handleDownload = (_event, item, webContents) => {
      if (webContents?.id !== webContentsId) return;
      if (!this.workspacePath) return;
      const rawName = path.basename(item.getFilename() || "download");
      if (!isSafeRelativePath(rawName)) return;

      const downloadDir = path.join(this.workspacePath, "下载");
      const target = this.resolveSafeDownloadPath(downloadDir, rawName);
      item.setSavePath(target);
      item.once("done", (_e, state) => {
        if (state === "completed") {
          this.downloads.push(`下载/${path.basename(target)}`);
        }
      });
    };
    browserSession.on("will-download", handleDownload);
    this.downloadSession = browserSession;
    this.downloadHandler = handleDownload;
  }

  detachDownloadHandler() {
    if (this.downloadSession && this.downloadHandler) {
      try {
        this.downloadSession.removeListener("will-download", this.downloadHandler);
      } catch {
        // 忽略
      }
    }
    this.downloadSession = null;
    this.downloadHandler = null;
  }

  downloadNote() {
    if (!this.downloads.length) return "";
    const note = `\n已下载到工作区：${[...new Set(this.downloads)].join("、")}`;
    this.downloads = [];
    return note;
  }

  async ensureActiveSession() {
    // 无论是复用还是新建，无面板连接的后台 Agent 均禁止访问浏览器 (F2_background_existing_session)
    if (!this.openPanel) {
      return null;
    }

    const session = this.controlManager.session;
    // 严格检查归属：若全局会话属于其他任务，决不能越权复用或抢夺窥探 (F2)
    if (session && !session.webContents?.isDestroyed?.()) {
      if (!this.currentContext.ownerSessionId || session.ownerSessionId === this.currentContext.ownerSessionId) {
        return session;
      }
      return null;
    }

    // 候选页面按调用方归属过滤：当前激活 webview 若已归属其他会话（用户切换了
    // 会话），返回 null，本任务不得重新 acquire 到别人的页面上（跨会话穿透）
    const candidate = this.getContents?.(this.currentContext.ownerSessionId);
    if (!candidate || candidate.isDestroyed?.()) {
      return null;
    }

    try {
      return await this.controlManager.acquireControl({
        ownerSessionId: this.currentContext.ownerSessionId,
        runId: this.currentContext.runId,
        tabId: this.currentContext.tabId,
        webContents: candidate,
        workspacePath: this.workspacePath
      });
    } catch {
      return null;
    }
  }

  async open(rawUrl, tabId) {
    // 关键检查点 1：接管状态下在发起任何导航前硬拦截，严禁未获许可跳转网页 (F1 / 补充要求 1)
    if (this.controlManager.session && this.controlManager.session.status === CONTROL_STATUS.HUMAN_CONTROL) {
      return {
        ok: false,
        errorCode: "HUMAN_TAKEOVER",
        result: "页面当前处于人工接管中，未获得用户继续许可前禁止进行自动操作"
      };
    }

    // 关键检查点 2：身份合法性拦截，后台无宿主 Agent 严禁操作浏览器 (F2_background_no_renderer)
    if (!this.currentContext.ownerSessionId) {
      return {
        ok: false,
        errorCode: "TARGET_UNAVAILABLE",
        result: "缺少调用者任务身份，禁止打开网页"
      };
    }

    // 关键检查点 3：跨任务与同任务新旧代次抢占拦截（在发起任何导航前硬拦截！禁止先跳转再拒绝，F2）
    if (
      this.controlManager.session &&
      this.controlManager.session.status === CONTROL_STATUS.RUNNING
    ) {
      const curOwner = this.controlManager.session.ownerSessionId;
      const curRun = this.controlManager.session.runId;
      const callerOwner = this.currentContext.ownerSessionId;
      const callerRun = this.currentContext.runId;

      if (curOwner && callerOwner && curOwner !== callerOwner) {
        return {
          ok: false,
          errorCode: "TARGET_BUSY",
          result: `当前浏览器正被任务 ${curOwner} 占用，禁止跨任务抢占`
        };
      }

      if (curOwner === callerOwner && curRun && callerRun && curRun !== callerRun) {
        return {
          ok: false,
          errorCode: "TARGET_BUSY",
          result: `当前浏览器正由新代次任务 ${curRun} 运行中，旧代次禁止抢占`
        };
      }
    }

    const check = isSafeBrowserUrl(rawUrl);
    if (!check.ok) return { ok: false, result: check.error };
    if (!this.openPanel) return { ok: false, result: "当前应用没有连接右侧浏览器面板" };

    // 关键前置预占：在调用会改变网页的面板操作前预占或串行化目标 (B2_loser_no_navigation_or_data_loss)
    // 预占返回唯一取消凭据，随后每一步副作用执行前都必须核验凭据仍有效 (C2)
    let reservationToken = "";
    try {
      if (typeof this.controlManager.reserveOpen === "function") {
        const reservation = this.controlManager.reserveOpen({
          ownerSessionId: this.currentContext.ownerSessionId,
          runId: this.currentContext.runId,
          tabId: tabId || this.currentContext.tabId
        });
        reservationToken = reservation?.token || "";
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("TARGET_BUSY:")) {
        return { ok: false, errorCode: "TARGET_BUSY", result: msg.replace(/^TARGET_BUSY:\s*/, "") };
      }
      if (msg.startsWith("HUMAN_TAKEOVER:")) {
        return { ok: false, errorCode: "HUMAN_TAKEOVER", result: msg.replace(/^HUMAN_TAKEOVER:\s*/, "") };
      }
      return { ok: false, errorCode: "TARGET_BUSY", result: msg };
    }

    const clearOwnReservation = () => {
      this.controlManager.clearOpenReservation?.({
        ownerSessionId: this.currentContext.ownerSessionId,
        token: reservationToken
      });
    };

    const targetUrl = check.url.toString();
    let panel;
    try {
      // 取消凭据随请求传递给面板侧，在实际发起导航前核验 (C2)
      panel = await this.openPanel(targetUrl, tabId, { token: reservationToken });
    } catch (err: any) {
      clearOwnReservation();
      throw err;
    }
    if (!panel?.ok || !panel.contents) {
      clearOwnReservation();
      return panel || { ok: false, result: "右侧浏览器面板打开失败" };
    }

    const contents = panel.contents;

    // 关键拦截 1：如果在打开面板或导航过程中已被用户接管，立即停止夺权 (F1_open_inflight_takeover / B1_human_same_target_url)
    // 接管后本请求不得再发起任何导航或刷新（包括回退上一页），保持用户当前页面状态不变 (C1_human_clear_preserved)
    if (this.controlManager.session && this.controlManager.session.status === CONTROL_STATUS.HUMAN_CONTROL) {
      clearOwnReservation();
      return {
        ok: false,
        errorCode: "HUMAN_TAKEOVER",
        result: "页面在打开过程中已被用户接管，自动跳转已取消"
      };
    }

    // 关键拦截 2：预占凭据失效（被接管、停止、过期或被新请求接替）后，严禁再触碰页面 (C2_expired_open_stays_revoked)
    if (reservationToken && typeof this.controlManager.isOpenReservationValid === "function"
      && !this.controlManager.isOpenReservationValid(reservationToken)) {
      return {
        ok: false,
        errorCode: "LEASE_REVOKED",
        result: "打开请求已过期或已被新任务接替，自动跳转已取消"
      };
    }

    // 关键拦截 3：如果在等待打开面板期间已被其他任务抢占锁定 (F2_two_open_race)
    // 只拒绝本请求，严禁通过事后回退导航“修复”页面——那会覆盖胜者的未保存内容 (C2)
    if (
      this.controlManager.session &&
      this.controlManager.session.status === CONTROL_STATUS.RUNNING &&
      this.controlManager.session.ownerSessionId &&
      this.controlManager.session.ownerSessionId !== this.currentContext.ownerSessionId
    ) {
      clearOwnReservation();
      return {
        ok: false,
        errorCode: "TARGET_BUSY",
        result: `当前浏览器正被任务 ${this.controlManager.session.ownerSessionId} 占用，禁止跨任务抢占`
      };
    }

    this.attachDownloadHandler(contents);

    // 锁定控制权
    await this.controlManager.acquireControl({
      ownerSessionId: this.currentContext.ownerSessionId,
      runId: this.currentContext.runId,
      tabId: tabId || this.currentContext.tabId,
      webContents: contents,
      workspacePath: this.workspacePath
    });

    if (this.controlManager.session) {
      this.controlManager.session.activeUrl = targetUrl;
    }

    const finalUrl = contents.getURL();
    if (finalUrl && finalUrl !== "about:blank") {
      const finalCheck = isSafeBrowserUrl(finalUrl);
      if (!finalCheck.ok) {
        await contents.loadURL("about:blank").catch(() => {});
        this.controlManager.stop({ reason: "重定向到非法地址" });
        return { ok: false, result: `网页重定向到了不允许的地址，已拦截：${finalUrl}` };
      }
    }

    // 初次观察
    let initialObs = null;
    try {
      initialObs = await this.controlManager.observe({ context: this.currentContext });
    } catch {
      // 忽略初次观察可能出现的加载中报错
    }

    const summaryText = initialObs?.result
      ? `已在右侧浏览器面板打开网页：\n${finalUrl || targetUrl}\n\n当前页面快照：\n${initialObs.result}`
      : `已在右侧浏览器面板打开网页\n${finalUrl || targetUrl}${this.downloadNote()}`;

    return {
      ok: true,
      url: finalUrl || targetUrl,
      result: summaryText,
      images: initialObs?.images || [],
      data: initialObs?.data || null
    };
  }

  /** 面板里的浏览器标签页清单；宿主没有这项能力（老宿主 / 测试桩）时返回 null */
  panelTabs() {
    if (typeof this.listTabs !== "function") return null;
    const tabs = this.listTabs(this.currentContext.ownerSessionId);
    return Array.isArray(tabs) ? tabs : null;
  }

  /** browser__tabs list：列出面板里全部标签页，标出当前显示与助手受控的那个 */
  tabListResult() {
    const tabs = this.panelTabs();
    if (!tabs) {
      // 兼容老宿主：只有「当前受控标签页」一个概念
      const session = this.controlManager.session;
      const currentUrl = session?.webContents?.getURL?.() || "";
      const currentTitle = session?.webContents?.getTitle?.() || "";
      return {
        ok: true,
        result: `当前受控标签页：\n- 标签页 ID: ${session?.tabId || "active"}${session?.webContentsId ? ` (webContents: ${session.webContentsId})` : ""}，网址: ${currentUrl || "about:blank"}，标题: ${currentTitle || "（未命名）"}`
      };
    }
    if (!tabs.length) {
      return { ok: true, result: "右侧浏览器面板当前没有打开的标签页（可用 browser__open 打开网页）" };
    }
    const controlledId = this.controlManager.session?.webContentsId;
    const lines = tabs.map((tab) => {
      const marks = [];
      if (tab.active) marks.push("当前显示");
      if (tab.webContentsId && controlledId && tab.webContentsId === controlledId) marks.push("助手受控页");
      const mark = marks.length ? `（${marks.join("、")}）` : "";
      return `- ${tab.id}${mark} ${tab.title || "（未命名）"}：${tab.url || "空白页"}`;
    });
    return { ok: true, result: `右侧浏览器标签页（共 ${tabs.length} 个）：\n${lines.join("\n")}` };
  }

  /** browser__tabs activate：切到指定标签页，并把控制权移到它的页面上 */
  async activateTabById(rawTabId) {
    const tabId = String(rawTabId || "").trim();
    if (!tabId) return { ok: false, result: "browser__tabs activate 必须提供 tabId 参数" };
    // 兼容老宿主：没有标签页管理能力时保持原有「比对当前受控标签」的语义
    if (typeof this.activateTab !== "function") {
      const session = await this.ensureActiveSession();
      if (!session) return { ok: false, result: "右侧浏览器面板还没有打开网页" };
      if ((session.tabId || "active") !== tabId) return { ok: false, result: `找不到指定的标签页 ID: ${tabId}` };
      return { ok: true, result: `已切换至标签页 ${tabId}` };
    }
    const result = await this.activateTab(tabId, this.currentContext.ownerSessionId);
    if (!result?.ok) return { ok: false, result: result?.result || `找不到指定的标签页 ID: ${tabId}` };
    if (!result.contents) {
      // 切到了空白标签页：可见页面已经不是受控页，控制会话跟着暂停，
      // 避免助手继续操作背后那个看不见的旧页面
      this.controlManager.pause({ reason: "已切换到空白标签页，操作已暂停" });
      return { ok: true, result: `已切换到标签页 ${tabId}，它还是空白页：用 browser__open 可以在这里打开网址` };
    }
    try {
      await this.controlManager.acquireControl({
        ownerSessionId: this.currentContext.ownerSessionId,
        runId: this.currentContext.runId,
        tabId,
        webContents: result.contents,
        workspacePath: this.workspacePath
      });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("HUMAN_TAKEOVER:")) {
        return { ok: false, errorCode: "HUMAN_TAKEOVER", result: msg.replace(/^HUMAN_TAKEOVER:\s*/, "") };
      }
      if (msg.startsWith("TARGET_BUSY:")) {
        return { ok: false, errorCode: "TARGET_BUSY", result: msg.replace(/^TARGET_BUSY:\s*/, "") };
      }
      return { ok: false, result: `无法接管该标签页：${msg}` };
    }
    this.attachDownloadHandler(result.contents);
    let obs = null;
    try {
      obs = await this.controlManager.observe({ context: this.currentContext });
    } catch {
      // 忽略初次观察可能出现的加载中报错
    }
    const where = result.tab?.url || result.contents.getURL?.() || "";
    return {
      ok: true,
      result: obs?.result
        ? `已切换到标签页 ${tabId}：${where}\n\n当前页面：\n${obs.result}`
        : `已切换到标签页 ${tabId}：${where}`,
      images: obs?.images || [],
      data: obs?.data || null
    };
  }

  /** browser__tabs close <tabId>：关掉指定标签页（不传 tabId 时关闭整个面板） */
  async closeTabById(rawTabId) {
    const tabId = String(rawTabId || "").trim();
    if (!tabId) return { ok: false, result: "缺少 tabId：关闭整个浏览器面板请用 browser__close" };
    if (typeof this.closeTab !== "function") return { ok: false, result: "当前宿主不支持按 ID 关闭标签页" };
    const controlledContentsId = this.controlManager.session?.webContentsId;
    const target = (this.panelTabs() || []).find((tab) => tab.id === tabId);
    // 关掉的正是助手受控的页面：先把控制会话收干净，别等 webview 销毁时的兜底
    if (target && controlledContentsId && target.webContentsId === controlledContentsId) {
      this.controlManager.stop({ reason: "助手关闭了正在操作的标签页" });
    }
    const result = await this.closeTab(tabId, this.currentContext.ownerSessionId);
    if (!result?.ok) return { ok: false, result: result?.result || `找不到指定的标签页 ID: ${tabId}` };
    return { ok: true, result: `已关闭标签页 ${tabId}` };
  }

  async handle(name, args = {} as any) {
    // 关键检查点：后台无宿主 Agent 或空身份禁止控制浏览器 (F2_background_no_renderer)
    if (!this.currentContext.ownerSessionId && !this.openPanel) {
      return {
        ok: false,
        errorCode: "TARGET_UNAVAILABLE",
        result: "缺少调用者任务身份，禁止访问浏览器"
      };
    }

    // 检查接管拦截：除人工接管交接工具外，处于 human_control 时统一拒绝
    if (
      this.controlManager.session?.status === CONTROL_STATUS.HUMAN_CONTROL &&
      name !== "browser__handoff" &&
      name !== "browser__close"
    ) {
      return {
        ok: false,
        errorCode: "HUMAN_TAKEOVER",
        result: "页面当前处于人工接管中，未获得用户继续许可前禁止进行自动操作"
      };
    }

    switch (name) {
      case "browser__open":
        return this.open(args?.url, args?.tabId);

      case "browser__observe": {
        const session = await this.ensureActiveSession();
        if (!session) return { ok: false, result: "右侧浏览器面板尚未打开网页，请先用 browser__open 打开" };
        return this.controlManager.observe({
          mode: args?.mode || "auto",
          captureScreenshot: args?.captureScreenshot !== false,
          context: this.currentContext
        });
      }

      case "browser__act": {
        const session = await this.ensureActiveSession();
        if (!session) return { ok: false, result: "右侧浏览器面板尚未打开网页，请先用 browser__open 打开" };

        // 必须显式提供 observationId，杜绝自动回退 (F7)
        const obsId = args?.observationId;
        if (!obsId || typeof obsId !== "string") {
          return {
            ok: false,
            errorCode: "STALE_OBSERVATION",
            result: "browser__act 必须提供有效的 observationId 参数（请使用最新观察返回的【观察编号】）"
          };
        }

        // 必须提供非空的 actionId 进行幂等排重 (F7_require_action_id / 补充要求 5)
        const actionId = args?.actionId;
        if (!actionId || typeof actionId !== "string" || !actionId.trim()) {
          return {
            ok: false,
            errorCode: "INVALID_ACTION_ID",
            result: "browser__act 必须提供非空的 actionId 参数用于排重与幂等控制"
          };
        }

        const action = args?.action || {
          type: args?.type,
          ref: args?.ref,
          point: args?.point,
          text: args?.text,
          key: args?.key,
          deltaX: args?.deltaX,
          deltaY: args?.deltaY,
          value: args?.value,
          label: args?.label
        };

        const actRes = await this.controlManager.act({
          observationId: obsId,
          actionId,
          action,
          context: this.currentContext
        });
        if (!actRes.ok) return actRes;

        // 动作完成后，默认自动执行一次新观察反馈
        let nextObs = null;
        try {
          nextObs = await this.controlManager.observe({ context: this.currentContext });
        } catch {
          // 忽略观察错误
        }

        return {
          ok: true,
          result: `${actRes.result || "操作已完成"}${nextObs?.result ? `\n\n操作后最新页面：\n${nextObs.result}` : ""}`,
          images: nextObs?.images || [],
          data: nextObs?.data || null
        };
      }

      case "browser__wait": {
        const session = await this.ensureActiveSession();
        if (!session) return { ok: false, result: "右侧浏览器面板尚未打开网页" };
        const waitRes = await this.controlManager.wait({
          condition: { type: args?.type, value: args?.value, selector: args?.selector },
          timeoutMs: Number(args?.timeoutMs) || 15000,
          context: this.currentContext
        });
        if (!waitRes.ok) return waitRes;

        const nextObs = await this.controlManager.observe({ context: this.currentContext });
        return {
          ok: true,
          result: `${waitRes.result}\n\n等待后最新页面：\n${nextObs.result}`,
          images: nextObs.images,
          data: nextObs.data
        };
      }

      case "browser__read": {
        const session = await this.ensureActiveSession();
        if (!session) return { ok: false, result: "右侧浏览器面板还没有打开网页" };
        const textRes = await this.controlManager.readText({ context: this.currentContext });
        if (!textRes.ok) return textRes;
        return { ok: true, result: textRes.result + this.downloadNote() };
      }

      case "browser__handoff": {
        const ownerCheck = this.controlManager.checkTaskOwnership(this.currentContext);
        if (!ownerCheck.ok) {
          return { ok: false, errorCode: "TARGET_UNAVAILABLE", result: ownerCheck.error };
        }
        this.controlManager.takeover({ reason: args?.reason || "助手请求人工接管" });
        return {
          ok: true,
          result: `已暂停自动操作并转交给用户接管。接管原因：${args?.reason || "需要人工协助处理"}。请等待用户在右侧面板处理完毕并点击“继续交给助手”。`
        };
      }

      case "browser__tabs": {
        // 严格检查归属：其他任务禁止窥探当前标签页 (F2_foreign_tabs)。
        // 例外：还没有任何控制会话时（面板刚打开、助手还没接管页面）允许列出、
        // 切换、关闭本任务面板里的标签页——它们本来就属于当前会话。
        const ownerCheck = this.controlManager.checkTaskOwnership(this.currentContext);
        if (!ownerCheck.ok && this.controlManager.session) {
          return { ok: false, errorCode: "TARGET_UNAVAILABLE", result: ownerCheck.error };
        }

        const action = args?.action || "list";
        if (action === "list") {
          return this.tabListResult();
        }
        if (action === "open") {
          if (!args?.url) return { ok: false, result: "browser__tabs open 必须提供 url 参数" };
          return this.open(args.url, args.tabId);
        }
        if (action === "activate") {
          return this.activateTabById(args?.tabId);
        }
        if (action === "close") {
          // 指定 tabId：关掉那一个标签页；不指定：维持原有语义，关闭整个浏览器面板
          if (args?.tabId) return this.closeTabById(args.tabId);
          if (this.closePanel) {
            await this.closePanel();
            return { ok: true, result: "已关闭右侧浏览器面板" };
          }
          return { ok: true, result: "已关闭右侧浏览器面板" };
        }
        return { ok: false, result: `未知的标签页操作：${action}` };
      }

      case "browser__downloads": {
        if (!this.downloads || !this.downloads.length) {
          return { ok: true, result: "当前任务没有下载记录" };
        }
        const filter = (args?.query || "").toLowerCase();
        const matched = this.downloads.filter((p) => !filter || p.toLowerCase().includes(filter));
        return {
          ok: true,
          result: `下载记录（共 ${matched.length} 项）：\n` + matched.map((f) => `- ${f}`).join("\n")
        };
      }

      // --- 兼容旧工具别名 ---
      case "browser__snapshot": {
        const session = await this.ensureActiveSession();
        if (!session) return { ok: false, result: "右侧浏览器面板还没有打开网页" };
        return this.controlManager.observe({ captureScreenshot: true, context: this.currentContext });
      }

      case "browser__click": {
        const session = await this.ensureActiveSession();
        if (!session) return { ok: false, result: "右侧浏览器面板还没有打开网页" };
        const obsId = args?.observationId;
        if (!obsId || typeof obsId !== "string") {
          return {
            ok: false,
            errorCode: "STALE_OBSERVATION",
            result: "browser__click 必须显式提供有效的 observationId 参数"
          };
        }
        return this.handle("browser__act", {
          observationId: obsId,
          actionId: args?.actionId,
          action: { type: "click", ref: Number(args?.ref) }
        });
      }

      case "browser__type": {
        const session = await this.ensureActiveSession();
        if (!session) return { ok: false, result: "右侧浏览器面板还没有打开网页" };
        const obsId = args?.observationId;
        if (!obsId || typeof obsId !== "string") {
          return {
            ok: false,
            errorCode: "STALE_OBSERVATION",
            result: "browser__type 必须显式提供有效的 observationId 参数"
          };
        }
        return this.handle("browser__act", {
          observationId: obsId,
          actionId: args?.actionId,
          action: { type: "type", ref: Number(args?.ref), text: String(args?.text ?? "") }
        });
      }

      case "browser__screenshot": {
        const session = await this.ensureActiveSession();
        if (!session) return { ok: false, result: "右侧浏览器面板还没有打开网页" };
        const obs = await this.controlManager.observe({ captureScreenshot: true, context: this.currentContext });

        if (args?.path && this.workspacePath) {
          const saveName = String(args.path).trim();
          if (isSafeRelativePath(saveName)) {
            const target = path.resolve(this.workspacePath, saveName.endsWith(".png") ? saveName : `${saveName}.png`);
            if (target.startsWith(path.resolve(this.workspacePath) + path.sep) && obs.images?.[0]?.data) {
              try {
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.writeFile(target, Buffer.from(obs.images[0].data, "base64"));
                return {
                  ok: true,
                  result: `截图已保存到工作区：${path.relative(this.workspacePath, target)}`,
                  images: obs.images
                };
              } catch (err: any) {
                return { ok: false, result: `截图写入失败: ${err.message}` };
              }
            }
          }
        }
        return { ok: true, result: "已截取当前网页画面", images: obs.images };
      }

      case "browser__close": {
        const ownerCheck = this.controlManager.checkTaskOwnership(this.currentContext);
        if (!ownerCheck.ok) {
          return { ok: false, errorCode: "TARGET_UNAVAILABLE", result: ownerCheck.error };
        }
        if (this.controlManager.session?.ownerSessionId === this.currentContext.ownerSessionId) {
          this.controlManager.stop({ reason: "模型主动关闭面板" });
        }
        await this.closePanel?.();
        return { ok: true, result: "右侧浏览器面板已关闭" };
      }

      default:
        return { ok: false, result: `未知浏览器操作：${name}` };
    }
  }

  dispose() {
    try {
      this.detachDownloadHandler();
    } catch {
      // 忽略下载监听器清理异常
    }
    try {
      // 严格隔离：必须同时匹配 ownerSessionId 和 runId，防止同任务旧代次关闭新代次 (F2_old_run_dispose)
      const session = this.controlManager?.session;
      if (
        session &&
        session.ownerSessionId === this.currentContext.ownerSessionId &&
        (!this.currentContext.runId || session.runId === this.currentContext.runId)
      ) {
        if (session.status !== CONTROL_STATUS.HUMAN_CONTROL) {
          this.controlManager.stop({ reason: "所属任务已结束" });
        }
      }
    } catch {
      // 忽略控制管理器停止异常
    }
  }
}

export function browserToolDefinitions() {
  const stringArg = (description) => ({ type: "string", description });
  const tool = (name, description, properties, required = []) => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
  });

  return [
    tool(
      "browser__open",
      "在右侧浏览器面板中打开网页（默认新开标签页或复用空白页/同网址页；传 tabId 则在指定标签页打开），自动返回页面结构与截图。",
      {
        url: stringArg("HTTP/HTTPS 网址"),
        tabId: stringArg("可选：指定标签页 ID（来自 browser__tabs list）")
      },
      ["url"]
    ),
    tool(
      "browser__observe",
      "观察当前网页，返回最新观察编号（observationId）、可操作元素列表（带 ref 编号）、标题、网址和截图。操作前或页面变化后必调。",
      {
        mode: { type: "string", enum: ["auto", "text", "visual"], description: "模式：auto（默认）/ text / visual" },
        captureScreenshot: { type: "boolean", description: "是否截图，默认 true" }
      },
      []
    ),
    tool(
      "browser__act",
      "在受控网页上执行交互动作（点击、双击、悬停、输入、按键、滚动、选择、拖拽）。须传最新 observationId 与唯一 actionId。",
      {
        observationId: stringArg("最新 browser__observe 返回的观察编号"),
        actionId: stringArg("动作唯一标识（防重）"),
        action: {
          type: "object",
          description: "交互动作",
          properties: {
            type: {
              type: "string",
              enum: ["click", "double_click", "hover", "type", "keypress", "scroll", "select", "drag"],
              description: "动作类型"
            },
            ref: { type: "integer", description: "目标元素 ref 编号" },
            point: {
              type: "object",
              description: "截图内像素坐标 { x, y }",
              properties: { x: { type: "number" }, y: { type: "number" } }
            },
            text: stringArg("type 填写的文字"),
            mode: { type: "string", enum: ["replace", "append"], description: "输入模式，默认 replace" },
            key: stringArg("keypress 按键名（如 Enter, Tab, Escape）"),
            deltaX: { type: "number", description: "水平滚动距离" },
            deltaY: { type: "number", description: "垂直滚动距离" },
            value: stringArg("select 目标选项 value"),
            label: stringArg("select 目标选项文本"),
            from: {
              type: "object",
              description: "drag 起点坐标",
              properties: { x: { type: "number" }, y: { type: "number" } }
            },
            to: {
              type: "object",
              description: "drag 终点坐标",
              properties: { x: { type: "number" }, y: { type: "number" } }
            }
          },
          required: ["type"]
        }
      },
      ["observationId", "actionId", "action"]
    ),
    tool(
      "browser__wait",
      "等待页面满足条件（网址包含、文字出现或元素就绪）后刷新观察。",
      {
        type: { type: "string", enum: ["url_contains", "text_present", "element_present"], description: "条件类型" },
        value: stringArg("目标文本"),
        selector: stringArg("CSS 选择器"),
        timeoutMs: { type: "integer", description: "超时毫秒，默认 15000" }
      },
      ["type"]
    ),
    tool(
      "browser__read",
      "读取当前网页正文完整文字。",
      {},
      []
    ),
    tool(
      "browser__handoff",
      "遇到验证码、扫码登录或需用户决断时，交还控制权由用户手动处理。",
      {
        reason: stringArg("交还原因说明")
      },
      ["reason"]
    ),
    tool(
      "browser__tabs",
      "管理浏览器标签页：list 列出全部，open 新开，activate 切换受控标签页（需 tabId），close 关闭指定标签页（不传 tabId 则关闭面板）。",
      {
        action: { type: "string", enum: ["list", "open", "activate", "close"], description: "操作动作" },
        url: stringArg("open 时的网址"),
        tabId: stringArg("目标标签页 ID")
      },
      ["action"]
    ),
    tool(
      "browser__downloads",
      "查询当前任务触发的下载文件列表与路径。",
      {
        query: stringArg("可选：文件名过滤词")
      },
      []
    ),
    tool("browser__screenshot", "将当前网页截图保存到工作区文件。", { path: stringArg("相对工作区的 .png 保存路径") }, []),
  ];
}
