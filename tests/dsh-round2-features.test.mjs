// DSH 第二轮借鉴功能测试：
// 1) Computer Use 防卡键（修饰键释放 + raw CDP 状态追踪 + MCP busy EOF 退出）与无污染重试消息准备
// 2) Office 防坑红线（按需加载）+ office_render 页码边界 + scanExcelFormulaErrors 扫描与风险分类
// 3) 事件触发自动化「三层漏斗」（目录 & URL 0-Token 基线/过滤/防抖/隔离封装 + SchedulerService 不阻塞）
// 4) 前端敏感凭据纯渲染遮罩 + DeepSeek 官方 .zip (Deflate + 树状 mapping) 端到端导入
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";

import { BrowserPageAdapter } from "../electron/browser-page-adapter.mts";
import { executeCdpTool } from "../electron/browser-cdp-session.mts";
import { McpClient } from "../electron/mcp.mts";
import { prepareAgentConversationEntries, stripTaskFailureNote } from "../electron/agent/messages.mts";
import { prepareToolsetDiscovery, activateToolsets } from "../electron/host/toolset-discovery.mts";
import { parseRenderPageRange, scanExcelFormulaErrors } from "../electron/agent/office-tools.mts";
import { READ_ONLY_TOOLS } from "../electron/agent/shared.mts";
import { RISK, classify, toolsNeedingApproval, workspaceWriteTools } from "../electron/risk.mts";
import { evaluateEventFunnel, buildIsolatedEventPrompt } from "../electron/schedule-event-funnel.mts";
import { createHost, disposeHost } from "../electron/host/context.mts";
import { extractConversationsJsonFromZip, isZipBuffer, parseDeepSeekConversations } from "../electron/deepseek-chat-import.mts";
import { createSessionArchive } from "../electron/session-archive.mts";
import { transferIpcPlugin } from "../electron/host/plugins/transfer-ipc.mts";

/** IEEE 802.3 CRC-32（保证 Python zipfile 等严格解压器校验通过） */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 构造标准 Deflate/Store ZIP Buffer（无第三方依赖） */
function buildTestZip(entries) {
  const localChunks = [];
  const cdChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const rawBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const method = entry.deflate ? 8 : 0;
    const compBuf = entry.deflate ? deflateRawSync(rawBuf) : rawBuf;
    const crc = crc32(rawBuf);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(compBuf.length, 18);
    lfh.writeUInt32LE(rawBuf.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);

    localChunks.push(lfh, nameBuf, compBuf);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(compBuf.length, 20);
    cdh.writeUInt32LE(rawBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset, 42);
    cdChunks.push(cdh, nameBuf);

    offset += lfh.length + nameBuf.length + compBuf.length;
  }

  const cdBuf = Buffer.concat(cdChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localChunks, cdBuf, eocd]);
}

// ---------------- 模块 1：Computer Use 防卡键 & 无污染重试 ----------------

test("模块1：BrowserPageAdapter.releaseKeyState 释放主键并按序释放激活修饰键", async () => {
  const dispatched = [];
  const adapter = new BrowserPageAdapter({
    isDestroyed: () => false,
    debugger: {
      sendCommand: async (method, params) => {
        dispatched.push({ method, params });
        return {};
      },
    },
  });
  adapter.debuggerAttached = true;
  adapter.lastInputState.keyDown = { fromRawCdp: true, key: "c", code: "KeyC", keyCode: 67, modifiers: 2 | 8 };
  await adapter.releaseKeyState();

  assert.equal(adapter.lastInputState.keyDown, null);
  assert.deepEqual(
    dispatched.map((item) => item.params.key),
    ["c", "Shift", "Control"],
    "主键放开后应补发残留 Shift / Control keyUp",
  );
  assert.ok(dispatched.every((item) => item.method === "Input.dispatchKeyEvent" && item.params.type === "keyUp"));
});

