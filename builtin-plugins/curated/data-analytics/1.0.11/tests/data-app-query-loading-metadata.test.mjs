import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createPublicationAssets, documentSnapshot, snapshotSeedFingerprint } from "../skills/publish-artifact-to-sites/scripts/publication-assets.mjs";
import { createPublicationSnapshotIndex } from "../skills/publish-artifact-to-sites/scripts/publication-snapshot-index.mjs";
import { packageDataAppForSites } from "../skills/publish-artifact-to-sites/scripts/package-data-app-for-sites.mjs";
import { objectSnapshotResponse } from "../templates/data-app/base/src/object-snapshot-storage.js";
import { fixtureDatabase, sqliteUnavailable } from "../templates/data-app/base/tests/snapshot-storage-fixture.mjs";
import { parseJsonBytes } from "../templates/data-app/base/src/streaming-json.js";
import { createSemanticColorMetadataAccumulator, semanticColorMetadata, semanticColorResolver } from "../templates/data-app/base/src/charting/chart-theme.js";
import { createDashboardFilterChoicesAccumulator, validFilterValue } from "../templates/data-app/base/src/dashboard-url-state.js";

const hash = value => createHash("sha256").update(value).digest("hex");
const queries = {
  first: { rows: [
    { plan: "Enterprise", place: "US", common: "Shared", revenue: 3 },
    { plan: "Plus", place: "CA", common: "Unique", cost: 4 },
    { plan: "Free", place: "FR", common: "Shared", cost: null },
  ] },
  second: { rows: [
    { plan: "Business", other: "Shared", amount: 6, ignored: "all" },
    { plan: "Plus", other: "New", when: "2026-09-08", url: "https://example.com" },
  ] },
  many: { rows: Array.from({ length: 30 }, (_, index) => ({ feature: `Feature ${index}`, [`measure${index}`]: index })) },
};
const descriptors = Object.values(queries).flatMap(query => query.rows.flatMap(row => Object.entries(row).flatMap(([field, value]) =>
  [{ dimension: field, value }, { field: value }, { field }]))).concat([
  { dimension: "place", value: "ZZ" }, { dimension: "place", value: "ZZ" },
  { dimension: "plan", value: "Future" }, { field: "Future metric" }, { field: "Shared" },
  { field: "Unique" }, { value: "churned" }, { field: "dau" }, { explicitColor: "#112233", value: "new" }, {},
]);

test("serialized palette preserves eager allocation, ambiguous categories and dynamic fallback", () => {
  const accumulator = createSemanticColorMetadataAccumulator();
  for (const query of Object.values(queries)) accumulator.addQuery((function* () { yield* query.rows; })());
  const metadata = JSON.parse(JSON.stringify(accumulator.finish()));
  assert.deepEqual(metadata, semanticColorMetadata(queries));
  const eager = semanticColorResolver(queries), deferred = semanticColorResolver({}, metadata);
  const actual = descriptors.map(descriptor => eager(descriptor));
  assert.deepEqual(descriptors.map(descriptor => deferred(descriptor)), actual);
  // Captured from the pre-refactor eager resolver, including palette overflow.
  assert.equal(hash(JSON.stringify(actual)), "345278eb1bd33a716dc26e19d38ebe09d018699a8b100242ce34d373f0be77e9");
  assert.ok(!metadata.categoryFields.some(([field]) => field === "Shared"));
});

test("complete filter metadata preserves scoped choices, sparse dates and URL validation", () => {
  const filters = [{ id: "plan", field: "plan", queryIds: ["second", "first"], multiple: true },
    { id: "when", field: "when", mode: "through", type: "date" },
    { id: "__proto__", field: "place", queryIds: ["first"] }];
  const snapshot = { filters, queries };
  const accumulator = createDashboardFilterChoicesAccumulator(filters);
  for (const [id, query] of Object.entries(queries)) for (const row of query.rows) accumulator.addRow(id, row);
  const filterChoices = JSON.parse(JSON.stringify(accumulator.finish()));
  assert.deepEqual(filterChoices.plan, ["Business", "Plus", "Enterprise", "Free"]);
  assert.deepEqual(filterChoices.__proto__, ["US", "CA", "FR"]);
  const partial = { filters, queries: {}, _dataAppQueryLoading: { version: 1, filterChoices } };
  for (const filter of filters) for (const value of ["all", "Plus", "US", "unknown", ["Plus", "Enterprise"], [], "2026-09-08..2026-09-08"]) {
    assert.equal(validFilterValue(partial, filter, value), validFilterValue(snapshot, filter, value));
  }
  assert.throws(() => createDashboardFilterChoicesAccumulator([{ id: "same" }, { id: "same" }]), /unique string/);
});

