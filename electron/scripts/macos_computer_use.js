#!/usr/bin/env osascript -l JavaScript
// DYWorker macOS 本机操控助手（由 macos-computer-use-server.mjs 通过 osascript -l JavaScript 调用）。
// 输入：环境变量 DYWORKER_CU_PAYLOAD（JSON 的 base64）；输出：单行 JSON 到 stdout。
// 依赖系统原生接口：AppKit（应用列表）、ApplicationServices（辅助功能权限）、CoreGraphics（鼠标/滚轮事件）。
// 使用前必须在 系统设置 → 隐私与安全性 中允许 DYWorker 的辅助功能（和屏幕录制，用于截图）。

ObjC.import("AppKit");
ObjC.import("ApplicationServices");
ObjC.import("CoreGraphics");

const KEY_CODE_MAP = {
  return: 36,
  enter: 76,
  tab: 48,
  space: 49,
  backspace: 51,
  delete: 51,
  forwarddelete: 117,
  escape: 53,
  esc: 53,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  help: 114,
};
const FN_KEY_MAP = {
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100,
  f9: 101, f10: 109, f11: 103, f12: 111, f13: 105, f14: 107, f15: 113,
  f16: 106, f17: 64, f18: 79, f19: 80, f20: 90,
};
const MODIFIER_MAP = {
  command: "command down",
  cmd: "command down",
  meta: "command down",
  super: "command down",
  ctrl: "control down",
  control: "control down",
  alt: "option down",
  option: "option down",
  shift: "shift down",
};

function emit(value) {
  console.log(JSON.stringify(value));
}

function norm(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function bridgeString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    const direct = value.js;
    if (typeof direct === "string") return direct;
  } catch (error) {}
  try {
    const description = value.description;
    if (description && typeof description.js === "string") return description.js;
  } catch (error) {}
  try {
    return String(value);
  } catch (error) {}
  return "";
}

function payloadFromEnv() {
  const environment = $.NSProcessInfo.processInfo.environment;
  const encoded = environment.objectForKey("DYWORKER_CU_PAYLOAD");
  if (!encoded) throw new Error("缺少 DYWORKER_CU_PAYLOAD");
  const decoded = $.NSData.alloc.initWithBase64EncodedStringOptions(encoded.js, 0);
  const text = $.NSString.alloc.initWithDataEncoding(decoded, $.NSUTF8StringEncoding);
  if (!text) throw new Error("无法解析 DYWORKER_CU_PAYLOAD");
  return JSON.parse(bridgeString(text));
}

function cancellationRequested() {
  if (typeof $ === 'undefined' || !$.NSProcessInfo) return false;
  const environment = $.NSProcessInfo.processInfo.environment;
  const file = environment.objectForKey('DYWORKER_CU_CANCEL_FILE');
  return Boolean(file && $.NSFileManager.defaultManager.fileExistsAtPath(file));
}

function throwIfCancelled() {
  if (cancellationRequested()) throw new Error('任务已停止');
}

function systemEvents() {
  return Application("System Events");
}

function runningApps() {
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
  const result = [];
  for (let index = 0; index < apps.count; index += 1) {
    const app = apps.objectAtIndex(index);
    let name = "";
    let bundleId = "";
    let path = "";
    let policy = 0;
    let pid = 0;
    let frontmost = false;
    try { name = bridgeString(app.localizedName); } catch (error) {}
    try { bundleId = bridgeString(app.bundleIdentifier); } catch (error) {}
    try { path = app.executableURL && app.executableURL.path ? bridgeString(app.executableURL.path) : ""; } catch (error) {}
    try { policy = Number(app.activationPolicy); } catch (error) {}
    try { pid = Number(app.processIdentifier); } catch (error) {}
    try { frontmost = Boolean(Number(app.isActive)); } catch (error) {}
    result.push({ name, bundleId, path, pid, policy, frontmost });
  }
  return result;
}

function resolveApp(query) {
  const needle = norm(query);
  if (!needle) return null;
  let best = [];
  let bestScore = 0;
  for (const app of runningApps()) {
    const name = norm(app.name);
    const bundleId = norm(app.bundleId);
    const path = norm(app.path);
    let score = 0;
    if (app.pid > 0 && needle === `pid:${app.pid}`) score = 120;
    else if (bundleId && bundleId === needle) score = 100;
    else if (name && name === needle) score = 100;
    else if (path && path === needle) score = 100;
    else if (name && (name.includes(needle) || needle.includes(name))) score = 60;
    else if (bundleId && bundleId.includes(needle)) score = 50;
    else if (path && path.includes(needle)) score = 40;
    if (score > bestScore) {
      bestScore = score;
      best = [app];
    } else if (score > 0 && score === bestScore) {
      best.push(app);
    }
  }
  if (best.length > 1) {
    const choices = best.map(app => `${app.name || app.bundleId || '应用'}（pid:${app.pid}）`).join('、');
    throw new Error(`“${query}”匹配到多个正在运行的应用，请使用进程编号明确选择：${choices}`);
  }
  return bestScore ? best[0] : null;
}

function installedApps() {
  const home = bridgeString($.NSHomeDirectory());
  const roots = [
    pathJoin(home, "Applications"),
    "/Applications",
    "/System/Applications",
    "/System/Applications/Utilities",
  ];
  const apps = [];
  for (const root of roots) {
    let names = [];
    try {
      names = $.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(root, null);
    } catch (error) {
      continue;
    }
    for (let index = 0; index < names.count; index += 1) {
      const name = bridgeString(names.objectAtIndex(index));
      if (!name.endsWith(".app")) continue;
      const fullPath = pathJoin(root, name);
      const bundle = $.NSBundle.bundleWithPath(fullPath);
      if (!bundle) continue;
      let bundleId = "";
      let displayName = "";
      try { bundleId = bridgeString(bundle.bundleIdentifier); } catch (error) {}
      try {
        displayName = bridgeString(bundle.localizedInfoDictionary.objectForKey("CFBundleDisplayName"));
      } catch (error) {}
      if (!displayName) {
        try {
          displayName = bridgeString(bundle.infoDictionary.objectForKey("CFBundleDisplayName"));
        } catch (error) {}
      }
      if (!displayName) {
        try {
          displayName = bridgeString(bundle.infoDictionary.objectForKey("CFBundleName"));
        } catch (error) {}
      }
      apps.push({ name: displayName || name.slice(0, -4), bundleId, path: fullPath });
    }
  }
  return apps;
}

function pathJoin(left, right) {
  return String(left || "").replace(/\/+$/, "") + "/" + String(right || "").replace(/^\/+/, "");
}

function resolveInstalledApp(query) {
  const needle = norm(query);
  if (!needle) return null;
  let best = null;
  let bestScore = 0;
  for (const app of installedApps()) {
    const name = norm(app.name);
    const bundleId = norm(app.bundleId);
    const path = norm(app.path);
    let score = 0;
    if (bundleId && bundleId === needle) score = 100;
    else if (name && name === needle) score = 100;
    else if (path && path === needle) score = 100;
    else if (name && (name.includes(needle) || needle.includes(name))) score = 60;
    else if (bundleId && bundleId.includes(needle)) score = 50;
    if (score > bestScore) {
      bestScore = score;
      best = app;
    }
  }
  return bestScore ? best : null;
}

