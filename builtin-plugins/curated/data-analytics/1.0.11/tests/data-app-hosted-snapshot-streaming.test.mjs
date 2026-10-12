import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createDataAppWorker } from "../templates/data-app/base/src/data-app-worker.js";
import { snapshotResponse } from "../templates/data-app/base/src/snapshot-storage.js";
import { deferred, fixtureDatabase, reviewedSeed, sqliteUnavailable } from "../templates/data-app/base/tests/snapshot-storage-fixture.mjs";
import { createPublicationSnapshotIndex } from "../skills/publish-artifact-to-sites/scripts/publication-snapshot-index.mjs";
import { snapshotResponseFingerprint } from "../skills/publish-artifact-to-sites/scripts/publication-assets.mjs";

const owner = "owner@example.com";
const deploymentToken = "synthetic-streaming-deployment-token";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const descriptor = (kind, bytes) => ({ key: `data-app/${kind}/${hash(bytes)}`, sha256: hash(bytes), bytes: bytes.length });
const apiTest = (name, run) => test(name, { skip: sqliteUnavailable }, run);
const request = (path, { method = "GET", email, token, body } = {}) => new Request(`https://dashboard.example${path}`, {
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  headers: { ...(email ? { "oai-authenticated-user-email": email } : {}), ...(token ? { "x-data-app-deployment-token": token } : {}) },
});
const queryPath = queryId => `/api/queries/${encodeURIComponent(queryId)}`;

function fixture(t, raw = Buffer.from(JSON.stringify(reviewedSeed(7))), { chunkBytes = 16 * 1024 } = {}) {
  raw = Buffer.from(raw);
  const seed = JSON.parse(raw.toString("utf8"));
  const html = Buffer.from("<!doctype html><html><head></head><body>Reviewed dashboard</body></html>");
  const assets = { html: descriptor("html", html), snapshot: descriptor("snapshot", raw) };
  const indexed = createPublicationSnapshotIndex(raw);
  const stored = new Map(Object.entries(assets).map(([kind, asset]) => [asset.key, {
    bytes: kind === "html" ? html : raw,
    customMetadata: { sha256: asset.sha256 },
  }]));
  const calls = [];
  const metrics = { inputPulls: 0, inputBytes: 0, cancelled: 0, largestChunk: 0, parsedObjects: 0 };
  let wholeObjectParsingAllowed = false;
  let hook;
  function metadata(value) {
    return { size: value.bytes.length, customMetadata: value.customMetadata };
  }
  const bucket = {
    async head(key) {
      calls.push({ kind: "head", key });
      await hook?.("head", { key });
      const value = stored.get(key);
      return value ? metadata(value) : null;
    },
    async get(key, options = {}) {
      calls.push({ kind: "get", key, options });
      await hook?.("get", { key, options });
      const value = stored.get(key);
      if (!value) return null;
      const range = options.range;
      const offset = range?.offset ?? (range?.suffix === undefined ? 0 : Math.max(0, value.bytes.length - range.suffix));
      const length = range?.length ?? value.bytes.length - offset;
      assert.ok(Number.isSafeInteger(offset) && offset >= 0 && offset <= value.bytes.length);
      assert.ok(Number.isSafeInteger(length) && length >= 0);
      const sourceBytes = value.streamBytes ?? value.bytes;
      const selected = range ? sourceBytes.subarray(offset, Math.min(offset + length, sourceBytes.length)) : sourceBytes;
      let position = 0;
      const body = new ReadableStream({
        pull(controller) {
          metrics.inputPulls++;
          if (position === selected.length) { controller.close(); return; }
          const end = Math.min(position + chunkBytes, selected.length);
          const chunk = selected.subarray(position, end);
          position = end;
          metrics.inputBytes += chunk.length;
          metrics.largestChunk = Math.max(metrics.largestChunk, chunk.length);
          controller.enqueue(chunk);
        },
        cancel() { metrics.cancelled++; calls.push({ kind: "cancel", key }); },
      });
      return { ...metadata(value), body, ...(range ? { range: { offset, length: selected.length } } : {}),
        async json() {
          assert.ok(wholeObjectParsingAllowed, "Indexed hosted reads must not parse a whole R2 object");
          metrics.parsedObjects++;
          return JSON.parse(value.bytes.toString("utf8"));
        },
        async text() { assert.fail("Indexed hosted reads must not buffer R2 text"); },
        async arrayBuffer() { assert.fail("Indexed hosted reads must not buffer R2 bytes"); },
      };
    },
    async put(key, input, options = {}) {
      calls.push({ kind: "put", key, options });
      await hook?.("put", { key, options });
      const bytes = Buffer.from(await new Response(input).arrayBuffer());
      if (options.sha256 && hash(bytes) !== options.sha256) throw Error("Synthetic R2 checksum mismatch");
      stored.set(key, { bytes, customMetadata: options.customMetadata });
      return { size: bytes.length, key, customMetadata: options.customMetadata };
    },
  };
  const storage = fixtureDatabase();
  t.after(() => storage.close());
  const configuration = { deploymentAssets: assets, snapshotIndex: indexed.snapshotIndex,
    seedSnapshotSha256: hash(JSON.stringify(seed)),
    deploymentUploadAuthorization: { sha256: hash(deploymentToken), expiresAt: "2999-01-01T00:00:00.000Z" },
    initialPresentation: { title: "Initial reviewed presentation" } };
  const environment = { DB: storage.db, BUCKET: bucket, DATA_APP_OWNER_EMAIL_SHA256: hash(owner) };
  return { seed, raw, html, assets, indexed, stored, calls, metrics, bucket, storage, configuration, environment,
    worker: createDataAppWorker(configuration),
    allowWholeObjectParsing(value) { wholeObjectParsingAllowed = value; },
    hook(value) { hook = value; },
  };
}

