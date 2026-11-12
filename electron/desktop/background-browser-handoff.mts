import { randomUUID } from 'node:crypto';

// 持有等待用户处理的原页面，只有用户主动打开和交还后才转给新的任务代次。
export class BackgroundBrowserHandoffs {
  entries = new Map<string, any>();
  notify;
  openFileDialog;
  constructor({ notify = () => {}, openFileDialog = null } = {} as any) { this.notify = notify; this.openFileDialog = openFileDialog; }

  list() {
    return [...this.entries.values()].map(({ id, ownerSessionId, state, reason, filePending, selectingFile }) => ({ id, ownerSessionId, state, reason, filePending: Boolean(filePending), selectingFile: Boolean(selectingFile) }));
  }

  publish() { try { this.notify(this.list()); } catch {} }

  request({ ownerSessionId, runId, background, reason = '' }) {
    if (!ownerSessionId || !runId || !background?.surface?.getContents() || !background?.agent?.controlManager?.session) {
      return { ok: false, result: '当前没有可交接的后台页面。' };
    }
    if ([...this.entries.values()].some(entry => entry.ownerSessionId === ownerSessionId)) {
      return { ok: false, result: '此会话已有待处理页面，请先处理或关闭它。' };
    }
    if (this.entries.size >= 5) return { ok: false, result: '待处理页面过多，请先处理或关闭已有页面。' };
    const session = background.agent.controlManager.session;
    if (session.ownerSessionId !== ownerSessionId || session.runId !== runId || session.status !== 'running') {
      return { ok: false, result: '页面控制状态已变化，请重新观察。' };
    }
    const taken = background.agent.controlManager.takeover({ reason: reason || '等待用户处理' });
    if (!taken.ok) return taken;
    const id = randomUUID();
    const entry = { id, ownerSessionId, runId, background, state: 'waiting', reason: String(reason || '需要人工处理').slice(0, 300), nextRunId: '', filePending: false, selectingFile: false };
    this.entries.set(id, entry);
    background.surface.onHumanWindowClosed = () => { void this.discard(id, { force: true }); };
    background.surface.onHumanFileChooser = pending => { entry.filePending = pending; this.publish(); };
    this.publish();
    return { ok: true, result: '已暂停操作并保留当前页面。请在此会话中点击“打开待处理页面”，处理完成后点击“继续交给助手”。' };
  }

  owns(background) { return [...this.entries.values()].some(entry => entry.background === background); }

  async show(id) {
    const entry = this.entries.get(String(id || ''));
    if (!entry || !['waiting', 'human'].includes(entry.state)) return { ok: false, result: '待处理页面不存在或状态已变化。' };
    if (entry.selectingFile) return { ok: false, result: '请先完成或取消文件选择。' };
    const previous = entry.state;
    entry.state = 'opening';
    this.publish();
    try {
      const adapter = entry.background.agent.controlManager.session?.adapter;
      if (adapter && !(await adapter.waitForInputRelease())) {
        await this.discard(entry.id, { force: true });
        return { ok: false, result: '无法确认之前的输入已经结束，待处理页面已关闭，请重新打开。' };
      }
      if (this.entries.get(entry.id) !== entry) return { ok: false, result: '待处理页面已关闭。' };
      await entry.background.surface.showForHuman();
    }
    catch (error: any) {
      if (this.entries.get(entry.id) === entry) {
        if (!entry.background.surface.getContents()) await this.discard(entry.id);
        else { entry.state = entry.background.surface.isHumanVisible() ? previous : 'waiting'; this.publish(); }
      }
      return { ok: false, result: error?.message || '无法打开待处理页面。' };
    }
    if (this.entries.get(entry.id) !== entry) return { ok: false, result: '待处理页面已关闭。' };
    entry.state = 'human';
    this.publish();
    return { ok: true };
  }

