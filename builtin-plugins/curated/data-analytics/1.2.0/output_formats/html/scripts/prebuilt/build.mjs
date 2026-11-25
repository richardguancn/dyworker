import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Script } from "node:vm";

import {
  assertReplacementSafe,
  MAX_INLINE_FRAGMENT_BYTES,
} from "../../../../skills/visualize-data/scripts/runtime/sources-common.mjs";
import {
  assembleInlineFragment,
  loadInlineTheme,
} from "../../../../skills/visualize-data/scripts/runtime/fragment-output.mjs";
import { makeReplacementSafe } from "../../../../skills/visualize-data/scripts/runtime/replacement-safe-javascript.mjs";
import { normalizeInlineSourcesInput } from "../../../../skills/visualize-data/scripts/runtime/inline-sources-input.mjs";
import {
  API_VERSION,
  ARTIFACT_PATHS,
  RECEIPT_CANONICAL_MODULES,
  PLUGIN_ROOT,
  RUNTIME_MODULE_SPECIFIERS,
  isInside,
  jsonBytes,
  makeManifest,
  readRegularFile,
  readSourceState,
  sha256,
  validateRuntimeModuleExports,
  verifyAssets,
} from "./manifest.mjs";
import { validateReleaseLock } from "./release-lock.mjs";
import { syncChartSemantics } from "../../../../scripts/sync-chart-semantics.mjs";

const DEFAULT_OUTPUT = join(PLUGIN_ROOT, "assets/data-app-runtime");
const POSIX = (value) => value.split(sep).join("/");
const LICENSE_FILE = /^(?:licen[cs]e|copying|copyright|notice)(?:[._-].*)?$/iu;
// Inline charts, Sources receipts, and their shared controls keep the canonical
// Icon component, but cannot reach the remaining full-app icon assets.
export const INLINE_ICON_NAMES = Object.freeze([
  "arrowUpRight", "check", "chevronDown", "chevronLeft", "chevronRight", "copy",
  "cross", "database", "edit", "info", "link", "monitor", "more", "plus", "search", "undo",
]);
const INLINE_ICON_GLOB = `import.meta.glob("./icons/dashboard-icon-*.svg", {
  eager: true,
  import: "default",
  query: "?url",
})`;

// Charts retain their shared editor; receipts do not mount it. Neither target
// mounts the app shell or canvas. Prune only CSS families unreachable by each target.
export function inlineChartStyles(code, transformCss, { editor = false } = {}) {
  const appOnly = /^(?:typeahead(?:-|$)|filter-typeahead|filters$|comparison$|date-preset|block-resize|chart-pinned|notes$|dialog$|dashboard-(?:topbar|tabs|tab-|header-|schedule-|publish-|ask-|edit-|convert-|freshness-|save-|refresh-|verification|toast|chrome-)|topbar-mode-|theme-(?:drawer|card|preview|appearance)|chart-export-|chart-editor-|chart-explorer|explorer-|sortable-|block-drag-|data-(?:metric-|section|app-format-)|component-(?:loading-|skeleton|data-state|section-filter)|markdown-|report-|rich-|notes-|task-|history-|freshness-|date-calendar|date-range|metric-|dialog-|text-editor|editor-|filter-bar|filter-control|filter-chip|scenario-|showcase|smooth-card-surface|block-(?:add|menu)|dashboard-(?:root|shell|main|workspace|exploration-context))/u;
  const unused = new Set();
  const editorClass = /^(?:chart-editor-|chart-explorer|explorer-|dialog$|dialog-|editor-|history-)/u;
  const appStylesheets = new Set([
    "./components/executive-summary.css", "@openai/data-ui/controls/segmented-control.css",
    "@openai/data-ui/controls/slider.css", "@openai/data-ui/controls/switch.css", "@openai/data-ui/layout/section-navigator.css",
    "./components/chart-export.css", "./components/publish-review.css", "./components/data-app-loading.css",
  ]);
  if (editor) {
    appStylesheets.delete("@openai/data-ui/controls/segmented-control.css");
    appStylesheets.delete("@openai/data-ui/controls/switch.css");
  }
  const input = { filename: "styles.css", code: Buffer.from(code) };
  transformCss({ ...input, visitor: { Selector(parts) {
    walkAst(parts, part => {
      if (part.type === "class" && appOnly.test(part.name) && !(editor && editorClass.test(part.name))) unused.add(part.name);
    });
  } } });
  return transformCss({ ...input, minify: true, unusedSymbols: [...unused], visitor: {
    Rule: { import(rule) { if (appStylesheets.has(rule.value.url)) return []; } },
  } }).code.toString();
}