async function snapshot(value, worker = value.worker) {
  const response = await worker.fetch(request("/api/snapshot"), value.environment);
  assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response;
}

async function replace(value, queryId, rows, worker = value.worker) {
  const response = await worker.fetch(request(queryPath(queryId), { method: "PUT", email: owner, body: { rows } }), value.environment);
  assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
  const result = await response.json();
  assert.deepEqual(result.rows, rows);
  assert.equal(result.queryId, queryId);
  assert.ok(Number.isFinite(Date.parse(result.generatedAt)));
  return result;
}

function redeploy(value, seed) {
  const raw = Buffer.from(JSON.stringify(seed, null, 2) + "\n"), asset = descriptor("snapshot", raw);
  value.stored.set(asset.key, { bytes: raw, customMetadata: { sha256: asset.sha256 } });
  const indexed = createPublicationSnapshotIndex(raw);
  return createDataAppWorker({ ...value.configuration, deploymentAssets: { ...value.assets, snapshot: asset },
    snapshotIndex: indexed.snapshotIndex, seedSnapshotSha256: hash(JSON.stringify(seed)), initialPresentation: { title: "New default" } });
}

apiTest("cold and warm indexed snapshots retain multi-megabyte rows and metadata without whole-object reads", async t => {
  const seed = reviewedSeed(5);
  seed.description = "Large reviewed metadata café ".repeat(16_000);
  seed.queries.reviewed.sql = `SELECT reviewed /* ${"complete SQL source ".repeat(20_000)} */`;
  seed.queries.reviewed.rows[2].payload = "日本語 🧪 \\\"\n".repeat(300_000);
  seed.queries.reviewed.rows[4].typed = { number: 1.125, boolean: false, nil: null, array: [1, "2", true, null, { nested: [] }] };
  const value = fixture(t, Buffer.from(JSON.stringify(seed, null, 2) + "\n"));
  for (const worker of [value.worker, createDataAppWorker(value.configuration)]) {
    const response = await snapshot(value, worker);
    const chunks = [];
    for await (const chunk of response.body) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    assert.deepEqual(JSON.parse(bytes), seed);
    assert.deepEqual(bytes, value.raw, "A source with every rows field and no numeric patches retains its exact raw bytes");
    assert.equal(hash(bytes), value.indexed.snapshotResponse.sha256);
    assert.equal(bytes.length, value.indexed.snapshotResponse.bytes);
    assert.ok(chunks.length > 1, "Large response stays streamed");
    assert.ok(chunks.every(chunk => chunk.length <= 256 * 1024));
  }
  assert.equal(value.metrics.parsedObjects, 0);
  assert.ok(value.metrics.largestChunk <= 16 * 1024);
  assert.deepEqual(value.stored.get(value.assets.snapshot.key).bytes, value.raw);
});

apiTest("indexed JSON preserves last-key semantics, row order and types across small UTF-8 boundaries", async t => {
  const raw = Buffer.from('{"generatedAt":"old","generatedAt":-0,"queries":{"discarded":{"rows":[]}},"queries":{' +
    '"9":{"rows":[{"v":"old"}]},"__proto__":{"rows":[{"v":"café 日本語 🧪 \\\" \\\\"}],' +
    '"source":{"text":"fake \\\"rows\\\":[1] and \\\"queries\\\":{}"}},"empty":{},' +
    '"default":{"sql":"SELECT 1"},"9":{"rows":[{"v":"ignored"}],"rows":[{"negativeZero":-0,"infinite":1e400,"tiny":1e-400,"float":1.25,"n":null,"bool":true,"list":[2,1]}]},' +
    '"constructor":{"rows":[]}}}');
  const value = fixture(t, raw, { chunkBytes: 7 });
  const expected = JSON.parse(JSON.stringify(JSON.parse(raw)));
  for (const query of Object.values(expected.queries)) query.rows ??= [];
  const bytes = Buffer.from(await (await snapshot(value)).arrayBuffer());
  const actual = JSON.parse(bytes);
  assert.deepEqual(actual, expected);
  assert.equal(Object.is(actual.queries["9"].rows[0].negativeZero, -0), false);
  assert.equal(hash(bytes), value.indexed.snapshotResponse.sha256);
  assert.equal(bytes.length, value.indexed.snapshotResponse.bytes);
  assert.deepEqual(Object.keys(actual.queries), Object.keys(expected.queries));
  assert.equal(value.metrics.parsedObjects, 0);
  const updated = await replace(value, "9", [{ replacement: "No old numeric patches" }]);
  expected.queries["9"].rows = updated.rows;
  expected.generatedAt = updated.generatedAt;
  assert.deepEqual(await (await snapshot(value)).json(), expected, "A replacement suppresses normalization patches inside its old rows and generatedAt spans");
  for (const queryId of ["empty", "default"]) {
    const inserted = await replace(value, queryId, [{ insertedIntoMissingRows: queryId }]);
    expected.queries[queryId].rows = inserted.rows;
    expected.generatedAt = inserted.generatedAt;
    assert.deepEqual(await (await snapshot(value)).json(), expected);
  }
});