function assetsInput(raw) {
  const snapshotBytes = Buffer.from(raw);
  const seedSnapshot = parseJsonBytes(snapshotBytes, { discard: path => path.length === 3 && path[0] === "queries" && path[2] === "rows" });
  const { snapshotIndex } = createPublicationSnapshotIndex(snapshotBytes);
  const html = '<html><head><meta name="data-app-build-layout" content="separate-data-v1"><meta name="data-app-bootstrap" content="deferred-content-v1"></head><body><script id="data-app-reviewed-snapshot" type="application/json">{}</script><script>globalThis.keepApplicationBytes = true;</script></body></html>';
  return { html, seedSnapshot, snapshotBytes, indexedSnapshot: { bytes: snapshotBytes, snapshotIndex }, separateData: true, projectId: "appgprj_metadata" };
}

test("opted-in publication contains complete row-free metadata and preserves immutable bytes and seed identity", () => {
  const input = assetsInput('{ "id":"metadata", "title":"Exact reviewed title", "notes":"Keep notes", "filters":[{"id":"choice","field":"value"}], "queries":{"__proto__":{"source":{"sql":"SELECT value"},"rows":[{"value":1e999,"array":[1e999]},{"value":false},{"value":0},{"last":"kept"}]},"empty":{"rows":[]},"absent":{"source":{"label":"No rows"}}}}');
  const before = snapshotSeedFingerprint(input.seedSnapshot, input.indexedSnapshot);
  const eager = createPublicationAssets(input), lazy = createPublicationAssets({ ...input, queryLoading: "on-demand" });
  assert.deepEqual(lazy.bytes.snapshot, input.snapshotBytes);
  assert.deepEqual(lazy.deploymentAssets.snapshot, eager.deploymentAssets.snapshot);
  assert.deepEqual(snapshotSeedFingerprint(input.seedSnapshot, input.indexedSnapshot), before);
  const bootstrap = parseJsonBytes(Buffer.from(documentSnapshot(lazy.bytes.html.toString()).embedded));
  assert.equal(bootstrap.notes, "Keep notes");
  assert.equal(bootstrap.queries.__proto__.source.sql, "SELECT value");
  assert.ok(Object.values(bootstrap.queries).every(query => !Object.hasOwn(query, "rows")));
  assert.deepEqual(bootstrap._dataAppQueryLoading.queries.__proto__, { rowCount: 4, columns: ["value", "array", "last"] });
  assert.deepEqual(bootstrap._dataAppQueryLoading.queries.empty, { rowCount: 0, columns: [] });
  assert.deepEqual(bootstrap._dataAppQueryLoading.queries.absent, { rowCount: 0, columns: [] });
  assert.deepEqual(bootstrap._dataAppQueryLoading.filterChoices.choice, ["false", "0"]);
  assert.equal(bootstrap._dataAppQueryLoading.snapshotSha256, hash(input.snapshotBytes));
  assert.deepEqual(bootstrap._dataAppQueryLoading.colors, semanticColorMetadata(JSON.parse(input.snapshotBytes).queries));
  assert.ok(lazy.bytes.html.includes('globalThis.keepApplicationBytes = true;'));
  assert.equal(Object.hasOwn(eager, "queryLoading"), false);
  assert.deepEqual(JSON.parse(documentSnapshot(eager.bytes.html.toString()).embedded), { id: "metadata", title: "Exact reviewed title", surface: "dashboard", queries: {} });
});

