import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { assembleDataAppHtml } from "../scripts/data-app-build.mjs";
import { exportOfflineDataApp, readSeparateDataBundle } from "../scripts/data-app-separate.mjs";
import { documentSnapshot, inspectDataAppDocument } from "../skills/publish-artifact-to-sites/scripts/publication-assets.mjs";
import { createPublicationSource } from "../skills/publish-artifact-to-sites/scripts/publication-source.mjs";
import { createStreamingJsonParser } from "../templates/data-app/base/src/streaming-json.js";
import { fixture, packageDataApp } from "./data-app-sites-package-fixtures.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const runtimeHash = "a".repeat(64);
const syntheticCredential = "sk-proj-" + "a".repeat(24);
const rawJson = value => JSON.stringify(value, null, 2) + "\n";
const safeJson = text => text.replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
const fixtureOptions = {
  appCode: "globalThis.CodexDataAppRuntime = {apiVersion:1,mount(options){globalThis.reviewedMount = options;}};",
  protectedStyles: ".protected{color:blue}", printStyles: "@media print{.printed{color:black}}",
  authored: { themeCss: ":root{--accent:red}", conventionalCss: ".conventional{color:green}", importedCss: ".source-control{color:purple}",
    factorySource: "(function(runtime,snapshot){const completeRows=snapshot.queries.reviewed.rows;return {DashboardContent(){return completeRows;},ReportContent(){return snapshot;}};})" },
  runtimeSha256: runtimeHash,
};
function snapshot(rowCount = 4) {
  return { id: "split-reviewed-artifact", title: "Reviewed split dashboard", surface: "dashboard", buildStatus: "complete", generatedAt: "2026-09-07T00:00:00Z",
    queries: { reviewed: { title: "Complete real-shaped results", source: { sql: "SELECT date, amount, note FROM reviewed_source", status: "available" },
      rows: Array.from({ length: rowCount }, (_, index) => ({ date: "2026-09-07", amount: index / 7, note: `café 日本語 🧪 row ${index}`, optional: null })) },
    empty: { title: "A legitimate empty result", rows: [] }, unavailable: { status: "permission_denied", error: "Missing permissions.", rows: [] } } };
}
function writeSplit(item, raw = rawJson(snapshot())) {
  const bytes = Buffer.from(raw), snapshotSha256 = hash(bytes), snapshotPath = `snapshot.${snapshotSha256}.json`;
  const { html } = assembleDataAppHtml({ ...fixtureOptions, snapshotBytes: bytes, separateData: true });
  const manifest = { version: 1, kind: "separate-data-v1", html: { path: "index.html", sha256: hash(html), bytes: Buffer.byteLength(html) },
    snapshot: { path: snapshotPath, sha256: snapshotSha256, bytes: bytes.length }, runtimeSha256: runtimeHash, sourceSnapshotSha256: snapshotSha256 };
  writeFileSync(join(item.project, "src/data.json"), bytes);
  writeFileSync(join(item.project, "dist/index.html"), html);
  writeFileSync(join(item.project, "dist", snapshotPath), bytes);
  writeFileSync(join(item.project, "dist/data-app-build.json"), rawJson(manifest));
  return { raw, bytes, html, manifest, snapshotPath: join(item.project, "dist", snapshotPath), manifestPath: join(item.project, "dist/data-app-build.json") };
}
function state(t, raw) {
  const item = fixture();
  t.after(() => { rmSync(item.project, { recursive: true, force: true }); rmSync(join(dirname(item.helperPath), "../../.."), { recursive: true, force: true }); });
  return { ...item, split: writeSplit(item, raw) };
}
function packaged(item) { return JSON.parse(packageDataApp(item)); }
function configuration(project) {
  const worker = readFileSync(join(project, "dist/server/index.js"), "utf8"), prefix = "\nexport default createDataAppWorker(JSON.parse(";
  return JSON.parse(JSON.parse(worker.slice(worker.lastIndexOf(prefix) + prefix.length, -4)));
}
function files(root, directory = root) {
  const result = {};
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry), key = relative(root, path), stat = lstatSync(path);
    if (stat.isSymbolicLink()) result[key] = { symlink: readlinkSync(path) };
    else if (stat.isDirectory()) Object.assign(result, files(root, path));
    else result[key] = { bytes: stat.size, sha256: hash(readFileSync(path)) };
  }
  return result;
}
function rejection(item, before = files(item.project), pattern = /separate Data app|regular files|symlinks|ENOENT/) {
  assert.throws(() => packageDataApp(item), error => {
    assert.match(error.stderr.toString(), pattern);
    assert.ok(!error.stderr.toString().includes(syntheticCredential), "Failure diagnostics must not echo matched credential values");
    return true;
  });
  assert.deepEqual(files(item.project), before, "Rejected publication must leave every existing file and symlink unchanged");
}
function changeManifest(item, transform) {
  const manifest = JSON.parse(readFileSync(item.split.manifestPath)); transform(manifest);
  writeFileSync(item.split.manifestPath, rawJson(manifest));
}

