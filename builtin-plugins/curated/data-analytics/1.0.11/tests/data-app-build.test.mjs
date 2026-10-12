import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createContext, Script } from "node:vm";

import { assembleDataAppHtml, embeddedScript, embeddedStyle, localDataThreadId, projectLocalDataThreadId } from "../scripts/data-app-build.mjs";
import { dataNodeEnvironment } from "../scripts/data-app-runtime.mjs";
import { readSeparateDataBundle } from "../scripts/data-app-separate.mjs";
import { RELEASE_INPUTS, sha256 } from "../scripts/prebuilt/manifest.mjs";

const PLUGIN_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const BASE = "templates/data-app/base";
const ASSETS = "assets/data-app-runtime";
const PACKAGER = "skills/publish-artifact-to-sites/scripts/package-data-app-for-sites.mjs";
const RUNTIME_HASH = "a".repeat(64);
const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";
const THREAD_ID = "550e8400-e29b-41d4-a716-446655440001";
const SNAPSHOT_ID = "data-app-reviewed-snapshot";
const JAVASCRIPT_URL = "data:text/javascript;charset=utf-8;base64,";
const CSS_URL = "data:text/css;charset=utf-8;base64,";

function input(overrides = {}) {
  return {
    appCode: `globalThis.execution = ["runtime"];
globalThis.CodexDataAppRuntime = {
  apiVersion: 1,
  mount(options) {
    const content = options.createContent?.(options.reviewedSnapshot) ?? {};
    globalThis.captured = {...options, ...content}; execution.push("mount");
  }
};`,
    protectedStyles: ".protected{color:blue}",
    printStyles: "@media print{.printed{color:black}}",
    authored: {
      themeCss: ":root{--accent:red}",
      conventionalCss: ".conventional{color:green}",
      importedCss: ".imported{color:purple}",
      factorySource: `(function(runtime, snapshot) {
  execution.push("factory");
  globalThis.factorySnapshot = snapshot;
  return {
    DashboardContent() { return snapshot.title; },
    ReportContent() { return snapshot.queries; }
  };
})`,
    },
    snapshotBytes: Buffer.from('{\n  "title": "Reviewed fixture",\n  "queries": {}\n}\n'),
    runtimeSha256: RUNTIME_HASH,
    ...overrides,
  };
}

// This reads only the assembler's fixed output shape. It is deliberately not a
// general HTML parser: hazardous script/style source must already be a data URL.
function scriptElements(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)].map(([, attributes, body]) => {
    const type = /\btype="([^"]*)"/iu.exec(attributes)?.[1] ?? "";
    const src = /\bsrc="([^"]*)"/iu.exec(attributes)?.[1];
    let code = body;
    if (src !== undefined) {
      assert.ok(src.startsWith(JAVASCRIPT_URL), `Unexpected script URL: ${src.slice(0, 80)}`);
      assert.equal(body, "");
      code = Buffer.from(src.slice(JAVASCRIPT_URL.length), "base64").toString("utf8");
    }
    return { attributes, type, src, code };
  });
}

function executeHtml(html) {
  const elements = scriptElements(html);
  const documents = elements.filter(({ type }) => type === "application/json");
  assert.equal(documents.length, 1);
  const context = createContext({
    document: {
      getElementById(id) {
        assert.equal(id, SNAPSHOT_ID);
        return { textContent: documents[0].code };
      },
    },
  });
  for (const element of elements.filter(({ type }) => type !== "application/json")) {
    assert.equal(element.type, "", "The assembler must emit classic, ordered scripts.");
    assert.doesNotMatch(element.attributes, /\b(?:async|defer)\b/iu);
    new Script(element.code).runInContext(context, { timeout: 1000 });
  }
  return { context, elements, snapshotText: documents[0].code };
}

function styleSource(html) {
  const inline = /<style>([\s\S]*?)<\/style>/iu.exec(html);
  if (inline) return inline[1];
  const href = /<link rel="stylesheet" href="([^"]*)">/u.exec(html)?.[1];
  assert.ok(href?.startsWith(CSS_URL), "Expected one embedded stylesheet.");
  return Buffer.from(href.slice(CSS_URL.length), "base64").toString("utf8");
}

function marker(html, name) {
  const prefix = `<meta name="${name}" content="`;
  const matches = html.split(prefix);
  assert.equal(matches.length, 2, `Expected precisely one ${name} marker.`);
  return matches[1].split('">', 1)[0];
}

test("assembler binds the exact reviewed bytes and runtime to one ordered document", () => {
  const options = input({ localThreadId: SESSION_ID });
  const { html, snapshotSha256 } = assembleDataAppHtml(options);
  const pluginManifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".codex-plugin/plugin.json"), "utf8"));
  const icon = readFileSync(join(PLUGIN_ROOT, pluginManifest.interface.composerIcon)).toString("base64");
  assert.match(html, new RegExp(`<link rel="icon" type="image/svg\\+xml" href="data:image/svg\\+xml;base64,${icon}">`));
  assert.equal(snapshotSha256, sha256(options.snapshotBytes));
  assert.equal(marker(html, "data-app-snapshot-sha256"), snapshotSha256);
  assert.equal(marker(html, "data-app-runtime-sha256"), RUNTIME_HASH);
  assert.equal(marker(html, "data-app-local-thread"), SESSION_ID);
  assert.equal(
    styleSource(html),
    [
      options.authored.themeCss,
      options.protectedStyles,
      options.authored.conventionalCss,
      options.printStyles,
      options.authored.importedCss,
    ].join("\n"),
  );
  const { context, elements } = executeHtml(html);
  assert.equal(elements.length, 3);
  assert.deepEqual(Array.from(context.execution), ["runtime", "factory", "mount"]);
  assert.equal(context.factorySnapshot, context.captured.reviewedSnapshot);
  assert.equal(context.captured.DashboardContent(), "Reviewed fixture");
  assert.equal(context.captured.ReportContent(), context.captured.reviewedSnapshot.queries);

  const compact = assembleDataAppHtml(
    input({ snapshotBytes: Buffer.from(JSON.stringify(JSON.parse(options.snapshotBytes))) }),
  );
  assert.notEqual(
    compact.snapshotSha256,
    snapshotSha256,
    "Whitespace changes must invalidate the reviewed-byte marker.",
  );
  assert.doesNotMatch(compact.html, /data-app-local-thread|data-app-local-reference/u);
  assert.doesNotMatch(compact.html, /(?:file:\/\/|\/Users\/|[A-Z]:\\)/u);
});