apiTest("owner replacements preserve other queries, metadata and immutable export bytes, including empty rows", async t => {
  const value = fixture(t);
  await (await snapshot(value)).body.cancel();
  const rows = [{ changed: true, amount: 42, nested: [null, false, "日本語"] }, { changed: false, amount: 0 }];
  const saved = await replace(value, "reviewed", rows);
  const expected = structuredClone(value.seed);
  expected.queries.reviewed.rows = rows;
  expected.generatedAt = saved.generatedAt;
  assert.deepEqual(await (await snapshot(value)).json(), expected);
  const cleared = await replace(value, "reviewed", []);
  expected.queries.reviewed.rows = [];
  expected.generatedAt = cleared.generatedAt;
  assert.deepEqual(await (await snapshot(value)).json(), expected);
  const special = await replace(value, "__proto__", [{ own: true }]);
  expected.queries.__proto__.rows = [{ own: true }];
  expected.generatedAt = special.generatedAt;
  assert.deepEqual(await (await snapshot(value)).json(), expected);
  const immutable = await value.worker.fetch(request("/api/deployment-assets/snapshot", { email: owner }), value.environment);
  assert.equal(immutable.status, 200);
  assert.deepEqual(Buffer.from(await immutable.arrayBuffer()), value.raw);
});

apiTest("dense numeric normalization scales with indexed spans while preserving replacement semantics", async t => {
  const rows = Array.from({ length: 2000 }, (_, index) => `{"index":${index},"overflow":1e400,"zero":-0}`).join(",");
  const value = fixture(t, Buffer.from(`{"queries":{"reviewed":{"rows":[${rows}]},"empty":{"rows":[{"overflow":-1e400,"zero":-0}]}}}`));
  const expected = JSON.parse(JSON.stringify(value.seed));
  let reads = 0;
  // Count span accesses rather than wall time, so a quadratic pre-stream scan
  // is caught without making this regression depend on the CI machine's speed.
  value.indexed.snapshotIndex.replacements = value.indexed.snapshotIndex.replacements.slice().reverse().map(item => ({
    get start() { reads++; return item.start; },
    get end() { reads++; return item.end; },
    text: item.text,
  }));
  const limit = value.indexed.snapshotIndex.replacements.length * 64;
  assert.deepEqual(await (await snapshot(value)).json(), expected);
  assert.ok(reads < limit, `Numeric span preparation repeated ${reads} accesses for ${value.indexed.snapshotIndex.replacements.length} spans`);
  const saved = await replace(value, "reviewed", [{ replacement: true }]);
  reads = 0;
  expected.queries.reviewed.rows = saved.rows;
  expected.generatedAt = saved.generatedAt;
  assert.deepEqual(await (await snapshot(value)).json(), expected);
  assert.ok(reads < limit, "Owner-replaced values also use bounded span preparation");
});

apiTest("indexed query updates retain owner authorization, known-query checks and the existing row-count boundary", async t => {
  const value = fixture(t);
  const noStorage = { get DB() { assert.fail("Unauthorized writes must not access D1"); }, get BUCKET() { assert.fail("Unauthorized writes must not access R2"); } };
  for (const viewer of [{}, { email: "viewer@example.com" }, { token: deploymentToken }]) {
    for (const path of [queryPath("reviewed"), "/api/presentation"]) {
      const denied = await value.worker.fetch(request(path, { ...viewer, method: "PUT", body: { rows: [] } }), noStorage);
      assert.equal(denied.status, 403);
    }
  }
  const missing = await value.worker.fetch(request(queryPath("not-a-query"), { email: owner, method: "PUT", body: { rows: [] } }), value.environment);
  assert.equal(missing.status, 404);
  for (const rows of [null, [null], [[1]], Array.from({ length: 10_001 }, () => ({ value: 1 }))]) {
    const invalid = await value.worker.fetch(request(queryPath("reviewed"), { email: owner, method: "PUT", body: { rows } }), value.environment);
    assert.equal(invalid.status, 400);
  }
  assert.deepEqual(await (await snapshot(value)).json(), value.seed);
});

