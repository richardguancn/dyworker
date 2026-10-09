import { Context, Service } from '@deepseek-ai/cordis';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';

export interface Observable<T> {getSnapshot(): T; subscribe(listener: () => void): () => void}
export interface ConversationBinding {
  snapshot: Observable<{views: {get(target: string): any; grouped(target: string): any}; activeTargets: readonly string[]}>;
  openTurn: Observable<number | undefined>;
  activate(target: string): void;
  target(target: string): Observable<any>;
}
export interface DefinitionRegistry {
  register(definition: any): () => void;
  entries(): readonly any[];
  subscribe(listener: () => void): () => void;
}
export class MutableSessionEventSource implements Observable<any> {
  getSnapshot(): any;
  subscribe(listener: () => void): () => void;
  replace(entries: readonly any[], hasMore: boolean): void;
  prepend(entries: readonly any[], hasMore: boolean): void;
  append(entry: any): void;
  settleAssistant(attemptId: string, entry?: any): void;
}
export class UiConversation extends Service {
  constructor(ctx: Context, sessions: {binding(id: string): any});
  events: DefinitionRegistry & {registerFallback(definition: any): () => void; fallbackEntry(): any; forEvent(type: string): ReadonlySet<any>};
  views: DefinitionRegistry;
  groups: DefinitionRegistry;
  binding(source: string | {sessionId: string}): ConversationBinding;
  imageUrl(id: string, attachment: ImageAttachmentRef): Promise<string>;
  peekImageUrl(id: string, attachment: ImageAttachmentRef): string | undefined;
  seedImageUrl(id: string, attachment: ImageAttachmentRef, url: string): boolean;
  inspectSystemPrompt(previous: any, event: any): any;
  inspectRequestPrompt(previous: any, event: any, system: any): any;
}
