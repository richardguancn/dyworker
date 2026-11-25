import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function executableExists(path) {
  try {
    accessSync(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return statSync(path).isFile();
  } catch { return false; }
}

function unavailable(code, message) {
  return Object.assign(new Error(message), { code });
}

function resolveModule({ playwrightModule, env, nodeExecutable }) {
  const supplied = playwrightModule ?? env.EVAL_LAB_PLAYWRIGHT_MODULE ?? env.PLAYWRIGHT_MODULE;
  if (supplied) return resolve(supplied);
  const anchors = [
    env.RUNTIME_NODE_MODULES && join(resolve(env.RUNTIME_NODE_MODULES), "../package.json"),
    join(dirname(nodeExecutable), "../package.json"),
    import.meta.url,
  ].filter(Boolean);
  for (const anchor of anchors) {
    const require = createRequire(anchor);
    for (const name of ["playwright", "playwright-core"]) {
      try { return require.resolve(name); } catch (error) {
        if (error.code !== "MODULE_NOT_FOUND") throw error;
      }
    }
  }
  throw unavailable("DATA_PLAYWRIGHT_UNAVAILABLE",
    "No supplied Playwright runtime was found. Resolve the host's workspace dependencies once, then run with its Node executable or pass --playwright-module /absolute/playwright/index.mjs. No dependency installation is required.");
}

// Search only Playwright's known caches for the revision required by this module.
// Never select an arbitrary browser version or a user's interactive browser.
export function resolveBrowserExecutable({ chromium, modulePath, browserExecutable, env = process.env,
  home = homedir(), platform = process.platform, arch = process.arch, exists = executableExists }) {
  const supplied = browserExecutable ?? env.EVAL_LAB_BROWSER_EXECUTABLE ?? env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ?? env.CHROMIUM_EXECUTABLE_PATH ?? env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (supplied) {
    const path = resolve(supplied);
    if (exists(path)) return path;
    throw unavailable("DATA_BROWSER_UNAVAILABLE", `The supplied browser is not executable: ${path}. Pass a working host browser with --browser-executable; do not search unrelated installations.`);
  }
  const defaultPath = chromium.executablePath();
  if (exists(defaultPath)) return defaultPath;
  const require = createRequire(modulePath);
  const coreRoot = dirname(require.resolve("playwright-core/package.json"));
  const descriptors = JSON.parse(readFileSync(join(coreRoot, "browsers.json"), "utf8")).browsers;
  const shell = descriptors.find(browser => browser.name === "chromium-headless-shell");
  if (!shell || !/^\d+$/.test(String(shell.revision)))
    throw unavailable("DATA_BROWSER_UNAVAILABLE", "The supplied Playwright runtime does not declare a Chromium headless-shell revision. Pass --browser-executable explicitly.");
  const configuredRoot = env.PLAYWRIGHT_BROWSERS_PATH;
  const roots = configuredRoot ? [configuredRoot === "0" ? join(coreRoot, ".local-browsers") : resolve(configuredRoot)]
    : platform === "darwin" ? [join(home, "Library/Caches/ms-playwright"), join(home, ".cache/ms-playwright")]
    : platform === "win32" ? [join(env.LOCALAPPDATA || join(home, "AppData/Local"), "ms-playwright")]
    : [join(env.XDG_CACHE_HOME || join(home, ".cache"), "ms-playwright")];
  const suffixes = platform === "darwin"
    ? [`chrome-headless-shell-mac-${arch === "arm64" ? "arm64" : "x64"}/chrome-headless-shell`, "chrome-headless-shell-mac/chrome-headless-shell"]
    : platform === "win32" ? ["chrome-headless-shell-win64/chrome-headless-shell.exe", "chrome-headless-shell-win/chrome-headless-shell.exe"]
    : ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-headless-shell-linux/chrome-headless-shell"];
  for (const root of roots) for (const suffix of suffixes) {
    const path = join(root, `chromium_headless_shell-${shell.revision}`, suffix);
    if (exists(path)) return path;
  }
  throw unavailable("DATA_BROWSER_UNAVAILABLE",
    `Chromium revision ${shell.revision} is unavailable in the supplied runtime's caches. Pass the host's --browser-executable, or use the supported in-app browser for manual verification. The report has not been visually verified.`);
}

export async function resolveBrowserRuntime({ playwrightModule, browserExecutable, env = process.env,
  nodeExecutable = process.execPath, ...options } = {}) {
  const modulePath = resolveModule({ playwrightModule, env, nodeExecutable });
  let loaded;
  try { loaded = await import(pathToFileURL(modulePath).href); }
  catch (error) {
    throw unavailable("DATA_PLAYWRIGHT_UNAVAILABLE", `Cannot load the supplied Playwright runtime at ${modulePath}: ${error.message}`);
  }
  const chromium = loaded.chromium ?? loaded.default?.chromium;
  if (!chromium) throw unavailable("DATA_PLAYWRIGHT_UNAVAILABLE", "The supplied browser module must provide Playwright Chromium.");
  const executable = resolveBrowserExecutable({ chromium, modulePath, browserExecutable, env, ...options });
  return { chromium, playwrightModule: modulePath, browserExecutable: executable };
}
