export const WORKSPACE_SESSION_PAGE_SIZE = 5;
export const CONVERSATION_TURN_PAGE_SIZE = 15;

export function resolveWorkspaceVisibleCount(
  total: number,
  storedCount: number | undefined,
  isSearching: boolean,
  pageSize = WORKSPACE_SESSION_PAGE_SIZE,
): number {
  const safeTotal = Math.max(0, total);
  if (isSearching) return safeTotal;
  return Math.min(safeTotal, Math.max(pageSize, storedCount ?? pageSize));
}

export function nextWorkspaceVisibleCount(
  total: number,
  currentVisible: number,
  pageSize = WORKSPACE_SESSION_PAGE_SIZE,
): number {
  const safeTotal = Math.max(0, total);
  return Math.min(safeTotal, Math.max(pageSize, currentVisible) + pageSize);
}

export interface ConversationTurnEntry<Preview> {
  messageIndex: number;
  preview: Preview;
}

export interface LoadedConversationTurn<Preview> extends ConversationTurnEntry<Preview> {
  turnIndex: number;
}

export interface VisibleConversationMessage<Message> {
  message: Message;
  index: number;
}

export interface ConversationWindow<Message, Preview> {
  startTurnIndex: number;
  startMessageIndex: number;
  hiddenTurnCount: number;
  hasMore: boolean;
  canCollapse: boolean;
  loadedTurns: Array<LoadedConversationTurn<Preview>>;
  visibleMessages: Array<VisibleConversationMessage<Message>>;
}

export function sliceConversationWindow<Message, Preview>(
  messages: Message[],
  turns: Array<ConversationTurnEntry<Preview>>,
  loadedTurnCount: number,
  pageSize = CONVERSATION_TURN_PAGE_SIZE,
): ConversationWindow<Message, Preview> {
  const totalTurns = turns.length;
  const effectiveLoadedTurns = Math.min(totalTurns, Math.max(pageSize, loadedTurnCount));
  const startTurnIndex = Math.max(0, totalTurns - effectiveLoadedTurns);
  const hiddenTurnCount = startTurnIndex;
  const startMessageIndex = totalTurns === 0 || startTurnIndex === 0 ? 0 : turns[startTurnIndex].messageIndex;

  return {
    startTurnIndex,
    startMessageIndex,
    hiddenTurnCount,
    hasMore: hiddenTurnCount > 0,
    canCollapse: totalTurns > pageSize && effectiveLoadedTurns > pageSize,
    loadedTurns: turns.slice(startTurnIndex).map((turn, offset) => ({
      ...turn,
      turnIndex: startTurnIndex + offset,
    })),
    visibleMessages: messages.slice(startMessageIndex).map((message, offset) => ({
      message,
      index: startMessageIndex + offset,
    })),
  };
}

export function countEarlierSearchMatches(
  messages: Array<{ content?: string; displayContent?: string }>,
  startMessageIndex: number,
  query: string,
): number {
  const needle = query.trim().toLowerCase();
  if (!needle || startMessageIndex <= 0) return 0;
  let matches = 0;
  const end = Math.min(messages.length, startMessageIndex);
  for (let index = 0; index < end; index += 1) {
    const message = messages[index];
    const visible = String(message.displayContent ?? message.content ?? "").toLowerCase();
    if (visible.includes(needle)) matches += 1;
  }
  return matches;
}