export function inlineIconAssetsPlugin(base) {
  const canonicalIcon = POSIX(join(base, "src/ui/primitives/Icon.jsx"));
  return {
    name: "data-inline-icon-assets",
    enforce: "pre",
    transform(code, id) {
      if (POSIX(id).split("?")[0] !== canonicalIcon) return null;
      assert.equal(code.split(INLINE_ICON_GLOB).length, 2,
        "Review the changed canonical Icon glob before rebuilding the inline icon inventory");
      return {
        code: code.replace(INLINE_ICON_GLOB, INLINE_ICON_GLOB.replace(
          '"./icons/dashboard-icon-*.svg"',
          JSON.stringify(INLINE_ICON_NAMES.map((name) => `./icons/dashboard-icon-${name}.svg`)),
        )),
        map: null,
      };
    },
  };
}

export function assertInlineIconInventory(chunk) {
  const names = normalizedModules(chunk).flatMap((name) => {
    const match = name.match(/\/ui\/primitives\/icons\/dashboard-icon-([^/]+)\.svg$/u);
    return match ? [match[1]] : [];
  });
  assert.deepEqual([...new Set(names)].sort(), [...INLINE_ICON_NAMES].sort(),
    "Inline runtime must contain exactly its reviewed reachable icon assets");
}

export async function assertReceiptFragmentCapacity(runtimeCode, { pluginRoot = PLUGIN_ROOT } = {}) {
  const [template, example, theme] = await Promise.all([
    readRegularFile(pluginRoot, "skills/visualize-data/assets/inline-sources-fragment.html"),
    readRegularFile(pluginRoot, "skills/visualize-data/assets/inline-sources-example.json"),
    loadInlineTheme("codex-classic", { pluginRoot }),
  ]);
  const input = JSON.parse(example);
  const query = input.items[0].queries[0];
  query.rows = Array.from({ length: 2_000 }, (_, index) => ({ week: "2026-08-03", activated: index, eligible: 2_000 }));
  return assembleInlineFragment({ normalized: normalizeInlineSourcesInput(input), theme, runtimeCode, template: template.toString("utf8") }).bytes;
}

// Compact targets omit app chrome; only charts retain editor controls. Keep all
// chart, annotation, source-inspector, and theme styles from the canonical sheet.
const INLINE_UNUSED_CSS = [
  "data-app-format-toolbar", "data-app-format-button", "data-app-format-style",
  "data-app-format-link", "data-app-format-menu", "data-app-format-heading-1", "data-app-format-shortcut",
  "dashboard-topbar", "dashboard-topbar-build-status", "dashboard-build-status-spin",
  "dashboard-tabs-collapse", "dashboard-tabs-collapse-inner", "dashboard-tabs-row",
  "dashboard-tabs-inner", "dashboard-tabs", "dashboard-tab", "dashboard-tab-item", "dashboard-tab-label",
  "dashboard-tab-drag-preview", "dashboard-ask-anchor", "dashboard-ask-panel", "dashboard-ask-view",
  "dashboard-ask-menu", "dashboard-ask-shared-prompt", "dashboard-ask-menu-prompt", "dashboard-ask-compose",
  "dashboard-ask-zero-state", "dashboard-ask-zero-state-copy", "dashboard-ask-discard", "dashboard-ask-submit",
  "dashboard-ask-submit-label", "dashboard-ask-primary", "dashboard-ask-selected-region",
  "dashboard-ask-selected-mark", "dashboard-ask-button", "dashboard-ask-trigger-morphing", "explorer-controls",
  // These closing animations belong to the app-only Ask composer, never an inline chart.
  "dashboard-ask-header-return-anchor", "dashboard-ask-header-unmorph",
  "publish-review-dialog", "publish-review-body", "publish-review-section", "publish-review-audience",
  "publish-review-option", "publish-review-option-detail", "publish-review-existing",
  "publish-review-permissions", "publish-review-facts",
  "publish-review-footer", "dashboard-publish-confirm",
  "data-app-handoff-dialog", "data-app-handoff-backdrop", "data-app-handoff-question", "data-app-handoff-choices",
  "data-app-handoff-remember", "data-app-handoff-footer",
  "topbar-mode-switcher", "topbar-mode-indicator", "topbar-mode-tooltip",
  "chart-editor-backdrop", "chart-editor-dialog", "chart-editor-history", "chart-editor-icon",
  "chart-editor-redo-icon", "chart-editor-save", "chart-editor-cancel", "chart-editor-reset",
  "sortable-region", "sortable-row-header", "sortable-item", "sortable-region--canvas", "sortable-canvas-row",
  "sortable-canvas-row--empty", "sortable-row-insertion-zone", "sortable-row-insertion-zone--last",
  "block-resize-boundary", "sortable-announcement",
];

function walkAst(value, visit) {
  if (!value || typeof value !== "object") return;
  if (typeof value.type === "string") visit(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => walkAst(item, visit));
    else if (child && typeof child === "object") walkAst(child, visit);
  }
}

