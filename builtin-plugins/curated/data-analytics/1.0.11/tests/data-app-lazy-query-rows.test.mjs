import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createDataAppWorker } from "../templates/data-app/base/src/data-app-worker.js";
import { createPublicationSnapshotIndex } from "../skills/publish-artifact-to-sites/scripts/publication-snapshot-index.mjs";
import { deferred, fixtureDatabase, reviewedSeed, sqliteUnavailable } from "../templates/data-app/base/tests/snapshot-storage-fixture.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const owner = "owner@example.com";
const options = { skip: sqliteUnavailable };

function fixture(t, raw = JSON.stringify(reviewedSeed(3))) {
  const storage = fixtureDatabase(); t.after(() => storage.close());
  const bytes = Buffer.from(raw);
  const { snapshotIndex } = createPublicationSnapshotIndex(bytes);
  const payloads = { html: Buffer.from("<html>Reviewed</html>"), snapshot: bytes };
  const assets = Object.fromEntries(Object.entries(payloads).map(([kind, body]) => {
    const sha256 = hash(body);
    return [kind, { key: `data-app/${kind}/${sha256}`, sha256, bytes: body.length }];
  }));
  const stored = new Map(Object.entries(payloads).map(([kind, body]) => [assets[kind].key, {
    body, customMetadata: { sha256: assets[kind].sha256 },
  }]));
  const gets = [], streams = [];
  const bucket = {
    async get(key, settings) {
      gets.push({ key, ...settings });
      const object = stored.get(key);
      if (!object) return null;
      const range = settings?.range;
      const body = range ? object.body.subarray(range.offset, range.offset + range.length) : object.body;
      const stream = new Response(body).body; streams.push(stream);
      return { size: object.body.length, customMetadata: object.customMetadata, body: stream,
        ...(range ? { range: { offset: range.offset, length: body.length } } : {}) };
    },
    async put(key, value, settings) {
      const body = typeof value === "string" ? Buffer.from(value) : Buffer.from(await new Response(value).arrayBuffer());
      stored.set(key, { body, customMetadata: settings.customMetadata });
      return { size: body.length };
    },
  };
  const configuration = { deploymentAssets: assets, snapshotIndex, seedSnapshotSha256: hash(bytes) };
  const worker = createDataAppWorker(configuration), environment = {
    DB: storage.db, BUCKET: bucket, DATA_APP_OWNER_EMAIL_SHA256: hash(owner),
  };
  const request = (pathname, settings) => worker.fetch(new Request(`https://fixture.chatgpt.site${pathname}`, settings), environment);
  const rowsPath = id => `/api/query-rows?queryId=${encodeURIComponent(id)}&snapshot=${assets.snapshot.sha256}&revision=seed`;
  return { storage, bytes, assets, snapshotIndex, configuration, worker, environment, stored, gets, streams, bucket, request, rowsPath };
}

function redeploy(value, seed) {
  const bytes = Buffer.from(JSON.stringify(seed)), sha256 = hash(bytes);
  const snapshot = { key: `data-app/snapshot/${sha256}`, sha256, bytes: bytes.length };
  value.stored.set(snapshot.key, { body: bytes, customMetadata: { sha256 } });
  const { snapshotIndex } = createPublicationSnapshotIndex(bytes);
  const worker = createDataAppWorker({ ...value.configuration, snapshotIndex, seedSnapshotSha256: sha256,
    deploymentAssets: { ...value.assets, snapshot } });
  return pathname => worker.fetch(new Request(`https://fixture.chatgpt.site${pathname}`), value.environment);
}

test("head describes an unchanged indexed snapshot without consuming its rows", options, async t => {
  const value = fixture(t);
  const response = await value.request("/api/snapshot/head");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { supported: true, snapshotSha256: value.assets.snapshot.sha256,
    generatedAt: null, queries: Object.fromEntries(["reviewed", "__proto__", "empty"].map(id => [id, { revision: "seed" }])) });
  assert.equal(value.gets.length, 1);
  assert.equal(value.streams[0].locked, false);
  assert.equal((await value.streams[0].getReader().read()).done, true, "Head must cancel the unused full snapshot body");
});

test("one query uses its exact byte range and a native stream without reading other rows", options, async t => {
  const raw = JSON.stringify({ title: "Café 日本語 🧪", queries: {
    unrelated: { rows: [{ text: "Unrelated payload".repeat(60_000) }] },
    selected: { rows: [{ text: "Only this query", number: 42 }] },
  } });
  const value = fixture(t, raw);
  const response = await value.request(value.rowsPath("selected"));
  const [start, end] = value.snapshotIndex.queries.selected.rows;
  assert.equal(response.status, 200);
  assert.deepEqual(value.gets, [{ key: value.assets.snapshot.key, range: { offset: start, length: end - start } }]);
  assert.equal(response.body, value.streams[0], "Unmodified query bytes should use the native R2 stream");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), value.bytes.subarray(start, end));
});

