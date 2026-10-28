import assert from "node:assert/strict";
import test from "node:test";
import { contentEchoesProcessCommentary, messageWithDeliveryContent, processActivitiesWithCommentary } from "../src/processCommentary.ts";

const 说明 = "已生成 10/13 素材（199 条）。四个选题里「中加建交」「法国进入第四共和国」在素材清单内，现在并行核实史实。";

test("执行中正文与本轮说明相同：判定为重复，正文不再显示", () => {
  const message = {
    content: 说明,
    activities: [
      { id: "t1", kind: "thinking", title: "思考过程", status: "success", detail: "…", commentary: 说明 },
    ],
  };
  assert.equal(contentEchoesProcessCommentary(message, { streaming: true }), true);
});

test("执行中正文与说明只差首尾空白：仍判定为重复", () => {
  const message = {
    content: `\n  ${说明}  \n`,
    activities: [
      { id: "t1", kind: "thinking", title: "思考过程", status: "success", commentary: ` ${说明} ` },
    ],
  };
  assert.equal(contentEchoesProcessCommentary(message, { streaming: true }), true);
});

test("收尾后（不再是流式）不判定为重复：最终答复必须显示", () => {
  const message = {
    content: 说明,
    activities: [
      { id: "t1", kind: "thinking", title: "思考过程", status: "success", commentary: 说明 },
    ],
  };
  assert.equal(contentEchoesProcessCommentary(message, { streaming: false }), false);
});

test("正文最终答复与过程说明不同：正常显示", () => {
  const message = {
    content: "已完成四个选题的史实核查，结论如下：…",
    activities: [
      { id: "t1", kind: "thinking", title: "思考过程", status: "success", commentary: 说明 },
      { id: "c1", kind: "run_command", title: "已运行 bun scripts/generate-to", status: "success" },
    ],
  };
  assert.equal(contentEchoesProcessCommentary(message, { streaming: true }), false);
});

test("正文为空或只有空白：不判定为重复", () => {
  const activities = [
    { id: "t1", kind: "thinking", title: "思考过程", status: "success", commentary: 说明 },
  ];
  assert.equal(contentEchoesProcessCommentary({ content: "", activities }, { streaming: true }), false);
  assert.equal(contentEchoesProcessCommentary({ content: "   \n", activities }, { streaming: true }), false);
});

test("过程里没有说明文字（如只有工具调用）：不判定为重复", () => {
  const message = {
    content: 说明,
    activities: [
      { id: "a1", kind: "read_file", title: "读取 post-to-wechat/2026-10-13/history-material.md", status: "success" },
      { id: "t1", kind: "thinking", title: "思考过程", status: "success", detail: "…" },
    ],
  };
  assert.equal(contentEchoesProcessCommentary(message, { streaming: true }), false);
});

test("较早轮次的说明与当前正文相同：同样只保留过程流里那一处", () => {
  const message = {
    content: 说明,
    activities: [
      { id: "t0", kind: "thinking", title: "思考过程", status: "success", commentary: 说明 },
      { id: "a1", kind: "run_command", title: "已运行 bun scripts/generate-to", status: "success" },
      { id: "t1", kind: "thinking", title: "思考过程", status: "running", detail: "" },
    ],
  };
  assert.equal(contentEchoesProcessCommentary(message, { streaming: true }), true);
});

test("子代理分支里的说明不算：正文该显示就显示", () => {
  const message = {
    content: 说明,
    activities: [
      {
        id: "s1",
        kind: "dispatch_agent",
        title: "派发子任务：核查史实",
        status: "running",
        children: [
          { id: "t9", kind: "thinking", title: "思考过程", status: "success", commentary: 说明 },
        ],
      },
    ],
  };
  assert.equal(contentEchoesProcessCommentary(message, { streaming: true }), false);
});