export function assertNoExternalImports(code, parse, sourceType, name) {
  const ast = parse(code, { sourceType, ecmaVersion: "latest" });
  walkAst(ast, (node) => {
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ImportExpression" ||
      ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source) ||
      (node.type === "CallExpression" && node.callee?.type === "Identifier" && node.callee.name === "require")
    )
      throw new Error(`${name} contains an external module reference.`);
  });
  return ast;
}

export function singleChunk(result, name) {
  const output = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output ?? []);
  const chunks = output.filter((item) => item.type === "chunk");
  assert.equal(chunks.length, 1, `${name} must be exactly one JavaScript chunk`);
  assert.equal(output.filter((item) => item.type === "asset").length, 0, `${name} must not need external assets`);
  assert.deepEqual(chunks[0].imports, [], `${name} has external imports`);
  assert.deepEqual(chunks[0].dynamicImports, [], `${name} has dynamic imports`);
  return chunks[0];
}

function normalizedModules(chunk) {
  return Object.entries(chunk.modules ?? {})
    .filter(([, value]) => value.renderedLength !== 0)
    .map(([name]) => name.replaceAll("\\", "/").replace(/^\0/u, "").split("?")[0]);
}

export function assertDataFreeChunk(chunk, name, { receipt = false } = {}) {
  const modules = normalizedModules(chunk);
  assert.ok(
    !modules.some((file) => /\/src\/(?:data\.json|content\/)/u.test(file)),
    `${name} embeds authored data or content`,
  );
  if (receipt) {
    assert.ok(
      !modules.some((file) => /\/src\/(?:DataAppShell\.jsx|DataAppRuntime\.jsx|theme-runtime\.js)/u.test(file)),
      "Inline runtime embeds the full Data app or global theme runtime",
    );
    assert.ok(
      !modules.some((file) => /\/src\/components\/(?:DataAppChrome|DashboardTabs|RichMarkdown|RichTextFormatToolbar|PublishReviewDialog)\.jsx$/u.test(file)),
      "Inline CSS pruning requires unreachable app chrome",
    );
    if (receipt) assert.ok(
      !modules.some((file) => /\/src\/components\/(?:ChartEditor|ChartExplorer)\.jsx$/u.test(file)),
      "Receipt CSS pruning requires unreachable chart editor controls",
    );
    const ask = Object.entries(chunk.modules ?? {})
      .find(([file]) => file.replaceAll("\\", "/").endsWith("/src/components/DashboardAsk.jsx"))?.[1];
    assert.ok(!ask?.renderedLength || (Array.isArray(ask.renderedExports)
      && ask.renderedExports.every((name) => name === "useDashboardAsk")),
    "Inline Ask CSS pruning requires only the inert context hook");
    const sortable = Object.entries(chunk.modules ?? {})
      .find(([file]) => file.replaceAll("\\", "/").endsWith("/output_formats/html/src/ui/layout/SortableRegion.jsx"))?.[1];
    assert.ok(!sortable?.renderedLength || (Array.isArray(sortable.renderedExports)
      && sortable.renderedExports.every((name) => name === "useOptionalSortableBlock")),
    "Inline layout CSS pruning requires unreachable sortable controls");
    for (const name of RECEIPT_CANONICAL_MODULES) {
      assert.ok(
        Object.keys(chunk.modules).some((file) => file.replaceAll("\\", "/").endsWith(`/${name}`)),
        `Inline runtime is missing its canonical module: ${name}`,
      );
    }
  }
}

/** Inspect only publisher-built, data-free code; customers consume the verified inventory. */
export function captureAppMetadata(code) {
  const context = {
    document: {
      createElement() {
        return {};
      },
    },
  };
  new Script(code, { filename: "app.js" }).runInNewContext(context, { timeout: 10_000 });
  const runtime = context.CodexDataAppRuntime;
  assert.equal(runtime?.apiVersion, API_VERSION, "App runtime has the wrong browser API version");
  assert.equal(typeof runtime.mount, "function", "App runtime does not expose mount");
  assert.ok(
    runtime.modules && typeof runtime.modules === "object" && Object.isFrozen(runtime.modules),
    "App runtime must expose a frozen module registry",
  );
  assert.deepEqual(
    Object.getOwnPropertyNames(runtime.modules).sort(),
    RUNTIME_MODULE_SPECIFIERS,
    "App runtime exposes unexpected module specifiers",
  );
  const moduleExports = Object.fromEntries(
    RUNTIME_MODULE_SPECIFIERS.map((specifier) => {
      const module = runtime.modules[specifier];
      assert.ok(
        module && ["object", "function"].includes(typeof module) && Object.isFrozen(module),
        `App runtime module must be a frozen namespace: ${specifier}`,
      );
      return [specifier, Object.getOwnPropertyNames(module).sort()];
    }),
  );
  return { moduleExports: validateRuntimeModuleExports(moduleExports) };
}

