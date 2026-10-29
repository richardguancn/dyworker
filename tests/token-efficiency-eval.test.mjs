import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTokenEfficiency } from '../evals/run-token-efficiency.mjs';

test('离线对照实际写入并检查文件，统计摘要与所有任务请求，候选方案减少总估算消耗', async () => {
  const result = await evaluateTokenEfficiency();
  assert.ok(result.passed, JSON.stringify(result));
  assert.equal(result.baseline.summaryCalls, 0);
  assert.equal(result.optimized.summaryCalls, 1);
  assert.equal(result.baseline.taskCalls, 2);
  assert.equal(result.optimized.taskCalls, 2);
  assert.ok(result.baseline.usageEstimated && result.optimized.usageEstimated);
  assert.equal(result.baseline.output, result.optimized.output);
});

test('即使声明完成且消耗下降，产出错误的候选方案仍不能通过验收', async () => {
  const result = await evaluateTokenEfficiency({ invalidOutput: true });
  assert.ok(result.lowerEstimatedConsumption);
  assert.ok(result.optimized.checks.taskFinished);
  assert.equal(result.optimized.checks.outputCorrect, false);
  assert.equal(result.passed, false);
});
