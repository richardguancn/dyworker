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
controlManager;
workspacePath;
downloads;
downloadSession;
downloadHandler;
currentContext;
reservedDownloadPaths;
constructor({ openPanel, closePanel, getContents, controlManager, onStateChange } = {} as any) {
    this.openPanel = openPanel;
    this.closePanel = closePanel;
    this.getContents = getContents;
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
        // 严格检查归属：其他任务禁止窥探当前标签页 (F2_foreign_tabs)
        const ownerCheck = this.controlManager.checkTaskOwnership(this.currentContext);
        if (!ownerCheck.ok) {
          return { ok: false, errorCode: "TARGET_UNAVAILABLE", result: ownerCheck.error };
        }

        const action = args?.action || "list";
        if (action === "list") {
          const session = this.controlManager.session;
          const currentUrl = session?.webContents?.getURL?.() || "";
          const currentTitle = session?.webContents?.getTitle?.() || "";
          const currentTabId = session?.tabId || "active";
          return {
            ok: true,
            result: `当前受控标签页：\n- 标签页 ID: ${currentTabId}${session?.webContentsId ? ` (webContents: ${session.webContentsId})` : ""}，网址: ${currentUrl || "about:blank"}，标题: ${currentTitle || "（未命名）"}`
          };
        }
        if (action === "open") {
          if (!args?.url) return { ok: false, result: "browser__tabs open 必须提供 url 参数" };
          return this.open(args.url, args.tabId);
        }
        if (action === "activate") {
          const session = await this.ensureActiveSession();
          if (!session) return { ok: false, result: "无法激活标签页：未找到活动浏览器会话" };
          const targetTabId = args?.tabId;
          if (!targetTabId || session.tabId !== targetTabId) {
            return { ok: false, result: `找不到指定的标签页 ID: ${targetTabId}` };
          }
          return { ok: true, result: `已切换至标签页 ${targetTabId}` };
        }
        if (action === "close") {
          if (this.closePanel) {
            await this.closePanel();
            return { ok: true, result: `已关闭标签页 ${args?.tabId || ""}` };
          }
          return { ok: true, result: "已关闭标签页" };
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
      "在当前任务窗口右侧的浏览器面板中打开网页。支持 localhost 与内网地址。操作真实可见，打开后自动返回页面结构和截图。处于用户接管状态时禁止调用。",
      {
        url: stringArg("HTTP/HTTPS 网址"),
        tabId: stringArg("可选：目标标签页 ID")
      },
      ["url"]
    ),
    tool(
      "browser__observe",
      "观察当前网页，返回包含【观察编号】的最新的可操作元素列表（带 ref 编号）、页面标题、网址和页面截图。进行任何操作前或页面跳转后必须调用此工具获取最新观察编号。",
      {
        mode: { type: "string", enum: ["auto", "text", "visual"], description: "观察模式：auto（默认）、text（仅文字）、visual（带视觉）" },
        captureScreenshot: { type: "boolean", description: "是否截取屏幕画面，默认 true" }
      },
      []
    ),
    tool(
      "browser__act",
      "在当前受控网页上执行原子交互动作（点击、双击、悬停、键入、快捷键、滚动、下拉选择、拖拽等）。必须提供有效的 observationId 与唯一的 actionId 防止并发与重复操作。",
      {
        observationId: stringArg("当前观察的编号（来自最新 browser__observe 返回的【观察编号】，必填，严禁伪造或使用过期编号）"),
        actionId: stringArg("动作的唯一标识符（必填，用于排重与幂等控制，防止并发或重试误触）"),
        action: {
          type: "object",
          description: "交互动作对象",
          properties: {
            type: {
              type: "string",
              enum: ["click", "double_click", "hover", "type", "keypress", "scroll", "select", "drag"],
              description: "动作类型"
            },
            ref: { type: "integer", description: "目标元素编号（来自观察列表）" },
            point: {
              type: "object",
              description: "相对于截图画面的像素坐标 { x, y }，用于画布或复杂自定义控件（无截图时自动禁用）",
              properties: { x: { type: "number" }, y: { type: "number" } }
            },
            text: stringArg("type 动作时要填写的文字内容（支持普通 input 与 contenteditable 富文本）"),
            mode: { type: "string", enum: ["replace", "append"], description: "输入模式：replace（覆盖，默认）或 append（追加）" },
            key: stringArg("keypress 动作时的按键名，如 Enter, Backspace, Tab, Escape, ArrowDown"),
            deltaX: { type: "number", description: "scroll 动作时的水平滚动距离" },
            deltaY: { type: "number", description: "scroll 动作时的垂直滚动距离" },
            value: stringArg("select 动作时的目标选项 value"),
            label: stringArg("select 动作时的目标选项可见文本"),
            from: {
              type: "object",
              description: "drag 动作的起点坐标",
              properties: { x: { type: "number" }, y: { type: "number" } }
            },
            to: {
              type: "object",
              description: "drag 动作的终点坐标",
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
      "等待页面达到特定条件（如网址包含特定字符、页面出现特定文字或元素就绪），超时后安全返回并刷新观察。",
      {
        type: { type: "string", enum: ["url_contains", "text_present", "element_present"], description: "等待条件类型" },
        value: stringArg("url_contains 或 text_present 的目标文本"),
        selector: stringArg("element_present 的 CSS 选择器"),
        timeoutMs: { type: "integer", description: "最大超时时间（毫秒），默认 15000" }
      },
      ["type"]
    ),
    tool(
      "browser__read",
      "读取当前网页的正文完整文字内容（用于阅读文章、通知、文档正文、业务表格，自动过滤敏感密码）。",
      {},
      []
    ),
    tool(
      "browser__handoff",
      "当遇到人机验证码（CAPTCHA）、双因子短信验证、扫码登录或需要用户决断的业务操作时，主动交还控制权让用户在右侧网页手动处理。",
      {
        reason: stringArg("交还控制权的具体原因说明，例如：检测到登录滑块验证码，请用户协助完成")
      },
      ["reason"]
    ),
    tool(
      "browser__tabs",
      "管理右侧浏览器的标签页（列出受控标签页、打开新标签页、切换激活或关闭）。",
      {
        action: { type: "string", enum: ["list", "open", "activate", "close"], description: "标签页操作动作" },
        url: stringArg("open 动作时的目标网址"),
        tabId: stringArg("指定操作的目标标签页 ID")
      },
      ["action"]
    ),
    tool(
      "browser__downloads",
      "查询当前任务触发的下载文件列表与路径。",
      {
        query: stringArg("可选：按文件名过滤关键字")
      },
      []
    ),
    // 兼容历史老工具
    tool("browser__snapshot", "列出当前网页的可交互元素及编号（建议使用 browser__observe 替代）。", {}, []),
    tool("browser__click", "点击网页中的一个元素（建议使用 browser__act 替代）。", { ref: { type: "integer", description: "元素编号" }, actionId: stringArg("动作标识") }, ["ref"]),
    tool("browser__type", "在网页输入框中填写文字（建议使用 browser__act 替代）。", { ref: { type: "integer", description: "输入框编号" }, text: stringArg("要填写的文字"), actionId: stringArg("动作标识") }, ["ref", "text"]),
    tool("browser__screenshot", "截取当前网页画面保存到工作区留存证据。", { path: stringArg("相对工作区的保存路径，以 .png 结尾") }, []),
    tool("browser__close", "关闭右侧浏览器面板，结束浏览器协作。", {}, []),
  ];
}
