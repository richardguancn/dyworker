import assert from 'node:assert/strict';
import test from 'node:test';
import { taskResultText } from '../electron/task-result.mts';
import { messageWithDeliveryContent } from '../src/processCommentary.ts';
import { createTranscriptCollector } from './helpers/main-transcript.mjs';

const progress = '渲染已生成 30.6 MB 文件。现在核验音频与画面。';
const reason = '模型服务返回了异常格式的回复，已停止接收。请检查模型服务或更换模型后重试。';
const result = { status: 'error', finalText: progress, reason };

test('有进展、无进展、仅收到失败事件时都显示停止原因，重复收尾不重复追加', () => {
  const text = taskResultText(result);
  assert.ok(text.startsWith(progress));
  assert.match(text, /任务未完成，已停止/);
  assert.ok(text.endsWith(reason));
  assert.equal(taskResultText({ ...result, finalText: text }), text);
  assert.equal(taskResultText({ ...result, finalText: '' }, progress), text);
  assert.equal(taskResultText({ ...result, finalText: '' }), `**任务未完成，已停止**：${reason}`);
  assert.equal(taskResultText({ ...result, finalText: reason }), `**任务未完成，已停止**：${reason}`);
  assert.match(taskResultText({ status: 'error' }), /任务未完成，已停止/);
  for (const status of ['done', 'sleeping', 'paused', 'cancelled', 'unverified']) {
    assert.equal(taskResultText({ ...result, status }), progress);
  }
});

test('历史失败记录从最后一次主请求恢复原因，不修改存档，不把早先工具失败当成停止原因', () => {
  const old = { role: 'assistant', content: progress, taskStatus: 'error', activities: [
    { id: 'tool', kind: 'run_command', status: 'error', detail: '先前已恢复的工具错误' },
    { id: 'last', kind: 'thinking', status: 'error', detail: reason },
    { id: 'branch', kind: 'thinking', branch: 'child', status: 'error', detail: '子任务错误' },
  ] };
  const restored = messageWithDeliveryContent(old);
  assert.equal(restored.content, taskResultText(result));
  assert.equal(old.content, progress);
  assert.equal(messageWithDeliveryContent(old), restored);
  assert.equal(messageWithDeliveryContent(restored), restored);
  const noReason = messageWithDeliveryContent({ ...old, activities: old.activities.slice(0, 1) });
  assert.doesNotMatch(noReason.content, /先前已恢复/);
  assert.match(noReason.content, /任务未完成，已停止/);
  for (const status of ['done', 'sleeping', undefined]) {
    const normal = { ...old, taskStatus: status };
    assert.equal(messageWithDeliveryContent(normal), normal);
  }
});

test('自动任务收集器保存失败原因，重读后与显示内容一致，显式媒体附注仍保留', () => {
  const collector = createTranscriptCollector({ runId: 'failed-run' });
  const saved = JSON.parse(JSON.stringify(collector.buildMessages('制作视频', result))).at(-1);
  assert.equal(saved.content, taskResultText(result));
  assert.equal(saved.taskReason, reason);
  assert.equal(saved.taskStatus, 'error');
  assert.equal(messageWithDeliveryContent(saved).content, saved.content);
  const withMedia = collector.buildMessages('制作视频', result, `${saved.content}（已发送 1 个文件）`).at(-1);
  assert.equal(withMedia.content.match(/任务未完成，已停止/g).length, 1);
  assert.match(withMedia.content, /已发送 1 个文件/);
});

test('多轮会话失败提示只加在最后一轮，之前完成的回复不变', () => {
  const time = '2026-10-26T00:00:00Z';
  const turns = ['第一轮已完成。', progress].map((text, i) => ({
    user: { id: `u${i}`, text: `要求${i}`, createdAt: time },
    replies: [{ id: `a${i}`, text, createdAt: time, executedMessages: [] }],
  }));
  const collector = createTranscriptCollector({ runId: 'multi' });
  collector.handle({ type: 'dsh-conversation', turns });
  const messages = collector.buildMessages('制作视频', { ...result, dshTurns: turns });
  assert.equal(messages[1].content, turns[0].replies[0].text);
  assert.equal(messages[1].taskStatus, 'done');
  assert.equal(messages.at(-1).content, taskResultText(result));
  assert.equal(messages.at(-1).taskStatus, 'error');
  assert.equal(messages.at(-1).taskReason, reason);
});
