import { $getRoot, $isElementNode } from 'lexical';
import { DraftEditorRuntime, SessionInputShell, $composerLayout, $selectDetectSpan, detectOffsetOfClipboardOffset, $isReferenceChipNode } from './vendor/dsh-draft-editor/index.js';
import type { DraftSnapshot, ReferenceInsert } from './vendor/dsh-draft-editor/index.js';

export type ComposerHandle = Pick<HTMLTextAreaElement, 'value' | 'selectionStart' | 'selectionEnd' | 'focus' | 'setSelectionRange'>;
const DRAFT_PREFIX = 'dyworker:dsh-input-draft:';

/** 恢复的是显式身份，普通文本（包括复制出的名字）不能反向变成引用。 */
export function validateDraftSnapshot(value: unknown): DraftSnapshot {
  const row = value as DraftSnapshot;
  if (!row || typeof row.text !== 'string' || !Array.isArray(row.references)) throw new Error('引用草稿格式无效');
  let cursor = 0;
  for (const ref of row.references) {
    if (!ref || typeof ref.source !== 'string' || !ref.source || typeof ref.ref !== 'string'
      || typeof ref.label !== 'string' || typeof ref.clipboardText !== 'string' || !ref.clipboardText
      || !Number.isSafeInteger(ref.offset) || !Number.isSafeInteger(ref.length) || ref.offset < cursor || ref.length <= 0
      || ref.offset + ref.length > row.text.length || ref.length !== ref.clipboardText.length
      || row.text.slice(ref.offset, ref.offset + ref.length) !== ref.clipboardText
      || (ref.appearance !== undefined && !['session', 'file', 'folder'].includes(ref.appearance))) throw new Error('引用草稿的范围或身份无效');
    cursor = ref.offset + ref.length;
  }
  // 官方恢复会剥离文本中的占位符，不能让剥离改变后续引用的范围。
  if (/[\uE100-\uE11D\uFFFC]/u.test(row.text)) throw new Error('引用草稿不能包含伪造占位符');
  return { text: row.text, references: row.references.map(ref => ({ ...ref })) };
}

