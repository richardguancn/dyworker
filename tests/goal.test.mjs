import test from 'node:test';
import assert from 'node:assert/strict';
import { activeGoal, startGoal, changeGoalStatus, goalElapsed, goalDuration, settleGoal } from '../src/goal.ts';
import { queuedGoalPayload, shouldContinueGoal, settledStoredGoal } from '../electron/goal.mts';

const session = () => ({ id: 'a', title: '目标验证', workspacePath: '', messages: [], createdAt: '', updatedAt: '', ...startGoal('完成两项工作', 1000) });

test('目标暂停停止计时，继续累计；完成后不再传给模型', () => {
  const first = session();
  const paused = changeGoalStatus(first, 'paused', undefined, 61000);
  assert.equal(goalElapsed(paused, 900000), 60000);
  assert.equal(activeGoal(paused), undefined);
  const resumed = changeGoalStatus(paused, 'active', undefined, 901000);
  assert.equal(goalElapsed(resumed, 903000), 62000);
  const completed = settleGoal(resumed, resumed, { status: 'done', goalAchieved: true }, 904000);
  assert.equal(completed.goalState.status, 'complete');
  assert.equal(completed.goal, first.goal);
  assert.equal(activeGoal(completed), undefined);
  assert.equal(goalElapsed(completed, 9999999), 63000);
});

test('旧目标、暂停和新一轮目标不被迟到的完成结果改变', () => {
  const first = session();
  const result = { status: 'done', goalAchieved: true };
  for (const current of [changeGoalStatus(first, 'paused'), { ...first, ...startGoal('新的目标') }, { ...first, goal: undefined, goalState: undefined }, { ...first, goalState: { ...first.goalState, id: 'resumed' } }]) {
    assert.equal(settleGoal(current, first, result), current);
  }
});

test('未验证、失败、轮次用尽保留待继续；停止只暂停；挂起不误判完成', () => {
  for (const status of ['error', 'unverified', 'paused', 'done']) {
    const first = session();
    assert.equal(settleGoal(first, first, { status, goalAchieved: status !== 'done', reason: '仍有剩余工作' }).goalState.status, 'blocked');
  }
  const first = session();
  assert.equal(settleGoal(first, first, { status: 'cancelled' }).goalState.status, 'paused');
  assert.equal(settleGoal(first, first, { status: 'sleeping' }), first);
});

test('兼容旧目标，暂停前未知用时不编造；格式覆盖小时和时钟回拨', () => {
  const legacy = { ...session(), goalState: undefined };
  assert.equal(activeGoal(legacy), legacy.goal);
  assert.equal(goalElapsed(legacy), 0);
  assert.equal(changeGoalStatus(legacy, 'paused', undefined, 1000).goalState.elapsedMs, 0);
  assert.equal(goalDuration(7 * 3600000 + 39 * 60000 + 13000), '7h 39m 13s');
  assert.equal(goalDuration(59999), '59s');
  assert.equal(goalDuration(60000), '1m 0s');
  assert.equal(goalElapsed(session(), 0), 0);
});

test('出队时清除旧目标和持续执行，保留消息；正常目标仍可驱动', () => {
  const payload = { goal: '旧目标', loop: { enabled: true, maximum: 10 }, messages: ['排队消息'] };
  for (const current of [{}, ...['paused', 'complete', 'blocked'].map(status => ({ goal: '旧目标', goalState: { status } }))]) {
    const result = queuedGoalPayload(payload, current);
    assert.equal(result.goal, '');
    assert.equal(result.loop.enabled, false);
    assert.deepEqual(result.messages, ['排队消息']);
  }
  const result = queuedGoalPayload(payload, { goal: '新目标', goalState: { status: 'active' } });
  assert.equal(result.goal, '新目标');
  assert.equal(result.loop.maximum, 10);
});

test('结束本轮不等于达成目标；非目标任务保留原结束语义', () => {
  assert.equal(shouldContinueGoal({ finish: {} }, '整体目标'), true);
  assert.equal(shouldContinueGoal({ finish: {}, goalAchieved: true }, '整体目标'), false);
  assert.equal(shouldContinueGoal({ finish: {} }, ''), false);
  assert.equal(shouldContinueGoal({}, ''), true);
});

test('先保存完成结果再启动排队消息，重启读回后仍不带旧目标', () => {
  const first = session();
  const payload = { goal: first.goal, goalId: first.goalState.id, loop: { enabled: true, maximum: 10 } };
  const saved = settledStoredGoal(first, payload, { status: 'done', goalAchieved: true }, 3000);
  assert.equal(saved.goalState.status, 'complete');
  assert.equal(saved.goalState.elapsedMs, 2000);
  assert.equal(queuedGoalPayload(payload, JSON.parse(JSON.stringify(saved))).goal, '');
  assert.equal(queuedGoalPayload(payload, saved).loop.enabled, false);
  assert.equal(settledStoredGoal({ ...first, goalState: { ...first.goalState, id: 'new' } }, payload, { status: 'done', goalAchieved: true }).goalState.status, 'active');
});

test('非目标任务出队保留既有持续执行设置', () => {
  const payload = { loop: { enabled: true, maximum: 4 } };
  assert.deepEqual(queuedGoalPayload(payload, {}).loop, payload.loop);
});
