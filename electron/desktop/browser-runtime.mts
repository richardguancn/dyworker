// 从桌面入口拆出的内嵌浏览器生命周期与面板操作。
import { app,ipcMain } from "electron";
import { isSafeBrowserUrl } from "../agent.mts";
import { BrowserControlManager } from "../browser-control.mts";
import { forwardNativePanelShortcut } from "../panel-shortcuts.ts";

export function createBrowserRuntime(deps: {
  mainWindow: import("electron").BrowserWindow | null;
  ctx: any;
  isTrustedRendererUrl: (url: unknown) => boolean;
}) {
  const { isTrustedRendererUrl } = deps;

// 内置浏览器的 webview 登记：每个浏览器标签页常驻一个 webview，
// agent 的 browser__* 工具只作用于渲染进程上报的「当前显示」那个（无上报时回退最后创建的）
const embeddedBrowserContentsById = new Map();
let activeEmbeddedBrowserContentsId = 0;
let activeEmbeddedBrowserOwnerSessionId = "";
let embeddedBrowserContents = null;
// 渲染进程未上报（旧版本/预览环境）时的回退目标
let fallbackEmbeddedBrowserContentsId = 0;
// 面板里的浏览器标签页清单（渲染进程上报）：助手的 browser__tabs 工具据此列出、
// 切换、关闭标签页。面板标签属于某个会话，只有它是当前激活会话时才对外开放。
type BrowserPanelTabState = {
  id: string;
  title: string;
  url: string;
  active: boolean;
  webContentsId: number;
};
const browserPanelTabState: { ownerSessionId: string; tabs: BrowserPanelTabState[] } = { ownerSessionId: "", tabs: [] };
// 网页自己 window.open 出来的新标签页上限（助手主动开页不受限）：防止页面刷出大量标签页
const BROWSER_PANEL_TAB_LIMIT = 12;
// 面板状态由渲染进程持有，主进程只发指令 + 等它上报：这是等待上报变化的粒度
const BROWSER_PANEL_STEP_MS = 50;
const BROWSER_PANEL_TIMEOUT_MS = 5000;

app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;
  embeddedBrowserContentsById.set(contents.id, contents);
  embeddedBrowserContents = contents;
  fallbackEmbeddedBrowserContentsId = contents.id;
  contents.once("destroyed", () => {
    embeddedBrowserContentsById.delete(contents.id);
    if (activeEmbeddedBrowserContentsId === contents.id) activeEmbeddedBrowserContentsId = 0;
    if (embeddedBrowserContents === contents) {
      embeddedBrowserContents = null;
      fallbackEmbeddedBrowserContentsId = 0;
    }
  });
  contents.on("will-navigate", (event, url) => {
    if (!isSafeBrowserUrl(url).ok) event.preventDefault();
  });
  // 网页自己开的新窗口（target=_blank、window.open）：在面板里开一个新标签页，
  // 而不是像过去那样静默丢弃——用户点了没反应的链接就是这么来的。
  // 三种情况仍然拒绝：非 http/https、这个页面正被助手自动操作（新页面会把自动化
  // 打断成人工确认）、标签页已经到上限（防止页面刷出大量标签页）。
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      const automating = browserControlManager.getStatus().status === "running"
        && browserControlManager.session?.webContentsId === contents.id;
      if (
        (target.protocol === "http:" || target.protocol === "https:")
        && contents.id === activeEmbeddedBrowserContentsId
        && !automating
        && activeEmbeddedBrowserOwnerSessionId
        && browserPanelTabState.tabs.length < BROWSER_PANEL_TAB_LIMIT
      ) {
        sendBrowserPanelCommand(deps.mainWindow?.webContents, {
          action: "open",
          url: target.toString(),
          ownerSessionId: activeEmbeddedBrowserOwnerSessionId,
        });
      }
    } catch {
      // 非法地址照旧拒绝
    }
    return { action: "deny" };
  });
  // 键盘输入拦截屏障（补充要求 6）：助手自动操作期间，拦截落入网页的原生按键并触发用户接管
  contents.on("before-input-event", (event, input) => {
    if (
      browserControlManager.getStatus().status === "running" &&
      browserControlManager.session?.webContentsId === contents.id
    ) {
      if (input.type === "keyDown" && !input.isAutoRepeat) {
        event.preventDefault();
        browserControlManager.takeover({ reason: "检测到用户键盘按键，已由你接管" });
      }
      return;
    }
    // 网页拥有焦点时按键不会冒泡到主界面，统一转发应用面板快捷键。
    forwardNativePanelShortcut(event, input, process.platform,
      action => deps.mainWindow?.webContents.send("panel:shortcut", action));
  });
  // 下载进度跟踪：保存位置仍由 BrowserAgent 决定（工作区“下载”目录），
  // 这里只观察并广播给面板展示。持久分区所有 webview 共享，只挂一次。
  if (!(contents.session as any).__dyworkerDownloadTracker) {
    (contents.session as any).__dyworkerDownloadTracker = true;
    contents.session.on("will-download", (_event, item) => {
      const record = {
        id: `${item.getStartTime()}-${item.getFilename()}`,
        filename: item.getFilename() || "download",
        path: "",
        received: 0,
        total: item.getTotalBytes(),
        state: "progressing",
        startedAt: Date.now(),
      };
      const send = () => {
        if (deps.mainWindow && !deps.mainWindow.isDestroyed()) deps.mainWindow.webContents.send("browser:download-progress", record);
      };
      item.on("updated", (_e, state) => {
        record.received = item.getReceivedBytes();
        record.total = item.getTotalBytes();
        record.state = state === "interrupted" ? "interrupted" : "progressing";
        record.path = item.getSavePath() || "";
        send();
      });
      item.once("done", (_e, state) => {
        record.received = item.getTotalBytes();
        record.state = state === "completed" ? "completed" : state === "interrupted" ? "interrupted" : "cancelled";
        record.path = item.getSavePath() || "";
        send();
      });
      send();
    });
  }
});

