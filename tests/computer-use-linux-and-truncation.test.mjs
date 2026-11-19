import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { runAgent } from "../electron/agent.mts";
import { readReviewObservation } from "../electron/approval-context.mts";
import { getPromptDefinition } from "../electron/agent/prompt-locales.mts";
import { planNotepadReplace } from "../electron/desktop/notepad-replace.mts";
import { COMPUTER_USE_TOOL_PREFIX } from "../electron/computer-use.mts";
import { createComputerUseRuntime } from "../electron/desktop/computer-use-runtime.mts";
import {
  createLinuxOcclusionChecker,
  decodePng,
  evaluateWindowStackOcclusion,
  parseXpropMeta,
  parseXpropStacking,
  parseXwininfoGeometry,
  verifyLinuxTargetRegion,
} from "../electron/desktop/linux-screen-check.mts";

const prefix = COMPUTER_USE_TOOL_PREFIX;
const scope = { sessionId: "linux-trun-session", runId: "linux-trun-run" };
const idOf = result => result.result.match(/观察编号：([^\n]+)/)?.[1];

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function makePngBase64(width, height, paint) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = paint(x, y);
      const idx = y * stride + 1 + x * 4;
      raw[idx] = r; raw[idx + 1] = g; raw[idx + 2] = b; raw[idx + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

function mockTool(name, extraProps = {}, required = []) {
  return {
    name,
    description: `Native English description for ${name} which is verbose`,
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "Verbose English app description" },
        window_placement: { type: "string" },
        click_method: { type: "string" },
        key_method: { type: "string" },
        ...extraProps,
      },
      required,
    },
  };
}

function linuxHarness({ initialPng, freshPng, text = 'App=96832 (pid 96832)\nWindow: "360极速浏览器 - OA待办"\n0 frame "360极速浏览器"', inspectOcclusion } = {}) {
  const calls = [];
  let stateCalls = 0;
  const runtime = createComputerUseRuntime(
    { command: "unused", platform: "linux" },
    () => ({
      tools: [
        mockTool("list_apps"),
        mockTool("get_app_state", {
          include_ax: { type: "boolean", description: "long english text" },
          include_screenshot: { type: "boolean", description: "long english text" },
          text_limit: { type: ["integer", "string"] },
          max_tree_nodes: { type: "integer", description: "long english text" },
          max_tree_depth: { type: "integer", description: "long english text" },
        }, ["app"]),
        mockTool("click", {
          element_index: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          mouse_button: { type: "string" },
          click_count: { type: "integer" },
        }, ["app"]),
        mockTool("drag", {
          from_x: { type: "number" }, from_y: { type: "number" },
          to_x: { type: "number" }, to_y: { type: "number" },
        }, ["app", "from_x", "from_y", "to_x", "to_y"]),
        mockTool("press_key", { key: { type: "string" } }, ["app", "key"]),
      ],
      async connect() {},
      async close() {},
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "list_apps") {
          return { text: "360极速浏览器 — 96832 [running]\n旧应用 — 11111 []", images: [] };
        }
        if (name === "get_app_state") {
          stateCalls++;
          const png = stateCalls === 1 ? initialPng : (typeof freshPng === "function" ? freshPng(stateCalls) : freshPng);
          return {
            text: typeof text === "function" ? text(stateCalls) : text,
            images: args.include_screenshot && png ? [{ mimeType: "image/png", data: png }] : [],
          };
        }
        return { text: "ok", images: [] };
      },
    }),
    { inspectOcclusion },
  );
  return { runtime, calls };
}

