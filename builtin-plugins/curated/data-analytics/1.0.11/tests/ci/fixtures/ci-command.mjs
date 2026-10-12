// Command doubles for the real CI shell helper. They model a checkout with no
// hydrated plugin payload, inline cache, or browser installation.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writePublicationFixture } from "./publication-fixture.mjs";

const root = process.env.DATA_INLINE_CI_TEST_ROOT;
const plugin = join(root, "chatgpt/oai-maintained-plugins/plugins/data-analytics");
const base = join(plugin, "templates/data-app/base");
const [command, ...args] = process.argv.slice(2);
const nodeVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).engines.node;
const workDir = process.env.DATA_INLINE_CACHE_DIR && dirname(process.env.DATA_INLINE_CACHE_DIR);
const offlinePlugin = workDir && join(workDir, "installed-data-plugin");
const offlineProject = workDir && join(workDir, "data-app");
const offlineBase = offlinePlugin && join(offlinePlugin, "templates/data-app/base");
const appState = workDir && join(workDir, "offline-app-state.json");
const packageResultPath = workDir && join(workDir, "offline-sites-package.json");
const prebuiltRuntimeReady = workDir && join(workDir, "prebuilt-runtime-ready");
const inlinePrepared = workDir && join(workDir, "inline-prepared");
const templatePrepared = workDir && join(workDir, "template-prepared");
const warmBuildCountPath = workDir && join(workDir, "warm-build-count");
const warmVerifyCountPath = workDir && join(workDir, "warm-verify-count");
const artifactPaths = {
  app: "app.js",
  styles: "styles.css",
  print: "print.css",
  inline: "inline.js",
  worker: "worker.mjs",
  compiler: "compiler.cjs",
  notices: "THIRD_PARTY_NOTICES.txt",
};
const digest = (contents) => createHash("sha256").update(contents).digest("hex");

function fixtureHtml() {
  const manifest = JSON.parse(readFileSync(join(offlinePlugin, "assets/data-app-runtime/manifest.json"), "utf8"));
  const snapshotHash = digest(readFileSync(join(offlineProject, "src/data.json")));
  return (
    `<!doctype html><html><head><meta name="data-app-snapshot-sha256" content="${snapshotHash}">` +
    `<meta name="data-app-runtime-sha256" content="${manifest.artifacts.app.sha256}">` +
    '<meta name="data-app-bootstrap" content="deferred-content-v1"></head>' +
    `<body>offline prebuilt app<script id="data-app-reviewed-snapshot" type="application/json">${readFileSync(join(offlineProject, "src/data.json"), "utf8")}</script></body></html>\n`
  );
}

function record(step) {
  appendFileSync(process.env.DATA_INLINE_CI_TEST_LOG, `${step}\n`);
  if (process.env.DATA_INLINE_CI_TEST_FAIL === step) process.exit(29);
}

function write(path, contents = "ready\n") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function requireReady(path) {
  assert.ok(existsSync(path), `Missing CI prerequisite: ${path}`);
}

function readCount(path) {
  return existsSync(path) ? Number(readFileSync(path, "utf8")) : 0;
}

function requireOffline() {
  assert.equal(process.env.PATH, join(workDir, "no-npm"));
  assert.equal(process.env.npm_config_offline, "true");
  assert.equal(process.env.npm_config_cache, join(workDir, "npm-cache"));
  assert.equal(process.env.NODE_PATH, "");
  assert.equal(process.env.NODE_OPTIONS, "");
  assert.equal(process.env.NAPI_RS_FORCE_WASI, "error");
  assert.equal(process.env.NAPI_RS_NATIVE_LIBRARY_PATH, join(workDir, "untrusted-native-override.node"));
  for (const executable of ["npm", "npx", "pnpm", "yarn", "corepack", "bun"]) {
    const result = spawnSync(executable, ["--version"], { encoding: "utf8", env: process.env });
    assert.equal(result.status, 86, `${executable} must be unavailable during customer builds`);
    assert.match(result.stderr, /Customer Data builds must not invoke a package manager/u);
  }
}

function requirePayload() {
  for (const path of ["manifest.json", ...Object.values(artifactPaths)]) {
    requireReady(join(offlinePlugin, "assets/data-app-runtime", path));
  }
}

function requireColdPlugin() {
  requirePayload();
  assert.equal(
    existsSync(join(offlinePlugin, "node_modules")),
    false,
    "The installed-plugin fixture must not inherit maintainer dependencies",
  );
}

