import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createContext, Script } from "node:vm";

import { assembleDataAppHtml } from "../scripts/data-app-build.mjs";
import { assertHydratedPublicationSource, exportOfflineDataApp, readSeparateDataBundle, resolveSeparateDataBundle } from "../scripts/data-app-separate.mjs";
import { sha256 } from "../scripts/prebuilt/manifest.mjs";
import { inspectDataAppDocument } from "../skills/publish-artifact-to-sites/scripts/publication-assets.mjs";
import { createStreamingJsonParser, parseJsonResponse } from "../templates/data-app/base/src/streaming-json.js";

const RUNTIME = "a".repeat(64);
const SNAPSHOT = { id: "local-test", title: "Complete data", surface: "dashboard", queries: { q: { rows: [{ value: 42 }, { value: 17 }] } } };
const SNAPSHOT_ID = "data-app-reviewed-snapshot";
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };

function assemble(snapshotBytes = Buffer.from(JSON.stringify(SNAPSHOT))) {
  return assembleDataAppHtml({ snapshotBytes, separateData: true, runtimeSha256: RUNTIME,
    protectedStyles: "", printStyles: "",
    appCode: 'globalThis.mounts=[];globalThis.CodexDataAppRuntime={apiVersion:1,createStreamingJsonParser,parseJsonResponse,mount(options){mounts.push(options);options.createContent(options.reviewedSnapshot)}};',
    authored: { themeCss: "", conventionalCss: "", importedCss: "", factorySource: '(function(runtime,snapshot){globalThis.moduleValue=snapshot.queries.q.rows[0].value;globalThis.moduleRows=snapshot.queries.q.rows.length;return {}})' },
  }).html;
}

function fixture(t, bytes = Buffer.from(JSON.stringify(SNAPSHOT)), transformHtml = html => html) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "data-app-separate-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const html = transformHtml(assemble(bytes)), hash = sha256(bytes);
  const manifest = { version: 1, kind: "separate-data-v1", html: { path: "index.html", sha256: sha256(html), bytes: Buffer.byteLength(html) },
    snapshot: { path: `snapshot.${hash}.json`, sha256: hash, bytes: bytes.length }, runtimeSha256: RUNTIME, sourceSnapshotSha256: hash };
  const manifestPath = join(root, "dist/data-app-build.json");
  const snapshotPath = join(root, "dist", manifest.snapshot.path);
  write(join(root, "dist/index.html"), html); write(snapshotPath, bytes); write(manifestPath, JSON.stringify(manifest));
  return { root, html, bytes, manifest, manifestPath, snapshotPath };
}

function execute(html, { fetch = () => { throw Error("Unexpected fetch"); }, hosted = false } = {}) {
  const inspection = inspectDataAppDocument(html), root = { textContent: "" };
  const context = createContext({ URL, fetch, createStreamingJsonParser, parseJsonResponse, location: { hostname: "localhost" }, document: {
    baseURI: "http://localhost:1234/",
    getElementById(id) { return id === SNAPSHOT_ID ? { textContent: inspection.embedded } : id === "root" ? root : null; },
    querySelectorAll() { return [...html.matchAll(/<script type="application\/json" data-app-snapshot-chunk>([\s\S]*?)<\/script>/gu)].map(match => ({ textContent: match[1] })); },
    querySelector(selector) {
      if (hosted && selector.includes("data-app-snapshot-storage")) return { content: "external-v1" };
      const name = /name="([^"]+)"/u.exec(selector)?.[1];
      const marker = inspection.metadata.find(meta => meta.names.includes(name));
      return marker ? { content: marker.contents[0] } : null;
    },
  } });
  for (const [, attributes, source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gu)) {
    if (attributes.includes('type="application/json"')) continue;
    const encoded = /src="data:text\/javascript;charset=utf-8;base64,([^"]+)"/u.exec(attributes)?.[1];
    new Script(encoded ? Buffer.from(encoded, "base64").toString() : source).runInContext(context);
  }
  return { context, root };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test("separate local preview waits for complete data before executing authored module capture", async () => {
  const rows = Array.from({ length: 10001 }, (_, value) => ({ value: value + 42 }));
  const snapshot = { ...SNAPSHOT, queries: { q: { rows } } };
  let release, called = 0;
  const html = assemble(Buffer.from(JSON.stringify(snapshot)));
  const { context, root } = execute(html, { fetch(url, options) {
    called++; assert.equal(String(url), `http://localhost:1234/snapshot.${sha256(JSON.stringify(snapshot))}.json`);
    assert.equal(options.credentials, "same-origin");
    return new Promise(resolve => { release = () => resolve(new Response(JSON.stringify(snapshot))); });
  } });
  assert.equal(called, 1); assert.equal(context.mounts.length, 0); assert.equal(context.moduleValue, undefined);
  assert.equal(root.textContent, "Loading data…");
  release(); await flush();
  assert.equal(context.mounts.length, 1); assert.equal(context.moduleValue, 42); assert.equal(context.moduleRows, rows.length);
  assert.deepEqual(context.mounts[0].reviewedSnapshot, snapshot);
});

