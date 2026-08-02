import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export function unpackedResourcePath(file) {
  return String(file).replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

const accessibilityHelper = unpackedResourcePath(path.join(here, "scripts", "linux_computer_use.py"));
const MAX_OUTPUT = 1_000_000;
const DEPENDENCY_INSTALL_WAIT_MS = 15 * 60_000;
const preparedDependencyPlans = new Map();
const systemPrograms = Object.freeze({
  "apt-get": "/usr/bin/apt-get",
  pkexec: "/usr/bin/pkexec",
  "systemd-run": "/usr/bin/systemd-run",
  python3: "/usr/bin/python3",
});
const packageManagerLockPaths = Object.freeze([
  "/var/lib/dpkg/lock-frontend",
  "/var/lib/apt/lists/lock",
  "/var/cache/apt/archives/lock",
]);
export const packageManagerLockLauncherScript = [
  "import fcntl, os, sys, time",
  "paths = sys.argv[1].split(',')",
  "deadline = time.monotonic() + 300",
  "fds = []",
  "while True:",
  "    try:",
  "        for item in paths:",
  "            fd = os.open(item, os.O_RDWR | os.O_CREAT, 0o640)",
  "            try:",
  "                fcntl.lockf(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)",
  "            except OSError:",
  "                os.close(fd)",
  "                raise",
  "            fds.append(fd)",
  "        break",
  "    except OSError:",
  "        for fd in fds:",
  "            os.close(fd)",
  "        fds = []",
  "        if time.monotonic() >= deadline:",
  "            os.environ['DYWORKER_DPKG_LOCK_FAILED'] = '1'",
  "            break",
  "        time.sleep(0.5)",
  "for fd in fds:",
  "    os.set_inheritable(fd, True)",
  "os.environ['DYWORKER_DPKG_LOCK_FDS'] = ','.join(str(fd) for fd in fds)",
  "os.execv(sys.argv[2], sys.argv[2:])",
].join("\n");
const linuxDependencies = Object.freeze([
  { packageName: "xdotool", label: "xdotool", command: ["which", "xdotool"] },
  { packageName: "wmctrl", label: "wmctrl", command: ["which", "wmctrl"] },
  { packageName: "python3-pyatspi", label: "python3-pyatspi", command: ["python3", "-c", "import pyatspi"] },
  { packageName: "imagemagick", label: "ImageMagick", command: ["which", "import"] },
]);
export const linuxDependencyPackages = Object.freeze(linuxDependencies.map((item) => item.packageName));

export function linuxDependencyInstallCommand(packages = linuxDependencyPackages) {
  const requested = [...new Set((Array.isArray(packages) ? packages : [])
    .map(String)
    .filter((packageName) => linuxDependencyPackages.includes(packageName)))];
  return {
    program: systemPrograms.pkexec,
    args: [systemPrograms["apt-get"], "install", "-y", "--no-remove", ...requested],
  };
}

export async function isTrustedRootFile(target) {
  try {
    const resolved = await fs.realpath(target);
    const info = await fs.stat(resolved);
    if (!info.isFile() || info.uid !== 0 || (info.mode & 0o022) !== 0) return false;
    let current = path.dirname(resolved);
    while (true) {
      const directory = await fs.stat(current);
      if (!directory.isDirectory() || directory.uid !== 0 || (directory.mode & 0o022) !== 0) return false;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return true;
  } catch {
    return false;
  }
}

const appProperty = {
  type: "string",
  description: "应用名称、窗口标题或桌面应用标识，例如 WPS、Firefox、org.kde.dolphin",
};
const windowIdProperty = {
  type: "string",
  description: "get_app_state 返回的窗口编号；同一应用有多个窗口时必须提供",
};
const windowTitleProperty = {
  type: "string",
  description: "get_app_state 返回的完整窗口标题；用于防止窗口关闭或编号被回收后操作错文档",
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
    tool("check_dependencies", "检查麒麟/Linux 本机操控所需组件是否已经安装。", {}, [], true),
    tool("prepare_dependency_install", "生成完整安装预览，不修改系统。预览确认后才能申请管理员权限安装。", {
      packages: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", enum: linuxDependencyPackages },
        description: "check_dependencies 返回的缺失组件，必须原样传入",
      },
    }, ["packages"], true, { openWorldHint: true }),
    tool("install_dependencies", "通过系统授权窗口安装检查结果中缺少的麒麟/Linux 本机操控组件。安装前必须获得用户确认。", {
      packages: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", enum: linuxDependencyPackages },
        description: "check_dependencies 返回的缺失组件，必须原样传入",
      },
      plan_token: { type: "string", description: "prepare_dependency_install 或计划变化提示返回的计划令牌" },
      plan_summary: { type: "string", description: "prepare_dependency_install 或计划变化提示返回的完整计划摘要" },
    }, ["packages", "plan_token", "plan_summary"], false, { destructiveHint: true, openWorldHint: true }),
    tool("list_apps", "列出当前桌面上正在运行的应用和窗口。", {}, [], true),
    tool("launch_app", "从系统应用菜单启动指定应用。启动会改变桌面状态，需要用户授权。", {
      app: appProperty,
    }, ["app"]),
    tool("get_app_state", "读取已运行应用的当前窗口、可访问控件与目标窗口截图。每轮操作应用前必须先调用。", appTargetProperties(), ["app"], true),
    tool("click", "按控件编号或目标窗口内坐标点击。窗口截图左上角为 (0,0)。", appTargetProperties({
      element_index: { type: "string", description: "get_app_state 返回的控件编号，例如 e12" },
      x: { type: "number", description: "目标窗口内 X 坐标，截图左上角为 0" },
      y: { type: "number", description: "目标窗口内 Y 坐标，截图左上角为 0" },
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
    tool("select_text", "选择可编辑控件中的文字，或把光标放到文字前后。", appTargetProperties({
      element_index: { type: "string", description: "文字控件编号" },
      text: { type: "string", description: "要选择的原文" },
      prefix: { type: "string", description: "可选的前置文字，用于区分重复内容" },
      suffix: { type: "string", description: "可选的后置文字，用于区分重复内容" },
      selection: { type: "string", enum: ["text", "cursor_before", "cursor_after"], description: "选择方式，默认 text" },
    }), stableTargetRequired(["element_index", "text"])),
    tool("scroll", "在指定控件位置向上、下、左或右滚动。", appTargetProperties({
      element_index: { type: "string", description: "滚动区域或附近控件编号" },
      direction: { type: "string", enum: ["up", "down", "left", "right", "u", "d", "l", "r"] },
      pages: { type: "number", minimum: 0.1, maximum: 10, description: "滚动页数，默认 1" },
    }), stableTargetRequired(["element_index", "direction"])),
    tool("drag", "按目标窗口内坐标从一个位置拖动到另一个位置，截图左上角为 (0,0)。", appTargetProperties({
      from_x: { type: "number" },
      from_y: { type: "number" },
      to_x: { type: "number" },
      to_y: { type: "number" },
    }), stableTargetRequired(["from_x", "from_y", "to_x", "to_y"])),
    tool("press_key", "向指定应用发送一个按键或组合键，例如 Return、ctrl+s、alt+F4。", appTargetProperties({
      key: { type: "string", description: "xdotool 按键格式" },
    }), stableTargetRequired(["key"])),
    tool("type_text", "向指定应用输入原样文字。", appTargetProperties({
      text: { type: "string", description: "要输入的文字" },
    }), stableTargetRequired(["text"])),
  ];
}

const activeChildren = new Set();
const cancelledToolRequests = new Set();
let activeToolRequest = null;
let shutdownRequested = false;

function stopChild(child, signal = "SIGTERM") {
  if (child?.__dyworkerProtectedSystemTransaction) return;
  try {
    if (child?.__dyworkerProcessGroup && child.pid) process.kill(-child.pid, signal);
    else child?.kill(signal);
  } catch {
    // 进程可能已经退出
  }
}

function run(program, args = [], {
  input = "",
  timeoutMs = 10_000,
  detached = false,
  killProcessGroup = false,
  protectedSystemTransaction = false,
  env = {},
} = {}) {
  return new Promise((resolve, reject) => {
    if (activeToolRequest?.cancelled && !protectedSystemTransaction) {
      reject(new Error("任务已停止"));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(program, args, {
      env: { ...process.env, ...env },
      detached: detached || killProcessGroup,
      stdio: detached ? "ignore" : ["pipe", "pipe", "pipe"],
    });
    child.__dyworkerProcessGroup = killProcessGroup;
    child.__dyworkerProtectedSystemTransaction = protectedSystemTransaction;
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
      if (shutdownRequested && ![...activeChildren].some((item) => item.__dyworkerProtectedSystemTransaction)) {
        process.exit(0);
      }
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

async function dependencyStatus() {
  const items = await Promise.all(linuxDependencies.map(async ({ packageName, label, command }) => {
    const result = await tryRun(command[0], command.slice(1), { timeoutMs: 8_000 });
    return { packageName, label, installed: result.code === 0 };
  }));
  return {
    ready: items.every((item) => item.installed),
    installed: items.filter((item) => item.installed).map((item) => item.packageName),
    missing: items.filter((item) => !item.installed).map((item) => item.packageName),
  };
}

function normalizedPackages(packages) {
  return [...new Set((Array.isArray(packages) ? packages : []).map(String))].sort();
}

function dependencyPlanFromOutput(packages, output) {
  const lines = String(output || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const removals = lines.filter((line) => /^Remv\s+/i.test(line));
  const changes = lines.filter((line) => /^(Inst|Conf)\s+/i.test(line));
  const normalized = {
    packages: normalizedPackages(packages),
    changes,
  };
  const token = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  const summary = changes.length
    ? `共 ${changes.length} 项变更：\n${changes.join("\n")}`
    : `共 0 项额外变更；将确认安装：${normalized.packages.join("、")}`;
  return {
    ok: removals.length === 0,
    blocked: removals.length > 0,
    changes,
    removals,
    summary,
    token,
  };
}

async function dependencyInstallPlan(packages) {
  const result = await tryRun("apt-get", ["-s", "--no-remove", "install", ...packages], { timeoutMs: 2 * 60_000 });
  if (result.code !== 0) {
    return { ok: false, blocked: false, summary: (result.stderr || result.stdout || "").trim().slice(0, 1200) };
  }
  return dependencyPlanFromOutput(packages, `${result.stdout}\n${result.stderr}`);
}

function dependencyInstallStatusDirectory() {
  const testDirectory = String(process.env.DYWORKER_TEST_DEPENDENCY_STATUS_DIR || "");
  const temporaryRoot = path.resolve(os.tmpdir());
  if (
    process.platform !== "linux"
    && testDirectory
    && path.resolve(testDirectory).startsWith(`${temporaryRoot}${path.sep}`)
  ) {
    return path.resolve(testDirectory);
  }
  return "/run/dyworker";
}

function dependencyInstallStatusPath(uid = typeof process.getuid === "function" ? process.getuid() : "user") {
  return path.join(dependencyInstallStatusDirectory(), `dependency-install-${uid}.json`);
}

async function readDependencyInstallStatus(uid) {
  try {
    const value = JSON.parse(await fs.readFile(dependencyInstallStatusPath(uid), "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

async function writeDependencyInstallStatus(value, uid) {
  const directory = dependencyInstallStatusDirectory();
  await fs.mkdir(directory, { recursive: true, mode: 0o755 });
  const target = dependencyInstallStatusPath(uid);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o644 });
  await fs.rename(temporary, target);
}

function isProcessRunning(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function dependencyStatusText(status) {
  if (status.ready) return "麒麟/Linux 本机操控环境已准备完成。";
  const installStatus = await readDependencyInstallStatus();
  if (installStatus?.state === "running" && isProcessRunning(installStatus.pid)) {
    return [
      "本机操控环境正在由系统后台安装。",
      `仍缺少：${status.missing.join("、")}`,
      "可以稍后再次检查；关闭 DYWorker 不会中断系统安装。",
    ].join("\n");
  }
  if (installStatus?.state === "failed") {
    return [
      "上一次本机操控环境安装没有完成。",
      `仍缺少：${status.missing.join("、")}`,
      `原因：${String(installStatus.detail || "系统安装返回失败").slice(0, 1200)}`,
      "请重新生成安装预览，或联系系统管理员检查软件源。",
    ].join("\n");
  }
  if (installStatus?.state === "plan_changed") {
    return [
      "管理员复核发现安装预览已经变化，因此没有执行安装。",
      `仍缺少：${status.missing.join("、")}`,
      "请重新生成完整安装预览并确认。",
    ].join("\n");
  }
  if (installStatus?.state === "completed") {
    return [
      "系统后台安装已经结束，但本机操控环境仍不完整。",
      `仍缺少：${status.missing.join("、")}`,
      "请联系系统管理员检查软件源和安装日志。",
    ].join("\n");
  }
  return [
    "本机操控环境尚未准备完成。",
    `缺少：${status.missing.join("、")}`,
    "请调用 prepare_dependency_install，并把缺失组件原样传入以生成完整安装预览。",
  ].join("\n");
}

async function assertPackageManagerAvailable() {
  if (process.platform !== "linux" && process.env.DYWORKER_TEST_DEPENDENCY_STATUS_DIR) {
    return {
      "apt-get": "apt-get",
      pkexec: "pkexec",
      "systemd-run": "systemd-run",
      python3: "python3",
    };
  }
  for (const [name, program] of Object.entries(systemPrograms)) {
    if (!await isTrustedRootFile(program)) {
      throw new Error(`系统组件 ${name} 不在可信的系统位置，DYWorker 已停止申请管理员权限。请联系系统管理员处理。`);
    }
  }
  const runtime = await fs.realpath(process.execPath).catch(() => "");
  const source = fileURLToPath(import.meta.url);
  const asarMarker = `${path.sep}app.asar${path.sep}`;
  const sourceAuthority = source.includes(asarMarker)
    ? `${source.slice(0, source.indexOf(asarMarker))}${path.sep}app.asar`
    : source;
  const resolvedSourceAuthority = await fs.realpath(sourceAuthority).catch(() => "");
  if (!runtime || !resolvedSourceAuthority || !await isTrustedRootFile(runtime) || !await isTrustedRootFile(resolvedSourceAuthority)) {
    throw new Error("当前 DYWorker 安装位置可被普通用户修改，不能安全启动管理员任务。请让系统管理员安装正式软件包后重试。");
  }
  const trustedSource = source.includes(asarMarker)
    ? `${resolvedSourceAuthority}${path.sep}${source.slice(source.indexOf(asarMarker) + asarMarker.length)}`
    : resolvedSourceAuthority;
  return { ...systemPrograms, runtime, source: trustedSource };
}

function assertRequestedPackages(args, status) {
  const requested = normalizedPackages(args.packages);
  const missing = normalizedPackages(status.missing);
  if (JSON.stringify(requested) !== JSON.stringify(missing)) {
    throw new Error(`安装范围与最新检查结果不一致。当前缺少：${status.missing.join("、")}。请重新检查后原样提交。`);
  }
  return requested;
}

async function runDependencyInstallerWorker(uid, token, packages) {
  const allowed = normalizedPackages(packages);
  if (
    !/^\d+$/.test(String(uid || ""))
    || !/^[a-f0-9]{64}$/.test(String(token || ""))
    || !allowed.length
    || allowed.some((packageName) => !linuxDependencyPackages.includes(packageName))
  ) {
    process.exitCode = 2;
    return;
  }
  const aptGet = process.platform === "linux" ? systemPrograms["apt-get"] : "apt-get";
  const inheritedLockFds = String(process.env.DYWORKER_DPKG_LOCK_FDS || "").split(",").filter(Boolean);
  const lockFdsAccessible = await Promise.all(inheritedLockFds.map(async (fd) =>
    /^\d+$/.test(fd) && await fs.access(`/proc/self/fd/${fd}`).then(() => true).catch(() => false)));
  if (
    process.platform === "linux"
    && (
      typeof process.getuid !== "function"
      || process.getuid() !== 0
      || process.env.DYWORKER_DPKG_LOCK_FAILED === "1"
      || inheritedLockFds.length !== packageManagerLockPaths.length
      || lockFdsAccessible.some((accessible) => !accessible)
    )
  ) {
    await writeDependencyInstallStatus({
      state: "failed",
      pid: process.pid,
      packages: allowed,
      token,
      finishedAt: new Date().toISOString(),
      detail: process.env.DYWORKER_DPKG_LOCK_FAILED === "1"
        ? "等待系统软件安装锁超时，请稍后重试。"
        : "管理员安装任务没有持有完整的系统软件锁，已停止执行。",
    }, uid);
    process.exitCode = 1;
    return;
  }
  await writeDependencyInstallStatus({
    state: "running",
    pid: process.pid,
    packages: allowed,
    token,
    startedAt: new Date().toISOString(),
  }, uid);
  const planResult = await tryRun(aptGet, [
    "-s",
    "--no-remove",
    "-o",
    "Debug::NoLocking=1",
    "install",
    ...allowed,
  ], {
    timeoutMs: 2 * 60_000,
  });
  const plan = planResult.code === 0
    ? dependencyPlanFromOutput(allowed, `${planResult.stdout}\n${planResult.stderr}`)
    : { ok: false, summary: (planResult.stderr || planResult.stdout || "无法生成管理员级安装计划").trim().slice(0, 1200) };
  if (!plan.ok) {
    await writeDependencyInstallStatus({
      state: "failed",
      pid: process.pid,
      packages: allowed,
      token,
      finishedAt: new Date().toISOString(),
      detail: plan.blocked ? "安装计划包含删除现有软件，已阻止执行。" : plan.summary,
    }, uid);
    process.exitCode = 1;
    return;
  }
  if (plan.token !== token) {
    await writeDependencyInstallStatus({
      state: "plan_changed",
      pid: process.pid,
      packages: allowed,
      requestedToken: token,
      token: plan.token,
      planSummary: plan.summary,
      finishedAt: new Date().toISOString(),
    }, uid);
    process.exitCode = 3;
    return;
  }
  const result = await tryRun(aptGet, [
    "-o",
    "Debug::NoLocking=1",
    "install",
    "-y",
    "--no-remove",
    ...allowed,
  ], {
    timeoutMs: 0,
    protectedSystemTransaction: true,
    env: { DPKG_FRONTEND_LOCKED: "1" },
  });
  if (result.code === 0) {
    await writeDependencyInstallStatus({
      state: "completed",
      pid: process.pid,
      packages: allowed,
      token,
      finishedAt: new Date().toISOString(),
    }, uid);
    return;
  }
  await writeDependencyInstallStatus({
    state: "failed",
    pid: process.pid,
    packages: allowed,
    token,
    finishedAt: new Date().toISOString(),
    detail: (result.stderr || result.stdout || "用户可能取消了系统授权").trim().slice(0, 1200),
  }, uid);
  process.exitCode = 1;
}

async function launchDependencyInstaller(packages, token, programs) {
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "";
  if (!/^\d+$/.test(uid)) throw new Error("无法识别当前用户，已停止系统安装。");
  const existing = await readDependencyInstallStatus();
  if (existing?.state === "running" && isProcessRunning(existing.pid)) {
    throw new Error("本机操控环境已经在系统后台安装，请稍后检查结果。");
  }
  const unit = `dyworker-dependency-install-${uid}`;
  const systemdArgs = [
    programs["systemd-run"],
    "--quiet",
    "--collect",
    `--unit=${unit}`,
    "--property=Type=exec",
    "--setenv=ELECTRON_RUN_AS_NODE=1",
  ];
  const testStatusDirectory = String(process.env.DYWORKER_TEST_DEPENDENCY_STATUS_DIR || "");
  if (process.platform !== "linux" && testStatusDirectory) {
    systemdArgs.push(`--setenv=DYWORKER_TEST_DEPENDENCY_STATUS_DIR=${testStatusDirectory}`);
  }
  systemdArgs.push(
    programs.python3,
    "-c",
    packageManagerLockLauncherScript,
    packageManagerLockPaths.join(","),
    programs.runtime || process.execPath,
    programs.source || fileURLToPath(import.meta.url),
    "--locked-dependency-install-worker",
    uid,
    token,
    ...packages,
  );
  const result = await tryRun(programs.pkexec, systemdArgs, { timeoutMs: 2 * 60_000 });
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || "用户可能取消了系统授权").trim().slice(0, 1200);
    throw new Error(`没有启动系统后台安装：${detail}`);
  }
}

async function waitForDependencyInstaller(token) {
  const started = Date.now();
  while (Date.now() - started < DEPENDENCY_INSTALL_WAIT_MS) {
    const status = await readDependencyInstallStatus();
    if (
      (status?.token === token || status?.requestedToken === token)
      && status.state !== "running"
    ) return status;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { state: "running", token };
}

export function parseWmctrlOutput(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\S+)\s+(\S+)\s+\S+\s+(\S+)\s*(.*)$/);
      if (!match) return null;
      return {
        id: match[1],
        desktop: match[2],
        className: match[3],
        title: match[4],
      };
    })
    .filter(Boolean);
}

export function parseXdotoolGeometry(output) {
  const values = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Z]+)=(-?\d+)$/);
    if (match) values[match[1]] = Number(match[2]);
  }
  if (![values.X, values.Y, values.WIDTH, values.HEIGHT].every(Number.isFinite)) return null;
  if (values.WIDTH <= 0 || values.HEIGHT <= 0) return null;
  return { x: values.X, y: values.Y, width: values.WIDTH, height: values.HEIGHT };
}

async function windowsFromXdotool() {
  const search = await tryRun("xdotool", ["search", "--onlyvisible", "--name", "."]);
  if (search.code !== 0) return [];
  const ids = [...new Set(search.stdout.split(/\s+/).filter(Boolean))].slice(0, 80);
  return Promise.all(ids.map(async (id) => {
    const [title, className] = await Promise.all([
      tryRun("xdotool", ["getwindowname", id]),
      tryRun("xdotool", ["getwindowclassname", id]),
    ]);
    return {
      id,
      desktop: "0",
      className: className.stdout.trim(),
      title: title.stdout.trim(),
    };
  }));
}

async function listWindows() {
  const result = await tryRun("wmctrl", ["-lx"]);
  const windows = result.code === 0 ? parseWmctrlOutput(result.stdout) : await windowsFromXdotool();
  if (!windows.length && result.code !== 0) {
    throw new Error("未检测到可操作窗口。请确认当前是 X11 会话，并安装 xdotool（推荐同时安装 wmctrl、python3-pyatspi）。");
  }
  return windows.filter((window) => window.title || window.className);
}

function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

export function findBestWindow(windows, query) {
  const needle = normalized(query);
  if (!needle) return windows[0] || null;
  return [...windows]
    .map((window) => {
      const className = normalized(window.className);
      const title = normalized(window.title);
      let score = 0;
      if (className === needle || title === needle) score = 100;
      else if (className.split(".").includes(needle)) score = 80;
      else if (className.includes(needle)) score = 60;
      else if (title.includes(needle)) score = 40;
      return { window, score };
    })
    .sort((left, right) => right.score - left.score)
    .find((item) => item.score > 0)?.window || null;
}

function windowMatchScore(window, query) {
  const needle = normalized(query);
  if (!needle) return 1;
  const className = normalized(window.className);
  const title = normalized(window.title);
  if (className === needle || title === needle) return 100;
  if (className.split(".").includes(needle)) return 80;
  if (className.includes(needle)) return 60;
  if (title.includes(needle)) return 40;
  return 0;
}

export function selectWindow(windows, query, windowId = "", windowTitle = "") {
  const requestedId = String(windowId || "").trim().toLocaleLowerCase();
  if (requestedId) {
    const exact = windows.find((window) => normalized(window.id) === requestedId);
    if (exact) {
      if (windowMatchScore(exact, query) <= 0) {
        throw new Error(`窗口编号“${windowId}”当前不属于“${query}”，已停止操作。请重新读取应用状态。`);
      }
      const expectedTitle = normalized(windowTitle);
      if (expectedTitle && normalized(exact.title) !== expectedTitle) {
        throw new Error(`窗口编号“${windowId}”的标题已经变化，已停止操作以避免改错文档。请重新读取应用状态。`);
      }
      return exact;
    }
    throw new Error(`没有找到窗口编号“${windowId}”。请重新读取应用状态。`);
  }
  const scored = [...windows]
    .map((window) => ({ window, score: windowMatchScore(window, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  if (!scored.length) return null;
  const best = scored.filter((item) => item.score === scored[0].score);
  if (best.length > 1) {
    const choices = best
      .map(({ window }) => `${window.id}：${window.title || window.className || "无标题窗口"}`)
      .join("\n");
    throw new Error(`“${query}”匹配到多个窗口，请使用 window_id 明确选择：\n${choices}`);
  }
  return best[0].window;
}

function shellWords(command) {
  const words = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const character of String(command || "")) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) words.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current) words.push(current);
  return words;
}

async function desktopEntries() {
  const directories = [
    path.join(os.homedir(), ".local", "share", "applications"),
    "/usr/local/share/applications",
    "/usr/share/applications",
  ];
  const entries = [];
  for (const directory of directories) {
    let names = [];
    try {
      names = await fs.readdir(directory);
    } catch {
      continue;
    }
    for (const name of names.filter((item) => item.endsWith(".desktop"))) {
      try {
        const content = await fs.readFile(path.join(directory, name), "utf8");
        if (/\nNoDisplay\s*=\s*true/i.test(`\n${content}`)) continue;
        const namesInFile = [...content.matchAll(/^Name(?:\[[^\]]+\])?=(.+)$/gm)].map((match) => match[1].trim());
        const exec = content.match(/^Exec=(.+)$/m)?.[1]?.trim() || "";
        const startupClass = content.match(/^StartupWMClass=(.+)$/m)?.[1]?.trim() || "";
        entries.push({ id: name.slice(0, -8), path: path.join(directory, name), names: namesInFile, exec, startupClass });
      } catch {
        // 单个损坏的 desktop 文件不影响其他应用
      }
    }
  }
  return entries;
}

async function launchApp(query) {
  const needle = normalized(query);
  const entries = await desktopEntries();
  const entry = entries
    .map((item) => {
      const candidates = [item.id, item.startupClass, ...item.names].map(normalized).filter(Boolean);
      const exact = candidates.some((candidate) => candidate === needle);
      const contains = candidates.some((candidate) => candidate.includes(needle) || needle.includes(candidate));
      return { item, score: exact ? 100 : contains ? 50 : 0 };
    })
    .sort((left, right) => right.score - left.score)
    .find((item) => item.score > 0)?.item;

  if (entry) {
    const launched = await tryRun("gtk-launch", [entry.id], { timeoutMs: 8_000 });
    if (launched.code === 0) return;
    const viaGio = await tryRun("gio", ["launch", entry.path], { timeoutMs: 8_000 });
    if (viaGio.code === 0) return;
    const words = shellWords(entry.exec).filter((word) => !/^%[a-zA-Z]$/.test(word));
    if (words.length) {
      await run(words[0], words.slice(1), { detached: true });
      return;
    }
  }
  throw new Error(`系统应用菜单中没有找到“${query}”。请使用应用菜单中显示的正式名称。`);
}

async function runningWindow(app, windowId = "", windowTitle = "", requireStableIdentity = false) {
  if (requireStableIdentity && (!String(windowId || "").trim() || !String(windowTitle || "").trim())) {
    throw new Error("操作前必须重新读取应用状态，并携带返回的 window_id 和 window_title。");
  }
  const window = selectWindow(await listWindows(), app, windowId, windowTitle);
  if (window) return window;
  throw new Error(`应用“${app}”尚未运行。请先使用 launch_app 启动它。`);
}

async function launchAndFindWindow(app) {
  const existing = selectWindow(await listWindows(), app);
  if (existing) return existing;
  await launchApp(app);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const window = selectWindow(await listWindows(), app);
    if (window) return window;
  }
  throw new Error(`应用“${app}”已经尝试启动，但没有发现可操作窗口。`);
}

