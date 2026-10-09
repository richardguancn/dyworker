/** 固定 DSH 输入来源契约在本应用输入框中的执行桥。 */
export interface InputSpan { start: number; end: number; draftRev: number }
export interface InputCandidate { name: string; label?: string; description?: string; section?: string; value?: string; icon?: unknown; hint?: string; drill?: boolean }
export type SubmitAttachment = { type: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string; name?: string }
  | { type: 'file'; receiptId: string };
export interface InputAttachmentSubmission {
  count: number;
  names?: readonly string[];
  serialize(signal: AbortSignal): Promise<readonly SubmitAttachment[]>;
  current(): boolean;
  consume(): void;
}
export interface InputClaim {
  name: string; token: string; hint?: string; attachments?: boolean;
  submit(args: string, context: unknown, attachments: readonly unknown[]): Promise<{ kind: 'success' | 'error'; text?: string }>;
}
export interface InputSource {
  trigger: '/' | '@'; name: string; order?: number;
  candidates(session: { sessionId: string }, request: { query: string; position: 'leading' | 'inline'; drilled: boolean; signal: AbortSignal }): Promise<readonly InputCandidate[]>;
  onPick(pick: { candidate: InputCandidate; session: { sessionId: string }; position: 'leading' | 'inline'; via: 'menu' | 'space' | 'enter'; action: 'pick' | 'drill'; span: InputSpan }): unknown;
  matchEnter?(session: { sessionId: string }, line: string, signal: AbortSignal, envelope: { attachments: number }): Promise<unknown>;
  matchSpace?(session: { sessionId: string }, token: string): unknown;
  warm?(session: { sessionId: string }): void;
  header?(session: { sessionId: string }, request: { query: string; quoted?: boolean; drilled: boolean }): readonly { label: string; value: string; current?: boolean }[] | undefined;
  lexicon?(session: { sessionId: string }): readonly string[] | undefined;
  subscribeLexicon?(session: { sessionId: string }, listener: () => void): () => void;
  openReference?(session: { sessionId: string }, reference: { ref: string; appearance?: string }): boolean;
  codec?: { clipboardText(ref: string): string; serialize(ref: string, signal: AbortSignal): Promise<string> };
}
export interface RegisteredInputCandidate { id: string; source: InputSource; candidate: InputCandidate; position: 'leading' | 'inline' }

export function replaceInputSpan(text: string, revision: number, span: InputSpan, replacement: string) {
  if (span.draftRev !== revision || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)
    || span.start < 0 || span.end > text.length || span.start > span.end) return undefined;
  return text.slice(0, span.start) + replacement + text.slice(span.end);
}

export function awaitInput<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void operation.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    operation.then(value => { signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/** 与官方 consumeToken 相同：修订号不符、范围无效或整行改变时不删除。 */
export function consumeInputToken(text: string, draftRev: number, guard: any): string | undefined {
  if (guard?.kind === 'bare-token') return typeof guard.token === 'string' && guard.token !== '' && text.trim() === guard.token ? '' : undefined;
  const span = guard?.kind === 'span' ? guard.span : undefined;
  if (!span || span.draftRev !== draftRev || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)
    || span.start < 0 || span.end > text.length || span.start >= span.end) return undefined;
  return text.slice(0, span.start) + text.slice(span.end);
}
