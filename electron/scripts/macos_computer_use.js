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
    let frontmost = false;
    try { name = bridgeString(app.localizedName); } catch (error) {}
    try { bundleId = bridgeString(app.bundleIdentifier); } catch (error) {}
    try { path = app.executableURL && app.executableURL.path ? bridgeString(app.executableURL.path) : ""; } catch (error) {}
    try { policy = Number(app.activationPolicy); } catch (error) {}
    try { frontmost = Boolean(Number(app.isActive)); } catch (error) {}
    result.push({ name, bundleId, path, policy, frontmost });
  }
  return result;
}

function resolveApp(query) {
  const needle = norm(query);
  if (!needle) return null;
  let best = null;
  let bestScore = 0;
  for (const app of runningApps()) {
    const name = norm(app.name);
    const bundleId = norm(app.bundleId);
    const path = norm(app.path);
    let score = 0;
    if (bundleId && bundleId === needle) score = 100;
    else if (name && name === needle) score = 100;
    else if (path && path === needle) score = 100;
    else if (name && (name.includes(needle) || needle.includes(name))) score = 60;
    else if (bundleId && bundleId.includes(needle)) score = 50;
    else if (path && path.includes(needle)) score = 40;
    if (score > bestScore) {
      bestScore = score;
      best = app;
    }
  }
  return bestScore ? best : null;
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
    if (expected && norm(match.title) !== expected) {
      throw new Error(
        `窗口编号“${windowId}”的标题已经变化（现在是“${match.title || "（无标题）"}”），已停止操作。请重新读取应用状态。`,
      );
    }
    return match;
  }
  const needle = norm(query);
  const scored = windows
    .map((window) => {
      const title = norm(window.title);
      let score = 0;
      if (title && title === needle) score = 100;
      else if (title && (title.includes(needle) || needle.includes(title))) score = 60;
      else if (!needle) score = 1;
      return { window, score };
    })
    .filter((item) => item.score > 0);
  if (!scored.length) return windows[0];
  const bestScore = Math.max(...scored.map((item) => item.score));
  const best = scored.filter((item) => item.score === bestScore);
  if (best.length > 1) {
    const choices = best.map((item) => `${item.window.index}：${item.window.title || "（无标题）"}`).join("\n");
    throw new Error(`“${query}”匹配到多个窗口，请使用 window_id 明确选择：\n${choices}`);
  }
  return best[0].window;
}

function walkWindow(windowElement, maxNodes, maxDepth, maxChildren, visitor, deadline = 0) {
  const queue = [{ element: windowElement, depth: 0 }];
  let index = 0;
  while (queue.length && index < maxNodes && (deadline <= 0 || Date.now() < deadline)) {
    const current = queue.shift();
    visitor(current.element, index, current.depth);
    index += 1;
    if (current.depth >= maxDepth) continue;
    let children = [];
    try { children = current.element.uiElements(); } catch (error) {}
    if (!Array.isArray(children)) children = [];
    if (children.length > maxChildren) children = children.slice(0, maxChildren);
    for (const child of children) queue.push({ element: child, depth: current.depth + 1 });
  }
  return index;
}

function elementInfo(element) {
  const info = { role: "", name: "", description: "", value: "", position: null, size: null, actions: [] };
  try { info.role = bridgeString(element.role()); } catch (error) {}
  try { info.name = bridgeString(element.name()).replace(/\s+/g, " ").trim(); } catch (error) {}
  try { info.description = bridgeString(element.description()).replace(/\s+/g, " ").trim(); } catch (error) {}
  try { info.value = bridgeString(element.value()).replace(/\s+/g, " ").trim(); } catch (error) {}
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
      .map((action) => {
        let name = "";
        try { name = bridgeString(action.name()); } catch (error) {}
        return name.split(/\r?\n/)[0].split(/Name:/)[0].trim().slice(0, 48);
      })
      .filter(Boolean);
  } catch (error) {}
  return info;
}

function buildTree(windowElement, maxNodes = 500, maxDepth = 12, maxChildren = 150) {
  const lines = [];
  const deadline = Date.now() + 12_000;
  const visited = walkWindow(windowElement, maxNodes, maxDepth, maxChildren, (element, index) => {
    const info = elementInfo(element);
    const bounds = info.position && info.size && info.size[0] > 0 && info.size[1] > 0
      ? ` bounds=(${Math.round(info.position[0])},${Math.round(info.position[1])},${Math.round(info.size[0])},${Math.round(info.size[1])})`
      : "";
    const actions = info.actions.length ? ` actions=${info.actions.join(",")}` : "";
    const name = info.name ? ` "${String(info.name).replace(/"/g, "'").slice(0, 240)}"` : "";
    const description = !name && info.description
      ? ` "${String(info.description).replace(/"/g, "'").slice(0, 240)}"`
      : "";
    const value = info.value ? ` value=${String(info.value).replace(/\s+/g, " ").slice(0, 120)}` : "";
    lines.push(`[e${index}] ${info.role || "unknown"}${name}${description}${value}${bounds}${actions}`);
  }, deadline);
  if (visited >= maxNodes || Date.now() >= deadline) lines.push("…控件较多或读取缓慢，已截断");
  return lines.join("\n");
}

