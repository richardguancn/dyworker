// 离线对照：真实执行文件写入，模型响应由确定性模拟提供，不连接付费服务。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAgent } from '../electron/agent.mts';

const originalRequirement = '最初口径：编号A-001，金额10.00。';
const correction = '最终更正：编号A-017，金额12.30，状态待复核；不允许发布。';
const expected = '编号：A-017\n金额：12.30\n状态：待复核\n';
const conversation = () => [
  { role: 'user', content: `整理材料并生成验收结果.txt。${originalRequirement}` },
  ...Array.from({ length: 10 }, (_, index) => [
    { role: 'assistant', content: `第${index}段已核对的中间材料。`.repeat(1800) },
    ...(index === 2 ? [{ role: 'user', content: '补充背景材料。'.repeat(1000) + correction }] : []),
  ]).flat(),
  { role: 'user', content: '按最终更正生成文件，确认内容后交付。' },
];

async function runVariant(contextLimit, invalidOutput) {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-token-eval-'));
  const usage = [], taskInputs = [];
  let taskCalls = 0, summaryCalls = 0;
  const response = message => ({ ok: true, json: async () => ({ choices: [{ message, finish_reason: 'stop' }] }) });
  try {
    const result = await runAgent({ workspacePath, contextLimit, conversation: conversation(),
      settings: { endpoint: 'https://offline.example.test/v1/chat/completions', model: 'offline-fixture', apiKey: 'unused' },
      emit: event => { if (event.type === 'token-usage') usage.push(event); },
      fetchImpl: async (_url, init) => {
        const request = JSON.parse(init.body);
        if (!request.tools) {
          summaryCalls++;
          return response({ role: 'assistant', content: '旧资料已核对；下一步按保留的用户要求生成文件。' });
        }
        taskInputs.push(request.messages);
        const userText = request.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
        if (taskCalls++ === 0) {
          const correct = userText.includes(correction) && !invalidOutput;
          return response({ role: 'assistant', content: null, tool_calls: [{ id: 'write-result', type: 'function',
            function: { name: 'write_file', arguments: JSON.stringify({ path: '验收结果.txt',
              content: correct ? expected : '编号：A-001\n金额：10.00\n状态：已发布\n' }) } }] });
        }
        return response({ role: 'assistant', content: '已生成验收结果文件。' });
      } });
    const actual = await fs.readFile(path.join(workspacePath, '验收结果.txt'), 'utf8');
    // 完成状态和实际内容分别验收；模型声明完成不能代替文件检查。
    const checks = { taskFinished: result.status === 'done', outputCorrect: actual === expected,
      executionRecorded: Boolean(result.executedMessages?.some(message => message.role === 'tool' && message.tool_call_id === 'write-result')),
      userRequirementsPreserved: taskInputs.every(messages => messages.some(message =>
        message.role === 'user' && String(message.content).includes(correction))) };
    return { checks, passed: Object.values(checks).every(Boolean), taskCalls, summaryCalls,
      estimatedTokens: usage.reduce((total, item) => total + item.prompt + item.completion, 0),
      usageEstimated: usage.length > 0 && usage.every(item => item.estimated === true),
      output: actual };
  } finally { await fs.rm(workspacePath, { recursive: true, force: true }); }
}

export async function evaluateTokenEfficiency({ invalidOutput = false } = {}) {
  // 高容量对照保留全部历史；候选方案使用当前自动整理。这不是旧版本成功率对照。
  const baseline = await runVariant(10_000_000, invalidOutput);
  const optimized = await runVariant(32_000, invalidOutput);
  const lowerEstimatedConsumption = optimized.estimatedTokens < baseline.estimatedTokens;
  return { mode: 'offline-simulation', baseline, optimized, lowerEstimatedConsumption,
    passed: baseline.passed && optimized.passed && optimized.summaryCalls > 0 && lowerEstimatedConsumption };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await evaluateTokenEfficiency();
  console.log(JSON.stringify(result, null, 2));
  assert.ok(result.passed, '任务验收或消耗对照没有通过，不能接受本次优化');
}