test("模块1：executeCdpTool 直接发送 Input.dispatchMouseEvent/KeyEvent 时同步追踪按下状态", async () => {
  const adapter = new BrowserPageAdapter({ isDestroyed: () => false });
  adapter.sendCDP = async (_method, _params, options) => {
    options?.onDispatch?.();
    return { ok: true };
  };
  const opts = { isFullCdpAccessEnabled: () => true };

  await executeCdpTool(adapter, {
    action: "send",
    method: "Input.dispatchMouseEvent",
    params: { type: "mousePressed", x: 100, y: 200, button: "left", clickCount: 1 },
  }, opts);
  assert.deepEqual(adapter.lastInputState.mouseDown, { x: 100, y: 200, button: "left", clickCount: 1 });

  await executeCdpTool(adapter, {
    action: "send",
    method: "Input.dispatchMouseEvent",
    params: { type: "mouseReleased", x: 100, y: 200, button: "left" },
  }, opts);
  assert.equal(adapter.lastInputState.mouseDown, null);

  await executeCdpTool(adapter, {
    action: "send",
    method: "Input.dispatchKeyEvent",
    params: { type: "keyDown", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, modifiers: 1 },
  }, opts);
  assert.equal(adapter.lastInputState.keyDown?.key, "Alt");

  await executeCdpTool(adapter, {
    action: "send",
    method: "Input.dispatchKeyEvent",
    params: { type: "keyUp", key: "Alt", modifiers: 0 },
  }, opts);
  assert.equal(adapter.lastInputState.keyDown, null);
});

test("模块1：McpClient.close 在 isolateProcessTree && busy 时先关闭 stdin 等待子进程自行清理", async () => {
  const events = [];
  const client = new McpClient({
    command: "node",
    isolateProcessTree: true,
    shutdownGraceMs: 500,
  });
  let closedCallback = null;
  client.process = {
    pid: 999999,
    exitCode: null,
    killed: false,
    stdin: {
      writable: true,
      end: () => {
        events.push("stdin-end");
        setTimeout(() => {
          if (client.process) client.process.exitCode = 0;
          closedCallback?.();
        }, 20);
      },
    },
    once: (evt, cb) => {
      if (evt === "close") closedCallback = cb;
    },
    kill: () => {
      events.push("sigkill");
    },
  };

  await client.close({ busy: true });
  assert.equal(events[0], "stdin-end");
  assert.equal(client.process, null);
});