test("hosted bootstrap defers module data capture until the complete snapshot is supplied", () => {
  const options = input({
    appCode: `globalThis.execution=[]; globalThis.CodexDataAppRuntime={apiVersion:1,
      mount(options){globalThis.captured=options;}};`,
  });
  const { html } = assembleDataAppHtml(options);
  assert.equal(marker(html, "data-app-bootstrap"), "deferred-content-v1");
  const { context } = executeHtml(html);
  assert.equal(context.factorySnapshot, undefined);
  const fullSnapshot = { title: "Complete hosted rows", queries: { q: { rows: [{ value: 42 }] } } };
  const content = context.captured.createContent(fullSnapshot);
  assert.equal(context.factorySnapshot, fullSnapshot);
  assert.equal(content.DashboardContent(), fullSnapshot.title);
  assert.equal(content.ReportContent().q.rows[0].value, 42);
});

test("explicit source entry loads starter CSS before traversing authored component imports", () => {
  const source = readFileSync(join(PLUGIN_ROOT, BASE, "src/main.jsx"), "utf8");
  const imports = [
    'import "./theme.css";',
    'import "./styles.css";',
    'import "./content/dashboard/dashboard.css";',
    'import "./content/report/report.css";',
    'import "./print.css";',
    'import "./theme-runtime.js";',
    'import { App } from "./App.jsx";',
  ];
  let previous = -1;
  for (const declaration of imports) {
    const position = source.indexOf(declaration);
    assert.ok(position > previous, `${declaration} must follow the preceding stylesheet/runtime imports.`);
    previous = position;
  }
});

test("assembler keeps __proto__, HTML closing tags, and Unicode separators as inert JSON", () => {
  const snapshot = JSON.parse('{"queries":{},"__proto__":{"polluted":true}}');
  const row = JSON.parse('{"__proto__":{"rowPolluted":true}}');
  row.text = "</script><script>globalThis.injected = true</script><!--\u2028\u2029";
  snapshot.queries.reviewed = { rows: [row] };
  snapshot.title = "</title><script>globalThis.injected = true</script>&\"'";
  const bytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`);
  const { html } = assembleDataAppHtml(input({ snapshotBytes: bytes }));
  const { context, snapshotText } = executeHtml(html);
  assert.doesNotMatch(snapshotText, /[<\u2028\u2029]/u);
  assert.match(snapshotText, /\\u003c\/script>/u);
  assert.match(snapshotText, /\\u2028\\u2029/u);
  assert.deepEqual(JSON.parse(snapshotText), snapshot);
  assert.equal(context.injected, undefined);
  assert.equal(Object.hasOwn(context.captured.reviewedSnapshot, "__proto__"), true);
  assert.equal(context.captured.reviewedSnapshot.__proto__.polluted, true);
  assert.equal(Object.hasOwn(context.captured.reviewedSnapshot.queries.reviewed.rows[0], "__proto__"), true);
  assert.equal(
    new Script("Object.getPrototypeOf(captured.reviewedSnapshot) === Object.prototype").runInContext(context),
    true,
  );
  assert.equal(new Script("Object.prototype.polluted").runInContext(context), undefined);
  assert.equal(marker(html, "data-app-snapshot-sha256"), sha256(bytes));
});

test("assembler HTML-escapes titles and supplies the empty-title fallback", () => {
  const title = "&<>\"' reviewed";
  const { html } = assembleDataAppHtml(input({ snapshotBytes: Buffer.from(JSON.stringify({ title, queries: {} })) }));
  assert.match(html, /<title>&amp;&lt;&gt;&quot;&#39; reviewed<\/title>/u);
  const fallback = assembleDataAppHtml(input({ snapshotBytes: Buffer.from('{"title":"","queries":{}}') }));
  assert.match(fallback.html, /<title>Data app<\/title>/u);
});

test("assembler accepts a UTF-8 BOM while hashing the original snapshot bytes", () => {
  const json = Buffer.from('{"title":"BOM fixture","queries":{}}\n');
  const snapshotBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), json]);
  const { html, snapshotSha256 } = assembleDataAppHtml(input({ snapshotBytes }));
  assert.equal(snapshotSha256, sha256(snapshotBytes));
  assert.notEqual(snapshotSha256, sha256(json));
  assert.equal(marker(html, "data-app-snapshot-sha256"), snapshotSha256);
  const { context, snapshotText } = executeHtml(html);
  assert.equal(snapshotText.startsWith("\ufeff"), false);
  assert.equal(context.captured.reviewedSnapshot.title, "BOM fixture");
});

test("assembler rejects invalid snapshot bytes, shapes, integrity markers, and task IDs", () => {
  for (const snapshotBytes of [
    Buffer.from([0x7b, 0xc3, 0x28, 0x7d]),
    Buffer.from("not JSON"),
    ...[null, [], {}, { queries: null }, { queries: [] }].map((value) => Buffer.from(JSON.stringify(value))),
  ]) {
    assert.throws(() => assembleDataAppHtml(input({ snapshotBytes })), /valid UTF-8 JSON|reviewed query snapshot/u);
  }
  for (const runtimeSha256 of [undefined, "", "a".repeat(63), "G".repeat(64)]) {
    assert.throws(() => assembleDataAppHtml(input({ runtimeSha256 })), /verified runtime hash/u);
  }
  assert.throws(
    () => assembleDataAppHtml(input({ localThreadId: `${SESSION_ID}\"` })),
    /Invalid local Data app task identifier/u,
  );
  assert.throws(() => embeddedScript("export const unsupported = true;"), SyntaxError);
  assert.throws(
    () => assembleDataAppHtml(input({ authored: { ...input().authored, factorySource: "(function(){" } })),
    SyntaxError,
  );
});

test("assembler preserves script bytes and semantics through HTML-tokenizer hazards", () => {
  const cases = [
    ["ordinary Unicode", 'globalThis.value = "π🙂\u2028\u2029";', false],
    ["closing tag", 'globalThis.value = "</ScRiPt><script>not executed</script>";', true],
    ["comment opener", 'globalThis.value = "<!--";', true],
    ["tagged raw template", "globalThis.value = String.raw`</script>\\n\\u{1f642}`;", true],
    ["regular expression", "globalThis.value = /<script[ >]/giu.source;", true],
    ["NUL", 'globalThis.value = "before\0after";', true],
    ["CRLF", "globalThis.value = `before\r\nafter`;", true],
    ["Unicode plus hazard", 'globalThis.value = "☕️🙂\u2028\u2029</script>";', true],
  ];
  for (const [name, source, encoded] of cases) {
    const html = embeddedScript(source);
    const elements = scriptElements(html);
    assert.equal(elements.length, 1, name);
    assert.equal(Boolean(elements[0].src), encoded, name);
    assert.deepEqual(Buffer.from(elements[0].code), Buffer.from(source), `${name}: exact UTF-8 bytes`);
    assert.doesNotMatch(elements[0].attributes, /\b(?:async|defer|type)\b/iu, name);
    const expected = createContext({});
    const actual = createContext({});
    new Script(source).runInContext(expected, { timeout: 1000 });
    new Script(elements[0].code).runInContext(actual, { timeout: 1000 });
    assert.equal(actual.value, expected.value, `${name}: JavaScript semantics`);
  }
});

