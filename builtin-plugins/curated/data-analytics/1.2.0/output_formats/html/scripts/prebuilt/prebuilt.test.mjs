import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import test from "node:test";
import { Script } from "node:vm";

import {
  assertDataFreeChunk,
  assertReceiptFragmentCapacity,
  assertInlineIconInventory,
  assertNoExternalImports,
  captureAppMetadata,
  collectThirdPartyNotices,
  loadStandaloneCompiler,
  INLINE_ICON_NAMES,
  inlineIconAssetsPlugin,
  singleChunk,
} from "./build.mjs";
import { assembleInlineFragment, loadInlineTheme } from "../../../../skills/visualize-data/scripts/runtime/fragment-output.mjs";
import { MAX_INLINE_FRAGMENT_BYTES } from "../../../../skills/visualize-data/scripts/runtime/sources-common.mjs";
import { normalizeInlineSourcesInput } from "../../../../skills/visualize-data/scripts/runtime/inline-sources-input.mjs";
import { UI_COMPONENT_GROUPS } from "../ui-components.mjs";
import {
  ARTIFACT_PATHS,
  RECEIPT_CANONICAL_MODULES,
  PLUGIN_ROOT,
  RELEASE_INPUTS,
  RUNTIME_MODULE_SPECIFIERS,
  jsonBytes,
  makeManifest,
  readRegularFile,
  readSourceState,
  sha256,
  validateRelativePath,
  validateRuntimeModuleExports,
  verifyAssets,
} from "./manifest.mjs";
import {
  releasePackage,
  seedReleaseLock,
  validateDependencyClosure,
  validateReleaseLock,
  withoutResolvedUrls,
} from "./release-lock.mjs";

const readJson = async (name) => JSON.parse(await readFile(join(PLUGIN_ROOT, name), "utf8"));
const compilerBytes = await readFile(join(PLUGIN_ROOT, "assets/data-app-runtime/compiler.cjs"), "utf8");
const compiler = loadStandaloneCompiler(compilerBytes);
const fixtureAppMetadata = () => ({
  moduleExports: Object.fromEntries(
    RUNTIME_MODULE_SPECIFIERS.map((name) => [name, ["__esModule", "default", "fixture"]]),
  ),
});