function elementAt(windowElement, rawIndex) {
  const text = String(rawIndex || "").trim().toLocaleLowerCase();
  const index = text.startsWith("e") ? Number(text.slice(1)) : Number(text);
  if (!Number.isInteger(index) || index < 0) throw new Error(`控件编号无效：${rawIndex}`);
  let found = null;
  walkWindow(windowElement, 2000, 20, 200, (element, current) => {
    if (current === index) found = element;
  }, Date.now() + 12_000);
  if (!found) throw new Error(`没有找到控件：${rawIndex}。请重新读取应用状态。`);
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

function windowBounds(windowElement) {
  const bounds = elementBounds(windowElement);
  if (!bounds) throw new Error("无法读取目标窗口的位置和大小，已停止坐标操作以避免点到其他应用。");
  return bounds;
}

function mouseEvent(type, x, y, button) {
  const source = $.CGEventSourceCreate(0);
  const point = $.CGPointMake(x, y);
  const event = $.CGEventCreateMouseEvent(source, type, point, button);
  $.CGEventPost($.kCGHIDEventTap, event);
}

function clickAt(x, y, buttonName, count) {
  const button = buttonName === "right" ? 1 : buttonName === "middle" ? 2 : 0;
  const downType = button === 1 ? 3 : button === 2 ? 25 : 1;
  const upType = button === 1 ? 4 : button === 2 ? 26 : 2;
  mouseEvent(5, x, y, button);
  const repeats = Math.min(3, Math.max(1, Number(count) || 1));
  for (let index = 0; index < repeats; index += 1) {
    mouseEvent(downType, x, y, button);
    mouseEvent(upType, x, y, button);
    delay(0.05);
  }
}

function dragAt(fromX, fromY, toX, toY) {
  const steps = 12;
  mouseEvent(5, fromX, fromY, 0);
  delay(0.05);
  mouseEvent(1, fromX, fromY, 0);
  delay(0.05);
  for (let index = 1; index <= steps; index += 1) {
    const x = Math.round(fromX + (toX - fromX) * index / steps);
    const y = Math.round(fromY + (toY - fromY) * index / steps);
    mouseEvent(6, x, y, 0);
    delay(0.01);
  }
  mouseEvent(2, toX, toY, 0);
}

function scrollAt(x, y, direction, pages) {
  mouseEvent(5, x, y, 0);
  const lines = Math.max(1, Math.round((Number(pages) || 1) * 3));
  const delta = direction === "down" || direction === "d" ? -lines : lines;
  const source = $.CGEventSourceCreate(0);
  const event = $.CGEventCreateScrollWheelEvent(source, 0, 1, delta);
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

function typeText(text) {
  const events = systemEvents();
  const lines = String(text || "").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) events.keyCode(36);
    const line = lines[index];
    if (!line) continue;
    try {
      events.keystroke(line);
    } catch (error) {
      for (const character of line) events.keystroke(character);
    }
  }
}

function activateWindow(process, windowElement) {
  try { windowElement.performAction("AXRaise"); } catch (error) {}
  try { process.frontmost = true; } catch (error) {}
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
  const windowElement = process.windows()[windowInfo.index - 1];
  return { app, process, windowInfo, windowElement };
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
  const windowElement = process.windows()[windowInfo.index - 1];
  const tree = buildTree(windowElement);
  const bounds = elementBounds(windowElement);
  return {
    app: { name: app.name, bundleId: app.bundleId, path: app.path },
    window_index: windowInfo.index,
    window_title: windowInfo.title,
    position: bounds ? [bounds.x, bounds.y] : null,
    size: bounds ? [bounds.width, bounds.height] : null,
    tree,
  };
}

function clickElement(element) {
  try {
    element.click();
    return;
  } catch (error) {}
  try {
    element.performAction("AXPress");
    return;
  } catch (error) {}
  const bounds = elementBounds(element);
  if (!bounds) throw new Error("该控件没有可点击动作或有效位置");
  clickAt(bounds.center.x, bounds.center.y, "left", 1);
}