async function accessibility(payload) {
  const result = await tryRun("python3", [accessibilityHelper], {
    input: JSON.stringify(payload),
    timeoutMs: 15_000,
  });
  const output = result.stdout.trim();
  if (!output) {
    return { ok: false, error: result.stderr.trim() || "系统无障碍接口没有返回内容" };
  }
  try {
    return JSON.parse(output);
  } catch {
    return { ok: false, error: output.slice(0, 1000) };
  }
}

async function captureWindow(window) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-screen-"));
  const file = path.join(directory, "screen.png");
  try {
    // 只截取目标窗口。若系统缺少 ImageMagick 或目标窗口不允许抓取，
    // 宁可只返回无障碍文字，也不能退回全屏截图而泄露其他应用内容。
    const result = await tryRun("import", ["-window", window.id, file], { timeoutMs: 8_000 });
    if (result.code === 0) {
      const data = await fs.readFile(file).catch(() => null);
      if (data?.length) return data.toString("base64");
    }
    return "";
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function activateWindow(window) {
  const result = await tryRun("xdotool", ["windowactivate", "--sync", window.id], { timeoutMs: 8_000 });
  if (result.code !== 0) {
    throw new Error("无法激活目标窗口。请确认已安装 xdotool，并且当前使用 X11 桌面会话。");
  }
}

async function windowGeometry(window) {
  const result = await tryRun("xdotool", ["getwindowgeometry", "--shell", window.id], { timeoutMs: 8_000 });
  const geometry = result.code === 0 ? parseXdotoolGeometry(result.stdout) : null;
  if (!geometry) {
    throw new Error("无法读取目标窗口的位置和大小，已停止坐标操作以避免点到其他应用。");
  }
  return geometry;
}

export function absoluteWindowPoint(geometry, rawX, rawY, label) {
  const x = Number(rawX);
  const y = Number(rawY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`${label}需要有效的窗口内 X、Y 坐标。`);
  }
  const roundedX = Math.round(x);
  const roundedY = Math.round(y);
  if (roundedX < 0 || roundedY < 0 || roundedX >= geometry.width || roundedY >= geometry.height) {
    throw new Error(`${label}坐标超出目标窗口范围，已停止操作以避免点到其他应用。`);
  }
  return { x: geometry.x + roundedX, y: geometry.y + roundedY };
}

