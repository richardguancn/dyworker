import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { createPublicationAssets, documentSnapshot, externalizeSourceWorker, snapshotResponseFingerprint, snapshotSeedFingerprint } from "../skills/publish-artifact-to-sites/scripts/publication-assets.mjs";
import { createPublicationSnapshotIndex } from "../skills/publish-artifact-to-sites/scripts/publication-snapshot-index.mjs";
import { parseJsonBytes } from "../templates/data-app/base/src/streaming-json.js";
import { fixture, packageDataApp, fixtureWorkerSource } from "./data-app-sites-package-fixtures.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
function state(t) {
  const result = fixture();
  t.after(() => { rmSync(result.project, { recursive: true, force: true }); rmSync(join(dirname(result.helperPath), "../../.."), { recursive: true, force: true }); });
  return result;
}
function page(snapshot, { marker = "deferred-content-v1", code = "globalThis.reviewedApplication = true;" } = {}) {
  return `<!doctype html><html><head><meta name="data-app-bootstrap" content="${marker}"><meta name="data-app-local-thread" content="11111111-1111-4111-8111-111111111111"></head><body><main>Reviewed café</main><script type="application/json" id="data-app-reviewed-snapshot">${JSON.stringify(snapshot).replaceAll("<", "\\u003c")}</script><script>${code}</script></body></html>`;
}
function configuration(project) {
  const worker = readFileSync(join(project, "dist/server/index.js"), "utf8");
  const prefix = "\nexport default createDataAppWorker(JSON.parse(";
  return JSON.parse(JSON.parse(worker.slice(worker.lastIndexOf(prefix) + prefix.length, -4)));
}
function readAssets(project) {
  const manifest = JSON.parse(readFileSync(join(project, ".data-app-assets/manifest.json")));
  const assets = Object.fromEntries(Object.entries(manifest.assets).map(([kind, descriptor]) => [kind, readFileSync(join(project, ".data-app-assets", descriptor.path))]));
  return { manifest, assets };
}

test("large script attributes cannot exhaust the parser stack or obscure duplicate snapshot IDs", () => {
  const asset = "a".repeat(8_000_000);
  const html = `<html><head></head><body><script src="data:text/javascript;base64,${asset}"></script><script type='application/json' ID = data-app-reviewed-snapshot>{"queries":{}}</script></body></html>`;
  assert.equal(documentSnapshot(html).embedded, '{"queries":{}}');
  const ambiguous = html.replace("ID = data-app-reviewed-snapshot", `id="different" ID = data-app-reviewed-snapshot data-asset='${asset}'`);
  assert.throws(() => documentSnapshot(ambiguous), /one unambiguous ID/);
});

test("large deferred publication keeps full offline evidence and emits a descriptor-only Worker", t => {
  const item = state(t), snapshot = { id: "reviewed-app", title: "Reviewed café", surface: "dashboard", queries: { reviewed: { rows: Array.from({ length: 25_000 }, (_, index) => ({ index, note: `evidence-${index}-` + "x".repeat(150), value: index / 7 })), source: { sql: "SELECT index, note, value FROM reviewed" } } } };
  const code = "void 0;\n".repeat(2_300_000), original = page(snapshot, { code });
  assert.ok(Buffer.byteLength(original) > 20_000_000);
  writeFileSync(join(item.project, "dist/index.html"), original);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(), tokenHash = "7".repeat(64);
  const result = JSON.parse(packageDataApp(item, { extra: [`--deployment-token-sha256=${tokenHash}`, `--deployment-token-expires-at=${expiresAt}`] }));
  const { manifest, assets } = readAssets(item.project), configured = configuration(item.project);
  assert.equal(result.thinBootstrap, true);
  assert.equal(readFileSync(result.offlineHtmlPath, "utf8"), original);
  assert.equal(readFileSync(join(item.project, "dist/index.html"), "utf8"), assets.html.toString());
  assert.deepEqual(JSON.parse(assets.snapshot), snapshot);
  assert.deepEqual(JSON.parse(documentSnapshot(assets.html.toString()).embedded), { id: snapshot.id, title: snapshot.title, surface: "dashboard", queries: {} });
  assert.ok(assets.html.toString().includes(`<script>${code}</script>`), "all compiled application bytes must remain unchanged");
  assert.ok(!assets.html.includes("data-app-local-thread"));
  assert.ok(assets.html.includes('name="data-app-sites-project" content="appgprj_reviewed"'));
  assert.equal(Object.hasOwn(configured, "html"), false);
  assert.equal(Object.hasOwn(configured, "seedSnapshot"), false);
  assert.ok(result.workerBytes < 12_000, "fixture Worker size must be independent of data and HTML");
  assert.deepEqual(configured.deploymentUploadAuthorization, { sha256: tokenHash, expiresAt });
  for (const [kind, bytes] of Object.entries(assets)) {
    const descriptor = manifest.assets[kind];
    assert.equal(descriptor.sha256, sha256(bytes));
    assert.equal(descriptor.bytes, bytes.length);
    assert.equal(descriptor.key, `data-app/${kind}/${descriptor.sha256}`);
    assert.equal(existsSync(join(item.project, "dist", descriptor.path)), false);
  }
  assert.equal(manifest.snapshotResponse.rowCount, 25_000);
  assert.equal(manifest.snapshotResponse.queryCount, 1);
  assert.equal(JSON.parse(readFileSync(join(item.project, ".openai/hosting.json"))).r2, "BUCKET");
});