if (command === "uname") {
  assert.deepEqual(args, ["-s"]);
  process.stdout.write("Linux\n");
} else if (command === "oaipkg") {
  assert.deepEqual(args.slice(0, 3), ["run", "oai_js.install_node", `node_version=${nodeVersion}`]);
  assert.match(args[3], /^prefix=/u);
  record("install-node");
  const node = join(args[3].slice("prefix=".length), "bin/node");
  mkdirSync(dirname(node), { recursive: true });
  copyFileSync(join(root, "bin/node"), node);
} else if (command === "node" && args[0] === "--version") {
  process.stdout.write(`v${nodeVersion}\n`);
} else if (command === "node" && args[0] === "--test") {
  // The outer Buildkite invocation runs this suite for real. The subprocess
  // doubles this one command to avoid recursively launching the same suite.
  assert.deepEqual(args, [
    "--test",
    join(root, "chatgpt/oai-maintained-plugins/plugins/data-analytics/tests/ci/inline-chart-ci.test.mjs"),
  ]);
  requireReady(args[1]);
  record("ci-regression");
} else if (command === "node" && args[0] === "--input-type=module") {
  assert.equal(args[1], "-e");
  assert.deepEqual(args.slice(3), [plugin, offlinePlugin, offlineProject]);
  requireReady(join(plugin, "assets/data-app-runtime/app.js"));
  record("copy-offline-plugin");
  // Exercise the real copy/filter snippet instead of reproducing its logic.
  const result = spawnSync(process.execPath, args, { encoding: "utf8", env: process.env });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  requireColdPlugin();
  requireReady(join(offlineProject, "package-lock.json"));
  for (const directory of ["node_modules", "dist"]) {
    assert.equal(existsSync(join(offlineProject, directory)), false, `The cold app must not inherit ${directory}`);
    assert.equal(
      existsSync(join(offlinePlugin, "templates/data-app/base", directory)),
      false,
      `The installed template must not inherit ${directory}`,
    );
  }
} else if (
  command === "node" &&
  args[0] === join(offlinePlugin, "templates/data-app/base/scripts/verify-protected-runtime.mjs")
) {
  assert.deepEqual(args, [args[0]]);
  requireOffline();
  requireColdPlugin();
  record("verify-runtime");
} else if (command === "node" && args[0] === join(offlinePlugin, "scripts/data-app.mjs")) {
  requireOffline();
  requirePayload();
  if (args[1] === "build") {
    assert.deepEqual(args, [args[0], "build", "--project-dir", offlineProject]);
    requireReady(join(offlineProject, "package-lock.json"));
    requireColdPlugin();
    assert.equal(
      existsSync(join(offlineProject, "node_modules")),
      false,
      "The customer app must never install dependencies",
    );
    if (existsSync(join(offlineProject, "dist/index.html"))) {
      requireReady(appState);
      requireReady(prebuiltRuntimeReady);
      requireReady(join(offlineProject, "dist/index.html"));
      const prior = readCount(warmBuildCountPath);
      assert.equal(readCount(warmVerifyCountPath), prior, "Verify each previous warm build before repeating it");
      assert.ok(prior < 3, "The prebuilt regression must perform exactly three warm builds");
      record(`warm-build-app-offline-${prior + 1}`);
      write(join(offlineProject, "dist/index.html"), fixtureHtml());
      write(warmBuildCountPath, String(prior + 1));
    } else {
      assert.equal(existsSync(join(offlineProject, "node_modules")), false, "The first app build must start cold");
      record("build-app-offline");
      write(join(offlineProject, "dist/index.html"), fixtureHtml());
    }
  } else {
    assert.deepEqual(args, [args[0], "prepare", "--project-dir", offlineBase]);
    requireReady(join(offlinePlugin, "node_modules/playwright-core/cli.js"));
    requireReady(inlinePrepared);
    assert.equal(
      existsSync(join(offlineBase, "node_modules")),
      false,
      "Test template preparation must not replace unowned checkout dependencies",
    );
    record("prepare-template");
    write(templatePrepared);
  }
} else if (command === "node" && args[0] === join(offlinePlugin, "tests/ci/verify-prebuilt-runtime.mjs")) {
  assert.deepEqual(args, [args[0], "--project-dir", offlineProject]);
  requireOffline();
  requireColdPlugin();
  requireReady(args[0]);
  requireReady(appState);
  assert.equal(existsSync(join(offlineProject, "node_modules")), false);
  assert.equal(readCount(warmBuildCountPath), 0, "Prove the prebuilt runtime after the cold build");
  assert.equal(existsSync(prebuiltRuntimeReady), false, "The prebuilt runtime check must run once");
  record("verify-prebuilt-runtime");
  write(prebuiltRuntimeReady);
} else if (command === "node" && args[0] === join(offlinePlugin, "tests/ci/verify-offline-build.mjs")) {
  requireOffline();
  requireColdPlugin();
  const requireWorker = args.includes("--require-worker");
  assert.deepEqual(args, [
    args[0],
    args[1],
    "--project-dir",
    offlineProject,
    "--state-file",
    appState,
    ...(requireWorker ? ["--require-worker", "--package-result-file", packageResultPath] : []),
  ]);
  if (args[1] === "capture") {
    assert.equal(requireWorker, false);
    assert.equal(existsSync(appState), false, "Capture the source and runtime only after the cold build");
    record("capture-offline-app");
  } else {
    assert.equal(args[1], "verify");
    requireReady(appState);
    if (requireWorker) {
      assert.equal(readCount(warmVerifyCountPath), 3);
      record("verify-sites-package");
    } else {
      const count = readCount(warmBuildCountPath);
      assert.ok(count >= 1 && count <= 3);
      assert.equal(readCount(warmVerifyCountPath), count - 1);
      record(`verify-warm-app-${count}`);
    }
  }
  // Run the real builtins-only verifier, including its source/runtime checks.
  const result = spawnSync(process.execPath, args, { encoding: "utf8", env: process.env });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  if (args[1] === "verify" && !requireWorker) write(warmVerifyCountPath, String(readCount(warmBuildCountPath)));
} else if (
  command === "node" &&
  args[0] === join(offlinePlugin, "skills/publish-artifact-to-sites/scripts/package-data-app-for-sites.mjs")
) {
  assert.deepEqual(args, [
    args[0],
    "--project-dir",
    offlineProject,
    "--project-id",
    "appgprj_data_offline_ci",
  ]);
  requireOffline();
  requireColdPlugin();
  requireReady(appState);
  requireReady(prebuiltRuntimeReady);
  assert.equal(readCount(warmBuildCountPath), 3, "Package only after all repeated prebuilt builds succeed");
  assert.equal(readCount(warmVerifyCountPath), 3, "Verify all repeated builds before packaging");
  requireReady(join(offlineProject, "dist/index.html"));
  record("package-sites-offline");
  process.stdout.write(`${JSON.stringify(writePublicationFixture(offlineProject, { projectId: "appgprj_data_offline_ci" }))}\n`);
} else if (
  command === "node" &&
  args[0] === join(offlinePlugin, "skills/visualize-data/scripts/render-inline-chart.mjs")
) {
  assert.deepEqual(args, [args[0], "--prepare", "--offline", "--cache-dir", process.env.DATA_INLINE_CACHE_DIR]);
  requireOffline();
  requireColdPlugin();
  requireReady(join(offlineProject, "dist/index.html"));
  requireReady(JSON.parse(readFileSync(packageResultPath, "utf8")).serverPath);
  assert.equal(existsSync(join(base, "node_modules")), false, "Prepare must precede template preparation");
  assert.equal(existsSync(process.env.DATA_INLINE_CACHE_DIR), false, "Prebuilt prepare must not need a cache");
  record("prepare-inline");
  write(inlinePrepared);
} else if (command === "blobdata") {
  assert.deepEqual(args, [
    "download",
    "oai-maintained-plugins",
    "--repo-root",
    root,
    "--filter",
    "^plugins/data-analytics/",
  ]);
  requireReady(join(root, "chatgpt/oai-maintained-plugins/manage/blob_data.hashes"));
  record("hydrate-assets");
  write(join(plugin, "assets/datascience.png"), "pinned asset fixture");
  const artifacts = Object.fromEntries(
    Object.entries(artifactPaths).map(([name, path]) => {
      const contents = `pinned ${name} fixture\n`;
      write(join(plugin, "assets/data-app-runtime", path), contents);
      return [name, { path, sha256: digest(contents), bytes: Buffer.byteLength(contents) }];
    }),
  );
  write(join(plugin, "assets/data-app-runtime/manifest.json"), JSON.stringify({ format: 1, apiVersion: 1, artifacts }));
} else if (command === "npm" && args[0] === "ci") {
  requireReady(inlinePrepared);
  if (process.cwd() === offlinePlugin) {
    assert.deepEqual(args, ["ci", "--no-audit", "--no-fund"]);
    requireReady(join(offlinePlugin, "package-lock.json"));
    record("plugin-dependencies");
    write(join(offlinePlugin, "node_modules/playwright-core/cli.js"));
  } else {
    assert.equal(process.cwd(), offlineBase);
    assert.deepEqual(args, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
    requireReady(templatePrepared);
    assert.equal(
      existsSync(join(offlineBase, "node_modules")),
      false,
      "The prebuilt template check must run before any maintainer source dependencies exist",
    );
    record("template-source-dependencies");
    write(join(offlineBase, "node_modules/.bin/vite"));
    write(join(offlineBase, "node_modules/vite/bin/vite.js"));
  }
} else if (command === "node" && args[0] === "node_modules/playwright-core/cli.js") {
  assert.deepEqual(args, [
    args[0], "install", "--with-deps", "--only-shell", "chromium",
    ...(process.env.DATA_INLINE_CI_TEST_SUITE === "inline" ? [] : ["webkit"]),
  ]);
  assert.equal(process.cwd(), offlinePlugin);
  requireReady(join(offlinePlugin, args[0]));
  record("install-browser");
  write(join(process.env.PLAYWRIGHT_BROWSERS_PATH, "browser-ready"));
} else if (command === "npm" && args[0] === "test") {
  assert.deepEqual(args, ["test"]);
  assert.equal(process.cwd(), offlinePlugin);
  requireReady(join(offlineBase, "node_modules/.bin/vite"));
  requireReady(join(offlinePlugin, "assets/datascience.png"));
  requireReady(join(process.env.PLAYWRIGHT_BROWSERS_PATH, "browser-ready"));
  record("unit-tests");
} else if (
  command === "node" &&
  ["tests/data-app-serialization-browser.smoke.mjs", "tests/data-app-feature-coverage-browser.smoke.mjs"].includes(
    args[0],
  )
) {
  assert.deepEqual(args, [args[0]]);
  assert.equal(process.cwd(), offlinePlugin);
  requireReady(join(offlinePlugin, args[0]));
  requireReady(join(process.env.PLAYWRIGHT_BROWSERS_PATH, "browser-ready"));
  record(
    args[0] === "tests/data-app-serialization-browser.smoke.mjs"
      ? "serialization-browser-tests"
      : "feature-coverage-browser-tests",
  );
} else if (command === "npm" && args[0] === "run") {
  assert.equal(args.length, 2);
  assert.equal(process.cwd(), offlinePlugin);
  assert.equal(
    process.env.DATA_INLINE_MONOREPO_ROOT,
    root,
    "The staged browser smoke must read Codex host assets from the real checkout",
  );
  requireReady(join(root, "plugins/visualize/skills/visualize/assets/visualize.html"));
  assert.equal(process.env.DATA_INLINE_HOST_DEPENDENCY_ROOT, offlineBase);
  requireReady(inlinePrepared);
  assert.equal(
    existsSync(process.env.DATA_INLINE_CACHE_DIR),
    false,
    "The prebuilt inline runtime must not acquire a mutable compiler cache",
  );
  requireReady(join(process.env.PLAYWRIGHT_BROWSERS_PATH, "browser-ready"));
  const steps = {
    "test:data-app-browser": "dashboard-browser-tests",
    "test:data-report-browser": "report-browser-tests",
    "test:mobile-responsive-browser": "mobile-browser-tests",
    "test:inline-chart-browser": "browser-tests",
    "test:data-app-polish-browser": "dashboard-polish",
    "test:data-app-custom-layout-browser": "shared-components",
  };
  assert.ok(Object.hasOwn(steps, args[1]), `Unexpected browser test: ${args[1]}`);
  if (args[1] === "test:mobile-responsive-browser") {
    assert.equal(process.env.DATA_APP_SKIP_WEBKIT_TOUCH, "1",
      "Linux CI must avoid the WPE SVG touch renderer crash");
  }
  record(steps[args[1]]);
} else {
  throw new Error(`Unexpected CI command: ${command} ${args.join(" ")}`);
}