apiTest("a captured indexed response remains coherent across a concurrent owner replacement", async t => {
  const value = fixture(t, Buffer.from(JSON.stringify(reviewedSeed(2100))), { chunkBytes: 101 });
  const previous = await replace(value, "reviewed", [{ capturedRevision: "keep until stream completes" }]);
  const expected = structuredClone(value.seed);
  expected.queries.reviewed.rows = previous.rows;
  expected.generatedAt = previous.generatedAt;
  const captured = await snapshot(value);
  const update = await replace(value, "reviewed", [{ revised: 1 }]);
  assert.deepEqual(await captured.json(), expected);
  const current = await (await snapshot(value)).json();
  assert.deepEqual(current.queries.reviewed.rows, update.rows);
  assert.equal(current.generatedAt, update.generatedAt);
});

apiTest("cancelling an indexed response cancels its R2 reader without pulling the whole source", async t => {
  const value = fixture(t, Buffer.from(JSON.stringify(reviewedSeed(10_001))), { chunkBytes: 1024 });
  const response = await snapshot(value), reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  await reader.cancel();
  assert.ok(value.metrics.cancelled >= 1);
  assert.ok(value.metrics.inputBytes < value.raw.length);
  assert.equal(value.metrics.parsedObjects, 0);
});

apiTest("incomplete immutable source and override objects fail instead of producing a valid partial snapshot", async t => {
  for (const kind of ["short source", "long source", "missing override", "short override", "mismatched override metadata"]) {
    await t.test(kind, async t => {
      const value = fixture(t, Buffer.from(JSON.stringify(reviewedSeed(41))), { chunkBytes: 17 });
      let rejectedObjectKey;
      if (kind.endsWith("source")) {
        const object = value.stored.get(value.assets.snapshot.key);
        object.streamBytes = kind === "short source" ? object.bytes.subarray(0, object.bytes.length - 1) : Buffer.concat([object.bytes, Buffer.from(" ")]);
      } else {
        await replace(value, "reviewed", [{ stored: "complete" }]);
        const write = value.calls.find(call => call.kind === "put");
        assert.ok(write, "Owner replacement creates one immutable object");
        const object = value.stored.get(write.key);
        if (kind === "missing override") value.stored.delete(write.key);
        if (kind === "short override") object.streamBytes = object.bytes.subarray(0, object.bytes.length - 1);
        if (kind === "mismatched override metadata") {
          object.customMetadata = { revision: "not-the-recorded-revision" };
          rejectedObjectKey = write.key;
        }
      }
      const response = await snapshot(value);
      await assert.rejects(response.arrayBuffer(), error => {
        assert.ok(["INCOMPLETE_SNAPSHOT", "INCOMPLETE_QUERY"].includes(error.code));
        return true;
      });
      if (rejectedObjectKey) assert.ok(value.calls.some(call => call.kind === "cancel" && call.key === rejectedObjectKey), "A rejected immutable object body is cancelled");
    });
  }
});

apiTest("owner replacement accepts all 10000 permitted rows and preserves values larger than a D1 row", async t => {
  const value = fixture(t);
  const rows = Array.from({ length: 10_000 }, (_, index) => ({ index, value: index / 3 }));
  rows[5].payload = "Complete owner-reviewed value ".repeat(12_000);
  const update = await replace(value, "reviewed", rows);
  const actual = await (await snapshot(value)).json();
  assert.deepEqual(actual.queries.reviewed.rows, rows);
  assert.deepEqual(actual.queries.empty, value.seed.queries.empty);
  assert.equal(actual.generatedAt, update.generatedAt);
  assert.equal(value.metrics.parsedObjects, 0);
});

apiTest("failed override uploads and failed activation preserve the complete previous rows", async t => {
  for (const failure of ["object upload", "database activation"]) await t.test(failure, async t => {
    const value = fixture(t);
    const previous = await replace(value, "reviewed", [{ reviewed: "keep" }]);
    let objectWritten = false, interrupted = false;
    if (failure === "object upload") value.hook(kind => { if (kind === "put") { interrupted = true; throw Error("Interrupted synthetic object write"); } });
    else {
      value.hook(kind => { if (kind === "put") objectWritten = true; });
      value.storage.hook(operation => {
        if (objectWritten && operation.statements.some(({ sql }) => /^\s*(INSERT|UPDATE)\b/iu.test(sql))) {
          interrupted = true; throw Error("Interrupted synthetic activation");
        }
      });
    }
    const failed = await value.worker.fetch(request(queryPath("reviewed"), { email: owner, method: "PUT", body: { rows: [{ reviewed: "must not appear" }] } }), value.environment);
    assert.equal(failed.status, 503);
    assert.equal(interrupted, true, "Failure injection reaches the persistence boundary");
    value.hook(null); value.storage.hook(null);
    const actual = await (await snapshot(value)).json();
    assert.deepEqual(actual.queries.reviewed.rows, previous.rows);
    assert.equal(actual.generatedAt, previous.generatedAt);
    await replace(value, "reviewed", [{ reviewed: "retry" }]);
    assert.deepEqual((await (await snapshot(value)).json()).queries.reviewed.rows, [{ reviewed: "retry" }]);
  });
});