test("missing, failed, or malformed local snapshot never mounts an empty authored app", async () => {
  for (const response of [new Error("secret transport detail"), { ok: false }, new Response('{"queries":[]}'),
    new Response('{"secret JSON detail":')]) {
    const { context, root } = execute(assemble(), { fetch: async () => { if (response instanceof Error) throw response; return response; } });
    await flush();
    assert.equal(context.mounts.length, 0); assert.equal(context.moduleValue, undefined);
    assert.match(root.textContent, /reviewed data could not be loaded/u); assert.doesNotMatch(root.textContent, /secret/u);
  }
});

test("hosted separate bootstrap delegates complete-data initialization to the hosted runtime", () => {
  const html = assemble().replace('mounts.push(options);options.createContent(options.reviewedSnapshot)', 'mounts.push(options)');
  const { context } = execute(html, { hosted: true });
  assert.equal(context.mounts.length, 1); assert.equal(context.moduleValue, undefined);
  assert.equal(context.mounts[0].hosted, true);
  assert.equal(Object.keys(context.mounts[0].reviewedSnapshot.queries).length, 0);
  context.mounts[0].createContent(SNAPSHOT);
  assert.equal(context.moduleValue, 42); assert.equal(context.moduleRows, 2);
});

test("bundle validation binds exact raw bytes, content-addressed paths, HTML metadata, and runtime", t => {
  const state = fixture(t, Buffer.from(`\ufeff${JSON.stringify(SNAPSHOT, null, 2)}\n`));
  const result = readSeparateDataBundle({ projectDir: state.root });
  assert.deepEqual(result.manifest, state.manifest); assert.equal(result.snapshotPath, state.snapshotPath);
  assert.deepEqual(readSeparateDataBundle({ projectDir: state.root, manifestPath: state.manifestPath }).manifest, state.manifest);
  write(state.snapshotPath, Buffer.concat([state.bytes, Buffer.from(" ")]));
  assert.throws(() => readSeparateDataBundle({ projectDir: state.root }), /bundle/u);
  write(state.snapshotPath, state.bytes);
  for (const change of [m => { m.snapshot.path = "../src/data.json"; }, m => { m.version = 2; },
    m => { m.runtimeSha256 = "b".repeat(64); }, m => { m.snapshot.bytes++; }, m => { m.extra = true; }]) {
    const manifest = structuredClone(state.manifest); change(manifest); write(state.manifestPath, JSON.stringify(manifest));
    assert.throws(() => readSeparateDataBundle({ projectDir: state.root }), /bundle/u);
  }
});

test("bundle validation rejects live marker ambiguity, escapes, and symlinked inputs", t => {
  const state = fixture(t);
  const invalid = state.html.replace('<meta name="data-app-build-layout"', '<meta name="data-app-build-layout" content="separate-data-v1"><meta name="data-app-build-layout"');
  write(join(state.root, "dist/index.html"), invalid);
  write(state.manifestPath, JSON.stringify({ ...state.manifest, html: { ...state.manifest.html, bytes: Buffer.byteLength(invalid), sha256: sha256(invalid) } }));
  assert.throws(() => readSeparateDataBundle({ projectDir: state.root }), /bundle/u);
  write(join(state.root, "dist/index.html"), state.html); write(state.manifestPath, JSON.stringify(state.manifest));
  assert.throws(() => readSeparateDataBundle({ projectDir: state.root, manifestPath: "../data-app-build.json" }), /bundle/u);
  assert.throws(() => readSeparateDataBundle({ projectDir: state.root, manifestPath: join(dirname(state.root), "data-app-build.json") }), /bundle/u);
  write(join(state.root, "raw.json"), state.bytes); rmSync(state.snapshotPath); symlinkSync(join(state.root, "raw.json"), state.snapshotPath);
  assert.throws(() => readSeparateDataBundle({ projectDir: state.root }), /bundle/u);
});

test("malformed manifest and bootstrap errors do not expose input text", t => {
  const state = fixture(t);
  write(state.manifestPath, '{"password":"synthetic-sensitive-value",broken}');
  assert.throws(() => readSeparateDataBundle({ projectDir: state.root }), error => /bundle/u.test(error.message) && !/password|sensitive/u.test(error.message));
});