test("missing and empty rows plus special query IDs preserve native JSON semantics", options, async t => {
  const queries = Object.fromEntries(["__proto__", "constructor", ".", "..", "a/b?c#d", "Café 日本語 🧪", ""].map(id => [id, { rows: [{ id }] }]));
  queries.empty = { rows: [] }; queries.missing = { sql: "SELECT metadata_only" };
  const value = fixture(t, JSON.stringify({ queries }));
  for (const [id, query] of Object.entries(queries)) {
    const response = await value.request(value.rowsPath(id));
    assert.equal(response.status, 200, id);
    assert.deepEqual(await response.json(), query.rows ?? []);
  }
  const all = await value.request("/api/snapshot");
  const expected = JSON.parse(JSON.stringify({ queries })); expected.queries.missing.rows = [];
  assert.deepEqual(await all.json(), expected, "Existing full snapshot continues to normalize absent rows");
});

test("query normalization and duplicate keys match the complete snapshot", options, async t => {
  const raw = '{"title":"界 🧪","queries":{"discarded":{}},"queries":{"q":{"rows":[{"old":true}],"rows":[{"negativeZero":-0,"overflow":1e999,"underflow":-1e-999,"nested":[-0,1e999],"text":"café"}]},"untouched":{"rows":[{"number":7}]}}}';
  const value = fixture(t, raw);
  const all = await (await value.request("/api/snapshot")).json();
  const response = await value.request(value.rowsPath("q"));
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.deepEqual(rows, all.queries.q.rows);
  assert.deepEqual(rows, [{ negativeZero: 0, overflow: null, underflow: 0, nested: [0, null], text: "café" }]);
  assert.equal((await value.request(value.rowsPath("discarded"))).status, 404);
});

test("query reads retain all rows beyond the owner edit endpoint limit", options, async t => {
  const rows = Array.from({ length: 10_001 }, (_, number) => ({ number }));
  const value = fixture(t, JSON.stringify({ queries: { q: { rows } } }));
  assert.deepEqual(await (await value.request(value.rowsPath("q"))).json(), rows);
});

test("owner edits disable lazy loading while full reads and write authorization remain intact", options, async t => {
  const value = fixture(t);
  const before = await (await value.request("/api/snapshot")).json();
  for (const headers of [{}, { "oai-authenticated-user-email": "viewer@example.com" }, { "x-data-app-deployment-token": "deployment-only" }]) {
    assert.equal((await value.request("/api/queries/reviewed", { method: "PUT", headers, body: JSON.stringify({ rows: [] }) })).status, 403);
  }
  assert.equal((await value.request("/api/snapshot/head")).status, 200);
  const rows = [{ ownerReviewed: "Current replacement" }];
  assert.equal((await value.request("/api/queries/reviewed", { method: "PUT", headers: { "oai-authenticated-user-email": owner },
    body: JSON.stringify({ rows }) })).status, 200);
  const getsBefore = value.gets.length;
  assert.deepEqual(await (await value.request("/api/snapshot/head")).json(), { supported: false });
  for (const id of ["reviewed", "empty"]) assert.equal((await value.request(value.rowsPath(id))).status, 409);
  assert.equal(value.gets.length, getsBefore, "Changed snapshots must not return stale immutable rows");
  const current = await (await value.request("/api/snapshot")).json();
  assert.deepEqual(current.queries.reviewed.rows, rows);
  assert.deepEqual(current.queries.empty, before.queries.empty);
  assert.notEqual(current.generatedAt, before.generatedAt);
});

test("lazy head and rows use a fresh generation after A → edit → B → A", options, async t => {
  const value = fixture(t), nextSeed = reviewedSeed(2, "Next reviewed seed"), next = redeploy(value, nextSeed);
  assert.equal((await value.request("/api/queries/reviewed", { method: "PUT",
    headers: { "oai-authenticated-user-email": owner }, body: JSON.stringify({ rows: [{ oldOwnerEdit: true }] }) })).status, 200);
  assert.deepEqual(await (await value.request("/api/snapshot/head")).json(), { supported: false });
  assert.equal((await value.request(value.rowsPath("reviewed"))).status, 409);
  assert.equal((await (await next("/api/snapshot/head")).json()).supported, true);
  const nextHash = hash(JSON.stringify(nextSeed));
  assert.deepEqual(await (await next(value.rowsPath("reviewed").replace(value.assets.snapshot.sha256, nextHash))).json(), nextSeed.queries.reviewed.rows);
  const head = await (await value.request("/api/snapshot/head")).json();
  assert.equal(head.supported, true);
  assert.equal(head.snapshotSha256, value.assets.snapshot.sha256);
  assert.deepEqual(await (await value.request(value.rowsPath("reviewed"))).json(), reviewedSeed(3).queries.reviewed.rows);
  assert.deepEqual(await (await value.request("/api/snapshot")).json(), reviewedSeed(3));
});

