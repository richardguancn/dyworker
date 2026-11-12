import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COMPUTER_USE_SERVER_ID = "computer-use";
export const COMPUTER_USE_TOOL_PREFIX = `mcp__${COMPUTER_USE_SERVER_ID}__`;
export const LINUX_SHARED_DESKTOP_TOOL_PREFIX = "plugin__dyworker_linux_computer_use__";

const COMPUTER_USE_REQUEST_TIMEOUT_MS = 60_000;
export const COMPUTER_USE_INSTALL_TIMEOUT_MS = 16 * 60_000;

export function discoverComputerUseServer({
  platform = process.platform,
  runtimeExecutable = process.execPath,
  macosServerPath = fileURLToPath(new URL("./macos-computer-use-server.mjs", import.meta.url)),
  linuxServerPath = fileURLToPath(new URL("./linux-computer-use-server.mjs", import.meta.url)),
  pathExists = existsSync,
} = {} as any) {
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

  if (platform === "darwin") {
    if (!pathExists(macosServerPath)) return null;
    return {
      id: COMPUTER_USE_SERVER_ID,
      name: "本机应用操作",
      command: runtimeExecutable,
      args: [macosServerPath],
      cwd: path.dirname(runtimeExecutable),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      enabled: true,
      builtIn: true,
      requestTimeoutMs: COMPUTER_USE_REQUEST_TIMEOUT_MS,
      shutdownGraceMs: 5000,
    };
  }

  return null;
}

export function isComputerUseTool(name) {
  return String(name || "").startsWith(COMPUTER_USE_TOOL_PREFIX);
}

export function computerUseAction(name) {
  return isComputerUseTool(name) ? String(name).slice(COMPUTER_USE_TOOL_PREFIX.length) : "";
}

export function isLinuxSharedDesktopTool(name) {
  return String(name || "").startsWith(LINUX_SHARED_DESKTOP_TOOL_PREFIX);
}