test("actual split assembler output packages full raw bytes with canonical seed identity and no data sidecar in dist", t => {
  const item = state(t, rawJson(snapshot(18_000))), result = packaged(item), config = configuration(item.project);
  assert.equal(result.layout, "separate-data-v1");
  assert.equal(result.snapshotSource, "separate-data-manifest");
  assert.equal(result.scanStats.complete, true);
  assert.equal(result.offlineHtmlPath, null);
  assert.equal(result.snapshotSha256, hash(item.split.bytes));
  assert.equal(config.seedSnapshotSha256, hash(JSON.stringify(JSON.parse(item.split.raw))));
  assert.notEqual(config.seedSnapshotSha256, result.snapshotSha256, "Raw formatting identity is separate from the canonical stored seed identity");
  assert.deepEqual(readFileSync(result.assetFiles.snapshot), item.split.bytes);
  const manifest = JSON.parse(readFileSync(result.assetManifestPath));
  assert.equal(manifest.seedSnapshotSha256, config.seedSnapshotSha256);
  assert.deepEqual(manifest.snapshotResponse, { sha256: hash(item.split.bytes), bytes: item.split.bytes.length,
    queryCount: 3, rowCount: 18_000, encoding: "indexed-raw-v1" });
  const canonical = JSON.stringify(JSON.parse(item.split.raw));
  assert.deepEqual(manifest.legacySnapshotResponse, { sha256: hash(canonical), bytes: Buffer.byteLength(canonical),
    queryCount: 3, rowCount: 18_000 });
  assert.equal(config.snapshotIndex.sha256, manifest.assets.snapshot.sha256);
  assert.equal(config.snapshotIndex.bytes, manifest.assets.snapshot.bytes);
  assert.equal(JSON.parse(item.split.bytes.subarray(...config.snapshotIndex.queries.reviewed.rows)).length, 18_000);
  assert.equal(manifest.snapshotResponse.queryCount, 3);
  assert.equal(manifest.snapshotResponse.rowCount, 18_000);
  assert.ok(result.workerBytes < 12_000, "Fixture Worker code remains independent of full data size");
  assert.equal(Object.hasOwn(config, "seedSnapshot"), false);
  assert.equal(Object.hasOwn(config, "html"), false);
  const hosted = readFileSync(join(item.project, "dist/index.html"), "utf8");
  assert.ok(hosted.includes(fixtureOptions.authored.factorySource));
  assert.ok(hosted.includes(fixtureOptions.appCode));
  assert.doesNotMatch(hosted, /row 17999/);
  assert.ok(!inspectDataAppDocument(hosted).metadata.some(meta => meta.names.some(name => ["data-app-local-snapshot", "data-app-build-layout"].includes(name))));
  assert.deepEqual(JSON.parse(documentSnapshot(hosted).embedded).queries, {});
  assert.deepEqual(Object.keys(files(join(item.project, "dist"))).sort(), [".openai/hosting.json", "index.html", "server/index.js"]);
  const preserved = readSeparateDataBundle({ projectDir: item.project, manifestPath: result.buildManifestPath });
  assert.deepEqual(preserved.htmlBytes, Buffer.from(item.split.html));
  assert.deepEqual(readFileSync(preserved.snapshotPath), item.split.bytes);
  assert.deepEqual(JSON.parse(readFileSync(preserved.manifestPath)), item.split.manifest);
});

