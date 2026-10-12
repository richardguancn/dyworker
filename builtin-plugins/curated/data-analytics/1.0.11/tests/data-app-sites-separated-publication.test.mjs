import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createDataAppWorker } from "../templates/data-app/base/src/data-app-worker.js";
import { fixtureDatabase, reviewedSeed, sqliteUnavailable } from "../templates/data-app/base/tests/snapshot-storage-fixture.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const owner = "owner@example.com", token = "synthetic-current-deployment-only";
const authorization = { sha256: hash(token), expiresAt: "2999-01-01T00:00:00.000Z" };
function descriptor(kind, body) {
  const sha256 = hash(body);
  return { key: `data-app/${kind}/${sha256}`, sha256, bytes: Buffer.byteLength(body) };
}
function fixture(seed = reviewedSeed(5), raw = JSON.stringify(seed)) {
  const html = "<!doctype html><html><head></head><body>Reviewed application</body></html>";
  const assets = { html: descriptor("html", html), snapshot: descriptor("snapshot", raw) };
  const stored = new Map([
    [assets.html.key, { raw: html, size: assets.html.bytes, customMetadata: { sha256: assets.html.sha256 } }],
    [assets.snapshot.key, { raw, size: assets.snapshot.bytes, customMetadata: { sha256: assets.snapshot.sha256 } }],
  ]);
  const calls = [];
  let forbidJson = false;
  const bucket = {
    async get(key) {
      calls.push(key);
      const value = stored.get(key);
      if (!value) return null;
      return { size: value.size, customMetadata: value.customMetadata, body: new Response(value.raw).body,
        async json() {
          assert.equal(forbidJson, false, "Immutable asset reads must not parse the snapshot");
          return JSON.parse(value.raw);
        } };
    },
    async put() { assert.fail("Read-only immutable snapshot tests must not write bucket objects"); },
  };
  return { seed, raw, html, assets, stored, calls, bucket, forbidJson() { forbidJson = true; },
    configuration: { deploymentAssets: assets, deploymentUploadAuthorization: authorization } };
}
function request(path, { email, deploymentToken, method = "GET", body, headers = {} } = {}) {
  return new Request(`https://same-site.example${path}`, { method,
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    headers: { ...(email ? { "oai-authenticated-user-email": email } : {}), ...(deploymentToken ? { "x-data-app-deployment-token": deploymentToken } : {}), ...headers } });
}
const currentPath = "/api/deployment-assets/snapshot";
const noStorage = {
  DATA_APP_OWNER_EMAIL_SHA256: hash(owner),
  get BUCKET() { assert.fail("Rejected immutable reads must not access the bucket"); },
  get DB() { assert.fail("Immutable asset reads must not access mutable database state"); },
};
function immutableEnvironment(value) {
  value.forbidJson();
  return { DATA_APP_OWNER_EMAIL_SHA256: hash(owner), BUCKET: value.bucket, get DB() { assert.fail("Immutable asset reads must not access mutable database state"); } };
}

test("current immutable snapshot streams exact original bytes for owner or current deployment token", async () => {
  const seed = reviewedSeed(3); seed.queries.reviewed.rows[2].unicode = "café 日本語 🧪".repeat(50_000);
  const raw = JSON.stringify(seed, null, 2) + "\n";
  const value = fixture(seed, raw), worker = createDataAppWorker(value.configuration), environment = immutableEnvironment(value);
  for (const viewer of [{ email: owner.toUpperCase() }, { deploymentToken: token }]) {
    const response = await worker.fetch(request(currentPath, viewer), environment);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.ok(response.body instanceof ReadableStream);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, value.assets.snapshot.bytes);
    assert.equal(hash(bytes), value.assets.snapshot.sha256);
    assert.equal(bytes.toString(), raw);
  }
  assert.deepEqual(value.calls, [value.assets.snapshot.key, value.assets.snapshot.key]);
});

test("current immutable snapshot rejects absent, foreign, incorrect, expired and malformed authority before storage", async t => {
  for (const [name, viewer, override, ownerValue = hash(owner)] of [
    ["anonymous", {}, {}], ["nonowner viewer", { email: "viewer@example.com" }, {}],
    ["incorrect token", { deploymentToken: "incorrect" }, {}], ["oversized token", { deploymentToken: "x".repeat(257) }, {}],
    ["expired token", { deploymentToken: token }, { deploymentUploadAuthorization: { ...authorization, expiresAt: "2000-01-01T00:00:00Z" } }],
    ["malformed expiry", { deploymentToken: token }, { deploymentUploadAuthorization: { ...authorization, expiresAt: "invalid" } }],
    ["no token configuration", { deploymentToken: token }, { deploymentUploadAuthorization: undefined }],
    ["invalid owner configuration", { email: owner }, {}, "invalid"],
  ]) await t.test(name, async () => {
    const value = fixture(), worker = createDataAppWorker({ ...value.configuration, ...override });
    const environment = Object.create(noStorage);
    environment.DATA_APP_OWNER_EMAIL_SHA256 = ownerValue;
    assert.equal((await worker.fetch(request(currentPath, viewer), environment)).status, 403);
  });
});