test("declared payload strings leave reviewed data, real labels, filters and numeric measures intact", () => {
  const reviewed = { filters: [{ id: "payload", field: "payload" }], queries: {
    q: { payloadColumns: ["payload", "amount"], source: { sql: "SELECT payload, label, bracket, amount", tables: ["reviewed"] }, rows: [
      { payload: '{"points":[1,2]}', label: '["real","category"]', bracket: "[Unknown]", amount: 2 },
      { payload: '{"points":[3,4]}', label: "Ordinary category", bracket: "{Customer}", amount: 4 },
    ] },
  } };
  const input = assetsInput(JSON.stringify(reviewed));
  const before = snapshotSeedFingerprint(input.seedSnapshot, input.indexedSnapshot);
  const assets = createPublicationAssets({ ...input, queryLoading: "on-demand" });
  const bootstrap = JSON.parse(documentSnapshot(assets.bytes.html.toString()).embedded);
  const metadata = bootstrap._dataAppQueryLoading;
  assert.deepEqual(assets.bytes.snapshot, input.snapshotBytes);
  assert.deepEqual(JSON.parse(assets.bytes.snapshot), reviewed);
  assert.deepEqual(snapshotSeedFingerprint(input.seedSnapshot, input.indexedSnapshot), before);
  assert.deepEqual(bootstrap.queries.q.payloadColumns, reviewed.queries.q.payloadColumns);
  assert.deepEqual(bootstrap.queries.q.source, reviewed.queries.q.source);
  assert.deepEqual(metadata.queries.q, { rowCount: 2, columns: ["payload", "label", "bracket", "amount"] });
  assert.deepEqual(metadata.filterChoices.payload, reviewed.queries.q.rows.map(row => row.payload));
  for (const row of reviewed.queries.q.rows) assert.equal(validFilterValue(bootstrap, reviewed.filters[0], row.payload), true);
  assert.deepEqual(metadata.colors, semanticColorMetadata(reviewed.queries));
  const assignments = new Map(metadata.colors.assignments);
  for (const row of reviewed.queries.q.rows) {
    assert.equal(assignments.has(`payload:${row.payload}`), false);
    assert.ok(assignments.has(`label:${row.label}`));
    assert.ok(assignments.has(`bracket:${row.bracket}`));
  }
  assert.ok(new Map(metadata.colors.measureAssignments).has("amount"));
  assert.ok(!metadata.colors.categoryFields.some(([value]) => reviewed.queries.q.rows.some(row => row.payload === value)));

  // Owner edits retain the query declaration and recompute the reviewed palette.
  const edited = { q: { ...reviewed.queries.q, rows: [...reviewed.queries.q.rows,
    { payload: '{"points":[5]}', label: '{"literal":"category"}', bracket: "[Revised]", amount: 5 }] } };
  for (const current of [reviewed.queries, edited]) {
    const accumulator = createSemanticColorMetadataAccumulator();
    accumulator.addQuery(current.q.rows, current.q.payloadColumns);
    const eager = semanticColorResolver(current);
    const deferred = semanticColorResolver({}, JSON.parse(JSON.stringify(accumulator.finish())));
    const descriptors = current.q.rows.flatMap(row => [{ dimension: "label", value: row.label },
      { dimension: "bracket", value: row.bracket }, { field: "amount" }]);
    assert.deepEqual(descriptors.map(deferred), descriptors.map(eager));
    assert.deepEqual([...descriptors].reverse().map(deferred), [...descriptors].reverse().map(eager));
    assert.ok(!accumulator.finish().assignments.some(([identity]) => identity.startsWith("payload:")));
  }
});

test("payload declarations are query-scoped and global label ambiguity follows the remaining categories", () => {
  const value = '{"v":0}';
  const marked = {
    payload: { payloadColumns: ["shared"], rows: [{ shared: value }] },
    labels: { rows: [{ shared: "[Real label]", literal: value }] },
  };
  const unmarked = { ...marked, payload: { rows: marked.payload.rows } };
  assert.ok(!semanticColorMetadata(unmarked).categoryFields.some(([label]) => label === value));
  const metadata = semanticColorMetadata(marked), assignments = new Map(metadata.assignments);
  assert.ok(!assignments.has(`shared:${value}`));
  assert.ok(assignments.has("shared:[Real label]"));
  assert.equal(new Map(metadata.categoryFields).get(value), assignments.get(`literal:${value}`));
  const eager = semanticColorResolver(marked), deferred = semanticColorResolver({}, metadata);
  for (const descriptor of [{ field: value }, { dimension: "shared", value: "[Real label]" },
    { dimension: "shared", value }, { explicitColor: "#112233", value }]) {
    assert.equal(deferred(descriptor), eager(descriptor));
  }
});

test("query loading fails explicitly for unsupported formats and invalid options", () => {
  const input = assetsInput('{"queries":{"q":{"rows":[{"x":1}]}}}');
  assert.throws(() => createPublicationAssets({ ...input, queryLoading: "automatic" }), /Unsupported query loading/);
  assert.throws(() => createPublicationAssets({ ...input, queryLoading: "on-demand", indexedSnapshot: undefined }), /verified separate-data/);
  assert.throws(() => createPublicationAssets({ ...input, queryLoading: "on-demand", html: input.html.replace("deferred-content-v1", "eager") }), /verified separate-data/);
  assert.throws(() => createPublicationAssets({ ...input, queryLoading: "on-demand", separateData: false }), /verified separate-data/);
  assert.throws(() => packageDataAppForSites({ "query-loading": "on-demand", source: true }), /existing separate-data/);
  assert.throws(() => packageDataAppForSites({ "query-loading": "automatic" }), /existing separate-data/);
});