apiTest("concurrent indexed replacements choose one complete revision and report conflicts", async t => {
  const value = fixture(t);
  await (await snapshot(value)).body.cancel();
  const paused = deferred(), resume = deferred(); let gated = false;
  value.hook(async kind => { if (kind === "put" && !gated) { gated = true; paused.resolve(); await resume.promise; } });
  const waiting = value.worker.fetch(request(queryPath("reviewed"), { email: owner, method: "PUT", body: { rows: [{ loser: true }] } }), value.environment);
  await paused.promise;
  const winner = await replace(value, "reviewed", [{ winner: true }]);
  resume.resolve();
  assert.equal((await waiting).status, 409);
  assert.deepEqual((await (await snapshot(value)).json()).queries.reviewed.rows, winner.rows);
});

apiTest("formatting-only redeployment preserves owner data and presentation, while reviewed data changes reset only rows", async t => {
  const value = fixture(t);
  const saved = await replace(value, "reviewed", [{ ownerReviewed: 91 }]);
  const editedPresentation = { title: "Saved title", notes: "Owner note" };
  const put = await value.worker.fetch(request("/api/presentation", { method: "PUT", email: owner, body: { revision: 0, presentation: editedPresentation } }), value.environment);
  assert.equal(put.status, 200);
  const formatted = redeploy(value, value.seed), after = await (await snapshot(value, formatted)).json();
  assert.deepEqual(after.queries.reviewed.rows, saved.rows);
  assert.equal(after.generatedAt, saved.generatedAt);
  const changed = structuredClone(value.seed); changed.queries.reviewed.rows = [{ newlyReviewed: 22 }];
  const revised = redeploy(value, changed);
  assert.deepEqual(await (await snapshot(value, revised)).json(), changed);
  const presentation = await (await revised.fetch(request("/api/presentation", { email: owner }), value.environment)).json();
  assert.equal(presentation.canEdit, true);
  assert.deepEqual(presentation.presentation, editedPresentation);
});

apiTest("returning to a prior reviewed seed starts clean while captured responses and consecutive edits survive", async t => {
  const value = fixture(t), nextSeed = reviewedSeed(3, "Second reviewed seed"), next = redeploy(value, nextSeed);
  const saved = await replace(value, "reviewed", [{ firstSeedEdit: true }]);
  const captured = await snapshot(value);
  assert.deepEqual(await (await snapshot(value, next)).json(), nextSeed);
  await replace(value, "reviewed", [{ secondSeedEdit: true }], next);
  assert.deepEqual(await (await snapshot(value)).json(), value.seed, "A → edit → B → A must not resurrect A's old owner rows or timestamp");
  const old = await captured.json();
  assert.deepEqual(old.queries.reviewed.rows, saved.rows);
  assert.equal(old.generatedAt, saved.generatedAt, "The in-flight response retains its captured revision");
  const current = await replace(value, "reviewed", [{ currentSeedEdit: true }]);
  const sameSeed = redeploy(value, value.seed);
  assert.deepEqual((await (await snapshot(value, sameSeed)).json()).queries.reviewed.rows, current.rows);
  const consecutive = await replace(value, "empty", [{ anotherQuery: true }], sameSeed);
  const actual = await (await snapshot(value, sameSeed)).json();
  assert.deepEqual(actual.queries.reviewed.rows, current.rows);
  assert.deepEqual(actual.queries.empty.rows, consecutive.rows);
  assert.equal(actual.generatedAt, consecutive.generatedAt);
});

apiTest("a staged owner write cannot activate after its reviewed generation changes, including ABA", async t => {
  for (const returnToOriginal of [false, true]) await t.test(returnToOriginal ? "A → B → A" : "A → B", async t => {
    const value = fixture(t), nextSeed = reviewedSeed(3, "Next seed"), next = redeploy(value, nextSeed);
    await (await snapshot(value)).body.cancel();
    const paused = deferred(), resume = deferred(); let gated = false;
    value.hook(async kind => { if (kind === "put" && !gated) { gated = true; paused.resolve(); await resume.promise; } });
    const waiting = value.worker.fetch(request(queryPath("reviewed"), {
      email: owner, method: "PUT", body: { rows: [{ stale: true }] },
    }), value.environment);
    await paused.promise;
    assert.deepEqual(await (await snapshot(value, next)).json(), nextSeed);
    if (returnToOriginal) assert.deepEqual(await (await snapshot(value)).json(), value.seed);
    resume.resolve();
    const response = await waiting;
    assert.equal(response.status, 409);
    const current = returnToOriginal ? value.worker : next;
    assert.deepEqual(await (await snapshot(value, current)).json(), returnToOriginal ? value.seed : nextSeed);
  });
});