test("repeat publication uses the exact compiled split evidence after mutable src data changes", t => {
  const item = state(t), first = packaged(item), previousFiles = files(item.project);
  writeFileSync(join(item.project, "src/data.json"), '{"id":"new-unreviewed-source","queries":{}}\n');
  const afterEdit = files(item.project), repeated = packaged(item);
  assert.deepEqual(repeated.deploymentAssets, first.deploymentAssets);
  assert.equal(repeated.seedSnapshotSha256, first.seedSnapshotSha256);
  assert.deepEqual(readFileSync(repeated.assetFiles.snapshot), item.split.bytes);
  for (const [path, descriptor] of Object.entries(previousFiles)) {
    if (path !== "src/data.json") assert.deepEqual(files(item.project)[path], descriptor, path);
  }
  assert.deepEqual(files(item.project)["src/data.json"], afterEdit["src/data.json"], "Publication does not rewrite later authoring work");
});

test("missing, malformed, stale or escaping split manifests never fall back to empty bootstrap data", async t => {
  const cases = [
    ["missing manifest", item => rmSync(item.split.manifestPath)],
    ["invalid manifest JSON", item => writeFileSync(item.split.manifestPath, '{"invalid')],
    ["unknown version", item => changeManifest(item, m => m.version = 2)],
    ["unknown field", item => changeManifest(item, m => m.extra = "unsupported")],
    ["stale HTML", item => writeFileSync(join(item.project, "dist/index.html"), item.split.html + "<!-- altered -->")],
    ["stale snapshot", item => writeFileSync(item.split.snapshotPath, item.split.raw + " ")],
    ["missing snapshot", item => rmSync(item.split.snapshotPath)],
    ["escaping snapshot path", item => changeManifest(item, m => m.snapshot.path = "../../private.json")],
    ["absolute snapshot path", item => changeManifest(item, m => m.snapshot.path = item.split.snapshotPath)],
    ["altered layout marker", item => writeFileSync(join(item.project, "dist/index.html"), item.split.html.replace('content="separate-data-v1"', 'content="unknown-layout"'))],
    ["removed layout marker", item => writeFileSync(join(item.project, "dist/index.html"), item.split.html.replace('<meta name="data-app-build-layout" content="separate-data-v1">', ""))],
    ["removed layout and local marker", item => writeFileSync(join(item.project, "dist/index.html"), item.split.html.replace('<meta name="data-app-build-layout" content="separate-data-v1">', "").replace(`<meta name="data-app-local-snapshot" content="${item.split.manifest.snapshot.path}">`, ""))],
  ];
  for (const [name, mutate] of cases) await t.test(name, t => { const item = state(t); mutate(item); rejection(item); });
});

test("split inputs and preserved output paths refuse symlinks without touching their targets", async t => {
  for (const target of ["snapshot", "manifest", "html", "preserved-directory"]) await t.test(target, t => {
    const item = state(t), unrelated = join(item.project, "unrelated"); mkdirSync(unrelated);
    if (target === "preserved-directory") {
      mkdirSync(join(item.project, ".data-app-offline"));
      symlinkSync(unrelated, join(item.project, ".data-app-offline/separate-v1"), "dir");
    } else {
      const path = target === "snapshot" ? item.split.snapshotPath : target === "manifest" ? item.split.manifestPath : join(item.project, "dist/index.html");
      const other = join(unrelated, target); writeFileSync(other, readFileSync(path)); rmSync(path); symlinkSync(other, path);
    }
    rejection(item);
  });
});