test("historical snapshots are owner-only fixed content-addressed reads independent of the current descriptor", async () => {
  const value = fixture(), worker = createDataAppWorker(value.configuration);
  const priorRaw = JSON.stringify({ id: "prior", queries: { old: { rows: [{ value: 13, note: "exact old bytes" }] } } }, null, 3) + "\n";
  const prior = descriptor("snapshot", priorRaw);
  value.stored.set(prior.key, { raw: priorRaw, size: prior.bytes, customMetadata: { sha256: prior.sha256 } });
  const environment = immutableEnvironment(value), path = `${currentPath}?sha256=${prior.sha256}`;
  for (const viewer of [{}, { email: "viewer@example.com" }, { deploymentToken: token }, { deploymentToken: token, email: "viewer@example.com" }]) {
    assert.equal((await worker.fetch(request(path, viewer), noStorage)).status, 403);
  }
  const response = await worker.fetch(request(path, { email: owner }), environment);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(await response.text(), priorRaw);
  assert.deepEqual(value.calls, [prior.key]);
  // Supplying even the current digest through the historical API requires owner auth.
  assert.equal((await worker.fetch(request(`${currentPath}?sha256=${value.assets.snapshot.sha256}`, { deploymentToken: token }), noStorage)).status, 403);
});

test("historical query validation rejects unknown, repeated, malformed or escaping selectors before storage", async () => {
  const value = fixture(), worker = createDataAppWorker(value.configuration), valid = value.assets.snapshot.sha256;
  for (const query of ["sha256=", "sha256=abc", `sha256=${"A".repeat(64)}`, `sha256=${valid}&sha256=${valid}`, `sha256=${valid}&unknown=x`,
    `unknown=${valid}`, "sha256=..%2f..%2fprivate", "sha256=%00", `key=data-app%2Fsnapshot%2F${valid}`]) {
    assert.equal((await worker.fetch(request(`${currentPath}?${query}`, { email: owner }), noStorage)).status, 400, query);
  }
  for (const path of [`${currentPath}/../private`, `${currentPath}%2fprivate`, `${currentPath}/extra`, "/api/deployment-assets/%73napshot"]) {
    assert.equal((await worker.fetch(request(path, { email: owner }), noStorage)).status, 404, path);
  }
});

test("historical selectors cannot write snapshots, including with owner or deployment authority", async () => {
  const value = fixture(), worker = createDataAppWorker(value.configuration), path = `${currentPath}?sha256=${value.assets.snapshot.sha256}`;
  for (const viewer of [{ email: owner }, { deploymentToken: token }]) {
    const response = await worker.fetch(request(path, { ...viewer, method: "PUT", body: value.raw, headers: { "content-length": String(value.assets.snapshot.bytes) } }), noStorage);
    assert.equal(response.status, 400);
  }
  for (const method of ["POST", "DELETE", "PATCH", "HEAD"]) {
    assert.equal((await worker.fetch(request(path, { email: owner, method }), noStorage)).status, 404);
  }
});

test("missing storage, absent assets, invalid sizes and mismatched metadata fail without parsing or database use", async t => {
  for (const historical of [false, true]) await t.test(historical ? "historical" : "current", async () => {
    const value = fixture(), worker = createDataAppWorker(value.configuration);
    const path = currentPath + (historical ? `?sha256=${value.assets.snapshot.sha256}` : "");
    const saved = value.stored.get(value.assets.snapshot.key), environment = immutableEnvironment(value);
    assert.equal((await worker.fetch(request(path, { email: owner }), { DATA_APP_OWNER_EMAIL_SHA256: hash(owner) })).status, 503);
    assert.equal((await worker.fetch(request(path, { email: owner }), { DATA_APP_OWNER_EMAIL_SHA256: hash(owner), BUCKET: { async get() { throw Error("Private storage detail"); } } })).status, 503);
    value.stored.delete(value.assets.snapshot.key);
    assert.equal((await worker.fetch(request(path, { email: owner }), environment)).status, 503);
    for (const invalid of [{ ...saved, customMetadata: undefined }, { ...saved, customMetadata: { sha256: "f".repeat(64) } },
      ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "42", NaN].map(size => ({ ...saved, size }))]) {
      value.stored.set(value.assets.snapshot.key, invalid);
      const response = await worker.fetch(request(path, { email: owner }), environment);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, "Immutable snapshot is unavailable.");
    }
    if (!historical) {
      value.stored.set(value.assets.snapshot.key, { ...saved, size: saved.size + 1 });
      assert.equal((await worker.fetch(request(path, { email: owner }), environment)).status, 503, "Current read checks configured size exactly");
    }
  });
});

test("invalid explicit canonical seed hashes fail before any request and omitted hashes stay compatible", () => {
  const value = fixture();
  for (const seedSnapshotSha256 of [null, false, 0, "", "a".repeat(63), "A".repeat(64), `${"a".repeat(64)}\n`]) {
    assert.throws(() => createDataAppWorker({ ...value.configuration, seedSnapshotSha256 }), /canonical Data app seed fingerprint is invalid/);
  }
  assert.doesNotThrow(() => createDataAppWorker(value.configuration));
  assert.doesNotThrow(() => createDataAppWorker({ ...value.configuration, seedSnapshotSha256: hash(value.raw) }));
});

