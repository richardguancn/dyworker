import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, realpath, stat, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { uploadDataAppAssets } from "../skills/publish-artifact-to-sites/scripts/upload-data-app-assets.mjs";

const fingerprint = value => ({ sha256: createHash("sha256").update(value).digest("hex"), bytes: Buffer.byteLength(value) });
async function fixture(t, rawSnapshot) {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "data-upload-test-"));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  const directory = path.join(projectDir, ".data-app-assets");
  await mkdir(directory);
  const bodies = { html: "<html>reviewed dashboard</html>", snapshot: rawSnapshot ?? JSON.stringify({ queries: { q: { rows: [{ payload: "x".repeat(1100000) }] } } }) };
  const manifest = { version: 1, projectId: "project_test", thinBootstrap: true,
    assets: Object.fromEntries(Object.entries(bodies).map(([kind, body]) => {
      const digest = fingerprint(body);
      return [kind, { ...digest, key: `data-app/${kind}/${digest.sha256}`, path: `${kind}.txt` }];
    })), snapshotResponse: { ...fingerprint(bodies.snapshot), queryCount: 1, rowCount: 1 } };
  await Promise.all(Object.entries(bodies).map(([kind, body]) => writeFile(path.join(directory, `${kind}.txt`), body)));
  const save = () => writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  await save();
  return { projectDir, directory, manifest, bodies, save,
    input: { projectDir, projectId: "project_test", siteUrl: "https://example.openai.chatgpt.site/", deploymentToken: "d".repeat(64), sitesAuthorization: "test-ingress-token" } };
}

test("streams exact payloads and verifies complete hosted HTML and snapshot before readiness", async t => {
  const { input, manifest, bodies } = await fixture(t);
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url: String(url), method: options.method ?? "GET" });
    assert.equal(options.redirect, "error");
    assert.equal(url.origin, "https://example.openai.chatgpt.site");
    assert.equal(options.headers["OAI-Sites-Authorization"], "Bearer test-ingress-token");
    if (options.method === "PUT") {
      const kind = url.pathname.split("/").at(-1);
      assert.equal(options.duplex, "half");
      assert.equal(options.headers["content-encoding"], undefined);
      assert.equal(options.headers["content-length"], String(manifest.assets[kind].bytes));
      assert.equal(options.headers["x-data-app-deployment-token"], input.deploymentToken);
      assert.equal(typeof options.body[Symbol.asyncIterator], "function");
      const hash = createHash("sha256");
      let bytes = 0;
      for await (const chunk of options.body) { hash.update(chunk); bytes += chunk.length; }
      assert.equal(hash.digest("hex"), manifest.assets[kind].sha256);
      return Response.json({ kind, bytes, sha256: manifest.assets[kind].sha256 });
    }
    if (options.method === "HEAD") return new Response(null, { headers: { "content-type": "text/html; charset=utf-8" } });
    assert.equal(options.headers["x-data-app-deployment-token"], url.pathname.endsWith("/html") ? input.deploymentToken : undefined);
    return new Response(url.pathname.endsWith("/html") ? bodies.html : bodies.snapshot);
  };
  const receipt = await uploadDataAppAssets(input, { request });
  assert.equal(receipt.ready, true);
  assert.equal(receipt.rowCount, 1);
  assert.deepEqual(receipt.uploads.map(({ transport }) => transport),
    ["html", "snapshot"].map(kind => ({ encoding: "identity", bytes: manifest.assets[kind].bytes })));
  assert.equal(requests.length, 5);
  assert.equal(receipt.readback.snapshot.sha256, manifest.snapshotResponse.sha256);
  assert.doesNotMatch(JSON.stringify(receipt), /test-ingress-token|dddddddd/u);
});

function readbackRequest(item, snapshot) {
  return async (url, options) => {
    if (options.method === "PUT") {
      for await (const _chunk of options.body) { /* consume the verified upload */ }
      const kind = url.pathname.split("/").at(-1);
      return Response.json({ kind, ...item.manifest.assets[kind] });
    }
    if (options.method === "HEAD") return new Response(null, { headers: { "content-type": "text/html" } });
    return new Response(url.pathname.endsWith("/html") ? item.bodies.html : snapshot);
  };
}