test("模块1：stripTaskFailureNote 与 prepareAgentConversationEntries 避免失败重试污染上下文", () => {
  assert.equal(
    stripTaskFailureNote("部分摘要\n\n**任务未完成，已停止**：网络超时"),
    "部分摘要",
  );
  assert.equal(
    stripTaskFailureNote("请求没有完成：429 rate limit"),
    "",
  );

  // 无半程工具进度的纯失败空壳消息：跳过，不回传模型
  assert.deepEqual(
    prepareAgentConversationEntries(
      { role: "assistant", taskStatus: "error", content: "请求没有完成：连接超时" },
      undefined,
      "请求没有完成：连接超时",
    ),
    [],
  );

  // 有 executedMessages 的半程失败消息：保留进度并附加继续提示
  const resumed = prepareAgentConversationEntries(
    {
      role: "assistant",
      taskStatus: "error",
      executedMessages: [
        { role: "assistant", content: "", tool_calls: [{ id: "tc1", type: "function", function: { name: "read_file", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "tc1", content: "ok" },
      ],
    },
    undefined,
    "",
  );
  assert.equal(resumed.length, 3);
  assert.equal(resumed[1].tool_call_id, "tc1");
  assert.match(resumed[2].content, /不要重复执行已成功的副作用操作/);
});

// ---------------- 模块 2：Office 防坑红线 + 视觉自检 & 公式重算 ----------------

test("模块2：Office 组指南按需加载且不增加通用模式首轮工具数；风险分类精确", () => {
  const { availableGroups, deferredByGroup } = prepareToolsetDiscovery([
    { type: "function", function: { name: "read_file" } },
    { type: "function", function: { name: "office_render" } },
    { type: "function", function: { name: "office_recalculate" } },
  ]);
  assert.ok(availableGroups.includes("office"));
  const activated = activateToolsets(deferredByGroup, ["office"]);
  assert.match(activated.text, /office_recalculate/);
  assert.match(activated.text, /office_render/);

  assert.deepEqual(parseRenderPageRange("2-8"), { start: 2, end: 3 });
  assert.deepEqual(parseRenderPageRange("4"), { start: 4, end: 4 });
  assert.deepEqual(parseRenderPageRange(""), { start: 1, end: 2 });

  assert.equal(READ_ONLY_TOOLS.has("office_render"), true);
  assert.equal(classify("office_render", { path: "a.docx" }).risk, RISK.READ);
  assert.equal(classify("office_render", { path: "a.docx" }).consequential, false);
  assert.equal(toolsNeedingApproval.has("office_recalculate"), true);
  assert.equal(workspaceWriteTools.has("office_recalculate"), true);
  assert.equal(classify("office_recalculate", { path: "a.xlsx" }).consequential, true);
});

test("模块2：scanExcelFormulaErrors 识别工作表里的 #REF! 与 #DIV/0!", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-xlsx-err-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });
  const xlsxPath = path.join(dir, "bad.xlsx");
  const zipBuf = buildTestZip([
    {
      name: "xl/worksheets/sheet1.xml",
      data: `<worksheet><sheetData><row r="1"><c r="A1" t="e"><f>1/0</f><v>#DIV/0!</v></c><c r="B2" t="e"><f>Sheet9!A1</f><v>#REF!</v></c></row></sheetData></worksheet>`,
      deflate: true,
    },
  ]);
  await fs.writeFile(xlsxPath, zipBuf);

  const errs = await scanExcelFormulaErrors(xlsxPath);
  assert.ok(errs.some((item) => item.includes("A1") && item.includes("#DIV/0!")));
  assert.ok(errs.some((item) => item.includes("B2") && item.includes("#REF!")));
});

// ---------------- 模块 3：事件触发自动化「三层漏斗」 ----------------

test("模块3：文件夹三层漏斗覆盖基线/无变化跳过/过滤/防抖/隔离触发", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-funnel-dir-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });

  await fs.writeFile(path.join(dir, "a.txt"), "hello world", "utf8");
  const schedule = {
    id: "s1",
    workspacePath: dir,
    triggerType: "folder",
    prompt: "汇总新增报告",
    eventConfig: { extensions: ".md,.txt", keyword: "urgent", debounceSeconds: 10 },
  };

  // 第 1 次：建立基线（0 Token）
  const r1 = await evaluateEventFunnel(schedule, undefined, 1000);
  assert.equal(r1.action, "baseline");

  // 第 2 次：无变化跳过（0 Token）
  const r2 = await evaluateEventFunnel(schedule, r1.nextState, 2000);
  assert.equal(r2.action, "skip");

  // 新增未命中关键词文件：被过滤（0 Token）
  await fs.writeFile(path.join(dir, "b.md"), "normal report", "utf8");
  const r3 = await evaluateEventFunnel(schedule, r2.nextState, 3000);
  assert.equal(r3.action, "filtered");

  // 新增命中关键词文件：先进入 10s 防抖窗口（0 Token）
  await fs.writeFile(path.join(dir, "c.md"), "URGENT invoice attached", "utf8");
  const r4 = await evaluateEventFunnel(schedule, r3.nextState, 4000);
  assert.equal(r4.action, "debounce");
  assert.equal(r4.waitMs, 10000);

  // 未满防抖继续等待
  const r5 = await evaluateEventFunnel(schedule, r4.nextState, 9000);
  assert.equal(r5.action, "debounce");
  assert.equal(r5.waitMs, 5000);

  // 超过防抖窗口：触发并通过 <event_data trust="untrusted"> 隔离
  const r6 = await evaluateEventFunnel(schedule, r5.nextState, 15000);
  assert.equal(r6.action, "trigger");
  assert.ok(r6.eventPayload?.addedFiles?.includes("c.md"));
  const prompt = buildIsolatedEventPrompt(schedule.prompt, r6.eventPayload);
  assert.match(prompt, /<event_data trust="untrusted">/);
  assert.match(prompt, /c\.md/);
});

