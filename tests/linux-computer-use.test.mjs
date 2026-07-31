import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { McpClient } from "../electron/mcp.mjs";
import {
  absoluteWindowPoint,
  desktopToolDefinitions,
  findBestWindow,
  isTrustedRootFile,
  linuxDependencyInstallCommand,
  linuxDependencyPackages,
  packageManagerLockLauncherScript,
  parseWmctrlOutput,
  parseXdotoolGeometry,
  selectWindow,
  unpackedResourcePath,
} from "../electron/linux-computer-use-server.mjs";

test("解析麒麟 X11 窗口并保留应用名称与标题", () => {
  const windows = parseWmctrlOutput([
    "0x03e00007  0 host-name wps.wps        项目汇报.docx - WPS Office",
    "0x0460000a  0 host-name chromium.Chromium 政务服务 - Chromium",
  ].join("\n"));
  assert.deepEqual(windows, [
    { id: "0x03e00007", desktop: "0", className: "wps.wps", title: "项目汇报.docx - WPS Office" },
    { id: "0x0460000a", desktop: "0", className: "chromium.Chromium", title: "政务服务 - Chromium" },
  ]);
  assert.equal(findBestWindow(windows, "WPS")?.id, "0x03e00007");
  assert.equal(findBestWindow(windows, "chromium")?.id, "0x0460000a");
});

test("同一应用多个窗口时必须绑定明确窗口编号", () => {
  const windows = [
    { id: "0x01", desktop: "0", className: "wps.wps", title: "项目甲.docx - WPS Office" },
    { id: "0x02", desktop: "0", className: "wps.wps", title: "项目乙.docx - WPS Office" },
  ];
  assert.throws(() => selectWindow(windows, "WPS"), /匹配到多个窗口/);
  assert.equal(selectWindow(windows, "WPS", "0x02", "项目乙.docx - WPS Office")?.title, "项目乙.docx - WPS Office");
  assert.equal(selectWindow(windows, "项目甲.docx")?.id, "0x01");
  assert.throws(() => selectWindow(windows, "WPS", "0x99"), /没有找到窗口编号/);
  assert.throws(() => selectWindow(windows, "Firefox", "0x02"), /不属于/);
  assert.throws(() => selectWindow(windows, "WPS", "0x02", "已关闭的文档.docx - WPS Office"), /标题已经变化/);
});

test("Linux 桌面服务提供与 macOS 一致的基础操作", () => {
  const names = desktopToolDefinitions().map((tool) => tool.name);
  assert.deepEqual(names, [
    "check_dependencies",
    "prepare_dependency_install",
    "install_dependencies",
    "list_apps",
    "launch_app",
    "get_app_state",
    "click",
    "perform_secondary_action",
    "set_value",
    "select_text",
    "scroll",
    "drag",
    "press_key",
    "type_text",
  ]);
  assert.equal(desktopToolDefinitions().find((tool) => tool.name === "check_dependencies")?.annotations.readOnlyHint, true);
  assert.equal(desktopToolDefinitions().find((tool) => tool.name === "prepare_dependency_install")?.annotations.readOnlyHint, true);
  assert.equal(desktopToolDefinitions().find((tool) => tool.name === "prepare_dependency_install")?.annotations.openWorldHint, true);
  assert.equal(desktopToolDefinitions().find((tool) => tool.name === "install_dependencies")?.annotations.readOnlyHint, false);
  assert.equal(desktopToolDefinitions().find((tool) => tool.name === "install_dependencies")?.annotations.destructiveHint, true);
  assert.equal(desktopToolDefinitions().find((tool) => tool.name === "install_dependencies")?.annotations.openWorldHint, true);
  assert.equal(desktopToolDefinitions().find((tool) => tool.name === "get_app_state")?.annotations.readOnlyHint, true);
  assert.equal(desktopToolDefinitions().find((tool) => tool.name === "click")?.annotations.readOnlyHint, false);
  for (const name of names.filter((name) => !["check_dependencies", "prepare_dependency_install", "install_dependencies", "list_apps", "launch_app"].includes(name))) {
    assert.ok(desktopToolDefinitions().find((tool) => tool.name === name)?.inputSchema.properties.window_id);
    assert.ok(desktopToolDefinitions().find((tool) => tool.name === name)?.inputSchema.properties.window_title);
  }
  for (const name of names.filter((name) => !["check_dependencies", "prepare_dependency_install", "install_dependencies", "list_apps", "launch_app", "get_app_state"].includes(name))) {
    const required = desktopToolDefinitions().find((tool) => tool.name === name)?.inputSchema.required || [];
    assert.ok(required.includes("window_id") && required.includes("window_title"));
  }
});

