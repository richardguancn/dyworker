import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { createPublicationSession, servePublicationSession, asciiJson } from "../skills/publish-artifact-to-sites/scripts/publish-data-app.mjs";
import { PublicationGitError } from "../skills/publish-artifact-to-sites/scripts/publication-git.mjs";
import { publicationGitClient } from "../skills/publish-artifact-to-sites/scripts/publication-git-process.mjs";

const secret = "test-source-secret-that-must-never-be-printed";
const ingress = "test-ingress-secret-that-must-never-be-printed";
const sha = "a".repeat(40), manifestSha256 = "b".repeat(64);
const prepare = { op: "prepare", projectDir: "/authoring", projectId: "site-id",
  publicationProjectDir: "/publication", archivePath: "/report.tar.gz", siteUrl: "https://reviewed.chatgpt.site" };
const deployment = { project_id: "site-id", id: "deployment-id", version_id: "version-id", status: "succeeded", url: prepare.siteUrl };

function fixture(changes = {}) {
  const calls = [];
  let tokenHash, uploadToken;
  const source = { state: "pushed", commitSha: sha, manifestSha256 };
  const session = createPublicationSession({
    checkPreparation: async () => {},
    preflightPublicationGit: async () => ({ projectDir: "/authoring", sourceRevision: sha, identity: { name: "Writer", email: "writer@example.test" } }),
    initializePublicationGit: async () => { calls.push("initialize"); return { projectDir: "/authoring", sourceRevision: sha, identity: { name: "Writer", email: "writer@example.test" } }; },
    packageDataAppForSites: async options => { calls.push("package"); tokenHash = options["deployment-token-sha256"]; },
    createPublicationSource: async () => { calls.push("source"); return { publicationProjectDir: "/publication" }; },
    publishPublicationSource: async options => { calls.push("push"); assert.equal(options.credential.token, secret); return source; },
    verifyPublicationCandidate: async () => { calls.push("verify"); return { manifestSha256 }; },
    createPublicationArchive: async () => { calls.push("archive"); return { archivePath: "/report.tar.gz", sha256: "c".repeat(64), bytes: 200, files: ["dist/server/index.js"] }; },
    uploadDataAppAssets: async options => {
      calls.push("upload"); uploadToken = options.deploymentToken;
      assert.equal(options.sitesAuthorization, ingress);
      return { ready: true, siteUrl: options.siteUrl, queryCount: 1, rowCount: 10, uploads: [], readback: {} };
    }, ...changes,
  });
  return { session, calls, tokenHash: () => tokenHash, uploadToken: () => uploadToken };
}

test("native lifecycle boundary, one in-memory token, compact receipts and idempotent completed stages", async () => {
  const f = fixture();
  const responses = [];
  responses.push(await f.session.dispatch({ op: "preflight" }));
  responses.push(await f.session.dispatch(prepare));
  assert.equal((await f.session.dispatch({ op: "upload", deployment })).code, "NOT_PUSHED");
  const pushed = await f.session.dispatch({ op: "push", credential: { token: secret } });
  responses.push(pushed);
  assert.deepEqual(pushed.saveArguments, { project_id: "site-id", commit_sha: sha, archive: "/report.tar.gz" });
  assert.equal(pushed.archive.fileCount, 1);
  assert.equal(pushed.archive.files, undefined);
  assert.equal((await f.session.dispatch({ op: "push" })).ok, true);
  for (const invalid of [{ ...deployment, status: "pending" }, { ...deployment, project_id: "another-site" }]) {
    assert.equal((await f.session.dispatch({ op: "upload", deployment: invalid })).code, "DEPLOYMENT_NOT_READY");
  }
  assert.equal((await f.session.dispatch({ op: "upload", deployment, siteUrl: "https://another.chatgpt.site", sitesAuthorization: ingress })).code, "INVALID_SITE");
  responses.push(await f.session.dispatch({ op: "upload", deployment, siteUrl: prepare.siteUrl, sitesAuthorization: ingress }));
  responses.push(await f.session.dispatch({ op: "upload" }));
  assert.equal(responses.at(-1).stage, "ready");
  const { createHash } = await import("node:crypto");
  assert.equal(createHash("sha256").update(f.uploadToken()).digest("hex"), f.tokenHash());
  assert.deepEqual(f.calls, ["package", "source", "push", "verify", "archive", "verify", "upload"]);
  for (const forbidden of [secret, ingress, f.uploadToken(), "writer@example.test"]) assert.ok(!JSON.stringify(responses).includes(forbidden));
  const closed = await f.session.dispatch({ op: "close" });
  assert.equal(closed.projectId, undefined);
  assert.equal((await f.session.dispatch({ op: "status" })).code, "SESSION_CLOSED");
});

