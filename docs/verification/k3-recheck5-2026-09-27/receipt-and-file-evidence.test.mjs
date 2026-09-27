import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgent, verifyTaskEvidence } from '../../../electron/agent.mjs';

const settings = { endpoint: 'https://api.kimi.com/coding/v1/chat/completions', model: 'k3', apiKey: 'synthetic-only' };
const call = (name, args) => ({ id: 'call-1', type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (content, calls) => ({ role: 'assistant', content, ...(calls ? { tool_calls: calls } : {}) });
const response = message => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }) });
async function run(t, user, messages, files = {}) {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'k3-recheck5-'));
  t.after(() => rm(workspacePath, { recursive: true, force: true }));
  for (const [name, value] of Object.entries(files)) await writeFile(path.join(workspacePath, name), value);
  let i = 0;
  const result = await runAgent({ settings, workspacePath, conversation: [{ role: 'user', content: user }], approvalMode: 'full-access', fetchImpl: async () => response(messages[i++]) });
  return { result, workspacePath };
}

test('读取旧 JSON 回执不算本次上传', async t => {
  const { result } = await run(t, '上传本次新文章', [reply(null, [call('run_command', { command: 'cat old-receipt.json' })]), reply('新文章已上传，草稿编号：OLD-DRAFT-1234')], { 'old-receipt.json': '{"media_id":"OLD-DRAFT-1234"}' });
  assert.notEqual(result.status, 'done');
});

test('打印仿造 JSON 回执不算上传', async t => {
  const { result } = await run(t, '上传本次新文章', [reply(null, [call('run_command', { command: "printf '{\"media_id\":\"FAKE-DRAFT-1234\"}'" })]), reply('新文章已上传，草稿编号：FAKE-DRAFT-1234')]);
  assert.notEqual(result.status, 'done');
});

test('四个空白批量项目不能算四篇成功', () => {
  const check = verifyTaskEvidence({ finalText: '四篇全部上传成功', executedTools: [{ name: 'upload_drafts', status: 'success', result: JSON.stringify({ articles: [{}, {}, {}, {}] }) }] });
  assert.equal(check.verified, false);
});

test('真实写入带引号的文件名应通过', async t => {
  const { result, workspacePath } = await run(t, '创建 result.txt', [reply(null, [call('run_command', { command: "printf ok > 'result.txt'" })]), reply('已创建 result.txt')]);
  assert.equal(await readFile(path.join(workspacePath, 'result.txt'), 'utf8'), 'ok');
  assert.equal(result.status, 'done');
});