test("inline icon projection changes only the expected canonical glob and fails closed on drift", async () => {
  const base = join(PLUGIN_ROOT, "output_formats/html");
  const canonicalPath = join(PLUGIN_ROOT, "output_formats/html/src/ui/primitives/Icon.jsx");
  const source = await readFile(canonicalPath, "utf8");
  const plugin = inlineIconAssetsPlugin(base);
  assert.equal(plugin.enforce, "pre");
  assert.equal(plugin.transform(source, join(base, "src/content/Icon.jsx")), null);
  assert.equal(plugin.transform(source, join(PLUGIN_ROOT, "output_formats/html/src/ui/primitives/OtherIcon.jsx")), null);
  const transformed = plugin.transform(source, canonicalPath);
  const paths = JSON.parse(transformed.code.match(/import\.meta\.glob\((\[[^\n]+\])/u)[1]);
  assert.deepEqual(paths, INLINE_ICON_NAMES.map((name) => `./icons/dashboard-icon-${name}.svg`));
  assert.equal(transformed.code.replace(JSON.stringify(paths), '"./icons/dashboard-icon-*.svg"'), source);
  assert.equal(await readFile(canonicalPath, "utf8"), source, "full-app source stays unchanged");
  assert.throws(() => plugin.transform(source.replace('query: "?url"', 'query: "?raw"'), canonicalPath), /canonical Icon glob/u);
  assert.throws(() => plugin.transform(`${source}\n${source}`, canonicalPath), /canonical Icon glob/u);
});

test("inline icon inventory checks the actual rendered module assets", () => {
  const modules = Object.fromEntries(INLINE_ICON_NAMES.map((name) => [
    `/snapshot/output_formats/html/src/ui/primitives/icons/dashboard-icon-${name}.svg?url`, { renderedLength: 100 },
  ]));
  assertInlineIconInventory({ modules });
  assertInlineIconInventory({ modules: { ...modules,
    "/snapshot/output_formats/html/src/ui/primitives/icons/dashboard-icon-theme.svg?url": { renderedLength: 0 },
  } });
  assert.throws(() => assertInlineIconInventory({ modules: { ...modules,
    "/snapshot/output_formats/html/src/ui/primitives/icons/dashboard-icon-theme.svg?url": { renderedLength: 100 },
  } }), /reviewed reachable icon assets/u);
  const missing = { ...modules };
  delete missing[Object.keys(missing)[0]];
  assert.throws(() => assertInlineIconInventory({ modules: missing }), /reviewed reachable icon assets/u);
});

test("shipped receipt leaves capacity for 2000 preview rows without the chart runtime", async () => {
  const code = await readFile(join(PLUGIN_ROOT, "assets/data-app-runtime/receipt.js"), "utf8");
  assert.ok(await assertReceiptFragmentCapacity(code) < MAX_INLINE_FRAGMENT_BYTES);
  assertNoExternalImports(code, compiler.parseJavaScript, "script", "receipt.js");
});

test("Sources fragment assembly enforces the complete UTF-8 payload limit", async () => {
  const template = await readFile(join(PLUGIN_ROOT, "skills/visualize-data/assets/inline-sources-fragment.html"), "utf8");
  const theme = await loadInlineTheme("codex-classic", { pluginRoot: PLUGIN_ROOT });
  const normalized = normalizeInlineSourcesInput(await readJson("skills/visualize-data/assets/inline-sources-example.json"));
  const options = { normalized, theme, template, runtimeCode: "" };
  const empty = assembleInlineFragment(options);
  const runtimeCode = " ".repeat(MAX_INLINE_FRAGMENT_BYTES - empty.bytes);
  const exact = assembleInlineFragment({ ...options, runtimeCode });
  assert.equal(exact.bytes, 1_000_000);
  assert.equal(Buffer.byteLength(exact.fragment), exact.bytes);
  assert.throws(() => assembleInlineFragment({ ...options, runtimeCode: runtimeCode + "é" }), /1000002 bytes \(limit 1000000\)/u);
});

test("app export inventory is captured from the actual frozen browser runtime", async () => {
  const code = await readFile(join(PLUGIN_ROOT, "assets/data-app-runtime/app.js"), "utf8");
  const actual = captureAppMetadata(code);
  const manifest = await readJson("assets/data-app-runtime/manifest.json");
  assert.deepEqual(manifest.artifacts.app.metadata, actual);
  assert.deepEqual(Object.keys(actual.moduleExports), RUNTIME_MODULE_SPECIFIERS);
  assert.ok(Object.isFrozen(RUNTIME_MODULE_SPECIFIERS));
  assert.ok(Object.isFrozen(actual.moduleExports));
  assert.ok(actual.moduleExports.react.includes("useState"));
  assert.ok(!actual.moduleExports.react.includes("useSttae"));
  assert.ok(actual.moduleExports["@openai/data-app"].includes("ChartRenderer"));
  assert.ok(actual.moduleExports["react/jsx-dev-runtime"].includes("jsxDEV"));
  for (const names of Object.values(actual.moduleExports)) {
    assert.ok(names.includes("default"));
    assert.ok(names.includes("__esModule"));
    assert.ok(Object.isFrozen(names));
  }
});

test("shipped Worker accepts hourly schedules without retaining daily restrictions", async () => {
  const { validatePresentation } = await import("../../../../assets/data-app-runtime/worker.mjs");
  for (const schedule of [
    { frequency: "hourly" },
    { frequency: "hourly", time: "09:00", days: ["MO", "WE"] },
  ]) {
    assert.deepEqual(validatePresentation({ refreshSchedule: schedule }), {
      refreshSchedule: { frequency: "hourly" },
    });
  }
  assert.throws(() => validatePresentation({ refreshSchedule: { frequency: "daily" } }),
    /Refresh schedule must include/);
});

test("release app capture includes nonenumerable own exports and rejects a wrong runtime API", () => {
  const source = `
    const namespace={default:1,fixture:2};
    Object.defineProperty(namespace,"__esModule",{value:true});
    Object.freeze(namespace);
    var CodexDataAppRuntime={apiVersion:1,mount(){},modules:Object.freeze(Object.fromEntries(
      ${JSON.stringify(RUNTIME_MODULE_SPECIFIERS)}.map(name=>[name,namespace])
    ))};
  `;
  assert.deepEqual(captureAppMetadata(source), fixtureAppMetadata());
  assert.throws(() => captureAppMetadata(source.replace("apiVersion:1", "apiVersion:2")), /API version/);
  assert.throws(
    () => captureAppMetadata("var CodexDataAppRuntime={apiVersion:1,mount(){},modules:{}}"),
    /frozen module registry/,
  );
  const invalid = fixtureAppMetadata().moduleExports;
  invalid.react = ["default", "__esModule"];
  assert.throws(() => validateRuntimeModuleExports(invalid), /unsorted/);
});

test("release package keeps the canonical app dependency identities and exact small compiler pins", async () => {
  const [sourcePackage, sourceLock, packageJson, lock] = await Promise.all([
    readJson("output_formats/html/templates/package.json"),
    readJson("output_formats/html/templates/package-lock.json"),
    readJson("output_formats/html/scripts/prebuilt/package.json"),
    readJson("output_formats/html/scripts/prebuilt/package-lock.json"),
  ]);
  validateReleaseLock(sourcePackage, sourceLock, packageJson, lock);
  assert.deepEqual(releasePackage(sourcePackage, sourceLock), packageJson);
  assert.equal(packageJson.dependencies.react, sourceLock.packages["node_modules/react"].version);
  assert.equal(packageJson.dependencies["@rollup/browser"], "3.30.0");
  assert.equal(
    lock.packages["node_modules/@rollup/browser"].integrity,
    "sha512-4nRvRGMjGXUBgAwW71QTbBiQBnsVZWpEXS9ExBXTippMxk2tTXNPQTnZCBqrqZIaiifD9KrNPkLfjgHm+8UbfQ==",
  );
  assert.equal(packageJson.dependencies.sucrase, "3.35.1");
  assert.equal(packageJson.dependencies.acorn, "8.17.0");
  assert.equal(packageJson.dependencies["css-tree"], "3.1.0");
  assert.equal(packageJson.dependencies["mdn-data"], "2.12.2");
  assert.equal(packageJson.dependencies["source-map-js"], "1.2.1");
  assert.equal(packageJson.dependencies.terser, "5.37.0");
  assert.equal(sourcePackage.dependencies?.terser, undefined);
  assert.equal(sourcePackage.devDependencies?.terser, undefined);
  assert.ok(Object.values(lock.packages).every((entry) => !("resolved" in entry)));
  assert.equal(validateDependencyClosure(lock).size, Object.keys(lock.packages).length);
  const changed = structuredClone(lock);
  changed.packages["node_modules/react"].integrity = "sha512-incorrect";
  assert.throws(() => validateReleaseLock(sourcePackage, sourceLock, packageJson, changed), /drifted/);
  const missing = structuredClone(lock);
  delete missing.packages["node_modules/sucrase"];
  assert.throws(() => validateReleaseLock(sourcePackage, sourceLock, packageJson, missing), /must lock/);
  const url = structuredClone(lock);
  url.packages["node_modules/react"].resolved = "https://example.invalid/react.tgz";
  assert.throws(() => validateReleaseLock(sourcePackage, sourceLock, packageJson, url), /registry URL/);
  const extra = structuredClone(lock);
  extra.packages["node_modules/unrelated"] = { version: "1.0.0", integrity: "sha512-extra" };
  assert.throws(() => validateReleaseLock(sourcePackage, sourceLock, packageJson, extra), /Extraneous package/);
});

test("refresh seeds existing canonical packages without mutating either input", async () => {
  const [sourcePackage, sourceLock, previous] = await Promise.all([
    readJson("output_formats/html/templates/package.json"),
    readJson("output_formats/html/templates/package-lock.json"),
    readJson("output_formats/html/scripts/prebuilt/package-lock.json"),
  ]);
  const before = structuredClone(sourceLock);
  const old = structuredClone(previous);
  const packageJson = releasePackage(sourcePackage, sourceLock);
  const seeded = seedReleaseLock(sourceLock, packageJson, previous);
  assert.deepEqual(sourceLock, before);
  assert.deepEqual(previous, old);
  assert.deepEqual(
    seeded.packages["node_modules/react"],
    withoutResolvedUrls(sourceLock).packages["node_modules/react"],
  );
  assert.equal(seeded.packages["node_modules/sucrase"].version, "3.35.1");
  assert.deepEqual(seeded.packages[""].dependencies, packageJson.dependencies);
});

test("upstream license supplements are bound to immutable sources and exact package tarballs", async () => {
  const lock = await readJson("output_formats/html/scripts/prebuilt/package-lock.json");
  const overrides = await readJson("output_formats/html/scripts/prebuilt/license-overrides.json");
  for (const [identity, entry] of Object.entries(overrides)) {
    const separator = identity.lastIndexOf("@");
    const name = identity.slice(0, separator);
    const version = identity.slice(separator + 1);
    const locked = lock.packages[`node_modules/${name}`];
    assert.equal(locked.version, version);
    assert.equal(locked.integrity, entry.packageIntegrity);
    assert.match(entry.source, /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f\d]{40}\//u);
    assert.equal(sha256(await readRegularFile(PLUGIN_ROOT, `output_formats/html/scripts/prebuilt/${entry.path}`)), entry.sha256);
  }
});

test("standalone compiler preserves editable TSX, ESM imports, CJS live bindings, and dynamic imports", async () => {
  const inputs = {
    "./counter.ts": "export let count: number = 1; export function bump(){ count += 1; }",
    "./lazy.ts": "export default 42;",
    "./main.tsx":
      "import React from 'react'; import {count,bump} from './counter.ts'; export {count} from './counter.ts'; export enum Kind { Plain, Rich }; export default function View({name}:{name:string}){bump();return <span data-count={count}>{name}</span>}; export const load=()=>import('./lazy.ts');",
  };
  const modules = new Map();
  for (const [filename, source] of Object.entries(inputs)) {
    const esm = compiler.transform(source, { filePath: filename, commonjs: false });
    compiler.parseJavaScript(esm, { sourceType: "module", locations: true });
    modules.set(filename, { code: compiler.transform(source, { filePath: filename }), module: null });
  }
  const jsx = (type, props) => ({ type, props });
  function load(name) {
    if (name === "react") return { createElement: jsx };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    const record = modules.get(name);
    if (!record) throw new Error(`Unexpected dependency ${name}`);
    if (record.module) return record.module.exports;
    const module = { exports: {} };
    record.module = module;
    new Script(`(function(module,exports,require){${record.code}\n})`).runInNewContext()(module, module.exports, load);
    return module.exports;
  }
  const main = load("./main.tsx");
  assert.equal(main.count, 1);
  const view = main.default({ name: "offline" });
  assert.equal(view.props.children, "offline");
  assert.equal(view.props["data-count"], 2);
  assert.equal(main.count, 2);
  assert.equal(main.Kind.Rich, 1);
  assert.equal((await main.load()).default, 42);
  assert.equal(
    compiler.parseJavaScript("let answer=42", { sourceType: "script", ecmaVersion: 2020, locations: true }).body[0].loc
      .start.line,
    1,
  );
});

async function linkFixture(modules, entry = "/main.tsx") {
  const prefix = "\0data:";
  const resolveId = (source, importer) => {
    if (source.startsWith(prefix)) {
      assert.ok(Object.hasOwn(modules, source.slice(prefix.length)), "Unknown virtual entry");
      return source;
    }
    const from = importer?.slice(prefix.length);
    const name = source.startsWith(".") ? posix.resolve(posix.dirname(from), source) : source;
    if (!Object.hasOwn(modules, name)) throw new Error(`Closed graph rejected ${source}`);
    return `${prefix}${name}`;
  };
  const bundle = await compiler.rollup({
    input: `${prefix}${entry}`,
    onwarn(warning) {
      if (warning.code === "UNRESOLVED_IMPORT") throw new Error(warning.message);
    },
    plugins: [
      {
        name: "closed-test-graph",
        resolveId,
        resolveDynamicImport(source, importer) {
          if (typeof source !== "string") throw new Error("Computed dynamic import is unsupported");
          return resolveId(source, importer);
        },
        load(id) {
          const name = id.slice(prefix.length);
          if (!Object.hasOwn(modules, name)) throw new Error("Unknown virtual module");
          return compiler.transform(modules[name], { filePath: name, commonjs: false });
        },
      },
    ],
  });
  try {
    const chunk = singleChunk(
      await bundle.generate({
        format: "iife",
        name: "DataAuthored",
        exports: "named",
        inlineDynamicImports: true,
        compact: true,
        sourcemap: false,
      }),
      "test authored graph",
    );
    assertNoExternalImports(chunk.code, compiler.parseJavaScript, "script", "test authored output");
    return chunk.code;
  } finally {
    await bundle.close();
  }
}

test("portable ESM linker preserves live reexports and cycles without a handwritten CommonJS linker", async () => {
  const graph = {
    "/a.ts":
      "import {readB} from './b.ts'; export let value:number=1; export function bump(){value+=1;} export function across(){return readB();}",
    "/b.ts": "import {value} from './a.ts'; export function readB(){return value;}",
    "/barrel.ts": "export * from './a.ts';",
    "/lazy.ts": "export {value as default} from './a.ts';",
    "react/jsx-runtime": "export const jsx=(type,props)=>({type,props}); export const jsxs=jsx;",
    "/main.tsx":
      "import {value} from './barrel.ts'; export {value,bump,across} from './barrel.ts'; export const View=()=> <span>{value}</span>; export const load=()=>import('./lazy.ts');",
  };
  const context = {};
  new Script(await linkFixture(graph)).runInNewContext(context);
  const app = context.DataAuthored;
  assert.equal(app.value, 1);
  assert.equal(app.across(), 1);
  app.bump();
  assert.equal(app.value, 2);
  assert.equal(app.across(), 2);
  assert.equal(app.View().props.children, 2);
  assert.equal((await app.load()).default, 2);
  const tdz = await linkFixture({
    "/main.tsx": "export {a} from './a.js';",
    "/a.js": "import {b} from './b.js';export const a=b;",
    "/b.js": "import {a} from './a.js';export const b=a;",
  });
  assert.throws(() => new Script(tdz).runInNewContext({}), /before initialization/iu);
});

test("portable ESM linker rejects missing/ambiguous exports and nonclosed imports", async () => {
  await assert.rejects(
    linkFixture({
      "/main.tsx": "import {missing} from './other.js';export {missing};",
      "/other.js": "export const present=1;",
    }),
    /not exported|missing/iu,
  );
  await assert.rejects(
    linkFixture({
      "/main.tsx": "import {same} from './barrel.js';export {same};",
      "/barrel.js": "export * from './one.js';export * from './two.js';",
      "/one.js": "export const same=1;",
      "/two.js": "export const same=2;",
    }),
    /not exported|conflicting|same/iu,
  );
  await assert.rejects(
    linkFixture({ "/main.tsx": "export const load=(name)=>import(name);" }),
    /Computed dynamic import/iu,
  );
  await assert.rejects(
    linkFixture({ "/main.tsx": "import value from 'https://example.invalid/code.js';export {value};" }),
    /Closed graph rejected/iu,
  );
});

test("single-file dynamic import explicitly uses eager bundled-module evaluation", async () => {
  const context = { events: [] };
  new Script(
    await linkFixture({
      "/main.tsx": "export const load=()=>import('./lazy.js');",
      "/lazy.js": "globalThis.events.push('evaluated');export const value=42;",
    }),
  ).runInNewContext(context);
  assert.deepEqual(context.events, ["evaluated"]);
  assert.equal((await context.DataAuthored.load()).value, 42);
  assert.deepEqual(context.events, ["evaluated"]);
});

test("small CSS parser exposes real escaped identifiers and nested custom-property functions", () => {
  const ast = compiler.parseCss(
    String.raw`:root{--asset:var(--fallback,i\6d age-set("https://example.invalid/a"));--color:#fff}`,
  );
  const functions = [];
  compiler.walkCss(ast, (node) => {
    if (node.type === "Function") functions.push(compiler.decodeCssIdentifier(node.name).toLowerCase());
  });
  assert.deepEqual(functions, ["var", "image-set"]);
  assert.equal(compiler.decodeCssIdentifier(String.raw`u\72 l`), "url");
  assert.match(compiler.generateCss(ast), /--color:#fff/u);
  assert.throws(() =>
    compiler.parseCss(":root{--x:(}", {
      onParseError(error) {
        throw error;
      },
    }),
  );
});

test("standalone checks reject every external module form", () => {
  const parse = compiler.parseJavaScript;
  for (const source of [
    "import x from 'x'",
    "export {x} from 'x'",
    "export * from 'x'",
    "import('x')",
    "require('x')",
  ]) {
    assert.throws(() => assertNoExternalImports(source, parse, "module", "fixture"), /external module reference/);
  }
  assertNoExternalImports("export const value=1", parse, "module", "fixture");
  assert.throws(() => singleChunk({ output: [{ type: "asset" }] }, "fixture"), /one JavaScript chunk/);
  assert.throws(
    () => singleChunk({ output: [{ type: "chunk", imports: ["react"], dynamicImports: [] }] }, "fixture"),
    /external imports/,
  );
  assert.throws(
    () => assertDataFreeChunk({ modules: { "/fixture/src/data.json": { renderedLength: 1 } } }, "app"),
    /authored data/,
  );
  assert.throws(
    () => assertDataFreeChunk({ modules: { "/fixture/src/content/View.jsx": { renderedLength: 1 } } }, "app"),
    /authored data/,
  );
  const canonical = Object.fromEntries(RECEIPT_CANONICAL_MODULES
    .map((name) => [`/fixture/${name}`, { renderedLength: 1, renderedExports: [] }]));
  const inline = (name, renderedExports) => ({ modules: { ...canonical,
    [`/fixture/${name === "SortableRegion" ? "output_formats/html/src/ui/layout" : "src/components"}/${name}.jsx`]: { renderedLength: 1, renderedExports } } });
  assertDataFreeChunk(inline("DashboardAsk", ["useDashboardAsk"]), "inline", { receipt: true });
  assertDataFreeChunk(inline("SortableRegion", ["useOptionalSortableBlock"]), "inline", { receipt: true });
  assert.throws(() => assertDataFreeChunk(inline("DashboardAsk", ["DashboardAskProvider"]), "inline", { receipt: true }),
    /Inline Ask CSS pruning/u);
  assert.throws(() => assertDataFreeChunk(inline("SortableRegion", ["SortableRegion"]), "inline", { receipt: true }),
    /Inline layout CSS pruning/u);
  for (const name of ["DataAppChrome", "DashboardTabs", "RichMarkdown", "RichTextFormatToolbar", "PublishReviewDialog"]) {
    assert.throws(() => assertDataFreeChunk(inline(name, [name]), "inline", { receipt: true }),
      /Inline CSS pruning/u);
  }
  const receipt = Object.fromEntries(RECEIPT_CANONICAL_MODULES
    .map((name) => [`/fixture/${name}`, { renderedLength: 1, renderedExports: [] }]));
  assertDataFreeChunk({ modules: receipt }, "receipt", { receipt: true });
  for (const name of ["ChartEditor", "ChartExplorer"]) {
    assert.throws(() => assertDataFreeChunk({ modules: { ...receipt,
      [`/fixture/src/components/${name}.jsx`]: { renderedLength: 1, renderedExports: [name] },
    } }, "receipt", { receipt: true }), /Receipt CSS pruning/u);
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "data-prebuilt-manifest-test-"));
  const put = async (name, content) => {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  };
  for (const name of RELEASE_INPUTS) await put(name, await readFile(join(PLUGIN_ROOT, name)));
  for (const name of ["skills/visualize-data/src/tools", "skills/visualize-data/docs/charts", "skills/visualize-data/docs/react", "output_formats/html/docs/components",
    "output_formats/html/scripts/prebuilt/inline-source-parity",
    ...UI_COMPONENT_GROUPS.map((group) => `output_formats/html/src/ui/${group}`),
        ...["ChartRenderer.jsx", "core", "families", "adapters"].map(name => `skills/visualize-data/src/${name}`)])
    await cp(join(PLUGIN_ROOT, name), join(root, name), {
      recursive: true,
      filter: (path) => !path.split(/[\\/]/u).includes("node_modules"),
    });
  for (const entry of Object.values(await readJson("output_formats/html/scripts/prebuilt/license-overrides.json"))) {
    const name = `output_formats/html/scripts/prebuilt/${entry.path}`;
    await put(name, await readFile(join(PLUGIN_ROOT, name)));
  }
  const base = "output_formats/html";
  const protectedFiles = {};
  for (const name of ["package.json", "package-lock.json"]) {
    const bytes = await readFile(join(PLUGIN_ROOT, base, "templates", name));
    await put(`${base}/templates/${name}`, bytes);
    protectedFiles[name] = sha256(bytes);
  }
  for (const name of ["src/prebuilt-runtime-entry.jsx", "src/data-app-worker.js", "src/styles.css", "src/data-app-styles.css", "src/print.css"]) {
    const bytes = Buffer.from(`fixture ${name}\n`);
    await put(`${base}/${name}`, bytes);
    protectedFiles[name] = sha256(bytes);
  }
  await put(`${base}/templates/protected-runtime.json`, jsonBytes({ version: 1, files: protectedFiles }));
  await put("skills/visualize-data/src/inline/index.jsx", "export const fixture=1;\n");
  await put("skills/visualize-data/src/inline/inline.css", ":host{display:block}\n");
  return { root, put };
}

test("manifest fingerprints all build inputs and rejects stale source or changed assets", async () => {
  const { root, put } = await fixture();
  try {
    const state = await readSourceState(root);
    assert.deepEqual(Object.keys(state.buildInputs), Object.keys(state.buildInputs).sort());
    assert.equal(state.source.buildInputsSha256, sha256(JSON.stringify(state.buildInputs)));
    assert.ok(state.buildInputs["output_formats/html/scripts/prebuilt/compiler-entry.mjs"]);
    assert.ok(state.buildInputs["output_formats/html/src/data-app-worker.js"]);
    assert.ok(state.buildInputs["skills/visualize-data/scripts/runtime/replacement-safe-javascript.mjs"]);
    const artifacts = Object.fromEntries(Object.keys(ARTIFACT_PATHS).map((name) => [name, Buffer.from(name)]));
    const receiptMetadata = {
      canonicalModules: [...RECEIPT_CANONICAL_MODULES],
      externalImports: [],
      dynamicImports: [],
      encodedTokens: 3,
    };
    const appMetadata = fixtureAppMetadata();
    const manifest = makeManifest(state, artifacts, { appMetadata, receiptMetadata });
    assert.deepEqual(manifest.artifacts.app.metadata, appMetadata);
    assert.deepEqual(manifest.artifacts.receipt.metadata, receiptMetadata);
    assert.throws(() => makeManifest(state, artifacts, { receiptMetadata }), /app runtime metadata/);
    assert.throws(
      () =>
        makeManifest(state, artifacts, {
          appMetadata,
          receiptMetadata: { ...receiptMetadata, externalImports: ["react"] },
        }),
      /inline runtime diagnostics/,
    );
    for (const [name, filename] of Object.entries(ARTIFACT_PATHS))
      await put(`assets/data-app-runtime/${filename}`, artifacts[name]);
    await put("assets/data-app-runtime/manifest.json", jsonBytes(manifest));
    assert.deepEqual(await verifyAssets({ pluginRoot: root }), manifest);
    await put("assets/data-app-runtime/app.js", "changed");
    await assert.rejects(verifyAssets({ pluginRoot: root }), /artifact integrity/);
    await put("assets/data-app-runtime/app.js", artifacts.app);
    await put("skills/visualize-data/src/inline/inline.css", ":host{display:grid}\n");
    await assert.rejects(verifyAssets({ pluginRoot: root }), /stale/);
    await put("skills/visualize-data/src/inline/inline.css", ":host{display:block}\n");
    const protectedStyle = "output_formats/html/src/styles.css";
    await put(protectedStyle, "protected source drift");
    await assert.rejects(verifyAssets({ pluginRoot: root }), /protected runtime is stale/);
    await put(protectedStyle, state.files.get(protectedStyle));
    for (const path of ["output_formats/html/src/ui/controls/Dropdown.jsx", "skills/visualize-data/docs/react/app-charts.md",
      "output_formats/html/scripts/prebuilt/inline-source-parity/src/components/SourceInspector.jsx"]) {
      await put(path, "shared component source drift");
      await assert.rejects(verifyAssets({ pluginRoot: root }), /stale/);
      await put(path, state.files.get(path));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source and artifact paths reject traversal and symlinks", async (t) => {
  for (const name of ["", "/absolute", "C:/absolute", "../outside", "a/../b", "a//b", "a\\b", "a\0b", "a\nb"]) {
    assert.throws(() => validateRelativePath(name), /Invalid prebuilt source path/);
  }
  const root = await mkdtemp(join(tmpdir(), "data-prebuilt-path-test-"));
  try {
    await writeFile(join(root, "real"), "safe");
    try {
      await symlink(join(root, "real"), join(root, "link"));
      await assert.rejects(readRegularFile(root, "link"), /nonsymlinked/);
    } catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
      t.diagnostic("Windows did not permit creation of the test symlink.");
    }
    assert.equal((await readRegularFile(root, "real")).toString(), "safe");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("third-party notices are sorted, complete, and tied to the installed frozen lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "data-prebuilt-license-test-"));
  try {
    const directory = join(root, "node_modules", "fixture");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "package.json"), jsonBytes({ name: "fixture", version: "1.0.0", license: "MIT" }));
    await writeFile(join(directory, "index.js"), "export const value=1");
    await writeFile(join(directory, "LICENSE"), "fixture license\n");
    const lock = { packages: { "node_modules/fixture": { version: "1.0.0", integrity: "sha512-fixture" } } };
    const tools = { dependencies: root, lock, installedLock: lock };
    const chunks = [{ modules: { [join(directory, "index.js")]: { renderedLength: 1 } } }];
    const result = await collectThirdPartyNotices(chunks, tools);
    assert.match(result.text, /fixture@1\.0\.0/u);
    assert.match(result.text, /fixture license/u);
    assert.deepEqual(result.packages[0].licenseFiles, ["LICENSE"]);
    await assert.rejects(
      collectThirdPartyNotices(chunks, { ...tools, installedLock: { packages: {} } }),
      /differs from the frozen lock/,
    );
    await rm(join(directory, "LICENSE"));
    await assert.rejects(collectThirdPartyNotices(chunks, tools), /lacks a license/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