test("on-demand metadata scans larger-than-heap rows without retaining distinct declared payloads", () => {
  const result = execFileSync(process.execPath, ["--max-old-space-size=64", "--input-type=module", "-e", `
    import { createPublicationAssets, documentSnapshot } from ${JSON.stringify(new URL("../skills/publish-artifact-to-sites/scripts/publication-assets.mjs", import.meta.url).href)};
    import { createPublicationSnapshotIndex } from ${JSON.stringify(new URL("../skills/publish-artifact-to-sites/scripts/publication-snapshot-index.mjs", import.meta.url).href)};
    import { parseJsonBytes } from ${JSON.stringify(new URL("../templates/data-app/base/src/streaming-json.js", import.meta.url).href)};
    const row = JSON.stringify({ plan: "Enterprise", amount: 1,
      payload: JSON.stringify({ id: "00000000", points: "x".repeat(1024) }), ignoredUrl: "https://example.com" });
    const count = 100000, repeated = Buffer.alloc((row.length + 1) * count, row + ",");
    for (let index = 0; index < count; index++) repeated.write(String(index).padStart(8, "0"), index * (row.length + 1) + row.indexOf("00000000"));
    const snapshotBytes = Buffer.concat([Buffer.from('{"id":"bounded","queries":{"q":{"payloadColumns":["payload"],"rows":['), repeated.subarray(0, repeated.length - 1), Buffer.from(']}}}')]);
    const seedSnapshot = parseJsonBytes(snapshotBytes, { discard: path => path.length === 3 && path[0] === "queries" && path[2] === "rows" });
    const { snapshotIndex } = createPublicationSnapshotIndex(snapshotBytes);
    const html = '<html><head><meta name="data-app-build-layout" content="separate-data-v1"><meta name="data-app-bootstrap" content="deferred-content-v1"></head><body><script id="data-app-reviewed-snapshot" type="application/json">{}</script></body></html>';
    const result = createPublicationAssets({ html, seedSnapshot, snapshotBytes, indexedSnapshot: { bytes: snapshotBytes, snapshotIndex }, separateData: true, projectId: "appgprj_bounded", queryLoading: "on-demand" });
    const bootstrap = JSON.parse(documentSnapshot(result.bytes.html.toString()).embedded);
    console.log(JSON.stringify({ bytes: snapshotBytes.length, rowCount: bootstrap._dataAppQueryLoading.queries.q.rowCount, columns: bootstrap._dataAppQueryLoading.queries.q.columns, htmlBytes: result.bytes.html.length }));
  `], { encoding: "utf8", timeout: 60000 });
  const measured = JSON.parse(result);
  assert.ok(measured.bytes > 100_000_000);
  assert.equal(measured.rowCount, 100000);
  assert.deepEqual(measured.columns, ["plan", "amount", "payload", "ignoredUrl"]);
  assert.ok(measured.htmlBytes < 5000);
});


test("filter metadata matches the hosted eager response for overflowing numbers and nested array cells", { skip: sqliteUnavailable }, async t => {
  const input = assetsInput('{"id":"overflow","filters":[{"id":"number","field":"number"},{"id":"array","field":"array"}],"queries":{"q":{"rows":[{"number":1e999,"array":[1e999,"x"]},{"number":-1e999,"array":[-1e999]},{"number":-0,"array":[-0,"y"]}]}}}');
  const storage = fixtureDatabase(); t.after(() => storage.close());
  const response = await objectSnapshotResponse(storage.db, {}, new Response(input.snapshotBytes), input.indexedSnapshot.snapshotIndex, hash(input.snapshotBytes));
  const eager = await response.json();
  assert.deepEqual(eager.queries.q.rows, [{ number: null, array: [null, "x"] }, { number: null, array: [null] }, { number: 0, array: [0, "y"] }]);
  const assets = createPublicationAssets({ ...input, queryLoading: "on-demand" });
  const deferred = JSON.parse(documentSnapshot(assets.bytes.html.toString()).embedded);
  assert.deepEqual(deferred._dataAppQueryLoading.filterChoices, { number: ["0"], array: [",x", "0,y"] });
  for (const filter of eager.filters) for (const value of ["Infinity", "-Infinity", "0", ",x", "0,y", "Infinity,x", "all"]) {
    assert.equal(validFilterValue(deferred, filter, value), validFilterValue(eager, filter, value));
  }
  assert.equal(parseJsonBytes(input.snapshotBytes).queries.q.rows[0].number, Infinity, "Immutable reviewed bytes retain their original numeric spelling");
});
