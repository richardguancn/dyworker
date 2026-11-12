import { randomUUID } from 'node:crypto';
import { isSafeBrowserUrl } from '../agent/web-tools.mts';
import { BrowserAgent } from '../browser.mts';
import { cookieMatchesHost, toCookieSetDetails } from '../browser-import.mts';
import { markBackgroundWindow, unmarkBackgroundWindow } from './window-lifecycle.mts';

async function withDeadline(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}

// 每个任务持有独立的临时浏览器分区和窗口；不接触面板中的页面。
// 默认空白登录状态；按需只读复制指定浏览器环境中目标站点的登录数据到临时分区。
export class BackgroundBrowserSurface {
  createWindow;
  partition;
  tabs = new Map<string, any>();
  activeId = '';
  disposed = false;
  notices: string[] = [];
  setupTimeoutMs;
  showTimeoutMs;
  guardedSession = null;
  downloadGuard = null;
  cleanupPromise = null;
  allowDownload = (_contents) => false;
  onHumanWindowClosed = null;
  onHumanFileChooser = null;
  loadSiteSession = null;
  seededSites = new Set<string>();
  seedBindings: Array<{ host: string; source: string; domains: string[] }> = [];

  constructor({ createWindow, ownerSessionId, runId, setupTimeoutMs = 10000, showTimeoutMs = 3000, loadSiteSession = null } = {} as any) {
    if (!ownerSessionId || !runId || typeof createWindow !== 'function') throw new Error('后台浏览器需要明确的任务身份');
    this.createWindow = createWindow;
    this.setupTimeoutMs = setupTimeoutMs;
    this.showTimeoutMs = showTimeoutMs;
    this.loadSiteSession = loadSiteSession;
    this.partition = `dyworker-task-${randomUUID()}`;
  }

  notice(text: string) {
    if (!this.notices.includes(text) && this.notices.length < 20) this.notices.push(text);
  }

  takeNotices() {
    return this.notices.splice(0);
  }

