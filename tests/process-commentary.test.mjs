import assert from "node:assert/strict";
import test from "node:test";
import { contentEchoesProcessCommentary, processActivitiesWithCommentary } from "../src/processCommentary.ts";

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