function setElementValue(element, value) {
  const wanted = String(value ?? "");
  try {
    element.value = wanted;
    if (String(element.value() ?? "") === wanted) return;
  } catch (error) {}
  try { element.performAction("AXFocus"); } catch (error) {}
  try { element.click(); } catch (error) {}
  systemEvents().keystroke("a", { using: ["command down"] });
  typeText(wanted);
}

function selectElementText(element, payload) {
  try { element.performAction("AXFocus"); } catch (error) {}
  try { element.click(); } catch (error) {}
  const selection = norm(payload.selection || "text");
  if (selection === "cursor_before") {
    systemEvents().keyCode(115);
    return;
  }
  if (selection === "cursor_after") {
    systemEvents().keyCode(119);
    return;
  }
  systemEvents().keystroke("a", { using: ["command down"] });
}

function secondaryAction(element, action) {
  let names = [];
  try { names = element.actions().map((item) => String(item.name() || "")).filter(Boolean); } catch (error) {}
  const requested = norm(action);
  if (!names.some((name) => norm(name) === requested)) {
    throw new Error(`控件不提供动作“${action}”，可用动作：${names.join("、") || "无"}`);
  }
  element.performAction(action);
}

function permissions() {
  let axTrusted = false;
  let systemEventsReachable = false;
  let detail = "";
  try { axTrusted = Boolean($.AXIsProcessTrusted()); } catch (error) { detail = String(error); }
  try {
    const count = systemEvents().processes().length;
    systemEventsReachable = count > 0;
    detail = `系统事件可访问（${count} 个进程）`;
  } catch (error) {
    detail = String(error.message || error);
  }
  return { axTrusted, systemEventsReachable, detail };
}

function listApps() {
  return runningApps()
    .filter((app) => app.policy === 0 && app.bundleId && app.name)
    .map((app) => ({
      id: app.bundleId,
      displayName: app.name,
      path: app.path,
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

function dispatch(payload) {
  const command = String(payload.command || "");
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
  if (command === "click_element") {
    const target = ensureTarget(payload);
    const element = elementAt(target.windowElement, payload.element_index);
    activateWindow(target.process, target.windowElement);
    clickElement(element);
    return { ok: true };
  }
  if (command === "click_at") {
    const target = ensureTarget(payload);
    const bounds = windowBounds(target.windowElement);
    const scale = Number(payload.scale) || 1;
    activateWindow(target.process, target.windowElement);
    clickAt(
      Math.round(bounds.x + Number(payload.x) / scale),
      Math.round(bounds.y + Number(payload.y) / scale),
      payload.mouse_button || "left",
      payload.click_count || 1,
    );
    return { ok: true };
  }
  if (command === "perform_action") {
    const target = ensureTarget(payload);
    const element = elementAt(target.windowElement, payload.element_index);
    activateWindow(target.process, target.windowElement);
    secondaryAction(element, payload.action);
    return { ok: true };
  }
  if (command === "set_value") {
    const target = ensureTarget(payload);
    const element = elementAt(target.windowElement, payload.element_index);
    activateWindow(target.process, target.windowElement);
    setElementValue(element, payload.value);
    return { ok: true };
  }
  if (command === "select_text") {
    const target = ensureTarget(payload);
    const element = elementAt(target.windowElement, payload.element_index);
    activateWindow(target.process, target.windowElement);
    selectElementText(element, payload);
    return { ok: true };
  }
  if (command === "scroll") {
    const target = ensureTarget(payload);
    const element = elementAt(target.windowElement, payload.element_index);
    const bounds = elementBounds(element) || windowBounds(target.windowElement);
    activateWindow(target.process, target.windowElement);
    scrollAt(bounds.center.x, bounds.center.y, payload.direction, payload.pages);
    return { ok: true };
  }
  if (command === "drag") {
    const target = ensureTarget(payload);
    const bounds = windowBounds(target.windowElement);
    const scale = Number(payload.scale) || 1;
    activateWindow(target.process, target.windowElement);
    dragAt(
      Math.round(bounds.x + Number(payload.from_x) / scale),
      Math.round(bounds.y + Number(payload.from_y) / scale),
      Math.round(bounds.x + Number(payload.to_x) / scale),
      Math.round(bounds.y + Number(payload.to_y) / scale),
    );
    return { ok: true };
  }
  if (command === "press_key") {
    const target = ensureTarget(payload);
    activateWindow(target.process, target.windowElement);
    pressKey(payload.key);
    return { ok: true };
  }
  if (command === "type_text") {
    const target = ensureTarget(payload);
    activateWindow(target.process, target.windowElement);
    typeText(payload.text);
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