const call = (name) => ({ function: { name } });
const oldMessage = () => ({
  activities: [
    { id: "t1", kind: "thinking", status: "success", detail: "内部推理" },
    { id: "a1", kind: "run_command", status: "success" },
    { id: "t2", kind: "thinking", status: "success" },
    { id: "a2", kind: "read_file", status: "success" },
    { id: "t3", kind: "thinking", status: "success" },
  ],
  executedMessages: [
    { role: "assistant", content: "先检查成片。", tool_calls: [call("run_command")] },
    { role: "tool", content: "检查输出" },
    { role: "assistant", content: "检查通过，接着核对说明。", tool_calls: [call("read_file")] },
    { role: "tool", content: "文件内容" },
    { role: "assistant", content: "已完成。" },
  ],
});

test("旧存档按轮恢复过程正文，保留工具顺序，最终答复与推理不混入说明", () => {
  const message = oldMessage();
  const activities = processActivitiesWithCommentary(message);
  assert.deepEqual(activities.map(a => a.id), ["t1", "a1", "t2", "a2", "t3"]);
  assert.equal(activities[0].commentary, "先检查成片。");
  assert.equal(activities[2].commentary, "检查通过，接着核对说明。");
  assert.equal(activities[4].commentary, undefined);
  assert.equal(activities[0].detail, "内部推理");
  assert.equal(message.activities[0].commentary, undefined, "不改写原始存档");
});

test("已有说明与显式清空值不被旧记录覆盖，finish_task 的交付正文不重复", () => {
  const message = oldMessage();
  message.activities[0].commentary = "已保存的说明";
  message.activities[2].commentary = "";
  message.executedMessages.at(-1).tool_calls = [call("finish_task")];
  assert.equal(processActivitiesWithCommentary(message), message.activities);
});

test("缺失轮次、失败轮次与 DSH 会话不猜测归属", () => {
  for (const edit of [
    m => m.executedMessages.pop(),
    m => { m.activities[0].status = "error"; },
    m => { m.activities[0].status = "running"; },
    m => { m.dshTurnId = "dsh-turn"; },
    m => { m.executedMessages = []; },
  ]) {
    const message = oldMessage();
    edit(message);
    assert.equal(processActivitiesWithCommentary(message), message.activities);
  }
});

test("重复的进度说明仍保留各自轮次，子代理思考不占主任务轮次", () => {
  const message = oldMessage();
  message.executedMessages[2].content = "先检查成片。";
  message.activities.splice(1, 0, { id: "child", kind: "thinking", status: "success", branch: { parentId: "parent" } });
  const activities = processActivitiesWithCommentary(message);
  assert.equal(activities[0].commentary, "先检查成片。");
  assert.equal(activities[3].commentary, "先检查成片。");
  assert.equal(activities[1].commentary, undefined);
});

const completedMessage = () => ({
  role: "assistant", taskStatus: "done", content: "候选清单已给出，回复编号即可。",
  activities: [
    { id: "before", kind: "thinking", status: "success", commentary: "正在核实日期。" },
    { id: "answer", kind: "thinking", status: "success", commentary: "## 候选清单\n\n1. 广州解放\n2. 惠州战役" },
    { id: "final", kind: "thinking", status: "success" },
  ],
  executedMessages: [
    { role: "assistant", content: "正在核实日期。", tool_calls: [call("read_file")] },
    { role: "tool", content: "资料原文" },
    { role: "assistant", content: "## 候选清单\n\n1. 广州解放\n2. 惠州战役", tool_calls: [
      { function: { name: "update_plan", arguments: JSON.stringify({ steps: [{ title: "核实并列出候选", status: "completed" }] }) } },
      call("save_memory"),
    ] },
    { role: "assistant", content: "候选清单已给出，回复编号即可。" },
  ],
});