test("offline export streams all rows and escaping across UTF-8 boundaries without fetching or recompiling", async t => {
  const snapshot = structuredClone(SNAPSHOT);
  snapshot.queries.q.rows = Array.from({ length: 20001 }, (_, value) => ({ value, text: "é😀</script>\u2028\u2029" }));
  snapshot.queries.q.rows[0].value = 42;
  const raw = Buffer.from(`\ufeff${JSON.stringify(snapshot, null, 2)}\n`), state = fixture(t, raw);
  write(join(state.root, "src/data.json"), JSON.stringify({ queries: {} }));
  const exported = await exportOfflineDataApp({ projectDir: state.root, outputPath: ".data-app-offline/exports/reviewed.html" });
  const html = readFileSync(exported.htmlPath, "utf8"), inspection = inspectDataAppDocument(html);
  assert.equal(sha256(html), exported.htmlSha256); assert.equal(Buffer.byteLength(html), exported.htmlBytes);
  assert.equal(inspection.metadata.some(meta => meta.names.includes("data-app-local-snapshot") || meta.names.includes("data-app-build-layout")), false);
  const parts = [...html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/gu)].map(match => match[1]);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.length <= 6 * 65536), "Each escaped DOM string stays bounded");
  assert.deepEqual(JSON.parse(parts.join("")), snapshot); assert.doesNotMatch(parts.join(""), /[<\u2028\u2029]/u);
  const { context } = execute(html);
  assert.equal(context.moduleValue, 42); assert.equal(context.moduleRows, 20001); assert.equal(context.mounts.length, 1);
  assert.deepEqual(readFileSync(state.snapshotPath), raw);
});

test("encoded streaming bootstraps retain bounded offline data elements", async t => {
  const snapshot = structuredClone(SNAPSHOT);
  snapshot.queries.q.rows = Array.from({ length: 20001 }, (_, value) => ({ value }));
  const state = fixture(t, Buffer.from(JSON.stringify(snapshot)), html => {
    const start = html.lastIndexOf("<script>"), end = html.indexOf("</script>", start);
    const encoded = Buffer.from(html.slice(start + 8, end)).toString("base64");
    return html.slice(0, start) + `<script src="data:text/javascript;charset=utf-8;base64,${encoded}"></script>` + html.slice(end + 9);
  });
  const result = await exportOfflineDataApp({ projectDir: state.root });
  const html = readFileSync(result.htmlPath, "utf8");
  assert.match(html, /<script type="application\/json" data-app-snapshot-chunk>/u);
  assert.equal(execute(html).context.moduleRows, 20001);
});