function seProcessFor(app) {
  if (app.pid > 0) {
    // 同名进程的普通枚举可能被系统事件按名称重新解析为第一个进程，必须直接按 PID 查询。
    try {
      const processes = systemEvents().applicationProcesses;
      const ids = processes.unixId();
      const indexes = ids.map((pid, index) => Number(pid) === app.pid ? index : -1).filter(index => index >= 0);
      if (indexes.length === 1 && Number(processes[indexes[0]].unixId()) === app.pid) return processes[indexes[0]];
    } catch (error) {}
    return null;
  }
  const processes = systemEvents().applicationProcesses();
  const wantedBundleId = norm(app.bundleId);
  const wantedName = norm(app.name);
  let fallback = null;
  for (const process of processes) {
    let bundleId = "";
    let name = "";
    try { bundleId = bridgeString(process.bundleIdentifier()); } catch (error) {}
    try { name = bridgeString(process.name()); } catch (error) {}
    if (wantedBundleId && norm(bundleId) === wantedBundleId) return process;
    if (!fallback && wantedName && norm(name) === wantedName) fallback = process;
    if (!fallback && wantedName && (norm(name).includes(wantedName) || wantedName.includes(norm(name)))) {
      fallback = process;
    }
  }
  return fallback;
}

function processWindows(process) {
  const result = [];
  let list = [];
  try { list = process.windows(); } catch (error) { return result; }
  for (let index = 0; index < list.length; index += 1) {
    const window = list[index];
    let title = "";
    try { title = bridgeString(window.title()); } catch (error) {}
    result.push({ index: index + 1, title });
  }
  return result;
}

function selectWindow(process, query, windowId, windowTitle) {
  const windows = processWindows(process);
  if (!windows.length) throw new Error("目标应用没有可访问的窗口。请先打开或显示窗口后再试。");
  const requestedId = norm(String(windowId || ""));
  if (requestedId) {
    const numeric = /^\d+$/.test(requestedId) ? Number(requestedId) : NaN;
    const match = windows.find((window) =>
      norm(String(window.index)) === requestedId
      || (Number.isFinite(numeric) && window.index === numeric));
    if (!match) throw new Error(`没有找到窗口编号“${windowId}”。请重新读取应用状态。`);
    const expected = norm(String(windowTitle || ""));
    // 状态文本把空标题显示为“（无标题）”；收到该原样标签时按同一标题比较。
    if (expected && norm(match.title || "（无标题）") !== expected) {
      throw new Error(
        `窗口编号“${windowId}”的标题已经变化（现在是“${match.title || "（无标题）"}”），已停止操作。请重新读取应用状态。`,
      );
    }
    return match;
  }
  if (String(windowTitle || '').trim()) {
    const exact = windows.filter(window => norm(window.title || '（无标题）') === norm(windowTitle));
    if (exact.length === 1) return exact[0];
    if (!exact.length) throw new Error(`没有找到标题为“${windowTitle}”的窗口，请重新读取应用状态。`);
  }
  if (windows.length === 1) return windows[0];
  const choices = windows.map(window => `${window.index}：${window.title || '（无标题）'}`).join('\n');
  throw new Error(`“${query}”有多个窗口，请使用 window_id 明确选择：\n${choices}`);
}

function walkWindow(windowElement, maxNodes, maxDepth, maxChildren, visitor, deadline = 0) {
  const queue = [{ element: windowElement, depth: 0 }];
  let index = 0;
  while (queue.length && index < maxNodes && (deadline <= 0 || Date.now() < deadline)) {
    const current = queue.shift();
    const keepGoing = visitor(current.element, index, current.depth);
    index += 1;
    if (keepGoing === false) break;
    if (current.depth >= maxDepth) continue;
    let children = [];
    try { children = current.element.uiElements(); } catch (error) {}
    if (!Array.isArray(children)) children = [];
    if (children.length > maxChildren) children = children.slice(0, maxChildren);
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) queue.push({ element: current.element.uiElements[childIndex], depth: current.depth + 1 });
  }
  return index;
}

function isProtectedText(element, role) {
  if (/secure/i.test(role)) return true;
  if (role && !/text|combo/i.test(role)) return false;
  let subrole = '';
  try { subrole = bridgeString(element.subrole()); } catch (error) {}
  if (!subrole) {
    try { subrole = bridgeString(element.attributes.byName('AXSubrole').value()); } catch (error) {}
  }
  return /secure/i.test(subrole);
}

function elementInfo(element) {
  const info = { role: "", name: "", description: "", value: "", raw_value: null, selected_range: null, position: null, size: null, actions: [] };
  try { info.role = bridgeString(element.role()); } catch (error) {}
  try { info.name = bridgeString(element.name()).replace(/\s+/g, " ").trim(); } catch (error) {}
  try { info.description = bridgeString(element.description()).replace(/\s+/g, " ").trim(); } catch (error) {}
  if (isProtectedText(element, info.role)) {
    info.protected_text = true;
  } else {
    try {
      const rawValue = bridgeString(element.value());
      info.raw_value = rawValue.length <= 100000 ? rawValue : null;
      info.value = rawValue.replace(/\s+/g, " ").trim();
    } catch (error) {}
    if (/^(AXTextField|AXTextArea|AXSearchField|AXComboBox)$/i.test(info.role)) {
      try {
        const range = element.attributes.byName('AXSelectedTextRange').value();
        if (Array.isArray(range) && range.length === 2 && range.every(Number.isInteger)) info.selected_range = [range[0], range[1]];
      } catch (error) {}
    }
  }
  try {
    const position = element.position();
    if (position && position.length === 2) info.position = [Number(position[0]), Number(position[1])];
  } catch (error) {}
  try {
    const size = element.size();
    if (size && size.length === 2) info.size = [Number(size[0]), Number(size[1])];
  } catch (error) {}
  try {
    info.actions = element.actions()
      .map((_action, index) => {
        let name = "";
        try { name = bridgeString(element.actions[index].name()); } catch (error) {}
        return name.split(/\r?\n/)[0].split(/Name:/)[0].trim().slice(0, 48);
      })
      .filter(Boolean);
  } catch (error) {}
  return info;
}

function buildTree(windowElement, maxNodes = 500, maxDepth = 12, maxChildren = 150) {
  const lines = [];
  const elements = [];
  const deadline = Date.now() + 12_000;
  const visited = walkWindow(windowElement, maxNodes, maxDepth, maxChildren, (element, index) => {
    const info = elementInfo(element);
    elements.push(info);
    const bounds = info.position && info.size && info.size[0] > 0 && info.size[1] > 0
      ? ` bounds=(${Math.round(info.position[0])},${Math.round(info.position[1])},${Math.round(info.size[0])},${Math.round(info.size[1])})`
      : "";
    const actions = info.actions.length ? ` actions=${info.actions.join(",")}` : "";
    const name = info.name ? ` "${String(info.name).replace(/"/g, "'").slice(0, 240)}"` : "";
    const description = !name && info.description
      ? ` "${String(info.description).replace(/"/g, "'").slice(0, 240)}"`
      : "";
    const value = info.value ? ` value=${String(info.value).replace(/\s+/g, " ").slice(0, 120)}` : "";
    const selection = info.selected_range ? ` selection=(${info.selected_range.join(',')})` : '';
    const protectedText = info.protected_text ? ' [密码框]' : '';
    lines.push(`[e${index}] ${info.role || "unknown"}${protectedText}${name}${description}${value}${selection}${bounds}${actions}`);
  }, deadline);
  if (visited >= maxNodes || Date.now() >= deadline) lines.push("…控件较多或读取缓慢，已截断");
  return { tree: lines.join("\n"), elements };
}

