import type { LexicalEditor, LexicalNode } from 'lexical';
import type { ReactNode } from 'react';
export interface ReferenceInsert { source: string; ref: string; label: string; appearance?: 'session' | 'file' | 'folder'; clipboardText: string }
export interface Occurrence extends ReferenceInsert { occurrenceId: number; offset: number; length: number; invalid?: boolean }
export interface DraftSnapshot { text: string; references: readonly Omit<Occurrence, 'occurrenceId'>[] }
export interface EditorProjection { detectText: string; clipboardText: string; occurrences: readonly Occurrence[]; selection: {start: number; end: number} | null; caret: number | null }
export interface SnapshotStore<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
export interface InputState { draft: string; attachmentIds: readonly string[]; draftRev: number; phase: 'plain'|'claimed'|'adjudicating'|'submitting'; claim?: {name: string; token: string; hint?: string; attachments?: boolean}; occurrences: readonly Occurrence[]; queue: readonly unknown[] }
export interface CommandClaim { name: string; token: string; hint?: string; attachments?: boolean; submit(args: string, scope: any, attachments: readonly any[]): Promise<{kind: 'success'|'error'; text?: string}> }
export class SessionInputShell {
 constructor(deps: {actx: any; captureAttachments?: () => import("../../inputTriggers").InputAttachmentSubmission | undefined; inbox?:SnapshotStore<any>; inputTriggers?: () => any; popup?: () => {dismiss(): void}; defaultSink(text: string, ids: readonly string[], mode: 'queue'|'steer', signal: AbortSignal, context?: {attachments?: import("../../inputTriggers").InputAttachmentSubmission; draft?: DraftSnapshot}): Promise<{kind: 'success'|'error'; text?: string}>; commandAttachments: {serialize(ids: readonly string[]): Promise<readonly any[]>; release(ids: readonly string[]): void; unsupportedNotice(token: string): string}});
 readonly draftRuntime: DraftEditorRuntime; readonly editor: LexicalEditor; readonly state: SnapshotStore<InputState>; readonly snapshot: InputState;
 readonly notices: SnapshotStore<{level: 'info'|'error'; text: string; seq: number}|null>; readonly actions: {captureInsertion(): {start: number; end: number; draftRev: number}; insertText(text: string, span: {start: number; end: number; draftRev: number}): boolean; setDraft(text: string): void; persistDraft(): void; addAttachments(ids: readonly string[]): boolean; removeAttachment(id: string): void; pruneAttachments(ids: readonly string[]): void; submit(): void};
 setDraft(input: string|DraftSnapshot): void; requestDraftInitialization(options: {prompt?: string; clearPreviousDraft?: boolean}): 'applied'|'preserved'|'blocked';
 beginCommand(claim: CommandClaim, span: {start: number; end: number; draftRev: number}): boolean; insertReference(ref: ReferenceInsert, span: {start: number; end: number; draftRev: number}): boolean;
 addAttachments(ids: readonly string[]): boolean; removeAttachment(id: string): boolean; pruneAttachments(ids: readonly string[]): void;
 submit(mode?: 'queue'|'steer', source?: 'click'|'enter'): void; notify(level: 'info'|'error', text: string): void; focus(): void; commitSend(ids: readonly string[]): void;
 bindDraftPersistence(write: (draft: DraftSnapshot) => void): () => void; cancelPending(): void; dispose(): readonly string[];
}
export class ComposerBlockRegistry {
 set(id: string, block: {reason: string}|undefined): void; storeFor(id: string): SnapshotStore<{reason: string}|undefined>; forget(id: string): void;
}
export interface ComposerAttachment { kind: 'file'|'image'; id: string; file: File; previewUrl?: string; width?: number; height?: number }
export class ConversationController {
 constructor(ctx: any, config: {input: any; blocks: ComposerBlockRegistry; maxConcurrentFileUploads: number});
 readonly ctx: any; readonly input: any; readonly blocks: ComposerBlockRegistry;
 readonly fileUploads: SnapshotStore<Record<string, {status: 'uploading'; loaded: number; total?: number}|{status:'ready';receiptId:string;file:any}|{status:'error';message:string}>>;
 createDrafts(id: string, files: readonly File[]): readonly ComposerAttachment[]; resolveDraftAttachments(ids: readonly string[]): readonly ComposerAttachment[];
 serializeDraftAttachments(ids: readonly string[]): Promise<{attachments: readonly any[]}>; releaseDraftAttachment(id: string): void; releaseDraftAttachments(rows: readonly ComposerAttachment[]): void;
 retryFileUpload(id: string, draft: string): void; rebindDraftFiles(id: string, drafts: readonly string[]): void;
 send(text: string): Promise<void>; sendSession(session: any, text: string, ids: readonly string[], mode: 'queue'|'steer', signal?: AbortSignal): Promise<{kind:'success'|'error';text?:string}>;
 updateQueue(itemId:string,action:any):Promise<void>;cancel():Promise<void>;
}
export class DraftEditorRuntime {
 constructor(deps: {onUpdate(): void; openReference(source: string | undefined, reference: Pick<ReferenceInsert, 'ref'|'appearance'>): boolean; activeClaimToken(): string | null; lexicon(): ReadonlyMap<'/'|'@', readonly string[]>; resolveLexicon(): {subscribe(listener: () => void): () => void} | undefined});
 readonly editor: LexicalEditor; readonly projection: EditorProjection;
 register(): () => void; refreshProjection(): EditorProjection; refreshLexiconSubscription(): void; refreshClaimDecoration(): void;
 setDraft(text: string): void; restoreDraft(text: string, refs: DraftSnapshot['references']): void;
 replaceText(span: {start: number; end: number}, text: string): boolean;
 insertReference(span: {start: number; end: number}, ref: ReferenceInsert, tail: string): boolean;
 paste(text: string): void; caretSpan(): {start: number; end: number}; clearHistory(): void;
 clearCommittedDraft(prefixLength: (text: string) => number | null): void;
}
export function DecoratorPortals(props: {editor: LexicalEditor | null}): ReactNode;
export const draftEditorStyles: string;
export function $composerLayout(): {clipboardText: string; detectText: string; segments: readonly {kind: string; node: LexicalNode | null; clipboardStart: number; clipboardLength: number}[]};
export function detectOffsetOfClipboardOffset(layout: ReturnType<typeof $composerLayout>, offset: number): number;
export function $selectDetectSpan(span: {start: number; end: number}): boolean;
export function $isReferenceChipNode(node: LexicalNode | null): node is LexicalNode & {getSource(): string; getReference(): string; isInvalid(): boolean; setInvalid(invalid: boolean): void};