apiTest("concurrent generation activation preserves the winner and a losing transition cannot reset overlays", async t => {
  for (const same of [false, true]) await t.test(same ? "same seed" : "different seed", async t => {
    const value = fixture(t), originalHash = value.configuration.seedSnapshotSha256;
    const originalEdit = await replace(value, "reviewed", [{ historicalEdit: true }]);
    const second = redeploy(value, reviewedSeed(3, "Second seed"));
    await (await snapshot(value, second)).body.cancel();
    const paused = deferred(), resume = deferred(); let gated = false;
    value.storage.hook(async operation => {
      if (!gated && operation.kind === "batch" && operation.statements.some(({ sql }) => sql.startsWith("UPDATE data_app_object_head_v1"))) {
        gated = true; paused.resolve(); await resume.promise;
      }
    });
    const waiting = value.worker.fetch(request("/api/snapshot"), value.environment);
    await paused.promise;
    const winnerSeed = same ? value.seed : reviewedSeed(2, "Third seed");
    const winner = redeploy(value, winnerSeed);
    await (await snapshot(value, winner)).body.cancel();
    const saved = await replace(value, "reviewed", [{ winningEdit: true }], winner);
    resume.resolve();
    const response = await waiting;
    assert.equal(response.status, same ? 200 : 409);
    if (same) assert.deepEqual((await response.json()).queries.reviewed.rows, saved.rows);
    else {
      const timestamp = value.storage.sqlite.prepare("SELECT generated_at FROM data_app_object_snapshots_v1 WHERE seed_sha256 = ?").get(originalHash);
      assert.equal(timestamp.generated_at, originalEdit.generatedAt, "The losing activation cannot reset an inactive seed's timestamp");
      assert.equal(value.storage.sqlite.prepare("SELECT COUNT(*) AS count FROM data_app_object_queries_v1 WHERE seed_sha256 = ?").get(originalHash).count, 1);
    }
    const actual = await (await snapshot(value, winner)).json();
    assert.deepEqual(actual.queries.reviewed.rows, saved.rows);
    assert.equal(actual.generatedAt, saved.generatedAt);
  });
});

apiTest("generation reset rolls back completely when its D1 transaction fails", async t => {
  const value = fixture(t), originalHash = value.configuration.seedSnapshotSha256;
  await replace(value, "reviewed", [{ firstSaved: true }]);
  const second = redeploy(value, reviewedSeed(3, "Second seed"));
  const secondSaved = await replace(value, "reviewed", [{ secondSaved: true }], second);
  const beforeHead = value.storage.sqlite.prepare("SELECT * FROM data_app_object_head_v1").get();
  const beforePointer = value.storage.sqlite.prepare("SELECT * FROM data_app_object_queries_v1 WHERE seed_sha256 = ?").get(originalHash);
  const beforeTimestamp = value.storage.sqlite.prepare("SELECT * FROM data_app_object_snapshots_v1 WHERE seed_sha256 = ?").get(originalHash);
  const batch = value.storage.db.batch;
  let interrupted = false;
  value.storage.db.batch = statements => {
    if (!interrupted && statements.some(({ sql }) => sql.startsWith("UPDATE data_app_object_head_v1"))) {
      interrupted = true;
      // Fail after the activation and resets execute, inside real SQLite's
      // transaction, rather than merely throwing before the write begins.
      statements = [...statements, value.storage.db.prepare("INSERT INTO synthetic_missing_table VALUES (1)")];
    }
    return batch(statements);
  };
  const response = await value.worker.fetch(request("/api/snapshot"), value.environment);
  assert.equal(response.status, 503);
  assert.equal(interrupted, true);
  assert.deepEqual(value.storage.sqlite.prepare("SELECT * FROM data_app_object_head_v1").get(), beforeHead);
  assert.deepEqual(value.storage.sqlite.prepare("SELECT * FROM data_app_object_queries_v1 WHERE seed_sha256 = ?").get(originalHash), beforePointer);
  assert.deepEqual(value.storage.sqlite.prepare("SELECT * FROM data_app_object_snapshots_v1 WHERE seed_sha256 = ?").get(originalHash), beforeTimestamp);
  const actual = await (await snapshot(value, second)).json();
  assert.deepEqual(actual.queries.reviewed.rows, secondSaved.rows);
  assert.equal(actual.generatedAt, secondSaved.generatedAt);
  assert.deepEqual(await (await snapshot(value)).json(), value.seed, "A later successful transition resets only the returning seed");
});

apiTest("first active-head adoption preserves existing object-storage owner edits", async t => {
  const value = fixture(t);
  const saved = await replace(value, "reviewed", [{ existingOwnerEdit: true }]);
  // Earlier indexed storage has these two overlay tables but no active head.
  value.storage.sqlite.exec("DROP TABLE data_app_object_head_v1");
  const actual = await (await snapshot(value)).json();
  assert.deepEqual(actual.queries.reviewed.rows, saved.rows);
  assert.equal(actual.generatedAt, saved.generatedAt);
});

