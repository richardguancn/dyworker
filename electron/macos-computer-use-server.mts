// DYWorker macOS 内置本机应用操作服务（stdio MCP）。
// 不依赖 Codex 客户端：通过 /usr/bin/osascript 调用系统辅助功能与截图能力。
// 需要用户在 系统设置 → 隐私与安全性 中允许 DYWorker：
//   - 辅助功能：读取/操作应用界面
//   - 屏幕录制：读取应用窗口截图（缺失时仍可用控件操作，只是没有截图）
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateDesktopClick } from './desktop/click-parameters.mts';
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
const cancelledToolRequests = new Set();
let activeToolRequest = null;
let shutdownRequested = false;
const windowCaptures = new Map<string, any>();
const windowObservations = new Map<string, any>();
const captureKey = (args: any) => JSON.stringify([String(args.app).toLowerCase(), String(args.window_id), String(args.window_title || '（无标题）')]);

export function macosCoordinateScale(capture: any, args: any, now = Date.now()) {
  if (!capture?.data || !(capture.scale > 0) || now - capture.capturedAt > 60_000) {
    throw new Error('当前窗口没有有效截图，请先调用 get_app_state 重新观察');
  }
  const points = args.from_x !== undefined ? [[args.from_x, args.from_y], [args.to_x, args.to_y]] : [[args.x, args.y]];
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= capture.width || y >= capture.height) {
      throw new Error('坐标超出当前窗口截图范围，请重新观察');
    }
  }
  return capture.scale;
}

function stopChild(child, signal = "SIGTERM") {
  try {
    if (child?.pid) process.kill(-child.pid, signal);
    else child?.kill(signal);
  } catch {
    try { child?.kill(signal); } catch { /* 进程可能已经退出 */ }
  }
}

// 拖拽与粘贴可能持有鼠标或临时剪贴板，先协作停止，让助手执行 finally。
export function requestMacosChildStop(child) {
  if (!child?.cooperativeCancelFile) { stopChild(child, 'SIGTERM'); return; }
  try {
    writeFileSync(child.cooperativeCancelFile, 'cancelled', { flag: 'w', mode: 0o600 });
    if (!child.cooperativeStopTimer) {
      child.cooperativeStopTimer = setTimeout(() => stopChild(child, 'SIGKILL'), 3500);
      child.cooperativeStopTimer.unref?.();
    }
  } catch { stopChild(child, 'SIGTERM'); }
}