function elementAt(windowElement, rawIndex, expected) {
  const text = String(rawIndex || "").trim().toLocaleLowerCase();
  const index = text.startsWith("e") ? Number(text.slice(1)) : Number(text);
  if (!Number.isInteger(index) || index < 0) throw new Error(`控件编号无效：${rawIndex}`);
  let found = null;
  // 与 buildTree 完全相同的遍历范围，避免同一编号在操作时指向另一个控件。
  walkWindow(windowElement, 500, 12, 150, (element, current) => {
    if (current === index) { found = element; return false; }
  }, Date.now() + 12_000);
  if (!found) throw new Error(`没有找到控件：${rawIndex}。请重新读取应用状态。`);
  if (!expected || JSON.stringify(elementInfo(found)) !== JSON.stringify(expected)) {
    throw new Error(`控件 ${rawIndex} 已变化，已停止操作。请重新读取应用状态后再试。`);
  }
  return found;
}

function elementBounds(element) {
  let position = null;
  let size = null;
  try {
    const value = element.position();
    if (value && value.length === 2) position = [Number(value[0]), Number(value[1])];
  } catch (error) {}
  try {
    const value = element.size();
    if (value && value.length === 2) size = [Number(value[0]), Number(value[1])];
  } catch (error) {}
  if (!position || !size || size[0] <= 0 || size[1] <= 0) return null;
  return {
    x: position[0],
    y: position[1],
    width: size[0],
    height: size[1],
    center: {
      x: Math.round(position[0] + size[0] / 2),
      y: Math.round(position[1] + size[1] / 2),
    },
  };
}

function pointerPoint(window, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < window.x || point.y < window.y ||
    point.x >= window.x + window.width || point.y >= window.y + window.height) {
    throw new Error('鼠标位置不在目标窗口内，已停止操作。请重新读取应用状态。');
  }
  return point;
}

function screenshotPoint(window, x, y, scale) {
  return pointerPoint(window, { x: window.x + Math.floor(Number(x) / scale), y: window.y + Math.floor(Number(y) / scale) });
}

function confirmPointerApp(process) {
  if (!process.frontmost()) throw new Error('目标应用已不在前台，已停止鼠标操作。');
}

function mouseEvent(type, x, y, button, clickState) {
  const source = $.CGEventSourceCreate(0);
  const point = $.CGPointMake(x, y);
  const event = $.CGEventCreateMouseEvent(source, type, point, button);
  if (clickState) $.CGEventSetIntegerValueField(event, $.kCGMouseEventClickState, clickState);
  $.CGEventPost($.kCGHIDEventTap, event);
}

function clickAt(x, y, buttonName, count, confirmActive) {
  const button = buttonName === "right" ? 1 : buttonName === "middle" ? 2 : 0;
  const downType = button === 1 ? 3 : button === 2 ? 25 : 1;
  const upType = button === 1 ? 4 : button === 2 ? 26 : 2;
  throwIfCancelled();
  if (confirmActive) confirmActive();
  mouseEvent(5, x, y, button);
  const repeats = Math.min(3, Math.max(1, Number(count) || 1));
  for (let index = 0; index < repeats; index += 1) {
    throwIfCancelled();
    if (confirmActive) confirmActive();
    let pressed = false;
    try {
      // 即使命令在发送时抛错，也不能假定按下事件一定未被系统接收。
      pressed = true;
      mouseEvent(downType, x, y, button, index + 1);
      mouseEvent(upType, x, y, button, index + 1);
      pressed = false;
    } finally {
      if (pressed) mouseEvent(upType, x, y, button, index + 1);
    }
    delay(0.05);
  }
}

function dragAt(fromX, fromY, toX, toY, confirmActive) {
  const steps = 12;
  throwIfCancelled();
  if (confirmActive) confirmActive();
  mouseEvent(5, fromX, fromY, 0);
  delay(0.05);
  throwIfCancelled();
  if (confirmActive) confirmActive();
  let pressed = false, lastX = fromX, lastY = fromY;
  try {
    pressed = true;
    mouseEvent(1, fromX, fromY, 0);
    delay(0.05);
    for (let index = 1; index <= steps; index += 1) {
      throwIfCancelled();
      if (confirmActive) confirmActive();
      const x = Math.round(fromX + (toX - fromX) * index / steps);
      const y = Math.round(fromY + (toY - fromY) * index / steps);
      lastX = x; lastY = y;
      mouseEvent(6, x, y, 0);
      delay(0.01);
    }
    mouseEvent(2, toX, toY, 0);
    pressed = false;
  } finally {
    if (pressed) mouseEvent(2, lastX, lastY, 0);
  }
}

function scrollAt(x, y, direction, pages, confirmActive) {
  throwIfCancelled();
  if (confirmActive) confirmActive();
  mouseEvent(5, x, y, 0);
  const lines = Math.max(1, Math.round((Number(pages) || 1) * 8));
  const vertical = direction === "down" || direction === "d" ? lines : direction === "up" || direction === "u" ? -lines : 0;
  const horizontal = direction === "right" || direction === "r" ? lines : direction === "left" || direction === "l" ? -lines : 0;
  const source = $.CGEventSourceCreate(0);
  // JXA 不可靠地调用可变参数函数；固定参数版本明确设置两轴和按行滚动。
  const event = $.CGEventCreateScrollWheelEvent2(source, 1, 2, vertical, horizontal, 0);
  if (!event) throw new Error("无法创建滚轮事件");
  $.CGEventSetLocation(event, $.CGPointMake(x, y));
  delay(0.1);
  throwIfCancelled();
  if (confirmActive) confirmActive();
  $.CGEventPost($.kCGHIDEventTap, event);
}

function modifierList(modifiers) {
  const result = [];
  for (const modifier of modifiers || []) {
    const mapped = MODIFIER_MAP[norm(modifier)];
    if (mapped && !result.includes(mapped)) result.push(mapped);
  }
  return result;
}

function pressKey(keyText) {
  const parts = String(keyText || "").split("+").map((part) => part.trim()).filter(Boolean);
  const rawKey = parts.pop() || "";
  const modifiers = modifierList(parts);
  const key = norm(rawKey);
  const code = KEY_CODE_MAP[key] || FN_KEY_MAP[key];
  if (code) {
    systemEvents().keyCode(code, { using: modifiers });
    return;
  }
  if (rawKey.length === 1) {
    systemEvents().keystroke(rawKey, { using: modifiers });
    return;
  }
  throw new Error(
    `不支持的按键：${keyText}。支持 a-z、0-9、Return、Tab、Space、Backspace、Escape、方向键、Home、End、PageUp、PageDown、F1-F20，以及 command/ctrl/option/shift 组合（如 ctrl+s、super+c）。`,
  );
}

