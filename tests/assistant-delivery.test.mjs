import assert from "node:assert/strict";
import test from "node:test";
import { resolveAssistantDelivery } from "../electron/assistant-delivery.ts";

const tool = (name, args = {}) => ({ function: { name, arguments: JSON.stringify(args) } });
const reply = (content, calls = []) => ({ role: "assistant", content, tool_calls: calls });
const completed = tool("update_plan", { steps: [{ title: "给出答案", status: "completed" }] });
const answer = "## 候选清单\n\n1. 广州解放\n2. 惠州战役";
const summary = "清单已给出。";

test("完整答案随后只更新已完成计划、保存记忆时，未声明来源只显示最完整的一段", () => {
  const result = resolveAssistantDelivery([
    reply("正在查资料", [tool("read_file")]),
    reply(answer, [completed, tool("save_memory")]),
    { role: "tool", content: "记录已保存" },
    reply(summary),
  ], summary);
  assert.deepEqual(result, { text: answer, promotedReplyIndexes: [1] });
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

test("连续收尾轮逐段比较长度取最完整的一段；空收尾轮不截断；相同正文只显示一次", () => {
  assert.deepEqual(resolveAssistantDelivery([
    reply(answer, [completed]), reply(null, [tool("save_memory")]),
    reply("注意日期范围。", [tool("save_memory")]), reply(summary),
  ], summary), { text: answer, promotedReplyIndexes: [0] });
  assert.equal(resolveAssistantDelivery([reply(answer, [completed]), reply(answer)], answer).text, answer);
  // 旧存档的拼接正文：拆回分段后仍只显示最完整的一段
  assert.equal(resolveAssistantDelivery([reply(answer, [completed]), reply(`${answer}\n\n${summary}`)], `${answer}\n\n${summary}`).text, answer);
});

test("末轮没有正文时以收尾轮的完整回答为准；正在执行工具的末轮不提前归为答案", () => {
  assert.equal(resolveAssistantDelivery([
    reply(answer, [completed]), reply(null, [tool("finish_task")]),
  ], summary).text, answer);
  assert.deepEqual(resolveAssistantDelivery([reply(answer, [completed])], summary), { text: summary, promotedReplyIndexes: [] });
});


test("旧存档未声明来源时只显示最完整的一段，系统核验提示仍保留", () => {
  const warning = "> ⚠️ **系统核验提示**：没有上传凭据。";
  const result = resolveAssistantDelivery([
    reply(answer, [completed]), reply(summary),
  ], `${answer}\n\n${summary}\n\n${warning}`);
  assert.equal(result.text, `${answer}\n\n${warning}`);
});

test("收尾轮没有完整回答时仍使用最后答复", () => {
  assert.deepEqual(resolveAssistantDelivery([
    reply("", [completed]), reply(summary),
  ], summary), { text: summary, promotedReplyIndexes: [] });
});


test("明确选择前段完整回答时，不追加重复收尾", () => {
  const result = resolveAssistantDelivery([
    reply(answer, [completed]),
    reply("本轮仅收尾", [tool("finish_task", { answer_source: "previous_reply", summary })]),
  ], summary);
  assert.deepEqual(result, { text: answer, promotedReplyIndexes: [0] });
});

test("第二段是正式回答或修正时，以明确指定的本轮正文为准", () => {
  const corrected = "更正：前面的判断不成立。新的完整结论如下。";
  assert.deepEqual(resolveAssistantDelivery([
    reply(answer, [completed]),
    reply(corrected, [tool("finish_task", { answer_source: "current_reply", summary })]),
  ], summary), { text: corrected, promotedReplyIndexes: [] });
});

test("完整回答可以明确来自结束参数，不被前段或本轮预告盖掉", () => {
  const complete = "完整的最终结论、依据和建议都在这里。";
  assert.deepEqual(resolveAssistantDelivery([
    reply(answer, [completed]),
    reply("现在给出结论：", [tool("finish_task", { answer_source: "summary", summary: complete })]),
  ], "现在给出结论："), { text: complete, promotedReplyIndexes: [] });
});

test("来源无效、所选正文为空或之前还有实际操作时，退回最完整的一段", () => {
  for (const args of [{ answer_source: "unknown" }, { answer_source: "current_reply" }, { answer_source: "summary", summary: "" }]) {
    assert.deepEqual(resolveAssistantDelivery([
      reply(answer, [completed]), reply(null, [tool("finish_task", args)]),
    ], summary), { text: answer, promotedReplyIndexes: [0] });
  }
  assert.deepEqual(resolveAssistantDelivery([
    reply(answer, [completed]), reply("又做了检查", [tool("read_file")]),
    reply(null, [tool("finish_task", { answer_source: "previous_reply", summary })]),
  ], summary), { text: summary, promotedReplyIndexes: [] });
});

test("旧存档：完整回答后面还接着结束时那段总结时，只显示完整回答", () => {
  // 真实存档形状：收尾轮写了完整回答（只带 save_memory），末轮正文为空、把同一结论再写进
  // finish_task 的 summary，运行期把两段拼成了正文
  const fullAnswer = `${answer}\n\n## 依据\n\n${"产物体积与两个新增目录的大小精确吻合，与项目代码无关。".repeat(6)}`;
  const restatement = `已查明：这次多出的体积与项目代码无关，全部来自 node-llama-cpp，依据与建议见上。`;
  const result = resolveAssistantDelivery([
    reply("先看产物体积分布。", [tool("run_command")]),
    reply(fullAnswer, [tool("save_memory")]),
    { role: "tool", content: "记录已保存" },
    reply(null, [tool("finish_task", { summary: restatement })]),
  ], `${fullAnswer}\n\n${restatement}`);
  assert.deepEqual(result, { text: fullAnswer, promotedReplyIndexes: [1] });
});

test("旧存档：结束时那段总结本身更完整时，显示它（同样只有一段）", () => {
  const restatement = `${answer}\n\n未执行的动作：未改配置、未重新打包，因此"排除后能否加载"未实测；建议先加排除规则再打一次包。`;
  const result = resolveAssistantDelivery([
    reply("结论很短。", [tool("save_memory")]),
    reply(null, [tool("finish_task", { summary: restatement })]),
  ], `结论很短。\n\n${restatement}`);
  assert.deepEqual(result, { text: restatement, promotedReplyIndexes: [] });
});

test("旧存档：收尾轮只写了一句完成说明、末轮才是完整回答时，显示末轮正文", () => {
  // 真实存档形状：收尾轮只写「改动已完成并验证通过。」（带 update_plan + save_memory），
  // 完整回答写在末轮正文里；按先后顺序取会把这句说明当成答复，完整正文反而被藏进过程
  const lead = "改动已完成并验证通过。";
  const result = resolveAssistantDelivery([
    reply("打包流程已到点，检查进度。", [tool("run_command")]),
    reply(lead, [completed, tool("save_memory")]),
    reply(answer, [tool("finish_task", { summary: "改动仅限 package.json。" })]),
  ], `${lead}\n\n${answer}`);
  assert.deepEqual(result, { text: answer, promotedReplyIndexes: [] });
});

test("明确来源后的系统提示不因旧存档重开而消失", () => {
  const warning = "> ⚠️ **系统核验提示**：检查未通过。";
  const messages = [reply(answer, [completed]), reply(null, [tool("finish_task", { answer_source: "previous_reply", summary })])];
  assert.equal(resolveAssistantDelivery(messages, `${answer}\n\n${summary}\n\n${warning}`).text, `${answer}\n\n${warning}`);
});