test("repackaging a thin page restores its verified full seed rather than publishing empty queries", t => {
  const item = state(t), snapshot = { id: "same-artifact", title: "Same reviewed page", queries: { first: { rows: [{ amount: 42 }] } } };
  const original = page(snapshot);
  writeFileSync(join(item.project, "dist/index.html"), original);
  const first = JSON.parse(packageDataApp(item));
  const repeated = JSON.parse(packageDataApp(item));
  assert.deepEqual(repeated.deploymentAssets, first.deploymentAssets);
  assert.deepEqual(JSON.parse(readAssets(item.project).assets.snapshot), snapshot);
  assert.equal(readFileSync(first.offlineHtmlPath, "utf8"), original);
  const before = readFileSync(join(item.project, "dist/server/index.js"));
  writeFileSync(first.offlineHtmlPath, "Changed offline original");
  assert.throws(() => packageDataApp(item), /offline Data app changed/);
  assert.deepEqual(readFileSync(join(item.project, "dist/server/index.js")), before);
  writeFileSync(first.offlineHtmlPath, original);
  const hosted = readFileSync(join(item.project, "dist/index.html"));
  writeFileSync(join(item.project, "dist/index.html"), Buffer.concat([hosted, Buffer.from("<!-- edited hosted page -->")]));
  assert.throws(() => packageDataApp(item), /verified full offline original/);
  assert.deepEqual(readFileSync(join(item.project, "dist/server/index.js")), before);
  assert.deepEqual(JSON.parse(readAssets(item.project).assets.snapshot), snapshot);
  writeFileSync(join(item.project, "dist/index.html"), hosted);
  rmSync(first.assetManifestPath);
  assert.throws(() => packageDataApp(item), /verified full offline original/);
  assert.deepEqual(readFileSync(join(item.project, "dist/server/index.js")), before);
});

test("offline snapshot continuations package complete data and disappear from the hosted bootstrap", t => {
  const item = state(t), snapshot = { id: "offline-app", queries: { q: { rows: [{ text: "café 🧪 ".repeat(12_000) }] } } };
  const canonical = JSON.stringify(snapshot), fragments = [];
  for (let offset = 0; offset < canonical.length; offset += 16_384) fragments.push(canonical.slice(offset, offset + 16_384));
  const contents = fragments.join('</script><script type="application/json" data-app-snapshot-chunk>');
  const original = page(snapshot).replace(JSON.stringify(snapshot), contents);
  writeFileSync(join(item.project, "dist/index.html"), original);
  assert.deepEqual(documentSnapshot(original).snapshotChunks, fragments);
  const result = JSON.parse(packageDataApp(item)), { assets } = readAssets(item.project);
  assert.equal(assets.snapshot.toString(), canonical);
  assert.ok(!assets.html.includes("data-app-snapshot-chunk"));
  assert.ok(!assets.html.includes("café 🧪"));
  assert.equal(readFileSync(result.offlineHtmlPath, "utf8"), original);
  assert.deepEqual(JSON.parse(packageDataApp(item)).deploymentAssets, result.deploymentAssets);
});