  async ready(id) {
    const entry = this.entries.get(String(id || ''));
    if (!entry) return { ok: false, result: '待处理页面已关闭。' };
    if (entry.state === 'ready') return { ok: true, ownerSessionId: entry.ownerSessionId, runId: entry.nextRunId };
    if (entry.state !== 'human') return { ok: false, result: '请先打开页面并完成处理。' };
    if (entry.selectingFile) return { ok: false, result: '请先完成或取消文件选择。' };
    entry.state = 'returning';
    this.publish();
    try { await entry.background.surface.hideFromHuman(); }
    catch (error: any) {
      if (this.entries.get(entry.id) === entry) { entry.state = 'human'; this.publish(); }
      return { ok: false, result: error?.message || '无法将页面安全恢复到后台。' };
    }
    if (this.entries.get(entry.id) !== entry) return { ok: false, result: '待处理页面已关闭。' };
    entry.state = 'ready';
    entry.filePending = false;
    entry.nextRunId = randomUUID();
    this.publish();
    return { ok: true, ownerSessionId: entry.ownerSessionId, runId: entry.nextRunId };
  }

  async chooseFile(id) {
    const entry = this.entries.get(String(id || ''));
    if (!entry || entry.state !== 'human' || !entry.filePending || entry.selectingFile || typeof this.openFileDialog !== 'function') return { ok: false, result: '文件选择请求已失效。' };
    entry.selectingFile = true;
    this.publish();
    try { await entry.background.surface.chooseHumanFile(this.openFileDialog); return { ok: true }; }
    catch (error: any) { return { ok: false, result: error?.message || '无法选择文件。' }; }
    finally { entry.selectingFile = false; if (this.entries.get(entry.id) === entry) this.publish(); }
  }

  claim(ownerSessionId, runId, workspacePath) {
    const entry = [...this.entries.values()].find(item => item.ownerSessionId === ownerSessionId && item.state === 'ready' && item.nextRunId === runId);
    if (!entry) return null;
    if (entry.background.agent.workspacePath !== String(workspacePath || '')) throw new Error('待处理页面属于原工作文件夹，请切回原工作文件夹后重试。');
    const { agent, surface } = entry.background;
    const result = agent.controlManager.resume({ ownerSessionId, runId });
    if (!result.ok) throw new Error(result.result || '待处理页面无法恢复。');
    agent.setContext({ ownerSessionId, runId });
    surface.onHumanWindowClosed = null;
    surface.onHumanFileChooser = null;
    entry.background.handoffRecovery = { ownerSessionId, reason: entry.reason };
    this.entries.delete(entry.id);
    this.publish();
    return entry.background;
  }

  restoreClaim(background, ownerSessionId) {
    const recovery = background?.handoffRecovery;
    if (!recovery || recovery.ownerSessionId !== ownerSessionId || !background.surface.getContents() || this.owns(background)) return false;
    if ([...this.entries.values()].some(entry => entry.ownerSessionId === ownerSessionId) || this.entries.size >= 5) return false;
    if (!background.agent.controlManager.takeover({ reason: '继续任务未完成，页面已保留' }).ok) return false;
    const entry = { id: randomUUID(), ownerSessionId, runId: '', background, state: 'ready',
      reason: '上次继续未完成，页面已保留', nextRunId: randomUUID(), filePending: false, selectingFile: false };
    this.entries.set(entry.id, entry);
    background.surface.onHumanWindowClosed = () => { void this.discard(entry.id, { force: true }); };
    background.surface.onHumanFileChooser = pending => { entry.filePending = pending; this.publish(); };
    this.publish();
    return true;
  }

  async discard(id, { force = false } = {}) {
    const entry = this.entries.get(String(id || ''));
    if (!entry) return { ok: false, result: '待处理页面已关闭。' };
    if (entry.selectingFile && !force) return { ok: false, result: '请先完成或取消文件选择。' };
    this.entries.delete(entry.id);
    entry.background.surface.onHumanWindowClosed = null;
    entry.background.surface.onHumanFileChooser = null;
    entry.background.agent.dispose();
    await entry.background.surface.dispose();
    this.publish();
    return { ok: true };
  }

  async discardOwner(ownerSessionId) {
    const ids = [...this.entries.values()].filter(entry => entry.ownerSessionId === ownerSessionId).map(entry => entry.id);
    await Promise.all(ids.map(id => this.discard(id, { force: true })));
  }

  async dispose() { await Promise.all([...this.entries.keys()].map(id => this.discard(id, { force: true }))); }
}