export function runMacosChild(program, args = [], {
  input = "",
  timeoutMs = 20_000,
  detached = false,
  env = {},
  cooperativeCancelFile = "",
  onSpawn = null,
} = {} as any) {
  return new Promise<any>((resolve, reject) => {
    if (shutdownRequested || activeToolRequest?.cancelled) {
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
    (child as any).cooperativeCancelFile = cooperativeCancelFile;
    if (!detached) activeChildren.add(child);
    onSpawn?.(child);
    let timedOut = false;
    const finish = (error = null, result = null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        if (cooperativeCancelFile) requestMacosChildStop(child);
        else { stopChild(child, "SIGKILL"); finish(new Error(`${program} 执行超时`)); }
      }, timeoutMs)
      : null;
    child.on("error", (error) => finish(error));
    // 必须等 'close' 而不是 'exit'：'exit' 只表示进程终止，管道里缓冲的 stdout/stderr
    // 可能还没送达（新版 Node 24 下调度变化让快退出的脚本稳定复现丢输出）。
    child.on("close", (code, signal) => {
      activeChildren.delete(child);
      if ((child as any).cooperativeStopTimer) clearTimeout((child as any).cooperativeStopTimer);
      if (timedOut) finish(new Error(`${program} 执行超时`));
      else finish(null, { code: code ?? -1, signal, stdout, stderr });
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

async function tryRun(program, args = [], options = {} as any) {
  try {
    return await runMacosChild(program, args, options);
  } catch (error: any) {
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
  const cooperative = payload.background === false && ['click_at', 'click_element', 'drag', 'type_text', 'set_value', 'select_text'].includes(payload.command);
  const cancelDir = cooperative ? await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-macos-cancel-')) : '';
  const cancelFile = cancelDir ? path.join(cancelDir, 'cancel') : '';
  let result;
  try {
    result = await tryRun(OSASCRIPT, ["-l", "JavaScript", macosHelper], {
      timeoutMs, cooperativeCancelFile: cancelFile,
      env: { DYWORKER_CU_PAYLOAD: encoded, ...(cancelFile ? { DYWORKER_CU_CANCEL_FILE: cancelFile } : {}) },
    });
  } finally { if (cancelDir) await fs.rm(cancelDir, { recursive: true, force: true }).catch(() => {}); }
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

export function resolveMacosCaptureWindow(identity: any) {
  const bounds = identity?.bounds;
  const pid = Number(identity?.pid);
  if (!Number.isInteger(pid) || pid <= 0 || !bounds || !Array.isArray(identity?.candidates)) return null;
  const dimensions = [bounds.x, bounds.y, bounds.width, bounds.height];
  if (!dimensions.every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return null;
  const matches = identity.candidates.filter((candidate: any) =>
    Number.isSafeInteger(candidate.id) && candidate.id > 0 && candidate.pid === pid &&
    candidate.title === String(identity.title || '') &&
    ['x', 'y', 'width', 'height'].every(key => Number.isFinite(candidate[key]) && Math.abs(candidate[key] - bounds[key]) <= 2));
  return matches.length === 1 ? matches[0] : null;
}

export async function captureMacosWindow(identity, target, { executeCapture = tryRun, queryIdentity = runMacosHelper } = {} as any) {
  const empty = { data: "", width: 0, height: 0, scale: 1 };
  const window = resolveMacosCaptureWindow(identity);
  if (!window) return empty;
  const width = identity.bounds.width, height = identity.bounds.height;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-macos-screen-"));
  const file = path.join(directory, "screen.png");
  try {
    // 指定系统窗口编号，禁止按屏幕区域截图：区域截图会把遮挡该窗口的其他应用一并传给模型。
    const result = await executeCapture(SCREENCAPTURE, ["-x", "-o", "-a", `-l${window.id}`, file], { timeoutMs: 10_000 });
    if (result.code !== 0) return empty;
    const fresh = await queryIdentity({ command: 'window_identity', ...target }, 20_000).catch(() => null);
    const verified = resolveMacosCaptureWindow(fresh?.capture_identity);
    if (!verified || verified.id !== window.id || verified.pid !== window.pid ||
      ['x', 'y', 'width', 'height'].some(key => Math.abs(verified[key] - window[key]) > 2)) return empty;
    const buffer = await fs.readFile(file).catch(() => null);
    const dimensions = buffer?.length ? parsePngDimensions(buffer) : null;
    if (!buffer?.length || !dimensions || buffer.length > MAX_IMAGE_BYTES ||
      Math.abs(dimensions.width / width - dimensions.height / height) > 0.05) return empty;
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
  description: "应用名、路径、bundle ID 或 list_apps 返回的 pid:进程号",
};
const windowIdProperty = {
  type: "string",
  description: "get_app_state 返回的窗口编号",
};
const windowTitleProperty = {
  type: "string",
  description: "get_app_state 返回的窗口标题",
};

function appTargetProperties(properties = {} as any) {
  return { app: appProperty, window_id: windowIdProperty, window_title: windowTitleProperty,
    observation_id: { type: 'string', description: 'get_app_state 返回的观察编号；按控件编号操作时必须提供' }, ...properties };
}

function actionTargetProperties(properties = {} as any) {
  return appTargetProperties({ background: { type: 'boolean', description: '默认 true：仅直接操作控件，助手不会主动切换前台或使用系统鼠标键盘；应用自身仍可能改变窗口状态。不支持时返回错误。false 会切换前台并占用用户输入，仅在用户明确允许时使用。' }, ...properties });
}

function stableTargetRequired(required = []) {
  return ["app", "window_id", "window_title", ...required];
}

function tool(name, description, properties, required, readOnly = false, annotationOverrides = {} as any) {
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
    tool("check_permissions", "检查 macOS 辅助功能、屏幕录制与自动化权限。", {}, [], true),
    tool("list_apps", "列出正在运行的桌面应用。", {}, [], true),
    tool("launch_app", "启动指定桌面应用。", {
      app: appProperty,
      background: { type: 'boolean', description: '默认 true，要求系统后台启动；应用自身仍可能显示窗口或切换前台。false 表示允许前台启动。' },
    }, ["app"]),
    tool("get_app_state", "读取运行中应用的窗口、控件与截图（操作应用前必调）。", appTargetProperties(), ["app"], true),
    tool("click", "按控件编号或截图内坐标点击。默认后台仅支持控件的 AXPress 动作。", actionTargetProperties({
      element_index: { type: "string", description: "控件编号（如 e12）" },
      x: { type: "number", description: "截图内 X 坐标" },
      y: { type: "number", description: "截图内 Y 坐标" },
      mouse_button: { type: "string", enum: ["left", "right", "middle"], description: "默认 left" },
      click_count: { type: "integer", minimum: 1, maximum: 3, description: "默认 1" },
    }), stableTargetRequired()),
    tool("hover", "将鼠标移动到指定控件或截图坐标；仅在明确允许前台操作时可用。", actionTargetProperties({
      element_index: { type: "string", description: "控件编号（如 e12）" },
      x: { type: "number", description: "截图内 X 坐标" },
      y: { type: "number", description: "截图内 Y 坐标" },
    }), stableTargetRequired()),
    tool("perform_secondary_action", "执行控件次级动作；后台模式不允许显示菜单、切换或聚焦窗口。", actionTargetProperties({
      element_index: { type: "string", description: "控件编号" },
      action: { type: "string", description: "动作名" },
    }), stableTargetRequired(["element_index", "action"])),
    tool("set_value", "设置输入框或数值控件的值。", actionTargetProperties({
      element_index: { type: "string", description: "控件编号" },
      value: { type: "string", description: "目标值" },
    }), stableTargetRequired(["element_index", "value"])),
    tool("replace_text", "在可编辑控件中唯一匹配原文并替换；直接设置内容，不使用系统键盘或剪贴板。", appTargetProperties({
      element_index: { type: "string", description: "控件编号" },
      old_text: { type: "string", minLength: 1, description: "需要替换的原文，必须非空" },
      new_text: { type: "string", description: "替换后的文字；空字符串表示删除" },
      prefix: { type: "string", description: "紧接原文之前的文字，用于区分重复内容" },
      suffix: { type: "string", description: "紧接原文之后的文字，用于区分重复内容" },
    }), stableTargetRequired(["element_index", "old_text", "new_text"])),
    tool('insert_text', '在最近观察到的光标或选区处插入文字；直接修改选区，不切换前台、不使用键盘或剪贴板。应用必须支持修改选区，修改后需确认并保存。', appTargetProperties({
      element_index: { type: 'string', description: '可编辑控件编号' },
      text: { type: 'string', description: '要插入的文字；空字符串可删除当前选区' },
    }), stableTargetRequired(['element_index', 'text'])),
    tool("select_text", "选择可编辑控件中的文字或定位光标；后台模式要求目标应用支持直接设置并核对选择范围。", actionTargetProperties({
      element_index: { type: "string", description: "控件编号" },
      text: { type: "string", description: "目标原文" },
      prefix: { type: "string", description: "前置文字" },
      suffix: { type: "string", description: "后置文字" },
      selection: { type: "string", enum: ["text", "cursor_before", "cursor_after"], description: "默认 text" },
    }), stableTargetRequired(["element_index", "text"])),
    tool("scroll", "在指定控件、窗口截图坐标或窗口中央滚动。", actionTargetProperties({
      element_index: { type: "string", description: "控件编号" },
      x: { type: "number", description: "窗口截图内 X 坐标，须与 y 同时提供" },
      y: { type: "number", description: "窗口截图内 Y 坐标，须与 x 同时提供" },
      direction: { type: "string", enum: ["up", "down", "left", "right", "u", "d", "l", "r"] },
      pages: { type: "number", minimum: 0.1, maximum: 10, description: "页数，默认 1" },
    }), stableTargetRequired(["direction"])),
    tool("drag", "在窗口截图内按坐标拖拽。", actionTargetProperties({
      from_x: { type: "number" },
      from_y: { type: "number" },
      to_x: { type: "number" },
      to_y: { type: "number" },
    }), stableTargetRequired(["from_x", "from_y", "to_x", "to_y"])),
    tool("press_key", "发送按键或组合键（如 Return、super+c）。", actionTargetProperties({
      key: { type: "string", description: "按键或 + 组合键" },
    }), stableTargetRequired(["key"])),
    tool("type_text", "向指定应用输入文字。", actionTargetProperties({
      text: { type: "string", description: "输入文字" },
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
      return `${app.displayName} — ${app.path || "（未知路径）"} — ${app.id || "（未知标识）"}${app.pid ? ` — pid:${app.pid}` : ""}${frontmost}`;
    })
    .join("\n");
}

async function permissionText() {
  const parsed = await runMacosHelper({ command: "check_permissions" }, 20_000);
  const lines = [
    `辅助功能权限：${parsed.axTrusted ? "已授权" : "未授权"}`,
    `自动化访问（系统事件）：${parsed.systemEventsReachable ? "正常" : "受限"}${parsed.detail ? `（${String(parsed.detail).slice(0, 200)}）` : ""}`,
  ];
  lines.push(`屏幕录制权限预检：${parsed.screenCaptureAllowed === true ? "已授权" : parsed.screenCaptureAllowed === false ? "未授权" : "无法确认"}（实际截图还取决于目标窗口状态）`);
  if (!parsed.axTrusted) {
    lines.push("");
    lines.push("请在 系统设置 → 隐私与安全性 → 辅助功能 中勾选 DYWorker，然后重新调用本工具检查。");
  }
  if (parsed.screenCaptureAllowed === false) {
    lines.push("请在 系统设置 → 隐私与安全性 → 屏幕录制 中勾选 DYWorker。未授权时仍可基于控件编号操作，但看不到界面截图。");
  }
  return lines.join("\n");
}

async function launchApp(appQuery, background = true) {
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
    const result = await tryRun("/usr/bin/open", background ? ['-g', ...args] : args, { timeoutMs: 10_000 });
    if (result.code === 0) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise<any>((resolve) => setTimeout(resolve, 500));
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
  const capture = await captureMacosWindow(parsed.capture_identity, {
    app: args.app, window_id: String(parsed.window_index), window_title: parsed.window_title || '（无标题）',
  });
  const key = captureKey({ app: args.app, window_id: parsed.window_index, window_title: parsed.window_title });
  const observationId = randomUUID();
  windowObservations.set(observationId, { key, elements: parsed.elements || [], identity: parsed.capture_identity, capturedAt: Date.now() });
  if (windowObservations.size > 50) windowObservations.delete(windowObservations.keys().next().value);
  windowCaptures.set(key, { data: Boolean(capture.data), scale: capture.scale, width: capture.width, height: capture.height, identity: parsed.capture_identity, capturedAt: Date.now() });
  if (windowCaptures.size > 50) windowCaptures.delete(windowCaptures.keys().next().value);
  const lines = [
    `应用：${args.app}`,
    `窗口：${parsed.window_title || "（无标题）"}`,
    `窗口类别：${parsed.app?.bundleId || "（未知）"}`,
    `窗口编号：${parsed.window_index}`,
    `观察编号：${observationId} （按控件编号操作时必须提供 observation_id）`,
  ];
  if (capture.data) {
    lines.push(`截图尺寸：${capture.width}x${capture.height}（缩放比例：${capture.scale}，截图坐标 = 窗口坐标 × 缩放比例）`);
  } else {
    lines.push("未取得可确认身份的目标窗口截图；请检查屏幕录制权限和窗口状态。仍可基于控件编号操作。");
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
    return { text: await launchApp(args.app, args.background !== false) };
  }
  if (name === "get_app_state") {
    const result = await getAppState(args);
    return result;
  }

  const background = args.background !== false;
  if (name === 'click') validateDesktopClick(args);
  const target = { app: args.app, window_id: args.window_id, window_title: args.window_title, background,
    expected_window: windowCaptures.get(captureKey(args))?.identity };
  if (background && ['hover', 'drag', 'press_key', 'type_text'].includes(name)) {
    throw new Error('该动作暂不支持后台执行，已停止以免占用用户的鼠标、键盘或前台窗口。可尝试按控件设置值或使用浏览器操作。');
  }
  if (background && name === 'scroll' && !args.element_index && (args.x !== undefined || args.y !== undefined)) {
    throw new Error('该动作暂不支持后台执行：后台滚动暂不支持按屏幕绝对坐标滚动，请提供 element_index 控件编号，或不传坐标以滚动窗口主滚动区。');
  }
  if (background && name === 'click' && (!args.element_index || (args.mouse_button && args.mouse_button !== 'left') || (args.click_count && args.click_count !== 1))) {
    throw new Error('后台点击仅支持控件的单次左键动作，请先读取控件并使用 element_index。');
  }
  if (background && name === 'perform_secondary_action' && ['axraise', 'axfocus', 'axshowmenu'].includes(String(args.action || '').trim().toLowerCase())) {
    throw new Error('该动作可能显示菜单、切换或聚焦窗口，不能在后台执行。');
  }
  if (!target.expected_window) throw new Error('目标窗口缺少有效观察，请先读取应用状态。');
  const coordinatePayload = () => ({ scale: macosCoordinateScale(windowCaptures.get(captureKey(args)), args) });
  const elementPayload = () => {
    const observation = windowObservations.get(String(args.observation_id || ''));
    if (!observation || observation.key !== captureKey(args) || Date.now() - observation.capturedAt > 120_000) {
      throw new Error('控件观察已失效或不属于此窗口，请重新读取应用状态并提供观察编号');
    }
    const match = /^e(\d+)$/i.exec(String(args.element_index || ''));
    const expected = match && observation.elements[Number(match[1])];
    if (!expected) throw new Error('控件编号不在该次观察中，请重新读取应用状态');
    if (!observation.identity) throw new Error('无法确认观察中的目标窗口，请重新读取应用状态');
    return { expected_element: expected, expected_window: observation.identity };
  };
  if (name === "click") {
    if (args.element_index) {
      await runMacosHelper({ command: "click_element", ...target, element_index: args.element_index, ...elementPayload(),
        mouse_button: args.mouse_button || 'left', click_count: args.click_count || 1 }, 20_000);
    } else {
      if (!Number.isFinite(args.x) || !Number.isFinite(args.y)) throw new Error("click 需要 element_index，或同时提供 x 和 y");
      await runMacosHelper({
        command: "click_at",
        ...target,
        ...coordinatePayload(),
        x: args.x,
        y: args.y,
        mouse_button: args.mouse_button || "left",
        click_count: args.click_count || 1,
      }, 20_000);
    }
    return { text: "点击已完成。请重新读取应用状态后再继续。" };
  }
  if (name === 'hover') {
    if (args.element_index && (args.x !== undefined || args.y !== undefined)) throw new Error('悬停只能选择控件编号或截图坐标之一。');
    if (args.element_index) {
      await runMacosHelper({ command: 'hover_element', ...target, element_index: args.element_index, ...elementPayload() }, 20_000);
    } else {
      if (!Number.isFinite(args.x) || !Number.isFinite(args.y)) throw new Error('hover 需要 element_index，或同时提供 x 和 y');
      await runMacosHelper({ command: 'hover_at', ...target, ...coordinatePayload(), x: args.x, y: args.y }, 20_000);
    }
    return { text: '鼠标已移动到目标位置。请重新读取应用状态后再继续。' };
  }
  if (name === "perform_secondary_action") {
    await runMacosHelper({ command: "perform_action", ...target, element_index: args.element_index, ...elementPayload(), action: args.action }, 20_000);
    return { text: `已执行“${args.action}”。请重新读取应用状态后再继续。` };
  }
  if (name === "set_value") {
    await runMacosHelper({ command: "set_value", ...target, element_index: args.element_index, ...elementPayload(), value: String(args.value ?? "") }, 20_000);
    return { text: "控件内容已设置。请重新读取应用状态后再继续。" };
  }
  if (name === "replace_text") {
    if (typeof args.old_text !== 'string' || !args.old_text || typeof args.new_text !== 'string') throw new Error('替换文字需要非空原文和明确的新文字。');
    await runMacosHelper({ command: "replace_text", ...target, element_index: args.element_index, ...elementPayload(), old_text: args.old_text, new_text: args.new_text, prefix: args.prefix, suffix: args.suffix }, 20_000);
    return { text: "已替换控件中的指定文字并核对控件值。请重新读取应用状态，必要时保存并检查结果。" };
  }
  if (name === 'insert_text') {
    if (typeof args.text !== 'string') throw new Error('需要明确提供插入文字。');
    await runMacosHelper({ command: 'insert_text', ...target, element_index: args.element_index, ...elementPayload(), text: args.text }, 20_000);
    return { text: '已更新选区文字并核对控件内容。请重新读取应用状态，必要时保存并检查结果。' };
  }
  if (name === "select_text") {
    await runMacosHelper({
      command: "select_text",
      ...target,
      element_index: args.element_index,
      ...elementPayload(),
      text: String(args.text || ""),
      prefix: args.prefix,
      suffix: args.suffix,
      selection: String(args.selection || "text"),
    }, 20_000);
    return { text: "文字选择已完成。请重新读取应用状态后再继续。" };
  }
  if (name === "scroll") {
    const hasPoint = args.x !== undefined || args.y !== undefined;
    if (hasPoint && args.element_index) throw new Error("滚动只能选择控件编号或截图坐标之一");
    if (background && hasPoint) throw new Error("该动作暂不支持后台执行：后台滚动暂不支持按屏幕绝对坐标滚动，请提供 element_index 控件编号，或不传坐标以滚动窗口主滚动区。");
    await runMacosHelper({
      command: "scroll",
      ...target,
      element_index: args.element_index,
      ...(args.element_index ? elementPayload() : {}),
      ...(hasPoint ? { ...coordinatePayload(), x: args.x, y: args.y } : {}),
      direction: args.direction,
      pages: args.pages || 1,
    }, 20_000);
    return { text: "滚动已完成。请重新读取应用状态后再继续。" };
  }
  if (name === "drag") {
    await runMacosHelper({
      command: "drag",
      ...target,
      ...coordinatePayload(),
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
  const content: any[] = [{ type: "text", text: result.text || "操作完成" }];
  if (result.image) content.push({ type: "image", data: result.image, mimeType: "image/png" });
  return content;
}

async function handleMessage(message) {
  if (!message?.method) return null;
  if (message.method === "notifications/cancelled") {
    const requestId = message.params?.requestId;
    if (requestId == null) return null;
    cancelledToolRequests.add(requestId);
    if (activeToolRequest?.id === requestId) {
      activeToolRequest.cancelled = true;
      for (const child of activeChildren) requestMacosChildStop(child);
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
    const requestState = { id: message.id, cancelled: cancelledToolRequests.delete(message.id) };
    activeToolRequest = requestState;
    try {
      if (requestState.cancelled) throw new Error("任务已停止");
      const result = await callTool(String(message.params?.name || ""), message.params?.arguments || {});
      if (requestState.cancelled) throw new Error("任务已停止");
      return { jsonrpc: "2.0", id: message.id, result: { content: responseContent(result), isError: false } };
    } catch (error: any) {
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        },
      };
    } finally {
      cancelledToolRequests.delete(message.id);
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
  if (activeToolRequest) activeToolRequest.cancelled = true;
  for (const child of activeChildren) requestMacosChildStop(child);
  setTimeout(() => {
    for (const child of activeChildren) stopChild(child, "SIGKILL");
    process.exit(0);
  }, 4000).unref();
});

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await startServer();
}

export { handleMessage, startServer };