function typeText(text, confirmTarget) {
  // System Events.keystroke 不能可靠输入中文；逐行 Return 还可能意外提交表单。
  // 以一次粘贴保留 Unicode/换行，复制全部原剪贴板格式并在结束时恢复。
  throwIfCancelled();
  if (confirmTarget) confirmTarget();
  const board = $.NSPasteboard.generalPasteboard;
  const snapshotVersion = Number(board.changeCount);
  const saved = $.NSMutableArray.alloc.init;
  const items = board.pasteboardItems;
  if (items) {
    for (let i = 0; i < items.count; i += 1) {
      const original = items.objectAtIndex(i), copy = $.NSPasteboardItem.alloc.init;
      const types = original.types;
      for (let j = 0; j < types.count; j += 1) {
        const type = types.objectAtIndex(j), data = original.dataForType(type);
        if (data) copy.setDataForType(data, type);
      }
      saved.addObject(copy);
    }
  }
  let ownedVersion = null;
  try {
    throwIfCancelled();
    if (confirmTarget) confirmTarget();
    if (Number(board.changeCount) !== snapshotVersion) throw new Error('剪贴板内容已变化，已停止输入，请重新操作。');
    board.clearContents;
    ownedVersion = Number(board.changeCount);
    if (!board.setStringForType($(String(text ?? '')), $.NSPasteboardTypeString)) throw new Error('无法准备文字粘贴');
    ownedVersion = Number(board.changeCount);
    throwIfCancelled();
    if (confirmTarget) confirmTarget();
    if (Number(board.changeCount) !== ownedVersion) throw new Error('剪贴板内容已变化，已停止输入，请重新操作。');
    systemEvents().keystroke('v', { using: ['command down'] });
    // 粘贴事件由目标应用异步处理；过早恢复会让应用读到原剪贴板内容。
    delay(1.5);
    throwIfCancelled();
  } finally {
    // 用户或目标应用在这期间主动复制了新内容时，保留新内容。
    if (ownedVersion !== null && Number(board.changeCount) === ownedVersion) {
      board.clearContents;
      if (saved.count) board.writeObjects(saved);
    }
  }
}

function activateWindow(process, windowElement) {
  try { windowElement.performAction("AXRaise"); } catch (error) {}
  try { process.frontmost = true; } catch (error) { throw new Error('无法切换到目标应用，已停止输入'); }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { if (process.frontmost()) { delay(0.1); return; } } catch (error) {}
    delay(0.1);
  }
  throw new Error('目标应用没有进入前台，已停止输入，请重新观察');
}

function ensureTarget(payload) {
  if (!String(payload.window_id || "").trim() || !String(payload.window_title || "").trim()) {
    throw new Error("操作前必须重新读取应用状态，并携带返回的 window_id 和 window_title。");
  }
  const app = resolveApp(payload.app);
  if (!app) {
    throw new Error(`本机没有找到应用“${payload.app}”。请使用 launch_app 启动它，或检查名称是否正确。`);
  }
  const process = seProcessFor(app);
  if (!process) {
    throw new Error(`应用“${app.name || app.bundleId || payload.app}”尚未运行。请先使用 launch_app 启动它，再读取界面。`);
  }
  const windowInfo = selectWindow(process, payload.app, payload.window_id, payload.window_title);
  const windowElement = process.windows[windowInfo.index - 1];
  if (payload.expected_window && !windowIdentityMatches(payload.expected_window, windowIdentity(process, windowInfo, windowElement))) {
    throw new Error('目标窗口已变化或无法唯一确认，请重新读取应用状态。');
  }
  return { app, process, windowInfo, windowElement };
}

function uniqueWindowCandidate(identity) {
  const bounds = identity?.bounds;
  if (!bounds || !Array.isArray(identity.candidates)) return null;
  const matches = identity.candidates.filter(candidate => Number.isSafeInteger(candidate.id) && candidate.id > 0 && candidate.pid === identity.pid && candidate.title === identity.title
    && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(candidate[key]) && Number.isFinite(bounds[key]) && Math.abs(candidate[key] - bounds[key]) <= 2));
  return matches.length === 1 ? matches[0] : null;
}

function windowIdentityMatches(expected, current) {
  if (!expected || !current || !(expected.pid > 0) || expected.pid !== current.pid || expected.title !== current.title
    || !expected.bounds || !current.bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(expected.bounds[key]) && Number.isFinite(current.bounds[key])
      && Math.abs(expected.bounds[key] - current.bounds[key]) <= 2)) return false;
  const before = uniqueWindowCandidate(expected), after = uniqueWindowCandidate(current);
  if (before) return Boolean(after && before.id === after.id);
  // 屏幕录制未授权时可能无法取得系统窗口编号；只能在同名窗口唯一时使用控件。
  return expected.sameTitleCount === 1 && current.sameTitleCount === 1;
}

function confirmForegroundWindow(process, expected) {
  throwIfCancelled();
  let current;
  try {
    if (process.frontmost()) {
      const focused = process.attributes.byName('AXFocusedWindow').value();
      const title = bridgeString(focused.attributes.byName('AXTitle').value());
      const identity = windowIdentity(process, { title }, focused);
      if (windowIdentityMatches(expected, identity) && process.frontmost()) current = identity;
    }
  } catch (error) {}
  throwIfCancelled();
  if (!current) throw new Error('无法确认目标窗口仍在前台，已停止输入。请重新读取应用状态。');
  return current.bounds;
}

// 只返回目标进程的窗口元数据，不读取屏幕上其他应用的画面。
function windowIdentity(process, windowInfo, windowElement) {
  let pid = 0;
  try { pid = Number(process.unixId()); } catch (error) {}
  const bounds = elementBounds(windowElement);
  const candidates = [];
  if (pid > 0 && bounds) {
    try {
      const windows = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, $.kCGNullWindowID));
      for (let i = 0; i < Number(windows.count); i += 1) {
        const item = ObjC.deepUnwrap(windows.objectAtIndex(i));
        if (Number(item.kCGWindowOwnerPID) !== pid || Number(item.kCGWindowLayer) !== 0) continue;
        const rect = item.kCGWindowBounds || {};
        candidates.push({ id: Number(item.kCGWindowNumber), pid, title: String(item.kCGWindowName || ''),
          x: Number(rect.X), y: Number(rect.Y), width: Number(rect.Width), height: Number(rect.Height) });
      }
    } catch (error) {}
  }
  const sameTitleCount = processWindows(process).filter(item => norm(item.title) === norm(windowInfo.title)).length;
  return { pid, title: windowInfo.title || '', bounds, candidates, sameTitleCount };
}

