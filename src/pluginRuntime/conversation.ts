import type { Context } from '@deepseek-ai/cordis';
import { ConversationController, ComposerBlockRegistry, type ComposerAttachment } from './vendor/dsh-draft-editor/index.js';
import { awaitInput, type InputAttachmentSubmission } from './inputTriggers.ts';

export interface ConversationSubmission {
  sessionId: string; text: string; attachments: readonly any[]; mode: 'queue'|'steer'; signal: AbortSignal;
  presentation?: import('./vendor/dsh-draft-editor/index.js').DraftSnapshot;
  attachmentNames?: readonly string[];
}

/** 官方浏览器草稿注册表；提交交给应用现有入口，浏览器对象始终留在原会话。 */
export class OwnedConversation extends ConversationController {
  private readonly owners = new Map<string, string>();
  private readonly bridge: {
    retained(id: string): boolean; scope(scope: Context): string;
    submit(input: ConversationSubmission): Promise<{kind: 'success'|'error'; text?: string}>;
    operation(id: string, action: string, payload?: any): Promise<any>;
  };
  constructor(ctx: Context, input: any, bridge: OwnedConversation['bridge']) {
    super(ctx, {input, blocks: new ComposerBlockRegistry(), maxConcurrentFileUploads: 3});
    this.bridge = bridge;
    ctx.effect(() => () => { this.owners.clear(); });
  }
  private assertSession(id: string) {
    if (!this.bridge.retained(id)) throw new Error('附件需要仍被保留的 DSH 会话');
  }
  assertOwned(id: string, ids: readonly string[]) {
    this.assertSession(id);
    if (ids.some(draft => this.owners.get(draft) !== id)) throw new Error('附件不存在或属于其他会话');
  }
  createDrafts(id: string, files: readonly File[]) {
    this.assertSession(id);
    if (!Array.isArray(files) || files.some(file => !(file instanceof File))) throw new Error('附件必须是实际浏览器文件');
    const rows = super.createDrafts(id, files);
    for (const row of rows) this.owners.set(row.id, id);
    return rows;
  }
  retryFileUpload(id: string, draft: string) { this.assertOwned(id, [draft]); super.retryFileUpload(id, draft); }
  rebindDraftFiles(id: string, drafts: readonly string[]) {
    // 跨任务转移必须重建草稿，不能借用另一个任务已经发放的上传凭据。
    this.assertOwned(id, drafts); super.rebindDraftFiles(id, drafts);
  }
  releaseDraftAttachment(id: string) { super.releaseDraftAttachment(id); this.owners.delete(id); }
  releaseSession(id: string) {
    for (const [draft, owner] of this.owners) if (owner === id) this.releaseDraftAttachment(draft);
    this.blocks.forget(id);
  }
  availableFor(id: string) { return [...this.owners].filter(([, owner]) => owner === id).map(([draft]) => draft); }
  async serializeFor(id: string, drafts: readonly string[]) {
    this.assertOwned(id, drafts);
    const result = await super.serializeDraftAttachments(drafts);
    this.assertOwned(id, drafts); return result.attachments;
  }
  async sendSession(session: {sessionId: string}, text: string, ids: readonly string[], mode: 'queue'|'steer', signal?: AbortSignal,
    context?: {attachments?: InputAttachmentSubmission; draft?: import('./vendor/dsh-draft-editor/index.js').DraftSnapshot}) {
    const active = signal ?? new AbortController().signal;
    active.throwIfAborted();
    const extra = context?.attachments;
    const browserNames = this.resolveDraftAttachments(ids).map(file => file.file.name || '附件');
    if (extra && !extra.current()) throw new Error('附件或会话已经变化，输入已保留');
    const browser = await awaitInput(this.serializeFor(session.sessionId, ids), active);
    const native = extra ? await awaitInput(extra.serialize(active), active) : [];
    if (extra && (!extra.current() || native.length !== extra.count)) throw new Error('附件转换不完整或会话已经变化，输入已保留');
    const attachments = [...browser, ...native];
    active.throwIfAborted();
    const result = await this.bridge.submit({sessionId: session.sessionId, text, attachments, mode, signal: active,
      ...(attachments.length ? {attachmentNames:[...browserNames,...native.map((part, index)=>extra?.names?.[index] || (part.type === 'image' && part.name) || '文件附件')]} : {}),
      ...(context?.draft ? {presentation:context.draft} : {})});
    if (result.kind === 'success') {
      for (const id of ids) this.releaseDraftAttachment(id);
      if (extra?.current()) extra.consume();
    }
    return result;
  }
  async send(text: string) {
    const id = this.bridge.scope(this.ctx);
    const result = await this.sendSession({sessionId:id}, text, [], 'queue');
    if (result.kind !== 'success') throw new Error(result.text || '会话发送失败');
  }
  async updateQueue(itemId: string, action: any) {
    const id = this.bridge.scope(this.ctx);this.assertSession(id);
    try { await this.bridge.operation(id,'input-update-queue',{itemId,action}); }
    catch (error: any) { if (action?.kind === 'steer' && ['session/steer-unavailable','session/queue-item-not-found'].includes(error?.code)) return; throw error; }
  }
  async cancel() { const id = this.bridge.scope(this.ctx);this.assertSession(id);await this.bridge.operation(id,'input-cancel'); }
  /** 仅描述当前会话拥有的对象，防止作用域调用读取其他会话的草稿。 */
  scopedAttachments(ids: readonly string[]): readonly ComposerAttachment[] {
    this.assertOwned(this.bridge.scope(this.ctx), ids); return super.resolveDraftAttachments(ids);
  }
}
