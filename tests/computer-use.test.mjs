import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  COMPUTER_USE_INSTALL_TIMEOUT_MS,
  COMPUTER_USE_SERVER_ID,
  computerUseAction,
  discoverComputerUseServer,
  isComputerUseTool,
} from "../electron/computer-use.mjs";

test("Linux 环境安装等待后台任务返回，同时保留可恢复退出路径", () => {
  assert.equal(COMPUTER_USE_INSTALL_TIMEOUT_MS, 16 * 60_000);
});

test("macOS 自动发现最新的 Codex Computer Use 并作为内置能力启动", async () => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-computer-use-"));
  const pluginBase = path.join(codexHome, "plugins", "cache", "openai-bundled", "computer-use");
  const older = path.join(pluginBase, "1.0.9");
  const newer = path.join(pluginBase, "1.0.10");
  const client = path.join(
    codexHome,
    "computer-use",
    "Codex Computer Use.app",
    "Contents",
    "SharedSupport",
    "SkyComputerUseClient.app",
    "Contents",
    "MacOS",
    "SkyComputerUseClient",
  );
  await fs.mkdir(path.join(older, "bin"), { recursive: true });
  await fs.mkdir(path.join(newer, "bin"), { recursive: true });
  await fs.mkdir(path.dirname(client), { recursive: true });
  await fs.writeFile(path.join(older, "bin", "computer-use-client-launcher"), "");
  await fs.writeFile(path.join(newer, "bin", "computer-use-client-launcher"), "");
  await fs.writeFile(client, "");

  const server = discoverComputerUseServer({ platform: "darwin", codexHome, pluginBase });
  assert.equal(server?.id, COMPUTER_USE_SERVER_ID);
  assert.equal(server?.builtIn, true);
  assert.equal(server?.cwd, newer);
  assert.equal(server?.command, path.join(newer, "bin", "computer-use-client-launcher"));
  assert.deepEqual(server?.args, ["mcp"]);
  assert.equal(server?.env.CODEX_HOME, codexHome);
  assert.equal(server?.requestTimeoutMs, 60_000);

  await fs.rm(codexHome, { recursive: true, force: true });
});

test("macOS 客户端不存在或不支持的平台不加载 Computer Use", async () => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-computer-use-missing-"));
  const pluginBase = path.join(codexHome, "plugins", "cache", "openai-bundled", "computer-use");
  await fs.mkdir(path.join(pluginBase, "1.0.1", "bin"), { recursive: true });
  await fs.writeFile(path.join(pluginBase, "1.0.1", "bin", "computer-use-client-launcher"), "");

  assert.equal(discoverComputerUseServer({ platform: "darwin", codexHome, pluginBase }), null);
  assert.equal(discoverComputerUseServer({ platform: "win32", codexHome, pluginBase }), null);

  await fs.rm(codexHome, { recursive: true, force: true });
});

test("Linux 和麒麟 V10 自动使用随应用提供的桌面操控服务", () => {
  const serverPath = "/opt/dyworker/resources/app.asar/electron/linux-computer-use-server.mjs";
  const server = discoverComputerUseServer({
    platform: "linux",
    runtimeExecutable: "/opt/DYWorker/dyworker",
    linuxServerPath: serverPath,
    pathExists: (target) => target === serverPath,
  });
  assert.equal(server?.id, COMPUTER_USE_SERVER_ID);
  assert.equal(server?.builtIn, true);
  assert.equal(server?.command, "/opt/DYWorker/dyworker");
  assert.deepEqual(server?.args, [serverPath]);
  assert.equal(server?.cwd, "/opt/DYWorker");
  assert.equal(server?.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(server?.env.NO_AT_BRIDGE, "0");
});

test("Computer Use 工具名可以稳定识别和提取动作", () => {
  assert.equal(isComputerUseTool("mcp__computer-use__get_app_state"), true);
  assert.equal(computerUseAction("mcp__computer-use__get_app_state"), "get_app_state");
  assert.equal(isComputerUseTool("mcp__other__get_app_state"), false);
  assert.equal(computerUseAction("mcp__other__get_app_state"), "");
});