test("Linux 目标区域 PNG 校验：无关角标变化放行，目标变化、整页滚动、尺寸变化及窗口遮挡均拦截", async t => {
  const basePng = makePngBase64(200, 200, (x, y) => {
    if (x >= 80 && x <= 140 && y >= 90 && y <= 130) return [30, 120, 220, 255];
    return [245, 245, 245, 255];
  });
  const cornerChangedPng = makePngBase64(200, 200, (x, y) => {
    if (x >= 170 && y <= 20) return [220, 60, 60, 255];
    if (x >= 80 && x <= 140 && y >= 90 && y <= 130) return [30, 120, 220, 255];
    return [245, 245, 245, 255];
  });
  const targetChangedPng = makePngBase64(200, 200, (x, y) => {
    if (x >= 95 && x <= 125 && y >= 95 && y <= 125) return [250, 180, 20, 255];
    if (x >= 80 && x <= 140 && y >= 90 && y <= 130) return [30, 120, 220, 255];
    return [245, 245, 245, 255];
  });
  const scrolledPng = makePngBase64(200, 200, (x, y) => {
    if (x >= 80 && x <= 140 && y >= 90 && y <= 130) return [30, 120, 220, 255];
    return [10, 10, 10, 255];
  });
  const resizedPng = makePngBase64(220, 200, () => [245, 245, 245, 255]);

  assert.ok(decodePng(basePng));
  assert.equal(verifyLinuxTargetRegion({ previousImage: { data: basePng }, freshImage: { data: cornerChangedPng }, points: [[110, 110]] }).ok, true);
  assert.equal(verifyLinuxTargetRegion({ previousImage: { data: basePng }, freshImage: { data: targetChangedPng }, points: [[110, 110]] }).ok, false);
  assert.equal(verifyLinuxTargetRegion({ previousImage: { data: basePng }, freshImage: { data: scrolledPng }, points: [[110, 110]] }).ok, false);
  assert.equal(verifyLinuxTargetRegion({ previousImage: { data: basePng }, freshImage: { data: resizedPng }, points: [[110, 110]] }).ok, false);

  // 1. 仅右上角时间/状态角标变化且未被遮挡 -> 正常点击放行
  {
    const { runtime, calls } = linuxHarness({
      initialPng: basePng,
      freshPng: cornerChangedPng,
      inspectOcclusion: async () => ({ status: "clear" }),
    });
    t.after(() => runtime.stopAll());
    const obs = await runtime.call(prefix + "get_shared_app_state", { app: "96832" }, scope);
    assert.equal(obs.ok, true);
    const clicked = await runtime.call(prefix + "click", { app: "96832", observation_id: idOf(obs), x: 110, y: 110, background: false }, scope);
    assert.equal(clicked.ok, true, clicked.result);
    assert.equal(calls.at(-1).name, "click");
  }

  // 2. 点击目标区域变化 -> 拦截，不派发 click
  {
    const { runtime, calls } = linuxHarness({
      initialPng: basePng,
      freshPng: targetChangedPng,
      inspectOcclusion: async () => ({ status: "clear" }),
    });
    t.after(() => runtime.stopAll());
    const obs = await runtime.call(prefix + "get_shared_app_state", { app: "96832" }, scope);
    const clicked = await runtime.call(prefix + "click", { app: "96832", observation_id: idOf(obs), x: 110, y: 110, background: false }, scope);
    assert.equal(clicked.ok, false);
    assert.match(clicked.result, /点击目标区域画面已发生变化/);
    assert.ok(!calls.some(c => c.name === "click"));
  }

  // 3. 截图虽未变，但 X11 窗口栈中目标点被 DYWorker 或其他窗口遮挡 -> 拒绝误点
  for (const verdict of [
    { status: "occluded", isSelf: true, occluderTitle: "DYWorker", occluderPid: 777, point: [110, 110] },
    { status: "unknown", reason: "未能在桌面窗口栈中确认目标应用可见窗口" },
  ]) {
    const { runtime, calls } = linuxHarness({
      initialPng: basePng,
      freshPng: basePng,
      inspectOcclusion: async () => verdict,
    });
    t.after(() => runtime.stopAll());
    const obs = await runtime.call(prefix + "get_shared_app_state", { app: "96832" }, scope);
    const clicked = await runtime.call(prefix + "click", { app: "96832", observation_id: idOf(obs), x: 110, y: 110, background: false }, scope);
    assert.equal(clicked.ok, false);
    assert.match(clicked.result, verdict.status === "occluded" ? /DYWorker 主窗口.*遮挡/ : /无法确认目标位置未被其他窗口遮挡/);
    assert.ok(!calls.some(c => c.name === "click"));
  }
});