test("麒麟环境安装工具使用系统授权安装固定依赖", () => {
  assert.deepEqual(linuxDependencyPackages, [
    "xdotool",
    "wmctrl",
    "python3-pyatspi",
    "imagemagick",
  ]);
  assert.deepEqual(linuxDependencyInstallCommand(["wmctrl"]), {
    program: "/usr/bin/pkexec",
    args: ["/usr/bin/apt-get", "install", "-y", "--no-remove", "wmctrl"],
  });
});

test("麒麟安装由受系统托管的单任务在软件锁内完成", async () => {
  const source = await fs.readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "electron", "linux-computer-use-server.mjs"),
    "utf8",
  );
  assert.match(source, /systemd-run/);
  assert.match(source, /dyworker-dependency-install-\$\{uid\}/);
  assert.match(source, /"\/var\/lib\/dpkg\/lock-frontend"/);
  assert.match(source, /"\/var\/lib\/apt\/lists\/lock"/);
  assert.match(source, /fcntl\.lockf/);
  assert.match(source, /DPKG_FRONTEND_LOCKED: "1"/);
  assert.match(source, /"Debug::NoLocking=1"/);
  assert.match(source, /"apt-get": "\/usr\/bin\/apt-get"/);
  assert.match(source, /pkexec: "\/usr\/bin\/pkexec"/);
  assert.match(source, /return "\/run\/dyworker"/);
  assert.match(source, /state: "plan_changed"/);
});

test("管理员任务拒绝普通用户拥有的同名程序", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-untrusted-system-tool-"));
  const fakeApt = path.join(root, "apt-get");
  await fs.writeFile(fakeApt, "#!/bin/sh\nexit 0");
  await fs.chmod(fakeApt, 0o555);
  assert.equal(await isTrustedRootFile(fakeApt), false);
  await fs.rm(root, { recursive: true, force: true });
});

