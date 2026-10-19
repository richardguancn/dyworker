import assert from "node:assert/strict";
import test from "node:test";
import { AgentLoopGuard } from "../electron/agent-loop-guard.mts";

const call = (args = '{}', id = 'c1') => [{ id, function: { name: 'run_command', arguments: args } }];
const result = (text, image = '') => [{ message: { content: text }, supplementalMessages: image ? [{ content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } }] }] : [] }];

test("发布与音频进度更新时，相同命令可以持续检查", () => {
  for (const outputs of [
    ['Windows 构建中', 'macOS 已完成，Windows 构建中', 'Linux 已完成，Windows 构建中', '全部完成'],
    ['790 794 847', '847 864 900', '903 946 957', '957 980 1000'],
  ]) {
    const guard = new AgentLoopGuard();
    for (const text of outputs) assert.equal(guard.observe(call(), result(`成功\n退出码 0\n${text}`)), 'continue');
  }
});

test("调用编号、参数排版变化不能掩盖无进展循环", () => {
  const guard = new AgentLoopGuard();
  const args = ['{"command":"status", "timeout":10}', '{ "timeout": 10, "command": "status" }'];
  const decisions = Array.from({ length: 4 }, (_, i) => guard.observe(call(args[i % 2], `c${i}`), result('失败\n同一个错误')));
  assert.deepEqual(decisions, ['continue', 'continue', 'warn', 'pause']);
});

test("返回文字及路径相同但截图画面更新时，不应暂停", () => {
  const guard = new AgentLoopGuard();
  for (let i = 0; i < 10; i++) {
    assert.equal(guard.observe(call(), result('成功\n截图已保存到 screen.png', `frame${i}`)), 'continue');
  }
});

test("提醒后出现新结果会重置计数，新的失败仍受保护", () => {
  const guard = new AgentLoopGuard();
  for (let i = 0; i < 3; i++) guard.observe(call(), result('失败\n等待中'));
  assert.equal(guard.observe(call(), result('成功\n进度更新')), 'continue');
  const decisions = Array.from({ length: 4 }, () => guard.observe(call(), result('失败\n无法连接')));
  assert.deepEqual(decisions, ['continue', 'continue', 'warn', 'pause']);
});