test("X11 窗口栈与主窗口遮挡解析准确区分遮挡与并排窗口", async () => {
  const ids = parseXpropStacking("_NET_CLIENT_LIST_STACKING(WINDOW): window id # 0x1000001, 0x2000002");
  assert.deepEqual(ids, ["0x1000001", "0x2000002"]);
  const geo = parseXwininfoGeometry('xwininfo: Window id: 0x1000001 "360极速浏览器"\n  Absolute upper-left X:  100\n  Absolute upper-left Y:  50\n  Width: 800\n  Height: 600\n  Map State: IsViewable');
  assert.deepEqual(geo, { title: "360极速浏览器", x: 100, y: 50, width: 800, height: 600, viewable: true });
  assert.deepEqual(parseXpropMeta("_NET_WM_PID(CARDINAL) = 96832\n_NET_WM_STATE(ATOM) = _NET_WM_STATE_FOCUSED"), {
    pid: 96832, hidden: false, desktop: false,
  });

  // 上层窗口遮住点击点
  const covered = evaluateWindowStackOcclusion({
    windowsBottomToTop: [
      { id: "0x1", pid: 96832, title: "360Browser", x: 0, y: 0, width: 800, height: 600, viewable: true },
      { id: "0x2", pid: 555, title: "DYWorker", x: 50, y: 50, width: 400, height: 400, viewable: true },
    ],
    targetPid: 96832,
    points: [[180, 200]],
    selfPid: 555,
  });
  assert.equal(covered.status, "occluded");
  assert.equal(covered.isSelf, true);

  // 并排不重叠时放行
  const sideBySide = evaluateWindowStackOcclusion({
    windowsBottomToTop: [
      { id: "0x1", pid: 96832, title: "360Browser", x: 0, y: 0, width: 800, height: 600, viewable: true },
      { id: "0x2", pid: 555, title: "DYWorker", x: 820, y: 0, width: 400, height: 600, viewable: true },
    ],
    targetPid: 96832,
    points: [[180, 200]],
    selfPid: 555,
  });
  assert.equal(sideBySide.status, "clear");

  // 探针执行失败时保守返回 unknown（禁止盲目放行）
  const checker = createLinuxOcclusionChecker({ exec: async () => { throw new Error("no display"); } });
  const failed = await checker({ pid: 96832, points: [[10, 10]] });
  assert.equal(failed.status, "unknown");
});

test("Linux 无障碍缺控件提示与不支持图片模型禁止坐标点击", async t => {
  const png = makePngBase64(100, 100, () => [200, 200, 200, 255]);
  const { runtime, calls } = linuxHarness({ initialPng: png, freshPng: png });
  t.after(() => runtime.stopAll());

  // 1. 普通 get_app_state 返回 bare 0 frame 时自动提示改用 get_shared_app_state
  const bare = await runtime.call(prefix + "get_app_state", { app: "96832" }, scope);
  assert.equal(bare.ok, true);
  assert.match(bare.result, /未暴露内部无障碍控件.*get_shared_app_state/);

  // 2. 支持视觉时正常截屏；随后中途因模型不支持图片被切换为 interfaceImagesSupported: false，仍禁止按之前截屏坐标点击
  const obs = await runtime.call(prefix + "get_shared_app_state", { app: "96832" }, scope);
  assert.equal(obs.ok, true);
  assert.equal(obs.images.length, 1);

  const blindClick = await runtime.call(
    prefix + "click",
    { app: "96832", observation_id: idOf(obs), x: 20, y: 20, background: false },
    { ...scope, interfaceImagesSupported: false },
  );
  assert.equal(blindClick.ok, false);
  assert.match(blindClick.result, /模型不支持识别界面截图，禁止按屏幕坐标点击或拖拽/);

  const blindShot = await runtime.call(prefix + "get_shared_app_state", { app: "96832" }, { ...scope, interfaceImagesSupported: false });
  assert.equal(blindShot.ok, false);
  assert.match(blindShot.result, /不支持识别界面图片/);
  assert.ok(!calls.some(c => c.name === "click"));
});

