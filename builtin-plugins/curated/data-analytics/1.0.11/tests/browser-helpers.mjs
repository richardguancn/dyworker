import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export function forceLocalDataAppMount(html) {
  const mount = "runtime.mount({reviewedSnapshot, createContent:";
  assert.ok(html.includes(mount), "The browser fixture must match the generated local mount call");
  return html.replace(mount, "runtime.mount({reviewedSnapshot, hosted: false, createContent:");
}

// Every fixture is a customer app, not a symlink into the maintainer's npm
// installation. Keep this boundary in one place so all browser regressions
// exercise the shipped, Node-only build by default.
export function runDataAppFixtureBuild(projectRoot, { pluginRoot, env = process.env } = {}) {
  assert.ok(pluginRoot, "A browser fixture must identify the plugin whose runtime it is testing");
  const dependencies = join(projectRoot, "node_modules");
  const assertNoDependencies = () =>
    assert.equal(
      lstatSync(dependencies, { throwIfNoEntry: false }),
      undefined,
      "A prebuilt browser fixture must not create or borrow node_modules",
    );
  assertNoDependencies();
  const commands = mkdtempSync(join(tmpdir(), "data-browser-no-npm-"));
  const attempts = join(commands, "package-manager-attempts");
  try {
    for (const command of ["npm", "npx", "pnpm", "yarn", "corepack", "bun"]) {
      writeFileSync(
        join(commands, command),
        '#!/bin/sh\nprintf "package manager invoked\\n" >> "$DATA_APP_BROWSER_PACKAGE_MANAGER_LOG"\nexit 86\n',
        { mode: 0o755 },
      );
      writeFileSync(
        join(commands, `${command}.cmd`),
        '@echo off\r\necho package manager invoked>>"%DATA_APP_BROWSER_PACKAGE_MANAGER_LOG%"\r\nexit /b 86\r\n',
      );
    }
    const result = spawnSync(
      process.execPath,
      [join(pluginRoot, "scripts/data-app.mjs"), "build", "--project-dir", projectRoot],
      {
        cwd: projectRoot,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 120_000,
        env: {
          ...Object.fromEntries(
            Object.entries(env).filter(([name]) => !/^(?:PATH|NODE_PATH|NODE_OPTIONS)$/iu.test(name)),
          ),
          PATH: commands,
          NODE_PATH: "",
          NODE_OPTIONS: "",
          npm_config_offline: "true",
          npm_config_cache: join(commands, "npm-cache"),
          NAPI_RS_FORCE_WASI: "error",
          NAPI_RS_NATIVE_LIBRARY_PATH: join(commands, "untrusted-native-override.node"),
          DATA_APP_BROWSER_PACKAGE_MANAGER_LOG: attempts,
        },
      },
    );
    assert.equal(
      existsSync(attempts),
      false,
      `A customer browser build invoked a package manager: ${
        existsSync(attempts) ? readFileSync(attempts, "utf8") : ""
      }`,
    );
    assertNoDependencies();
    return result;
  } finally {
    rmSync(commands, { recursive: true, force: true });
  }
}

function expandHome(value, home) {
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(home, value.slice(2));
  return isAbsolute(value) ? value : resolve(value);
}

function browserRoots(env, home, platform) {
  const configured = env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  const roots = configured && configured !== "0" ? [expandHome(configured, home)] : [];
  if (platform === "darwin") roots.push(join(home, "Library/Caches/ms-playwright"), join(home, ".cache/ms-playwright"));
  else if (platform === "win32")
    roots.push(env.LOCALAPPDATA && join(env.LOCALAPPDATA, "ms-playwright"), join(home, "AppData/Local/ms-playwright"));
  else roots.push(join(home, ".cache/ms-playwright"));
  return [...new Set(roots.filter(Boolean))];
}

function executableSuffixes(platform) {
  if (platform === "darwin")
    return [
      "chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "chrome-headless-shell-mac-x64/chrome-headless-shell",
      "chrome-headless-shell-mac/chrome-headless-shell",
    ];
  if (platform === "win32")
    return [
      "chrome-headless-shell-win64/chrome-headless-shell.exe",
      "chrome-headless-shell-win/chrome-headless-shell.exe",
    ];
  return ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-headless-shell-linux/chrome-headless-shell"];
}

export function resolveChromiumExecutable({
  env = process.env,
  exists = existsSync,
  home = homedir(),
  list = readdirSync,
  platform = process.platform,
} = {}) {
  const configured = env.CHROMIUM_EXECUTABLE_PATH?.trim() || env.PLAYWRIGHT_EXECUTABLE_PATH?.trim();
  if (configured) {
    const executable = expandHome(configured, home);
    if (exists(executable)) return executable;
    throw new Error(`Configured Chromium executable does not exist: ${executable}`);
  }

  for (const root of browserRoots(env, home, platform)) {
    if (!exists(root)) continue;
    const directories = list(root)
      .filter((name) => /^(?:chromium|chromium_headless_shell|chromium-headless-shell)-\d+$/u.test(name))
      .sort((left, right) => Number(right.match(/(\d+)$/u)?.[1]) - Number(left.match(/(\d+)$/u)?.[1]));
    for (const directory of directories) {
      for (const suffix of executableSuffixes(platform)) {
        const executable = join(root, directory, suffix);
        if (exists(executable)) return executable;
      }
    }
  }
  throw new Error("No installed Chromium headless-shell executable was found.");
}

export async function installDashboardBrowserMocks(page) {
  await page.addInitScript(() => {
    window.__dashboardPrompts = [];
    window.__dashboardDeepLinks = [];
    window.__dashboardNavigationEvents = [];
    window.__dashboardClipboard = [];
    window.__dashboardPrints = 0;
    window.__dashboardImageText = [];
    window.__dashboardImageDraws = [];
    document.addEventListener("click", (event) => {
      const link = event.target.closest('a[href^="codex://"], a[href^="https://chatgpt.com/"]');
      if (!link) return;
      window.__dashboardNavigationEvents.push({
        connected: link.isConnected,
        trusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented,
        target: link.target,
      });
      if (event.defaultPrevented) return;
      event.preventDefault();
      window.__dashboardDeepLinks.push(link.href);
    });
    const drawText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.__dashboardImageText.push(String(text));
      window.__dashboardImageDraws.push({
        text: String(text),
        x: args[0],
        y: args[1],
        baseline: this.textBaseline,
        width: this.measureText(String(text)).width,
        font: this.font,
      });
      return drawText.call(this, text, ...args);
    };
    window.openai = {
      sendFollowUpMessage: async (message) => {
        window.__dashboardPrompts.push(message);
        return { isError: false };
      },
    };
    window.print = () => {
      window.__dashboardPrints += 1;
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => window.__dashboardClipboard.push(text),
        write: async (items) => {
          const image = await items[0].getType("image/png");
          const header = new DataView(await image.arrayBuffer());
          window.__dashboardClipboard.push({
            type: "image/png",
            count: items.length,
            width: header.getUint32(16),
            height: header.getUint32(20),
            text: [...window.__dashboardImageText],
            draws: [...window.__dashboardImageDraws],
          });
        },
      },
    });
  });
}