test("assembler keeps data-URL runtime and authored bootstrap scripts in classic order", () => {
  const options = input();
  options.appCode = `globalThis.runtimeHazard = "</script>";\n${options.appCode}`;
  options.authored.factorySource = `(function(runtime, snapshot) {
    execution.push("factory");
    globalThis.rawValue = String.raw\`<script>\\n\`;
    return {DashboardContent() {return snapshot.title;}, ReportContent() {return null;}};
  })`;
  const { html } = assembleDataAppHtml(options);
  const { context, elements } = executeHtml(html);
  const executable = elements.filter(({ type }) => type !== "application/json");
  assert.equal(executable.length, 2);
  assert.ok(executable.every(({ src }) => src?.startsWith(JAVASCRIPT_URL)));
  assert.equal(executable[0].code, options.appCode);
  assert.equal(context.runtimeHazard, "</script>");
  assert.equal(context.rawValue, "<script>\\n");
  assert.deepEqual(Array.from(context.execution), ["runtime", "factory", "mount"]);
});

test("assembler embeds CSS end tags, NUL, and CR without rewriting stylesheet bytes", () => {
  const safe = ".safe{color:red}";
  assert.equal(embeddedStyle(safe), `<style>${safe}</style>`);
  for (const css of [
    '.fixture::after{content:"</StYlE><script>not executed</script>"}',
    ".fixture{--value:before\0after}",
    ".fixture{\r\ncolor:red}",
  ]) {
    const html = embeddedStyle(css);
    assert.match(html, /^<link rel="stylesheet" href="data:text\/css;charset=utf-8;base64,[A-Za-z\d+/=]+">$/u);
    assert.doesNotMatch(html, /<style|<script/iu);
    assert.deepEqual(Buffer.from(styleSource(html)), Buffer.from(css));
  }
});

test("assembler selects a valid session ID before a valid thread ID", () => {
  assert.equal(localDataThreadId({ CODEX_SESSION_ID: SESSION_ID, CODEX_THREAD_ID: THREAD_ID }), SESSION_ID);
  assert.equal(localDataThreadId({ CODEX_SESSION_ID: "not-a-uuid", CODEX_THREAD_ID: THREAD_ID }), THREAD_ID);
  assert.equal(localDataThreadId({ CODEX_SESSION_ID: ` ${SESSION_ID}`, CODEX_THREAD_ID: THREAD_ID }), THREAD_ID);
  assert.equal(localDataThreadId({ CODEX_SESSION_ID: SESSION_ID.toUpperCase() }), SESSION_ID.toUpperCase());
  assert.equal(localDataThreadId({ CODEX_SESSION_ID: "", CODEX_THREAD_ID: "invalid" }), "");
  assert.equal(localDataThreadId({}), "");
});

test("local origin recovery ignores ambiguous metadata and marker-like document content", async (t) => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "data-app-local-origin-")));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const original = `<meta name="data-app-local-thread" content="${SESSION_ID}">`;
  for (const [head, body, expected] of [
    [original, "", SESSION_ID],
    [`<meta name="data-app-local-thread" content="invalid">${original}`, "", THREAD_ID],
    [`<!-- ${original} --><script>${JSON.stringify(original)}</script>`, original, THREAD_ID],
    [`<!-- ${original} -->${original}`, "", SESSION_ID],
  ]) {
    write(join(project, "dist/index.html"), `<html><head>${head}</head><body>${body}</body></html>`);
    assert.equal(await projectLocalDataThreadId(project, { CODEX_SESSION_ID: THREAD_ID }), expected);
  }
});

test("local origin recovery skips large raw-text payloads and still checks the whole head for duplicates", async (t) => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "data-app-large-local-origin-")));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const original = `<meta name="data-app-local-thread" content="${SESSION_ID}">`;
  const decoy = `<meta name="data-app-local-thread" content="${THREAD_ID}">`;
  const large = "x".repeat(15 * 1024 * 1024);
  for (const [name, html, expected] of [
    ["large body script", `<head>${original}</head><body><script>${large}${decoy}</script></body>`, SESSION_ID],
    ["large mixed-case head script", `<head><ScRiPt data-example=">">${decoy}${large}</scripture>${decoy}</sCrIpT>${original}</head>`, SESSION_ID],
    ["late duplicate after large head style", `<head>${original}<style>${large}${decoy}</style>${original}</head>`, THREAD_ID],
    ["large head style preserves the original", `<head>${original}<style>${large}${decoy}</style></head>`, SESSION_ID],
  ]) {
    write(join(project, "dist/index.html"), html);
    assert.equal(await projectLocalDataThreadId(project, { CODEX_SESSION_ID: THREAD_ID }), expected, name);
  }
});

test("local origin recovery respects quoted tags and fails closed on incomplete raw text or head markup", async (t) => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "data-app-local-origin-boundaries-")));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const original = `<meta name="data-app-local-thread" content="${SESSION_ID}">`;
  const decoy = `<meta name="data-app-local-thread" content="${THREAD_ID}">`;
  for (const name of ["script", "style", "title", "textarea"]) {
    write(join(project, "dist/index.html"), `<head><${name} data-decoy='>${original}'>${decoy}</${name}>${original}</head>`);
    assert.equal(await projectLocalDataThreadId(project, { CODEX_SESSION_ID: THREAD_ID }), SESSION_ID, name);
    write(join(project, "dist/index.html"), `<head>${original}<${name}>${decoy}</head>`);
    assert.equal(await projectLocalDataThreadId(project, { CODEX_SESSION_ID: THREAD_ID }), THREAD_ID, `unclosed ${name}`);
  }
  for (const [html, expected] of [
    [`<!-- <head>${decoy}</head> --><head><link data-decoy='${decoy}'>${original}</head>`, SESSION_ID],
    [`<head><link data-decoy='${original}'></head>`, THREAD_ID],
    [`<head>${original}<!-- unclosed </head>`, THREAD_ID],
    [`<head>${original}<link data-decoy='unclosed </head>`, THREAD_ID],
    [`<head>${original}`, THREAD_ID],
    [`<head>${original}</head>${decoy}<script>unclosed`, SESSION_ID],
  ]) {
    write(join(project, "dist/index.html"), html);
    assert.equal(await projectLocalDataThreadId(project, { CODEX_SESSION_ID: THREAD_ID }), expected);
  }
});