test("Linux reviewer 模式：审核观察走 get_shared_app_state，服从用户钩子，且执行前仍保留最新复核", async t => {
  const png = makePngBase64(120, 120, () => [240, 240, 240, 255]);
  const changedPng = makePngBase64(120, 120, (x, y) => (x >= 40 && x <= 80 && y >= 40 && y <= 80 ? [255, 0, 0, 255] : [240, 240, 240, 255]));
  let stateCall = 0;
  const { runtime, calls } = linuxHarness({
    initialPng: png,
    freshPng: () => {
      stateCall++;
      // review 读取 (stateCall===1 in freshPng, i.e., 2nd total call) 仍一致；真正执行前 (3rd call) 页面变化
      return stateCall >= 2 ? changedPng : png;
    },
    inspectOcclusion: async () => ({ status: "clear" }),
  });
  t.after(() => runtime.stopAll());

  // hook 禁止截图时不绕过
  const blockedObs = await readReviewObservation({
    name: prefix + "click",
    args: { app: "96832", x: 50, y: 50, background: false },
    availableNames: [prefix + "get_app_state", prefix + "get_shared_app_state"],
    check: async reader => reader === prefix + "get_shared_app_state" ? { action: "block", message: "禁止共享桌面截图" } : undefined,
    execute: async () => assert.fail("不应绕过用户规则"),
  });
  assert.equal(blockedObs.available, false);
  assert.match(blockedObs.text, /禁止共享桌面截图/);

  // reviewer 模式端到端：放行截图 -> click 审核时取共享截图 -> 审核放行 -> 真正执行 click 前仍跑复核并捕获变更
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyw-linux-reviewer-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const tools = await runtime.definitions();
  const extraTools = tools;
  let step = 0;
  let reviewImages = 0;
  const approvals = [];
  const result = await runAgent({
    settings: { endpoint: "http://mock.local/v1/chat/completions", model: "vision-model", apiKey: "test", reviewerBackend: "main" },
    workspacePath: root,
    approvalMode: "reviewer",
    extraTools,
    onExtraTool: (name, args, ctx) => runtime.call(name, args, { ...scope, ...ctx }),
    requestApproval: async action => { approvals.push(action); return false; },
    conversation: [{ role: "user", content: "在 360 浏览器 (PID 96832) 点击待办坐标 (50, 50)" }],
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (String(body.messages?.[0]?.content || "").includes("安全审核助手")) {
        const last = body.messages.at(-1);
        if (Array.isArray(last?.content) && last.content.some(p => p.type === "image_url")) reviewImages++;
        return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: '{"decision":"allow","reason":"用户授权点击 360 浏览器待办"}' } }] }) };
      }
      step++;
      if (step === 1) {
        return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: prefix + "get_shared_app_state", arguments: JSON.stringify({ app: "96832" }) } }] } }] }) };
      }
      if (step === 2) {
        const toolMsg = [...body.messages].reverse().find(m => m.role === "tool");
        const obsId = toolMsg?.content?.match(/观察编号：([^\n]+)/)?.[1];
        return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c2", type: "function", function: { name: prefix + "click", arguments: JSON.stringify({ app: "96832", observation_id: obsId, x: 50, y: 50, background: false }) } }] } }] }) };
      }
      return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: "检测到执行前目标区域变化，已停止等待重新观察。" } }] }) };
    },
  });
  assert.equal(approvals.length, 0);
  assert.equal(reviewImages, 1);
  // 验证 click 审核通过后，执行前依然再次调用了 get_app_state 复核，且成功拦截未下发 click
  assert.ok(calls.filter(c => c.name === "get_app_state").length >= 3);
  assert.ok(!calls.some(c => c.name === "click"));
  assert.ok(result.executedMessages.some(m => m.role === "tool" && /点击目标区域画面已发生变化/.test(m.content)));
});