test("snapshot continuation markers reject ambiguous live scripts and ignore inert examples", () => {
  const primary = '<script id="data-app-reviewed-snapshot" type="application/json">{"queries":{}}</script>';
  const continuation = '<script type="application/json" data-app-snapshot-chunk> </script>';
  for (const html of [
    continuation + primary,
    primary + continuation.replace('type="application/json"', 'type="text/javascript"'),
    primary + continuation.replace('type="application/json"', 'type="application/json" TYPE="application/json"'),
    primary + continuation.replace('data-app-snapshot-chunk', 'data-app-snapshot-chunk="other"'),
    primary + continuation.replace('data-app-snapshot-chunk', 'data-app-snapshot-chunk data-app-snapshot-chunk'),
    primary + continuation.replace('data-app-snapshot-chunk', 'id="other" data-app-snapshot-chunk'),
    primary + continuation.replace('</script>', ''),
  ]) assert.throws(() => documentSnapshot(html), /unambiguous inert JSON script/u);
  assert.equal(documentSnapshot(`<!-- ${continuation} --><template>${continuation}</template><textarea>${continuation}</textarea>${primary}`).snapshotChunks, undefined);
  assert.throws(() => documentSnapshot(primary + continuation + primary), /only one embedded snapshot/u);
});

test("escaped credentials spanning exported JSON fragments fail before package outputs change", t => {
  const item = state(t);
  packageDataApp(item);
  const before = readFileSync(join(item.project, "dist/server/index.js"));
  const content = '{"id":"reviewed","queries":{},"source":{"api\\u005fkey":"inert-test-value"},"source":{}}';
  const split = content.indexOf("005f") + 2;
  const fragments = content.slice(0, split) + '</script><script type="application/json" data-app-snapshot-chunk>' + content.slice(split);
  writeFileSync(join(item.project, "dist/index.html"), page({}).replace('{}', fragments));
  assert.throws(() => packageDataApp(item), error => {
    assert.match(error.stderr.toString(), /Publication contains a possible credential/u);
    assert.ok(!error.stderr.toString().includes("inert-test-value"));
    return true;
  });
  assert.deepEqual(readFileSync(join(item.project, "dist/server/index.js")), before);
});

test("unmarked compiled clients remain complete external assets without interpreting their scripts", t => {
  const item = state(t), snapshot = { id: "custom", queries: { first: { rows: [{ value: "kept" }] } } };
  const original = page(snapshot, { marker: "unknown-custom-runtime", code: 'const opaque = "runtime.mount({reviewedSnapshot,";' });
  writeFileSync(join(item.project, "dist/index.html"), original);
  const result = JSON.parse(packageDataApp(item));
  assert.equal(result.thinBootstrap, false);
  assert.equal(readFileSync(join(item.project, "dist/index.html"), "utf8"), original);
  assert.deepEqual(JSON.parse(documentSnapshot(readAssets(item.project).assets.html.toString()).embedded), snapshot);
});

test("invalid upload hash, missing expiry, expired and overlong credentials fail before output changes", t => {
  const item = state(t);
  packageDataApp(item);
  const original = readFileSync(join(item.project, "dist/server/index.js"));
  const validHash = "a".repeat(64), future = new Date(Date.now() + 3_600_000).toISOString();
  for (const extra of [
    ["--deployment-token-sha256=RAW_SECRET_MUST_NOT_APPEAR", `--deployment-token-expires-at=${future}`],
    [`--deployment-token-sha256=${validHash}`],
    [`--deployment-token-expires-at=${future}`],
    [`--deployment-token-sha256=${validHash}`, "--deployment-token-expires-at=2020-01-01T00:00:00.000Z"],
    [`--deployment-token-sha256=${validHash}`, `--deployment-token-expires-at=${new Date(Date.now() + 24 * 3_600_000).toISOString()}`],
  ]) {
    assert.throws(() => packageDataApp(item, { extra }), error => {
      assert.match(error.stderr.toString(), /deployment upload authorization/);
      assert.ok(!error.stderr.toString().includes("RAW_SECRET_MUST_NOT_APPEAR"));
      return true;
    });
    assert.deepEqual(readFileSync(join(item.project, "dist/server/index.js")), original);
  }
});

test("readiness fingerprint matches the precise streamed metadata and row ordering", () => {
  const snapshot = { queries: { z: { rows: [{ text: "café", amount: 4 }, { amount: null }], label: "First" }, a: { name: "Empty" } }, title: "Review", generatedAt: null };
  const expected = '{"title":"Review","generatedAt":null,"queries":{"z":{"label":"First","rows":[{"text":"café","amount":4},{"amount":null}]},"a":{"name":"Empty","rows":[]}}}';
  assert.deepEqual(snapshotResponseFingerprint(snapshot), { sha256: sha256(expected), bytes: Buffer.byteLength(expected), queryCount: 2, rowCount: 2 });
  assert.deepEqual(snapshotResponseFingerprint({ queries: {} }), { sha256: sha256('{"queries":{}}'), bytes: 14, queryCount: 0, rowCount: 0 });
});

