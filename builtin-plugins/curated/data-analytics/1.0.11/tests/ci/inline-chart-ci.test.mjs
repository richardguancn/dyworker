import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runDataAppFixtureBuild } from "../browser-helpers.mjs";
import { packageDataAppForSites } from "../../skills/publish-artifact-to-sites/scripts/package-data-app-for-sites.mjs";
import { assertNoCustomerToolchain } from "./verify-prebuilt-runtime.mjs";
import { workerFactory, writePublicationFixture } from "./fixtures/publication-fixture.mjs";

const ciRoot = fileURLToPath(new URL("./", import.meta.url));
const pluginRoot = resolve(ciRoot, "../..");
const catalogRoot = resolve(pluginRoot, "../..");
const repoRoot = resolve(pluginRoot, "../../../..");
const nodeVersion = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).engines.node;
const pluginPath = "chatgpt/oai-maintained-plugins/plugins/data-analytics";
const expectedSteps = [
  "install-node",
  "ci-regression",
  "hydrate-assets",
  "copy-offline-plugin",
  "verify-runtime",
  "build-app-offline",
  "capture-offline-app",
  "verify-prebuilt-runtime",
  ...[1, 2, 3].flatMap((repeat) => [`warm-build-app-offline-${repeat}`, `verify-warm-app-${repeat}`]),
  "package-sites-offline",
  "verify-sites-package",
  "prepare-inline",
  "plugin-dependencies",
  "prepare-template",
  "template-source-dependencies",
  "install-browser",
  "unit-tests",
  "serialization-browser-tests",
  "feature-coverage-browser-tests",
  "mobile-browser-tests",
  "dashboard-browser-tests",
  "report-browser-tests",
  "browser-tests",
  "dashboard-polish",
  "shared-components",
];
const digest = (contents) => createHash("sha256").update(contents).digest("hex");

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function write(path, contents, options) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, options);
}

function writeSourceFixture(project) {
  const files = {
    "package.json": "{}\n",
    "package-lock.json": "{}\n",
    "scripts/verify-protected-runtime.mjs": "// verified fixture\n",
    "src/data-app-owner.js": 'export const dataAppOwnerEmailSha256 = "";\n',
    ".openai/hosting.json": `${JSON.stringify({ d1: "DB", r2: null }, null, 2)}\n`,
  };
  for (const [name, contents] of Object.entries(files)) write(join(project, name), contents);
  write(
    join(project, "protected-runtime.json"),
    JSON.stringify({
      version: 1,
      files: Object.fromEntries(Object.entries(files).map(([name, contents]) => [name, digest(contents)])),
    }),
  );
  write(join(project, "src/data.json"), '{ "id": "offline-ci", "queries": { "reviewed": { "rows": [{ "category": "A", "value": 3 }] } } }\n');
  write(join(project, "src/theme.css"), ":root { --chart-1: red; }\n");
  write(join(project, "src/content/dashboard/DashboardContent.jsx"), "export const DashboardContent = () => null;\n");
}

function fixtureHtml(project, runtimeHash = "a".repeat(64)) {
  return (
    "<!doctype html><html><head>" +
    `<meta name="data-app-snapshot-sha256" content="${digest(readFileSync(join(project, "src/data.json")))}">` +
    `<meta name="data-app-runtime-sha256" content="${runtimeHash}">` +
    '<meta name="data-app-bootstrap" content="deferred-content-v1"></head><body>reviewed app' +
    `<script id="data-app-reviewed-snapshot" type="application/json">${readFileSync(join(project, "src/data.json"), "utf8")}</script>` +
    "<script>globalThis.reviewedFixture = 1;</script></body></html>\n"
  );
}

function sitesPackageFixture(project) {
  return {
    projectRoot: project,
    htmlPath: join(project, "dist/index.html"),
    serverPath: join(project, "dist/server/index.js"),
  };
}

function writeWorkerFixture(project, responseOverride) {
  const packaged = writePublicationFixture(project, { responseOverride });
  write(join(dirname(project), "package-result.json"), JSON.stringify(packaged));
  return packaged;
}