apiTest("a small published v2 control keeps active owner rows and presentation when indexed publication is enabled", async t => {
  const seed = reviewedSeed(7), value = fixture(t, Buffer.from(JSON.stringify(seed, null, 2) + "\n"));
  const legacyFingerprint = snapshotResponseFingerprint(seed);
  assert.notEqual(legacyFingerprint.sha256, value.indexed.snapshotResponse.sha256, "Formatted source has two different, exact supported response encodings");
  value.allowWholeObjectParsing(true);
  const original = createDataAppWorker({ ...value.configuration, snapshotIndex: undefined });
  assert.deepEqual(await (await snapshot(value, original)).json(), value.seed);
  value.allowWholeObjectParsing(false);
  const unchangedBytes = Buffer.from(await (await snapshot(value)).arrayBuffer());
  assert.equal(hash(unchangedBytes), legacyFingerprint.sha256, "An active v2 head retains its exact canonical response serialization");
  assert.equal(unchangedBytes.length, legacyFingerprint.bytes);
  assert.notEqual(hash(unchangedBytes), value.indexed.snapshotResponse.sha256);
  const saved = await replace(value, "reviewed", [{ priorPublishedEdit: 4 }], original);
  const changed = await original.fetch(request("/api/presentation", { method: "PUT", email: owner, body: { revision: 0, presentation: { title: "Prior published owner title" } } }), value.environment);
  assert.equal(changed.status, 200);
  const head = value.storage.sqlite.prepare("SELECT current_generation, seed_sha256 FROM data_app_snapshot_head_v2 WHERE id='current'").get();
  const editedBytes = Buffer.from(await (await snapshot(value)).arrayBuffer()), after = JSON.parse(editedBytes);
  assert.deepEqual(after.queries.reviewed.rows, saved.rows);
  assert.equal(after.generatedAt, saved.generatedAt);
  assert.notEqual(hash(editedBytes), legacyFingerprint.sha256, "A real owner edit is not a matching canonical packaged seed");
  assert.notEqual(hash(editedBytes), value.indexed.snapshotResponse.sha256, "A real owner edit is not a matching indexed packaged seed");
  assert.deepEqual(value.storage.sqlite.prepare("SELECT current_generation, seed_sha256 FROM data_app_snapshot_head_v2 WHERE id='current'").get(), head);
  await replace(value, "reviewed", [{ currentPublishedEdit: 9 }]);
  assert.deepEqual((await (await snapshot(value)).json()).queries.reviewed.rows, [{ currentPublishedEdit: 9 }]);
  const presentation = await (await value.worker.fetch(request("/api/presentation", { email: owner }), value.environment)).json();
  assert.equal(presentation.canEdit, true);
  assert.equal(presentation.presentation.title, "Prior published owner title");
});

apiTest("empty v2 tables left by a failed publication do not prevent indexed large-value reads", async t => {
  const seed = reviewedSeed(2); seed.queries.reviewed.rows[1].large = "x".repeat(400_000);
  const value = fixture(t, Buffer.from(JSON.stringify(seed))), rawObject = value.stored.get(value.assets.snapshot.key);
  value.stored.delete(value.assets.snapshot.key);
  const previous = createDataAppWorker({ ...value.configuration, snapshotIndex: undefined });
  assert.equal((await previous.fetch(request("/api/snapshot"), value.environment)).status, 503);
  assert.equal(value.storage.sqlite.prepare("SELECT COUNT(*) AS count FROM data_app_snapshot_head_v2").get().count, 0);
  value.stored.set(value.assets.snapshot.key, rawObject);
  assert.deepEqual(await (await snapshot(value)).json(), seed);
  assert.equal(value.metrics.parsedObjects, 0);
});

apiTest("an old initializer arriving after object edits requires migration without hiding either stored revision", async t => {
  const value = fixture(t), seedHash = value.configuration.seedSnapshotSha256;
  const edited = await replace(value, "reviewed", [{ objectOwnerEdit: "preserve" }]);
  const objectPointer = value.storage.sqlite.prepare("SELECT query_id, revision, bytes FROM data_app_object_queries_v1 WHERE seed_sha256 = ? AND query_id = 'reviewed'").get(seedHash);
  const objectWrite = value.calls.find(call => call.kind === "put");
  const objectBytes = Buffer.from(value.stored.get(objectWrite.key).bytes);
  // Emulate an already-running old deployment finishing its initialization.
  const oldRead = () => snapshotResponse(value.storage.db, async () => value.seed, seedHash);
  assert.deepEqual(await (await oldRead()).json(), value.seed);
  const oldHead = value.storage.sqlite.prepare("SELECT current_generation, seed_sha256 FROM data_app_snapshot_head_v2 WHERE id = 'current'").get();
  for (const [path, options] of [["/api/snapshot", {}], [queryPath("reviewed"), { method: "PUT", email: owner, body: { rows: [{ mustNotReplaceEither: true }] } }]]) {
    const response = await value.worker.fetch(request(path, options), value.environment);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "LEGACY_SNAPSHOT_REQUIRES_MIGRATION");
  }
  assert.deepEqual(value.storage.sqlite.prepare("SELECT current_generation, seed_sha256 FROM data_app_snapshot_head_v2 WHERE id = 'current'").get(), oldHead);
  assert.deepEqual(value.storage.sqlite.prepare("SELECT query_id, revision, bytes FROM data_app_object_queries_v1 WHERE seed_sha256 = ? AND query_id = 'reviewed'").get(seedHash), objectPointer);
  assert.equal(value.storage.sqlite.prepare("SELECT generated_at FROM data_app_object_snapshots_v1 WHERE seed_sha256 = ?").get(seedHash).generated_at, edited.generatedAt);
  assert.deepEqual(value.stored.get(objectWrite.key).bytes, objectBytes);
  assert.deepEqual(JSON.parse(objectBytes), edited.rows);
  assert.deepEqual(await (await oldRead()).json(), value.seed);
});