test("chunked publication assets and both fingerprints preserve canonical JSON bytes across metadata and row boundaries", () => {
  const text = "café 🧪 \u2028 \ud800 \\ \"".repeat(12_000);
  const snapshot = JSON.parse('{"queries":{"2":{"rows":[{"number":1e400,"text":' + JSON.stringify(text) + '}]},"1":{"description":' + JSON.stringify(text) + '}},"__proto__":{"reviewed":true},"title":"first","title":"last","negativeZero":-0}');
  const canonical = JSON.stringify(snapshot);
  assert.deepEqual(snapshotSeedFingerprint(snapshot), { sha256: sha256(canonical), bytes: Buffer.byteLength(canonical) });
  const assets = createPublicationAssets({ html: "<html><head></head><body>Reviewed</body></html>", seedSnapshot: snapshot, projectId: "reviewed" });
  assert.equal(assets.bytes.snapshot.toString(), canonical);
  const { queries, ...metadata } = snapshot;
  const ordered = { ...metadata, queries: Object.fromEntries(Object.entries(queries).map(([id, { rows = [], ...definition }]) => [id, { ...definition, rows }])) };
  const response = JSON.stringify(ordered);
  assert.deepEqual(snapshotResponseFingerprint(snapshot), { sha256: sha256(response), bytes: Buffer.byteLength(response), queryCount: 2, rowCount: 1 });
});

test("metadata-only publication reproduces complete canonical assets and legacy fingerprints with effective duplicate members", () => {
  const inputs = [
    '{"queries":{"bad":null},"z":1,"queries":{"10":{"rows":[{"before":1}],"title":"first","rows":[{"__proto__":{"safe":true},"2":-0,"1":1e400,"duplicate":"first","duplicate":"last"}],"title":"last"},"2":{"title":"empty"},"__proto__":{"rows":[],"source":{"b":2,"a":1}}},"a":2,"generatedAt":null}',
    '{"title":"reviewed","queries":{"2":{"title":"before","rows":[{"value":' + JSON.stringify('é 🧪 \\ "') + '}],"source":{"sql":"SELECT 1"}},"1":{"rows":[]}},"title":"last"}',
    '{"queries":{},"rows":[{"this":"is metadata"}]}',
  ];
  for (const raw of inputs) {
    const bytes = Buffer.from(raw), expected = JSON.parse(raw);
    const snapshot = parseJsonBytes(bytes, { discard: path => path.length === 3 && path[0] === "queries" && path[2] === "rows" });
    const { snapshotIndex } = createPublicationSnapshotIndex(bytes), indexedSnapshot = { bytes, snapshotIndex };
    assert.ok(Object.values(snapshot.queries).every(query => !query.rows || query.rows.length === 0));
    assert.deepEqual(snapshotSeedFingerprint(snapshot, indexedSnapshot), snapshotSeedFingerprint(expected));
    assert.deepEqual(snapshotResponseFingerprint(snapshot, indexedSnapshot), snapshotResponseFingerprint(expected));
    const assets = createPublicationAssets({ html: "<html><head></head></html>", seedSnapshot: snapshot, indexedSnapshot, projectId: "reviewed" });
    assert.equal(assets.bytes.snapshot.toString(), JSON.stringify(expected));
  }
});

test("source temporary entries externalize canonical bindings and preserve unrelated custom behavior", () => {
  const descriptors = { html: { key: "html", sha256: "1".repeat(64), bytes: 12 }, snapshot: { key: "snapshot", sha256: "2".repeat(64), bytes: 24 } };
  const custom = fixtureWorkerSource + '\nexport const customerBehavior = "retained";';
  const entry = externalizeSourceWorker(custom, descriptors);
  assert.ok(!entry.includes("?raw"));
  assert.ok(!entry.includes('"./data.json"'));
  assert.ok(entry.includes('export const customerBehavior = "retained";'));
  assert.throws(() => externalizeSourceWorker(custom + "\nconsole.log(seedSnapshot);", descriptors), /outside the supported factory/);
});
