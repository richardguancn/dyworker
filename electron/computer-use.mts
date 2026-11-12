import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COMPUTER_USE_SERVER_ID = "computer-use";
export const COMPUTER_USE_TOOL_PREFIX = `mcp__${COMPUTER_USE_SERVER_ID}__`;

export function discoverComputerUseServer({
  platform = process.platform,
  arch = process.arch,
  resourcesPath = "",
  developmentPath = fileURLToPath(new URL(import.meta.url.endsWith(".mts")
    ? "../node_modules/open-computer-use/dist/" : "../../node_modules/open-computer-use/dist/", import.meta.url)),
  pathExists = existsSync,
  hostEnv = process.env,
} = {}) {
  if (arch !== "arm64" && arch !== "x64") return null;
  const nativeArch = arch === "x64" ? "amd64" : arch;
  const relative = {
    darwin: ["Open Computer Use.app", "Contents", "MacOS", "OpenComputerUse"],
    linux: ["linux", nativeArch, "open-computer-use"],
    win32: ["windows", nativeArch, "open-computer-use.exe"],
  }[platform];
  if (!relative) return null;
  const root = resourcesPath ? path.join(resourcesPath, "computer-use") : developmentPath;
  const command = path.join(root, ...relative);
  if (!pathExists(command)) return null;

  // The signed Mac executable can run directly inside its bundle. Each task owns
  // the process and does not enlist the optional system lock-screen service.
  const env = Object.fromEntries(Object.entries(hostEnv).filter(([key]) =>
    !key.toUpperCase().startsWith("OPEN_COMPUTER_USE_")));
  Object.assign(env, {
    OPEN_COMPUTER_USE_DISABLE_APP_AGENT_PROXY: "1",
    OPEN_COMPUTER_USE_ACTION_READ_BACK: "0",
    OPEN_COMPUTER_USE_VIRTUAL_DISPLAY_ENABLED: "0",
    OPEN_COMPUTER_USE_VISUAL_CURSOR: "0",
    OPEN_COMPUTER_USE_ALLOW_GLOBAL_POINTER_FALLBACKS: "0",
  });
  return {
    id: COMPUTER_USE_SERVER_ID, platform, command, cwd: path.dirname(command), args: ["mcp"], env,
    requestTimeoutMs: 35_000, shutdownGraceMs: 1500,
    isolateProcessTree: true,
  };
}

export function isComputerUseTool(name) {
  return String(name || "").startsWith(COMPUTER_USE_TOOL_PREFIX);
}

export function computerUseAction(name) {
  return isComputerUseTool(name) ? String(name).slice(COMPUTER_USE_TOOL_PREFIX.length) : "";
}

// Protect historical rules for the removed built-in plugin as well.
export function isLinuxSharedDesktopTool(name) {
  return String(name || "").startsWith("plugin__dyworker_linux_computer_use__");
}
