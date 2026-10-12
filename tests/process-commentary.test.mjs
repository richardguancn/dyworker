import assert from "node:assert/strict";
import test from "node:test";
import { contentEchoesProcessCommentary } from "../src/processCommentary.ts";

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