test("macOS 树省略提示下通过 query 补查验证页面、字段与保存唯一性后可填写；重名/省略/Notepad 均拒绝", async t => {
  const truncatedSnapshot = [
    "App=com.apple.Safari (pid 222)",
    'Window: "项目编辑 - Safari", App: Safari.',
    "0 standard window 项目编辑 ID: SafariWindow?UUID=test-win, Secondary Actions: Raise",
    "\t1 group",
    "\t\t2 HTML内容 项目表单页, URL: https://oa.example.com/project/1",
    "\t\t\t3 heading 编辑项目",
    "\t\t\t10 text field (settable, string) 标题 Value: 原标题, Secondary Actions: Raise",
    "\t\t\t11 text entry area (settable, string) 备注 Value: 原备注, Secondary Actions: Raise",
    "\t\t\t12 button 保存, Secondary Actions: Raise",
    "The focused UI element is 10 text field.",
    "[Accessibility tree truncated: prioritized visible controls; some nodes were omitted.]",
  ].join("\n");

  const makeMacRuntime = queryHandler => createComputerUseRuntime(
    { command: "unused", platform: "darwin" },
    () => ({
      tools: [
        mockTool("list_apps"),
        mockTool("get_app_state", { include_ax: { type: "boolean" }, include_screenshot: { type: "boolean" }, text_limit: { type: ["integer", "string"] }, max_tree_nodes: { type: "integer" }, max_tree_depth: { type: "integer" } }, ["app"]),
        mockTool("click", { element_index: { type: "string" } }, ["app"]),
        mockTool("set_value", { element_index: { type: "string" }, value: { type: "string" } }, ["app", "element_index", "value"]),
        mockTool("press_key", { key: { type: "string" } }, ["app", "key"]),
        mockTool("type_text", { text: { type: "string" } }, ["app", "text"]),
        mockTool("query", { role: { type: "string" }, limit: { type: "integer" }, max_nodes: { type: "integer" }, window_id: { type: "integer" }, text: { type: "string" } }, ["app"]),
      ],
      async connect() {},
      async close() {},
      async callTool(name, args) {
        if (name === "list_apps") return { text: "Safari — com.apple.Safari [frontmost, running]\nNotepad-- — com.notepad.app [running]", images: [] };
        if (name === "query") return { text: JSON.stringify(queryHandler(args)), images: [] };
        if (name === "set_value") return { text: "ok", images: [] };
        return { text: truncatedSnapshot, images: [] };
      },
    }),
  );

  // 1. query 证明页面匹配、字段无重名且无遗漏、保存按钮唯一 -> form_only 读取和 fill_form 均成功！
  {
    let currentTitle = "原标题";
    let currentNote = "原备注";
    let focused = "10";
    let selectedAll = false;
    const runtime = createComputerUseRuntime(
      { command: "unused", platform: "darwin" },
      () => ({
        tools: [
          mockTool("list_apps"),
          mockTool("get_app_state", { include_ax: { type: "boolean" }, include_screenshot: { type: "boolean" }, text_limit: { type: ["integer", "string"] }, max_tree_nodes: { type: "integer" }, max_tree_depth: { type: "integer" } }, ["app"]),
          mockTool("click", { element_index: { type: "string" } }, ["app"]),
          mockTool("set_value", { element_index: { type: "string" }, value: { type: "string" } }, ["app", "element_index", "value"]),
          mockTool("press_key", { key: { type: "string" } }, ["app", "key"]),
          mockTool("type_text", { text: { type: "string" } }, ["app", "text"]),
          mockTool("query", { role: { type: "string" }, limit: { type: "integer" }, max_nodes: { type: "integer" }, window_id: { type: "integer" }, text: { type: "string" } }, ["app"]),
        ],
        async connect() {},
        async close() {},
        async callTool(name, args) {
          if (name === "list_apps") return { text: "Safari — com.apple.Safari [frontmost, running]", images: [] };
          if (name === "query") {
            if (args.role === "AXWebArea") return { text: JSON.stringify({ window_id: 901, truncated: false, matches: [{ title: "项目表单页", value: "https://oa.example.com/project/1" }] }), images: [] };
            if (args.role === "AXTextField") return { text: JSON.stringify({ window_id: 901, truncated: false, matches: [{ title: "标题", value: currentTitle }] }), images: [] };
            if (args.role === "AXTextArea") return { text: JSON.stringify({ window_id: 901, truncated: false, matches: [{ title: "备注", value: currentNote }] }), images: [] };
            if (args.role === "AXButton") return { text: JSON.stringify({ window_id: 901, truncated: false, matches: [{ title: "保存" }, { title: "关闭" }] }), images: [] };
            return { text: JSON.stringify({ window_id: 901, truncated: false, matches: [] }), images: [] };
          }
          if (name === "click") { focused = String(args.element_index || focused); selectedAll = false; return { text: "ok", images: [] }; }
          if (name === "press_key" && args.key === "cmd+a") { selectedAll = true; return { text: "ok", images: [] }; }
          if (name === "type_text") {
            if (focused === "10") currentTitle = selectedAll ? args.text : `${currentTitle}${args.text}`;
            if (focused === "11") currentNote = selectedAll ? args.text : `${currentNote}${args.text}`;
            selectedAll = false;
            return { text: "ok", images: [] };
          }
          if (name === "set_value") {
            if (args.element_index === "10") currentTitle = args.value;
            if (args.element_index === "11") currentNote = args.value;
            return { text: "ok", images: [] };
          }
          return {
            text: [
              "App=com.apple.Safari (pid 222)",
              'Window: "项目编辑 - Safari", App: Safari.',
              "0 standard window 项目编辑 ID: SafariWindow?UUID=test-win, Secondary Actions: Raise",
              "\t1 group",
              "\t\t2 HTML内容 项目表单页, URL: https://oa.example.com/project/1",
              "\t\t\t3 heading 编辑项目",
              `\t\t\t10 text field (settable, string) 标题 Value: ${currentTitle}, Secondary Actions: Raise`,
              `\t\t\t11 text entry area (settable, string) 备注 Value: ${currentNote}, Secondary Actions: Raise`,
              "\t\t\t12 button 保存, Secondary Actions: Raise",
              `The focused UI element is ${focused} ${focused === "10" ? "text field" : "text entry area"}.`,
              ...(selectedAll ? [`Selected text: [${focused === "10" ? currentTitle : currentNote}]`] : []),
              "[Accessibility tree truncated: prioritized visible controls; some nodes were omitted.]",
            ].join("\n"),
            images: [],
          };
        },
      }),
    );
    t.after(() => runtime.stopAll());
    const obs = await runtime.call(prefix + "get_app_state", { app: "com.apple.Safari", form_only: true }, scope);
    assert.equal(obs.ok, true, obs.result);
    assert.match(obs.result, /10 单行输入框「标题」/);
    assert.match(obs.result, /11 多行输入框「备注」/);
    assert.match(obs.result, /12 按钮「保存」（可用）/);
    const filled = await runtime.call(prefix + "fill_form", {
      app: "com.apple.Safari",
      observation_id: idOf(obs),
      fields: [{ element_index: "10", value: "新标题" }],
    }, scope);
    assert.equal(filled.ok, true, filled.result);
    assert.match(filled.result, /已核对 1 个输入框：标题/);
  }

  // 2. 重名字段（标题出现 2 次）不得出现在可填字段中，且禁止填写 10
  {
    const runtime = makeMacRuntime(args => {
      if (args.role === "AXTextField") return { window_id: 901, truncated: false, matches: [{ title: "标题", value: "原标题" }, { title: "标题", value: "另一项目" }] };
      if (args.role === "AXTextArea") return { window_id: 901, truncated: false, matches: [{ title: "备注", value: "原备注" }] };
      if (args.role === "AXButton") return { window_id: 901, truncated: false, matches: [{ title: "保存" }] };
      return { window_id: 901, truncated: false, matches: [{ title: "项目表单页", value: "https://oa.example.com/project/1" }] };
    });
    t.after(() => runtime.stopAll());
    const obs = await runtime.call(prefix + "get_app_state", { app: "com.apple.Safari", form_only: true }, scope);
    assert.equal(obs.ok, true);
    assert.doesNotMatch(obs.result, /10 单行输入框「标题」/);
    const fillDup = await runtime.call(prefix + "fill_form", {
      app: "com.apple.Safari",
      observation_id: idOf(obs),
      fields: [{ element_index: "10", value: "新标题" }],
    }, scope);
    assert.equal(fillDup.ok, false);
  }

  // 3. 省略区域隐藏了第二个「保存」或 query 自身截断或网页变更 -> 不得确认表单（返回新观察但说明没找到可填表单且禁止 fill_form）
  for (const badQuery of [
    args => args.role === "AXButton"
      ? { window_id: 901, truncated: false, matches: [{ title: "保存" }, { title: "保存" }] }
      : args.role === "AXTextField" ? { window_id: 901, truncated: false, matches: [{ title: "标题", value: "原标题" }] }
      : args.role === "AXTextArea" ? { window_id: 901, truncated: false, matches: [{ title: "备注", value: "原备注" }] }
      : { window_id: 901, truncated: false, matches: [{ title: "项目表单页", value: "https://oa.example.com/project/1" }] },
    args => ({ window_id: 901, truncated: args.role === "AXTextField", matches: [{ title: "标题", value: "原标题" }] }),
    args => args.role === "AXWebArea"
      ? { window_id: 901, truncated: false, matches: [{ title: "其他页面", value: "https://oa.example.com/other" }] }
      : { window_id: 901, truncated: false, matches: [] },
  ]) {
    const runtime = makeMacRuntime(badQuery);
    t.after(() => runtime.stopAll());
    const obs = await runtime.call(prefix + "get_app_state", { app: "com.apple.Safari", form_only: true }, scope);
    assert.equal(obs.ok, true);
    assert.match(obs.result, /无法从当前网页核对可填写的表单/);
    assert.ok(idOf(obs));
    const fillDenied = await runtime.call(prefix + "fill_form", {
      app: "com.apple.Safari",
      observation_id: idOf(obs),
      fields: [{ element_index: "10", value: "新标题" }],
    }, scope);
    assert.equal(fillDenied.ok, false);
  }
});