async function releaseMetadata(pluginRoot) {
  const readJson = async (name) => JSON.parse(await readRegularFile(pluginRoot, name));
  const [sourcePackage, sourceLock, packageJson, lock] = await Promise.all([
    readJson("output_formats/html/templates/package.json"),
    readJson("output_formats/html/templates/package-lock.json"),
    readJson("output_formats/html/scripts/prebuilt/package.json"),
    readJson("output_formats/html/scripts/prebuilt/package-lock.json"),
  ]);
  validateReleaseLock(sourcePackage, sourceLock, packageJson, lock);
  return { sourcePackage, sourceLock, packageJson, lock };
}

async function loadReleaseTools(dependencies, pluginRoot) {
  dependencies = await realpath(resolve(dependencies));
  const metadata = await releaseMetadata(pluginRoot);
  for (const filename of ["package.json", "package-lock.json"]) {
    assert.deepEqual(
      await readFile(join(dependencies, filename)),
      await readRegularFile(pluginRoot, `output_formats/html/scripts/prebuilt/${filename}`),
      `Publisher workspace has a different frozen ${filename}`,
    );
  }
  const require = createRequire(join(dependencies, "package.json"));
  const installedLock = JSON.parse(await readFile(join(dependencies, "node_modules/.package-lock.json"), "utf8"));
  for (const [name, expected] of Object.entries(metadata.packageJson.dependencies)) {
    const installed = JSON.parse(await readFile(join(dependencies, "node_modules", name, "package.json"), "utf8"));
    assert.equal(installed.version, expected, `Publisher dependency drift: ${name}`);
    assert.equal(
      installedLock.packages?.[`node_modules/${name}`]?.integrity,
      metadata.lock.packages[`node_modules/${name}`].integrity,
      `Publisher dependency integrity drift: ${name}`,
    );
  }
  const { rolldown } = await import(pathToFileURL(require.resolve("rolldown")).href);
  return { dependencies, pluginRoot, require, rolldown, installedLock, ...metadata };
}

