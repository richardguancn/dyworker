// 内置浏览器面板的标签页与工具操作（模块级 actions）。
//
// 整组函数原样从 App.tsx 搬出，只是把「读写 state 的裸标识符」改成经 store 的
// getState() 解构拿到，并把跨模块共享的 ref 换成 sharedRefs 里的模块级单例；
// 函数体、文案与行为均保持不变，供 App 的浏览器工具栏与 IPC 订阅运行时调用。
import { BROWSER_MOBILE_UA, browserPasswordFillScript, browserTabTitleOf, normalizeBrowserInput } from "../features/browser/browserUtils";
import type { BrowserWebviewElement } from "../features/browser/browserUtils";
import { copyImageToClipboard } from "../ImageAttachment";
import { useLayoutStore } from "./layoutStore";
import type { ToolPanelTab } from "./layoutStore";
import { useBrowserStore } from "./browserStore";
import { useSessionStore } from "./sessionStore";
import { useViewStore } from "./viewStore";
import { activeIdRef, activeToolPanelTabIdRef, browserWebviewRefCallbacks, browserWebviewsRef, closeToolPanelTabRef, toolPanelTabSequenceRef, toolPanelTabsRef } from "./sharedRefs";
import { openToolPanelTab, updateToolPanelTab } from "./toolPanelActions";

// 设备视图模拟：首个 webview 的默认 UA 留作关闭模拟时还原
let browserDefaultUserAgent = "";

// 当前活动标签页：与 App.tsx 里 activeToolPanelTab 的推导完全一致
const activeToolPanelTabOf = () => {
  const { toolPanelTabs, activeToolPanelTabId } = useLayoutStore.getState();
  return toolPanelTabs.find((tab) => tab.id === activeToolPanelTabId) || toolPanelTabs[0];
};

// ===== 内置浏览器：webview 生命周期 =====
// 每个浏览器标签页常驻一个 webview，切换标签不销毁页面；导航/标题/图标/加载状态
// 通过 webview 事件同步到标签页状态（对照 Codex 浏览器）。当前显示的 webview 上报给
// 主进程，让助手的 browser__* 工具只作用于用户可见的页面。

// 浏览器标签页可以多开（对照真实浏览器）。开新页时的复用规则，按优先级：
// 1. 网址已经在某个标签页里打开：切到那个标签页，不重复开同一页；
// 2. 助手打开网页时还有没打开过网页的空标签页（起始页）：先用它，不堆叠空标签页；
// 3. 其余情况新开一个标签页。用户按 ⌘T / 点 + 属于这一类：每次都新开一个
//    （和真实浏览器一致），只有助手的打开才复用空白页。
// 助手打开网页同样走这里：旧页面留在自己的标签页里，不会被新网址顶掉。
export const openBrowserTab = (initialUrl?: string, options: { reuseBlank?: boolean } = {}) => {
  const { setRightPanelOpen, setActiveToolPanelTabId, setToolPanelMenuOpen, setToolPanelTabs } = useLayoutStore.getState();
  const target = String(initialUrl || "").trim();
  const browserTabs = toolPanelTabsRef.current.filter((tab) => tab.kind === "browser");
  if (target) {
    const sameUrl = browserTabs.find((tab) => (tab.loadedUrl || tab.url || "") === target);
    if (sameUrl) {
      setRightPanelOpen(true);
      setActiveToolPanelTabId(sameUrl.id);
      setToolPanelMenuOpen(false);
      return sameUrl.id;
    }
  }
  const reuseBlank = options.reuseBlank === true;
  const blank = reuseBlank ? browserTabs.find((tab) => !tab.loadedUrl) : undefined;
  const id = blank?.id || `browser-${toolPanelTabSequenceRef.current++}`;
  setToolPanelTabs((current) => {
    if (blank && !target) {
      // 空标签页任务栏复用：保持原样，只切过去
      return current;
    }
    if (blank) {
      return current.map((tab) => tab.id === blank.id
        ? { ...tab, url: target, loadedUrl: target, title: browserTabTitleOf(target), loadError: "", favicon: "" }
        : tab);
    }
    const created: ToolPanelTab = target
      ? { id, kind: "browser", title: browserTabTitleOf(target), url: target, loadedUrl: target }
      : { id, kind: "browser", title: "新标签页", url: "" };
    return [...current, created];
  });
  setRightPanelOpen(true);
  setActiveToolPanelTabId(id);
  setToolPanelMenuOpen(false);
  return id;
};

