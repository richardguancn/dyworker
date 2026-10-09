import test from 'node:test';
import assert from 'node:assert/strict';
import { recordTaskFailure } from '../src/taskFailure.ts';

test('任务失败按所属回复归并，结束事件与失败返回次序不同也不追加重复回复', () => {
  const user = { role: 'user', content: '任务要求', runId: 'own' };
  const foreign = { role: 'assistant', id: 'foreign', runId: 'other', content: '另一条请求仍在运行' };
  const placeholder = { role: 'assistant', id: 'own-reply', runId: 'own', content: '' };
  const failure = { assistantId: 'own-reply', runId: 'own', detail: '缺少模型设置', createdAt: '2026-10-07T00:00:00.000Z' };
  const beforeEvent = recordTaskFailure([user, foreign, placeholder], failure);
  assert.equal(beforeEvent.length, 3);
  assert.equal(beforeEvent[1], foreign);
  assert.equal(beforeEvent[2].taskStatus, 'error');
  assert.match(beforeEvent[2].content, /缺少模型设置/);
  assert.equal(recordTaskFailure(beforeEvent, failure), beforeEvent);
  const afterEvent = [user, foreign, { ...placeholder, taskStatus: 'error', content: '结束事件里的具体失败原因' }];
  assert.equal(recordTaskFailure(afterEvent, failure), afterEvent);
  const completed = [user, { ...placeholder, taskStatus: 'done', content: '已实际完成' }];
  assert.equal(recordTaskFailure(completed, failure), completed, '已经交付的回复不能被随后通讯错误覆盖');
});

test('没有桌面回复占位时仍保留失败；已有部分正文时保留正文并归并失败', () => {
  const failure = { runId: 'run', detail: '连接失败', createdAt: '2026-10-07T00:00:00.000Z' };
  const preview = recordTaskFailure([{ role: 'user', content: '要求' }], failure);
  assert.equal(preview.length, 2);
  assert.equal(preview[1].taskStatus, 'error');
  const partial = recordTaskFailure([{ id: 'reply', role: 'assistant', content: '已读完资料' }], { ...failure, assistantId: 'reply' });
  assert.equal(partial.length, 1);
  assert.match(partial[0].content, /已读完资料\n\n请求没有完成：连接失败/);
});