test("accepts only the two exact approved encodings, including a longer legacy encoding", async t => {
  const item = await fixture(t, '{"queries":{"q":{"rows":[{"n":1e20}]}}}');
  const canonical = JSON.stringify(JSON.parse(item.bodies.snapshot));
  item.manifest.legacySnapshotResponse = { ...fingerprint(canonical), queryCount: 1, rowCount: 1 };
  await item.save();
  assert.ok(item.manifest.legacySnapshotResponse.bytes > item.manifest.snapshotResponse.bytes);
  for (const [body, label] of [[item.bodies.snapshot, "snapshotResponse"], [canonical, "legacySnapshotResponse"]]) {
    const receipt = await uploadDataAppAssets(item.input, { request: readbackRequest(item, body) });
    assert.equal(receipt.ready, true);
    assert.equal(receipt.readback.snapshot.matchedEncoding, label);
    assert.deepEqual({ sha256: receipt.readback.snapshot.sha256, bytes: receipt.readback.snapshot.bytes }, fingerprint(body));
  }
  // Same row count is not enough: changed owner data and a third whitespace
  // encoding both fail exact equality, even though the latter parses identically.
  for (const body of [canonical.replace("100000000000000000000", "200000000000000000000"), item.bodies.snapshot + " "]) {
    await assert.rejects(uploadDataAppAssets(item.input, { request: readbackRequest(item, body) }), /differs from the packaged artifact/u);
  }
  await assert.rejects(uploadDataAppAssets(item.input, { request: readbackRequest(item, canonical + " ") }), /exceeds its expected byte length/u);
});

test("identical approved fingerprints do not claim which storage path served them", async t => {
  const item = await fixture(t, '{"queries":{"q":{"rows":[{}]}}}');
  item.manifest.legacySnapshotResponse = { ...item.manifest.snapshotResponse };
  await item.save();
  const receipt = await uploadDataAppAssets(item.input, { request: readbackRequest(item, item.bodies.snapshot) });
  assert.equal(receipt.readback.snapshot.matchedEncoding, "snapshotResponse+legacySnapshotResponse");
});

test("invalid or incomplete alternate fingerprints fail before any upload", async t => {
  const item = await fixture(t);
  const request = () => assert.fail("must reject malformed alternate before network writes");
  const valid = { ...item.manifest.snapshotResponse };
  for (const legacy of [null, {}, { ...valid, sha256: "invalid" }, { ...valid, bytes: -1 },
    { ...valid, queryCount: 2 }, { ...valid, rowCount: 2 }, { ...valid, rowCount: 0.5 }]) {
    item.manifest.legacySnapshotResponse = legacy;
    await item.save();
    await assert.rejects(uploadDataAppAssets(item.input, { request }), /same complete reviewed snapshot/u);
  }
});

test("rejects changed local data, wrong Site identity and escaping files before network writes", async t => {
  const { input, directory, manifest, save } = await fixture(t);
  const request = () => { assert.fail("must fail before network"); };
  await assert.rejects(uploadDataAppAssets({ ...input, projectId: "another_project" }, { request }), /selected Site/u);
  await writeFile(path.join(directory, "snapshot.txt"), "tampered");
  await assert.rejects(uploadDataAppAssets(input, { request }), /local integrity/u);
  await rm(path.join(directory, "html.txt"));
  await symlink(path.join(input.projectDir, "outside.html"), path.join(directory, "html.txt"));
  await writeFile(path.join(input.projectDir, "outside.html"), "<html>reviewed dashboard</html>");
  await assert.rejects(uploadDataAppAssets(input, { request }), /local integrity/u);
  manifest.assets.html.path = "../outside.html";
  await save();
  await assert.rejects(uploadDataAppAssets(input, { request }), /descriptor/u);
});

test("refuses a mismatched acknowledgement and omits failed response content", async t => {
  const { input } = await fixture(t);
  await assert.rejects(uploadDataAppAssets(input, { request: async (_url, options) => {
    for await (const _chunk of options.body) { /* consume upload */ }
    return Response.json({ kind: "html", bytes: 2, sha256: "a".repeat(64) });
  } }), /acknowledgement/u);
  await assert.rejects(uploadDataAppAssets(input, { request: async () => new Response("private failure data", { status: 403 }) }), error => {
    assert.match(error.message, /HTTP 403/u);
    assert.doesNotMatch(error.message, /private failure data/u);
    return true;
  });
});

test("requires an exact HTTPS origin and never follows a failed request", async t => {
  const { input } = await fixture(t);
  const request = () => assert.fail("must reject invalid origin before network");
  for (const siteUrl of ["http://example.openai.chatgpt.site/", "https://name:secret@example.openai.chatgpt.site/", "https://example.openai.chatgpt.site/?token=secret"]) {
    await assert.rejects(uploadDataAppAssets({ ...input, siteUrl }, { request }), /exact HTTPS/u);
  }
  await assert.rejects(uploadDataAppAssets(input, { request: async (_url, options) => {
    assert.equal(options.redirect, "error");
    throw new Error("redirect to secret-ingress-token");
  } }), error => {
    assert.match(error.message, /Site request failed/u);
    assert.doesNotMatch(error.message, /secret-ingress-token/u);
    return true;
  });
});