function appState(payload) {
  const app = resolveApp(payload.app);
  if (!app) {
    const installed = resolveInstalledApp(payload.app);
    if (installed) {
      throw new Error(`应用“${installed.name || payload.app}”已安装但尚未运行。请先使用 launch_app 启动它，再读取界面。`);
    }
    throw new Error(`本机没有找到应用“${payload.app}”。请使用 launch_app 启动它，或检查名称是否正确。`);
  }
  const process = seProcessFor(app);
  if (!process) {
    throw new Error(`应用“${app.name || app.bundleId || payload.app}”尚未运行。请先使用 launch_app 启动它，再读取界面。`);
  }
  const windowInfo = selectWindow(process, payload.app, payload.window_id, payload.window_title);
  const windowElement = process.windows[windowInfo.index - 1];
  const { tree, elements } = buildTree(windowElement);
  const bounds = elementBounds(windowElement);
  return {
    app: { name: app.name, bundleId: app.bundleId, path: app.path },
    window_index: windowInfo.index,
    window_title: windowInfo.title,
    position: bounds ? [bounds.x, bounds.y] : null,
    size: bounds ? [bounds.width, bounds.height] : null,
    capture_identity: windowIdentity(process, windowInfo, windowElement),
    tree,
    elements,
  };
}

function clickElement(element, window, confirmActive) {
  try {
    element.click();
    return;
  } catch (error) {}
  try {
    element.actions.byName("AXPress").perform();
    return;
  } catch (error) {}
  const point = pointerPoint(window, elementBounds(element)?.center);
  confirmActive();
  clickAt(point.x, point.y, "left", 1, confirmActive);
}

function clickElementInBackground(element) {
  try {
    element.actions.byName("AXPress").perform();
  } catch (error) {
    throw new Error(`该控件不支持后台点击，已停止，未切换前台或使用鼠标：${String(error.message || error)}`);
  }
}

function setElementValueInBackground(element, value) {
  const wanted = String(value ?? "");
  try {
    element.value = wanted;
    if (bridgeString(element.value()) === wanted) return;
  } catch (error) {}
  throw new Error("该控件未确认后台设置的内容，已停止，未使用键盘或剪贴板。请重新读取界面。");
}

function replaceElementTextInBackground(element, payload) {
  if (isProtectedText(element, bridgeString(element.role()))) throw new Error('不能读取或替换密码控件中的文字。');
  const oldText = String(payload.old_text || '');
  if (!oldText || typeof payload.new_text !== 'string') throw new Error('替换文字需要非空原文和明确的新文字。');
  let value;
  try { value = bridgeString(element.value()); }
  catch (error) { throw new Error('无法读取控件原文，已停止替换。'); }
  if (typeof payload.expected_element?.raw_value !== 'string' || value !== payload.expected_element.raw_value) {
    throw new Error('控件原文已变化或无法确认，请重新读取应用状态。');
  }
  const prefix = String(payload.prefix || ''), suffix = String(payload.suffix || '');
  const matches = [];
  for (let at = value.indexOf(oldText); at >= 0; at = value.indexOf(oldText, at + 1)) {
    if (prefix && !value.slice(0, at).endsWith(prefix)) continue;
    if (suffix && !value.slice(at + oldText.length).startsWith(suffix)) continue;
    matches.push(at);
  }
  if (matches.length !== 1) throw new Error('原文不存在或有多处匹配，请重新观察并指定 prefix/suffix。');
  const offset = matches[0];
  const result = value.slice(0, offset) + payload.new_text + value.slice(offset + oldText.length);
  if (result !== value) setElementValueInBackground(element, result);
}

function insertSelectedTextInBackground(element, payload) {
  const role = bridgeString(element.role());
  if (isProtectedText(element, role)) throw new Error('不能读取或修改密码控件中的选区。');
  if (!/^(AXTextField|AXTextArea|AXSearchField|AXComboBox)$/i.test(role)) throw new Error('目标不是支持的可编辑文字控件。');
  if (typeof payload.text !== 'string') throw new Error('需要明确提供插入文字。');
  const value = bridgeString(element.value()), expected = payload.expected_element;
  if (typeof expected?.raw_value !== 'string' || value !== expected.raw_value) throw new Error('控件原文已变化，请重新读取应用状态。');
  let range;
  try { range = element.attributes.byName('AXSelectedTextRange').value(); } catch (error) {}
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger) ||
    !Array.isArray(expected.selected_range) || range[0] !== expected.selected_range[0] || range[1] !== expected.selected_range[1]) {
    throw new Error('选区已变化或无法确认，请重新读取应用状态。');
  }
  const start = range[0] - 1, end = range[1];
  if (start < 0 || end < start || end > value.length) throw new Error('选区范围无效，请重新读取应用状态。');
  const splitsSurrogate = index => index > 0 && index < value.length && /[\uD800-\uDBFF]/.test(value[index - 1]) && /[\uDC00-\uDFFF]/.test(value[index]);
  if (splitsSurrogate(start) || splitsSurrogate(end)) throw new Error('选区位于字符内部，已停止输入。');
  const wanted = value.slice(0, start) + payload.text + value.slice(end);
  if (wanted === value) return;
  try { element.attributes.byName('AXSelectedText').value = payload.text; }
  catch (error) { throw new Error('该应用不支持直接修改选区，请重新观察或使用其他方式。'); }
  if (bridgeString(element.value()) !== wanted) throw new Error('未能确认输入结果，请重新观察，不要直接重复输入。');
}

function keyboardControlGuard(target, element, payload) {
  const confirmWindow = () => confirmForegroundWindow(target.process, payload.expected_window);
  const isFocused = () => {
    try { return element.attributes.byName('AXFocused').value() === true; } catch (error) { return false; }
  };
  const confirmControl = () => {
    throwIfCancelled();
    if (isProtectedText(element, bridgeString(element.role())) || !isFocused() || !target.process.frontmost()) {
      throw new Error('无法确认目标控件仍接收键盘输入，已停止。请重新读取应用状态。');
    }
  };
  confirmWindow();
  if (!isFocused()) {
    try { element.performAction("AXFocus"); } catch (error) {}
  }
  if (!isFocused()) {
    confirmWindow();
    try { element.click(); } catch (error) {}
  }
  confirmWindow();
  confirmControl();
  return confirmControl;
}

function setElementValue(target, element, payload) {
  const wanted = String(payload.value ?? "");
  let actual;
  try {
    element.value = wanted;
  } catch (error) {}
  try { actual = bridgeString(element.value()); } catch (error) {}
  if (actual === wanted) return;
  if (typeof actual !== 'string' || actual !== payload.expected_element?.raw_value ||
    !/^(AXTextField|AXTextArea|AXSearchField|AXComboBox)$/i.test(bridgeString(element.role()))) {
    throw new Error('无法确认控件原文仍可安全编辑，已停止。请重新读取应用状态。');
  }
  const confirmControl = keyboardControlGuard(target, element, payload);
  const confirmInput = () => {
    confirmForegroundWindow(target.process, payload.expected_window);
    confirmControl();
    if (bridgeString(element.value()) !== actual) throw new Error('控件内容已变化，已停止输入。');
  };
  confirmInput();
  if (actual) systemEvents().keystroke("a", { using: ["command down"] });
  typeText(wanted, () => {
    confirmInput();
    if (actual && bridgeString(element.attributes.byName('AXSelectedText').value()) !== actual) {
      throw new Error('无法确认原文已全部选中，已停止粘贴。');
    }
  });
  confirmControl();
  if (bridgeString(element.value()) !== wanted) throw new Error('应用未确认输入结果，请重新读取应用状态。');
}