// 当前显示的内置浏览器页面：优先渲染进程上报的激活 webview。
// forOwnerSessionId：调用方（某会话的任务）要求的归属；激活 webview 已上报归属
// 且归属他人时返回 null，防止 A 会话的后台任务拿到 B 会话正在看的页面（穿透）。
function activeEmbeddedBrowserContents({ forOwnerSessionId } = {} as any) {
  const contents = embeddedBrowserContentsById.get(activeEmbeddedBrowserContentsId)
    || embeddedBrowserContentsById.get(fallbackEmbeddedBrowserContentsId)
    || null;
  if (!contents || contents.isDestroyed?.()) return null;
  const owner = String(forOwnerSessionId || "");
  if (owner && activeEmbeddedBrowserOwnerSessionId && activeEmbeddedBrowserOwnerSessionId !== owner) {
    return null;
  }
  return contents;
}

// 面板里的浏览器标签页清单按会话隔离：只有上报者就是调用方会话时才可见，
// 用户切到别的会话后，后台任务看不到（也管不到）别人面板里的标签页。
function browserPanelTabsFor(ownerSessionId) {
  const owner = String(ownerSessionId || "");
  if (!owner || owner !== browserPanelTabState.ownerSessionId) return [];
  return browserPanelTabState.tabs;
}

// 面板状态由渲染进程持有，主进程只发指令；发完等它上报到位，不自己推断结果
async function waitForBrowserPanelState(predicate, { timeoutMs = BROWSER_PANEL_TIMEOUT_MS } = {} as any) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, BROWSER_PANEL_STEP_MS));
  }
}

function sendBrowserPanelCommand(renderer, payload) {
  if (!renderer || renderer.isDestroyed?.()) return false;
  try {
    renderer.send("browser:panel-request", payload);
    return true;
  } catch {
    return false;
  }
}

// 助手指定的标签页切换：切过去，并把它对应的 webview 交给调用方重新接管控制
function activateBrowserPanelTab(renderer, tabId, { ownerSessionId = "" } = {} as any) {
  const target = browserPanelTabsFor(ownerSessionId).find((tab) => tab.id === tabId);
  if (!target) return Promise.resolve({ ok: false, result: `找不到标签页 ${tabId}，请先用 browser__tabs list 查看当前标签页` });
  if (!sendBrowserPanelCommand(renderer, { action: "activate", tabId, ownerSessionId: String(ownerSessionId || "") })) {
    return Promise.resolve({ ok: false, result: "当前任务窗口不可用，无法切换标签页" });
  }
  return waitForBrowserPanelState(() => {
    const current = browserPanelTabsFor(ownerSessionId).find((tab) => tab.id === tabId);
    if (!current) return { closed: true };
    return current.active ? { tab: current } : null;
  }).then(async (shown) => {
    if (!shown) return { ok: false, result: "切换标签页超时" };
    if (shown.closed) return { ok: false, result: `标签页 ${tabId} 已关闭` };
    const { tab } = shown;
    // 空白标签页还没有 webview：切过去即可，等它打开网页后再接管
    if (!tab.webContentsId) return { ok: true, tab, contents: null };
    const contents = await waitForBrowserPanelState(() => {
      if (activeEmbeddedBrowserContentsId !== tab.webContentsId) return null;
      const candidate = embeddedBrowserContentsById.get(tab.webContentsId);
      return candidate && !candidate.isDestroyed?.() ? candidate : null;
    });
    if (!contents) return { ok: false, result: "切换标签页超时" };
    return { ok: true, tab, contents };
  });
}

