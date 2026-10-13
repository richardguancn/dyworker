import assert from "node:assert/strict";
import test from "node:test";
import { resolveAssistantDelivery } from "../electron/assistant-delivery.ts";

const tool = (name, args = {}) => ({ function: { name, arguments: JSON.stringify(args) } });
const reply = (content, calls = []) => ({ role: "assistant", content, tool_calls: calls });
const completed = tool("update_plan", { steps: [{ title: "给出答案", status: "completed" }] });
const answer = "## 候选清单\n\n1. 广州解放\n2. 惠州战役";
const summary = "清单已给出。";

test("完整答案随后只更新已完成计划、保存记忆时，正文保留答案与收尾补充", () => {
  const result = resolveAssistantDelivery([
    reply("正在查资料", [tool("read_file")]),
    reply(answer, [completed, tool("save_memory")]),
    { role: "tool", content: "记录已保存" },
    reply(summary),
  ], summary);
  assert.equal(result.text, `${answer}\n\n${summary}`);
  assert.deepEqual(result.promotedReplyIndexes, [1]);
});

test("后续还有实际操作、未完成计划、无工具回复或未知工具时保留在过程", () => {
  for (const calls of [
    [tool("read_file")], [completed, tool("read_file")], [tool("unknown")], [],
    [tool("update_plan", { steps: [{ status: "in_progress" }] })],
    [tool("update_plan", { steps: [] })], [tool("update_plan")],
    [{ function: { name: "update_plan", arguments: "{" } }],
  ]) {
    const result = resolveAssistantDelivery([reply(answer, calls), reply(summary)], summary);
    assert.deepEqual(result, { text: summary, promotedReplyIndexes: [] });
  }
  assert.deepEqual(resolveAssistantDelivery([
    reply(answer, [completed]), reply("继续检查", [tool("read_file")]), reply(summary),
  ], summary), { text: summary, promotedReplyIndexes: [] });
});

test("连续收尾轮按原顺序合并；空收尾轮不截断；相同正文只显示一次", () => {
  assert.equal(resolveAssistantDelivery([
    reply(answer, [completed]), reply(null, [tool("save_memory")]),
    reply("注意日期范围。", [tool("save_memory")]), reply(summary),
  ], summary).text, `${answer}\n\n注意日期范围。\n\n${summary}`);
  assert.equal(resolveAssistantDelivery([reply(answer, [completed]), reply(answer)], answer).text, answer);
  assert.equal(resolveAssistantDelivery([reply(answer, [completed]), reply(`${answer}\n\n${summary}`)], `${answer}\n\n${summary}`).text, `${answer}\n\n${summary}`);
});

test("正式交付也保留前一收尾轮；正在执行工具的末轮不提前归为答案", () => {
  assert.equal(resolveAssistantDelivery([
    reply(answer, [completed]), reply(null, [tool("finish_task")]),
  ], summary).text, `${answer}\n\n${summary}`);
  assert.deepEqual(resolveAssistantDelivery([reply(answer, [completed])], summary), { text: summary, promotedReplyIndexes: [] });
});