function selectElementText(target, element, payload) {
  const wanted = String(payload.text || '');
  if (!wanted) throw new Error('需要提供要选择的原文');
  let value = '';
  try { value = bridgeString(element.value()); } catch (error) {}
  if (typeof payload.expected_element?.raw_value !== 'string' || value !== payload.expected_element.raw_value) {
    throw new Error('控件原文已变化，请重新读取应用状态。');
  }
  const candidates = [];
  for (let at = value.indexOf(wanted); at >= 0; at = value.indexOf(wanted, at + 1)) {
    if (payload.prefix && !value.slice(0, at).endsWith(payload.prefix)) continue;
    if (payload.suffix && !value.slice(at + wanted.length).startsWith(payload.suffix)) continue;
    candidates.push(at);
  }
  if (candidates.length !== 1) throw new Error('原文不存在或有多处匹配，请重新观察并指定 prefix/suffix');
  const offset = Array.from(value.slice(0, candidates[0])).length;
  const length = Array.from(wanted).length;
  if (offset + length > 5000) throw new Error('目标文字离开头过远，请先缩小编辑范围');
  const selection = norm(payload.selection || "text");
  if (!['text', 'cursor_before', 'cursor_after'].includes(selection)) throw new Error('不支持的文字选择方式');
  const confirmControl = keyboardControlGuard(target, element, payload);
  if (bridgeString(element.value()) !== value) throw new Error('控件原文已变化，请重新读取应用状态。');
  const events = systemEvents();
  const sendKey = (code, options = {}) => {
    confirmControl();
    events.keyCode(code, options);
  };
  sendKey(126, { using: ['command down'] });
  sendKey(123, { using: ['command down'] });
  for (let index = 0; index < offset; index += 1) sendKey(124);
  for (let index = 0; index < length; index += 1) sendKey(124, { using: ['shift down'] });
  confirmForegroundWindow(target.process, payload.expected_window);
  confirmControl();
  let selected = '';
  try { selected = bridgeString(element.attributes.byName('AXSelectedText').value()); } catch (error) {}
  if (selected !== wanted) throw new Error('应用未确认选中指定原文，不能当作选择成功；请重新观察');
  if (selection === "cursor_before") {
    sendKey(123);
    return;
  }
  if (selection === "cursor_after") {
    sendKey(124);
    return;
  }
}

function selectElementTextInBackground(target, element, payload) {
  const expected = payload.expected_element;
  if (isProtectedText(element, bridgeString(element.role()))) throw new Error('不能读取或选择密码控件中的文字。');
  const wanted = String(payload.text || '');
  if (!wanted) throw new Error('需要提供要选择的原文。');
  const value = bridgeString(element.value());
  if (typeof expected?.raw_value !== 'string' || value !== expected.raw_value) throw new Error('控件原文已变化，请重新读取应用状态。');
  const matches = [];
  for (let at = value.indexOf(wanted); at >= 0; at = value.indexOf(wanted, at + 1)) {
    if (payload.prefix && !value.slice(0, at).endsWith(payload.prefix)) continue;
    if (payload.suffix && !value.slice(at + wanted.length).startsWith(payload.suffix)) continue;
    matches.push(at);
  }
  if (matches.length !== 1) throw new Error('原文不存在或有多处匹配，请重新观察并指定 prefix/suffix。');
  const selection = norm(payload.selection || 'text');
  if (!['text', 'cursor_before', 'cursor_after'].includes(selection)) throw new Error('不支持的文字选择方式。');
  const start = matches[0] + (selection === 'cursor_after' ? wanted.length : 0);
  const length = selection === 'text' ? wanted.length : 0;
  ObjC.bindFunction('AXUIElementCreateApplication', ['id', ['unsigned int']]);
  ObjC.bindFunction('AXUIElementCopyAttributeValue', ['int', ['id', 'id', 'id*']]);
  ObjC.bindFunction('AXUIElementSetAttributeValue', ['int', ['id', 'id', 'id']]);
  ObjC.bindFunction('AXValueCreate', ['id', ['unsigned int', 'void*']]);
  ObjC.bindFunction('malloc', ['void*', ['int']]);
  ObjC.bindFunction('free', ['void', ['void*']]);
  const get = (item, attribute) => {
    const result = Ref();
    if ($.AXUIElementCopyAttributeValue(item, attribute, result) !== 0) return null;
    return ObjC.deepUnwrap(result[0]);
  };
  const windows = get($.AXUIElementCreateApplication(target.app.pid), 'AXWindows') || [];
  const sameWindows = windows.filter(item => String(get(item, 'AXTitle') || '') === String(target.windowInfo.title || ''));
  if (sameWindows.length !== 1) throw new Error('无法唯一确认目标窗口，请重新读取应用状态。');
  const queue = [{ item: sameWindows[0], depth: 0 }], candidates = [];
  const deadline = Date.now() + 12000;
  let visited = 0;
  while (queue.length && visited++ < 500 && Date.now() < deadline) {
    const current = queue.shift(), item = current.item;
    const role = String(get(item, 'AXRole') || '');
    if (role === expected.role && !/secure/i.test(role) && !/secure/i.test(String(get(item, 'AXSubrole') || ''))) {
      const title = String(get(item, 'AXTitle') || '').replace(/\s+/g, ' ').trim();
      const description = String(get(item, 'AXDescription') || '').replace(/\s+/g, ' ').trim();
      if ((expected.name ? [title, description].includes(expected.name) : !title && (!expected.description || description === expected.description))
        && String(get(item, 'AXValue') ?? '') === value) candidates.push(item);
    }
    if (current.depth < 12) {
      const children = get(item, 'AXChildren');
      if (Array.isArray(children)) for (const child of children.slice(0, 150)) queue.push({ item: child, depth: current.depth + 1 });
    }
  }
  if (queue.length || candidates.length !== 1) throw new Error('无法唯一确认目标控件，请重新读取应用状态。');
  if (isProtectedText(element, bridgeString(element.role())) || /secure/i.test(String(get(candidates[0], 'AXSubrole') || ''))) throw new Error('不能读取或选择密码控件中的文字。');
  if (bridgeString(element.value()) !== value || String(get(candidates[0], 'AXValue') ?? '') !== value) throw new Error('控件原文已变化，请重新读取应用状态。');
  const buffer = $.malloc(16);
  if (!buffer) throw new Error('无法准备文字选择范围。');
  try {
    const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
    view.setUint32(0, start, true);
    view.setUint32(8, length, true);
    for (let i = 0; i < bytes.length; i++) buffer[i] = bytes[i];
    const range = $.AXValueCreate(4, buffer);
    if (!range || $.AXUIElementSetAttributeValue(candidates[0], 'AXSelectedTextRange', range) !== 0) throw new Error('应用不支持后台文字选择。');
    const actual = element.attributes.byName('AXSelectedTextRange').value();
    if (!Array.isArray(actual) || Number(actual[0]) !== start + 1 || Number(actual[1]) !== start + length) throw new Error('应用未确认文字选择范围，请重新读取应用状态。');
  } finally { $.free(buffer); }
}