async function prepareReleaseWorkspace(pluginRoot, { offline = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "data-prebuilt-release-"));
  try {
    for (const filename of ["package.json", "package-lock.json"]) {
      await writeFile(join(directory, filename), await readRegularFile(pluginRoot, `output_formats/html/scripts/prebuilt/${filename}`));
    }
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(
      npm,
      [
        "ci",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--include=dev",
        "--include=optional",
        "--install-strategy=hoisted",
        "--workspaces=false",
        ...(offline ? ["--offline"] : []),
      ],
      { cwd: directory, stdio: "inherit", shell: process.platform === "win32" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Release-only npm ci failed (${result.status}).`);
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function rollupChunk(tools, input, output) {
  const bundle = await tools.rolldown({
    input,
    platform: "neutral",
    resolve: { mainFields: ["module", "main"] },
    external: () => false,
    treeshake: true,
    onwarn(warning) {
      if (warning.code === "UNRESOLVED_IMPORT") throw new Error(warning.message);
    },
  });
  try {
    return singleChunk(
      await bundle.generate({ codeSplitting: false, comments: { legal: true }, ...output }),
      basename(input),
    );
  } finally {
    await bundle.close();
  }
}

export function loadStandaloneCompiler(code) {
  const module = { exports: {} };
  const deniedRequire = (name) => {
    throw new Error(`Standalone compiler tried to load ${name}.`);
  };
  const factory = new Script(`(function(module,exports,require){\n${code}\n})`, {
    filename: "compiler.cjs",
  }).runInThisContext();
  factory(module, module.exports, deniedRequire);
  const compiler = module.exports;
  assert.equal(compiler.apiVersion, API_VERSION);
  for (const name of [
    "rollup",
    "transform",
    "parseJavaScript",
    "parseCss",
    "walkCss",
    "generateCss",
    "decodeCssIdentifier",
  ]) {
    assert.equal(typeof compiler[name], "function", `Compiler is missing ${name}`);
  }
  const transformed = compiler.transform("export const view = <span>{value as number}</span>;", {
    filePath: "proof.tsx",
  });
  new Script(`(function(module,exports,require){${transformed}\n})`);
  compiler.parseJavaScript(compiler.transform("export const view = <span />;", { commonjs: false }));
  const css = compiler.parseCss(":root{--color:var(--other,#fff)}");
  assert.match(compiler.generateCss(css), /--color/u);
  assert.equal(compiler.decodeCssIdentifier("u\\72 l"), "url");
  assertNoExternalImports(code, compiler.parseJavaScript, "script", "compiler.cjs");
  return compiler;
}

async function assertStandaloneLinker(compiler) {
  const sources = {
    "\0entry": "export { value, bump } from 'counter';",
    counter: "export let value = 1; export function bump(){ value += 1; }",
  };
  const bundle = await compiler.rollup({
    input: "\0entry",
    plugins: [
      {
        name: "closed-release-smoke",
        resolveId(id) {
          if (!Object.hasOwn(sources, id)) throw new Error(`Standalone linker attempted to load ${id}.`);
          return id;
        },
        load(id) {
          return sources[id];
        },
      },
    ],
  });
  try {
    const chunk = singleChunk(
      await bundle.generate({ format: "iife", name: "ReleaseProof", exports: "named" }),
      "standalone linker",
    );
    assertNoExternalImports(chunk.code, compiler.parseJavaScript, "script", "standalone linker output");
    const context = {};
    new Script(chunk.code).runInNewContext(context);
    assert.equal(context.ReleaseProof.value, 1);
    context.ReleaseProof.bump();
    assert.equal(context.ReleaseProof.value, 2);
  } finally {
    await bundle.close();
  }
}

async function buildCompiler(tools, snapshotRoot) {
  const chunk = await rollupChunk(tools, join(snapshotRoot, "output_formats/html/scripts/prebuilt/compiler-entry.mjs"), {
    format: "cjs",
    minify: true,
  });
  const compiler = loadStandaloneCompiler(chunk.code);
  await assertStandaloneLinker(compiler);
  return { code: chunk.code, chunk, compiler };
}

async function buildBrowserRuntime(tools, snapshotRoot, { receipt = false } = {}) {
  const { build } = await import(pathToFileURL(tools.require.resolve("vite")).href);
  const base = join(snapshotRoot, "output_formats/html");
  const compact = receipt;
  const entry = receipt ? join(snapshotRoot, "skills/visualize-data/src/inline/sources.jsx")
    : join(base, "src/prebuilt-runtime-entry.jsx");
  const name = receipt ? "CodexDataSourcesReceipt" : "CodexDataAppRuntime";
  const unusedSymbols = INLINE_UNUSED_CSS;
  const result = await build({
    root: base,
    configFile: false,
    cacheDir: join(snapshotRoot, ".vite"),
    logLevel: "silent",
    plugins: compact ? [inlineIconAssetsPlugin(base), {
      name: "data-inline-styles", enforce: "pre",
      transform(code, id) {
        if (["styles.css", "styles-foundation.css"].some((file) => POSIX(id).split("?")[0] === POSIX(join(base, `src/${file}`))))
          return { code: inlineChartStyles(code, tools.require("lightningcss").transform, { editor: false }), map: null };
        return null;
      },
    }] : [],
    ...(compact ? { css: { lightningcss: { unusedSymbols } } } : {}),
    define: { "process.env.NODE_ENV": JSON.stringify("production"), __DATA_APP_PROJECT_ROOT__: JSON.stringify(""),
      __DATA_SOURCE_RECEIPTS__: "true",
      __DATA_INLINE_CHART__: "false",
 },
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: [
        { find: "@openai/data-ui", replacement: join(snapshotRoot, "output_formats/html/src/ui") },
        { find: "@openai/data-app-runtime", replacement: join(base, "src") },
        { find: /^@openai\/data-charts\/chart\.css$/u, replacement: join(snapshotRoot, "skills/visualize-data/src/tools/dashboard.css") },
        { find: /^@openai\/data-charts$/u, replacement: join(snapshotRoot, "skills/visualize-data/src/adapters/artifact/index.jsx") },
        { find: "@openai/data-chart-pin", replacement: join(snapshotRoot, "skills/visualize-data/assets/cdn.json") },
        { find: /^react$/u, replacement: tools.require.resolve("react") },
        { find: /^react\/jsx-runtime$/u, replacement: tools.require.resolve("react/jsx-runtime") },
        { find: /^react\/jsx-dev-runtime$/u, replacement: tools.require.resolve("react/jsx-dev-runtime") },
        { find: /^react-dom$/u, replacement: tools.require.resolve("react-dom") },
        { find: /^react-dom\/client$/u, replacement: tools.require.resolve("react-dom/client") },
      ],
    },
    build: {
      write: false,
      target: "chrome120",
      minify: true,
      cssMinify: "lightningcss",
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      lib: { entry, name, formats: ["iife"], fileName: () => (receipt ? "receipt.js" : "app.js") },
    },
  });
  const chunk = singleChunk(result, name);
  assertDataFreeChunk(chunk, name, { receipt });
  if (compact) assertInlineIconInventory(chunk);
  return chunk;
}

// The standalone HTML shell follows the released production implementation.
// Inline Sources retains alpha-11's reviewed implementation. Isolate that small
// shared dependency set only inside the disposable build snapshot so CSS imports
// and JavaScript imports both see the same unchanged receipt inputs.
export async function withInlineSourceParity(snapshotRoot, operation) {
  const prefix = "output_formats/html/scripts/prebuilt/inline-source-parity";
  const manifest = JSON.parse(await readRegularFile(snapshotRoot, `${prefix}/manifest.json`));
  const originals = [];
  try {
    for (const [name, expected] of Object.entries(manifest.files)) {
      const source = await readRegularFile(snapshotRoot, `${prefix}/${name}`);
      assert.equal(sha256(source), expected, `Changed retained inline source: ${name}`);
      const target = `output_formats/html/${name}`;
      originals.push([target, await readRegularFile(snapshotRoot, target)]);
      await writeFile(join(snapshotRoot, target), source);
    }
    return await operation();
  } finally {
    for (const [name, source] of originals) await writeFile(join(snapshotRoot, name), source);
  }
}

async function buildWorker(tools, snapshotRoot, compiler) {
  const chunk = await rollupChunk(tools, join(snapshotRoot, "output_formats/html/src/data-app-worker.js"), {
    format: "es",
    minify: { compress: false, mangle: false, codegen: true },
  });
  assertDataFreeChunk(chunk, "worker.mjs");
  const ast = assertNoExternalImports(chunk.code, compiler.parseJavaScript, "module", "worker.mjs");
  assert.ok(
    !ast.body.some((node) => node.type === "ExportDefaultDeclaration"),
    "Worker factory must not have a default export",
  );
  assert.ok(
    ast.body.some((node) => {
      const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
      return declaration?.type === "FunctionDeclaration" && declaration.id?.name === "createDataAppWorker";
    }),
    "Worker factory must preserve the local createDataAppWorker binding",
  );
  const config = JSON.stringify({
    html: "<main>offline worker proof</main>",
    seedSnapshot: {},
    initialPresentation: {},
  });
  const combined = `${chunk.code}\nexport default createDataAppWorker(${config});\n`;
  const module = await import(`data:text/javascript;base64,${Buffer.from(combined).toString("base64")}`);
  assert.equal(typeof module.createDataAppWorker, "function");
  assert.equal(typeof module.validatePresentation, "function");
  assert.equal(
    await (await module.default.fetch(new Request("https://example.test/"), {})).text(),
    "<main>offline worker proof</main>",
  );
  return chunk;
}

async function minifyProtectedCss(tools, snapshotRoot, ...names) {
  const { bundleAsync, transform } = tools.require("lightningcss");
  const sourceRoot = join(snapshotRoot, "output_formats/html/src");
  const chartRoot = join(snapshotRoot, "skills/visualize-data");
  const uiRoot = join(snapshotRoot, "output_formats/html/src/ui");
  const chartIcon = await readFile(join(chartRoot, "src/core/info-icon.svg"));
  const iconUrl = `data:image/svg+xml;base64,${chartIcon.toString("base64")}`;
  const entry = join(sourceRoot, ".prebuilt-styles.css");
  const input = (await Promise.all(names.map(name => readFile(join(sourceRoot, name), "utf8")))).join("\n");
  const bundled = await bundleAsync({
    filename: entry, minify: true, errorRecovery: false, targets: { chrome: 120 << 16 },
    resolver: {
      read: async file => {
        const content = file === entry ? input : (await readRegularFile(snapshotRoot, POSIX(relative(snapshotRoot, file)))).toString("utf8");
        return file.endsWith("/skills/visualize-data/src/core/chart.css")
          ? content.replace('url("./info-icon.svg")', `url("${iconUrl}")`) : content;
      },
      resolve(specifier, from) {
        if (specifier === "@openai/data-charts/chart.css") return join(snapshotRoot, "skills/visualize-data/src/tools/dashboard.css");
        const uiImport = specifier.startsWith("@openai/data-ui/");
        const file = uiImport ? resolve(uiRoot, specifier.slice("@openai/data-ui/".length)) : resolve(dirname(from), specifier);
        assert.ok((uiImport || specifier.startsWith(".")) && (isInside(sourceRoot, file) || isInside(chartRoot, file) || isInside(join(snapshotRoot, "skills/visualize-data/src/tools"), file) || isInside(uiRoot, file)) && file.endsWith(".css"),
          "Protected CSS imports must stay inside the canonical source tree");
        return file;
      },
    },
  });
  const result = transform({ filename: names[0], code: bundled.code, minify: true,
    errorRecovery: false, analyzeDependencies: true, targets: { chrome: 120 << 16 } });
  assert.ok(result.dependencies.every(item => item.type === "url" && item.url === iconUrl),
    `${names.join(", ")} must not fetch external resources`);
  // Dependency analysis replaces URLs with placeholders; retain the already minified literal CSS.
  return bundled.code.toString();
}

async function packageLicenseFiles(directory) {
  const files = [];
  async function visit(prefix = "") {
    const entries = await readdir(join(directory, prefix), { withFileTypes: true });
    for (const entry of entries) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Distributed package contains a symlink: ${name}`);
      if (entry.isDirectory() && entry.name !== "node_modules") await visit(name);
      else if (entry.isFile() && LICENSE_FILE.test(entry.name)) files.push(name);
    }
  }
  await visit();
  return files.sort();
}