test("旧聊天完整候选答复恢复到正文，过程仅保留实际进度，反复打开不重复", () => {
  const original = completedMessage();
  const restored = messageWithDeliveryContent(original);
  assert.match(restored.content, /## 候选清单/);
  assert.equal(restored.content, original.executedMessages[2].content);
  assert.equal(restored.activities[0].commentary, "正在核实日期。");
  assert.equal(processActivitiesWithCommentary(restored)[1].commentary, "");
  assert.equal(original.activities[1].commentary, original.executedMessages[2].content);
  assert.equal(messageWithDeliveryContent(restored).content, restored.content);
});

test("运行、停止、挂起与独立会话投影不恢复交付正文，失败只补充停止提示", () => {
  for (const status of [undefined, "cancelled", "paused", "sleeping"]) {
    const message = { ...completedMessage(), taskStatus: status };
    assert.equal(messageWithDeliveryContent(message), message);
  }
  const failed = { ...completedMessage(), taskStatus: "error" };
  const restored = messageWithDeliveryContent(failed);
  assert.ok(restored.content.startsWith(failed.content));
  assert.match(restored.content, /任务未完成，已停止/);
  assert.doesNotMatch(restored.content, /## 候选清单/);
  assert.equal(restored.activities, failed.activities);
  const message = { ...completedMessage(), dshTurnId: "turn" };
  assert.equal(messageWithDeliveryContent(message), message);
});

test("旧聊天轮次不匹配仍恢复答案，但不误删过程记录", () => {
  const message = completedMessage();
  message.activities.pop();
  const restored = messageWithDeliveryContent(message);
  assert.match(restored.content, /## 候选清单/);
  assert.equal(restored.activities[1].commentary, message.activities[1].commentary);
});


test("旧聊天未明确来源时，重开只显示最完整的一段", () => {
  const original = completedMessage();
  original.content = `${original.executedMessages[2].content}\n\n${original.content}`;
  const restored = messageWithDeliveryContent(original);
  assert.equal(restored.content, original.executedMessages[2].content);
  assert.equal(messageWithDeliveryContent(JSON.parse(JSON.stringify(restored))).content, restored.content);
});


test("存档明确引用前段时，重开保留正式回答且清除过程里的重复正文", () => {
  const original = completedMessage();
  original.executedMessages.at(-1).tool_calls = [{ function: { name: "finish_task", arguments: JSON.stringify({ answer_source: "previous_reply", summary: original.content }) } }];
  const restored = messageWithDeliveryContent(original);
  assert.equal(restored.content, original.executedMessages[2].content);
  assert.equal(restored.activities[1].commentary, "");
  assert.equal(messageWithDeliveryContent(JSON.parse(JSON.stringify(restored))).content, restored.content);
});

test("存档明确选择最后一段时，展示最后的完整答案，不拼接前段", () => {
  for (const source of ["current_reply", "summary"]) {
    const message = completedMessage();
    const current = "更正后的完整回答。";
    const summary = "参数中指定的完整回答。";
    message.executedMessages.at(-1).content = current;
    message.executedMessages.at(-1).tool_calls = [{ function: { name: "finish_task", arguments: JSON.stringify({ answer_source: source, summary }) } }];
    message.content = `${message.executedMessages[2].content}\n\n${current}`;
    const restored = messageWithDeliveryContent(message);
    assert.equal(restored.content, source === "current_reply" ? current : summary);
    assert.equal(restored.activities[1].commentary, message.activities[1].commentary);
  }
});

test("截图回归：完整答案后保存模板，重新打开仍在正文且过程不重复", () => {
  for (const source of [undefined, "previous_reply"]) {
    const original = completedMessage();
    original.executedMessages[2].tool_calls.push(call("save_skill"));
    original.executedMessages.at(-1).tool_calls = [{ function: { name: "finish_task", arguments: JSON.stringify({ answer_source: source, summary: original.content }) } }];
    const restored = messageWithDeliveryContent(original);
    assert.equal(restored.content, original.executedMessages[2].content);
    assert.equal(processActivitiesWithCommentary(restored)[1].commentary, "");
    const reopened = messageWithDeliveryContent(JSON.parse(JSON.stringify(restored)));
    assert.equal(reopened.content, restored.content);
    assert.equal(processActivitiesWithCommentary(reopened)[1].commentary, "");
  }
});