let seedRoot;

function write(path, content, options) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, options);
}

function copySource(from, to, { omitTests = false } = {}) {
  cpSync(from, to, {
    recursive: true,
    filter(path) {
      const parts = relative(from, path).split(sep);
      return (
        !parts.some((part) => part === "node_modules" || part === "dist" || part.startsWith(".data-app-build-")) &&
        !(omitTests && parts[0] === "tests")
      );
    },
  });
}

function sourceSeed() {
  if (!seedRoot) {
    seedRoot = realpathSync(mkdtempSync(join(tmpdir(), "data-app-build-source-")));
    for (const directory of [
      "scripts", "templates/data-app/inline", "skills/visualize-data/scripts", dirname(PACKAGER), ASSETS,
    ]) {
      copySource(join(PLUGIN_ROOT, directory), join(seedRoot, directory));
    }
    copySource(join(PLUGIN_ROOT, BASE), join(seedRoot, BASE), { omitTests: true });
    for (const file of RELEASE_INPUTS) write(join(seedRoot, file), readFileSync(join(PLUGIN_ROOT, file)));
    // Keep the actual released manifest. Re-signing fixture bytes here would
    // hide a stale or incomplete shipped runtime from the integration test.
    assert.ok(existsSync(join(seedRoot, ASSETS, "manifest.json")));
  }
  return seedRoot;
}

after(() => {
  if (seedRoot) rmSync(seedRoot, { recursive: true, force: true });
});

function fixture(t) {
  const plugin = sourceSeed();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "data-app-build-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = {
    root,
    plugin,
    project: join(root, "project"),
    bin: join(root, "blocked-package-managers"),
    cache: join(root, "unused-npm-cache"),
    packageManagerLog: join(root, "package-manager.log"),
    sourceLog: join(root, "source-vite.log"),
    manifest: JSON.parse(readFileSync(join(plugin, ASSETS, "manifest.json"), "utf8")),
  };
  copySource(join(plugin, BASE), state.project);
  for (const executable of ["npm", "npx", "pnpm", "pnpx", "yarn", "corepack", "bun"]) {
    write(
      join(state.bin, executable),
      '#!/bin/sh\nprintf \'%s\\n\' "$0" >> "$DATA_APP_TEST_PACKAGE_MANAGER_LOG"\nexit 97\n',
      { mode: 0o755 },
    );
    write(
      join(state.bin, `${executable}.cmd`),
      '@echo off\r\necho %~nx0>>"%DATA_APP_TEST_PACKAGE_MANAGER_LOG%"\r\nexit /b 97\r\n',
    );
  }
  return state;
}

function runCli(state, command, args = [], environment = {}, nodeArgs = []) {
  const helper = command === "package" ? PACKAGER : "scripts/data-app.mjs";
  const options = command === "package" ? ["--project-id", "appgprj_offline_fixture"] : [command];
  const result = spawnSync(
    process.execPath,
    [...nodeArgs, join(state.plugin, helper), ...options, "--project-dir", state.project, ...args],
    {
      cwd: state.project,
      encoding: "utf8",
      timeout: 45_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: {
        ...dataNodeEnvironment(process.env),
        PATH: state.bin,
        NODE_PATH: "",
        CODEX_SESSION_ID: "",
        CODEX_THREAD_ID: "",
        DATA_APP_TEST_PACKAGE_MANAGER_LOG: state.packageManagerLog,
        DATA_APP_TEST_SOURCE_LOG: state.sourceLog,
        npm_config_cache: state.cache,
        npm_config_offline: "true",
        npm_config_registry: "http://127.0.0.1:9/unavailable",
        ...environment,
      },
    },
  );
  return result;
}

function successful(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

function failed(result, pattern) {
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, pattern);
}

function inventory(root) {
  const result = {};
  function visit(path) {
    const name = relative(root, path).split(sep).join("/") || ".";
    const info = lstatSync(path);
    if (info.isSymbolicLink()) result[name] = { type: "link", target: readlinkSync(path) };
    else if (info.isDirectory()) {
      result[name] = { type: "directory", mtime: info.mtimeMs };
      for (const child of readdirSync(path).sort()) visit(join(path, child));
    } else {
      assert.ok(info.isFile(), `Unexpected fixture entry: ${path}`);
      result[name] = { type: "file", sha256: sha256(readFileSync(path)), mode: info.mode, mtime: info.mtimeMs };
    }
  }
  visit(root);
  return result;
}

function assertNoPackageManager(state) {
  assert.equal(existsSync(state.packageManagerLog), false, "The customer build invoked a package manager.");
  assert.equal(existsSync(state.cache), false, "The customer build populated a dependency cache.");
}

function assertNoDependencies(state) {
  assertNoPackageManager(state);
  assert.equal(
    existsSync(join(state.project, "node_modules")),
    false,
    "The customer build created project node_modules.",
  );
  assert.deepEqual(
    readdirSync(state.project).filter((name) => name.startsWith(".data-app-build-")),
    [],
  );
}

function assertNoMachinePaths(html, state) {
  for (const path of [state.root, state.project, state.plugin]) {
    for (const variant of new Set([
      path,
      path.split(sep).join("/"),
      pathToFileURL(path).href,
      encodeURIComponent(path),
      JSON.stringify(path).slice(1, -1),
    ])) {
      assert.equal(html.includes(variant), false, `The portable HTML leaked ${variant}.`);
    }
  }
  assert.doesNotMatch(html, /<meta\s+name="data-app-local-reference"/iu);
}