test("external raw data is scanned completely for late literals, keys, metadata and encoded inline credentials", async t => {
  const late = "reviewed analytical text ".repeat(14_000);
  const cases = [
    ["late literal", seed => { seed.queries.reviewed.rows[3].note = late + syntheticCredential; }],
    ["literal in a key", seed => { seed.queries.reviewed.rows[3][syntheticCredential] = "ordinary value"; }],
    ["late sensitive field", seed => { seed.queries.reviewed.rows[3].note = late; seed.queries.reviewed.rows[3].api_key = "synthetic-nonempty-test-value"; }],
    ["generic metadata field", seed => { seed.queries.reviewed.source.token = "synthetic-metadata-value"; }],
    ["base64 inline credential", seed => { seed.queries.reviewed.rows[3].note = "data:text/javascript;base64," + Buffer.from(`const value="${syntheticCredential}"`).toString("base64"); }],
    ["percent inline JSON credential", seed => { seed.queries.reviewed.rows[3].note = "data:application/json," + encodeURIComponent('{"authorization":"synthetic-value"}'); }],
  ];
  for (const [name, mutate] of cases) await t.test(name, t => {
    const seed = snapshot(); mutate(seed); const item = state(t, rawJson(seed));
    rejection(item, files(item.project), /Publication contains a possible credential/);
  });
  await t.test("overwritten duplicate value remains in published raw bytes", t => {
    const raw = rawJson(snapshot()).replace('"optional": null', `"overwritten": "${syntheticCredential}", "overwritten": "", "optional": null`);
    assert.equal(JSON.parse(raw).queries.reviewed.rows[0].overwritten, "");
    const item = state(t, raw); rejection(item, files(item.project), /Publication contains a possible credential/);
  });
  await t.test("JSON-escaped overwritten duplicate value remains in published raw bytes", t => {
    const escaped = "\\u0073" + syntheticCredential.slice(1);
    const raw = rawJson(snapshot()).replace('"optional": null', `"overwritten": "${escaped}", "overwritten": "", "optional": null`);
    assert.equal(JSON.parse(raw).queries.reviewed.rows[0].overwritten, "");
    const item = state(t, raw); rejection(item, files(item.project), /Publication contains a possible credential/);
  });
  for (const encoding of ["base64", "percent"]) await t.test(`JSON-escaped overwritten ${encoding} data URL remains in raw bytes`, t => {
    const uri = encoding === "base64"
      ? "\\u0064ata:text/javascript;base64," + Buffer.from(syntheticCredential).toString("base64")
      : "\\u0064ata:text/javascript," + Array.from(Buffer.from(syntheticCredential), byte => `%${byte.toString(16).padStart(2, "0")}`).join("");
    const raw = rawJson(snapshot()).replace('"optional": null', `"overwritten": "${uri}", "overwritten": "", "optional": null`);
    assert.equal(JSON.parse(raw).queries.reviewed.rows[0].overwritten, "");
    const item = state(t, raw); rejection(item, files(item.project), /Publication contains a possible credential/);
  });
  await t.test("overwritten ancestor metadata remains sensitive beside legitimate analytical token columns", t => {
    const raw = rawJson(snapshot()).replace('"source": {', '"source": {"token":"synthetic-metadata-value"}, "source": {');
    const item = state(t, raw); rejection(item, files(item.project), /Publication contains a possible credential/);
  });
});

test("ordinary analytical token metrics remain allowed after data separation", t => {
  const seed = snapshot(); seed.queries.reviewed.rows[0].token = "completion"; seed.queries.reviewed.rows[0].secret = "metric-category";
  const item = state(t, rawJson(seed)), result = packaged(item);
  assert.deepEqual(JSON.parse(readFileSync(result.assetFiles.snapshot)), seed);
  assert.equal(result.scanStats.complete, true);
});