apiTest("old initialization during an object upload rejects activation and preserves the old complete snapshot", async t => {
  const value = fixture(t), seedHash = value.configuration.seedSnapshotSha256;
  let activatedOld = false;
  value.hook(async kind => {
    if (kind === "put" && !activatedOld) {
      activatedOld = true;
      const old = await snapshotResponse(value.storage.db, async () => value.seed, seedHash);
      assert.deepEqual(await old.json(), value.seed);
    }
  });
  const response = await value.worker.fetch(request(queryPath("reviewed"), {
    method: "PUT", email: owner, body: { rows: [{ mustNotActivate: true }] },
  }), value.environment);
  assert.equal(activatedOld, true);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "SNAPSHOT_HEAD_CONFLICT");
  assert.equal(value.storage.sqlite.prepare("SELECT COUNT(*) AS count FROM data_app_object_queries_v1").get().count, 0);
  assert.equal(value.storage.sqlite.prepare("SELECT generated_at FROM data_app_object_snapshots_v1 WHERE seed_sha256 = ?").get(seedHash).generated_at, null);
  assert.deepEqual(await (await snapshot(value)).json(), value.seed);
});


apiTest("a hosted batch refresh preserves source metadata and captured streams", async t => {
  const seed = { generatedAt: "2026-01-01T00:00:00Z", queries: {
    sql: { rows: [{ value: 1 }], source: { sql: "SELECT value", executedAt: "2026-01-01T00:00:00Z" } },
    api: { source: { operation: "read_sheet", parameters: { sheet: "sales" } }, rows: [] },
    empty: {},
  } };
  const value = fixture(t, Buffer.from(JSON.stringify(seed)), { chunkBytes: 7 });
  const before = await snapshot(value);
  const updates = Object.keys(seed.queries).map(queryId => ({ queryId,
    rows: [{ value: 2 }], executedAt: "2026-02-01T00:00:00Z" }));
  const result = await value.worker.fetch(request("/api/queries", { method: "PUT", email: owner, body: { updates } }), value.environment);
  assert.equal(result.status, 200, await result.clone().text());
  const expectedBefore = structuredClone(seed); expectedBefore.queries.empty.rows = [];
  assert.deepEqual(await before.json(), expectedBefore);
  const expected = structuredClone(seed); expected.generatedAt = (await result.json()).generatedAt;
  for (const { queryId, rows, executedAt } of updates) {
    expected.queries[queryId].rows = rows;
    expected.queries[queryId].source = { ...expected.queries[queryId].source, executedAt };
  }
  assert.deepEqual(await (await snapshot(value)).json(), expected);
  const updated = await replace(value, "api", []);
  expected.queries.api.rows = []; expected.generatedAt = updated.generatedAt;
  assert.deepEqual(await (await snapshot(value)).json(), expected);
  assert.deepEqual(value.stored.get(value.assets.snapshot.key).bytes, value.raw);
  assert.equal(value.metrics.parsedObjects, 0);
});

apiTest("a failed hosted batch commit leaves all rows and timestamps unchanged", async t => {
  const value = fixture(t);
  await (await snapshot(value)).body.cancel();
  value.storage.sqlite.exec(`CREATE TRIGGER fail_refresh BEFORE UPDATE ON data_app_object_snapshots_v1
    BEGIN SELECT RAISE(ABORT, 'Failed timestamp write'); END`);
  const updates = ["reviewed", "empty"].map(queryId => ({ queryId,
    rows: [{ value: 2 }], executedAt: "2026-02-01T00:00:00Z" }));
  const result = await value.worker.fetch(request("/api/queries", { method: "PUT", email: owner, body: { updates } }), value.environment);
  assert.equal(result.status, 503);
  assert.deepEqual(await (await snapshot(value)).json(), value.seed);
});

apiTest("a concurrent hosted edit rejects the entire older batch", async t => {
  const value = fixture(t);
  await (await snapshot(value)).body.cancel();
  const paused = deferred(), resume = deferred(); let gated = false;
  value.hook(async kind => {
    if (kind === "put" && !gated) { gated = true; paused.resolve(); await resume.promise; }
  });
  const updates = ["reviewed", "empty"].map(queryId => ({ queryId,
    rows: [{ loser: true }], executedAt: "2026-02-01T00:00:00Z" }));
  const waiting = value.worker.fetch(request("/api/queries", { method: "PUT", email: owner, body: { updates } }), value.environment);
  await paused.promise;
  await replace(value, "reviewed", [{ winner: true }]);
  const winner = await (await snapshot(value)).json();
  resume.resolve();
  assert.equal((await waiting).status, 409);
  assert.deepEqual(await (await snapshot(value)).json(), winner);
});
