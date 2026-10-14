import test from 'node:test';
import assert from 'node:assert/strict';
import { planProgress } from '../src/planProgressState.ts';

const message = { role: 'assistant', content: '', plan: [
  { title: '检查现状', status: 'completed' },
  { title: '调整界面', status: 'in_progress' },
  { title: '验证结果', status: 'pending' },
] };

test('进度跟随计划更新，全部步骤完成后仍等待任务收尾', () => {
  assert.deepEqual(planProgress(true, message), { completed: 1, total: 3, percent: 33, title: '调整界面' });
  const next = { ...message, plan: message.plan.map((step, i) => ({ ...step, status: i === 2 ? 'in_progress' : 'completed' })) };
  assert.deepEqual(planProgress(true, next), { completed: 2, total: 3, percent: 67, title: '验证结果' });
  const done = { ...message, plan: message.plan.map(step => ({ ...step, status: 'completed' })) };
  assert.equal(planProgress(true, done).percent, 100);
  assert.equal(planProgress(true, done).title, '计划步骤已完成，正在收尾');
  assert.equal(message.plan[1].status, 'in_progress');
});

test('完成、失败、停止、切换到空会话或新一轮无计划时隐藏，不复用历史计划', () => {
  assert.equal(planProgress(false, message), null);
  for (const taskStatus of ['completed', 'failed', 'stopped', 'queued']) {
    assert.equal(planProgress(true, { ...message, taskStatus }), null);
  }
  assert.equal(planProgress(true), null);
  assert.equal(planProgress(true, { role: 'assistant', content: '' }), null);
  assert.equal(planProgress(true, { ...message, plan: [] }), null);
  assert.equal(planProgress(true, { ...message, role: 'user' }), null);
});

test('尚无执行中步骤时展示下一个待办，零完成进度为零', () => {
  const pending = { ...message, plan: message.plan.map(step => ({ ...step, status: 'pending' })) };
  assert.deepEqual(planProgress(true, pending), { completed: 0, total: 3, percent: 0, title: '检查现状' });
});
