import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createPublicationSnapshotIndex } from "../skills/publish-artifact-to-sites/scripts/publication-snapshot-index.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function indexedResponse(raw, index) {
  const changes = [...(index.replacements ?? [])];
  for (const query of Object.values(index.queries)) {
    if (!query.rows) changes.push({ start: query.end, end: query.end, text: `${query.empty ? "" : ","}"rows":[]` });
  }
  changes.sort((a, b) => a.start - b.start);
  let cursor = 0;
  const parts = [];
  for (const change of changes) {
    assert.ok(change.start >= cursor);
    parts.push(raw.subarray(cursor, change.start), Buffer.from(change.text));
    cursor = change.end;
  }
  return Buffer.concat([...parts, raw.subarray(cursor)]);
}
function check(text) {
  const raw = Buffer.from(text);
  const before = Buffer.from(raw);
  const result = createPublicationSnapshotIndex(raw);
  const { snapshotIndex: index, snapshotResponse: receipt } = result;
  const response = indexedResponse(raw, index);
  const expected = JSON.parse(text);
  for (const query of Object.values(expected.queries)) query.rows ??= [];
  assert.deepEqual(JSON.parse(response), JSON.parse(JSON.stringify(expected)));
  assert.equal(index.sha256, digest(raw));
  assert.equal(index.bytes, raw.length);
  assert.equal(raw[index.end], 125);
  assert.equal(receipt.sha256, digest(response));
  assert.equal(receipt.bytes, response.length);
  assert.equal(receipt.queryCount, Object.keys(expected.queries).length);
  assert.equal(receipt.rowCount, Object.values(expected.queries).reduce((sum, query) => sum + query.rows.length, 0));
  assert.deepEqual(Object.keys(index.queries), Object.keys(expected.queries));
  for (const [id, query] of Object.entries(index.queries)) {
    assert.equal(raw[query.end], 125);
    if (query.rows) {
      const rows = JSON.parse(raw.subarray(...query.rows));
      assert.deepEqual(rows, JSON.parse(text).queries[id].rows);
    }
  }
  assert.deepEqual(raw, before);
  return result;
}

test("ordinary snapshots retain their exact response bytes and complete rows", () => {
  const text = ' {"title":"Café 界 🐙","queries":{"q":{"rows":[{"x":1,"s":"rows: ] }"}]},"empty":{"rows":[]}},"generatedAt":"2026-09-07"}\n';
  const { snapshotIndex, snapshotResponse } = check(text);
  assert.equal(snapshotResponse.sha256, digest(text));
  assert.equal(snapshotIndex.replacements, undefined);
  assert.equal(Buffer.from(text).subarray(...snapshotIndex.generatedAt).toString(), '"2026-09-07"');
});

test("missing rows insert at the effective query close without changing metadata", () => {
  const { snapshotIndex } = check('{"queries":{"empty":{  },"metadata":{"name":"x","rowCount":9}},"note":true}');
  assert.equal(snapshotIndex.generatedAt, null);
  assert.equal(snapshotIndex.queries.empty.empty, true);
  assert.equal(snapshotIndex.queries.metadata.empty, false);
  assert.equal(snapshotIndex.queries.empty.rows, null);
});

test("decoded duplicate keys use their effective ancestor and last member", () => {
  const text = '{"queries":{"bad":null},"generatedAt":0,"queri\\u0065s":{"q":{"rows":false},"q":{"rows":[null],"r\\u006fws":[{"v":2}],"text":"\\\"rows\\\":[]"},"meta":{}},"generatedAt":"latest"}';
  const { snapshotIndex } = check(text);
  assert.deepEqual(Object.keys(snapshotIndex.queries), ["q", "meta"]);
  assert.equal(Buffer.from(text).subarray(...snapshotIndex.generatedAt).toString(), '"latest"');
});

test("prototype names, numeric IDs and escaped Unicode retain JSON property behavior", () => {
  const { snapshotIndex } = check('{"queries":{"__proto__":{"rows":[]},"constructor":{},"10":{},"2":{"rows":[{}]},"caf\\u00e9":{},"a\\\"b\\\\c":{}}}');
  assert.ok(Object.hasOwn(snapshotIndex.queries, "__proto__"));
  assert.deepEqual(Object.keys(snapshotIndex.queries).slice(0, 2), ["2", "10"]);
  assert.equal(snapshotIndex.queries.café.rows, null);
});

test("numeric normalization matches the former JSON response including negative underflow", () => {
  const { snapshotIndex } = check('{"generatedAt":-0,"queries":{"q":{"rows":[{"z":-0,"tiny":-1e-999,"positive":1e400,"negative":-1e400,"finite":9007199254740993,"nested":[-0]}]}},"unused":1e999}');
  assert.equal(snapshotIndex.replacements.length, 7);
  assert.deepEqual(new Set(snapshotIndex.replacements.map(item => item.text)), new Set(["0", "null"]));
});