test("older compiled bootstraps export complete data without requiring a runtime upgrade", async t => {
  const snapshot = structuredClone(SNAPSHOT);
  snapshot.queries.q.rows = Array.from({ length: 20001 }, (_, value) => ({ value }));
  snapshot.queries.q.rows[0].value = 42;
  const state = fixture(t, Buffer.from(JSON.stringify(snapshot)), html => html
    .replace(/const continuation = document\.querySelectorAll\([^\n]+\n/u, "")
    .replace(/const reviewedSnapshot = continuation\.length[^\n]+\n/u, "const reviewedSnapshot = JSON.parse(snapshotElement.textContent);\n"));
  const result = await exportOfflineDataApp({ projectDir: state.root });
  const html = readFileSync(result.htmlPath, "utf8");
  assert.doesNotMatch(html, /<script type="application\/json" data-app-snapshot-chunk>/u);
  assert.deepEqual(JSON.parse(inspectDataAppDocument(html).embedded), snapshot);
  const { context } = execute(html);
  assert.equal(context.moduleRows, 20001);
});

test("post-publication export reads only the hash-bound preserved bundle and refuses stale recovery", async t => {
  const state = fixture(t), preserved = join(state.root, ".data-app-offline/separate-v1");
  cpSync(join(state.root, "dist"), preserved, { recursive: true });
  rmSync(join(state.root, "dist"), { recursive: true });
  const hosted = "<html>Reviewed hosted page</html>";
  write(join(state.root, "dist/index.html"), hosted);
  write(join(state.root, "src/data.json"), '{"queries":{}}');
  const publication = { version: 1, source: { layout: "separate-data-v1", buildManifestPath: ".data-app-offline/separate-v1/data-app-build.json",
    htmlSha256: state.manifest.html.sha256, snapshotSha256: state.manifest.snapshot.sha256 },
    assets: { html: { sha256: sha256(hosted), bytes: Buffer.byteLength(hosted) }, snapshot: state.manifest.snapshot } };
  write(join(state.root, ".data-app-assets/manifest.json"), JSON.stringify(publication));
  assert.equal(resolveSeparateDataBundle({ projectDir: state.root }).snapshotPath, join(preserved, state.manifest.snapshot.path));
  const result = await exportOfflineDataApp({ projectDir: state.root });
  assert.equal(result.htmlPath, join(state.root, ".data-app-offline/exports/data-app-offline.html"));
  assert.deepEqual(JSON.parse(inspectDataAppDocument(readFileSync(result.htmlPath, "utf8")).embedded), SNAPSHOT);
  write(join(state.root, "dist/index.html"), `${hosted}changed`);
  await assert.rejects(exportOfflineDataApp({ projectDir: state.root }), /bundle/u);
  assert.equal(sha256(readFileSync(result.htmlPath)), result.htmlSha256);
});

test("offline output cannot overwrite source, build, preserved bundle, or symlink targets", async t => {
  const state = fixture(t);
  for (const outputPath of ["src/custom.html", "dist/export.html", ".data-app-offline/separate-v1/export.html", "../export.html", "data-app-offline.html", "exports/reviewed.html", ".data-app-offline/exports/../outside.html", ".data-app-offline/exports-lookalike/file.html", ".data-app-offline/exports/raw.json"]) {
    await assert.rejects(exportOfflineDataApp({ projectDir: state.root, outputPath }), /\.data-app-offline\/exports\//u);
  }
  write(join(state.root, ".data-app-offline/exports/unchanged.html"), "original");
  symlinkSync(join(state.root, ".data-app-offline/exports/unchanged.html"), join(state.root, ".data-app-offline/exports/export.html"));
  await assert.rejects(exportOfflineDataApp({ projectDir: state.root, outputPath: ".data-app-offline/exports/export.html" }));
  assert.equal(readFileSync(join(state.root, ".data-app-offline/exports/unchanged.html"), "utf8"), "original");
});

test("a snapshot changed during streaming leaves the previous offline export intact", t => {
  const state = fixture(t), output = join(state.root, ".data-app-offline/exports/data-app-offline.html"), script = join(state.root, "changed-input.mjs");
  write(output, "previous reviewed export");
  write(script, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const original = fs.createReadStream;
fs.createReadStream = function(path, ...args) {
  fs.writeFileSync(path, ${JSON.stringify(Buffer.from(JSON.stringify(SNAPSHOT)).toString().replace('"value":42', '"value":43'))});
  return original.call(this, path, ...args);
};
syncBuiltinESMExports();
const { exportOfflineDataApp } = await import(${JSON.stringify(new URL("../scripts/data-app-separate.mjs", import.meta.url).href)});
await exportOfflineDataApp({projectDir: ${JSON.stringify(state.root)}});
`);
  const result = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.error, undefined); assert.notEqual(result.status, 0); assert.match(result.stderr, /bundle is missing, invalid, or changed/u);
  assert.equal(readFileSync(output, "utf8"), "previous reviewed export");
});

test("publication source projection requires exactly the pinned hydrated bytes", t => {
  const state = fixture(t);
  write(join(state.root, ".openai/data-app-publication-source.json"), JSON.stringify({ version: 1, kind: "data-app-publication-source-v1",
    sourceSnapshotSha256: state.manifest.snapshot.sha256, snapshot: state.manifest.snapshot }));
  assert.throws(() => assertHydratedPublicationSource(state.root), /exact verified snapshot hydration/u);
  write(join(state.root, "src/data.json"), '{"queries":{}}');
  assert.throws(() => assertHydratedPublicationSource(state.root), /exact verified snapshot hydration/u);
  write(join(state.root, "src/data.json"), state.bytes);
  assert.doesNotThrow(() => assertHydratedPublicationSource(state.root));
});

test("a valid separate bundle from another snapshot cannot override a hydrated projection pin", async t => {
  const state = fixture(t), other = fixture(t, Buffer.from(JSON.stringify({ ...SNAPSHOT, title: "Different reviewed snapshot" })));
  write(join(state.root, ".openai/data-app-publication-source.json"), JSON.stringify({ version: 1, kind: "data-app-publication-source-v1",
    sourceSnapshotSha256: state.manifest.snapshot.sha256, snapshot: state.manifest.snapshot }));
  write(join(state.root, "src/data.json"), state.bytes);
  cpSync(join(other.root, "dist"), join(state.root, "dist"), { recursive: true });
  write(join(state.root, ".data-app-offline/exports/data-app-offline.html"), "preserved export");
  assert.throws(() => readSeparateDataBundle({ projectDir: state.root }), /bundle/u);
  await assert.rejects(exportOfflineDataApp({ projectDir: state.root }), /bundle/u);
  assert.equal(readFileSync(join(state.root, ".data-app-offline/exports/data-app-offline.html"), "utf8"), "preserved export");
});

test("invalid source JSON diagnostics do not retain parser excerpts or causes", () => {
  assert.throws(() => assemble(Buffer.from('{"queries":{},"password":"synthetic-sensitive-value", broken}')), error =>
    error.message === "The reviewed Data app snapshot must be valid UTF-8 JSON." && error.cause === undefined);
});
