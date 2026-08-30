// DYWorker macOS 内置本机应用操作服务（stdio MCP）。
// 不依赖 Codex 客户端：通过 /usr/bin/osascript 调用系统辅助功能与截图能力。
// 需要用户在 系统设置 → 隐私与安全性 中允许 DYWorker：
//   - 辅助功能：读取/操作应用界面
//   - 屏幕录制：读取应用窗口截图（缺失时仍可用控件操作，只是没有截图）
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function unpackedResourcePath(file) {
  return String(file).replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
}

const macosHelper = unpackedResourcePath(path.join(here, "scripts", "macos_computer_use.js"));
const OSASCRIPT = "/usr/bin/osascript";
const SCREENCAPTURE = "/usr/sbin/screencapture";
const MAX_OUTPUT = 1_000_000;
const MAX_IMAGE_BYTES = 20_000_000;

const activeChildren = new Set();
let activeToolRequest = null;
let shutdownRequested = false;

function stopChild(child, signal = "SIGTERM") {
  try {
    if (child?.pid) process.kill(-child.pid, signal);
    else child?.kill(signal);
  } catch {
    // 进程可能已经退出
  }
}

function run(program, args = [], {
  input = "",
  timeoutMs = 20_000,
  detached = false,
  env = {},
} = {}) {
  return new Promise((resolve, reject) => {
    if (activeToolRequest?.cancelled) {
      reject(new Error("任务已停止"));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(program, args, {
      env: { ...process.env, ...env },
      detached,
      stdio: detached ? "ignore" : ["pipe", "pipe", "pipe"],
    });
    if (!detached) activeChildren.add(child);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        stopChild(child, "SIGKILL");
        finish(new Error(`${program} 执行超时`));
      }, timeoutMs)
      : null;
    child.on("error", (error) => finish(error));
    child.on("exit", (code, signal) => {
      activeChildren.delete(child);
      finish(null, { code: code ?? -1, signal, stdout, stderr });
      if (shutdownRequested && activeChildren.size === 0) process.exit(0);
    });
    if (detached) {
      child.unref();
      finish(null, { code: 0, signal: null, stdout: "", stderr: "" });
      return;
    }
    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString("utf8");
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function tryRun(program, args = [], options = {}) {
  try {
    return await run(program, args, options);
  } catch (error) {
    return { code: -1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

export function parsePngDimensions(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (data.length < 24) return null;
  if (data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

async function runMacosHelper(payload, timeoutMs = 25_000) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const result = await tryRun(OSASCRIPT, ["-l", "JavaScript", macosHelper], {
    timeoutMs,
    env: { DYWORKER_CU_PAYLOAD: encoded },
  });
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || "osascript 未返回结果").trim().slice(0, 1000);
    throw new Error(`系统辅助功能调用失败：${detail}`);
  }
  // osascript 在不同宿主环境下可能把 console 输出写到 stdout 或 stderr，两者都接收。
  const output = String(result.stdout || "").trim() || String(result.stderr || "").trim();
  if (!output) throw new Error("系统辅助功能没有返回内容");
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(`系统辅助功能返回了无法识别的内容：${output.slice(0, 300)}`);
  }
  if (!parsed?.ok) throw new Error(String(parsed?.error || "系统辅助功能操作失败"));
  return parsed;
}

async function captureWindowRegion(position, size) {
  if (!Array.isArray(position) || !Array.isArray(size)) return { data: "", width: 0, height: 0, scale: 1 };
  const x = Math.round(position[0]);
  const y = Math.round(position[1]);
  const width = Math.round(size[0]);
  const height = Math.round(size[1]);
  if (!(width > 0 && height > 0)) return { data: "", width: 0, height: 0, scale: 1 };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-macos-screen-"));
  const file = path.join(directory, "screen.png");
  try {
    const result = await tryRun(SCREENCAPTURE, ["-x", "-R", `${x},${y},${width},${height}`, file], { timeoutMs: 10_000 });
    if (result.code !== 0) return { data: "", width: 0, height: 0, scale: 1 };
    const buffer = await fs.readFile(file).catch(() => null);
    const dimensions = buffer?.length ? parsePngDimensions(buffer) : null;
    if (!buffer?.length || !dimensions || buffer.length > MAX_IMAGE_BYTES) {
      return { data: "", width: 0, height: 0, scale: 1 };
    }
    return {
      data: buffer.toString("base64"),
      width: dimensions.width,
      height: dimensions.height,
      scale: dimensions.width / width,
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

const appProperty = {
  type: "string",
  description: "应用名称、应用路径或 bundle 标识，例如 WPS Office、/Applications/WPS Office.app、com.kingsoft.wpsoffice.mac",
};
const windowIdProperty = {
  type: "string",
  description: "get_app_state 返回的窗口编号；同一应用有多个窗口时必须提供",
};
const windowTitleProperty = {
  type: "string",
  description: "get_app_state 返回的完整窗口标题；用于防止窗口关闭或顺序变化后操作错窗口",
};

function appTargetProperties(properties = {}) {
  return { app: appProperty, window_id: windowIdProperty, window_title: windowTitleProperty, ...properties };
}

function stableTargetRequired(required = []) {
  return ["app", "window_id", "window_title", ...required];
}

function tool(name, description, properties, required, readOnly = false, annotationOverrides = {}) {
  return {
    name,
    description,
    annotations: {
      destructiveHint: false,
      idempotentHint: readOnly,
      openWorldHint: false,
      readOnlyHint: readOnly,
      ...annotationOverrides,
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties,
      required,
    },
  };
}

export function desktopToolDefinitions() {
  return [
    tool("check_permissions", "检查 macOS 本机操作所需权限（辅助功能、屏幕录制、自动化访问）是否就绪，并给出开启指引。", {}, [], true),
    tool("list_apps", "列出当前正在运行的桌面应用（名称、路径与 bundle 标识）。", {}, [], true),
    tool("launch_app", "从系统应用菜单启动指定应用。启动会改变桌面状态，需要用户授权。", {
      app: appProperty,
    }, ["app"]),
    tool("get_app_state", "读取已运行应用的当前窗口、可访问控件与目标窗口截图。每轮操作应用前必须先调用；应用未运行时先调用 launch_app。", appTargetProperties(), ["app"], true),
    tool("click", "按控件编号或目标窗口截图内坐标点击。截图左上角为 (0,0)。", appTargetProperties({
      element_index: { type: "string", description: "get_app_state 返回的控件编号，例如 e12" },
      x: { type: "number", description: "目标窗口截图内 X 坐标" },
      y: { type: "number", description: "目标窗口截图内 Y 坐标" },
      mouse_button: { type: "string", enum: ["left", "right", "middle"], description: "鼠标按键，默认 left" },
      click_count: { type: "integer", minimum: 1, maximum: 3, description: "点击次数，默认 1" },
    }), stableTargetRequired()),
    tool("perform_secondary_action", "执行控件公开的次级动作，例如展开、显示菜单或增加数值。", appTargetProperties({
      element_index: { type: "string", description: "控件编号" },
      action: { type: "string", description: "get_app_state 中显示的动作名称" },
    }), stableTargetRequired(["element_index", "action"])),
    tool("set_value", "设置输入框、可编辑文字或数值控件的值。", appTargetProperties({
      element_index: { type: "string", description: "控件编号" },
      value: { type: "string", description: "要设置的值" },
    }), stableTargetRequired(["element_index", "value"])),
    tool("select_text", "选择可编辑控件中的文字，或把光标放到文字前后。无法精确选中时回退为全选或行首/行尾。", appTargetProperties({
      element_index: { type: "string", description: "文字控件编号" },
      text: { type: "string", description: "要选择的原文（用于确认目标控件）" },
      prefix: { type: "string", description: "可选的前置文字" },
      suffix: { type: "string", description: "可选的后置文字" },
      selection: { type: "string", enum: ["text", "cursor_before", "cursor_after"], description: "选择方式，默认 text" },
    }), stableTargetRequired(["element_index", "text"])),
    tool("scroll", "在指定控件位置向上、下、左或右滚动。", appTargetProperties({
      element_index: { type: "string", description: "滚动区域或附近控件编号" },
      direction: { type: "string", enum: ["up", "down", "left", "right", "u", "d", "l", "r"] },
      pages: { type: "number", minimum: 0.1, maximum: 10, description: "滚动页数，默认 1" },
    }), stableTargetRequired(["element_index", "direction"])),
    tool("drag", "按目标窗口截图内坐标从一个位置拖动到另一个位置。截图左上角为 (0,0)。", appTargetProperties({
      from_x: { type: "number" },
      from_y: { type: "number" },
      to_x: { type: "number" },
      to_y: { type: "number" },
    }), stableTargetRequired(["from_x", "from_y", "to_x", "to_y"])),
    tool("press_key", "向指定应用发送一个按键或组合键，例如 Return、ctrl+s、super+c、alt+F4。", appTargetProperties({
      key: { type: "string", description: "按键格式：单个字符、Return/Tab/方向键/F1-F20，或用 + 连接修饰键" },
    }), stableTargetRequired(["key"])),
    tool("type_text", "向指定应用输入原样文字；换行会模拟回车。", appTargetProperties({
      text: { type: "string", description: "要输入的文字" },
    }), stableTargetRequired(["text"])),
  ];
}

async function listAppsText() {
  const parsed = await runMacosHelper({ command: "list_apps" }, 20_000);
  const apps = Array.isArray(parsed.apps) ? parsed.apps : [];
  if (!apps.length) return "当前没有正在运行的桌面应用。";
  return apps
    .map((app) => {
      const frontmost = app.frontmost ? " [最前]" : "";
      return `${app.displayName} — ${app.path || "（未知路径）"} — ${app.id || "（未知标识）"}${frontmost}`;
    })
    .join("\n");
}

async function permissionText() {
  const parsed = await runMacosHelper({ command: "check_permissions" }, 20_000);
  const lines = [
    `辅助功能权限：${parsed.axTrusted ? "已授权" : "未授权"}`,
    `自动化访问（系统事件）：${parsed.systemEventsReachable ? "正常" : "受限"}${parsed.detail ? `（${String(parsed.detail).slice(0, 200)}）` : ""}`,
  ];
  const capture = await captureWindowRegion([0, 0], [16, 16]);
  lines.push(
    `屏幕录制：${capture.data ? "命令可用（若截图只显示桌面壁纸，请检查屏幕录制权限）" : "命令不可用"}`,
  );
  if (!parsed.axTrusted) {
    lines.push("");
    lines.push("请在 系统设置 → 隐私与安全性 → 辅助功能 中勾选 DYWorker，然后重新调用本工具检查。");
  }
  if (!capture.data) {
    lines.push("请在 系统设置 → 隐私与安全性 → 屏幕录制 中勾选 DYWorker。未授权时仍可基于控件编号操作，但看不到界面截图。");
  }
  return lines.join("\n");
}

async function launchApp(appQuery) {
  const resolved = await runMacosHelper({ command: "launch", app: appQuery }, 20_000);
  if (resolved.running) {
    return `应用“${appQuery}”已在运行，请直接调用 get_app_state 读取界面。`;
  }
  const app = resolved.app || {};
  // 审批加固：只允许启动应用菜单解析出的应用（bundleId 或以 .app 结尾的套装路径），
  // 不再按原始查询串直接 open 任意路径——避免借“启动应用”之名执行脚本或任意文件
  // （/usr/bin/open 打开 .command/.scpt 等文件会交给 Terminal/脚本编辑器执行）。
  const attempts = [];
  if (app.bundleId) attempts.push(["-b", app.bundleId]);
  if (app.path && String(app.path).endsWith(".app")) attempts.push([app.path]);
  if (app.displayName) attempts.push(["-a", app.displayName]);
  if (!attempts.length) {
    throw new Error(`系统应用菜单中没有找到“${appQuery}”。请使用应用菜单中显示的正式名称（list_apps 可查看正在运行的应用）。`);
  }
  let lastError = "";
  for (const args of attempts) {
    const result = await tryRun("/usr/bin/open", args, { timeoutMs: 10_000 });
    if (result.code === 0) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const check = await runMacosHelper({ command: "launch", app: appQuery }, 20_000).catch(() => null);
        if (check?.running) break;
      }
      return `已尝试启动“${appQuery}”。请调用 get_app_state 读取当前界面。`;
    }
    lastError = (result.stderr || result.stdout || "").trim() || `open 返回 ${result.code}`;
  }
  throw new Error(`系统应用菜单中没有找到“${appQuery}”。请使用应用菜单中显示的正式名称。原始原因：${lastError}`);
}

async function getAppState(args) {
  const parsed = await runMacosHelper({
    command: "state",
    app: args.app,
    window_id: args.window_id || "",
    window_title: args.window_title || "",
  }, 45_000);
  const capture = await captureWindowRegion(parsed.position, parsed.size);
  const lines = [
    `应用：${args.app}`,
    `窗口：${parsed.window_title || "（无标题）"}`,
    `窗口类别：${parsed.app?.bundleId || "（未知）"}`,
    `窗口编号：${parsed.window_index}`,
  ];
  if (capture.data) {
    lines.push(`截图尺寸：${capture.width}x${capture.height}（缩放比例：${capture.scale}，截图坐标 = 窗口坐标 × 缩放比例）`);
  } else {
    lines.push("未取得目标窗口截图；请调用 check_permissions 检查屏幕录制权限。仍可基于控件编号操作。");
  }
  lines.push(String(parsed.tree || "（目标窗口没有可访问控件）"));
  return { text: lines.join("\n"), image: capture.data };
}

async function callTool(name, args) {
  if (name === "check_permissions") {
    return { text: await permissionText() };
  }
  if (name === "list_apps") {
    return { text: await listAppsText() };
  }
  if (name === "launch_app") {
    return { text: await launchApp(args.app) };
  }
  if (name === "get_app_state") {
    const result = await getAppState(args);
    return result;
  }

  const target = { app: args.app, window_id: args.window_id, window_title: args.window_title };
  const scalePayload = { scale: Number(args.scale) || 1 };
  if (name === "click") {
    if (args.element_index) {
      await runMacosHelper({ command: "click_element", ...target, element_index: args.element_index }, 20_000);
    } else {
      if (!Number.isFinite(args.x) || !Number.isFinite(args.y)) throw new Error("click 需要 element_index，或同时提供 x 和 y");
      await runMacosHelper({
        command: "click_at",
        ...target,
        ...scalePayload,
        x: args.x,
        y: args.y,
        mouse_button: args.mouse_button || "left",
        click_count: args.click_count || 1,
      }, 20_000);
    }
    return { text: "点击已完成。请重新读取应用状态后再继续。" };
  }
  if (name === "perform_secondary_action") {
    await runMacosHelper({ command: "perform_action", ...target, element_index: args.element_index, action: args.action }, 20_000);
    return { text: `已执行“${args.action}”。请重新读取应用状态后再继续。` };
  }
  if (name === "set_value") {
    await runMacosHelper({ command: "set_value", ...target, element_index: args.element_index, value: String(args.value ?? "") }, 20_000);
    return { text: "控件内容已设置。请重新读取应用状态后再继续。" };
  }
  if (name === "select_text") {
    await runMacosHelper({
      command: "select_text",
      ...target,
      element_index: args.element_index,
      text: String(args.text || ""),
      selection: String(args.selection || "text"),
    }, 20_000);
    return { text: "文字选择已完成。请重新读取应用状态后再继续。" };
  }
  if (name === "scroll") {
    await runMacosHelper({
      command: "scroll",
      ...target,
      element_index: args.element_index,
      direction: args.direction,
      pages: args.pages || 1,
    }, 20_000);
    return { text: "滚动已完成。请重新读取应用状态后再继续。" };
  }
  if (name === "drag") {
    await runMacosHelper({
      command: "drag",
      ...target,
      ...scalePayload,
      from_x: args.from_x,
      from_y: args.from_y,
      to_x: args.to_x,
      to_y: args.to_y,
    }, 20_000);
    return { text: "拖动已完成。请重新读取应用状态后再继续。" };
  }
  if (name === "press_key") {
    await runMacosHelper({ command: "press_key", ...target, key: String(args.key || "") }, 20_000);
    return { text: "按键已发送。请重新读取应用状态后再继续。" };
  }
  if (name === "type_text") {
    await runMacosHelper({ command: "type_text", ...target, text: String(args.text || "") }, 30_000);
    return { text: "文字已输入。请重新读取应用状态后再继续。" };
  }
  throw new Error(`未知工具：${name}`);
}

function responseContent(result) {
  const content = [{ type: "text", text: result.text || "操作完成" }];
  if (result.image) content.push({ type: "image", data: result.image, mimeType: "image/png" });
  return content;
}

async function handleMessage(message) {
  if (!message?.method) return null;
  if (message.method === "notifications/cancelled") {
    const requestId = message.params?.requestId;
    if (requestId == null) return null;
    if (activeToolRequest?.id === requestId) {
      activeToolRequest.cancelled = true;
      for (const child of activeChildren) stopChild(child, "SIGTERM");
    }
    return null;
  }
  if (message.id == null) return null;
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "DYWorker macOS Computer Use", version: "1.0.0" },
      },
    };
  }
  if (message.method === "tools/list") {
    return { jsonrpc: "2.0", id: message.id, result: { tools: desktopToolDefinitions() } };
  }
  if (message.method === "tools/call") {
    const requestState = { id: message.id, cancelled: false };
    activeToolRequest = requestState;
    try {
      const result = await callTool(String(message.params?.name || ""), message.params?.arguments || {});
      if (requestState.cancelled) throw new Error("任务已停止");
      return { jsonrpc: "2.0", id: message.id, result: { content: responseContent(result), isError: false } };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        },
      };
    } finally {
      if (activeToolRequest === requestState) activeToolRequest = null;
    }
  }
  return {
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: `不支持的方法：${message.method}` },
  };
}

async function startServer() {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  let chain = Promise.resolve();
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.method === "notifications/cancelled") {
        void handleMessage(message);
        continue;
      }
      chain = chain.then(async () => {
        const response = await handleMessage(message);
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      });
    }
  });
}

process.on("SIGTERM", () => {
  shutdownRequested = true;
  for (const child of activeChildren) stopChild(child, "SIGTERM");
  setTimeout(() => {
    for (const child of activeChildren) stopChild(child, "SIGKILL");
    process.exit(0);
  }, 250).unref();
});

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await startServer();
}
