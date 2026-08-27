// 渠道会话防重复归约的单测：
// 渠道任务运行期间主进程边跑边转发 agent:event（信封带 channelRun: true），渲染端维护
// 流式占位气泡；收尾时再 sessions:append 最终消息（带同一 runId）。若不做归约，同一条
// 助手回复会在桌面会话里显示两次（流式气泡 + 落库消息）；桌面端在渠道会话里发起的运行
// 也走 agent:event，不带 channelRun 标记，同样不能再造气泡。
// src/channelStream.ts 是 TypeScript，用 esbuild（vite 依赖）转译为 ESM 后测试（同 task-trace）。
import assert from "node:assert/strict";
import { build } from "esbuild";
import fs from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "dyworker-channel-stream-test-"));
const outfile = path.join(tempDir, "channelStream.mjs");
await build({
  entryPoints: ["src/channelStream.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile,
  logLevel: "silent",
});
const {
  isChannelRunEnvelope,
  registerStreamMessage,
  forgetStreamMessage,
  forgetSessionStream,
  takeStreamMessage,
  reconcileChannelAppend,
} = await import(pathToFileURL(outfile).href);

// 统一读成 LF，避免 Windows 检出 CRLF 时多行正则失效（同 desktop-contract）。
const readSource = (url) => fs.readFileSync(url, "utf8").replace(/\r\n/g, "\n");
const main = readSource(new URL("../electron/main.mjs", import.meta.url));
const app = readSource(new URL("../src/App.tsx", import.meta.url));
const types = readSource(new URL("../src/types.ts", import.meta.url));
const styles = readSource(new URL("../src/styles.css", import.meta.url));

test("isChannelRunEnvelope:只有显式打标的渠道运行事件才消费", () => {
  assert.equal(isChannelRunEnvelope({ channelRun: true }), true);
  // 桌面端 runTask 的信封没有 channelRun 字段，必须被拒
  assert.equal(isChannelRunEnvelope({ sessionId: "s1", runId: "r1" }), false);
  assert.equal(isChannelRunEnvelope({ channelRun: false }), false);
  assert.equal(isChannelRunEnvelope(null), false);
  assert.equal(isChannelRunEnvelope(undefined), false);
});

test("takeStreamMessage:delete-on-read,同一 runId 只能取走一次", () => {
  const runs = new Map();
  registerStreamMessage(runs, "run-1", { sessionId: "s1", messageId: "m1" });
  assert.deepEqual(takeStreamMessage(runs, "run-1"), { sessionId: "s1", messageId: "m1" });
  assert.equal(takeStreamMessage(runs, "run-1"), null, "第二次取不到,收尾 append 不会重复替换");
  assert.equal(takeStreamMessage(runs, ""), null);
  assert.equal(takeStreamMessage(runs, "run-404"), null);
});

test("reconcileChannelAppend:收尾消息原位替换流式占位气泡", () => {
  const existing = [
    { id: "user-1", role: "user", content: "问" },
    { id: "placeholder-1", role: "assistant", content: "流式半截正文", activities: [] },
  ];
  const final = { role: "assistant", content: "最终正文", durationMs: 25000 };
  const outcome = reconcileChannelAppend(existing, "placeholder-1", [final]);
  assert.equal(outcome.replacedMessageId, "placeholder-1");
  assert.equal(outcome.messages.length, 2, "替换后不能多出新消息");
  const replaced = outcome.messages[1];
  assert.equal(replaced.id, "placeholder-1", "保留占位 id，React key 与折叠状态稳定");
  assert.equal(replaced.content, "最终正文");
  assert.equal(replaced.durationMs, 25000);
  // 纯函数：入参不被改写，重复调用结果一致（StrictMode 双调 updater 安全）
  const again = reconcileChannelAppend(existing, "placeholder-1", [final]);
  assert.deepEqual(again, outcome);
  assert.equal(existing.length, 2);
  assert.equal(existing[1].content, "流式半截正文");
});

test("reconcileChannelAppend:占位气泡不在消息列表时退化为追加", () => {
  const existing = [{ id: "user-1", role: "user", content: "问" }];
  const outcome = reconcileChannelAppend(existing, "ghost", [{ role: "assistant", content: "最终" }]);
  assert.equal(outcome.replacedMessageId, null);
  assert.equal(outcome.messages.length, 2);
  assert.equal(outcome.messages[1].content, "最终");
});

test("reconcileChannelAppend:没有占位 id 时原样追加", () => {
  const existing = [{ id: "m1", role: "assistant", content: "旧" }];
  // 工作目录切换等早期路径没有流式气泡
  const outcome = reconcileChannelAppend(existing, null, [{ role: "assistant", content: "新" }]);
  assert.equal(outcome.replacedMessageId, null);
  assert.equal(outcome.messages.length, 2);
});

test("forgetStreamMessage/forgetSessionStream:运行收尾后清理映射", () => {
  const runs = new Map();
  registerStreamMessage(runs, "run-1", { sessionId: "s1", messageId: "m1" });
  registerStreamMessage(runs, "run-2", { sessionId: "s1", messageId: "m2" });
  forgetStreamMessage(runs, "run-1");
  assert.equal(runs.has("run-1"), false);
  assert.equal(runs.has("run-2"), true);
  forgetSessionStream(runs, "s1");
  assert.equal(runs.size, 0);
});

test("源码契约:渠道事件信封打 channelRun 标记,收尾 append 带 runId,渲染端按标记过滤", () => {
  // 主进程:渠道运行的事件转发必须打标,否则渲染端无法与桌面运行区分
  assert.match(main, /channelRun:\s*true/);
  // 主进程:收尾 sessions:append 必须带 runId,渲染端才能按 runId 替换占位气泡
  assert.match(main, /webContents\.send\("sessions:append",\s*\{[^}]*runId:\s*channelRunId/s);
  // 渲染端:渠道流式归约必须经过 isChannelRunEnvelope 过滤
  assert.match(app, /isChannelRunEnvelope/);
  // 渲染端:sessions:append 必须经过 reconcileChannelAppend 归约
  assert.match(app, /reconcileChannelAppend/);
});

test("源码契约:思考流(assistant-reasoning)实时转发、归约展示并随消息落库", () => {
  // 主进程:思考流事件必须在渠道实时转发白名单里,渠道任务才能边跑边展示思考内容
  assert.match(main, /CHANNEL_STREAM_EVENT_TYPES[\s\S]*?"assistant-reasoning"/);
  // 主进程:transcript collector 收集思考流,收尾落库时随助手消息保存(回看不丢)
  assert.match(main, /agentEvent\.type === "assistant-reasoning"[\s\S]*?reasoning = String\(agentEvent\.text \|\| ""\)/);
  assert.match(main, /\.\.\.\(reasoning \? \{ reasoning \} : \{\}\)/);
  // 主进程:落库消息带终态 taskStatus,渲染端据此把「正在深度思考…」收口为「思考过程」
  assert.match(main, /taskStatus: result\?\.status/);
  // 渲染端:渠道转发与桌面任务两条事件路径都要归约思考流
  assert.match(app, /event\.type === "assistant-reasoning"/);
  assert.match(app, /agentEvent\.type === "assistant-reasoning"/);
  // 渲染端:消息体类型声明 reasoning 字段,思考块按任务终态决定展开/收起
  assert.match(types, /reasoning\?: string/);
  assert.match(app, /reasoning-block/);
});

test("源码契约:思考内容为固定高度滚动框,流式期间未上翻时自动跟随底部", () => {
  // 样式:固定高度 + 内部滚动,思考框不随内容无限撑高
  assert.match(styles, /\.reasoning-content\s*\{[^}]*\bheight:\s*[\d.]+px[^}]*overflow-y:\s*auto/s);
  // 渲染端:内容更新时把滚动位置压到底部(显示最新内容),仅当用户仍在底部附近
  assert.match(app, /node\.scrollTop = node\.scrollHeight/);
  // 渲染端:onScroll 判定用户是否离开底部:上翻后停止跟随,滚回底部恢复跟随
  assert.match(app, /pinnedRef\.current = node\.scrollHeight - node\.scrollTop - node\.clientHeight <= 24/);
});