// 助手指定的标签页关闭：关掉并等面板上报确认
function closeBrowserPanelTab(renderer, tabId, { ownerSessionId = "" } = {} as any) {
  const target = browserPanelTabsFor(ownerSessionId).find((tab) => tab.id === tabId);
  if (!target) return Promise.resolve({ ok: false, result: `找不到标签页 ${tabId}，请先用 browser__tabs list 查看当前标签页` });
  if (!sendBrowserPanelCommand(renderer, { action: "close-tab", tabId, ownerSessionId: String(ownerSessionId || "") })) {
    return Promise.resolve({ ok: false, result: "当前任务窗口不可用，无法关闭标签页" });
  }
  return waitForBrowserPanelState(() => !browserPanelTabsFor(ownerSessionId).some((tab) => tab.id === tabId))
    .then((closed) => (closed ? { ok: true } : { ok: false, result: "关闭标签页超时" }));
}

const browserControlManager = new BrowserControlManager({
  onStateChange: (state) => {
    try {
      if (deps.mainWindow && !deps.mainWindow.isDestroyed()) {
        deps.mainWindow.webContents.send("browser-control:state", state);
      }
    } catch {
      // 忽略主窗口销毁期间广播失败
    }
    // 电脑操控进行期间保守暂停人工计时，避免把自动输入算成人工
    deps.ctx.telemetryController?.setAutomationActive(
      state?.status === "running" || state?.status === "acquiring",
    );
  },
});