export class DshDraftEditor {
  readonly sessionId: string;
  private readonly deps: {
    changed(): void; error(error: unknown): void;
    controller(): {lexicon: {getSnapshot(): ReadonlyMap<'/'|'@', readonly string[]>; subscribe(fn: () => void): () => void}; openReference(source: string | undefined, reference: Pick<ReferenceInsert, 'ref'|'appearance'>): boolean};
    claimToken(): string | null; hasSource(source: string): boolean;
  };
  readonly runtime: DraftEditorRuntime;
  readonly shell?: SessionInputShell;
  private readonly unregister: () => void;
  private readonly listeners = new Set<() => void>();
  private saved = '';
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private exposed?: ComposerHandle;
  private mounting = true;
  constructor(sessionId: string, deps: {
    changed(): void;
    error(error: unknown): void;
    controller(): { lexicon: {getSnapshot(): ReadonlyMap<'/' | '@', readonly string[]>; subscribe(fn: () => void): () => void}; openReference(source: string | undefined, reference: Pick<ReferenceInsert, 'ref' | 'appearance'>): boolean };
    claimToken(): string | null;
    hasSource(source: string): boolean;
  }, initialText = '', shell?: SessionInputShell) {
    this.sessionId = sessionId; this.deps = deps;
    this.shell = shell;
    const changed = () => {
        if (this.closed) return;
        this.runtime.refreshProjection();
        if (!this.mounting) { deps.changed(); this.scheduleSave(); }
        for (const listener of this.listeners) listener();
    };
    this.runtime = shell?.draftRuntime ?? new DraftEditorRuntime({
      onUpdate: changed,
      openReference: (source, reference) => deps.controller().openReference(source, reference),
      activeClaimToken: () => deps.claimToken(),
      lexicon: () => deps.controller().lexicon.getSnapshot(), resolveLexicon: () => deps.controller().lexicon,
    });
    this.unregister = shell ? this.runtime.editor.registerUpdateListener(changed) : this.runtime.register();
    let restored = false;
    try {
      const stored = globalThis.localStorage?.getItem(DRAFT_PREFIX + sessionId);
      if (stored && !initialText) { const draft = validateDraftSnapshot(JSON.parse(stored)); this.runtime.restoreDraft(draft.text, draft.references); restored = true; }
    } catch (error) { deps.error(error); }
    if (!restored) this.runtime.setDraft(initialText);
    this.runtime.refreshProjection(); this.mounting = false;
    this.refreshSources(); this.runtime.clearHistory();
  }
  get projection() { return this.runtime.projection; }
  get editor() { return this.runtime.editor; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot(): DraftSnapshot {
    return { text: this.projection.clipboardText, references: this.projection.occurrences.map(({ occurrenceId: _id, ...ref }) => ({ ...ref })) };
  }
  setPlain(text: string) { this.runtime.setDraft(text); }
  /** 原有的插入/语音/右键动作保留变更范围之外的真实节点。 */
  adoptProjection(text: string) {
    const before = this.projection.clipboardText; if (text === before) return;
    let start = 0; while (start < before.length && start < text.length && before[start] === text[start]) start++;
    let end = before.length, nextEnd = text.length;
    while (end > start && nextEnd > start && before[end - 1] === text[nextEnd - 1]) { end--; nextEnd--; }
    for (const ref of this.projection.occurrences) {
      if (start > ref.offset && start < ref.offset + ref.length) start = ref.offset;
      if (end > ref.offset && end < ref.offset + ref.length) end = ref.offset + ref.length;
    }
    const replacement = text.slice(start, text.length - (before.length - end));
    this.editor.update(() => {
      const layout = $composerLayout();
      this.runtime.replaceText({ start: detectOffsetOfClipboardOffset(layout, start), end: detectOffsetOfClipboardOffset(layout, end) }, replacement);
    }, { discrete: true });
  }
  replaceText(span: {start: number; end: number}, text: string) { return this.runtime.replaceText(span, text); }
  insertReference(span: {start: number; end: number}, ref: ReferenceInsert) {
    return this.runtime.insertReference(span, ref, this.projection.detectText.slice(span.end, span.end + 1));
  }
  restore(draft: DraftSnapshot) { const row = validateDraftSnapshot(draft); this.runtime.restoreDraft(row.text, row.references); }
  clearCommitted() { if (this.shell) this.shell.commitSend([]); else { this.runtime.clearCommittedDraft(() => null); this.runtime.clearHistory(); } }
  refreshSources() {
    this.runtime.refreshLexiconSubscription();
    if (!this.projection.occurrences.some(ref => Boolean(ref.invalid) !== !this.deps.hasSource(ref.source))) return;
    this.editor.update(() => {
      const walk = (node: ReturnType<typeof $getRoot> | any) => {
        if ($isReferenceChipNode(node)) { const invalid = !this.deps.hasSource(node.getSource()); if (node.isInvalid() !== invalid) node.setInvalid(invalid); }
        else if ($isElementNode(node)) for (const child of node.getChildren()) walk(child);
      };
      walk($getRoot());
    }, { discrete: true });
  }
  refreshClaim() { this.runtime.refreshClaimDecoration(); }
  focus() { this.editor.focus(); }
  clipboardSpan(span = this.runtime.caretSpan()) {
    const at = (offset: number) => {
      let detect = 0, clipboard = 0;
      for (const segment of this.projection.occurrences) {
        const before = segment.offset - clipboard;
        if (offset <= detect + before) return clipboard + offset - detect;
        detect += before; clipboard = segment.offset;
        if (offset <= detect + 1) return clipboard + segment.length;
        detect += 1; clipboard += segment.length;
      }
      return clipboard + offset - detect;
    };
    return { start: at(span.start), end: at(span.end) };
  }
  setSelectionRange(start: number, end: number) {
    this.editor.update(() => {
      const layout = $composerLayout();
      $selectDetectSpan({ start: detectOffsetOfClipboardOffset(layout, start), end: detectOffsetOfClipboardOffset(layout, end) });
    }, { discrete: true });
  }
  /** 原有文件插入、语音和右键功能只借用实际选择，不伪造 textarea DOM。 */
  get handle(): ComposerHandle {
    if (this.exposed) return this.exposed;
    const owner = this;
    return this.exposed = {
      get value() { return owner.projection.clipboardText; },
      get selectionStart() { return owner.clipboardSpan().start; },
      get selectionEnd() { return owner.clipboardSpan().end; },
      focus: () => owner.focus(), setSelectionRange: (start, end) => owner.setSelectionRange(start ?? owner.projection.clipboardText.length, end ?? owner.projection.clipboardText.length),
    };
  }
  private scheduleSave() {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, 300);
  }
  flush() {
    const value = JSON.stringify(this.snapshot()); if (value === this.saved) return;
    try { globalThis.localStorage?.setItem(DRAFT_PREFIX + this.sessionId, value); this.saved = value; }
    catch (error) { this.deps.error(error); }
  }
  dispose() { if (this.closed) return; this.closed = true; if (this.timer) clearTimeout(this.timer); this.flush(); this.unregister(); this.listeners.clear(); }
}
