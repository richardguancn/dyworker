// DYWorker 浏览器协作与 Computer Use 工具集
// 通过 BrowserControlManager 和 BrowserPageAdapter，提供统一的状态管理、代次租约、元素定位与协议级输入
import { promises as fs, existsSync, mkdirSync } from "node:fs";
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
downloadContentsId;
currentContext;
reservedDownloadPaths;
surfaceLabel;
supportsHandoff;
constructor({ openPanel, closePanel, getContents, listTabs, activateTab, closeTab, controlManager, onStateChange, surfaceLabel = '右侧浏览器面板', supportsHandoff = true } = {} as any) {
    this.openPanel = openPanel;
    this.closePanel = closePanel;
    this.getContents = getContents;
    this.listTabs = listTabs;
    this.activateTab = activateTab;
    this.closeTab = closeTab;
    this.controlManager = controlManager || new BrowserControlManager({ onStateChange });
    this.surfaceLabel = surfaceLabel;
    this.supportsHandoff = supportsHandoff;
    this.workspacePath = "";
    this.downloads = [];
    this.downloadSession = null;
    this.downloadHandler = null;
    this.downloadContentsId = 0;
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
    if (this.downloadSession === contents.session && this.downloadHandler && this.downloadContentsId === contents.id) return;
    this.detachDownloadHandler();

    const browserSession = contents.session;
    const webContentsId = contents.id;
    const handleDownload = (event, item, webContents) => {
      if (webContents?.id !== webContentsId) return;
      if (!this.workspacePath) { event.preventDefault(); return; }
      const rawName = path.basename(item.getFilename() || "download");
      if (!isSafeRelativePath(rawName)) { event.preventDefault(); return; }

      const downloadDir = path.join(this.workspacePath, "下载");
      let target;
      try {
        mkdirSync(downloadDir, { recursive: true });
        target = this.resolveSafeDownloadPath(downloadDir, rawName);
        item.setSavePath(target);
      } catch {
        event.preventDefault();
        return;
      }
      item.once("done", (_e, state) => {
        if (state === "completed") {
          this.downloads.push(`下载/${path.basename(target)}`);
        }
      });
    };
    browserSession.on("will-download", handleDownload);
    this.downloadSession = browserSession;
    this.downloadHandler = handleDownload;
    this.downloadContentsId = webContentsId;
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
    this.downloadContentsId = 0;
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

  async open(rawUrl, tabId, sessionOptions = {} as any) {
    // 关键检查点 1：接管状态下在发起任何导航前硬拦截，严禁未获许可跳转网页 (F1 / 补充要求 1)
    if (this.controlManager.session && this.controlManager.session.status === CONTROL_STATUS.HUMAN_CONTROL) {
      return {
        ok: false,
        errorCode: "HUMAN_TAKEOVER",
        result: "页面当前处于人工接管中，未获得用户继续许可前禁止进行自动操作"
      };
    }
    const prior = this.controlManager.session;
    if (prior) {
      const sameRun = prior.ownerSessionId === this.currentContext.ownerSessionId && prior.runId === this.currentContext.runId;
      if ((prior.status === CONTROL_STATUS.PAUSED && !(sameRun && prior.allowOpenAfterPause) && !(prior.webContents?.isDestroyed?.() && !sameRun)) ||
        (prior.status === CONTROL_STATUS.STOPPED && sameRun && !prior.allowOpenAfterStop)) {
        return { ok: false, errorCode: 'CONTROL_INACTIVE', result: '当前操作已暂停或结束，不能继续打开网页。' };
      }
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
      panel = await this.openPanel(targetUrl, tabId, { token: reservationToken, sessionSource: sessionOptions.sessionSource, profileId: sessionOptions.profileId });
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
      tabId: panel.tabId || tabId || this.currentContext.tabId,
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
      ? `已在${this.surfaceLabel}打开网页：\n${finalUrl || targetUrl}\n\n当前页面快照：\n${initialObs.result}`
      : `已在${this.surfaceLabel}打开网页\n${finalUrl || targetUrl}${this.downloadNote()}`;

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
      return { ok: true, result: `${this.surfaceLabel}当前没有打开的标签页（可用 browser__open 打开网页）` };
    }
    const controlledId = this.controlManager.session?.webContentsId;
    const lines = tabs.map((tab) => {
      const marks = [];
      if (tab.active) marks.push(this.supportsHandoff ? "当前显示" : "当前页面");
      if (tab.webContentsId && controlledId && tab.webContentsId === controlledId) marks.push("助手受控页");
      const mark = marks.length ? `（${marks.join("、")}）` : "";
      return `- ${tab.id}${mark} ${tab.title || "（未命名）"}：${tab.url || "空白页"}`;
    });
    return { ok: true, result: `${this.surfaceLabel}标签页（共 ${tabs.length} 个）：\n${lines.join("\n")}` };
  }

  /** browser__tabs activate：切到指定标签页，并把控制权移到它的页面上 */
  async activateTabById(rawTabId) {
    const tabId = String(rawTabId || "").trim();
    if (!tabId) return { ok: false, result: "browser__tabs activate 必须提供 tabId 参数" };
    // 切换标签页本身会改变用户看到的页面，必须在切换前检查输入释放状态。
    try { this.controlManager.assertInputReleased(); }
    catch (error: any) { return { ok: false, errorCode: 'TARGET_BUSY', result: String(error?.message || error).replace(/^TARGET_BUSY:\s*/, '') }; }
    const originalSession = this.controlManager.session;
    const switchingAfterClose = Boolean(originalSession && originalSession.status === CONTROL_STATUS.STOPPED && originalSession.allowOpenAfterStop
      && originalSession.ownerSessionId === this.currentContext.ownerSessionId && originalSession.runId === this.currentContext.runId);
    if (originalSession && originalSession.status !== CONTROL_STATUS.RUNNING && !switchingAfterClose) {
      return { ok: false, errorCode: 'CONTROL_INACTIVE', result: '当前操作已暂停或结束，不能切换标签页。' };
    }
    // 兼容老宿主：没有标签页管理能力时保持原有「比对当前受控标签」的语义
    if (typeof this.activateTab !== "function") {
      const session = await this.ensureActiveSession();
      if (!session) return { ok: false, result: `${this.surfaceLabel}还没有打开网页` };
      if ((session.tabId || "active") !== tabId) return { ok: false, result: `找不到指定的标签页 ID: ${tabId}` };
      return { ok: true, result: `已切换至标签页 ${tabId}` };
    }
    let token;
    try { token = this.controlManager.reserveOpen({ ...this.currentContext, tabId }).token; }
    catch (error: any) { return { ok: false, errorCode: 'TARGET_BUSY', result: String(error?.message || error) }; }
    // 先停掉旧页面的在途操作，并记录代次，等待切换期间不得覆盖接管或停止。
    if (originalSession && !switchingAfterClose) this.controlManager.pause({ reason: '正在切换标签页', preserveOpenReservation: true });
    const switchEpoch = originalSession?.leaseEpoch;
    const switchStillValid = () => this.controlManager.isOpenReservationValid(token) && this.controlManager.session === originalSession && (!originalSession ||
      (originalSession.leaseEpoch === switchEpoch && (switchingAfterClose
        ? originalSession.status === CONTROL_STATUS.STOPPED && originalSession.allowOpenAfterStop
        : originalSession.status === CONTROL_STATUS.PAUSED)));
    let result;
    try { result = await this.activateTab(tabId, this.currentContext.ownerSessionId, { token }); }
    catch (error: any) { result = { ok: false, result: error?.message || '切换标签页失败' }; }
    if (!switchStillValid()) {
      this.controlManager.clearOpenReservation({ token });
      return { ok: false, errorCode: 'LEASE_REVOKED', result: '切换期间操作状态已变化，不再继续控制页面。' };
    }
    if (!result?.ok) {
      this.controlManager.clearOpenReservation({ token });
      // 只有明确确认界面未切换时才能恢复旧页面，超时不能作为未切换的证据。
      if (originalSession && !switchingAfterClose && result?.safeToResume) this.controlManager.resume({ ownerSessionId: originalSession.ownerSessionId, runId: originalSession.runId });
      return { ok: false, result: result?.result || `找不到指定的标签页 ID: ${tabId}` };
    }
    if (!result.contents) {
      this.controlManager.clearOpenReservation({ token });
      // 切到了空白标签页：可见页面已经不是受控页，控制会话跟着暂停，
      // 避免助手继续操作背后那个看不见的旧页面
      this.controlManager.pause({ reason: "已切换到空白标签页，操作已暂停", allowOpen: true });
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
      this.controlManager.clearOpenReservation({ token });
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
      this.controlManager.stop({ reason: "助手关闭了正在操作的标签页", allowReopen: true });
      this.detachDownloadHandler();
    }
    const stoppedSession = this.controlManager.session;
    let result;
    try { result = await this.closeTab(tabId, this.currentContext.ownerSessionId); }
    catch (error) {
      if (this.controlManager.session === stoppedSession && stoppedSession?.status === CONTROL_STATUS.STOPPED) stoppedSession.allowOpenAfterStop = false;
      throw error;
    }
    if (!result?.ok) {
      if (target && controlledContentsId && target.webContentsId === controlledContentsId && this.controlManager.session?.status === CONTROL_STATUS.STOPPED) this.controlManager.session.allowOpenAfterStop = false;
      return { ok: false, result: result?.result || `找不到指定的标签页 ID: ${tabId}` };
    }
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

    // 用户接管后，包括关闭页面在内的自动操作都不能干扰用户。
    if (
      this.controlManager.session?.status === CONTROL_STATUS.HUMAN_CONTROL &&
      name !== "browser__handoff"
    ) {
      return {
        ok: false,
        errorCode: "HUMAN_TAKEOVER",
        result: "页面当前处于人工接管中，未获得用户继续许可前禁止进行自动操作"
      };
    }

    switch (name) {
      case "browser__open":
        return this.open(args?.url, args?.tabId, { sessionSource: args?.sessionSource, profileId: args?.profileId });

      case "browser__observe": {
        const session = await this.ensureActiveSession();
        if (!session) return { ok: false, result: `${this.surfaceLabel}尚未打开网页，请先用 browser__open 打开` };
        return this.controlManager.observe({
          mode: args?.mode || "auto",
          captureScreenshot: args?.captureScreenshot !== false,
          offset: args?.offset ?? 0,
          context: this.currentContext
        });
      }

      case "browser__inspect": {
        const session = await this.ensureActiveSession();
        if (!session) return { ok: false, result: `${this.surfaceLabel}尚未打开网页` };
        return this.controlManager.inspect({ context: this.currentContext });
      }

      case "browser__act": {
        const session = await this.ensureActiveSession();
        if (!session) return { ok: false, result: `${this.surfaceLabel}尚未打开网页，请先用 browser__open 打开` };

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
        } catch (error: any) {
          nextObs = { ok: false, result: error.message };
        }

        return {
          ok: true,
          result: `${actRes.result || "动作已执行"}${nextObs?.ok ? `\n\n操作后最新页面：\n${nextObs.result}` : `\n\n未能核对操作后状态：${nextObs?.result || "页面读取失败"}。请先重新观察并确认结果，不要重复提交。`}`,
          verified: Boolean(nextObs?.ok),
          images: nextObs?.images || [],
          data: nextObs?.data || null
        };
      }

      case "browser__wait": {
        const session = await this.ensureActiveSession();
        if (!session) return { ok: false, result: `${this.surfaceLabel}尚未打开网页` };
        const waitRes = await this.controlManager.wait({
          condition: { type: args?.type, value: args?.value, selector: args?.selector },
          timeoutMs: args?.timeoutMs === undefined ? 15000 : Number(args.timeoutMs),
          context: this.currentContext
        });
        if (!waitRes.ok) return waitRes;

        let nextObs;
        try { nextObs = await this.controlManager.observe({ context: this.currentContext }); }
        catch (error: any) { nextObs = { ok: false, result: error?.message || '页面读取失败' }; }
        if (!nextObs?.ok) return { ok: false, errorCode: nextObs?.errorCode || 'OBSERVATION_FAILED',
          result: `${waitRes.result}\n但未能读取等待后的页面：${nextObs?.result || '页面读取失败'}。请重新观察。` };
        return {
          ok: true,
          result: `${waitRes.result}\n\n等待后最新页面：\n${nextObs.result}`,
          images: nextObs.images,
          data: nextObs.data
        };
      }

      case "browser__read": {
        const session = await this.ensureActiveSession();
        if (!session) return { ok: false, result: `${this.surfaceLabel}还没有打开网页` };
        const textRes = await this.controlManager.readText({ context: this.currentContext });
        if (!textRes.ok) return textRes;
        return { ok: true, result: textRes.result + this.downloadNote() };
      }

      case "browser__handoff": {
        if (!this.supportsHandoff) return { ok: false, errorCode: 'HANDOFF_UNAVAILABLE', result: '后台浏览器暂不支持人工接管；需要用户处理时请说明限制，不能声称已转交。' };
        const ownerCheck = this.controlManager.checkTaskOwnership(this.currentContext);
        if (!ownerCheck.ok) {
          return { ok: false, errorCode: "TARGET_UNAVAILABLE", result: ownerCheck.error };
        }
        const takeover = this.controlManager.takeover({ reason: args?.reason || "助手请求人工接管" });
        if (!takeover.ok) return takeover;
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
          if (this.controlManager.session) {
            this.controlManager.stop({ reason: "助手关闭了浏览器", allowReopen: true });
            this.detachDownloadHandler();
          }
          if (this.closePanel) {
            const stoppedSession = this.controlManager.session;
            try {
              const closed = await this.closePanel();
              if (closed?.ok === false) {
                if (this.controlManager.session === stoppedSession && stoppedSession?.status === CONTROL_STATUS.STOPPED) stoppedSession.allowOpenAfterStop = false;
                return closed;
              }
            }
            catch (error) {
              if (this.controlManager.session === stoppedSession && stoppedSession?.status === CONTROL_STATUS.STOPPED) stoppedSession.allowOpenAfterStop = false;
              throw error;
            }
            return { ok: true, result: `已关闭${this.surfaceLabel}` };
          }
          return { ok: true, result: `已关闭${this.surfaceLabel}` };
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
        if (!session) return { ok: false, result: `${this.surfaceLabel}还没有打开网页` };
        return this.controlManager.observe({ captureScreenshot: true, context: this.currentContext });
      }

      case "browser__click": {
        const session = await this.ensureActiveSession();
        if (!session) return { ok: false, result: `${this.surfaceLabel}还没有打开网页` };
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
        if (!session) return { ok: false, result: `${this.surfaceLabel}还没有打开网页` };
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
        if (!session) return { ok: false, result: `${this.surfaceLabel}还没有打开网页` };
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
          this.controlManager.stop({ reason: "模型主动关闭面板", allowReopen: true });
          this.detachDownloadHandler();
        }
        const stoppedSession = this.controlManager.session;
        try {
          const closed = await this.closePanel?.();
          if (closed?.ok === false) {
            if (this.controlManager.session === stoppedSession && stoppedSession?.status === CONTROL_STATUS.STOPPED) stoppedSession.allowOpenAfterStop = false;
            return closed;
          }
        }
        catch (error) {
          if (this.controlManager.session === stoppedSession && stoppedSession?.status === CONTROL_STATUS.STOPPED) stoppedSession.allowOpenAfterStop = false;
          throw error;
        }
        return { ok: true, result: `${this.surfaceLabel}已关闭` };
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
      "打开网页并返回结构与截图。默认使用任务独立的隐藏浏览器和空白登录状态；需要已登录状态时用 sessionSource 只读复用任意浏览器环境中该网站的登录数据。桌面会话可请求用户接管，其他入口可能不支持。需要右侧面板时设置 background=false。",
      {
        url: stringArg("HTTP/HTTPS 网址"),
        tabId: stringArg("可选：指定标签页 ID（来自 browser__tabs list）"),
        background: { type: 'boolean', description: '默认 true，使用独立的后台浏览器；false 使用右侧面板（固定使用内置浏览器登录状态）。任务结束后后台页面及临时登录状态关闭。' },
        sessionSource: stringArg("仅后台浏览器：登录状态来源。默认 isolated（空白）；builtin 为内置浏览器；auto 先查内置浏览器，再选本机浏览器中该网站 Cookie 最多的画像；也可传任意浏览器 ID 或名称，如 chrome、edge、firefox、arc、vivaldi、opera、brave 或其他已发现的 Chromium/Firefox 系浏览器；Safari 等无法读取数据的浏览器请用 desktop 直接操作。只复制目标网站域名的 Cookie 和同源本地存储到本任务临时分区，不修改原浏览器。Chromium 系浏览器首次读取可能弹出系统钥匙串授权。"),
        profileId: stringArg("可选：浏览器画像 ID 或名称（如 Default、Profile 1、default-release）；不传时使用默认画像")
      },
      ["url"]
    ),
    tool(
      "browser__observe",
      "观察当前网页，返回最新观察编号（observationId）、可操作元素列表（带 ref 编号）、标题、网址和截图。操作前或页面变化后必调。",
      {
        mode: { type: "string", enum: ["auto", "text", "visual"], description: "模式：auto（默认）/ text / visual" },
        captureScreenshot: { type: "boolean", description: "是否截图，默认 true" },
        offset: { type: "integer", minimum: 0, description: "可操作元素的起始位置，默认 0；控件较多时分段查看，每次以新观察编号为准" }
      },
      []
    ),
    tool(
      "browser__inspect",
      "只读核对当前页面正文和截图，不重新编号、不替换现有观察。用于审核或核验；操作目标仍需 browser__observe 返回的编号。",
      {}, []
    ),
    tool(
      "browser__act",
      "在受控网页上执行点击、双击、右击、悬停、输入、按键、滚动、选择、拖拽、上传本地文件及前进/后退/刷新。须传最新 observationId 与唯一 actionId，动作后自动返回最新页面。上传文件必须已获用户对文件及目的地的授权。",
      {
        observationId: stringArg("最新 browser__observe 返回的观察编号"),
        actionId: stringArg("动作唯一标识（防重）"),
        action: {
          type: "object",
          description: "交互动作",
          properties: {
            type: {
              type: "string",
              enum: ["click", "double_click", "right_click", "hover", "type", "keypress", "scroll", "select", "drag", "upload", "back", "forward", "reload"],
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
            key: stringArg("keypress 按键或组合键（如 Enter、Shift+Tab、Control+a、Meta+a、ControlOrMeta+a）。复制、剪切和粘贴只在当前受控页面暂存纯文本，不访问系统剪贴板；切换页面控制后需重新复制。剪切通过退格删除，粘贴通过输入文字，操作后须检查结果。"),
            deltaX: { type: "number", description: "水平滚动距离" },
            deltaY: { type: "number", description: "垂直滚动距离" },
            value: stringArg("select 目标选项 value"),
            label: stringArg("select 目标选项文本"),
            files: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20, description: "upload 使用的本地文件路径（工作区内绝对或相对路径）；ref 指向观察中的 input:file，允许网站的隐藏文件输入框" },
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
        timeoutMs: { type: "integer", minimum: 1, maximum: 120000, description: "超时毫秒，默认 15000，最多 120000" }
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
