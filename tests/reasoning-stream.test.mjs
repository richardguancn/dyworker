import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReasoningStream } from '../src/reasoningStream.ts';

test('实时思考覆盖状态提示，只更新当前轮，保留正文和已完成轮次', () => {
  const message = { role: 'assistant', content: '说明', reasoning: '上一轮', activities: [
    { id: 'old', kind: 'thinking', status: 'success', detail: '上一轮' },
    { id: 'tool', kind: 'read_file', status: 'running', detail: '工具详情' },
    { id: 'current', kind: 'thinking', status: 'running', detail: '重试提示' },
  ] };
  const first = applyReasoningStream(message, '先检查资料');
  const second = applyReasoningStream(first, '先检查资料，再核对结果');
  assert.equal(second.activities[2].detail, '先检查资料，再核对结果');
  assert.equal(second.reasoning, second.activities[2].detail);
  assert.equal(second.content, '说明');
  assert.equal(second.activities[0], message.activities[0]);
  assert.equal(second.activities[1], message.activities[1]);
  assert.equal(message.activities[2].detail, '重试提示');
  const retry = applyReasoningStream(second, '');
  assert.equal(retry.activities[2].detail, '');
  assert.equal(retry.reasoning, '');
});

test('没有活动或活动已结束时，兼容独立思考内容且不改写历史活动', () => {
  const message = { role: 'assistant', content: '', activities: [
    { id: 'old', kind: 'thinking', status: 'success', detail: '已完成' },
  ] };
  assert.equal(applyReasoningStream(message, '新内容').activities, message.activities);
  assert.equal(applyReasoningStream({ role: 'assistant', content: '' }, '新内容').reasoning, '新内容');
});
