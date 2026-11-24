import { discoverExternalCdpBrowsers } from "../browser-cdp-external.mts";

// 一个任务可选择可见面板、独立后台浏览器或已连接的外部 Chromium CDP 浏览器；切换前必须明确关闭/断开原页面。
export class TaskBrowserRouter {
  visible;
  createBackground;
  createExternal;
  discoverExternal;
  isFullCdpAccessEnabled;
  background = null;
  external = null;
  mode = '';
  ownerSessionId;
  runId;
  stopped = false;
  busy = false;
  handoffs;
  allowHandoff;
  claimed = false;
  executionResult = null;

  constructor({
    visible,
    createBackground,
    createExternal = null,
    discoverExternal = discoverExternalCdpBrowsers,
    isFullCdpAccessEnabled = () => false,
    initialMode = '',
    ownerSessionId,
    runId,
    handoffs = null,
    allowHandoff = false,
    claimedBackground = null,
  }) {
    this.visible = visible;
    this.createBackground = createBackground;
    this.createExternal = createExternal;
    this.discoverExternal = discoverExternal;
    this.isFullCdpAccessEnabled = typeof isFullCdpAccessEnabled === 'function' ? isFullCdpAccessEnabled : () => false;
    this.ownerSessionId = String(ownerSessionId || '');
    this.runId = String(runId || '');
    this.handoffs = handoffs;
    this.allowHandoff = allowHandoff;
    if (claimedBackground) { this.background = claimedBackground; this.mode = 'background'; this.claimed = true; }
    else if (initialMode) { this.mode = initialMode; }
  }

  private cdpStatusText() {
    return this.isFullCdpAccessEnabled()
      ? '已开启（可在「设置 → 安全授权」关闭）'
      : '未开启（可在「设置 → 安全授权」手动开启）';
  }

  private formatStatus() {
    if (this.mode === 'external' && this.external) {
      const info = this.external.surface?.browserInfo;
      const tabs = this.external.surface?.listTabs?.() || [];
      return `当前已连接外部浏览器会话：${info?.name || 'Chromium'}（${info?.httpEndpoint || info?.webSocketDebuggerUrl || 'CDP'}），标签页 ${tabs.length} 个。\n完整 CDP 访问权限：${this.cdpStatusText()}`;
    }
    if (this.mode === 'background' && this.background) {
      const tabs = this.background.surface?.listTabs?.() || [];
      return `当前处于独立后台浏览器会话，标签页 ${tabs.length} 个。\n完整 CDP 访问权限：${this.cdpStatusText()}`;
    }
    if (this.mode === 'visible') {
      const tabs = this.visible?.panelTabs?.() || [];
      return `当前处于右侧可见浏览器面板会话${tabs ? `，标签页 ${tabs.length} 个` : ''}。\n完整 CDP 访问权限：${this.cdpStatusText()}`;
    }
    return `当前任务尚未打开或连接浏览器会话。\n完整 CDP 访问权限：${this.cdpStatusText()}`;
  }