  async createTab(id: string) {
    if (this.disposed || this.tabs.size >= 8) throw new Error(this.disposed ? '后台浏览器已关闭' : '后台浏览器标签页已达到上限');
    const win = this.createWindow({ show: false, focusable: false, skipTaskbar: true, opacity: 0, width: 1200, height: 900,
      webPreferences: { partition: this.partition, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    markBackgroundWindow(win);
    const contents = win.webContents;
    const record = { id, win, contents, closing: false, humanVisible: false, pendingFileChooser: null };
    this.tabs.set(id, record);
    const failClosed = () => {
      if (record.closing || this.disposed) return;
      this.notice('后台页面的保护通道已断开，页面已关闭。');
      this.closeTab(id);
    };
    try {
      if (typeof win.getOpacity !== 'function' || win.getOpacity() !== 0 || typeof win.isFocusable !== 'function' || win.isFocusable() || typeof win.setIgnoreMouseEvents !== 'function') {
        throw new Error('当前系统无法确认后台窗口透明且不可聚焦，或无法隔离鼠标输入');
      }
      win.setIgnoreMouseEvents(true);
      win.on('show', () => {
        if (record.closing || this.disposed || record.humanVisible) return;
        win.hide();
        this.notice('后台窗口意外显示，已停止该页面。');
        failClosed();
      });
      win.on('closed', () => {
        if (record.closing || this.disposed) return;
        record.closing = true;
        this.tabs.delete(id);
        if (this.activeId === id) this.activeId = '';
        if (record.humanVisible) this.onHumanWindowClosed?.(id);
      });
      contents.session.setPermissionCheckHandler(() => false);
      contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      if (!this.guardedSession) {
        this.guardedSession = contents.session;
        this.downloadGuard = (event, _item, source) => {
          const active = this.tabs.get(this.activeId);
          if (!active || active.closing || source?.id !== active.contents.id || !this.allowDownload(source)) {
            event.preventDefault();
            this.notice('后台页面尝试自动下载，因当前页面尚未受控而被取消。');
          }
        };
        this.guardedSession.on('will-download', this.downloadGuard);
      } else if (this.guardedSession !== contents.session) throw new Error('后台页面会话不一致');
      const guardNavigation = (event) => {
        if (isSafeBrowserUrl(event.url).ok) return;
        // Embedded documents may use browser-internal URLs without leaving the page.
        if (!event.isMainFrame && /^(about:(blank|srcdoc)(?:[?#]|$)|blob:|data:)/i.test(event.url)) return;
        event.preventDefault();
        this.notice('后台页面尝试打开不受支持的地址，已拦截。');
      };
      contents.on('will-frame-navigate', guardNavigation);
      contents.on('will-redirect', guardNavigation);
      contents.on('will-attach-webview', event => event.preventDefault());
      contents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
        if (isMainFrame && record.pendingFileChooser) { record.pendingFileChooser = null; this.onHumanFileChooser?.(false); }
      });
      contents.on('login', (event, _details, _authInfo, callback) => {
        event.preventDefault();
        this.notice('后台页面需要身份验证，已取消系统登录窗口。');
        callback();
      });
      contents.on('select-client-certificate', (event, _url, _certificates, callback) => {
        event.preventDefault();
        this.notice('后台页面请求客户端证书，已取消系统证书选择窗口。');
        callback(null);
      });
      contents.setWindowOpenHandler(details => {
        const target = isSafeBrowserUrl(details?.url);
        if (target.ok && target.url.href.length <= 4096) {
          this.notice(`后台页面请求打开新窗口，已拦截。可用 browser__tabs 的 open 打开此网址：${target.url.href}\n新页面不会保留原窗口之间的脚本关联，需检查网站是否正常工作。`);
        } else {
          this.notice('后台页面请求打开新窗口，已拦截；目标网址为空、不受支持或过长，无法直接打开。');
        }
        return { action: 'deny' };
      });
      await withDeadline((async () => {
        // 空白页面不执行外部内容；先让渲染进程就绪，再建立拦截通道。
        await contents.loadURL('about:blank');
        if (this.disposed || record.closing || contents.isDestroyed()) throw new Error('后台页面已关闭');
        contents.debugger.attach('1.3');
        contents.debugger.on('detach', failClosed);
        const marker = `dyworker-dialog-${randomUUID()}`;
        const script = `(() => {
          const notify = console.debug.bind(console);
          for (const [name, result] of [['alert', undefined], ['confirm', false], ['prompt', null], ['print', undefined], ['focus', undefined]]) {
            try {
              const current = Object.getOwnPropertyDescriptor(window, name);
              if (current && !current.configurable && current.value?.__dyworkerGuard) continue;
              const replacement = () => { notify(${JSON.stringify(marker)}, 'blocked'); return result; };
              Object.defineProperty(replacement, '__dyworkerGuard', { value: true });
              Object.defineProperty(window, name, { configurable: false, writable: false, value: replacement });
            } catch { notify(${JSON.stringify(marker)}, 'guard-failed'); }
          }
          for (const name of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) {
            if (typeof window[name] !== 'function') continue;
            try {
              const current = Object.getOwnPropertyDescriptor(window, name);
              if (current && !current.configurable && current.value?.__dyworkerGuard) continue;
              const replacement = () => { notify(${JSON.stringify(marker)}, 'blocked'); return Promise.reject(new DOMException('已取消', 'AbortError')); };
              Object.defineProperty(replacement, '__dyworkerGuard', { value: true });
              Object.defineProperty(window, name, { configurable: false, writable: false, value: replacement });
            } catch { notify(${JSON.stringify(marker)}, 'guard-failed'); }
          }
        })();`;
        const configureFrame = async sessionId => {
          await contents.debugger.sendCommand('Page.enable', {}, sessionId);
          await contents.debugger.sendCommand('Runtime.enable', {}, sessionId);
          await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: script, runImmediately: true }, sessionId);
          await contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true }, sessionId);
          await contents.debugger.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
        };
        contents.debugger.on('message', (_event, method, params, sessionId) => {
          if (method === 'Target.attachedToTarget' && params?.sessionId) {
            void (async () => {
              if (params.targetInfo?.type === 'iframe') await configureFrame(params.sessionId);
              await contents.debugger.sendCommand('Runtime.runIfWaitingForDebugger', {}, params.sessionId);
            })().catch(failClosed);
            return;
          }
          if (method === 'Runtime.consoleAPICalled' && params?.args?.[0]?.value === marker) {
            if (params?.args?.[1]?.value === 'guard-failed') { this.notice('后台页面保护初始化失败，页面已关闭。'); failClosed(); return; }
            this.notice('后台页面尝试打开对话框或系统窗口，已拦截；请检查页面状态后再继续。');
          } else if (method === 'Page.javascriptDialogOpening') {
            this.notice('后台页面弹出了对话框，已取消；请检查页面状态后再继续。');
            void contents.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: false }, sessionId || undefined).catch(failClosed);
          } else if (method === 'Page.fileChooserOpened') {
            if (record.humanVisible && params?.backendNodeId) {
              record.pendingFileChooser = { backendNodeId: params.backendNodeId, sessionId: sessionId || undefined, mode: params.mode };
              this.onHumanFileChooser?.(true);
              return;
            }
            this.notice('后台页面尝试打开系统文件选择窗口，已拦截；请使用上传操作选择已授权文件。');
            if (params?.backendNodeId) void this.notifyFileChooserCancelled(record, { backendNodeId: params.backendNodeId, sessionId: sessionId || undefined }).catch(failClosed);
          }
        });
        await configureFrame(undefined);
      })(), this.setupTimeoutMs, '后台页面保护通道启动超时');
      if (this.disposed || record.closing || contents.isDestroyed()) throw new Error('后台页面已关闭');
      return record;
    } catch (error) {
      this.closeTab(id);
      throw error;
    }
  }

  // 只把目标站点的 Cookie 与同源 localStorage 写入本任务临时分区；原浏览器数据只读，分区随任务销毁。
  async seedSiteSession(record, url: URL, sessionSource: string, profileId: string, validate = () => true) {
    const source = String(sessionSource || '').trim();
    if (!source || source === 'isolated') return { ok: true, scriptId: '' };
    if (typeof this.loadSiteSession !== 'function') return { ok: false, result: '当前入口不支持复用浏览器登录状态。' };
    const key = `${source}\n${profileId || ''}\n${url.origin}`;
    if (this.seededSites.has(key)) return { ok: true, scriptId: '' };
    const loaded = await withDeadline(this.loadSiteSession({ url: url.href, source, profileId }), 60000, '读取浏览器登录状态超时');
    if (!loaded?.ok) return { ok: false, result: `无法复用登录状态：${loaded?.error || '未知错误'}` };
    if (!validate()) return { ok: false, result: '打开请求已取消' };
    const identity = String(loaded.sourceIdentity || JSON.stringify([source, profileId || '']));
    const host = url.hostname.toLowerCase();
    const candidates = (loaded.cookies || []).filter(cookie => toCookieSetDetails(cookie) && cookieMatchesHost(cookie.host || cookie.domain, host, cookie.hostOnly));
    const domains = candidates.map(cookie => {
      const domain = String(cookie.host || cookie.domain || '').toLowerCase();
      return cookie.hostOnly === true ? domain.replace(/^\./, '') : cookie.hostOnly === false && !domain.startsWith('.') ? `.${domain}` : domain;
    });
    const applies = (domain, name) => domain.startsWith('.') ? cookieMatchesHost(domain, name) : domain === name;
    const conflict = this.seedBindings.some(binding => binding.source !== identity && (binding.host === host
      || binding.domains.some(domain => applies(domain, host)) || domains.some(domain => applies(domain, binding.host))));
    if (conflict) return { ok: false, result: '此网站或关联网站已使用其他浏览器的登录状态。请新建任务后再使用另一登录来源，以免混用账号。' };
    this.seedBindings.push({ host, source: identity, domains });
    let written = 0;
    for (const cookie of candidates) {
      if (!validate()) return { ok: false, result: '打开请求已取消' };
      const details = toCookieSetDetails(cookie);
      try { await record.contents.session.cookies.set(details); written += 1; } catch { /* 单条不合法时跳过 */ }
    }
    if (!validate()) return { ok: false, result: '打开请求已取消' };
    const entries = loaded.localStorage?.[url.origin];
    let scriptId = '';
    const keyCount = entries && typeof entries === 'object' ? Object.keys(entries).length : 0;
    if (keyCount) {
      const script = `(() => { if (location.origin !== ${JSON.stringify(url.origin)}) return;
        const entries = ${JSON.stringify(entries)};
        for (const key of Object.keys(entries)) { try { if (localStorage.getItem(key) === null) localStorage.setItem(key, entries[key]); } catch {} } })();`;
      try {
        const added = await record.contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: script });
        scriptId = added?.identifier || '';
        if (!scriptId) throw new Error('无法确认临时登录数据脚本已登记');
      } catch (error) {
        // 无法确认是否已安装脚本时，不能继续复用该页面。
        this.closeTab(record.id);
        throw error;
      }
    }
    const warnings = (loaded.warnings || []).length ? `（${loaded.warnings.join('；')}）` : '';
    const notice = written || keyCount
      ? `已从${loaded.sourceLabel || source}只读载入 ${url.hostname} 的 ${written} 条 Cookie${keyCount ? `、${keyCount} 项本地存储` : ''}，仅存在于本任务临时浏览器中${warnings}。`
      : `${loaded.sourceLabel || source}中没有 ${url.hostname} 的登录数据，本页仍为未登录状态${warnings}。`;
    return { ok: true, scriptId, siteKey: key, notice };
  }

  async open(url: string, rawTabId = '', { validate, timeoutMs = 20000, sessionSource = '', profileId = '' } = {} as any) {
    const check = isSafeBrowserUrl(url);
    if (!check.ok) return { ok: false, result: check.error };
    if (this.disposed) return { ok: false, result: '后台浏览器已关闭' };
    const valid = () => !this.disposed && (typeof validate !== 'function' || validate());
    if (!valid()) return { ok: false, result: '打开请求已取消' };
    const requested = String(rawTabId || '').trim();
    if (requested && !this.tabs.has(requested)) return { ok: false, result: `找不到后台标签页 ${requested}` };
    const id = requested || `background-${randomUUID()}`;
    let record = this.tabs.get(id);
    const created = !record;
    try {
      if (!record) record = await this.createTab(id);
      if (!valid()) { if (created) this.closeTab(id); return { ok: false, result: '打开请求已取消' }; }
      const seeded = await this.seedSiteSession(record, check.url, sessionSource, profileId, valid);
      if (!seeded.ok) { if (created) this.closeTab(id); return { ok: false, result: seeded.result }; }
      try {
        if (!valid()) { if (created) this.closeTab(id); return { ok: false, result: '打开请求已取消' }; }
        await withDeadline(record.contents.loadURL(check.url.toString()), timeoutMs, '网页加载超时');
      } finally {
        if (seeded.scriptId && !record.contents.isDestroyed()) {
          try {
            await withDeadline(record.contents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: seeded.scriptId }), this.setupTimeoutMs, '清理临时登录数据脚本超时');
          } catch {
            this.closeTab(id);
            throw new Error('无法清理临时登录数据脚本，后台页面已关闭');
          }
        }
      }
      if (!valid() || record.closing || record.contents.isDestroyed()) {
        if (created) this.closeTab(id);
        return { ok: false, result: '打开请求已取消' };
      }
      if (!isSafeBrowserUrl(record.contents.getURL()).ok) { this.closeTab(id); return { ok: false, result: '网页跳转到了不允许的地址' }; }
      if (seeded.siteKey && new URL(record.contents.getURL()).origin === check.url.origin) {
        this.seededSites.add(seeded.siteKey);
        if (seeded.notice) this.notice(seeded.notice);
      }
      this.activeId = id;
      return { ok: true, contents: record.contents, tabId: id };
    } catch (error: any) {
      if (created) this.closeTab(id);
      else if (record && !record.contents.isDestroyed()) record.contents.stop();
      return { ok: false, result: `后台页面打开失败：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  getContents() {
    const record = this.tabs.get(this.activeId);
    return record && !record.closing && !record.contents.isDestroyed() ? record.contents : null;
  }

  listTabs() {
    return [...this.tabs.values()].filter(record => !record.closing && !record.contents.isDestroyed()).map(record => ({
      id: record.id, title: record.contents.getTitle(), url: record.contents.getURL(), active: record.id === this.activeId, webContentsId: record.contents.id,
    }));
  }

  activateTab(id: string) {
    const record = this.tabs.get(String(id || ''));
    if (!record || record.closing || record.contents.isDestroyed()) return { ok: false, result: '找不到后台标签页' };
    this.activeId = record.id;
    return { ok: true, contents: record.contents, tab: { id: record.id, url: record.contents.getURL() } };
  }

  async showForHuman() {
    const record = this.tabs.get(this.activeId);
    if (!record || record.closing || record.contents.isDestroyed() || record.win.isDestroyed()) throw new Error('待处理页面已关闭。');
    const win = record.win;
    if (typeof win.setFocusable !== 'function' || typeof win.setOpacity !== 'function' || typeof win.show !== 'function') throw new Error('当前系统无法安全打开待处理页面。');
    try {
      record.humanVisible = true;
      win.setIgnoreMouseEvents(false);
      win.setFocusable(true);
      win.setOpacity(1);
      unmarkBackgroundWindow(win);
      win.show();
      const started = Date.now();
      while (!win.isVisible()) {
        if (record.closing || this.disposed || win.isDestroyed()) throw new Error('待处理页面已关闭。');
        if (Date.now() - started >= this.showTimeoutMs) throw new Error('系统未能打开待处理页面，请重试。');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    } catch (error) {
      try { win.hide(); win.setIgnoreMouseEvents(true); win.setFocusable(false); win.setOpacity(0); } catch {}
      markBackgroundWindow(win);
      record.humanVisible = false;
      throw error;
    }
  }

  isHumanVisible() { return Boolean(this.tabs.get(this.activeId)?.humanVisible); }

  async notifyFileChooserCancelled(record, pending) {
    // CDP 拦截原生选择器后不会自动通知网页取消。补发事件而不重设文件，避免清空或覆盖已有选择。
    const resolved = await record.contents.debugger.sendCommand('DOM.resolveNode', { backendNodeId: pending.backendNodeId }, pending.sessionId);
    const objectId = resolved?.object?.objectId;
    if (!objectId) throw new Error('网页的文件选择请求已失效。');
    try {
      const result = await record.contents.debugger.sendCommand('Runtime.callFunctionOn', { objectId, functionDeclaration: `function () {
        if (!this.isConnected || this.localName !== 'input' || this.type !== 'file') throw new Error('文件选择框已失效');
        this.dispatchEvent(new Event('cancel', { bubbles: true }));
      }`, returnByValue: true }, pending.sessionId);
      if (result?.exceptionDetails) throw new Error('无法通知网页取消文件选择。');
    } finally { await record.contents.debugger.sendCommand('Runtime.releaseObject', { objectId }, pending.sessionId).catch(() => {}); }
  }

  async chooseHumanFile(openFileDialog) {
    const record = this.tabs.get(this.activeId);
    const pending = record?.pendingFileChooser;
    if (!record?.humanVisible || !pending || record.closing || record.contents.isDestroyed()) throw new Error('网页的文件选择请求已失效。');
    const description = await record.contents.debugger.sendCommand('DOM.describeNode', { backendNodeId: pending.backendNodeId }, pending.sessionId);
    const node = description?.node;
    const attrs = node?.attributes || [];
    const attributes = new Map();
    for (let i = 0; i + 1 < attrs.length; i += 2) attributes.set(String(attrs[i]).toLowerCase(), String(attrs[i + 1]));
    if (String(node?.nodeName || '').toLowerCase() !== 'input' || String(attributes.get('type') || '').toLowerCase() !== 'file') throw new Error('网页文件选择请求已失效。');
    if (record.pendingFileChooser !== pending || !record.humanVisible || record.closing) throw new Error('网页的文件选择请求已失效。');
    const properties = attributes.has('webkitdirectory') ? ['openDirectory'] : ['openFile'];
    if (pending.mode === 'selectMultiple' && !attributes.has('webkitdirectory')) properties.push('multiSelections');
    const result = await openFileDialog({ properties });
    if (record.pendingFileChooser !== pending || !record.humanVisible || record.closing || record.contents.isDestroyed()) throw new Error('网页的文件选择请求已失效。');
    record.pendingFileChooser = null;
    this.onHumanFileChooser?.(false);
    if (result.canceled || !result.filePaths?.length) {
      await this.notifyFileChooserCancelled(record, pending);
      return { canceled: true };
    }
    await record.contents.debugger.sendCommand('DOM.setFileInputFiles', { backendNodeId: pending.backendNodeId, files: result.filePaths }, pending.sessionId);
    return { canceled: false };
  }

  async hideFromHuman() {
    const record = this.tabs.get(this.activeId);
    if (!record || !record.humanVisible || record.closing || record.contents.isDestroyed() || record.win.isDestroyed()) throw new Error('待处理页面已关闭。');
    record.pendingFileChooser = null;
    const win = record.win;
    win.hide();
    win.setIgnoreMouseEvents(true);
    win.setFocusable(false);
    win.setOpacity(0);
    if (win.isFocusable() || win.getOpacity() !== 0 || win.isVisible()) throw new Error('无法确认页面已恢复后台状态。');
    markBackgroundWindow(win);
    record.humanVisible = false;
  }

  closeTab(id: string) {
    const record = this.tabs.get(String(id || ''));
    if (!record) return { ok: false, result: '找不到后台标签页' };
    record.closing = true;
    this.tabs.delete(record.id);
    if (this.activeId === record.id) this.activeId = '';
    if (!record.win.isDestroyed()) record.win.destroy();
    return { ok: true };
  }

  closeAll() {
    for (const id of [...this.tabs.keys()]) this.closeTab(id);
  }

  dispose() {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.disposed = true;
    this.closeAll();
    const browserSession = this.guardedSession;
    if (browserSession && this.downloadGuard) browserSession.removeListener('will-download', this.downloadGuard);
    this.guardedSession = null;
    this.downloadGuard = null;
    this.notices.length = 0;
    this.seededSites.clear();
    this.seedBindings.length = 0;
    this.cleanupPromise = Promise.resolve().then(async () => {
      if (typeof browserSession?.clearStorageData === 'function') await browserSession.clearStorageData();
      if (typeof browserSession?.clearCache === 'function') await browserSession.clearCache();
    }).catch(() => {});
    return this.cleanupPromise;
  }
}

export function createBackgroundBrowserAgent({ ownerSessionId, runId, workspacePath, createWindow, loadSiteSession = null }) {
  const surface = new BackgroundBrowserSurface({ ownerSessionId, runId, createWindow, loadSiteSession });
  let agent;
  agent = new BrowserAgent({
    surfaceLabel: '后台浏览器', supportsHandoff: false,
    openPanel: (url, tabId, credential) => surface.open(url, tabId, {
      validate: () => !credential?.token || agent.controlManager.isOpenReservationValid(credential.token),
      sessionSource: credential?.sessionSource, profileId: credential?.profileId,
    }),
    closePanel: () => surface.closeAll(), getContents: () => surface.getContents(),
    listTabs: () => surface.listTabs(), activateTab: tabId => surface.activateTab(tabId), closeTab: tabId => surface.closeTab(tabId),
  });
  agent.setContext({ ownerSessionId, runId });
  agent.setWorkspace(workspacePath);
  surface.allowDownload = contents => agent.downloadSession === contents?.session && agent.downloadContentsId === contents?.id && Boolean(agent.downloadHandler)
    && agent.controlManager.session?.status === 'running' && agent.controlManager.session?.webContentsId === contents?.id;
  return { agent, surface };
}