test("credential retry retains exact Git receipt without packaging or creating source again", async () => {
  const retry = { state: "committed", commitSha: sha, manifestSha256 };
  let attempts = 0;
  const f = fixture({ publishPublicationSource: async options => {
    if (++attempts === 1) throw new PublicationGitError("NETWORK_FAILED", "push", retry);
    assert.deepEqual(options.receipt, retry);
    return { ...retry, state: "pushed" };
  } });
  await f.session.dispatch(prepare);
  const failed = await f.session.dispatch({ op: "push", credential: { token: secret } });
  assert.equal(failed.code, "NETWORK_FAILED");
  assert.deepEqual(failed.source, retry);
  assert.equal((await f.session.dispatch({ op: "push", credential: { token: secret } })).stage, "archived");
  assert.equal(f.calls.filter(x => x === "package").length, 1);
  assert.equal(f.calls.filter(x => x === "source").length, 1);
});

test("changed output during a push cannot be paired with the earlier source commit", async () => {
  const f = fixture({ verifyPublicationCandidate: async () => ({ manifestSha256: "changed" }) });
  await f.session.dispatch(prepare);
  const result = await f.session.dispatch({ op: "push", credential: { token: secret } });
  assert.equal(result.code, "SOURCE_CHANGED");
  assert.equal(result.saveArguments, undefined);
  assert.ok(!f.calls.includes("archive"));
});

test("unexpected failures never echo secrets; retries preserve the live upload token", async () => {
  let attempts = 0;
  const f = fixture({ uploadDataAppAssets: async options => {
    if (++attempts === 1) throw new Error(`${secret} ${ingress} ${options.deploymentToken}`);
    assert.ok(options.deploymentToken.length >= 32);
    return { ready: true };
  } });
  await f.session.dispatch(prepare);
  await f.session.dispatch({ op: "push", credential: { token: secret } });
  const request = { op: "upload", deployment, siteUrl: prepare.siteUrl, sitesAuthorization: ingress };
  const result = await f.session.dispatch(request);
  assert.equal(result.code, "PUBLICATION_FAILED");
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes(ingress));
  assert.equal((await f.session.dispatch(request)).stage, "ready");
});

test("explicit new-project initialization uses its returned identity, without reading a parent again", async () => {
  const f = fixture({ preflightPublicationGit: async () => { throw new Error("No Git config in new root"); } });
  assert.equal((await f.session.dispatch({ ...prepare, initialize: true })).stage, "prepared");
  assert.equal(f.calls[0], "initialize");
});

async function destinationFixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "data publication destinations-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const projectDir = join(directory, "authoring");
  await mkdir(join(projectDir, "dist"), { recursive: true });
  await writeFile(join(projectDir, "dist/data-app-build.json"), JSON.stringify({ kind: "separate-data-v1" }));
  const calls = [];
  const session = createPublicationSession({
    preflightPublicationGit: async options => {
      calls.push("preflight");
      return { projectDir: options.projectDir, sourceRevision: sha, identity: { name: "Writer", email: "writer@example.test" } };
    },
    packageDataAppForSites: async () => { calls.push("package"); },
    createPublicationSource: async options => {
      calls.push("source");
      await mkdir(options.publicationProjectDir);
      return { publicationProjectDir: options.publicationProjectDir };
    },
  });
  return { directory, projectDir, calls, session, request: { ...prepare, projectDir,
    publicationProjectDir: join(directory, "output", "nested café 🚀", "checkout"),
    archivePath: join(directory, "archives", "nested café 🚀", "report.tar.gz") } };
}

test("preparation safely creates fresh nested output parents and uses canonical paths", async t => {
  const f = await destinationFixture(t);
  const alias = join(f.directory, "output alias");
  await symlink(f.directory, alias, process.platform === "win32" ? "junction" : "dir");
  const result = await f.session.dispatch({ ...f.request,
    publicationProjectDir: join(alias, "output", "nested café 🚀", "checkout") });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.publicationProjectDir, f.request.publicationProjectDir);
  assert.ok((await lstat(dirname(f.request.archivePath))).isDirectory());
  await assert.rejects(lstat(f.request.archivePath), { code: "ENOENT" });
  assert.deepEqual(f.calls, ["preflight", "package", "source"]);
});

test("an occupied destination fails specifically before creating parents or packaging", async t => {
  const f = await destinationFixture(t);
  const archivePath = join(f.directory, "existing.tar.gz");
  await writeFile(archivePath, "keep existing archive");
  const result = await f.session.dispatch({ ...f.request, archivePath });
  assert.equal(result.code, "DESTINATION_EXISTS");
  assert.equal(result.failedStage, "preparation");
  assert.equal(await readFile(archivePath, "utf8"), "keep existing archive");
  await assert.rejects(lstat(join(f.directory, "output")), { code: "ENOENT" });
  assert.deepEqual(f.calls, []);
});