function secondaryAction(element, action) {
  let names = [];
  try { names = element.actions().map((_item, index) => bridgeString(element.actions[index].name())).filter(Boolean); } catch (error) {}
  const requested = norm(action);
  if (!names.some((name) => norm(name) === requested)) {
    throw new Error(`控件不提供动作“${action}”，可用动作：${names.join("、") || "无"}`);
  }
  element.actions.byName(action).perform();
}

function permissions() {
  let axTrusted = false;
  let screenCaptureAllowed = null;
  let systemEventsReachable = false;
  let detail = "";
  try { axTrusted = Boolean($.AXIsProcessTrusted()); } catch (error) { detail = String(error); }
  try { screenCaptureAllowed = Boolean($.CGPreflightScreenCaptureAccess()); } catch (error) {}
  try {
    const count = systemEvents().processes().length;
    systemEventsReachable = count > 0;
    detail = `系统事件可访问（${count} 个进程）`;
  } catch (error) {
    detail = String(error.message || error);
  }
  return { axTrusted, systemEventsReachable, screenCaptureAllowed, detail };
}

function listApps() {
  return runningApps()
    .filter((app) => app.policy === 0 && app.bundleId && app.name)
    .map((app) => ({
      id: app.bundleId,
      displayName: app.name,
      path: app.path,
      pid: app.pid,
      isRunning: true,
      frontmost: app.frontmost,
    }))
    .sort((left, right) => Number(right.frontmost) - Number(left.frontmost));
}

function resolveLaunch(query) {
  const running = resolveApp(query);
  if (running) return { running: true, app: running };
  const installed = resolveInstalledApp(query);
  if (installed) return { running: false, app: installed };
  return null;
}

function findMacosScrollBar(rootElement, vertical) {
  const queue = [{ element: rootElement, depth: 0 }];
  const scrollBars = [];
  let visited = 0;
  while (queue.length && visited++ < 120) {
    const current = queue.shift();
    const el = current.element;
    let role = "";
    try { role = bridgeString(el.role()); } catch (e) {}
    const roleNorm = norm(role);
    if (roleNorm.includes("scrollbar")) {
      let orient = "";
      try { orient = norm(bridgeString(el.orientation ? el.orientation() : "")); } catch (e) {}
      if (vertical && (orient.includes("vert") || !orient)) scrollBars.push(el);
      else if (!vertical && orient.includes("horiz")) scrollBars.push(el);
    }
    const attrName = vertical ? "AXVerticalScrollBar" : "AXHorizontalScrollBar";
    try {
      const attr = el.attributes.byName(attrName);
      if (attr) {
        const val = attr.value();
        if (val && !scrollBars.includes(val)) scrollBars.push(val);
      }
    } catch (e) {}
    if (scrollBars.length && current.depth > 0) break;
    if (current.depth < 8) {
      let children = [];
      try { children = el.uiElements(); } catch (e) {}
      if (Array.isArray(children)) {
        for (let i = 0; i < Math.min(children.length, 30); i++) {
          queue.push({ element: children[i], depth: current.depth + 1 });
        }
      }
    }
  }
  return scrollBars[0] || null;
}

function doScrollOnBar(scrollBar, vertical, forward, pages) {
  let valAttr = null;
  let currentVal = null;
  try {
    valAttr = scrollBar.attributes.byName("AXValue");
    if (valAttr) currentVal = Number(valAttr.value());
  } catch (e) {}
  if (currentVal === null || Number.isNaN(currentVal)) {
    try { currentVal = Number(scrollBar.value()); } catch (e) {}
  }

  let actions = [];
  try { actions = scrollBar.actions().map(a => norm(bridgeString(a.name()))); } catch (e) {}

  const step = 0.15 * pages;
  let changed = false;

  if (valAttr && currentVal !== null && !Number.isNaN(currentVal)) {
    const targetVal = forward ? Math.min(1.0, currentVal + step) : Math.max(0.0, currentVal - step);
    if (targetVal !== currentVal) {
      try {
        valAttr.value = targetVal;
        let readBack = Number(valAttr.value());
        if (!Number.isNaN(readBack) && readBack !== currentVal) {
          changed = true;
        }
      } catch (e) {}
    }
  }

  if (!changed && actions.length) {
    const actName = forward
      ? (actions.find(a => a.includes("incrementpage")) || actions.find(a => a.includes("increment")) || actions.find(a => a.includes("pagedown")) || actions.find(a => a.includes("down")))
      : (actions.find(a => a.includes("decrementpage")) || actions.find(a => a.includes("decrement")) || actions.find(a => a.includes("pageup")) || actions.find(a => a.includes("up")));
    if (actName) {
      const times = Math.max(1, Math.round(pages));
      for (let t = 0; t < times; t++) {
        try { scrollBar.actions.byName(actName).perform(); changed = true; } catch (e) {}
        delay(0.05);
      }
    }
  }

  let finalVal = null;
  try { if (valAttr) finalVal = Number(valAttr.value()); } catch (e) {}
  if (finalVal !== null && currentVal !== null && !Number.isNaN(finalVal) && !Number.isNaN(currentVal)) {
    if (finalVal !== currentVal) return { ok: true, before: currentVal, after: finalVal };
    if (forward && currentVal >= 0.99) return { ok: true, notice: "已到达滚动区域底部或最右端" };
    if (!forward && currentVal <= 0.01) return { ok: true, notice: "已到达滚动区域顶部或最左端" };
  }
  if (!changed && !actions.length) {
    throw new Error("应用拒绝后台滚动此区域，请重新读取应用状态。");
  }
  return { ok: true };
}

function scrollInBackground(target, payload) {
  const direction = norm(payload.direction || "down");
  const vertical = ["up", "down", "u", "d"].includes(direction);
  const forward = ["down", "right", "d", "r"].includes(direction);
  const pages = Math.min(10, Math.max(0.1, Number(payload.pages) || 1));

  let startElement = target.windowElement;
  if (payload.element_index) {
    startElement = elementAt(target.windowElement, payload.element_index, payload.expected_element);
  }

  const scrollBar = findMacosScrollBar(startElement, vertical);
  if (!scrollBar) {
    const fallback = payload.element_index ? findMacosScrollBar(target.windowElement, vertical) : null;
    if (!fallback) {
      throw new Error("目标控件或窗口中未找到可供后台滚动的滚动条，请确认该区域内容是否可滚动。");
    }
    return doScrollOnBar(fallback, vertical, forward, pages);
  }
  return doScrollOnBar(scrollBar, vertical, forward, pages);
}