test("lazy head and query reads reject a generation change between initialization and capture", options, async t => {
  for (const kind of ["head", "rows"]) for (const aba of [false, true]) {
    await t.test(`${kind}: ${aba ? "A → B → A" : "A → B"}`, async t => {
      const value = fixture(t), next = redeploy(value, reviewedSeed(2, "Next reviewed seed"));
      await value.request("/api/snapshot/head");
      const paused = deferred(), resume = deferred(); let gated = false;
      t.after(() => resume.resolve());
      value.storage.hook(async operation => {
        if (!gated && operation.kind === "batch" && operation.statements.some(({ sql }) => sql.startsWith("SELECT 1 AS edited FROM data_app_object_queries_v1"))) {
          gated = true; paused.resolve(); await resume.promise;
        }
      });
      const waiting = value.request(kind === "head" ? "/api/snapshot/head" : value.rowsPath("reviewed"));
      await paused.promise;
      assert.equal((await (await next("/api/snapshot/head")).json()).supported, true);
      if (aba) assert.equal((await (await value.request("/api/snapshot/head")).json()).supported, true);
      const getsBefore = value.gets.length;
      resume.resolve();
      const response = await waiting;
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "SNAPSHOT_HEAD_CONFLICT");
      assert.equal(value.gets.length, getsBefore, "The stale check must fail before any immutable object read");
    });
  }
});

test("legacy storage and unindexed snapshots advertise the existing eager path", options, async t => {
  const value = fixture(t);
  value.storage.sqlite.exec("CREATE TABLE data_app_queries (id TEXT); INSERT INTO data_app_queries VALUES ('legacy-owner-data')");
  assert.deepEqual(await (await value.request("/api/snapshot/head")).json(), { supported: false });
  assert.equal((await value.request(value.rowsPath("reviewed"))).status, 409);
  assert.equal(value.gets.length, 0);
  const unindexed = createDataAppWorker({ seedSnapshot: reviewedSeed(2) });
  const database = fixtureDatabase(); t.after(() => database.close());
  const read = pathname => unindexed.fetch(new Request(`https://fixture.chatgpt.site${pathname}`), { DB: database.db });
  assert.deepEqual(await (await read("/api/snapshot/head")).json(), { supported: false });
  assert.equal((await read(value.rowsPath("reviewed"))).status, 409);
  assert.deepEqual((await (await read("/api/snapshot")).json()).queries.reviewed.rows, reviewedSeed(2).queries.reviewed.rows);
});

test("query reads reject stale identities and arbitrary selectors before bucket access", options, async t => {
  const value = fixture(t);
  const valid = value.rowsPath("reviewed");
  for (const pathname of [valid.replace(value.assets.snapshot.sha256, "a".repeat(64)), valid.replace("revision=seed", "revision=historical")]) {
    assert.equal((await value.request(pathname)).status, 409);
  }
  for (const pathname of [valid + "&range=0-9", valid + `&snapshot=${value.assets.snapshot.sha256}`, valid + "&queryId=empty", "/api/query-rows"]) {
    assert.equal((await value.request(pathname)).status, 400);
  }
  assert.equal((await value.request(value.rowsPath("unknown"))).status, 404);
  assert.equal((await value.request("/api/snapshot/head?historical=true")).status, 400);
  assert.equal(value.gets.length, 0);
});

test("missing, mismatched and incomplete query objects fail instead of returning empty rows", options, async t => {
  const mutations = [
    ["missing object", () => null],
    ["wrong object size", object => ({ ...object, size: object.size - 1 })],
    ["wrong identity", object => ({ ...object, customMetadata: { sha256: "incorrect" } })],
    ["short range", object => ({ ...object, range: { ...object.range, length: object.range.length - 1 } })],
    ["wrong range", object => ({ ...object, range: { ...object.range, offset: object.range.offset + 1 } })],
  ];
  for (const [name, mutate] of mutations) await t.test(name, async t => {
    const value = fixture(t), get = value.bucket.get;
    value.bucket.get = async (...args) => mutate(await get(...args));
    assert.equal((await value.request(value.rowsPath("reviewed"))).status, 503);
  });
  const value = fixture(t);
  value.stored.delete(value.assets.snapshot.key);
  assert.equal((await value.request("/api/snapshot/head")).status, 503);
});

test("a native range stream failure propagates to the client", options, async t => {
  const value = fixture(t), get = value.bucket.get;
  value.bucket.get = async (...args) => {
    const object = await get(...args); await object.body.cancel();
    return { ...object, body: new ReadableStream({ pull(controller) { controller.error(new Error("Synthetic incomplete R2 stream")); } }) };
  };
  const response = await value.request(value.rowsPath("reviewed"));
  await assert.rejects(response.json(), /incomplete R2 stream/u);
});