test("aliases into authoring and overlapping destinations are rejected before mutation", async t => {
  const f = await destinationFixture(t);
  const authoringAlias = join(f.directory, "authoring alias");
  await symlink(f.projectDir, authoringAlias, process.platform === "win32" ? "junction" : "dir");
  for (const changes of [
    { publicationProjectDir: join(authoringAlias, "fresh", "checkout") },
    { archivePath: join(f.request.publicationProjectDir, "fresh", "report.tar.gz") },
    { publicationProjectDir: join(f.request.archivePath, "fresh", "checkout") },
    { archivePath: f.request.publicationProjectDir },
  ]) {
    assert.equal((await f.session.dispatch({ ...f.request, ...changes })).code, "INVALID_DESTINATION");
  }
  await assert.rejects(lstat(join(f.projectDir, "fresh")), { code: "ENOENT" });
  await assert.rejects(lstat(join(f.directory, "output")), { code: "ENOENT" });
  await assert.rejects(lstat(join(f.directory, "archives")), { code: "ENOENT" });
  assert.deepEqual(f.calls, []);
});

test("invalid parent files, dangling aliases and unsupported artifacts cannot create output parents", async t => {
  const f = await destinationFixture(t);
  const file = join(f.directory, "file");
  await writeFile(file, "keep existing file");
  assert.equal((await f.session.dispatch({ ...f.request, archivePath: join(file, "report.tar.gz") })).code, "INVALID_DESTINATION");
  const alias = join(f.directory, "dangling");
  await symlink(join(f.directory, "missing"), alias, process.platform === "win32" ? "junction" : "dir");
  assert.equal((await f.session.dispatch({ ...f.request, archivePath: alias })).code, "DESTINATION_EXISTS");
  assert.equal((await f.session.dispatch({ ...f.request, archivePath: join(alias, "report.tar.gz") })).code, "INVALID_DESTINATION");
  await writeFile(join(f.projectDir, "dist/data-app-build.json"), JSON.stringify({ kind: "legacy" }));
  assert.equal((await f.session.dispatch(f.request)).code, "UNSUPPORTED_LAYOUT");
  assert.equal(await readFile(file, "utf8"), "keep existing file");
  await assert.rejects(lstat(join(f.directory, "output")), { code: "ENOENT" });
  await assert.rejects(lstat(join(f.directory, "archives")), { code: "ENOENT" });
  assert.deepEqual(f.calls, []);
});

test("failed receipts retain elapsed stage timing and whitelist Git diagnostics", async () => {
  const error = new PublicationGitError("NETWORK_FAILED", "fetch");
  Object.assign(error, { operation: "ls-remote", subtype: "connection_reset", operationMilliseconds: 12,
    message: secret, stderr: ingress, command: secret, token: secret });
  const f = fixture({ publishPublicationSource: async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    throw error;
  } });
  await f.session.dispatch(prepare);
  const result = await f.session.dispatch({ op: "push", credential: { token: secret } });
  assert.equal(result.failedStage, "push");
  assert.equal(result.gitStage, "fetch");
  assert.equal(result.operation, "ls-remote");
  assert.equal(result.subtype, "connection_reset");
  assert.equal(result.operationMilliseconds, 12);
  assert.ok(result.milliseconds >= 10);
  assert.ok(result.stageMilliseconds >= 10);
  assert.ok(result.milliseconds >= result.stageMilliseconds);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes(ingress));
  Object.assign(error, { operation: secret, subtype: secret, stage: secret, operationMilliseconds: Infinity });
  const invalid = await f.session.dispatch({ op: "push", credential: { token: secret } });
  for (const field of ["gitStage", "operation", "subtype", "operationMilliseconds"]) assert.equal(invalid[field], undefined);
  assert.ok(!JSON.stringify(invalid).includes(secret));
});

