import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COMPUTER_USE_SERVER_ID = "computer-use";
export const COMPUTER_USE_TOOL_PREFIX = `mcp__${COMPUTER_USE_SERVER_ID}__`;

const COMPUTER_USE_REQUEST_TIMEOUT_MS = 60_000;
export const COMPUTER_USE_INSTALL_TIMEOUT_MS = 16 * 60_000;

function newestPluginRoot(pluginBase, readDirectory) {
  let entries;
  try {
    entries = readDirectory(pluginBase, { withFileTypes: true });
  } catch {
    return "";
  }
  return entries
    .filter((entry) => entry?.isDirectory?.())
    .map((entry) => path.join(pluginBase, entry.name))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    .at(0) || "";
}

export function discoverComputerUseServer({
  platform = process.platform,
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  pluginBase = "",
  runtimeExecutable = process.execPath,
  linuxServerPath = fileURLToPath(new URL("./linux-computer-use-server.mjs", import.meta.url)),
  pathExists = existsSync,
  readDirectory = readdirSync,
} = {}) {
  if (platform === "linux") {
    if (!pathExists(linuxServerPath)) return null;
    return {
      id: COMPUTER_USE_SERVER_ID,
      name: "本机应用操作",
      command: runtimeExecutable,
      args: [linuxServerPath],
      cwd: path.dirname(runtimeExecutable),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NO_AT_BRIDGE: "0" },
      enabled: true,
      builtIn: true,
      requestTimeoutMs: COMPUTER_USE_REQUEST_TIMEOUT_MS,
    };
  }

  if (platform !== "darwin") return null;

  const base = pluginBase || path.join(codexHome, "plugins", "cache", "openai-bundled", "computer-use");
  const pluginRoot = newestPluginRoot(base, readDirectory);
  if (!pluginRoot) return null;

  const launcher = path.join(pluginRoot, "bin", "computer-use-client-launcher");
  const installedClient = path.join(
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
  if (!pathExists(launcher) || !pathExists(installedClient)) return null;

  return {
    id: COMPUTER_USE_SERVER_ID,
    name: "本机应用操作",
    command: launcher,
    args: ["mcp"],
    cwd: pluginRoot,
    env: { ...process.env, CODEX_HOME: codexHome },
    enabled: true,
    builtIn: true,
    requestTimeoutMs: COMPUTER_USE_REQUEST_TIMEOUT_MS,
  };
}

export function isComputerUseTool(name) {
  return String(name || "").startsWith(COMPUTER_USE_TOOL_PREFIX);
}

export function computerUseAction(name) {
  return isComputerUseTool(name) ? String(name).slice(COMPUTER_USE_TOOL_PREFIX.length) : "";
}