function waitForEmbeddedBrowser(sender, url, tabId, { validate, ownerSessionId = "" } = {} as any) {
  return new Promise<any>((resolve) => {
    const startedAt = Date.now();
    let previousUrl = "";
    try {
      const active = activeEmbeddedBrowserContents({ forOwnerSessionId: ownerSessionId });
      if (active && !active.isDestroyed?.()) {
        previousUrl = active.getURL?.() || "";
      }
    } catch {
      // 忽略已销毁对象取 URL 异常
    }
    let observedContents = null;
    let timer = null;
    let settled = false;

    // 打开请求可能携带取消凭据：预占被接管、停止、过期或被新请求接替后，
    // 旧请求严禁再发起导航或确认成功 (C2_expired_open_stays_revoked)
    const stillValid = () => (typeof validate === "function" ? validate() : true);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (observedContents) {
        try {
          observedContents.removeListener("did-stop-loading", onStop);
          observedContents.removeListener("did-fail-load", onFail);
          observedContents.removeListener("destroyed", onDestroyed);
        } catch {
          // 忽略
        }
      }
      resolve(result);
    };
    const onStop = () => {
      const contents = observedContents;
      if (!contents || contents.isDestroyed()) return;
      if (!stillValid()) {
        finish({ ok: false, result: "打开请求已过期或已被新任务接替，自动跳转已取消" });
        return;
      }
      let currentUrl = "";
      try {
        currentUrl = contents.getURL();
      } catch {
        return;
      }
      if (!currentUrl || currentUrl === "about:blank" || currentUrl === previousUrl) return;
      finish({ ok: true, contents });
    };
    const onFail = (_event, errorCode, errorDescription) => {
      finish({ ok: false, result: `网页加载失败：${errorDescription || errorCode}` });
    };
    const onDestroyed = () => {
      observedContents = null;
      poll();
    };
    const poll = () => {
      if (settled) return;
      if (!stillValid()) {
        finish({ ok: false, result: "打开请求已过期或已被新任务接替，自动跳转已取消" });
        return;
      }
      if (!sender || sender.isDestroyed()) {
        finish({ ok: false, result: "当前任务窗口已关闭" });
        return;
      }
      if (Date.now() - startedAt > 20000) {
        finish({ ok: false, result: "右侧浏览器面板加载超时" });
        return;
      }
      // 面板激活页已归属其他会话（用户切走了）：本会话的打开请求立即失败，
      // 不能把网页打在别的会话正在看的面板上，也不再空等 20 秒
      const owner = String(ownerSessionId || "");
      if (owner && activeEmbeddedBrowserOwnerSessionId && activeEmbeddedBrowserOwnerSessionId !== owner) {
        finish({ ok: false, result: "当前浏览器面板正显示其他会话的页面，已取消本次打开" });
        return;
      }
      const contents = activeEmbeddedBrowserContents({ forOwnerSessionId: owner });
      if (contents && !contents.isDestroyed()) {
        if (observedContents !== contents) {
          observedContents = contents;
          try {
            contents.once("did-stop-loading", onStop);
            contents.once("did-fail-load", onFail);
            contents.once("destroyed", onDestroyed);
          } catch {
            // 忽略
          }
        }
        let currentUrl = "";
        let loading = false;
        try {
          currentUrl = contents.getURL();
          loading = contents.isLoading();
        } catch {
          return;
        }
        if (currentUrl === url && !loading) {
          finish({ ok: true, contents });
          return;
        }
      }
      timer = setTimeout(poll, 50);
    };

    // 实际发起导航前最后一次核验取消凭据：已撤销的请求不得触发页面跳转 (C2)
    if (!stillValid()) {
      finish({ ok: false, result: "打开请求已过期或已被新任务接替，自动跳转已取消" });
      return;
    }

    try {
      sender.send("browser:panel-request", { action: "open", url, tabId, ownerSessionId: String(ownerSessionId || "") });
    } catch (error: any) {
      finish({ ok: false, result: `无法打开右侧浏览器面板：${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    poll();
  });
}

function requestCloseEmbeddedBrowser(sender, ownerSessionId = "") {
  try {
    if (!sender || sender.isDestroyed()) return;
    sender.send("browser:panel-request", { action: "close", ownerSessionId: String(ownerSessionId || "") });
  } catch {
    // 忽略
  }
}

// 渲染进程上报当前显示的内置浏览器 webview（及其所属激活会话）：
// agent 的 browser__* 工具只作用于可见页面
ipcMain.on("browser:active-contents", (event, webContentsId, ownerSessionId) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return;
  const id = Number(webContentsId) || 0;
  // 只接受登记过的 webview，防止渲染进程指向任意页面
  if (id && !embeddedBrowserContentsById.has(id)) return;
  const previousId = activeEmbeddedBrowserContentsId;
  activeEmbeddedBrowserContentsId = id;
  activeEmbeddedBrowserOwnerSessionId = id ? String(ownerSessionId || "") : "";

  // 若当前正在自动操作且显示的标签页被切走（换了页面，或页面还在但已归属
  // 其他会话），主动暂停控制，避免后台任务继续操作别的会话正在看的页面
  const runningOwner = browserControlManager.session?.ownerSessionId;
  const ownerChangedToOther = Boolean(
    activeEmbeddedBrowserOwnerSessionId &&
    runningOwner &&
    activeEmbeddedBrowserOwnerSessionId !== runningOwner
  );
  if (browserControlManager.getStatus().status === "running" && (ownerChangedToOther || (previousId && id !== previousId))) {
    browserControlManager.pause({ reason: "页面已切换，操作已暂停" });
  }
});

// 渲染进程上报面板里的浏览器标签页清单（助手 browser__tabs 工具的数据来源）。
// webview 只认登记表里的 id：渲染进程即使乱报 id，也指向不了别的页面。
ipcMain.on("browser:tab-state", (event, payload) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) return;
  const tabs = Array.isArray(payload?.tabs) ? payload.tabs : [];
  browserPanelTabState.ownerSessionId = String(payload?.ownerSessionId || "");
  browserPanelTabState.tabs = tabs
    .filter((tab) => tab && typeof tab.id === "string" && tab.id)
    .map((tab) => ({
      id: String(tab.id),
      title: String(tab.title || ""),
      url: String(tab.url || ""),
      active: Boolean(tab.active),
      webContentsId: embeddedBrowserContentsById.has(Number(tab.webContentsId))
        ? Number(tab.webContentsId)
        : 0,
    }));
});
  return { waitForEmbeddedBrowser, browserControlManager, requestCloseEmbeddedBrowser, activeEmbeddedBrowserContents, browserPanelTabsFor, activateBrowserPanelTab, closeBrowserPanelTab, embeddedBrowserContentsById };
}