function dispatch(payload) {
  const command = String(payload.command || "");
  throwIfCancelled();
  if (command === "check_permissions") return permissions();
  if (command === "list_apps") return { apps: listApps() };
  if (command === "launch") {
    const resolved = resolveLaunch(payload.app);
    if (!resolved) {
      throw new Error(`系统应用菜单中没有找到“${payload.app}”。请使用应用菜单中显示的正式名称。`);
    }
    return { running: resolved.running, app: resolved.app };
  }
  if (command === "state") return appState(payload);
  if (command === "window_identity") {
    const target = ensureTarget(payload);
    return { capture_identity: windowIdentity(target.process, target.windowInfo, target.windowElement) };
  }
  const background = payload.background !== false;
  if (background && ["click_at", "hover_at", "hover_element", "drag", "press_key", "type_text"].includes(command)) {
    throw new Error("该动作暂不支持后台执行，已停止以免占用用户的鼠标、键盘或前台窗口。");
  }
  if (background && command === "scroll" && !payload.element_index && payload.x !== undefined && payload.y !== undefined) {
    throw new Error("该动作暂不支持后台执行：后台滚动暂不支持按屏幕绝对坐标滚动，请提供 element_index 控件编号，或不传坐标以滚动窗口主滚动区。");
  }
  if (command === "click_element") {
    let target = ensureTarget(payload);
    let element = elementAt(target.windowElement, payload.element_index, payload.expected_element);
    const button = payload.mouse_button || 'left', count = Number(payload.click_count) || 1;
    if (background) {
      if (button !== 'left' || count !== 1) throw new Error('后台点击仅支持控件的单次左键动作。');
      clickElementInBackground(element);
    } else {
      activateWindow(target.process, target.windowElement);
      target = ensureTarget(payload);
      element = elementAt(target.windowElement, payload.element_index, payload.expected_element);
      const window = confirmForegroundWindow(target.process, payload.expected_window);
      const confirmActive = () => confirmPointerApp(target.process);
      if (button === 'left' && count === 1) clickElement(element, window, confirmActive);
      else {
        const point = pointerPoint(window, elementBounds(element)?.center);
        clickAt(point.x, point.y, button, count, confirmActive);
      }
    }
    return { ok: true };
  }
  if (command === "click_at") {
    const target = ensureTarget(payload);
    activateWindow(target.process, target.windowElement);
    const window = confirmForegroundWindow(target.process, payload.expected_window);
    const point = screenshotPoint(window, payload.x, payload.y, Number(payload.scale) || 1);
    clickAt(point.x, point.y, payload.mouse_button || 'left', payload.click_count || 1, () => confirmPointerApp(target.process));
    return { ok: true };
  }
  if (command === 'hover_element' || command === 'hover_at') {
    let target = ensureTarget(payload);
    if (command === 'hover_element') elementAt(target.windowElement, payload.element_index, payload.expected_element);
    activateWindow(target.process, target.windowElement);
    target = ensureTarget(payload);
    const element = command === 'hover_element' ? elementAt(target.windowElement, payload.element_index, payload.expected_element) : null;
    const window = confirmForegroundWindow(target.process, payload.expected_window);
    const point = element ? pointerPoint(window, elementBounds(element)?.center) : screenshotPoint(window, payload.x, payload.y, Number(payload.scale) || 1);
    confirmPointerApp(target.process);
    mouseEvent(5, point.x, point.y, 0);
    return { ok: true };
  }
  if (command === "perform_action") {
    const target = ensureTarget(payload);
    const element = elementAt(target.windowElement, payload.element_index, payload.expected_element);
    if (background && ["axraise", "axfocus", "axshowmenu"].includes(norm(payload.action))) throw new Error("该动作可能显示菜单、切换或聚焦窗口，不能在后台执行。");
    if (!background) activateWindow(target.process, target.windowElement);
    secondaryAction(element, payload.action);
    return { ok: true };
  }
  if (command === "set_value") {
    const target = ensureTarget(payload);
    const element = elementAt(target.windowElement, payload.element_index, payload.expected_element);
    if (isProtectedText(element, bridgeString(element.role()))) throw new Error('请手动填写密码控件。');
    if (background) setElementValueInBackground(element, payload.value);
    else {
      activateWindow(target.process, target.windowElement);
      const current = ensureTarget(payload);
      const control = elementAt(current.windowElement, payload.element_index, payload.expected_element);
      if (isProtectedText(control, bridgeString(control.role()))) throw new Error('请手动填写密码控件。');
      setElementValue(current, control, payload);
    }
    return { ok: true };
  }
  if (command === "replace_text") {
    const target = ensureTarget(payload);
    const element = elementAt(target.windowElement, payload.element_index, payload.expected_element);
    replaceElementTextInBackground(element, payload);
    return { ok: true };
  }
  if (command === 'insert_text') {
    const target = ensureTarget(payload);
    const element = elementAt(target.windowElement, payload.element_index, payload.expected_element);
    insertSelectedTextInBackground(element, payload);
    return { ok: true };
  }
  if (command === "select_text") {
    const target = ensureTarget(payload);
    const element = elementAt(target.windowElement, payload.element_index, payload.expected_element);
    if (isProtectedText(element, bridgeString(element.role()))) throw new Error('不能读取或选择密码控件中的文字。');
    if (background) selectElementTextInBackground(target, element, payload);
    else {
      activateWindow(target.process, target.windowElement);
      const current = ensureTarget(payload);
      const control = elementAt(current.windowElement, payload.element_index, payload.expected_element);
      if (isProtectedText(control, bridgeString(control.role()))) throw new Error('不能读取或选择密码控件中的文字。');
      selectElementText(current, control, payload);
    }
    return { ok: true };
  }
  if (command === "scroll") {
    let target = ensureTarget(payload);
    if (background) {
      scrollInBackground(target, payload);
      return { ok: true };
    }
    if (payload.element_index) elementAt(target.windowElement, payload.element_index, payload.expected_element);
    activateWindow(target.process, target.windowElement);
    target = ensureTarget(payload);
    const element = payload.element_index ? elementAt(target.windowElement, payload.element_index, payload.expected_element) : null;
    const window = confirmForegroundWindow(target.process, payload.expected_window);
    let point = window.center;
    if (element) point = pointerPoint(window, elementBounds(element)?.center);
    else if (payload.x !== undefined || payload.y !== undefined) point = screenshotPoint(window, payload.x, payload.y, Number(payload.scale) || 1);
    scrollAt(point.x, point.y, payload.direction, payload.pages, () => confirmPointerApp(target.process));
    return { ok: true };
  }
  if (command === "drag") {
    const target = ensureTarget(payload);
    const scale = Number(payload.scale) || 1;
    activateWindow(target.process, target.windowElement);
    const window = confirmForegroundWindow(target.process, payload.expected_window);
    const from = screenshotPoint(window, payload.from_x, payload.from_y, scale);
    const to = screenshotPoint(window, payload.to_x, payload.to_y, scale);
    dragAt(from.x, from.y, to.x, to.y, () => confirmPointerApp(target.process));
    return { ok: true };
  }
  if (command === "press_key") {
    const target = ensureTarget(payload);
    activateWindow(target.process, target.windowElement);
    confirmForegroundWindow(target.process, payload.expected_window);
    pressKey(payload.key);
    return { ok: true };
  }
  if (command === "type_text") {
    const target = ensureTarget(payload);
    activateWindow(target.process, target.windowElement);
    typeText(payload.text, () => confirmForegroundWindow(target.process, payload.expected_window));
    return { ok: true };
  }
  throw new Error(`未知命令：${command}`);
}

function main() {
  try {
    const result = dispatch(payloadFromEnv());
    emit(Object.assign({ ok: true }, result));
  } catch (error) {
    emit({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

main();