// 助手指定的标签页切换：切到指定标签页（由主进程等待渲染端上报后接管控制）
export const activateBrowserTabById = (tabId: string) => {
  const { setRightPanelOpen, setActiveToolPanelTabId, setToolPanelMenuOpen } = useLayoutStore.getState();
  const tab = toolPanelTabsRef.current.find((item) => item.id === tabId && item.kind === "browser");
  if (!tab) return false;
  setRightPanelOpen(true);
  setActiveToolPanelTabId(tab.id);
  setToolPanelMenuOpen(false);
  return true;
};

// 助手指定的标签页关闭：复用关闭按钮那套（最后一个标签页关掉就回到菜单页）
export const closeBrowserTabById = (tabId: string) => {
  const closing = toolPanelTabsRef.current.find((item) => item.id === tabId && item.kind === "browser");
  if (!closing) return false;
  closeToolPanelTabRef.current?.(tabId);
  return true;
};

// 面板里的浏览器标签页清单上报主进程：助手的标签页工具据此列出、切换、关闭
export const reportBrowserTabState = () => {
  if (!window.dyworker?.reportBrowserTabs) return;
  const tabs = toolPanelTabsRef.current.filter((tab) => tab.kind === "browser").map((tab) => {
    let webContentsId = 0;
    try {
      webContentsId = browserWebviewsRef.current.get(tab.id)?.getWebContentsId?.() || 0;
    } catch {
      webContentsId = 0;
    }
    return {
      id: tab.id,
      title: tab.title || "",
      url: tab.loadedUrl || tab.url || "",
      active: tab.id === activeToolPanelTabIdRef.current,
      webContentsId,
    };
  });
  window.dyworker.reportBrowserTabs({ ownerSessionId: activeIdRef.current, tabs });
};

export const patchBrowserTab = (tabId: string, patch: Partial<ToolPanelTab>) => {
  const { setToolPanelTabs } = useLayoutStore.getState();
  setToolPanelTabs((current) => current.map((tab) => tab.id === tabId ? { ...tab, ...patch } : tab));
};

export const readWebviewNavState = (webview: BrowserWebviewElement) => ({
  url: webview.getURL?.() || "",
  canGoBack: webview.canGoBack?.() ?? false,
  canGoForward: webview.canGoForward?.() ?? false,
});

// 主进程路由 agent 浏览器工具的目标：当前激活标签页的 webview
export const reportActiveBrowserContents = () => {
  reportBrowserTabState();
  const webview = browserWebviewsRef.current.get(activeToolPanelTabIdRef.current);
  try {
    const id = webview?.getWebContentsId?.();
    if (id) window.dyworker?.setActiveBrowserContents?.(id, activeIdRef.current);
  } catch {
    // webview 尚未 attach：did-attach 后会再报一次
  }
};