export async function collectThirdPartyNotices(chunks, tools) {
  const dependencies = await realpath(tools.dependencies);
  const pluginRoot = tools.pluginRoot ?? PLUGIN_ROOT;
  const overrides = JSON.parse(await readRegularFile(pluginRoot, "output_formats/html/scripts/prebuilt/license-overrides.json"));
  const packagePaths = new Set();
  for (const chunk of chunks) {
    for (const modulePath of normalizedModules(chunk)) {
      if (!modulePath.includes("/node_modules/")) continue;
      const match = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/u.exec(modulePath);
      if (!match) throw new Error(`Cannot identify distributed dependency: ${modulePath}`);
      const packageRoot = await realpath(match[1]);
      if (!isInside(join(dependencies, "node_modules"), packageRoot)) {
        throw new Error(`Release build loaded a dependency outside its frozen workspace: ${modulePath}`);
      }
      packagePaths.add(POSIX(relative(dependencies, packageRoot)));
    }
  }
  const notices = [
    "Data app prebuilt runtime — third-party notices",
    "",
    "These packages contribute code to the distributed runtime or local compiler.",
    "",
  ];
  const packages = [];
  for (const packagePath of [...packagePaths].sort()) {
    const directory = join(dependencies, packagePath);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const locked = tools.lock.packages[packagePath];
    if (
      !locked?.integrity ||
      locked.version !== manifest.version ||
      tools.installedLock.packages?.[packagePath]?.integrity !== locked.integrity
    ) {
      throw new Error(`Distributed dependency differs from the frozen lock: ${packagePath}`);
    }
    const files = await packageLicenseFiles(directory);
    const override = overrides[`${manifest.name}@${manifest.version}`];
    let extraLicense;
    if (override) {
      if (
        override.packageIntegrity !== locked.integrity ||
        !override.path?.startsWith("licenses/") ||
        !/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f\d]{40}\//u.test(override.source ?? "")
      )
        throw new Error(`Invalid pinned upstream license for ${manifest.name}@${manifest.version}`);
      extraLicense = await readRegularFile(pluginRoot, `output_formats/html/scripts/prebuilt/${override.path}`);
      if (sha256(extraLicense) !== override.sha256)
        throw new Error(`Pinned upstream license changed: ${override.path}`);
    }
    if (!files.length && !extraLicense)
      throw new Error(`Distributed dependency lacks a license/notice file: ${manifest.name}@${manifest.version}`);
    notices.push(
      "=".repeat(72),
      `${manifest.name}@${manifest.version}`,
      `License: ${
        typeof manifest.license === "string" ? manifest.license : JSON.stringify(manifest.license ?? "see below")
      }`,
    );
    for (const filename of files)
      notices.push("", `--- ${filename} ---`, (await readFile(join(directory, filename), "utf8")).trimEnd());
    if (extraLicense)
      notices.push("", `--- Upstream license: ${override.source} ---`, extraLicense.toString("utf8").trimEnd());
    notices.push("");
    packages.push({
      name: manifest.name,
      version: manifest.version,
      integrity: locked.integrity,
      licenseFiles: [...files, ...(extraLicense ? [`upstream:${override.path}`] : [])],
    });
  }
  return { text: `${notices.join("\n")}\n`, packages };
}

