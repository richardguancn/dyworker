import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAgent } from "../electron/agent.mts";
import { createTranscriptCollector } from "./helpers/main-transcript.mjs";

test("过程正文流式先于工具显示，多轮说明在任务结束保存和重读后仍完整", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-process-transcript-"));
  try {
    await fs.writeFile(path.join(root, "sample.txt"), "代表性的检查输入");
    const collector = createTranscriptCollector({ runId: "progress-run" });
    const events = [];
    const comments = ["先检查输入文件。", "文件已读到，接着确认目录。"];
    let request = 0;
    const result = await runAgent({
      settings: { endpoint: "http://mock.local/v1/chat/completions", model: "mock-model", apiKey: "test" },
      workspacePath: root,
      conversation: [{ role: "user", content: "检查文件和目录" }],
      emit(event) { events.push(event); collector.handle(event); },
      fetchImpl: async () => {
        const round = request++;
        if (round === 2) return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: "文件和目录均已检查。" } }] }) };
        const name = round === 0 ? "read_file" : "list_files";
        const args = round === 0 ? { path: "sample.txt" } : {};
        const parts = [
          { content: comments[round].slice(0, 3) },
          { content: comments[round].slice(3) },
          { tool_calls: [{ index: 0, id: `call-${round}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] },
        ];
        return { ok: true, headers: { get: () => "text/event-stream" }, body: new ReadableStream({
          start(controller) {
            for (const delta of parts) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`));
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
          },
        }) };
      },
    });
    assert.equal(result.status, "done");
    const firstText = events.findIndex(e => e.type === "assistant-text" && e.text === comments[0].slice(0, 3));
    const firstTool = events.findIndex(e => e.type === "activity" && e.activity.kind === "read_file");
    assert.ok(firstText >= 0 && firstTool > firstText);
    const saved = JSON.parse(JSON.stringify(collector.buildMessages("检查文件和目录", result)));
    const assistant = saved.at(-1);
    assert.equal(assistant.content, "文件和目录均已检查。");
    assert.deepEqual(assistant.activities.filter(a => a.commentary).map(a => a.commentary), comments);
    assert.deepEqual(assistant.activities.filter(a => a.kind !== "thinking").map(a => a.kind), ["read_file", "list_files"]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("收集器保留说明、耗时与独立推理，部分更新不清空已有内容，显式空值能清空", () => {
  const collector = createTranscriptCollector({ runId: "metadata" });
  collector.handle({ type: "activity", activity: { id: "t", kind: "thinking", status: "running", detail: "" } });
  collector.handle({ type: "activity-update", id: "t", status: "success", detail: "内部推理", durationMs: 42, commentary: "正在核对结果。" });
  collector.handle({ type: "activity-update", id: "t", status: "success" });
  const activity = collector.buildMessages("检查", { status: "done", finalText: "完成" }).at(-1).activities[0];
  assert.equal(activity.commentary, "正在核对结果。");
  assert.equal(activity.durationMs, 42);
  assert.equal(activity.detail, "内部推理");
  collector.handle({ type: "activity-update", id: "t", status: "success", commentary: "", durationMs: 0 });
  const cleared = collector.buildMessages("检查", { status: "done", finalText: "完成" }).at(-1).activities[0];
  assert.equal(cleared.commentary, "");
  assert.equal(cleared.durationMs, 0);
});

test("会话分轮保存时，晚到的说明和耗时仍更新所属轮次，不覆盖下一轮", () => {
  const collector = createTranscriptCollector({ runId: "dsh-run" });
  const turn = (id, text) => ({ user: { id, text: "要求", createdAt: "2026-10-13T00:00:00Z" },
    replies: [{ id: `${id}:reply`, text, createdAt: "2026-10-13T00:00:01Z", executedMessages: [] }] });
  const first = turn("first", "第一轮答复");
  const second = turn("second", "第二轮答复");
  collector.handle({ type: "dsh-conversation", turns: [first] });
  collector.handle({ type: "activity", activity: { id: "first-thought", kind: "thinking", status: "running" } });
  collector.handle({ type: "dsh-conversation", turns: [first, second] });
  collector.handle({ type: "activity", activity: { id: "second-thought", kind: "thinking", status: "running" } });
  collector.handle({ type: "activity-update", id: "first-thought", status: "success", durationMs: 123, commentary: "第一轮进度说明" });
  const saved = collector.buildMessages("要求", { status: "done", finalText: "第二轮答复", dshTurns: [first, second] });
  assert.equal(saved[1].activities[0].commentary, "第一轮进度说明");
  assert.equal(saved[1].activities[0].durationMs, 123);
  assert.equal(saved[3].activities[0].id, "second-thought");
  assert.equal(saved[3].activities[0].commentary, undefined);
});

test("完整清单与计划收尾同轮时，执行结束和存档重读后都在最终正文中显示一次", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-delivery-"));
  const answer = '## 候选清单\n\n```dyworker-ui\n{"type":"choice","title":"选题","options":[{"label":"广州解放","value":"1"}]}\n```';
  try {
    for (const explicit of [false, true]) {
      const collector = createTranscriptCollector({ runId: `delivery-${explicit}` });
      const events = [];
      let round = 0;
      const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
      const result = await runAgent({
        settings: { endpoint: "http://mock.local/v1/chat/completions", model: "mock-model", apiKey: "test" },
        workspacePath: root,
        conversation: [{ role: "user", content: "给我候选清单" }],
        emit(event) { events.push(event); collector.handle(event); },
        fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: round++ === 0
          ? { role: "assistant", content: answer, tool_calls: [call("plan", "update_plan", { steps: [{ title: "整理清单", status: "completed" }] })] }
          : { role: "assistant", content: "回复编号即可。", ...(explicit ? { tool_calls: [call("finish", "finish_task", { summary: "回复编号即可。", evidence: "已核对清单" })] } : {}) },
        }] }) }),
      });
      assert.equal(result.status, "done");
      assert.equal(result.finalText, `${answer}\n\n回复编号即可。`);
      assert.ok(events.some(event => event.type === "activity-update" && event.commentary === ""));
      const saved = JSON.parse(JSON.stringify(collector.buildMessages("给我候选清单", result))).at(-1);
      assert.equal(saved.content, result.finalText);
      assert.equal(saved.activities[0].commentary, "");
      assert.equal(saved.activities.filter(activity => activity.commentary?.includes("广州解放")).length, 0);
      assert.equal(saved.executedMessages[0].content, answer, "原始回复仍完整保留");
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("提升到最终正文的完成声明仍接受真实执行核验", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-delivery-evidence-"));
  try {
    let round = 0;
    const result = await runAgent({
      settings: { endpoint: "http://mock.local/v1/chat/completions", model: "mock-model", apiKey: "test" },
      workspacePath: root,
      conversation: [{ role: "user", content: "上传文章" }],
      fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: round++ === 0
        ? { role: "assistant", content: "文章已全部上传到公众号草稿箱。", tool_calls: [{ id: "plan", type: "function", function: { name: "update_plan", arguments: JSON.stringify({ steps: [{ title: "上传", status: "completed" }] }) } }] }
        : { role: "assistant", content: "请查看结果。" },
      }] }) }),
    });
    assert.equal(result.status, "unverified");
    assert.match(result.finalText, /系统核验提示/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
