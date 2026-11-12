// 一个任务可选择可见面板或独立后台浏览器；切换前必须明确关闭原页面。
export class TaskBrowserRouter {
  visible;
  createBackground;
  background = null;
  mode = '';
  ownerSessionId;
  runId;
  stopped = false;
  busy = false;
  handoffs;
  allowHandoff;
  claimed = false;
  executionResult = null;

  constructor({ visible, createBackground, ownerSessionId, runId, handoffs = null, allowHandoff = false, claimedBackground = null }) {
    this.visible = visible;
    this.createBackground = createBackground;
    this.ownerSessionId = String(ownerSessionId || '');
    this.runId = String(runId || '');
    this.handoffs = handoffs;
    this.allowHandoff = allowHandoff;
    if (claimedBackground) { this.background = claimedBackground; this.mode = 'background'; this.claimed = true; }
  }

  async handle(name, args = {} as any) {
    if (this.stopped) return { ok: false, errorCode: 'TASK_STOPPED', result: '任务已停止，不能继续操作浏览器。' };
    if (this.busy) return { ok: false, errorCode: 'BROWSER_BUSY', result: '上一个浏览器操作尚未结束，请等待后重试。' };
    this.busy = true;
    try {
    const explicitMode = name === 'browser__open' && typeof args.background === 'boolean'
      ? (args.background ? 'background' : 'visible') : '';
    const desired = explicitMode || this.mode || 'background';
    if (this.mode && explicitMode && this.mode !== explicitMode) {
      return { ok: false, errorCode: 'BROWSER_MODE_BUSY', result: '当前任务已有浏览器页面；请先关闭它，再切换浏览器。' };
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
    const result = await agent.handle(name, args);
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