function createLink(t, target, path, directory = false) {
  try {
    symlinkSync(target, path, directory ? (process.platform === "win32" ? "junction" : "dir") : "file");
    return true;
  } catch (error) {
    if (process.platform !== "win32" || !["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
    t.skip("This Windows environment does not permit creation of the test symlink.");
    return false;
  }
}

test("default build prepare is read-only and cold/warm builds need no npm or node_modules", (t) => {
  const state = fixture(t);
  const projectBefore = inventory(state.project);
  const pluginBefore = inventory(state.plugin);
  const prepared = successful(runCli(state, "prepare", ["--offline"]));
  assert.deepEqual(prepared, {
    projectRoot: state.project,
    prebuilt: true,
    apiVersion: 1,
    runtimeSha256: state.manifest.artifacts.app.sha256,
    compilerSha256: state.manifest.artifacts.compiler.sha256,
    documentation: {
      entryPoint: join(state.plugin, BASE, "docs/components/README.md"),
      source: "installed-plugin",
      apiVersion: state.manifest.apiVersion,
      runtimeSha256: state.manifest.artifacts.app.sha256,
    },
  });
  assert.deepEqual(inventory(state.project), projectBefore);
  assert.deepEqual(inventory(state.plugin), pluginBefore);
  assert.equal(existsSync(join(state.project, "dist")), false);
  assertNoDependencies(state);

  const cold = successful(runCli(state, "build"));
  const html = readFileSync(cold.htmlPath, "utf8");
  const snapshotHash = sha256(readFileSync(join(state.project, "src/data.json")));
  assert.equal(cold.prebuilt, true);
  assert.equal(cold.htmlPath, join(state.project, "dist/index.html"));
  assert.equal(cold.htmlSha256, sha256(html));
  assert.equal(cold.snapshotSha256, snapshotHash);
  assert.equal(cold.runtimeSha256, state.manifest.artifacts.app.sha256);
  assert.equal(cold.compilerSha256, state.manifest.artifacts.compiler.sha256);
  assert.deepEqual(cold.documentation, prepared.documentation);
  assert.ok(cold.moduleCount >= 2);
  assert.ok(Number.isSafeInteger(cold.assetCount) && cold.assetCount >= 0);
  assert.equal(marker(html, "data-app-snapshot-sha256"), snapshotHash);
  assert.equal(marker(html, "data-app-runtime-sha256"), cold.runtimeSha256);
  assert.equal(sha256(scriptElements(html).find(({ type }) => type !== "application/json").code), cold.runtimeSha256);
  assertNoMachinePaths(html, state);
  assertNoDependencies(state);

  const warm = successful(runCli(state, "build", ["--offline"]));
  assert.deepEqual(warm, cold);
  assert.deepEqual(readdirSync(join(state.project, "dist")), ["index.html"]);
  assert.deepEqual(inventory(state.plugin), pluginBefore);
  assertNoDependencies(state);
});

test("stale copied runtime is not a publishing dependency and remains untouched", (t) => {
  const state = fixture(t);
  successful(runCli(state, "build"));
  write(join(state.project, ".data-plugin-version"), "old-runtime-cache-no-longer-installed\n");
  write(join(state.project, "AGENTS.md"), "Previous release authoring guide.\n");
  rmSync(join(state.project, "docs"), { recursive: true });
  write(join(state.project, "src/content/COMPONENTS.md"), "Previous release component API.\n");
  write(
    join(state.project, "scripts/verify-protected-runtime.mjs"),
    'throw new Error("Do not execute copied runtime scripts");\n',
  );
  rmSync(join(state.project, "src/App.jsx"));
  rmSync(join(state.project, "src/worker.js"));
  const hosting = { d1: "DB", r2: null, project_id: "appgprj_offline_fixture" };
  write(join(state.project, ".openai/hosting.json"), `${JSON.stringify(hosting, null, 2)}\n`);
  const sourceHashes = () => Object.fromEntries(
    Object.entries(inventory(state.project))
      .filter(([name, entry]) => entry.type === "file" && !name.startsWith("dist/")
        && !name.startsWith(".data-app-assets/") && !name.startsWith(".data-app-offline/") && name !== ".openai/hosting.json")
      .map(([name, entry]) => [name, entry.sha256]),
  );
  const projectBefore = inventory(state.project);
  const sourcesBefore = sourceHashes();
  const pluginBefore = inventory(state.plugin);
  const prepared = successful(runCli(state, "prepare", ["--offline"]));
  assert.deepEqual(prepared.documentation, {
    entryPoint: join(state.plugin, BASE, "docs/components/README.md"),
    source: "installed-plugin",
    apiVersion: state.manifest.apiVersion,
    runtimeSha256: state.manifest.artifacts.app.sha256,
  }, "Old apps must discover the docs for the installed runtime they will build against");
  assert.ok(existsSync(prepared.documentation.entryPoint));
  assert.deepEqual(inventory(state.project), projectBefore);
  const packaged = successful(runCli(state, "package"));
  const html = readFileSync(packaged.htmlPath, "utf8");
  assert.equal(packaged.buildMode, "existing-page");
  assert.equal(packaged.snapshotSource, "compiled-html");
  assert.equal(marker(html, "data-app-runtime-sha256"), state.manifest.artifacts.app.sha256);
  assert.equal(marker(html, "data-app-snapshot-sha256"), sha256(readFileSync(join(state.project, "src/data.json"))));
  assert.deepEqual(sourceHashes(), sourcesBefore);
  assert.equal(JSON.parse(readFileSync(join(state.project, ".openai/hosting.json"))).r2, "BUCKET");
  successful(runCli(state, "package"));
  assert.equal(readFileSync(packaged.htmlPath, "utf8"), html, "Compatible reviewed HTML should be reused.");
  assert.deepEqual(sourceHashes(), sourcesBefore);
  assert.deepEqual(inventory(state.plugin), pluginBefore);
  assertNoMachinePaths(html, state);
  assertNoDependencies(state);
});

test("publication and rebuilds retain the originating local task across other tasks and ordinary shells", (t) => {
  const state = fixture(t);
  const first = successful(runCli(state, "build", [], { CODEX_SESSION_ID: SESSION_ID }));
  const localHtml = readFileSync(first.htmlPath, "utf8");
  assert.equal(marker(localHtml, "data-app-local-thread"), SESSION_ID);
  const packaged = successful(runCli(state, "package", [], { CODEX_SESSION_ID: THREAD_ID }));
  assert.equal(packaged.htmlPath, first.htmlPath);
  assert.equal(packaged.thinBootstrap, true);
  assert.equal(readFileSync(packaged.offlineHtmlPath, "utf8"), localHtml);
  assert.ok(!readFileSync(first.htmlPath, "utf8").includes("data-app-local-thread"));
  for (const environment of [{ CODEX_SESSION_ID: THREAD_ID }, {}]) {
    const rebuilt = successful(runCli(state, "build", [], environment));
    assert.equal(marker(readFileSync(rebuilt.htmlPath, "utf8"), "data-app-local-thread"), SESSION_ID);
  }
  assertNoDependencies(state);
});

test("thin publication origin recovery rejects changed offline or hosted bytes", async (t) => {
  const state = fixture(t);
  successful(runCli(state, "build", [], { CODEX_SESSION_ID: SESSION_ID }));
  const packaged = successful(runCli(state, "package", [], { CODEX_SESSION_ID: THREAD_ID }));
  const original = readFileSync(packaged.offlineHtmlPath);
  const hosted = readFileSync(packaged.htmlPath);
  const current = { CODEX_SESSION_ID: THREAD_ID };
  assert.equal(await projectLocalDataThreadId(state.project, current), SESSION_ID);
  writeFileSync(packaged.offlineHtmlPath, original.toString().replaceAll(SESSION_ID, THREAD_ID));
  assert.equal(await projectLocalDataThreadId(state.project, current), THREAD_ID, "A changed offline backup must not supply stale task metadata");
  writeFileSync(packaged.offlineHtmlPath, original);
  writeFileSync(packaged.htmlPath, Buffer.concat([hosted, Buffer.from("<!-- rebuilt or changed page -->")]));
  assert.equal(await projectLocalDataThreadId(state.project, current), THREAD_ID, "A different current page must not recover an older offline task");
  writeFileSync(packaged.htmlPath, hosted);
  assert.equal(await projectLocalDataThreadId(state.project, current), SESSION_ID);
});

test("publishing an older compiled client preserves its bytes without rebuilding edited source", (t) => {
  const state = fixture(t);
  const built = successful(runCli(state, "build"));
  const oldHtml = readFileSync(built.htmlPath, "utf8").replace(
    `name="data-app-runtime-sha256" content="${built.runtimeSha256}"`,
    `name="data-app-runtime-sha256" content="${RUNTIME_HASH}"`,
  ).replace('<meta name="data-app-bootstrap" content="deferred-content-v1">', "");
  writeFileSync(built.htmlPath, oldHtml);
  const content = join(state.project, "src/content/dashboard/DashboardContent.jsx");
  const editedSource = "export function DashboardContent( {\n";
  writeFileSync(content, editedSource);
  const packaged = successful(runCli(state, "package"));
  assert.equal(packaged.buildMode, "existing-page");
  assert.equal(readFileSync(packaged.htmlPath, "utf8"), oldHtml);
  assert.equal(readFileSync(content, "utf8"), editedSource);
  assertNoDependencies(state);
});

test("publication requires an existing compiled page and never builds a missing one", (t) => {
  const state = fixture(t);
  const before = inventory(state.project);
  failed(runCli(state, "package"), /ENOENT|existing compiled/u);
  assert.deepEqual(inventory(state.project), before);
  assertNoDependencies(state);
});

test("default build replaces the complete dist tree and removes stale output", (t) => {
  const state = fixture(t);
  const initial = successful(runCli(state, "build"));
  write(join(state.project, "dist/stale.js"), "old output");
  write(join(state.project, "dist/assets/stale.css"), "old CSS");
  write(join(state.project, "dist/server/index.js"), "old Worker");
  const snapshotPath = join(state.project, "src/data.json");
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  snapshot.title = "Rebuilt offline fixture";
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  const rebuilt = successful(runCli(state, "build"));
  assert.notEqual(rebuilt.htmlSha256, initial.htmlSha256);
  assert.equal(rebuilt.snapshotSha256, sha256(readFileSync(snapshotPath)));
  assert.deepEqual(readdirSync(join(state.project, "dist")), ["index.html"]);
  assert.match(readFileSync(rebuilt.htmlPath, "utf8"), /<title>Rebuilt offline fixture<\/title>/u);
  assertNoDependencies(state);
});

test("default build places conventional CSS before print and component-import CSS after print", (t) => {
  const state = fixture(t);
  const component = join(state.project, "src/content/dashboard/DashboardContent.jsx");
  write(component, 'import "./css-order-probe.css";\n' + readFileSync(component, "utf8"));
  write(
    join(state.project, "src/content/dashboard/dashboard.css"),
    ".page { padding: 24px; --data-css-order: dashboard; }\n@page { margin: 18mm; }\n",
  );
  write(join(state.project, "src/content/report/report.css"), ".page { --data-css-order: report; }\n");
  write(
    join(state.project, "src/content/dashboard/css-order-probe.css"),
    ".page { padding-top: 48px; --data-css-order: imported; }\n@page { margin: 20mm; }\n",
  );

  const result = successful(runCli(state, "build"));
  const css = styleSource(readFileSync(result.htmlPath, "utf8"));
  const print = readFileSync(join(state.plugin, ASSETS, state.manifest.artifacts.print.path), "utf8");
  const position = (pattern) => {
    const match = pattern.exec(css);
    assert.ok(match, `Missing CSS probe: ${pattern}`);
    return match.index;
  };
  const dashboardPosition = position(/--data-css-order:\s*dashboard/u);
  const reportPosition = position(/--data-css-order:\s*report/u);
  const conventionalMarginPosition = position(/@page\s*\{\s*margin:\s*18mm\b/u);
  const importedPosition = position(/--data-css-order:\s*imported/u);
  const importedMarginPosition = position(/@page\s*\{\s*margin:\s*20mm\b/u);
  const printPosition = css.indexOf(print);
  assert.ok(print.length > 0 && printPosition >= 0, "The complete protected print stylesheet must be preserved.");
  assert.ok(dashboardPosition < reportPosition, "Dashboard CSS must precede report CSS.");
  assert.ok(reportPosition < printPosition, "Both conventional stylesheets must precede print CSS.");
  assert.ok(conventionalMarginPosition < printPosition, "Print CSS must still override conventional page margins.");
  assert.ok(importedPosition >= printPosition + print.length, "Component imports must follow the complete print CSS.");
  assert.ok(importedMarginPosition > importedPosition, "The authored page-margin override must remain last.");
  assertNoDependencies(state);
});

test("default build preserves the previous dist when authored compilation fails", (t) => {
  const state = fixture(t);
  successful(runCli(state, "build"));
  write(join(state.project, "dist/previous.txt"), "preserve this too");
  const previous = inventory(join(state.project, "dist"));
  writeFileSync(
    join(state.project, "src/content/dashboard/DashboardContent.jsx"),
    "export function DashboardContent( {\n",
  );
  failed(runCli(state, "build"), /parse authored JavaScript|bundle authored modules/u);
  assert.deepEqual(inventory(join(state.project, "dist")), previous);
  assertNoDependencies(state);
});

test("default build preserves detached previous output when publish and destination probing fail", (t) => {
  const state = fixture(t);
  successful(runCli(state, "build"));
  write(join(state.project, "dist/previous.txt"), "the only previous copy");
  const previous = inventory(join(state.project, "dist"));
  const loader = join(state.root, "publish-fault.mjs");
  const faultLog = join(state.root, "publish-fault.log");
  write(
    loader,
    `import fs from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, join } from "node:path";
const destination = join(process.env.DATA_APP_TEST_PROJECT, "dist");
const originalRename = fs.rename;
const originalLstat = fs.lstat;
let scratch = "";
let failedPublish = false;
function record(value) { appendFileSync(process.env.DATA_APP_TEST_PUBLISH_FAULT_LOG, value + "\\n"); }
function fault(message, code) { return Object.assign(new Error(message), {code}); }
fs.rename = async function(from, to, ...rest) {
  if (from === destination && basename(to) === "previous" && basename(dirname(to)).startsWith(".data-app-build-")) {
    const result = await originalRename(from, to, ...rest);
    scratch = dirname(to);
    record("detached previous");
    return result;
  }
  if (scratch && from === join(scratch, "next") && to === destination) {
    failedPublish = true;
    record("candidate rename failed");
    throw fault("injected candidate publish failure", "EIO");
  }
  return originalRename(from, to, ...rest);
};
fs.lstat = async function(path, ...rest) {
  if (failedPublish && path === destination) {
    record("destination probe failed");
    throw fault("injected destination probe failure", "EACCES");
  }
  return originalLstat(path, ...rest);
};
syncBuiltinESMExports();
`,
  );
  const result = runCli(
    state,
    "build",
    [],
    {
      DATA_APP_TEST_PROJECT: state.project,
      DATA_APP_TEST_PUBLISH_FAULT_LOG: faultLog,
    },
    ["--import", loader],
  );
  failed(result, /previous output is preserved at/u);
  assert.equal(
    readFileSync(faultLog, "utf8"),
    "detached previous\ncandidate rename failed\ndestination probe failed\n",
  );
  assert.equal(existsSync(join(state.project, "dist")), false);
  const backups = readdirSync(state.project).filter((name) => name.startsWith(".data-app-build-"));
  assert.equal(backups.length, 1, "The old output must remain available for recovery.");
  const scratch = join(state.project, backups[0]);
  assert.ok(result.stderr.includes(join(scratch, "previous")));
  assert.deepEqual(inventory(join(scratch, "previous")), previous);
  assert.equal(existsSync(join(scratch, "next/index.html")), true);
  assert.equal(existsSync(join(state.project, "node_modules")), false);
  assertNoPackageManager(state);
});

test("default build rejects a redirected dist directory without touching its target", (t) => {
  const state = fixture(t);
  const outside = join(state.root, "outside-output");
  write(join(outside, "keep.txt"), "unrelated output");
  const previous = inventory(outside);
  if (!createLink(t, outside, join(state.project, "dist"), true)) return;
  failed(runCli(state, "build"), /dist must be a regular directory inside the project/u);
  assert.equal(lstatSync(join(state.project, "dist")).isSymbolicLink(), true);
  assert.deepEqual(inventory(outside), previous);
  assertNoDependencies(state);
});

test("default build rejects authored symlinks before producing any output", (t) => {
  const state = fixture(t);
  const content = join(state.project, "src/content/dashboard/DashboardContent.jsx");
  const outside = join(state.root, "outside-content.jsx");
  write(outside, readFileSync(content));
  rmSync(content);
  if (!createLink(t, outside, content)) return;
  failed(runCli(state, "build"), /source must not contain symlinks|nonsymlinked file/u);
  assert.equal(existsSync(join(state.project, "dist")), false);
  assert.equal(lstatSync(content).isSymbolicLink(), true);
  assertNoDependencies(state);
});

function installSourceViteFixture(state, directory = join(state.project, "node_modules/vite")) {
  write(join(directory, "package.json"), '{"name":"vite","type":"module"}\n');
  write(
    join(directory, "bin/vite.js"),
    `import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
if (process.argv[2] !== "build") throw new Error("Unexpected source Vite command");
appendFileSync(process.env.DATA_APP_TEST_SOURCE_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
mkdirSync(join(process.cwd(), "dist"), {recursive:true});
writeFileSync(join(process.cwd(), "dist/index.html"), "<!doctype html><head><title>Explicit local Vite fixture</title>" +
  (process.env.CODEX_SESSION_ID ? '<meta name="data-app-local-thread" content="' + process.env.CODEX_SESSION_ID + '">' : '') + '</head>\\n');
`,
  );
  return join(directory, "bin/vite.js");
}

test("default build never activates local Vite automatically and --source still verifies integrity", (t) => {
  const state = fixture(t);
  failed(runCli(state, "prepare", ["--source"]), /requires an already-installed local Vite toolchain/u);
  assertNoDependencies(state);
  const vitePath = installSourceViteFixture(state);
  const prepared = successful(runCli(state, "prepare", ["--source"]));
  assert.deepEqual(prepared, {
    projectRoot: state.project, prebuilt: false, source: true, vitePath,
    documentation: {
      entryPoint: join(state.project, "docs/components/README.md"),
      source: "project-source",
      protectedRuntimeSha256: sha256(readFileSync(join(state.project, "protected-runtime.json"))),
    },
  });
  assert.equal(existsSync(state.sourceLog), false, "Source prepare must not run Vite build.");
  writeFileSync(
    join(state.project, "src/content/dashboard/DashboardContent.jsx"),
    'import optional from "unbundled-fixture-package";\nexport function DashboardContent(){return optional;}\n',
  );
  failed(runCli(state, "build"), /package or URL import.*unbundled-fixture-package/u);
  assert.equal(existsSync(state.sourceLog), false, "A default failure must not fall back to Vite.");
  assert.equal(existsSync(join(state.project, "dist")), false);

  const built = successful(runCli(state, "build", ["--source", "--offline"]));
  assert.equal(built.prebuilt, false);
  assert.equal(built.source, true);
  assert.deepEqual(built.documentation, prepared.documentation);
  assert.equal(built.htmlSha256, sha256(readFileSync(built.htmlPath)));
  assert.equal(built.snapshotSha256, sha256(readFileSync(join(state.project, "src/data.json"))));
  assert.equal(readFileSync(state.sourceLog, "utf8"), '["build"]\n');
  const previous = inventory(join(state.project, "dist"));
  const protectedPath = join(state.project, "src/styles.css");
  writeFileSync(protectedPath, `${readFileSync(protectedPath, "utf8")}\n/* unapproved protected change */\n`);
  failed(runCli(state, "build", ["--source"]), /Protected Data app runtime file was modified: src\/styles\.css/u);
  assert.equal(readFileSync(state.sourceLog, "utf8"), '["build"]\n');
  assert.deepEqual(inventory(join(state.project, "dist")), previous);
  assertNoPackageManager(state);
});

test("source rebuilds pass the original local task to Vite", (t) => {
  const state = fixture(t);
  installSourceViteFixture(state);
  const first = successful(runCli(state, "build", ["--source"], { CODEX_SESSION_ID: SESSION_ID }));
  assert.equal(marker(readFileSync(first.htmlPath, "utf8"), "data-app-local-thread"), SESSION_ID);
  const rebuilt = successful(runCli(state, "build", ["--source"], { CODEX_SESSION_ID: THREAD_ID }));
  assert.equal(marker(readFileSync(rebuilt.htmlPath, "utf8"), "data-app-local-thread"), SESSION_ID);
  assertNoPackageManager(state);
});

test("default build source escape hatch rejects Vite resolved outside the project", (t) => {
  const state = fixture(t);
  const outside = join(state.root, "outside-vite");
  installSourceViteFixture(state, outside);
  mkdirSync(join(state.project, "node_modules"));
  if (!createLink(t, outside, join(state.project, "node_modules/vite"), true)) return;
  failed(runCli(state, "build", ["--source"]), /source-build Vite must be contained in the Data app project/u);
  assert.equal(existsSync(state.sourceLog), false);
  assert.equal(existsSync(join(state.project, "dist")), false);
  assertNoPackageManager(state);
});

test("separate-data CLI publishes a complete bundle and exports reviewed bytes after source edits", (t) => {
  const state = fixture(t);
  const source = join(state.project, "src/data.json"), original = readFileSync(source);
  const built = successful(runCli(state, "build", ["--separate-data"], { CODEX_SESSION_ID: SESSION_ID }));
  const bundle = readSeparateDataBundle({ projectDir: state.project });
  assert.equal(built.buildKind, "separate-data-v1");
  assert.equal(built.buildManifestPath, bundle.manifestPath);
  assert.equal(built.snapshotPath, bundle.snapshotPath);
  assert.deepEqual(readFileSync(bundle.snapshotPath), original);
  assert.deepEqual(readdirSync(join(state.project, "dist")).sort(), ["data-app-build.json", "index.html", bundle.manifest.snapshot.path].sort());
  const script = scriptElements(bundle.htmlBytes.toString()).find(element => element.type === "application/json");
  assert.deepEqual(JSON.parse(script.code).queries, {});
  assert.equal(marker(bundle.htmlBytes.toString(), "data-app-local-thread"), SESSION_ID);
  write(source, '{"title":"Later source","queries":{}}');
  const exported = successful(runCli(state, "export-offline", ["--output", ".data-app-offline/exports/reviewed.html"]));
  const offline = readFileSync(exported.htmlPath, "utf8");
  const complete = scriptElements(offline).filter(element => element.type === "application/json");
  assert.deepEqual(JSON.parse(complete.map(element => element.code).join("")), JSON.parse(original));
  assert.equal(exported.snapshotSha256, sha256(original));
  assert.doesNotMatch(offline, /<meta name="data-app-local-snapshot"/u);
  assert.deepEqual(readFileSync(bundle.snapshotPath), original);
  assertNoDependencies(state);
});

test("separate-data writes all files before replacement and preserves the old dist on a candidate failure", (t) => {
  const state = fixture(t);
  successful(runCli(state, "build", ["--separate-data"]));
  const previous = inventory(join(state.project, "dist"));
  const loader = join(state.root, "separate-write-fault.mjs");
  write(loader, `import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const original = fs.writeFile;
fs.writeFile = async function(path, ...args) {
  if (String(path).endsWith("/next/data-app-build.json")) throw new Error("injected split manifest write failure");
  return original.call(this, path, ...args);
};
syncBuiltinESMExports();`);
  failed(runCli(state, "build", ["--separate-data"], {}, ["--import", pathToFileURL(loader).href]), /injected split manifest write failure/u);
  assert.deepEqual(inventory(join(state.project, "dist")), previous);
  assert.equal(readdirSync(state.project).some(name => name.startsWith(".data-app-build-")), false);
  const rebuilt = successful(runCli(state, "build"));
  assert.deepEqual(readdirSync(join(state.project, "dist")), ["index.html"]);
  assert.equal(rebuilt.buildKind, undefined);
});

test("CLI rejects unsupported split/source combinations before invoking any build", (t) => {
  const state = fixture(t);
  failed(runCli(state, "build", ["--source", "--separate-data"]), /distinct build path/u);
  failed(runCli(state, "prepare", ["--separate-data"]), /only for a prebuilt build/u);
  failed(runCli(state, "export-offline", ["--source"]), /requires a verified separate-data build/u);
  failed(runCli(state, "build", ["--output", "offline.html"]), /only for export-offline/u);
  assert.equal(existsSync(join(state.project, "dist")), false);
  assertNoDependencies(state);
});

test("publication clones build only after exact snapshot hydration", (t) => {
  const state = fixture(t), source = join(state.project, "src/data.json"), original = readFileSync(source);
  write(join(state.project, ".openai/data-app-publication-source.json"), JSON.stringify({
    version: 1, kind: "data-app-publication-source-v1", sourceSnapshotSha256: sha256(original),
    snapshot: { sha256: sha256(original), bytes: original.length },
  }));
  rmSync(source);
  failed(runCli(state, "build", ["--separate-data"]), /exact verified snapshot hydration/u);
  assert.equal(existsSync(join(state.project, "dist")), false);
  write(source, '{"title":"Unverified replacement","queries":{}}');
  failed(runCli(state, "build", ["--separate-data"]), /exact verified snapshot hydration/u);
  write(source, original);
  const result = successful(runCli(state, "build", ["--separate-data"]));
  assert.equal(result.snapshotSha256, sha256(original));
  assert.deepEqual(readFileSync(readSeparateDataBundle({ projectDir: state.project }).snapshotPath), original);

  const previous = inventory(join(state.project, "dist")), loader = join(state.root, "hydration-race.mjs");
  write(loader, `import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const originalRead = fs.readFile, source = ${JSON.stringify(source)};
let changed = false;
fs.readFile = async function(path, ...args) {
  if (String(path) === source && !changed) { changed = true; await fs.writeFile(source, '{"title":"Changed after initial pin check","queries":{}}'); }
  return originalRead.call(this, path, ...args);
};
syncBuiltinESMExports();`);
  failed(runCli(state, "build", ["--separate-data"], {}, ["--import", pathToFileURL(loader).href]), /exact verified snapshot hydration|publication source identity changed/u);
  assert.deepEqual(inventory(join(state.project, "dist")), previous);
});