  private async handleConnect(args: Record<string, any> = {}) {
    const action = String(args?.action || 'status').trim() || 'status';
    if (action === 'status') {
      return { ok: true, result: this.formatStatus() };
    }
    if (action === 'discover') {
      const discovery = await this.discoverExternal({ endpoint: args?.endpoint });
      if (!discovery.ok) {
        return { ok: false, result: discovery.error || '发现外部浏览器失败' };
      }
      if (!discovery.browsers.length) {
        return {
          ok: true,
          result:
            '未检测到开启远程调试的本机 Chromium 浏览器（Chrome、Edge 等）。\n'
            + '如需连接现有浏览器，请以 `--remote-debugging-port=9222` 启动它，或在浏览器内开启 `chrome://inspect/#remote-debugging` 后重试（也可直接传入本机 `endpoint`，如 `http://127.0.0.1:9222`）；否则可用 `browser__open` 启动独立内置浏览器。',
          data: [],
        };
      }
      const lines = discovery.browsers.map((b: any, i: number) => {
        const pages = (b.targets || []).slice(0, 12).map((t: any) =>
          `  - targetId=${t.id} | ${t.title || '（无标题）'} | ${t.url || 'about:blank'}`
        );
        return `[${i + 1}] ${b.name} (${b.id}) · ${b.httpEndpoint || b.webSocketDebuggerUrl}\n${pages.length ? pages.join('\n') : '  （暂无可列出标签页）'}`;
      });
      return {
        ok: true,
        result: `发现 ${discovery.browsers.length} 个本机外部 Chromium 浏览器调试端点：\n${lines.join('\n')}`,
        data: discovery.browsers,
      };
    }
    if (action === 'disconnect') {
      if (this.mode !== 'external' || !this.external) {
        return { ok: true, result: '当前没有已连接的外部浏览器调试会话。' };
      }
      this.external.agent.dispose();
      await this.external.surface.dispose();
      this.external = null;
      this.mode = '';
      return { ok: true, result: '已断开外部浏览器 CDP 连接（用户的浏览器与标签页保持打开）。' };
    }
    if (action === 'connect') {
      if (this.mode && this.mode !== 'external') {
        return { ok: false, errorCode: 'BROWSER_MODE_BUSY', result: '当前任务已有内置浏览器页面；请先关闭它，再连接外部浏览器。' };
      }
      if (!this.ownerSessionId || !this.runId) {
        return { ok: false, errorCode: 'TARGET_UNAVAILABLE', result: '连接外部浏览器需要明确的任务和运行身份。' };
      }
      if (typeof this.createExternal !== 'function') {
        return { ok: false, errorCode: 'UNAVAILABLE', result: '当前运行环境未启用外部浏览器 CDP 连接。' };
      }
      if (this.external) {
        this.external.agent.dispose();
        await this.external.surface.dispose();
        this.external = null;
        this.mode = '';
      }
      const external = this.createExternal();
      const connected = await external.surface.connect({
        endpoint: args?.endpoint,
        browser: args?.browser,
        targetId: args?.targetId,
      });
      if (!connected?.ok || !connected.contents) {
        await external.surface.dispose();
        return { ok: false, result: connected?.result || '连接外部浏览器失败' };
      }
      try {
        await external.agent.controlManager.acquireControl({
          ownerSessionId: this.ownerSessionId,
          runId: this.runId,
          tabId: connected.tabId,
          webContents: connected.contents,
          workspacePath: external.agent.workspacePath,
        });
      } catch (err: any) {
        await external.surface.dispose();
        return { ok: false, result: `接管外部浏览器页面失败：${err?.message || err}` };
      }
      this.external = external;
      this.mode = 'external';
      let obs = null;
      try {
        obs = await external.agent.controlManager.observe({ context: external.agent.currentContext });
      } catch {
        // 忽略初次观察失败，仍保留已连接会话
      }
      const tabs = external.surface.listTabs();
      const browserLabel = connected.browser?.name || '外部 Chromium 浏览器';
      const endpointLabel = connected.browser?.httpEndpoint || connected.browser?.webSocketDebuggerUrl || '';
      return {
        ok: true,
        result: `已连接${browserLabel}${endpointLabel ? `（${endpointLabel}）` : ''}，当前标签页 ${tabs.length} 个。完整 CDP 访问权限：${this.cdpStatusText()}\n${obs?.result ? `\n当前页面快照：\n${obs.result}` : ''}`,
        images: obs?.images || [],
        data: obs?.data || null,
      };
    }
    return { ok: false, errorCode: 'INVALID_ARGUMENT', result: `未知的连接操作：${action}` };
  }