// 首次访问站点时注入暂存的 localStorage（每个 URL 只注入一次，注入后刷新生效）；
// 同时探测该站点是否有已保存的密码，用于显示填充提示
export const prepareGuestPage = (webview: BrowserWebviewElement, tabId: string) => {
  const handledUrls = new Set<string>();
  webview.addEventListener("dom-ready", () => {
    const url = webview.getURL?.() || "";
    if (!/^https?:\/\//i.test(url) || handledUrls.has(url)) return;
    handledUrls.add(url);
    let origin = "";
    try {
      origin = new URL(url).origin;
    } catch {
      return;
    }
    void (async () => {
      try {
        const entries = await window.dyworker?.getImportedLocalStorage?.(origin);
        if (entries) {
          await webview.executeJavaScript?.(
            `(() => { const data = ${JSON.stringify(entries)}; for (const [k, v] of Object.entries(data)) { try { localStorage.setItem(k, v); } catch { /* 单键失败不阻塞其余 */ } } })()`,
          );
          await window.dyworker?.markImportedLocalStorageDone?.(origin);
          webview.reload?.();
        }
      } catch {
        // 注入失败：保留暂存数据，下次访问该站点时重试
      }
      try {
        const stored = await window.dyworker?.listPasswords?.(origin);
        patchBrowserTab(tabId, { fillHint: stored?.passwords?.length || undefined });
      } catch {
        // 探测失败不影响页面
      }
    })();
  });
};

// 绑定单个 webview 的事件（ref 回调里调用；监听器随元素销毁，无需手动解绑）
export const bindBrowserWebview = (tabId: string, webview: BrowserWebviewElement) => {
  const { setBrowserSessionHistory, setBrowserFind, setBrowserPasswordPrompt } = useBrowserStore.getState();
  const navSync = () => patchBrowserTab(tabId, readWebviewNavState(webview));
  const rememberInHistory = () => {
    const url = webview.getURL?.() || "";
    if (!/^https?:\/\//i.test(url)) return;
    setBrowserSessionHistory((current) => {
      if (current[0]?.url === url) return current;
      const host = url.replace(/^https?:\/\//i, "").split("/")[0] || url;
      return [{ url, title: host, at: Date.now() }, ...current].slice(0, 100);
    });
  };
  webview.addEventListener("did-start-loading", () => patchBrowserTab(tabId, { loading: true, loadError: "" }));
  webview.addEventListener("did-stop-loading", () => patchBrowserTab(tabId, { loading: false, ...readWebviewNavState(webview) }));
  webview.addEventListener("did-navigate", () => { navSync(); rememberInHistory(); });
  webview.addEventListener("did-navigate-in-page", () => { navSync(); rememberInHistory(); });
  webview.addEventListener("page-title-updated", ((event: Event & { title: string }) => {
    const title = event.title || "";
    if (!title) return;
    patchBrowserTab(tabId, { title });
    const url = webview.getURL?.() || "";
    setBrowserSessionHistory((current) => current.map((entry, index) => index === 0 && entry.url === url ? { ...entry, title } : entry));
  }) as EventListener);
  webview.addEventListener("page-favicon-updated", ((event: Event & { favicons: string[] }) => {
    patchBrowserTab(tabId, { favicon: event.favicons?.[event.favicons.length - 1] || "" });
  }) as EventListener);
  webview.addEventListener("did-fail-load", ((event: Event & { errorCode: number; errorDescription: string; isMainFrame: boolean }) => {
    // ERR_ABORTED 是导航被打断（如重定向、手动停止），不算失败；子框架失败不影响整页
    if (event.errorCode === -3 || !event.isMainFrame) return;
    patchBrowserTab(tabId, {
      loading: false,
      loadError: `网页加载失败（${event.errorDescription || event.errorCode}）`,
    });
  }) as EventListener);
  webview.addEventListener("found-in-page", ((event: Event & { matches: number; activeMatchOrdinal: number }) => {
    setBrowserFind((current) => current && current.tabId === tabId
      ? { ...current, matches: event.matches ?? 0, active: event.activeMatchOrdinal ?? 0 }
      : current);
  }) as EventListener);
  webview.addEventListener("did-attach", () => {
    const zoom = toolPanelTabsRef.current.find((tab) => tab.id === tabId)?.zoom ?? 0;
    if (zoom) webview.setZoomLevel?.(zoom);
    if (tabId === activeToolPanelTabIdRef.current) reportActiveBrowserContents();
  });
  // 客页面报告的登录表单提交（webview-preload.cjs 经 sendToHost 发来）：弹出保存密码提示
  webview.addEventListener("ipc-message", ((event: Event & { channel: string; args: unknown[] }) => {
    if (event.channel !== "dyworker:password-submit") return;
    const payload = event.args?.[0] as { origin?: string; username?: string; password?: string } | undefined;
    if (!payload?.password) return;
    // origin 由客页面自行上报、可被恶意站点伪造：一律以 webview 当前实际 URL 的 origin 为准
    let actualOrigin = "";
    try {
      actualOrigin = new URL(webview.getURL?.() || "").origin;
    } catch {
      return;
    }
    if (!/^https?:\/\//i.test(actualOrigin)) return;
    setBrowserPasswordPrompt({ tabId, origin: actualOrigin, username: payload.username || "", password: payload.password });
  }) as EventListener);
  prepareGuestPage(webview, tabId);
};

// ref 回调按 tabId 缓存稳定身份，避免每次渲染触发挥挂/卸载
export const browserWebviewRefFor = (tabId: string) => {
  let callback = browserWebviewRefCallbacks.current.get(tabId);
  if (!callback) {
    callback = (node: BrowserWebviewElement | null) => {
      const previous = browserWebviewsRef.current.get(tabId);
      if (previous === node) return;
      if (node) {
        browserWebviewsRef.current.set(tabId, node);
        bindBrowserWebview(tabId, node);
      } else {
        browserWebviewsRef.current.delete(tabId);
        if (activeToolPanelTabIdRef.current === tabId) window.dyworker?.setActiveBrowserContents?.(0, activeIdRef.current);
      }
    };
    browserWebviewRefCallbacks.current.set(tabId, callback);
  }
  return callback;
};

export const openBrowserUrl = async (rawOverride?: string) => {
  const { browserUrlDraft, setBrowserUrlDraft, setBrowserOpening, setBrowserSuggestionsOpen } = useBrowserStore.getState();
  const { workspacePath } = useSessionStore.getState();
  const { setError, setNotice } = useViewStore.getState();
  const activeToolPanelTab = activeToolPanelTabOf();
  const activeBrowserUrl = activeToolPanelTab?.kind === "browser" ? activeToolPanelTab.url || "" : "";
  setBrowserSuggestionsOpen(false);
  const tab = activeToolPanelTab?.kind === "browser" ? activeToolPanelTab : undefined;
  const draft = tab && browserUrlDraft?.tabId === tab.id ? browserUrlDraft.value : "";
  const raw = (rawOverride ?? draft ?? activeBrowserUrl).trim();
  if (!tab) {
    openToolPanelTab("browser", true, rawOverride);
    return;
  }
  if (!raw) {
    setError("请输入网址");
    return;
  }
  const url = normalizeBrowserInput(raw);
  setBrowserUrlDraft(null);
  updateToolPanelTab(tab.id, { url, loadError: "" });
  setError("");
  setBrowserOpening(true);
  try {
    if (!window.dyworker?.openBrowser) {
      setNotice("当前预览环境没有连接浏览器窗口");
      return;
    }
    const result = await window.dyworker.openBrowser({ url, workspacePath });
    if (!result.ok) {
      setError(result.error || result.result || "网页打开失败");
      return;
    }
    const loadedUrl = result.url || url;
    const webview = browserWebviewsRef.current.get(tab.id);
    // 地址未变化时 src 属性不变、不会触发导航，手动刷新一次
    if (webview?.getURL?.() === loadedUrl) webview.reload?.();
    updateToolPanelTab(tab.id, {
      url: loadedUrl,
      loadedUrl,
      title: loadedUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "新标签页",
    });
  } catch (browserError) {
    setError(`网页打开失败：${browserError instanceof Error ? browserError.message : String(browserError)}`);
  } finally {
    setBrowserOpening(false);
  }
};

export const activeBrowserWebview = () => {
  const { activeToolPanelTabId } = useLayoutStore.getState();
  return browserWebviewsRef.current.get(activeToolPanelTabId);
};

// ===== 页内查找 =====
export const openBrowserFind = () => {
  const { activeToolPanelTabId } = useLayoutStore.getState();
  const { browserFind, setBrowserFind } = useBrowserStore.getState();
  const activeToolPanelTab = activeToolPanelTabOf();
  const activeToolPanelKind = activeToolPanelTab?.kind || "browser";
  if (activeToolPanelKind !== "browser" || !activeToolPanelTab?.loadedUrl) return;
  setBrowserFind({ tabId: activeToolPanelTabId, text: browserFind?.tabId === activeToolPanelTabId ? browserFind.text : "", matches: 0, active: 0 });
};
export const runBrowserFind = (forward: boolean, findNext: boolean) => {
  const { browserFind } = useBrowserStore.getState();
  const webview = activeBrowserWebview();
  const text = browserFind?.text ?? "";
  if (!webview?.findInPage || !text) return;
  void webview.findInPage(text, { forward, findNext });
};
export const closeBrowserFind = () => {
  const { browserFind, setBrowserFind } = useBrowserStore.getState();
  if (browserFind?.tabId) browserWebviewsRef.current.get(browserFind.tabId)?.stopFindInPage?.("clearSelection");
  setBrowserFind(null);
};

// ===== 缩放（1.2 的幂次，与 Chromium 缩放步进一致）=====
export const browserZoomPercent = (tab: ToolPanelTab | undefined) => Math.round(100 * 1.2 ** (tab?.zoom ?? 0));
export const changeBrowserZoom = (delta: number) => {
  const tab = activeToolPanelTabOf();
  if (!tab || tab.kind !== "browser") return;
  const level = Math.min(8, Math.max(-5, (tab.zoom ?? 0) + delta));
  updateToolPanelTab(tab.id, { zoom: level });
  activeBrowserWebview()?.setZoomLevel?.(level);
};
export const resetBrowserZoom = () => {
  const tab = activeToolPanelTabOf();
  if (!tab || tab.kind !== "browser") return;
  updateToolPanelTab(tab.id, { zoom: 0 });
  activeBrowserWebview()?.setZoomLevel?.(0);
};

// ===== 截图到剪贴板 =====
export const captureBrowserScreenshot = async () => {
  const { setNotice } = useViewStore.getState();
  const webview = activeBrowserWebview();
  if (!webview?.capturePage) {
    setNotice("当前页面还不支持截取");
    return;
  }
  try {
    const image = await webview.capturePage();
    await copyImageToClipboard({ ok: true, dataUrl: image.toDataURL() });
    setNotice("已截取页面并复制到剪贴板");
  } catch (captureError) {
    setNotice(`截图失败：${captureError instanceof Error ? captureError.message : String(captureError)}`);
  }
};

// ===== 在系统默认浏览器打开 =====
export const openBrowserExternal = async () => {
  const { setNotice } = useViewStore.getState();
  const activeToolPanelTab = activeToolPanelTabOf();
  const url = activeToolPanelTab?.url;
  if (!url || !window.dyworker?.openBrowserExternal) {
    if (url) setNotice("当前预览环境无法调用系统浏览器");
    return;
  }
  const result = await window.dyworker.openBrowserExternal(url);
  if (!result?.ok) setNotice(result?.error || "系统浏览器打开失败");
};

export const clearBrowserSessionHistory = () => {
  const { setBrowserSessionHistory } = useBrowserStore.getState();
  if (window.confirm("确定清空本次浏览历史吗？清空后无法恢复，已导入的历史记录不受影响。")) setBrowserSessionHistory([]);
};

// ===== 密码：保存提示 / 填充 =====
export const dismissBrowserPasswordPrompt = () => {
  const { setBrowserPasswordPrompt } = useBrowserStore.getState();
  return setBrowserPasswordPrompt(null);
};
export const saveBrowserPasswordPrompt = async () => {
  const { browserPasswordPrompt } = useBrowserStore.getState();
  const { setNotice } = useViewStore.getState();
  const prompt = browserPasswordPrompt;
  if (!prompt) return;
  dismissBrowserPasswordPrompt();
  if (!window.dyworker?.savePassword) {
    setNotice("当前预览环境无法保存密码");
    return;
  }
  const result = await window.dyworker.savePassword(prompt.origin, prompt.username, prompt.password);
  setNotice(result.ok ? "密码已保存，下次登录时可一键填充" : (result.error || "保存失败"));
};
export const fillSavedPassword = async () => {
  const { setNotice } = useViewStore.getState();
  const activeToolPanelTab = activeToolPanelTabOf();
  const tab = activeToolPanelTab;
  const webview = activeBrowserWebview();
  if (!tab || !webview?.executeJavaScript) return;
  let origin = "";
  try {
    origin = new URL(webview.getURL?.() || "").origin;
  } catch {
    return;
  }
  const stored = await window.dyworker?.listPasswords?.(origin);
  const entry = stored?.passwords?.[0];
  if (!entry) return;
  const revealed = await window.dyworker?.revealPassword?.(entry.origin, entry.username);
  if (!revealed?.ok || !revealed.password) {
    setNotice(revealed?.error || "无法读取已保存的密码");
    return;
  }
  try {
    const result = await webview.executeJavaScript(browserPasswordFillScript(entry.username, revealed.password), true);
    setNotice(typeof result === "string" ? result : "已填充密码");
  } catch (fillError) {
    setNotice(`填充失败：${fillError instanceof Error ? fillError.message : String(fillError)}`);
  }
};

// ===== 打印 =====
export const printBrowserPage = () => activeBrowserWebview()?.print?.();

// ===== 设备视图（手机/平板模拟）=====
export const applyBrowserDevice = async (tab: ToolPanelTab, device: { name: string; width: number; height: number } | null) => {
  const webview = browserWebviewsRef.current.get(tab.id);
  updateToolPanelTab(tab.id, { device: device ? { ...device } : undefined });
  if (!webview) return;
  try {
    if (!browserDefaultUserAgent && webview.getUserAgent) browserDefaultUserAgent = webview.getUserAgent();
    if (device && webview.setUserAgent) webview.setUserAgent(BROWSER_MOBILE_UA);
    else if (!device && browserDefaultUserAgent && webview.setUserAgent) webview.setUserAgent(browserDefaultUserAgent);
    await window.dyworker?.emulateDevice?.(webview.getWebContentsId?.() || 0, device ? device.width : 0, device ? device.height : 0);
  } catch {
    // 模拟失败时仅保留容器尺寸，页面照常显示
  }
};
export const rotateBrowserDevice = () => {
  const tab = activeToolPanelTabOf();
  if (!tab?.device) return;
  void applyBrowserDevice(tab, { ...tab.device, width: tab.device.height, height: tab.device.width });
};

// ===== 清除浏览数据 =====
export const clearBrowserData = async () => {
  const { browserClearing, browserClearKinds, setBrowserClearing, setBrowserSection } = useBrowserStore.getState();
  const { setNotice } = useViewStore.getState();
  if (browserClearing || !Object.values(browserClearKinds).some(Boolean)) return;
  const selected = [browserClearKinds.cookies && "Cookie 和登录状态", browserClearKinds.cache && "缓存的图片和文件", browserClearKinds.siteData && "站点数据和网站设置"].filter(Boolean).join("、");
  if (!window.confirm(`确定清除${selected}吗？此操作无法撤销。${browserClearKinds.cookies || browserClearKinds.siteData ? "部分网站可能需要重新登录。" : ""}`)) return;
  if (!window.dyworker?.clearBrowserData) {
    setNotice("当前预览环境无法清除浏览数据");
    return;
  }
  setBrowserClearing(true);
  try {
  const result = await window.dyworker.clearBrowserData(browserClearKinds);
  if (!result.ok) {
    setNotice(result.error || "清除失败");
    return;
  }
  for (const webview of browserWebviewsRef.current.values()) webview.reload?.();
  setNotice("已清除所选的浏览数据");
  setBrowserSection(null);
  } catch { setNotice("清除失败，请重试"); } finally { setBrowserClearing(false); }
};