function runCleanCheckout(t, { failStep = "", reviewedNodeManifest = true, suite } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "data-inline-ci-regression-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const helper = join(root, "chatgpt/oai-maintained-plugins/plugins/data-analytics/tests/ci/run-inline-chart-ci.sh");
  const log = join(root, "commands.log");
  const bin = join(root, "bin");
  write(helper, readFileSync(join(ciRoot, "run-inline-chart-ci.sh")));
  write(join(root, "package.json"), JSON.stringify({ engines: { node: nodeVersion } }));
  if (reviewedNodeManifest) {
    write(join(root, `lib/js/oai_js/oai_js/node/v${nodeVersion}/manifest.json`), "{}\n");
  }
  for (const path of [
    "package-lock.json",
    "scripts/data-app.mjs",
    "assets/data-app-runtime/manifest.json",
    "skills/publish-artifact-to-sites/scripts/package-data-app-for-sites.mjs",
    "skills/visualize-data/scripts/render-inline-chart.mjs",
    "tests/data-app-serialization-browser.smoke.mjs",
    "tests/data-app-feature-coverage-browser.smoke.mjs",
  ])
    write(join(root, pluginPath, path), "{}\n");
  writeSourceFixture(join(root, pluginPath, "templates/data-app/base"));
  write(
    join(root, pluginPath, "templates/data-app/base/scripts/protected-file-digest.mjs"),
    readFileSync(join(pluginRoot, "templates/data-app/base/scripts/protected-file-digest.mjs")),
  );
  for (const name of ["verify-offline-build.mjs", "verify-prebuilt-runtime.mjs"])
    write(join(root, pluginPath, "tests/ci", name), readFileSync(join(ciRoot, name)));
  // A reused worker may retain unrelated test packages or old build output.
  // Neither may enter the isolated customer-plugin copy.
  write(join(root, pluginPath, "node_modules/ambient-fixture/package.json"), "{}\n");
  write(join(root, pluginPath, "templates/data-app/base/dist/stale.html"), "stale\n");
  write(join(root, "chatgpt/oai-maintained-plugins/manage/blob_data.hashes"), "fixture\n");
  write(join(root, "chatgpt/oai-maintained-plugins/pyproject.toml"), "fixture\n");
  write(
    join(root, "plugins/visualize/skills/visualize/assets/visualize.html"),
    "reviewed Codex host fixture\n",
  );
  const copiedTest = join(
    root,
    "chatgpt/oai-maintained-plugins/plugins/data-analytics/tests/ci/inline-chart-ci.test.mjs",
  );
  mkdirSync(dirname(copiedTest), { recursive: true });
  copyFileSync(fileURLToPath(import.meta.url), copiedTest);

  const commandFixture = fileURLToPath(new URL("fixtures/ci-command.mjs", import.meta.url));
  for (const command of ["uname", "oaipkg", "node", "npm", "blobdata"]) {
    write(
      join(bin, command),
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(commandFixture)} ${shellQuote(command)} "$@"\n`,
      { mode: 0o755 },
    );
  }
  const result = spawnSync("bash", [helper, ...(suite ? ["--suite", suite] : [])], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DATA_INLINE_MONOREPO_ROOT: "/wrong/inherited-checkout",
      DATA_INLINE_CI_TEST_ROOT: root,
      DATA_INLINE_CI_TEST_LOG: log,
      DATA_INLINE_CI_TEST_FAIL: failStep,
      DATA_INLINE_CI_TEST_SUITE: suite || "all",
    },
  });
  const steps = (() => {
    try {
      return readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  })();
  return { ...result, steps };
}

test("CI proves the prebuilt runtime, repeats cold and warm builds, and packages its Worker offline", (t) => {
  const result = runCleanCheckout(t);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(result.steps, expectedSteps);
});

test("separate CI groups retain cold setup and run every regression exactly once", (t) => {
  const setup = expectedSteps.slice(0, expectedSteps.indexOf("unit-tests"));
  const regressionSteps = expectedSteps.slice(setup.length);
  const actual = [];
  for (const suite of ["app", "inline"]) {
    const result = runCleanCheckout(t, { suite });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(result.steps.slice(0, setup.length), setup);
    const regressions = result.steps.slice(setup.length);
    assert.deepEqual(regressions, regressionSteps.filter((step) => (step === "browser-tests") === (suite === "inline")));
    actual.push(...regressions);
  }
  assert.deepEqual(actual.sort(), [...regressionSteps].sort());
});

test("unknown CI groups fail before setup rather than silently skipping regressions", (t) => {
  const result = runCleanCheckout(t, { suite: "unknown" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/u);
  assert.deepEqual(result.steps, []);
});

test("the standalone browser smoke accepts the reviewed Codex checkout explicitly", () => {
  const smoke = readFileSync(join(pluginRoot, "tests/inline-chart-browser.smoke.mjs"), "utf8");
  assert.match(
    smoke,
    /const monorepoRoot = resolve\(process\.env\.DATA_INLINE_MONOREPO_ROOT \|\| resolve\(pluginRoot, "\.\.\/\.\.\/\.\.\/\.\."\)\)/u,
    "An explicit host checkout must take precedence over the plugin's original monorepo layout",
  );
  assert.match(smoke, /const appRoot = join\(monorepoRoot, "codex\/codex-apps"\)/u);
});

test("the actual Codex browser host uses only explicit maintainer dependencies", () => {
  const smoke = readFileSync(join(pluginRoot, "tests/inline-chart-browser.smoke.mjs"), "utf8");
  assert.match(smoke, /DATA_INLINE_HOST_DEPENDENCY_ROOT/u);
  assert.match(smoke, /createRequire\(join\(hostDependencyRoot, "package\.json"\)\)/u);
  const hostBuild = smoke.match(/async function buildActualVisualizationHost\(\) \{([\s\S]*?)\n\}/u)?.[1];
  assert.ok(hostBuild, "The browser regression must build the actual Visualize host");
  assert.match(hostBuild, /dependencyRequire\.resolve\("vite"\)/u);
  assert.doesNotMatch(smoke, /data-app-toolchain|withBundledNativeBinding|dependencyDirectory|requireDependencies/u);
});

test("all Data app browser fixtures build through the package-manager-free default", () => {
  for (const name of [
    "data-app-browser.smoke.mjs",
    "data-app-browser-dashboard-composition.mjs",
    "data-report-browser.smoke.mjs",
    "data-app-url-state-browser.smoke.mjs",
    "data-app-authored-tab-url-browser.smoke.mjs",
    "data-app-permalink-tabs-browser.smoke.mjs",
    "data-app-block-drag-browser.smoke.mjs",
    "data-app-creative-layout-browser.smoke.mjs",
    "data-app-custom-layout-browser.smoke.mjs",
    "data-app-ranked-list-browser.smoke.mjs",
    "data-app-feature-coverage-browser.smoke.mjs",
    "data-app-theme-contrast.smoke.mjs",
    "data-app-header-alignment.smoke.mjs",
  ]) {
    const source = readFileSync(join(pluginRoot, "tests", name), "utf8");
    assert.match(source, /runDataAppFixtureBuild\(/u, `${name} must exercise the customer default`);
    assert.doesNotMatch(
      source,
      /spawnSync\("npm"|symlinkSync\(|templates\/data-app\/base\/dist/u,
      `${name} must not borrow a previous source build or node_modules`,
    );
  }
  const dashboard = readFileSync(join(pluginRoot, "tests/data-app-browser.smoke.mjs"), "utf8");
  assert.match(dashboard, /buildAuthoredPublishedFixture\("secondary-tab"/u);
  assert.match(dashboard, /buildAuthoredPublishedFixture\("unsafe-ids"/u);
  assert.doesNotMatch(
    dashboard,
    /replaceUniquePublishedFixture|activeTabBinding|dashboardContextSnapshot/u,
    "Browser behavior fixtures must edit authored source, not compiler-specific minified output",
  );
});

test("CI stops on a failed hydration, offline build, template preparation, or test", async (t) => {
  for (const failStep of [
    "hydrate-assets",
    "copy-offline-plugin",
    "build-app-offline",
    "verify-prebuilt-runtime",
    "warm-build-app-offline-1",
    "verify-warm-app-1",
    "warm-build-app-offline-3",
    "verify-warm-app-3",
    "package-sites-offline",
    "verify-sites-package",
    "prepare-inline",
    "prepare-template",
    "template-source-dependencies",
    "unit-tests",
    "serialization-browser-tests",
    "feature-coverage-browser-tests",
    "mobile-browser-tests",
    "dashboard-browser-tests",
    "report-browser-tests",
    "browser-tests",
    "dashboard-polish",
    "shared-components",
  ]) {
    await t.test(failStep, (t) => {
      const result = runCleanCheckout(t, { failStep });
      assert.equal(result.status, 29, `${result.stdout}\n${result.stderr}`);
      assert.deepEqual(result.steps, expectedSteps.slice(0, expectedSteps.indexOf(failStep) + 1));
    });
  }
});

test("the prebuilt probe rejects installed packages and native/WASM compilers", (t) => {
  const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "data-prebuilt-probe-")));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  const clean = {
    projectRoot,
    loadedModules: ["/plugin/scripts/prebuilt/compiler.cjs"],
    sharedObjects: ["/usr/lib/libSystem.B.dylib"],
  };
  assert.doesNotThrow(() => assertNoCustomerToolchain(clean));
  for (const filename of [
    "/ambient/node_modules/react/index.js",
    "C:\\ambient\\node_modules\\vite\\dist\\node\\index.js",
    "/ambient/node_modules/@rolldown/binding-wasm32-wasi/index.js",
  ]) {
    assert.throws(
      () => assertNoCustomerToolchain({ ...clean, loadedModules: [filename] }),
      /must not load an installed npm package/u,
    );
  }
  for (const filename of [
    "/ambient/rolldown-binding.linux-x64-gnu.node",
    "C:\\ambient\\lightningcss.win32-x64-msvc.node",
    "/ambient/esbuild.wasm",
  ]) {
    assert.throws(
      () => assertNoCustomerToolchain({ ...clean, sharedObjects: [filename] }),
      /must not load a native or WASM build toolchain/u,
    );
  }
  mkdirSync(join(projectRoot, "node_modules"));
  assert.throws(() => assertNoCustomerToolchain(clean), /must not contain node_modules/u);
});

function browserBuildFixture(t, source) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "data-browser-build-contract-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const plugin = join(root, "plugin");
  const project = join(root, "app");
  mkdirSync(project, { recursive: true });
  write(join(plugin, "scripts/data-app.mjs"), source);
  return () => runDataAppFixtureBuild(project, { pluginRoot: plugin });
}

test("browser fixture builds invoke absolute Node with no ambient package environment", (t) => {
  const run = browserBuildFixture(
    t,
    `
import assert from "node:assert/strict";
assert.deepEqual(process.argv.slice(2), ["build", "--project-dir", process.cwd()]);
assert.equal(process.env.NODE_PATH, "");
assert.equal(process.env.NODE_OPTIONS, "");
assert.equal(process.env.npm_config_offline, "true");
console.log("node-only fixture");
`,
  );
  const result = run();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /node-only fixture/u);
});

test("browser fixture builds detect swallowed package-manager calls", (t) => {
  const run = browserBuildFixture(
    t,
    `
import { spawnSync } from "node:child_process";
spawnSync("npm", ["--version"], { shell: process.platform === "win32" });
`,
  );
  assert.throws(run, /invoked a package manager/u);
});

test("browser fixture builds reject creating a dependency tree", (t) => {
  const run = browserBuildFixture(
    t,
    `
import { mkdirSync } from "node:fs";
mkdirSync("node_modules");
`,
  );
  assert.throws(run, /must not create or borrow node_modules/u);
});

function offlineBuildFixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "data-offline-build-check-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "app");
  const state = join(root, "state.json");
  const packageResult = join(root, "package-result.json");
  writeSourceFixture(project);
  write(join(project, "dist/index.html"), fixtureHtml(project));
  const packaged = sitesPackageFixture(project);
  write(packageResult, JSON.stringify(packaged));
  const run = (command, extra = []) =>
    spawnSync(
      process.execPath,
      [join(ciRoot, "verify-offline-build.mjs"), command, "--project-dir", project, "--state-file", state, ...extra,
        ...(extra.includes("--require-worker") ? ["--package-result-file", packageResult] : [])],
      { encoding: "utf8" },
    );
  const captured = run("capture");
  assert.equal(captured.status, 0, `${captured.stdout}\n${captured.stderr}`);
  return { project, run };
}

test("offline app checks preserve reviewed source and validate a standalone Worker", (t) => {
  const fixture = offlineBuildFixture(t);
  const warm = fixture.run("verify");
  assert.equal(warm.status, 0, `${warm.stdout}\n${warm.stderr}`);
  writeWorkerFixture(fixture.project);
  const packaged = fixture.run("verify", ["--require-worker"]);
  assert.equal(packaged.status, 0, `${packaged.stdout}\n${packaged.stderr}`);
});

test("offline app checks accept the real packager's immutable asset and source-preservation contract", (t) => {
  const fixture = offlineBuildFixture(t);
  // This suite runs before release blob hydration. Use the real packager with a
  // small Worker factory, while the CI shell later covers the shipped build.
  const runtime = join(dirname(fixture.project), "runtime");
  write(join(runtime, "assets/data-app-runtime/worker.mjs"), workerFactory);
  const packaged = packageDataAppForSites({ "project-dir": fixture.project,
    "project-id": "appgprj_offline_real" }, runtime);
  write(join(dirname(fixture.project), "package-result.json"), JSON.stringify(packaged));
  const result = fixture.run("verify", ["--require-worker"]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("offline app checks reject source drift, dependency trees, stale HTML, and incomplete Workers", async (t) => {
  const cases = [
    {
      name: "missing Worker",
      mutate: ({ project }) => rmSync(writeWorkerFixture(project).serverPath),
      extra: ["--require-worker"],
      error: /Missing or invalid Sites Worker build/u,
    },
    {
      name: "changed package lock",
      mutate: ({ project }) => write(join(project, "package-lock.json"), '{"changed":true}\n'),
      extra: [],
      error: /reviewed Data app source was modified/u,
    },
    {
      name: "changed authored content",
      mutate: ({ project }) =>
        write(join(project, "src/content/dashboard/DashboardContent.jsx"), "export const changed = true;\n"),
      extra: [],
      error: /reviewed Data app source was modified/u,
    },
    {
      name: "created dependency tree",
      mutate: ({ project }) => write(join(project, "node_modules/.vite-temp/config.mjs"), "temporary\n"),
      extra: [],
      error: /must not create project node_modules/u,
    },
    {
      name: "changed browser runtime",
      mutate: ({ project }) => write(join(project, "dist/index.html"), fixtureHtml(project, "b".repeat(64))),
      extra: [],
      error: /prebuilt browser runtime changed/u,
    },
    {
      name: "stale reviewed snapshot marker",
      mutate: ({ project }) => write(join(project, "src/data.json"), '{"queries":{"changed":{}}}\n'),
      extra: [],
      error: /must match the exact reviewed snapshot bytes/u,
    },
    {
      name: "nondeterministic warm output",
      mutate: ({ project }) => write(join(project, "dist/index.html"), `${fixtureHtml(project)}<!-- changed -->\n`),
      extra: [],
      error: /same HTML bytes/u,
    },
    {
      name: "packaging changes local HTML",
      mutate: ({ project }) => {
        writeWorkerFixture(project);
        write(join(project, "dist/index.html"), `${fixtureHtml(project)}<!-- changed -->\n`);
      },
      extra: ["--require-worker"],
      error: /HTML|asset|client code/u,
    },
    {
      name: "packaging changes unrelated hosting settings",
      mutate: ({ project }) => {
        writeWorkerFixture(project);
        const path = join(project, ".openai/hosting.json");
        write(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), unrelated: true }));
      },
      extra: ["--require-worker"],
      error: /hosting|source/u,
    },
    {
      name: "self-consistent hosted assets substitute different executable code",
      mutate: ({ project }) => {
        const packaged = writeWorkerFixture(project);
        const original = readFileSync(packaged.htmlPath, "utf8");
        const html = original.replace("globalThis.reviewedFixture = 1;", "globalThis.reviewedFixture = 2;");
        assert.notEqual(html, original);
        const sha256 = digest(html);
        const descriptor = { key: `data-app/html/${sha256}`, sha256, bytes: Buffer.byteLength(html) };
        write(packaged.htmlPath, html);
        write(packaged.assetFiles.html, html);
        packaged.deploymentAssets.html = descriptor;
        packaged.hostedHtmlSha256 = sha256;
        write(join(dirname(project), "package-result.json"), JSON.stringify(packaged));
        const manifest = JSON.parse(readFileSync(packaged.assetManifestPath, "utf8"));
        manifest.assets.html = { ...descriptor, path: "html.html" };
        write(packaged.assetManifestPath, JSON.stringify(manifest));
        write(packaged.serverPath, `${workerFactory}\nexport default createDataAppWorker(${JSON.stringify({ deploymentAssets: packaged.deploymentAssets })});\n`);
      },
      extra: ["--require-worker"],
      error: /reviewed|HTML|application|executable/u,
    },
    {
      name: "incorrect bucket binding",
      mutate: ({ project }) => {
        writeWorkerFixture(project);
        const path = join(project, ".openai/hosting.json");
        write(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), r2: "WRONG" }));
      },
      extra: ["--require-worker"],
      error: /hosting|BUCKET|source/u,
    },
    {
      name: "changed preserved offline HTML",
      mutate: ({ project }) => write(writeWorkerFixture(project).offlineHtmlPath, fixtureHtml(project) + "<!-- changed -->"),
      extra: ["--require-worker"],
      error: /offline|HTML/u,
    },
    {
      name: "missing hosted HTML asset",
      mutate: ({ project }) => rmSync(writeWorkerFixture(project).assetFiles.html),
      extra: ["--require-worker"],
      error: /asset|ENOENT/u,
    },
    {
      name: "corrupted snapshot asset",
      mutate: ({ project }) => write(writeWorkerFixture(project).assetFiles.snapshot, '{"queries":{}}'),
      extra: ["--require-worker"],
      error: /asset|snapshot/u,
    },
    {
      name: "validly hashed asset substitutes different reviewed rows",
      mutate: ({ project }) => {
        const packaged = writeWorkerFixture(project);
        const bytes = '{"id":"offline-ci","queries":{"reviewed":{"rows":[{"category":"A","value":999}]}}}';
        const sha256 = digest(bytes);
        const descriptor = { key: `data-app/snapshot/${sha256}`, sha256, bytes: Buffer.byteLength(bytes) };
        write(packaged.assetFiles.snapshot, bytes);
        packaged.deploymentAssets.snapshot = descriptor;
        packaged.snapshotSha256 = sha256;
        write(join(dirname(project), "package-result.json"), JSON.stringify(packaged));
        const manifest = JSON.parse(readFileSync(packaged.assetManifestPath, "utf8"));
        manifest.assets.snapshot = { ...descriptor, path: "snapshot.json" };
        write(packaged.assetManifestPath, JSON.stringify(manifest));
      },
      extra: ["--require-worker"],
      error: /reviewed|snapshot/u,
    },
    {
      name: "incorrect Sites attribution",
      mutate: ({ project }) => {
        writeWorkerFixture(project);
        const path = join(project, "dist/.openai/hosting.json");
        const hosting = JSON.parse(readFileSync(path, "utf8"));
        hosting.artifact_metadata.producer = "customer-authored-value";
        write(path, JSON.stringify(hosting));
      },
      extra: ["--require-worker"],
      error: /Sites attribution must identify the reviewed Data artifact/u,
    },
    {
      name: "Worker serves different HTML",
      mutate: ({ project }) => writeWorkerFixture(project, "wrong reviewed HTML"),
      extra: ["--require-worker"],
      error: /must serve the exact reviewed HTML/u,
    },
    {
      name: "Worker omits its Sites project marker",
      mutate: ({ project }) => writeWorkerFixture(project, fixtureHtml(project)),
      extra: ["--require-worker"],
      error: /must serve the exact reviewed HTML/u,
    },
    {
      name: "Worker identifies another Sites project",
      mutate: ({ project }) => writeWorkerFixture(project, fixtureHtml(project).replace(
        "<head>", '<head><meta name="data-app-sites-project" content="appgprj_other">',
      )),
      extra: ["--require-worker"],
      error: /must serve the exact reviewed HTML/u,
    },
    {
      name: "Worker duplicates its Sites project marker",
      mutate: ({ project }) => writeWorkerFixture(project, fixtureHtml(project).replace(
        "<head>", '<head>' + '<meta name="data-app-sites-project" content="appgprj_offline_fixture">'.repeat(2),
      )),
      extra: ["--require-worker"],
      error: /must serve the exact reviewed HTML/u,
    },
    {
      name: "Worker has no fetch handler",
      mutate: ({ project }) => {
        const packaged = writeWorkerFixture(project);
        write(packaged.serverPath, "export default {};\n");
      },
      extra: ["--require-worker"],
      error: /must export a real Worker/u,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, (t) => {
      const fixture = offlineBuildFixture(t);
      scenario.mutate(fixture);
      const result = fixture.run("verify", scenario.extra);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, scenario.error);
    });
  }
});

test("CI refuses to install an unreviewed Node archive", (t) => {
  const result = runCleanCheckout(t, { reviewedNodeManifest: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing reviewed Node archive manifest/u);
  assert.deepEqual(result.steps, []);
});

test("the parent CI gate keeps its tools CI-only and watches its pinned inputs", () => {
  const pipeline = readFileSync(join(catalogRoot, "manage/applied_spec.py"), "utf8");
  const metadata = readFileSync(join(catalogRoot, "pyproject.toml"), "utf8");
  assert.match(pipeline, /oaipkg install oai_js applied-blob-data/u);
  assert.match(pipeline, /run-during-merge/u);
  assert.match(pipeline, /eligible_for_test_selection_pruning=False/u);
  assert.match(metadata, /direct-test-project-dependencies\s*=\s*\[\s*"applied-blob-data",\s*"oai_js"\s*\]/u);
  assert.doesNotMatch(
    metadata,
    /^monorepo-dependencies\s*=\s*\[[^\]]*"(?:applied-blob-data|oai_js)"/mu,
    "CI-only tools must not change the catalog's shared Python runtime lock",
  );
  assert.doesNotMatch(
    metadata,
    /dependency-check-ignore\s*=\s*\[[^\]]*"applied-blob-data"/u,
    "Selection-only dependencies do not need an import-check exception",
  );
  for (const path of [
    "chatgpt/oai-maintained-plugins/pyproject.toml",
    "chatgpt/oai-maintained-plugins/manage/blob_data.hashes",
  ])
    assert.ok(pipeline.includes(`"${path}"`), `CI must watch ${path}`);
  assert.ok(pipeline.includes(`"${pluginPath}"`), "CI must watch the Data plugin");
  assert.ok(
    pipeline.includes('"chatgpt/oai-maintained-plugins-publisher/pyproject.toml"'),
    "The publisher tests must use their project's default Bazel selection",
  );
});
