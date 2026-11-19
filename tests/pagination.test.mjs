import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONVERSATION_TURN_PAGE_SIZE,
  CONVERSATION_TURN_RAIL_MAX,
  WORKSPACE_SESSION_PAGE_SIZE,
  countEarlierSearchMatches,
  nextWorkspaceVisibleCount,
  resolveWorkspaceVisibleCount,
  sliceConversationWindow,
  sliceTurnRail,
} from '../src/lib/pagination.ts';
import { createConversationIndex } from '../src/performanceCache.ts';

test('分页默认常量符合工作区5条、会话15轮、回合轨20条上限', () => {
  assert.equal(WORKSPACE_SESSION_PAGE_SIZE, 5);
  assert.equal(CONVERSATION_TURN_PAGE_SIZE, 15);
  assert.equal(CONVERSATION_TURN_RAIL_MAX, 20);
});

test('工作区会话支持5条增量展开、搜索全量展示以及收起后重置为5条', () => {
  assert.equal(resolveWorkspaceVisibleCount(12, undefined, false), 5);
  assert.equal(resolveWorkspaceVisibleCount(3, undefined, false), 3);
  assert.equal(resolveWorkspaceVisibleCount(0, undefined, false), 0);

  const step1 = nextWorkspaceVisibleCount(12, 5);
  assert.equal(step1, 10);
  assert.equal(resolveWorkspaceVisibleCount(12, step1, false), 10);

  const step2 = nextWorkspaceVisibleCount(12, step1);
  assert.equal(step2, 12);
  assert.equal(resolveWorkspaceVisibleCount(12, step2, false), 12);

  // 搜索时不截断
  assert.equal(resolveWorkspaceVisibleCount(12, undefined, true), 12);
  // 模拟收起后删除存储条数，再次展开回到5条
  assert.equal(resolveWorkspaceVisibleCount(12, undefined, false), 5);
});

test('长会话轮次按15轮从最新到最旧向上切片并保留原始下标与轮次号', () => {
  const buildIndex = createConversationIndex((user, assistant) => ({
    title: user.content,
    detail: assistant?.content || '',
  }));

  assert.deepEqual(sliceConversationWindow([], [], CONVERSATION_TURN_PAGE_SIZE), {
    startTurnIndex: 0,
    startMessageIndex: 0,
    hiddenTurnCount: 0,
    hasMore: false,
    canCollapse: false,
    loadedTurns: [],
    visibleMessages: [],
  });

  // 含 1 条开场系统消息 + 32 轮（每轮 user + assistant 共 64 条）
  const messages = [{ role: 'system', content: '系统开场' }];
  for (let turn = 0; turn < 32; turn += 1) {
    messages.push({ role: 'user', content: `问题 ${turn}` });
    messages.push({ role: 'assistant', content: `回答 ${turn}` });
  }
  const index = buildIndex(messages);
  assert.equal(index.turns.length, 32);

  // 默认最新 15 轮（第 17..31 轮）
  const page1 = sliceConversationWindow(messages, index.turns, 15);
  assert.equal(page1.startTurnIndex, 17);
  assert.equal(page1.hiddenTurnCount, 17);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.canCollapse, false);
  assert.equal(page1.startMessageIndex, 1 + 17 * 2);
  assert.equal(page1.loadedTurns.length, 15);
  assert.equal(page1.loadedTurns[0].turnIndex, 17);
  assert.equal(page1.loadedTurns[14].turnIndex, 31);
  assert.equal(page1.visibleMessages.length, 30);
  assert.equal(page1.visibleMessages[0].index, 35);
  assert.equal(page1.visibleMessages[0].message.content, '问题 17');

  // 向上加载更多 15 轮（共 30 轮，第 2..31 轮）
  const page2 = sliceConversationWindow(messages, index.turns, 30);
  assert.equal(page2.startTurnIndex, 2);
  assert.equal(page2.hiddenTurnCount, 2);
  assert.equal(page2.hasMore, true);
  assert.equal(page2.canCollapse, true);
  assert.equal(page2.loadedTurns[0].turnIndex, 2);
  assert.equal(page2.visibleMessages[0].index, 5);
  assert.equal(page2.visibleMessages[0].message.content, '问题 2');

  // 加载到第 0 轮时连开场系统消息一并纳入
  const page3 = sliceConversationWindow(messages, index.turns, 45);
  assert.equal(page3.startTurnIndex, 0);
  assert.equal(page3.startMessageIndex, 0);
  assert.equal(page3.hiddenTurnCount, 0);
  assert.equal(page3.hasMore, false);
  assert.equal(page3.canCollapse, true);
  assert.equal(page3.visibleMessages.length, 65);
  assert.equal(page3.visibleMessages[0].message.content, '系统开场');
});

test('左侧回合轨限制最多显示20条最新轮次', () => {
  const turns = Array.from({ length: 30 }, (_, i) => ({ turnIndex: i }));
  const within = sliceTurnRail(turns.slice(0, 15));
  assert.equal(within.clippedCount, 0);
  assert.equal(within.items.length, 15);

  const clipped = sliceTurnRail(turns);
  assert.equal(clipped.clippedCount, 10);
  assert.equal(clipped.items.length, 20);
  assert.equal(clipped.items[0].turnIndex, 10);
  assert.equal(clipped.items[19].turnIndex, 29);

  assert.deepEqual(sliceTurnRail(turns, 0), { items: [], clippedCount: 30 });
});

test('未加载历史消息搜索命中统计仅计算边界之前的消息', () => {
  const messages = [
    { content: '早期 Alpha 方案', displayContent: '早期 Alpha 展示' },
    { content: '普通消息' },
    { content: '第二条 alpha 记录' },
    { content: '已加载区的 alpha 内容' },
  ];
  assert.equal(countEarlierSearchMatches(messages, 3, 'ALPHA'), 2);
  assert.equal(countEarlierSearchMatches(messages, 3, '方案'), 0);
  assert.equal(countEarlierSearchMatches(messages, 0, 'alpha'), 0);
  assert.equal(countEarlierSearchMatches(messages, 3, '   '), 0);
});