test("formatting-only raw snapshot changes preserve legacy canonical seed edits and mutable presentation", { skip: sqliteUnavailable }, async t => {
  const original = fixture(), storage = fixtureDatabase(); t.after(() => storage.close());
  const environment = { DATA_APP_OWNER_EMAIL_SHA256: hash(owner), DB: storage.db, BUCKET: original.bucket };
  const initial = createDataAppWorker({ ...original.configuration, initialPresentation: { title: "Initial seed title" } });
  assert.deepEqual(await (await initial.fetch(request("/api/snapshot"), environment)).json(), original.seed);
  const editedRows = [{ value: 99, note: "Owner-reviewed correction" }];
  assert.equal((await initial.fetch(request("/api/queries/reviewed", { email: owner, method: "PUT", body: { rows: editedRows } }), environment)).status, 200);
  assert.equal((await initial.fetch(request("/api/presentation", { email: owner, method: "PUT", body: { revision: 0, presentation: { title: "Saved owner title" } } }), environment)).status, 200);
  const headBefore = storage.sqlite.prepare("SELECT current_generation, seed_sha256 FROM data_app_snapshot_head_v2 WHERE id='current'").get();
  assert.equal(headBefore.seed_sha256, original.assets.snapshot.sha256, "Omitted canonical config retains the existing asset-hash seed contract");

  const formatted = fixture(original.seed, JSON.stringify(original.seed, null, 2) + "\n");
  assert.notEqual(formatted.assets.snapshot.sha256, original.assets.snapshot.sha256);
  const canonicalSeedHash = hash(JSON.stringify(JSON.parse(formatted.raw)));
  assert.equal(canonicalSeedHash, original.assets.snapshot.sha256);
  formatted.stored.set(original.assets.snapshot.key, original.stored.get(original.assets.snapshot.key));
  const redeployed = createDataAppWorker({ ...formatted.configuration, seedSnapshotSha256: canonicalSeedHash, initialPresentation: { title: "New packaged default" } });
  const nextEnvironment = { DATA_APP_OWNER_EMAIL_SHA256: hash(owner), DB: storage.db, BUCKET: formatted.bucket };
  const after = await (await redeployed.fetch(request("/api/snapshot"), nextEnvironment)).json();
  assert.deepEqual(after.queries.reviewed.rows, editedRows);
  assert.deepEqual(after.queries.__proto__, original.seed.queries.__proto__);
  assert.deepEqual(after.queries.empty, original.seed.queries.empty);
  assert.deepEqual(storage.sqlite.prepare("SELECT current_generation, seed_sha256 FROM data_app_snapshot_head_v2 WHERE id='current'").get(), headBefore);
  const presentation = await (await redeployed.fetch(request("/api/presentation", { email: owner }), nextEnvironment)).json();
  assert.equal(presentation.presentation.title, "Saved owner title");
  assert.equal(presentation.canEdit, true);
  assert.deepEqual(formatted.calls, [], "Warm same-seed reads do not parse either full source asset");
  const immutable = await redeployed.fetch(request(currentPath, { email: owner }), immutableEnvironment(formatted));
  assert.equal(await immutable.text(), formatted.raw, "Immutable source remains the reviewed seed, separate from mutable owner rows");
  const historical = await redeployed.fetch(request(`${currentPath}?sha256=${original.assets.snapshot.sha256}`, { email: owner }), immutableEnvironment(formatted));
  assert.equal(await historical.text(), original.raw);
});

test("changed canonical seed data activates the new complete source without resetting presentation", { skip: sqliteUnavailable }, async t => {
  const original = fixture(), storage = fixtureDatabase(); t.after(() => storage.close());
  const first = createDataAppWorker(original.configuration), environment = { DATA_APP_OWNER_EMAIL_SHA256: hash(owner), DB: storage.db, BUCKET: original.bucket };
  await (await first.fetch(request("/api/snapshot"), environment)).json();
  await first.fetch(request("/api/presentation", { email: owner, method: "PUT", body: { revision: 0, presentation: { title: "Preserve layout title" } } }), environment);
  const changedSeed = structuredClone(original.seed); changedSeed.queries.reviewed.rows[0].value = 456;
  const changed = fixture(changedSeed, JSON.stringify(changedSeed, null, 2)), next = createDataAppWorker({ ...changed.configuration, seedSnapshotSha256: hash(JSON.stringify(changedSeed)) });
  const nextEnvironment = { DATA_APP_OWNER_EMAIL_SHA256: hash(owner), DB: storage.db, BUCKET: changed.bucket };
  assert.deepEqual(await (await next.fetch(request("/api/snapshot"), nextEnvironment)).json(), changedSeed);
  assert.equal((await (await next.fetch(request("/api/presentation", { email: owner }), nextEnvironment)).json()).presentation.title, "Preserve layout title");
});