test("large upload transport uses a private gzip stream while preserving raw identity and readback", async t => {
  const item = await fixture(t);
  const compressedPaths = [];
  const request = async (url, options) => {
    if (options.method !== "PUT") return readbackRequest(item, item.bodies.snapshot)(url, options);
    const kind = url.pathname.split("/").at(-1);
    const chunks = [];
    for await (const chunk of options.body) chunks.push(chunk);
    const transportBytes = Buffer.concat(chunks);
    assert.equal(Number(options.headers["content-length"]), transportBytes.length);
    if (kind === "snapshot") {
      assert.equal(options.headers["content-encoding"], "gzip");
      assert.ok(transportBytes.length < item.manifest.assets.snapshot.bytes);
      assert.deepEqual(gunzipSync(transportBytes), Buffer.from(item.bodies.snapshot));
      compressedPaths.push(options.body.path);
      assert.notEqual(path.dirname(options.body.path), item.directory);
      if (process.platform !== "win32") {
        assert.equal((await stat(options.body.path)).mode & 0o777, 0o600);
        assert.equal((await stat(path.dirname(options.body.path))).mode & 0o777, 0o700);
      }
    } else {
      assert.equal(options.headers["content-encoding"], undefined);
      assert.equal(transportBytes.toString(), item.bodies.html);
    }
    return Response.json({ kind, ...item.manifest.assets[kind] });
  };
  const receipt = await uploadDataAppAssets(item.input, {
    request, gzipThresholdBytes: item.manifest.assets.snapshot.bytes,
  });
  assert.equal(receipt.ready, true);
  assert.equal(receipt.uploads[0].transport.encoding, "identity");
  assert.equal(receipt.uploads[1].transport.encoding, "gzip");
  assert.ok(receipt.uploads[1].transport.bytes < receipt.uploads[1].bytes);
  assert.equal(receipt.readback.snapshot.sha256, item.manifest.snapshotResponse.sha256);
  assert.equal(compressedPaths.length, 1);
  for (const file of compressedPaths) {
    await assert.rejects(access(file), { code: "ENOENT" });
    await assert.rejects(access(path.dirname(file)), { code: "ENOENT" });
    assert.ok(!JSON.stringify(receipt).includes(file));
  }
  for (const kind of ["html", "snapshot"]) {
    assert.deepEqual(await readFile(path.join(item.directory, `${kind}.txt`)), Buffer.from(item.bodies[kind]));
  }
});

test("gzip candidates that do not shrink use the original plain payload", async t => {
  const item = await fixture(t, '{"queries":{}}');
  const request = async (url, options) => {
    if (options.method === "PUT") {
      const kind = url.pathname.split("/").at(-1);
      assert.equal(options.headers["content-encoding"], undefined);
      assert.equal(options.body.path, await realpath(path.join(item.directory, `${kind}.txt`)));
      assert.equal(Number(options.headers["content-length"]), item.manifest.assets[kind].bytes);
    }
    return readbackRequest(item, item.bodies.snapshot)(url, options);
  };
  const receipt = await uploadDataAppAssets(item.input, { request, gzipThresholdBytes: 1 });
  assert.ok(receipt.uploads.every(upload => upload.transport.encoding === "identity" && upload.transport.bytes === upload.bytes));
});

test("gzip temporary files are removed after request, acknowledgement and readback failures", async t => {
  for (const failure of ["request", "acknowledgement", "readback"]) await t.test(failure, async t => {
    const item = await fixture(t);
    let compressedFile;
    const request = async (url, options) => {
      if (options.method === "PUT" && url.pathname.endsWith("/snapshot")) {
        compressedFile = options.body.path;
        assert.equal(options.headers["content-encoding"], "gzip");
        if (failure === "request") throw new Error("Synthetic upload interruption");
        for await (const _chunk of options.body) { /* consume the gzip stream */ }
        if (failure === "acknowledgement") return Response.json({ kind: "snapshot", bytes: 1, sha256: "a".repeat(64) });
        return Response.json({ kind: "snapshot", ...item.manifest.assets.snapshot });
      }
      if (failure === "readback" && url.pathname === "/api/snapshot") return new Response("changed");
      return readbackRequest(item, item.bodies.snapshot)(url, options);
    };
    await assert.rejects(uploadDataAppAssets(item.input, { request, gzipThresholdBytes: 1024 }),
      /Site request failed|acknowledgement|differs from the packaged artifact/u);
    assert.ok(compressedFile);
    await assert.rejects(access(compressedFile), { code: "ENOENT" });
    await assert.rejects(access(path.dirname(compressedFile)), { code: "ENOENT" });
    assert.equal(await readFile(path.join(item.directory, "snapshot.txt"), "utf8"), item.bodies.snapshot);
  });
});