  async handle(name, args = {} as any, context: Record<string, any> = {}) {
    if (this.stopped) return { ok: false, errorCode: 'TASK_STOPPED', result: '任务已停止，不能继续操作浏览器。' };
    if (this.busy) return { ok: false, errorCode: 'BROWSER_BUSY', result: '上一个浏览器操作尚未结束，请等待后重试。' };
    this.busy = true;
    try {
    if (name === 'browser__connect') {
      return await this.handleConnect(args);
    }
    const explicitMode = name === 'browser__open' && typeof args.background === 'boolean'
      ? (args.background ? 'background' : 'visible') : '';
    const desired = explicitMode || this.mode || 'background';
    if (this.mode && explicitMode && this.mode !== explicitMode) {
      return { ok: false, errorCode: 'BROWSER_MODE_BUSY', result: '当前任务已有浏览器页面；请先关闭它，再切换浏览器。' };
    }
    if (desired === 'external') {
      if (!this.external) return { ok: false, errorCode: 'TARGET_UNAVAILABLE', result: '外部浏览器会话尚未连接，请先调用 browser__connect。' };
      const result = await this.external.agent.handle(name, args, context);
      if ((name === 'browser__close' || (name === 'browser__tabs' && args.action === 'close' && !args.tabId)) && result?.ok) {
        this.external.agent.dispose();
        await this.external.surface.dispose();
        this.external = null;
        this.mode = '';
      }
      return result;
    }
    const sessionSource = name === 'browser__open' ? String(args.sessionSource || '').trim() : '';
    if (desired === 'visible' && sessionSource && !['isolated', 'builtin'].includes(sessionSource)) {
      return { ok: false, errorCode: 'INVALID_ARGUMENT', result: '右侧面板固定使用内置浏览器的登录状态；要复用其他浏览器的登录状态，请使用后台浏览器（不设置 background=false）。' };
    }
    if (desired === 'background' && (!this.ownerSessionId || !this.runId)) {
      return { ok: false, errorCode: 'TARGET_UNAVAILABLE', result: '后台浏览器需要明确的任务和运行身份。' };
    }
    if (desired === 'background' && !this.background) this.background = this.createBackground();
    const agent = desired === 'background' ? this.background.agent : this.visible;
    if (desired === 'background' && name === 'browser__handoff' && this.allowHandoff && this.handoffs) {
      return this.handoffs.request({ ownerSessionId: this.ownerSessionId, runId: this.runId, background: this.background, reason: args.reason });
    }
    const result = await agent.handle(name, args, context);
    if (name === 'browser__open' && result?.ok) this.mode = desired;
    if (name === 'browser__close' && result?.ok) this.mode = '';
    if (name === 'browser__tabs' && args.action === 'close' && !args.tabId && result?.ok) this.mode = '';
    if (name === 'browser__tabs' && args.action === 'close' && result?.ok && desired === 'background' && !this.background.surface.listTabs().length) this.mode = '';
    if (desired === 'background') {
      const notices = this.background.surface.takeNotices();
      if (notices.length) return { ...result, result: `${result?.result || ''}\n\n${notices.join('\n')}`.trim() };
    }
    return result;
    } finally {
      // 打开后的观察失败也可能留下页面；不能因此悄悄切换到另一种模式。
      if (!this.stopped && !this.mode && this.background?.surface?.listTabs().length) this.mode = 'background';
      this.busy = false;
    }
  }

  abort({ preserveHandoff = false, recoverClaim = false } = {} as any) {
    this.stopped = true;
    this.cancelPendingVisibleOpen();
    const session = this.visible?.controlManager?.session;
    if (session?.ownerSessionId === this.ownerSessionId && session?.runId === this.runId) {
      this.visible.controlManager.pause({ reason: '任务已取消或中断' });
    }
    this.external?.agent?.controlManager?.pause({ reason: '任务已取消或中断' });
    void this.external?.surface?.dispose();
    if (recoverClaim && this.claimed && !this.handoffs?.owns(this.background)) this.handoffs?.restoreClaim(this.background, this.ownerSessionId);
    if (!((preserveHandoff || recoverClaim) && this.handoffs?.owns(this.background))) {
      const entry = this.handoffs?.list().find(item => item.ownerSessionId === this.ownerSessionId);
      if (entry && this.handoffs?.owns(this.background)) void this.handoffs.discard(entry.id);
      this.background?.agent?.controlManager?.pause({ reason: '任务已取消或中断' });
      this.background?.surface?.dispose();
    }
  }

  async dispose() {
    this.stopped = true;
    this.cancelPendingVisibleOpen();
    this.visible?.dispose();
    this.external?.agent?.dispose();
    await this.external?.surface?.dispose();
    if (!this.handoffs?.owns(this.background)) {
      this.background?.agent?.dispose();
      await this.background?.surface?.dispose();
    }
  }

  cancelPendingVisibleOpen() {
    const manager = this.visible?.controlManager;
    const reservation = manager?.openReservation;
    if (this.ownerSessionId && this.runId && reservation?.ownerSessionId === this.ownerSessionId && reservation?.runId === this.runId) {
      manager.clearOpenReservation({ token: reservation.token });
    }
  }
}