function buttonNumber(button) {
  return { left: "1", middle: "2", right: "3" }[button] || "1";
}

async function elementAction(args, command, extra = {}) {
  const window = await runningWindow(args.app, args.window_id, args.window_title, true);
  if (command !== "bounds") await activateWindow(window);
  const result = await accessibility({
    command,
    app: args.app,
    hints: [window.className, window.title],
    window_title: window.title,
    element_index: args.element_index,
    ...extra,
  });
  if (!result.ok) throw new Error(result.error || "无障碍控件操作失败");
  return result;
}

async function callTool(name, args) {
  if (name === "check_dependencies") {
    return { text: await dependencyStatusText(await dependencyStatus()) };
  }

  if (name === "prepare_dependency_install") {
    const before = await dependencyStatus();
    if (before.ready) return { text: await dependencyStatusText(before) };
    const requested = assertRequestedPackages(args, before);
    await assertPackageManagerAvailable();
    const plan = await dependencyInstallPlan(requested);
    if (!plan.ok) {
      throw new Error(plan.blocked
        ? "安装计划会删除现有软件，DYWorker 已阻止执行。请联系系统管理员处理。"
        : `无法生成完整安装预览：${plan.summary || "软件源不可用"}`);
    }
    preparedDependencyPlans.set(plan.token, {
      packages: requested,
      summary: plan.summary,
      createdAt: Date.now(),
    });
    return {
      text: [
        "完整安装预览：",
        plan.summary,
        `计划令牌：${plan.token}`,
        "确认无误后调用 install_dependencies，并原样携带 packages、plan_token、plan_summary。",
      ].join("\n"),
    };
  }

  if (name === "install_dependencies") {
    const before = await dependencyStatus();
    if (before.ready) return { text: await dependencyStatusText(before) };
    const requested = assertRequestedPackages(args, before);
    const programs = await assertPackageManagerAvailable();
    const token = String(args.plan_token || "");
    const prepared = preparedDependencyPlans.get(token);
    const planExpired = !prepared || Date.now() - prepared.createdAt > 5 * 60_000;
    if (
      planExpired
      || JSON.stringify(prepared?.packages) !== JSON.stringify(requested)
      || prepared?.summary !== String(args.plan_summary || "")
    ) {
      preparedDependencyPlans.delete(token);
      throw new Error("安装预览无效或已经过期。请重新生成完整安装预览并确认。");
    }
    await launchDependencyInstaller(requested, token, programs);
    preparedDependencyPlans.delete(token);
    const installStatus = await waitForDependencyInstaller(token);
    if (installStatus.state === "plan_changed") {
      preparedDependencyPlans.set(installStatus.token, {
        packages: requested,
        summary: installStatus.planSummary,
        createdAt: Date.now(),
      });
      throw new Error([
        "管理员复核发现安装计划已经变化，DYWorker 没有执行安装。",
        "新的完整安装预览：",
        installStatus.planSummary,
        `计划令牌：${installStatus.token}`,
        "请确认新预览后，原样携带 packages、plan_token、plan_summary 再次调用安装工具。",
      ].join("\n"));
    }
    if (installStatus.state === "failed") {
      throw new Error(`环境安装没有完成：${String(installStatus.detail || "系统后台任务返回失败").slice(0, 1200)}`);
    }
    if (installStatus.state === "running") {
      return { text: "系统后台仍在安装本机操控环境。可以关闭 DYWorker，稍后重新打开并检查安装结果。" };
    }
    const after = await dependencyStatus();
    if (!after.ready) {
      throw new Error(`安装命令已结束，但仍缺少：${after.missing.join("、")}。请联系系统管理员检查软件源。`);
    }
    return { text: "麒麟/Linux 本机操控环境安装完成，可以开始操作办公软件。" };
  }

  if (name === "list_apps") {
    const windows = await listWindows();
    const seen = new Set();
    const apps = windows
      .filter((window) => {
        const key = `${window.className}\n${window.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((window) => ({
        id: window.className || window.id,
        displayName: window.title || window.className,
        isRunning: true,
      }));
    return { text: JSON.stringify(apps, null, 2) };
  }

  if (name === "launch_app") {
    const window = await launchAndFindWindow(args.app);
    return { text: `应用已启动：${window.title || window.className || args.app}。请调用 get_app_state 读取当前界面。` };
  }

  if (name === "get_app_state") {
    const window = await runningWindow(args.app, args.window_id, args.window_title);
    const [tree, image] = await Promise.all([
      accessibility({ command: "state", app: args.app, hints: [window.className, window.title], window_title: window.title }),
      captureWindow(window),
    ]);
    const fallback = [
      `应用：${args.app}`,
      `窗口：${window.title || "（无标题）"}`,
      `窗口类别：${window.className || "（未知）"}`,
      `窗口编号：${window.id}`,
      "",
      tree.ok
        ? tree.text
        : `未能读取控件结构：${tree.error}\n${
          image
            ? "仍可根据目标窗口截图使用坐标操作。"
            : "也未取得目标窗口截图；请安装 ImageMagick。"
        }建议安装 python3-pyatspi 以获得控件编号。`,
      process.env.XDG_SESSION_TYPE === "wayland"
        ? "\n提示：当前系统报告为 Wayland；麒麟 V10 建议使用 X11 会话，以确保可以操作所有办公应用。"
        : "",
    ].filter(Boolean).join("\n");
    return { text: fallback, image };
  }

  if (name === "click") {
    if (args.element_index) {
      await elementAction(args, "click");
    } else {
      if (!Number.isFinite(args.x) || !Number.isFinite(args.y)) throw new Error("click 需要 element_index，或同时提供 x 和 y");
      const window = await runningWindow(args.app, args.window_id, args.window_title, true);
      const point = absoluteWindowPoint(await windowGeometry(window), args.x, args.y, "点击");
      await activateWindow(window);
      const count = Math.min(3, Math.max(1, Number(args.click_count) || 1));
      const result = await tryRun("xdotool", [
        "mousemove", "--sync", String(point.x), String(point.y),
        "click", "--repeat", String(count), buttonNumber(args.mouse_button),
      ]);
      if (result.code !== 0) throw new Error(result.stderr || "鼠标点击失败");
    }
    return { text: "点击已完成。请重新读取应用状态后再继续。" };
  }

  if (name === "perform_secondary_action") {
    await elementAction(args, "secondary", { action: args.action });
    return { text: `已执行“${args.action}”。请重新读取应用状态后再继续。` };
  }

  if (name === "set_value") {
    await elementAction(args, "set_value", { value: String(args.value ?? "") });
    return { text: "控件内容已设置。请重新读取应用状态后再继续。" };
  }

  if (name === "select_text") {
    await elementAction(args, "select_text", {
      text: String(args.text || ""),
      prefix: String(args.prefix || ""),
      suffix: String(args.suffix || ""),
      selection: String(args.selection || "text"),
    });
    return { text: "文字选择已完成。请重新读取应用状态后再继续。" };
  }

  if (name === "scroll") {
    const bounds = await elementAction(args, "bounds");
    const window = await runningWindow(args.app, args.window_id, args.window_title, true);
    await activateWindow(window);
    const direction = String(args.direction || "down").toLowerCase();
    const button = { up: "4", u: "4", down: "5", d: "5", left: "6", l: "6", right: "7", r: "7" }[direction];
    if (!button) throw new Error("滚动方向必须是 up、down、left 或 right");
    const repeats = Math.min(30, Math.max(1, Math.round((Number(args.pages) || 1) * 3)));
    const result = await tryRun("xdotool", [
      "mousemove", "--sync", String(bounds.x), String(bounds.y),
      "click", "--repeat", String(repeats), button,
    ]);
    if (result.code !== 0) throw new Error(result.stderr || "滚动失败");
    return { text: "滚动已完成。请重新读取应用状态后再继续。" };
  }

  if (name === "drag") {
    const window = await runningWindow(args.app, args.window_id, args.window_title, true);
    const geometry = await windowGeometry(window);
    const from = absoluteWindowPoint(geometry, args.from_x, args.from_y, "拖动起点");
    const to = absoluteWindowPoint(geometry, args.to_x, args.to_y, "拖动终点");
    await activateWindow(window);
    const result = await tryRun("xdotool", [
      "mousemove", "--sync", String(from.x), String(from.y),
      "mousedown", "1",
      "mousemove", "--sync", String(to.x), String(to.y),
      "mouseup", "1",
    ]);
    if (result.code !== 0) throw new Error(result.stderr || "拖动失败");
    return { text: "拖动已完成。请重新读取应用状态后再继续。" };
  }

  if (name === "press_key") {
    const window = await runningWindow(args.app, args.window_id, args.window_title, true);
    await activateWindow(window);
    const result = await tryRun("xdotool", ["key", "--clearmodifiers", String(args.key || "")]);
    if (result.code !== 0) throw new Error(result.stderr || "按键失败");
    return { text: "按键已发送。请重新读取应用状态后再继续。" };
  }

  if (name === "type_text") {
    const window = await runningWindow(args.app, args.window_id, args.window_title, true);
    await activateWindow(window);
    const result = await tryRun("xdotool", ["type", "--clearmodifiers", "--delay", "8", "--", String(args.text || "")], {
      timeoutMs: 30_000,
    });
    if (result.code !== 0) throw new Error(result.stderr || "文字输入失败");
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
    cancelledToolRequests.add(requestId);
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
        serverInfo: { name: "DYWorker Linux Computer Use", version: "1.0.0" },
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
  const protectedTransactionActive = [...activeChildren].some((child) => child.__dyworkerProtectedSystemTransaction);
  for (const child of activeChildren) {
    if (!child.__dyworkerProtectedSystemTransaction) stopChild(child, "SIGTERM");
  }
  if (!protectedTransactionActive) {
    setTimeout(() => {
      for (const child of activeChildren) stopChild(child, "SIGKILL");
      process.exit(0);
    }, 250).unref();
    return;
  }
  setTimeout(() => {
    for (const child of activeChildren) {
      if (!child.__dyworkerProtectedSystemTransaction) stopChild(child, "SIGKILL");
    }
  }, 250).unref();
});

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === "--locked-dependency-install-worker") {
    await runDependencyInstallerWorker(
      process.argv[3],
      process.argv[4],
      process.argv.slice(5),
    );
  } else {
    await startServer();
  }
}