test("numeric spellings spanning decode windows preserve overflow, negative zero and validation", () => {
  for (const number of ["9".repeat(90_000), "-0." + "0".repeat(90_000), "1" + "0".repeat(90_000) + "e-90000"]) {
    check('{"queries":{"q":{"rows":[{"number":' + number + '}]}}}');
  }
  assert.throws(() => createPublicationSnapshotIndex(Buffer.from('{"queries":{},"number":1' + "0".repeat(90_000) + 'e+}')),
    /reviewed snapshot must contain valid UTF-8 JSON/u);
});

test("the index does not impose the edit endpoint row limit on complete source data", () => {
  const rows = Array.from({ length: 30_000 }, (_, index) => ({ value: index, label: "Complete source row" }));
  const { snapshotResponse } = check(JSON.stringify({ queries: { q: { rows } } }));
  assert.equal(snapshotResponse.rowCount, rows.length);
});

test("deep row nesting is scanned iteratively and large strings are skipped intact", () => {
  const nested = '['.repeat(12_000) + '0' + ']'.repeat(12_000);
  const raw = Buffer.from('{"queries":{"q":{"rows":[{"deep":' + nested + ',"text":' + JSON.stringify('é \\"rows": { } ] '.repeat(80_000)) + '}]}}}');
  const { snapshotIndex, snapshotResponse } = createPublicationSnapshotIndex(raw);
  assert.equal(snapshotResponse.rowCount, 1);
  assert.equal(snapshotResponse.sha256, digest(raw));
  assert.equal(JSON.parse(raw.subarray(...snapshotIndex.queries.q.rows)).length, 1);
});

test("grammar and effective query shapes fail with sanitized errors", () => {
  const invalid = [
    '', 'null', '[]', '{}', '{"queries":null}', '{"queries":[]}',
    '{"queries":{"q":null}}', '{"queries":{"q":[]}}',
    '{"queries":{"q":{"rows":null}}}', '{"queries":{"q":{"rows":{}}}}',
    ...['null', '1', 'true', '[]', '"text"'].map(value => '{"queries":{"q":{"rows":[' + value + ']}}}'),
    '{"queries":{},}', '{"queries":{"q":{"rows":[{},]}}}', '{"queries":{}} trailing',
    '{"queries":{},"x":01}', '{"queries":{},"x":1.}', '{"queries":{},"x":.1}',
    '{"queries":{},"x":tru}', '{"queries":{},"x":falsee}', '{"queries":{},"x":undefined}',
    '{"queries":{},"x":"\\q"}', '{"queries":{},"x":"\\u00xz"}', '{"queries":{},"x":"unterminated}',
    '{"queries":{} "x":1}', '{"queries":{},"x" 1}', '{"queries":{},"x":[1 2]}',
    '{"queries":{},"x":"literal\nnewline"}',
  ];
  for (const raw of invalid) assert.throws(() => createPublicationSnapshotIndex(Buffer.from(raw)), { message: /reviewed snapshot must contain valid UTF-8 JSON/u });
  assert.throws(() => createPublicationSnapshotIndex(Buffer.from([123, 34, 0xff, 34, 58, 48, 125])), /valid UTF-8 JSON/u);
});

test("representative generated JSON retains native parsed values and nested row types", () => {
  for (let count = 0; count < 120; count += 1) {
    const rows = Array.from({ length: count % 9 }, (_, index) => ({
      value: index * 1.5, bool: index % 2 === 0, nested: { rows: [null, [1, 2], { queries: "ignored" }] },
      name: `界 ${count} \\ \" \n`,
    }));
    check(JSON.stringify({ title: `case ${count}`, queries: { q: { rows }, missing: { parameters: [null] } }, metadata: [true, false, null] }, null, count % 3));
  }
});


test("a leading UTF-8 BOM preserves raw bytes, index offsets and JSON response semantics", async () => {
  const payload = '{"title":"Reviewed BOM fixture","queries":{"q":{"rows":[{"label":"日本語","value":4}]}},"generatedAt":"2026-09-07"}';
  const raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(payload)]);
  const before = Buffer.from(raw);
  const { snapshotIndex, snapshotResponse } = createPublicationSnapshotIndex(raw);
  const response = indexedResponse(raw, snapshotIndex);
  assert.equal(snapshotIndex.sha256, digest(before));
  assert.equal(snapshotIndex.bytes, before.length);
  assert.equal(snapshotIndex.queries.q.rows[0], raw.indexOf(Buffer.from('[{"label"')));
  assert.deepEqual(JSON.parse(raw.subarray(...snapshotIndex.queries.q.rows)), JSON.parse(payload).queries.q.rows);
  assert.deepEqual(response, before, "The BOM remains in exact uploaded and hosted response bytes");
  assert.deepEqual(raw, before, "Indexing does not mutate immutable source bytes");
  assert.equal(snapshotResponse.sha256, digest(response));
  assert.equal(snapshotResponse.bytes, response.length);
  assert.equal(snapshotResponse.queryCount, 1);
  assert.equal(snapshotResponse.rowCount, 1);
  assert.deepEqual(await new Response(response).json(), JSON.parse(payload), "Fetch JSON decoding accepts the BOM without changing reviewed values");
});