test("系统原生软件锁在后台 worker 运行期间持续生效", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-package-lock-"));
  const lockFile = path.join(root, "dpkg-lock");
  const ready = path.join(root, "ready");
  await fs.writeFile(lockFile, "");
  const locker = spawn("/usr/bin/python3", [
    "-c",
    packageManagerLockLauncherScript,
    lockFile,
    "/bin/sh",
    "-c",
    `printf ready > "${ready}"; sleep 2`,
  ], { stdio: "ignore" });
  t.after(async () => {
    if (locker.exitCode == null && locker.signalCode == null) locker.kill("SIGKILL");
    await fs.rm(root, { recursive: true, force: true });
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await fs.access(ready).then(() => true).catch(() => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await fs.access(ready);
  const contender = spawn("/usr/bin/python3", [
    "-c",
    [
      "import fcntl, os, sys",
      "fd = os.open(sys.argv[1], os.O_RDWR)",
      "try:",
      "    fcntl.lockf(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)",
      "    sys.exit(0)",
      "except OSError:",
      "    sys.exit(23)",
    ].join("\n"),
    lockFile,
  ], { stdio: "ignore" });
  const contenderCode = await new Promise((resolve) => contender.once("exit", resolve));
  assert.equal(contenderCode, 23);
  if (locker.exitCode == null && locker.signalCode == null) {
    await new Promise((resolve) => locker.once("exit", resolve));
  }
});

test("Linux 只截取目标应用窗口，不会退回上传整个桌面", async () => {
  const source = await fs.readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "electron", "linux-computer-use-server.mjs"),
    "utf8",
  );
  assert.match(source, /import", \["-window", window\.id, file\]/);
  assert.doesNotMatch(source, /\["-window", "root", file\]/);
  assert.doesNotMatch(source, /gnome-screenshot", \["-f", file\]/);
});

test("Linux 截图坐标换算为目标窗口坐标并阻止越界点击", () => {
  const geometry = parseXdotoolGeometry("WINDOW=123\nX=120\nY=80\nWIDTH=900\nHEIGHT=600\n");
  assert.deepEqual(geometry, { x: 120, y: 80, width: 900, height: 600 });
  assert.deepEqual(absoluteWindowPoint(geometry, 25, 30, "点击"), { x: 145, y: 110 });
  assert.throws(() => absoluteWindowPoint(geometry, 900, 30, "点击"), /超出目标窗口范围/);
  assert.throws(() => absoluteWindowPoint(geometry, -1, 30, "点击"), /超出目标窗口范围/);
});

test("打包后 Python 无障碍助手从实际解包目录读取", () => {
  assert.equal(
    unpackedResourcePath("/opt/DYWorker/resources/app.asar/electron/scripts/linux_computer_use.py"),
    "/opt/DYWorker/resources/app.asar.unpacked/electron/scripts/linux_computer_use.py",
  );
  assert.equal(
    unpackedResourcePath("/workspace/electron/scripts/linux_computer_use.py"),
    "/workspace/electron/scripts/linux_computer_use.py",
  );
});

test("Linux 无障碍树只读取已绑定的具体窗口", async () => {
  const helper = await fs.readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "electron", "scripts", "linux_computer_use.py"),
    "utf8",
  );
  assert.match(helper, /window_root = find_window_root\(application, payload\.get\("window_title"\)\)/);
  assert.match(helper, /describe\(window_root\)/);
  assert.match(helper, /element_at\(window_root,/);
  assert.doesNotMatch(helper, /describe\(application\)/);
  assert.doesNotMatch(helper, /element_at\(application,/);
});

test("Linux 桌面服务可通过 DYWorker 的基础工具通道完成握手", async () => {
  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "electron", "linux-computer-use-server.mjs");
  const client = new McpClient({ command: process.execPath, args: [server] });
  await client.connect();
  assert.equal(client.serverInfo?.name, "DYWorker Linux Computer Use");
  assert.deepEqual(client.tools.map((tool) => tool.name), desktopToolDefinitions().map((tool) => tool.name));
  const dependencies = await client.callTool("check_dependencies", {});
  assert.equal(dependencies.isError, false);
  assert.match(dependencies.text, /本机操控环境/);
  await client.close();
});

test("Linux 桌面服务把麒麟窗口转换为模型可读的应用列表", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-linux-cua-"));
  const wmctrl = path.join(root, "wmctrl");
  await fs.writeFile(wmctrl, [
    "#!/bin/sh",
    "printf '%s\\n' '0x03e00007  0 host-name wps.wps 项目汇报.docx - WPS Office'",
  ].join("\n"));
  await fs.chmod(wmctrl, 0o755);
  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "electron", "linux-computer-use-server.mjs");
  const client = new McpClient({
    command: process.execPath,
    args: [server],
    env: { ...process.env, PATH: `${root}:${process.env.PATH || ""}` },
  });
  await client.connect();
  const result = await client.callTool("list_apps", {});
  assert.equal(result.isError, false);
  assert.match(result.text, /wps\.wps/);
  assert.match(result.text, /项目汇报\.docx - WPS Office/);
  await client.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("Linux 安装工具获得系统授权后执行固定安装并重新检查", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-linux-install-"));
  const marker = path.join(root, "installed");
  const log = path.join(root, "install.log");
  const authorizationLog = path.join(root, "authorization.log");
  const scripts = {
    which: [
      "#!/bin/sh",
      "case \"$1\" in",
      "  apt-get|pkexec|systemd-run|flock|xdotool) exit 0 ;;",
      "  wmctrl|import) [ -f \"$DYWORKER_DEP_MARKER\" ] && exit 0 || exit 1 ;;",
      "  *) exit 1 ;;",
      "esac",
    ].join("\n"),
    python3: [
      "#!/bin/sh",
      "[ -f \"$DYWORKER_DEP_MARKER\" ] && exit 0 || exit 1",
    ].join("\n"),
    pkexec: [
      "#!/bin/sh",
      "printf '%s\\n' \"$*\" > \"$DYWORKER_AUTHORIZATION_LOG\"",
      "while [ \"$1\" != \"--locked-dependency-install-worker\" ] && [ \"$#\" -gt 0 ]; do shift; done",
      "\"$DYWORKER_NODE\" \"$DYWORKER_SERVER\" \"$@\" >/dev/null 2>&1 &",
      "exit 0",
    ].join("\n"),
    "apt-get": [
      "#!/bin/sh",
      "case \" $* \" in",
      "  *\" -s \"*) printf '%s\\n' 'Inst wmctrl' 'Inst python3-pyatspi' 'Inst imagemagick' ;;",
      "  *) printf '%s\\n' \"$DPKG_FRONTEND_LOCKED $*\" > \"$DYWORKER_DEP_LOG\"; touch \"$DYWORKER_DEP_MARKER\" ;;",
      "esac",
    ].join("\n"),
  };
  for (const [name, source] of Object.entries(scripts)) {
    const file = path.join(root, name);
    await fs.writeFile(file, source);
    await fs.chmod(file, 0o755);
  }
  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "electron", "linux-computer-use-server.mjs");
  const client = new McpClient({
    command: process.execPath,
    args: [server],
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH || ""}`,
      DYWORKER_DEP_MARKER: marker,
      DYWORKER_DEP_LOG: log,
      DYWORKER_AUTHORIZATION_LOG: authorizationLog,
      DYWORKER_NODE: process.execPath,
      DYWORKER_SERVER: server,
      DYWORKER_TEST_DEPENDENCY_STATUS_DIR: root,
    },
  });
  t.after(async () => {
    await client.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await client.connect();
  const prepared = await client.callTool("prepare_dependency_install", {
    packages: ["wmctrl", "python3-pyatspi", "imagemagick"],
  });
  assert.equal(prepared.isError, false);
  const planToken = prepared.text.match(/计划令牌：([a-f0-9]{64})/)?.[1];
  const planSummary = prepared.text.match(/完整安装预览：\n([\s\S]*?)\n计划令牌：/)?.[1];
  assert.ok(planToken);
  assert.ok(planSummary);
  await assert.rejects(() => fs.access(authorizationLog));
  const result = await client.callTool("install_dependencies", {
    packages: ["wmctrl", "python3-pyatspi", "imagemagick"],
    plan_token: planToken,
    plan_summary: planSummary,
  });
  assert.equal(result.isError, false);
  assert.match(result.text, /环境安装完成/);
  assert.equal(
    (await fs.readFile(log, "utf8")).trim(),
    "1 -o Debug::NoLocking=1 install -y --no-remove imagemagick python3-pyatspi wmctrl",
  );
  const authorization = await fs.readFile(authorizationLog, "utf8");
  assert.match(authorization, /systemd-run/);
  assert.match(authorization, /--unit=dyworker-dependency-install-/);
  assert.match(authorization, /python3 -c/);
  assert.match(authorization, /\/var\/lib\/dpkg\/lock-frontend/);
});

test("关闭聊天后系统后台安装继续，重新连接可以检查结果", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-linux-install-resume-"));
  const marker = path.join(root, "installed");
  const scripts = {
    which: [
      "#!/bin/sh",
      "case \"$1\" in",
      "  apt-get|pkexec|systemd-run|flock|xdotool) exit 0 ;;",
      "  wmctrl|import) [ -f \"$DYWORKER_DEP_MARKER\" ] && exit 0 || exit 1 ;;",
      "  *) exit 1 ;;",
      "esac",
    ].join("\n"),
    python3: "#!/bin/sh\n[ -f \"$DYWORKER_DEP_MARKER\" ] && exit 0 || exit 1",
    pkexec: [
      "#!/bin/sh",
      "while [ \"$1\" != \"--locked-dependency-install-worker\" ] && [ \"$#\" -gt 0 ]; do shift; done",
      "\"$DYWORKER_NODE\" \"$DYWORKER_SERVER\" \"$@\" >/dev/null 2>&1 &",
      "exit 0",
    ].join("\n"),
    "apt-get": [
      "#!/bin/sh",
      "case \" $* \" in",
      "  *\" -s \"*) printf '%s\\n' 'Inst wmctrl' 'Inst python3-pyatspi' 'Inst imagemagick' ;;",
      "  *) sleep 2; touch \"$DYWORKER_DEP_MARKER\" ;;",
      "esac",
    ].join("\n"),
  };
  for (const [name, source] of Object.entries(scripts)) {
    const file = path.join(root, name);
    await fs.writeFile(file, source);
    await fs.chmod(file, 0o755);
  }
  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "electron", "linux-computer-use-server.mjs");
  const env = {
    ...process.env,
    PATH: `${root}:${process.env.PATH || ""}`,
    DYWORKER_DEP_MARKER: marker,
    DYWORKER_NODE: process.execPath,
    DYWORKER_SERVER: server,
    DYWORKER_TEST_DEPENDENCY_STATUS_DIR: root,
  };
  const client = new McpClient({ command: process.execPath, args: [server], env });
  const resumedClient = new McpClient({ command: process.execPath, args: [server], env });
  t.after(async () => {
    await Promise.allSettled([client.close(), resumedClient.close()]);
    await fs.rm(root, { recursive: true, force: true });
  });
  await client.connect();
  const prepared = await client.callTool("prepare_dependency_install", {
    packages: ["wmctrl", "python3-pyatspi", "imagemagick"],
  });
  const planToken = prepared.text.match(/计划令牌：([a-f0-9]{64})/)?.[1];
  const planSummary = prepared.text.match(/完整安装预览：\n([\s\S]*?)\n计划令牌：/)?.[1];
  const installing = client.callTool("install_dependencies", {
    packages: ["wmctrl", "python3-pyatspi", "imagemagick"],
    plan_token: planToken,
    plan_summary: planSummary,
  }).catch((error) => error);
  const statusFile = path.join(root, `dependency-install-${process.getuid()}.json`);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await fs.readFile(statusFile, "utf8").then(JSON.parse).catch(() => null);
    if (status?.state === "running") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(JSON.parse(await fs.readFile(statusFile, "utf8")).state, "running");
  await client.close();
  assert.ok(await installing instanceof Error);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await fs.access(marker).then(() => true).catch(() => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await fs.access(marker);
  assert.equal(JSON.parse(await fs.readFile(statusFile, "utf8")).state, "completed");
  await resumedClient.connect();
  const checked = await resumedClient.callTool("check_dependencies", {});
  assert.match(checked.text, /环境已准备完成/);
});

test("管理员级安装计划发生变化时停止安装", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-linux-plan-change-"));
  const counter = path.join(root, "plan-count");
  const installed = path.join(root, "installed");
  const scripts = {
    which: [
      "#!/bin/sh",
      "case \"$1\" in",
      "  apt-get|pkexec|systemd-run|flock|xdotool|import) exit 0 ;;",
      "  wmctrl) exit 1 ;;",
      "  *) exit 1 ;;",
      "esac",
    ].join("\n"),
    python3: "#!/bin/sh\nexit 0",
    pkexec: [
      "#!/bin/sh",
      "while [ \"$1\" != \"--locked-dependency-install-worker\" ] && [ \"$#\" -gt 0 ]; do shift; done",
      "\"$DYWORKER_NODE\" \"$DYWORKER_SERVER\" \"$@\" >/dev/null 2>&1 &",
      "exit 0",
    ].join("\n"),
    "apt-get": [
      "#!/bin/sh",
      "case \" $* \" in",
      "  *\" -s \"*)",
      "    count=0",
      "    [ -f \"$DYWORKER_PLAN_COUNTER\" ] && count=$(sed -n '1p' \"$DYWORKER_PLAN_COUNTER\")",
      "    count=$((count + 1))",
      "    printf '%s\\n' \"$count\" > \"$DYWORKER_PLAN_COUNTER\"",
      "    if [ \"$count\" -eq 1 ]; then printf '%s\\n' 'Inst wmctrl (1.0 stable)'; else printf '%s\\n' 'Inst wmctrl (1.1 changed)'; fi",
      "    ;;",
      "  *) touch \"$DYWORKER_INSTALL_MARKER\" ;;",
      "esac",
    ].join("\n"),
  };
  for (const [name, source] of Object.entries(scripts)) {
    const file = path.join(root, name);
    await fs.writeFile(file, source);
    await fs.chmod(file, 0o755);
  }
  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "electron", "linux-computer-use-server.mjs");
  const client = new McpClient({
    command: process.execPath,
    args: [server],
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH || ""}`,
      DYWORKER_PLAN_COUNTER: counter,
      DYWORKER_INSTALL_MARKER: installed,
      DYWORKER_NODE: process.execPath,
      DYWORKER_SERVER: server,
      DYWORKER_TEST_DEPENDENCY_STATUS_DIR: root,
    },
  });
  t.after(async () => {
    await client.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await client.connect();
  const prepared = await client.callTool("prepare_dependency_install", { packages: ["wmctrl"] });
  const planToken = prepared.text.match(/计划令牌：([a-f0-9]{64})/)?.[1];
  const planSummary = prepared.text.match(/完整安装预览：\n([\s\S]*?)\n计划令牌：/)?.[1];
  const result = await client.callTool("install_dependencies", {
    packages: ["wmctrl"],
    plan_token: planToken,
    plan_summary: planSummary,
  });
  assert.equal(result.isError, true);
  assert.match(result.text, /计划已经变化/);
  await assert.rejects(() => fs.access(installed));
});