test("form_only 没找到表单时使旧观察失效并返回新观察；读取失败时不保留任何旧观察", async t => {
  let mode = "with-control";
  const runtime = createComputerUseRuntime(
    { command: "unused", platform: "darwin" },
    () => ({
      tools: [
        mockTool("list_apps"),
        mockTool("get_app_state", { text_limit: { type: ["integer", "string"] } }, ["app"]),
        mockTool("click", { element_index: { type: "string" } }, ["app"]),
        mockTool("set_value", { element_index: { type: "string" }, value: { type: "string" } }, ["app", "element_index", "value"]),
        mockTool("press_key", { key: { type: "string" } }, ["app", "key"]),
        mockTool("type_text", { text: { type: "string" } }, ["app", "text"]),
        mockTool("query", { role: { type: "string" }, limit: { type: "integer" } }, ["app"]),
      ],
      async connect() {},
      async close() {},
      async callTool(name) {
        if (name === "list_apps") return { text: "Safari — com.apple.Safari [frontmost, running]", images: [] };
        if (mode === "error") return { isError: true, text: "窗口已关闭", images: [] };
        if (mode === "no-form") {
          return {
            text: [
              "App=com.apple.Safari (pid 222)",
              'Window: "项目详情 - Safari", App: Safari.',
              "0 standard window 项目详情 ID: SafariWindow?UUID=test-win, Secondary Actions: Raise",
              "\t1 group, Secondary Actions: Raise",
              "\t\t2 HTML内容 项目详情, URL: https://oa.example.com/detail",
              "\t\t\t3 button 下一步, ID: BtnVeryLongInternalIdentifier123456, Secondary Actions: Raise",
            ].join("\n"),
            images: [],
          };
        }
        return {
          text: [
            "App=com.apple.Safari (pid 222)",
            'Window: "首页 - Safari", App: Safari.',
            "0 standard window 首页 ID: SafariWindow?UUID=test-win, Secondary Actions: Raise",
            "\t1 button 刷新, Secondary Actions: Raise",
          ].join("\n"),
          images: [],
        };
      },
    }),
  );
  t.after(() => runtime.stopAll());

  const obs1 = await runtime.call(prefix + "get_app_state", { app: "com.apple.Safari" }, scope);
  const id1 = idOf(obs1);
  assert.ok(id1);

  // 页面切到无表单页：form_only=true 成功读取并给出新观察 id2，且旧 id1 失效
  mode = "no-form";
  const obs2 = await runtime.call(prefix + "get_app_state", { app: "com.apple.Safari", form_only: true }, scope);
  const id2 = idOf(obs2);
  assert.equal(obs2.ok, true);
  assert.ok(id2 && id2 !== id1);
  assert.match(obs2.result, /无法从当前网页核对可填写的表单/);
  assert.match(obs2.result, /3 button 下一步/);
  // 验证返回给模型的文本已去噪（无 Secondary Actions: Raise / 长内部 ID），同时仍保留行 0 的 SafariWindow ID
  assert.doesNotMatch(obs2.result, /Secondary Actions: Raise/);
  assert.doesNotMatch(obs2.result, /BtnVeryLongInternalIdentifier123456/);
  assert.match(obs2.result, /ID: SafariWindow\?UUID=test-win/);

  const staleClick = await runtime.call(prefix + "click", { app: "com.apple.Safari", observation_id: id1, element_index: "1" }, scope);
  assert.equal(staleClick.ok, false);
  assert.match(staleClick.result, /当前观察已失效/);

  // 使用新观察 id2 点击新页面按钮，进入读取前核对并成功点击
  const clickNew = await runtime.call(prefix + "click", { app: "com.apple.Safari", observation_id: id2, element_index: "3" }, scope);
  assert.equal(clickNew.ok, true, clickNew.result);

  // 下一步重新读取失败时，不保留任何旧观察
  const obs3 = await runtime.call(prefix + "get_app_state", { app: "com.apple.Safari" }, scope);
  const id3 = idOf(obs3);
  mode = "error";
  const failedRead = await runtime.call(prefix + "get_app_state", { app: "com.apple.Safari", form_only: true }, scope);
  assert.equal(failedRead.ok, false);
  const clickAfterError = await runtime.call(prefix + "click", { app: "com.apple.Safari", observation_id: id3, element_index: "3" }, scope);
  assert.equal(clickAfterError.ok, false);
  assert.match(clickAfterError.result, /当前观察已失效/);
});

