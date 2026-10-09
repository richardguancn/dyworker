import type { InputSource, InputSpan } from '../../inputTriggers.ts';
interface Store<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
export function detectTrigger(draft: string, caret: number, guard: { tier: 'plain' | 'claimed' | 'frozen' }): {
  trigger: '/' | '@'; query: string; quoted: boolean; position: 'leading' | 'inline'; span: { start: number; end: number };
} | null;
export class InputTriggerController {
  constructor(deps: { actx: any; sessionId: string; roster: { sources(trigger: string): readonly InputSource[]; all(): readonly InputSource[] } });
  readonly menu: Store<{ open: boolean; generation: number; hit: { trigger: '/' | '@'; query: string; position: 'leading' | 'inline'; quoted: boolean; span: InputSpan } | null;
    groups: readonly { source: string; status: 'pending' | 'ready'; items: readonly import('../../inputTriggers.ts').InputCandidate[] }[];
    highlight: { source: string; index: number } | null }>;
  readonly launcher: Store<string | null>;
  readonly headers: Store<ReadonlyMap<string, readonly { label: string; value: string; current?: boolean }[]>>;
  readonly lexicon: Store<ReadonlyMap<'/' | '@', readonly string[]>>;
  track(draft: string, caret: number, guard: { tier: 'plain' | 'claimed' | 'frozen' }, draftRev: number): void;
  toggleSource(source: string, hit: unknown): void;
  pick(source: string, index: number, action?: 'pick' | 'drill'): void;
  pickCrumb(source: string, index: number): void;
  hover(source: string, index: number): void;
  arbitrate(key: 'up' | 'down' | 'enter' | 'escape' | 'tab' | 'tabBack', composing: boolean): 'consumed' | 'pick-highlighted' | 'pass';
  onSpace(): boolean;
  serializeReference(source: string, ref: string, signal: AbortSignal): Promise<string>;
  openReference(source: string | undefined, reference: { ref: string; appearance?: string }): boolean;
  adjudicate(line: string, signal: AbortSignal, envelope: { attachments: number }): Promise<unknown>;
  sourceAdded(source: InputSource): void;
  sourceRemoved(source: InputSource): void;
  dismiss(): void;
  refreshOpenMenu(): void;
  dispose(): void;
}