test("模块3：URL 三层漏斗与 SchedulerService 0-Token 跳过不阻塞同 tick 其他计划", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-sched-funnel-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });

  let html = "<html><body><h1>Release Notes</h1><p>v1.0.0</p></body></html>";
  let clock = new Date("2026-10-01T10:00:00.000Z");
  const scheduled = [];
  const ctx = await createHost({ userDataDir: dir, safeStorage: undefined });
  t.after(async () => { await disposeHost(ctx); });

  const scheduler = ctx.get("scheduler");
  Object.assign(scheduler.hooks, {
    now: () => clock,
    isShuttingDown: () => false,
    runScheduledTask: async (record, meta) => {
      scheduled.push({ id: record.id, meta });
      record.lastStatus = "success";
    },
    fetchImpl: async (url) => new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  });

  // 拒绝内网 URL
  const badUrl = await scheduler.save({
    name: "bad", prompt: "x", workspacePath: dir,
    triggerType: "url", eventConfig: { url: "http://127.0.0.1:8080" },
    recurrence: "minutes_5", nextRun: "2026-10-01T10:00:00.000Z",
  });
  assert.equal(badUrl.ok, false);

  await scheduler.save({
    name: "网址巡检",
    prompt: "总结更新",
    workspacePath: dir,
    triggerType: "url",
    eventConfig: { url: "https://example.com/releases", keyword: "v1.1", debounceSeconds: 0, sessionMode: "reuse" },
    recurrence: "minutes_5",
    nextRun: "2026-10-01T09:59:00.000Z",
  });
  await scheduler.save({
    name: "普通定时",
    prompt: "跑一次普通任务",
    workspacePath: dir,
    triggerType: "time",
    recurrence: "daily",
    nextRun: "2026-10-01T09:59:30.000Z",
  });

  // 同 tick：网址巡检建基线跳过，但不应阻塞普通定时任务立刻执行
  const dispatched1 = await scheduler.checkDueSchedules({ awaitRun: true });
  assert.equal(dispatched1?.name, "普通定时");
  assert.equal(scheduled.length, 1);

  const listAfter1 = await scheduler.list();
  const urlPlan1 = listAfter1.find((p) => p.name === "网址巡检");
  assert.match(urlPlan1.lastFilterNote || "", /基线/);
  assert.equal(urlPlan1.nextRun, "2026-10-01T10:04:00.000Z");

  // 推进时钟 + 网页发生变更并包含关键词 v1.1 -> 触发
  clock = new Date("2026-10-01T10:05:00.000Z");
  html = "<html><body><h1>Release Notes</h1><p>v1.1.0 security fix</p></body></html>";
  const dispatched2 = await scheduler.checkDueSchedules({ awaitRun: true });
  assert.equal(dispatched2?.name, "网址巡检");
  assert.equal(scheduled.length, 2);
  assert.ok(scheduled[1].meta?.eventPayload?.changedLines?.some((line) => line.includes("v1.1.0")));
});

// ---------------- 模块 4：前端凭据遮罩 & DeepSeek 导出包导入 ----------------

test("模块4：secretMask 精准识别多类凭据并只遮罩 URL 口令与 Bearer 主体", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-mask-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });
  const outfile = path.join(dir, "secretMask.mjs");
  await build({
    entryPoints: ["src/lib/secretMask.ts"],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile,
    logLevel: "silent",
  });
  const { findSecretSpans } = await import(pathToFileURL(outfile).href);

  const sample = [
    "OPENAI=sk-proj-1234567890abcdef123456",
    "GH=ghp_1234567890abcdefghij123456",
    "AWS=AKIAIOSFODNN7EXAMPLE",
    "URL=https://alice:SuperSecret99@git.example.com/repo.git",
    "AUTH=Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    "NORMAL=这是普通文本123456",
  ].join("\n");

  const spans = findSecretSpans(sample);
  const secrets = spans.map((s) => sample.slice(s.start, s.end));
  assert.equal(spans.length, 5);
  assert.ok(secrets.includes("sk-proj-1234567890abcdef123456"));
  assert.ok(secrets.includes("ghp_1234567890abcdefghij123456"));
  assert.ok(secrets.includes("AKIAIOSFODNN7EXAMPLE"));
  assert.ok(secrets.includes("SuperSecret99"));
  assert.ok(secrets.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
  assert.equal(findSecretSpans("你好，请帮我分析这份年度报告。").length, 0);
});