test("Token 优化：list_apps 过滤历史未运行应用、Linux 去掉无效参数且提示词使用 observation_id", async t => {
  const { runtime } = linuxHarness();
  t.after(() => runtime.stopAll());

  const defs = await runtime.definitions();
  const stateTool = defs.find(d => d.function.name === prefix + "get_app_state");
  assert.equal(stateTool.function.parameters.properties.include_screenshot, undefined);

  const listed = await runtime.call(prefix + "list_apps", {}, scope);
  assert.equal(listed.ok, true);
  assert.match(listed.result, /360极速浏览器 — 96832 \[running\]/);
  assert.doesNotMatch(listed.result, /11111/);

  for (const locale of ["zh-CN", "zh-TW", "en-US", "ja-JP", "fr-FR", "ko-KR"]) {
    const prompt = getPromptDefinition(locale).applicationSafety;
    assert.doesNotMatch(prompt, /window_id/);
    assert.match(prompt, /observation_id/);
  }
});

test("文档替换不套用省略树放宽：正文被截断时仍拒绝替换", () => {
  const truncatedDoc = [
    "App=org.notepad--.app (pid 333)",
    'Window: "note.txt - Notepad--", App: Notepad--.',
    "0 standard window note.txt",
    "\t1 text entry area (settable, string) Value: hello world",
    "\t14 checkbox Description: 周期自动保存, Value: off",
    "\t19 button 替换",
    "[Accessibility tree truncated: prioritized visible controls; some nodes were omitted.]",
  ].join("\n");
  const plan = planNotepadReplace(truncatedDoc, truncatedDoc, { old_text: "hello", new_text: "hi" });
  assert.ok("error" in plan);
});