async function copySnapshot(state, destination) {
  for (const [name, bytes] of state.files) {
    const target = join(destination, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

async function writeArtifacts(outputDir, artifacts, manifest) {
  await mkdir(outputDir, { recursive: true });
  const staging = await mkdtemp(join(outputDir, ".build-"));
  try {
    for (const [name, filename] of Object.entries(ARTIFACT_PATHS))
      await writeFile(join(staging, filename), artifacts[name]);
    await writeFile(join(staging, "manifest.json"), jsonBytes(manifest));
    for (const filename of [...Object.values(ARTIFACT_PATHS), "manifest.json"])
      await rename(join(staging, filename), join(outputDir, filename));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function buildPrebuiltAssets({
  pluginRoot = PLUGIN_ROOT,
  dependencies,
  outputDir = DEFAULT_OUTPUT,
  compilerOnly = false,
  check = false,
  offline = false,
} = {}) {
  pluginRoot = resolve(pluginRoot);
  outputDir = resolve(outputDir);
  // Fail before dependency preparation: published app semantics must match core.
  if (!compilerOnly) await syncChartSemantics({ pluginRoot, check: true });
  const createdDependencies = !dependencies;
  if (!dependencies) dependencies = await prepareReleaseWorkspace(pluginRoot, { offline });
  let scratch;
  try {
    const tools = await loadReleaseTools(dependencies, pluginRoot);
    scratch = await mkdtemp(join(tools.dependencies, ".data-prebuilt-"));
    const snapshotRoot = join(scratch, "plugin");
    if (compilerOnly) {
      const target = join(snapshotRoot, "output_formats/html/scripts/prebuilt/compiler-entry.mjs");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readRegularFile(pluginRoot, "output_formats/html/scripts/prebuilt/compiler-entry.mjs"));
      const built = await buildCompiler(tools, snapshotRoot);
      await mkdir(outputDir, { recursive: true });
      const output = join(outputDir, ARTIFACT_PATHS.compiler);
      if (check)
        assert.deepEqual(await readFile(output), Buffer.from(built.code), "Standalone compiler rebuild differs");
      else await writeFile(output, built.code);
      return { compiler: { path: output, bytes: Buffer.byteLength(built.code), sha256: sha256(built.code) } };
    }
    const state = await readSourceState(pluginRoot);
    await copySnapshot(state, snapshotRoot);
    const builtCompiler = await buildCompiler(tools, snapshotRoot);
    const app = await buildBrowserRuntime(tools, snapshotRoot);
    const receipt = await withInlineSourceParity(snapshotRoot,
      () => buildBrowserRuntime(tools, snapshotRoot, { receipt: true }));
    assertNoExternalImports(app.code, builtCompiler.compiler.parseJavaScript, "script", "app.js");
    const safeReceipt = makeReplacementSafe(receipt.code, (code) =>
      builtCompiler.compiler.parseJavaScript(code, { sourceType: "script" }));
    const receiptCode = safeReceipt.code.replace(/<\/script/giu, "<\\/script");
    new Script(receiptCode);
    assertReplacementSafe(receiptCode);
    assertNoExternalImports(receiptCode, builtCompiler.compiler.parseJavaScript, "script", "receipt.js");
    const receiptCapacity = await assertReceiptFragmentCapacity(receiptCode, { pluginRoot: snapshotRoot });
    const worker = await buildWorker(tools, snapshotRoot, builtCompiler.compiler);
    const notices = await collectThirdPartyNotices([app, receipt, worker, builtCompiler.chunk], {
      ...tools,
      pluginRoot: snapshotRoot,
    });
    const artifacts = {
      app: app.code,
      styles: await minifyProtectedCss(tools, snapshotRoot, "data-app-styles.css", "theme-picker.css", "source-preview.css"),
      print: await minifyProtectedCss(tools, snapshotRoot, "print.css"),
      receipt: receiptCode,
      worker: worker.code,
      compiler: builtCompiler.code,
      notices: notices.text,
    };
    const after = await readSourceState(pluginRoot);
    assert.ok(
      isDeepStrictEqual(after.buildInputs, state.buildInputs),
      "Prebuilt inputs changed during the release build; retry",
    );
    const manifest = makeManifest(state, artifacts, {
      appMetadata: captureAppMetadata(app.code),
      receiptMetadata: {
        canonicalModules: [...RECEIPT_CANONICAL_MODULES],
        externalImports: receipt.imports,
        dynamicImports: receipt.dynamicImports,
        encodedTokens: safeReceipt.encodedTokens,
      },
    });
    if (check) {
      const current = await verifyAssets({ pluginRoot, assetDir: outputDir });
      assert.deepEqual(current, manifest, "Deterministic prebuilt rebuild differs from shipped assets");
    } else {
      await writeArtifacts(outputDir, artifacts, manifest);
      await verifyAssets({ pluginRoot, assetDir: outputDir });
    }
    return { manifest, distributedPackages: notices.packages, receiptCapacity };
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    if (createdDependencies) await rm(dependencies, { recursive: true, force: true });
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--compiler-only") options.compilerOnly = true;
    else if (flag === "--check") options.check = true;
    else if (flag === "--offline") options.offline = true;
    else if (["--dependencies", "--output-dir", "--plugin-root"].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      options[{ "--dependencies": "dependencies", "--output-dir": "outputDir", "--plugin-root": "pluginRoot" }[flag]] =
        value;
    } else throw new Error(`Unknown release-build option: ${flag}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildPrebuiltAssets(parseArgs(process.argv.slice(2)));
  const summary = result.manifest
    ? {
        source: result.manifest.source,
        artifacts: result.manifest.artifacts,
        distributedPackageCount: result.distributedPackages.length,
      }
    : result;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