test("unexpected errors cannot manufacture public codes or messages; archive stage timing stays separate", async () => {
  const f = fixture({ createPublicationArchive: async () => {
    throw Object.assign(new Error(secret), { publicationCode: secret, code: secret, operation: secret, subtype: secret });
  } });
  await f.session.dispatch(prepare);
  const result = await f.session.dispatch({ op: "push", credential: { token: secret } });
  assert.equal(result.code, "PUBLICATION_FAILED");
  assert.equal(result.stage, "pushed");
  assert.equal(result.failedStage, "archive");
  assert.ok(Number.isSafeInteger(result.milliseconds));
  assert.ok(Number.isSafeInteger(result.stageMilliseconds));
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("session emits only trusted Git stderr excerpts and redacts credentials despite hostile error fields", async () => {
  const git = publicationGitClient({ projectDir: "/publication", runner: () => ({ status: 128, signal: null,
    stderr: `fatal: source service refused the connection\nAuthorization: Bearer ${secret}\nproxy-authorization: Basic ${Buffer.from(ingress).toString("base64")}\n`,
    stdout: secret }) });
  let error;
  try { git(["ls-remote", "https://reviewed.chatgpt.site"], { stage: "fetch", fallback: "NETWORK_FAILED",
    config: [["http.extraHeader", `Authorization: Bearer ${secret}`]] }); }
  catch (caught) { error = caught; }
  assert.ok(error instanceof PublicationGitError);
  Object.assign(error, { stderrExcerpt: secret, stderr: secret, stdout: ingress, exitStatus: secret, signal: secret });
  const f = fixture({ publishPublicationSource: async () => { throw error; } });
  await f.session.dispatch(prepare);
  const result = await f.session.dispatch({ op: "push", credential: { token: secret } });
  assert.equal(result.exitStatus, 128);
  assert.equal(result.signal, null);
  assert.match(result.stderrExcerpt, /source service refused the connection/u);
  for (const value of [secret, ingress, Buffer.from(ingress).toString("base64")]) assert.ok(!JSON.stringify(result).includes(value));
  error = Object.assign(new PublicationGitError("NETWORK_FAILED", "fetch"), {
    stderrExcerpt: secret, exitStatus: 128, signal: "SIGTERM",
  });
  const forged = await f.session.dispatch({ op: "push", credential: { token: secret } });
  for (const field of ["stderrExcerpt", "exitStatus", "signal"]) assert.equal(forged[field], undefined);
  assert.ok(!JSON.stringify(forged).includes(secret));
});

test("JSONL accepts fragmented CRLF, CR, Unicode and EOF; output is ASCII and requests are not echoed", async () => {
  const values = [], output = [];
  const session = { dispatch: async request => { values.push(request); return request.op === "close"
    ? { ok: true, stage: "closed" } : { ok: true, stage: "echo-test", path: request.path }; } };
  const path = "C:\\Reports and notes\\café 🚀\\report.html";
  const input = Buffer.from(`${JSON.stringify({ path })}\r\n{bad-${secret}}\r${JSON.stringify({ path })}`);
  await servePublicationSession(Readable.from(Array.from(input, byte => Buffer.from([byte]))), new Writable({ write(chunk, _, callback) { output.push(chunk); callback(); } }), session);
  const text = Buffer.concat(output).toString("utf8");
  assert.match(text, /^[\x00-\x7f]*$/u);
  assert.ok(!text.includes(secret));
  const replies = text.trim().split("\n").map(JSON.parse);
  assert.equal(replies[0].echo, false);
  assert.equal(replies[1].path, path);
  assert.equal(replies[2].code, "INVALID_JSON");
  assert.equal(replies[3].path, path);
  assert.equal(values.at(-1).op, "close");
  assert.equal(JSON.parse(asciiJson({ path })).path, path);
});

test("oversized and invalid UTF-8 commands are rejected without retaining or printing input", async () => {
  const output = [], dispatched = [];
  await servePublicationSession(Readable.from([Buffer.alloc(65537, 120), Buffer.from("\n"), Buffer.from([0xff, 10]), Buffer.from('{"op":"close"}\n')]),
    new Writable({ write(chunk, _, callback) { output.push(chunk); callback(); } }),
    { dispatch: async request => { dispatched.push(request); return { ok: true, stage: "closed" }; } });
  const text = Buffer.concat(output).toString();
  assert.ok(text.length < 1000);
  assert.ok(text.includes("REQUEST_TOO_LARGE"));
  assert.ok(text.includes("INVALID_JSON"));
  assert.ok(dispatched.every(x => x.op === "close"));
});

test("CLI starts through an aliased directory and remains importable from stdin", async t => {
  const directory = await mkdtemp(join(tmpdir(), "data publication CLI-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scriptDirectory = fileURLToPath(new URL("../skills/publish-artifact-to-sites/scripts/", import.meta.url));
  const alias = join(directory, "publishing café 🚀");
  await symlink(scriptDirectory, alias, process.platform === "win32" ? "junction" : "dir");
  const result = spawnSync(process.execPath, [join(alias, "publish-data-app.mjs")], {
    input: '{"op":"status"}\r\n{"op":"close"}\r\n', encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdout.trim().split("\n").map(line => JSON.parse(line).stage), ["listening", "idle", "closed"]);
  const moduleUrl = new URL("../skills/publish-artifact-to-sites/scripts/publish-data-app.mjs", import.meta.url).href;
  for (const stdinArgument of [[], ["-"]]) {
    const imported = spawnSync(process.execPath, ["--input-type=module", ...stdinArgument], {
      input: `const { createPublicationSession } = await import(${JSON.stringify(moduleUrl)});\n` +
        'console.log((await createPublicationSession().dispatch({op:"status"})).stage);\n', encoding: "utf8",
    });
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, "idle\n");
  }
});