test("模块4：DeepSeek .zip 导出包（Deflate + 树状 mapping + THINK/RESPONSE）端到端导入", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-ds-import-"));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }).catch(() => {}); });

  const conversations = [
    {
      id: "ds-conv-1",
      title: "季度财报分析",
      inserted_at: "2026-10-01T08:00:00Z",
      updated_at: "2026-10-01T08:10:00Z",
      mapping: {
        root: { id: "root", parent: null, children: ["n1"], message: null },
        n1: {
          id: "n1",
          parent: "root",
          children: ["n2_old", "n2_new"],
          message: {
            inserted_at: "2026-10-01T08:01:00Z",
            fragments: [{ type: "REQUEST", content: "帮我总结核心指标" }],
          },
        },
        n2_old: {
          id: "n2_old",
          parent: "n1",
          children: [],
          message: {
            inserted_at: "2026-10-01T08:02:00Z",
            fragments: [{ type: "RESPONSE", content: "旧版回复" }],
          },
        },
        n2_new: {
          id: "n2_new",
          parent: "n1",
          children: [],
          message: {
            inserted_at: "2026-10-01T08:05:00Z",
            fragments: [
              { type: "THINK", content: "先核对营收同比增速" },
              { type: "RESPONSE", content: "新版最终结论：营收同比增长 18%。" },
            ],
          },
        },
      },
    },
  ];

  const zipBuf = buildTestZip([
    { name: "export/conversations.json", data: JSON.stringify(conversations), deflate: true },
  ]);
  assert.equal(isZipBuffer(zipBuf), true);
  const extracted = extractConversationsJsonFromZip(zipBuf);
  assert.equal(extracted.ok, true);
  const parsed = parseDeepSeekConversations(extracted.jsonText);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.sessions.length, 1);
  assert.equal(parsed.sessions[0].messages.length, 2);
  assert.equal(parsed.sessions[0].messages[0].role, "user");
  assert.equal(parsed.sessions[0].messages[0].content, "帮我总结核心指标");
  assert.equal(parsed.sessions[0].messages[1].reasoning, "先核对营收同比增速");
  assert.equal(parsed.sessions[0].messages[1].content, "新版最终结论：营收同比增长 18%。");

  // 走真实 transferIpcPlugin 处理句柄导入落盘
  const userData = path.join(root, "userData");
  await fs.mkdir(userData, { recursive: true });
  const zipFile = path.join(root, "deepseek-export.zip");
  await fs.writeFile(zipFile, zipBuf);
  const archive = createSessionArchive({
    dir: path.join(userData, "sessions"),
    legacyFile: path.join(userData, "sessions.json"),
  });
  const handlers = new Map();
  transferIpcPlugin({
    trustedHandle: (ch, fn) => handlers.set(ch, fn),
    fs,
    path,
    platform: process.platform,
    app: { getVersion: () => "0.3.0", getPath: () => userData },
    getMainWindow: () => null,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [zipFile] }), showSaveDialog: async () => ({ canceled: true }) },
    dataFile: (name) => path.join(userData, name),
    readJson: async (_f, fb) => fb,
    writeJson: async () => {},
    readAllSessions: () => archive.loadAll(),
  }).apply({
    sessions: {
      get: (id) => archive.getSync(id),
      replace: (session) => archive.replace(session),
    },
    effect: () => {},
  });

  const res = await handlers.get("sessions:import-package")();
  assert.equal(res.ok, true);
  assert.equal(res.kind, "deepseek");
  assert.equal(res.added, 1);
  const loaded = await archive.loadAll();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].title, "季度财报分析");
});