test("JSON escape spelling cannot weaken the standalone credential coverage when data moves outside HTML", async t => {
  const cases = [
    ["escaped data URL prefix", () => {
      const seed = snapshot(); seed.queries.reviewed.rows[3].note = "data:text/javascript;base64," + Buffer.from(`const value="${syntheticCredential}"`).toString("base64");
      return rawJson(seed).replace("data:text/javascript", "\\u0064ata:text/javascript");
    }],
    ["escaped credential literal in a key", () => {
      const seed = snapshot(); seed.queries.reviewed.rows[3][syntheticCredential] = "ordinary value";
      return rawJson(seed).replace(syntheticCredential, "\\u0073" + syntheticCredential.slice(1));
    }],
  ];
  for (const [name, makeRaw] of cases) await t.test(name, t => {
    const raw = makeRaw(), legacy = state(t, raw), split = state(t, raw);
    rmSync(legacy.split.manifestPath); rmSync(legacy.split.snapshotPath);
    writeFileSync(join(legacy.project, "dist/index.html"), assembleDataAppHtml({ ...fixtureOptions, snapshotBytes: Buffer.from(raw) }).html);
    rejection(legacy, files(legacy.project), /Publication contains a possible credential/);
    rejection(split, files(split.project), /Publication contains a possible credential/);
  });
});

test("late package installation failure rolls back existing outputs, split inputs and removals", t => {
  const item = state(t);
  for (const [path, content] of [
    ["dist/server/index.js", "previous Worker bytes"],
    [".data-app-assets/html.html", "previous hosted HTML"],
    [".data-app-assets/snapshot.json", "previous asset snapshot"],
    [".data-app-assets/manifest.json", '{"version":1,"thinBootstrap":false}'],
    [".data-app-offline/separate-v1/index.html", "previous preserved HTML"],
    [".data-app-offline/separate-v1/data-app-build.json", "previous preserved manifest"],
  ]) { mkdirSync(dirname(join(item.project, path)), { recursive: true }); writeFileSync(join(item.project, path), content); }
  // The last output cannot replace a directory. This fails after installation
  // has already replaced prior outputs and removed the original split inputs.
  mkdirSync(join(item.project, "dist/.openai/hosting.json"), { recursive: true });
  const before = files(item.project);
  rejection(item, before, /Package outputs must replace regular files/);
  assert.deepEqual(readFileSync(item.split.snapshotPath), item.split.bytes);
  assert.equal(existsSync(item.split.manifestPath), true);
  assert.ok(!readdirSync(item.project).some(name => name.startsWith(".data-app-package-")), "Completed rollback removes temporary backups");
});

test("post-publication export reconstructs complete offline data from preserved inputs without rebuilding", async t => {
  const seed = snapshot(); seed.queries.reviewed.rows[1].note = "</script>\u2028\u2029 café";
  const item = state(t, rawJson(seed)), result = packaged(item);
  writeFileSync(join(item.project, "src/data.json"), "not the reviewed source anymore");
  const exported = await exportOfflineDataApp({ projectDir: item.project, outputPath: ".data-app-offline/exports/reviewed.html" });
  const html = readFileSync(exported.htmlPath, "utf8");
  const inspection = inspectDataAppDocument(item.split.html), element = inspection.snapshotElement;
  let expected = item.split.html.slice(0, element.contentStart) + safeJson(item.split.raw) + item.split.html.slice(element.contentEnd);
  expected = expected.replace('<meta name="data-app-build-layout" content="separate-data-v1">', "").replace(`<meta name="data-app-local-snapshot" content="${item.split.manifest.snapshot.path}">`, "");
  assert.equal(html, expected);
  assert.equal(exported.htmlSha256, hash(html));
  assert.equal(exported.snapshotSha256, result.snapshotSha256);
  assert.deepEqual(JSON.parse(documentSnapshot(html).embedded), seed);
  assert.ok(html.includes(fixtureOptions.authored.factorySource));
  assert.ok(html.includes(fixtureOptions.appCode));
  assert.ok(!inspectDataAppDocument(html).metadata.some(meta => meta.names.some(name => ["data-app-local-snapshot", "data-app-snapshot-storage"].includes(name))));
  const priorExport = readFileSync(exported.htmlPath);
  writeFileSync(join(item.project, ".data-app-offline/separate-v1", item.split.manifest.snapshot.path), "corrupted preserved data");
  await assert.rejects(exportOfflineDataApp({ projectDir: item.project, outputPath: ".data-app-offline/exports/reviewed.html" }), /separate Data app/);
  assert.deepEqual(readFileSync(exported.htmlPath), priorExport);
});

test("standalone and split packaging preserve parsed data and fingerprint their actual streamed bytes", t => {
  const seed = snapshot(), raw = rawJson(seed), split = state(t, raw), standalone = state(t, raw);
  rmSync(standalone.split.manifestPath); rmSync(standalone.split.snapshotPath);
  writeFileSync(join(standalone.project, "dist/index.html"), assembleDataAppHtml({ ...fixtureOptions, snapshotBytes: Buffer.from(raw) }).html);
  const a = packaged(split), b = packaged(standalone);
  const aManifest = JSON.parse(readFileSync(a.assetManifestPath)), bManifest = JSON.parse(readFileSync(b.assetManifestPath));
  for (const [result, manifest] of [[a, aManifest], [b, bManifest]]) {
    const bytes = readFileSync(result.assetFiles.snapshot);
    assert.deepEqual(manifest.snapshotResponse, { sha256: hash(bytes), bytes: bytes.length,
      queryCount: 3, rowCount: 4, encoding: "indexed-raw-v1" });
  }
  assert.notEqual(aManifest.snapshotResponse.sha256, bManifest.snapshotResponse.sha256,
    "The formatted raw source and compact standalone asset have distinct byte identities");
  assert.deepEqual(aManifest.legacySnapshotResponse, bManifest.legacySnapshotResponse);
  assert.equal(aManifest.legacySnapshotResponse.sha256, hash(JSON.stringify(seed)));
  assert.equal(a.seedSnapshotSha256, b.snapshotSha256);
  assert.deepEqual(JSON.parse(readFileSync(a.assetFiles.snapshot)), JSON.parse(readFileSync(b.assetFiles.snapshot)));
});


test("portable offline exports preserve every row but never enter publication source or its Git index", async t => {
  const seed = snapshot(12001), item = state(t, rawJson(seed)), baseline = state(t, rawJson(seed));
  const originalBuild = files(join(item.project, "dist"));
  const ordinaryHtml = "<p>Authored reference asset</p>";
  mkdirSync(join(item.project, "src/content"), { recursive: true });
  writeFileSync(join(item.project, "src/content/reference.html"), ordinaryHtml);
  const exported = await exportOfflineDataApp({ projectDir: item.project });
  const custom = await exportOfflineDataApp({ projectDir: item.project,
    outputPath: join(item.project, ".data-app-offline/exports/custom-review.html") });
  assert.equal(exported.htmlPath, join(item.project, ".data-app-offline/exports/data-app-offline.html"));
  for (const output of [exported, custom]) {
    const { embedded, snapshotChunks } = documentSnapshot(readFileSync(output.htmlPath, "utf8"));
    const parser = createStreamingJsonParser();
    for (const chunk of snapshotChunks ?? [embedded]) parser.write(chunk);
    assert.deepEqual(parser.finish(), seed);
  }
  assert.deepEqual(files(join(item.project, "dist")), originalBuild, "Export does not change any split build bytes");
  const result = packaged(item), baselineResult = packaged(baseline);
  assert.deepEqual(result.deploymentAssets, baselineResult.deploymentAssets);
  assert.deepEqual(readFileSync(result.serverPath), readFileSync(baselineResult.serverPath), "Export does not change packaged Worker bytes");
  const publicationProjectDir = `${item.project}-publication`;
  t.after(() => rmSync(publicationProjectDir, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd: item.project });
  const projection = await createPublicationSource({ authoringProjectDir: item.project, publicationProjectDir,
    projectId: result.projectId, sourceRevision: "a".repeat(40), siteUrl: null });
  assert.equal(existsSync(join(publicationProjectDir, ".data-app-offline")), false);
  assert.ok(!Object.keys(projection.manifest.files).some(name => name.startsWith(".data-app-offline/")));
  assert.equal(readFileSync(join(publicationProjectDir, "src/content/reference.html"), "utf8"), ordinaryHtml);
  const git = args => execFileSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd: publicationProjectDir, encoding: "utf8" });
  git(["init", "--quiet"]); git(["add", "-A"]);
  const indexed = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  assert.ok(indexed.includes("src/content/reference.html"), "Ordinary authored HTML remains source");
  assert.ok(indexed.includes(".openai/data-app-publication-source.json"));
  assert.ok(!indexed.some(name => name === "src/data.json" || name.startsWith("dist/") || name.startsWith(".data-app-")));
  assert.equal(existsSync(exported.htmlPath), true); assert.equal(existsSync(custom.htmlPath), true);
});

test("explicit on-demand CLI packaging preserves raw snapshots, canonical identity and repeatability", t => {
  const full = snapshot(12);
  full.filters = [{ id: "note", field: "note", queryIds: ["reviewed"] }];
  const item = state(t, rawJson(full));
  const before = packaged(item);
  const raw = readFileSync(before.assetFiles.snapshot);
  const enabled = JSON.parse(packageDataApp(item, { extra: ["--query-loading=on-demand"] }));
  const manifest = JSON.parse(readFileSync(enabled.assetManifestPath));
  const bootstrap = JSON.parse(documentSnapshot(readFileSync(enabled.assetFiles.html, "utf8")).embedded);
  assert.equal(enabled.queryLoading, "on-demand");
  assert.equal(manifest.queryLoading, "on-demand");
  assert.equal(bootstrap._dataAppQueryLoading.snapshotSha256, before.snapshotSha256);
  assert.equal(bootstrap._dataAppQueryLoading.queries.reviewed.rowCount, 12);
  assert.deepEqual(bootstrap._dataAppQueryLoading.queries.reviewed.columns, ["date", "amount", "note", "optional"]);
  assert.deepEqual(bootstrap._dataAppQueryLoading.filterChoices.note, full.queries.reviewed.rows.map(row => row.note));
  assert.ok(Object.values(bootstrap.queries).every(query => !Object.hasOwn(query, "rows")));
  assert.deepEqual(readFileSync(enabled.assetFiles.snapshot), raw);
  assert.equal(enabled.seedSnapshotSha256, before.seedSnapshotSha256);
  const repeated = JSON.parse(packageDataApp(item, { extra: ["--query-loading=on-demand"] }));
  assert.deepEqual(repeated.deploymentAssets, enabled.deploymentAssets);
  const disabled = packaged(item);
  assert.deepEqual(disabled.deploymentAssets, before.deploymentAssets);
  assert.equal(Object.hasOwn(disabled, "queryLoading"), false);
});

test("on-demand packaging still scans complete reviewed rows before changing any output", t => {
  const full = snapshot(2);
  full.queries.reviewed.rows[1].credential = syntheticCredential;
  const item = state(t, rawJson(full)), before = files(item.project);
  assert.throws(() => packageDataApp(item, { extra: ["--query-loading=on-demand"] }), error => {
    assert.match(error.stderr.toString(), /credential|secret/iu);
    assert.ok(!error.stderr.toString().includes(syntheticCredential));
    return true;
  });
  assert.deepEqual(files(item.project), before);
});
