import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { initializePublicationGit, preflightPublicationGit, publishPublicationSource } from "../skills/publish-artifact-to-sites/scripts/publication-git.mjs";
import { PUBLICATION_SOURCE_MANIFEST } from "../skills/publish-artifact-to-sites/scripts/publication-source.mjs";
import { getPublicationGitProcessDiagnostics, publicationGitClient, PublicationGitError } from "../skills/publish-artifact-to-sites/scripts/publication-git-process.mjs";

const identity = { name: "Data Fixture", email: "data-fixture@example.test" };
const remoteUrl = "https://selected-site.example.test/git/data.git";
const token = "fixture-private-source-token";
const credential = () => ({ remote_url: remoteUrl, branch: "main", auth_mode: "http_extra_header", token,
  token_expires_at: new Date(Date.now() + 600000).toISOString() });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
// Git for Windows cannot use Node's NUL device name as a config file.
const gitConfigRoot = await mkdtemp(join(tmpdir(), "data-git-test-config-"));
const emptyGitConfig = join(gitConfigRoot, "empty.gitconfig");
await writeFile(emptyGitConfig, "");
after(() => rm(gitConfigRoot, { recursive: true, force: true }));
const isolatedEnv = env => ({ ...env, GIT_CONFIG_GLOBAL: emptyGitConfig, GIT_CONFIG_NOSYSTEM: "1" });
const rawGit = (cwd, args, input) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", input,
    env: isolatedEnv({ ...process.env, GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email }) });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

async function put(root, name, bytes) {
  await mkdir(dirname(join(root, name)), { recursive: true });
  await writeFile(join(root, name), bytes);
}
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "data publication 界-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publication = join(root, "candidate ü 🚀"), remote = join(root, "remote.git");
  await mkdir(publication); await mkdir(remote);
  rawGit(remote, ["init", "--bare", "--quiet"]);
  const files = {};
  for (const [name, bytes, mode = 0o644] of [
    ["package.json", '{"name":"fixture"}\n'],
    [".gitignore", "dist/\nsrc/data.json\n"],
    [".gitattributes", "*.jsx text eol=crlf\n"],
    [".openai/hosting.json", '{"project_id":"selected-site"}\n'],
    ["src/界 rocket 🚀.jsx", "export default 'reviewed';\n"],
    ["scripts/tool.mjs", "#!/usr/bin/env node\n", 0o755],
    ["dist/index.html", "<!doctype html><title>reviewed</title>"],
  ]) {
    await put(publication, name, bytes); await chmod(join(publication, name), mode);
    files[name] = { sha256: hash(bytes), bytes: Buffer.byteLength(bytes), mode,
      role: name.startsWith("dist/") ? "deployment-output" : "source" };
  }
  await put(publication, PUBLICATION_SOURCE_MANIFEST, JSON.stringify({
    version: 1, kind: "data-app-publication-source-v1", sourceRevision: "a".repeat(40), files,
  }));
  const calls = [];
  let intercept;
  const runner = (executable, args, options) => {
    calls.push({ executable, args, options });
    const intercepted = intercept?.(executable, args, options);
    if (intercepted) return intercepted;
    const env = isolatedEnv(options.env);
    // Only the injected test transport maps the trusted HTTPS URL to a local
    // bare repository. Production has no local or arbitrary-protocol override.
    const count = Number(env.GIT_CONFIG_COUNT ?? "0");
    env.GIT_CONFIG_COUNT = String(count + 1);
    env[`GIT_CONFIG_KEY_${count}`] = "protocol.file.allow";
    env[`GIT_CONFIG_VALUE_${count}`] = "always";
    return spawnSync(executable, args.map(value => value === remoteUrl ? remote : value), { ...options, env });
  };
  return { root, publication, remote, files, calls, runner, setIntercept: value => { intercept = value; },
    publish: options => publishPublicationSource({ publicationProjectDir: publication, credential: credential(), identity, runner, ...options }) };
}

test("first publication pushes exact source bytes/modes without data or deployment output", async t => {
  const f = await fixture(t);
  const receipt = await f.publish();
  assert.equal(receipt.state, "pushed"); assert.equal(receipt.parentSha, null);
  assert.match(receipt.commitSha, /^[a-f\d]{40}$/u);
  assert.equal(rawGit(f.remote, ["rev-parse", "refs/heads/main"]), receipt.commitSha);
  const paths = rawGit(f.remote, ["-c", "core.quotePath=false", "ls-tree", "-r", "--name-only", "main"]).split("\n");
  assert.ok(paths.includes("src/界 rocket 🚀.jsx"));
  assert.ok(!paths.some(path => path.startsWith("dist/") || path === "src/data.json"));
  assert.equal(rawGit(f.remote, ["show", "main:src/界 rocket 🚀.jsx"]), "export default 'reviewed';");
  assert.match(rawGit(f.remote, ["ls-tree", "main", "scripts/tool.mjs"]), /^100755 /u);
  assert.equal(rawGit(f.publication, ["remote"]), "");
  assert.ok(!(await readFile(join(f.publication, ".git/config"), "utf8")).includes(token));
});

test("existing selected remote branch remains the exact parent of the candidate", async t => {
  const f = await fixture(t);
  const ancestor = rawGit(f.remote, ["mktree"], "");
  const prior = rawGit(f.remote, ["commit-tree", ancestor], "Already published\n");
  rawGit(f.remote, ["update-ref", "refs/heads/main", prior]);
  const receipt = await f.publish();
  assert.equal(receipt.parentSha, prior);
  assert.equal(rawGit(f.remote, ["rev-parse", "main^"]), prior);
  assert.ok(f.calls.some(call => call.args[0] === "fetch" && call.args.at(-1) === "refs/heads/main"));
  assert.ok(f.calls.every(call => !call.args.some(arg => arg === "--force" || arg.startsWith("+"))));
});

test("failed and uncertain pushes reuse one exact commit with fresh credentials", async t => {
  const f = await fixture(t);
  f.setIntercept((_executable, args) => args[0] === "push" ? { status: 128, stderr: `Authentication failed: ${token}` } : undefined);
  let failed;
  await assert.rejects(f.publish(), error => {
    failed = error.receipt;
    assert.equal(error.code, "AUTHENTICATION_FAILED");
    assert.ok(!JSON.stringify(error).includes(token));
    assert.ok(!error.stack.includes(token));
    return true;
  });
  assert.equal(failed.state, "committed");
  const commits = f.calls.filter(call => call.args[0] === "commit-tree").length;
  f.setIntercept(undefined);
  const retry = await f.publish({ receipt: failed, credential: { ...credential(), token: "renewed-fixture-token" } });
  assert.equal(retry.commitSha, failed.commitSha);
  assert.equal(f.calls.filter(call => call.args[0] === "commit-tree").length, commits);
  // Also handles a push that succeeded remotely but whose response was lost.
  assert.equal((await f.publish({ receipt: failed })).commitSha, failed.commitSha);
});

test("remote errors are never interpreted as an empty repository and fetch failures can resume", async t => {
  const f = await fixture(t);
  f.setIntercept((_executable, args) => args[0] === "ls-remote" ? { status: 128, stderr: "Could not resolve host" } : undefined);
  let receipt;
  await assert.rejects(f.publish(), error => { receipt = error.receipt; return error.code === "NETWORK_FAILED"; });
  assert.equal(receipt.state, "initialized");
  assert.ok(!f.calls.some(call => call.args[0] === "commit-tree" || call.args[0] === "push"));
  f.setIntercept(undefined);
  assert.equal((await f.publish({ receipt })).state, "pushed");
});

test("HTTP auth stays only in network environment, with redirect/tracing disabled", async t => {
  const f = await fixture(t);
  const oldTrace = process.env.GIT_TRACE_CURL, oldKeylog = process.env.SSLKEYLOGFILE;
  process.env.GIT_TRACE_CURL = "/tmp/must-not-write-curl-trace";
  process.env.SSLKEYLOGFILE = "/tmp/must-not-write-key-log";
  try { await f.publish(); }
  finally {
    if (oldTrace === undefined) delete process.env.GIT_TRACE_CURL; else process.env.GIT_TRACE_CURL = oldTrace;
    if (oldKeylog === undefined) delete process.env.SSLKEYLOGFILE; else process.env.SSLKEYLOGFILE = oldKeylog;
  }
  for (const { args, options } of f.calls) {
    assert.equal(options.shell, false);
    assert.ok(!JSON.stringify(args).includes(token));
    assert.ok(!String(options.input).includes(token));
    assert.equal(options.env.GIT_TRACE_CURL, undefined); assert.equal(options.env.SSLKEYLOGFILE, undefined);
    const configs = Object.fromEntries(Array.from({ length: Number(options.env.GIT_CONFIG_COUNT) }, (_, i) =>
      [options.env[`GIT_CONFIG_KEY_${i}`], options.env[`GIT_CONFIG_VALUE_${i}`]]));
    if (["ls-remote", "fetch", "push"].includes(args[0])) {
      assert.equal(configs[`http.${remoteUrl}.extraHeader`], `Authorization: Bearer ${token}`);
      assert.equal(configs["http.followRedirects"], "false"); assert.equal(configs["http.sslVerify"], "true");
      assert.equal(configs[`http.${remoteUrl}.followRedirects`], "false"); assert.equal(configs[`http.${remoteUrl}.sslVerify`], "true");
      assert.equal(configs["credential.helper"], ""); assert.equal(configs["protocol.allow"], "never");
    } else assert.ok(!JSON.stringify(options.env).includes(token));
  }
});

test("network config overrides inherited URL-specific TLS and redirect settings", async t => {
  const f = await fixture(t);
  const globalConfig = join(f.root, "gitconfig");
  await writeFile(globalConfig, `[http "${remoteUrl}"]\nsslVerify = false\nfollowRedirects = true\nextraHeader = X-Stale: stale\n`);
  f.setIntercept((_executable, args, options) => {
    if (args[0] !== "ls-remote") return undefined;
    const env = { ...options.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1" };
    for (const [key, value] of [["http.sslVerify", "true"], ["http.followRedirects", "false"]]) {
      const result = spawnSync("git", ["config", "--get-urlmatch", key, remoteUrl], { ...options, env });
      assert.equal(result.status, 0); assert.equal(result.stdout.trim(), value);
    }
    return { status: 2, stdout: "" };
  });
  await f.publish();
});

test("matching fetch and push URL rewrites cannot redirect the selected source destination", async t => {
  for (const setting of ["insteadof", "pushinsteadof"]) {
    const f = await fixture(t);
    f.setIntercept((_executable, args) => args[0] === "config" && args.includes("--get-regexp")
      ? { status: 0, stdout: `url.https://unexpected.example.test/.${setting}\nhttps://selected-site.example.test/\0` } : undefined);
    await assert.rejects(f.publish(), { code: "UNSAFE_GIT_CONFIGURATION" });
    assert.ok(!f.calls.some(call => ["ls-remote", "fetch", "push"].includes(call.args[0])));
  }
});

test("untrusted credential destinations, branches, auth modes and expired tokens fail before network", async t => {
  const f = await fixture(t);
  for (const changes of [
    { remote_url: "http://selected-site.example.test/git/data.git" },
    { remote_url: "https://user:password@selected-site.example.test/git/data.git" },
    { remote_url: "ssh://selected-site.example.test/git/data.git" },
    { remote_url: `${remoteUrl}?token=bad` }, { remote_url: "https://selected-site.example.test/../git/data.git" },
    { branch: "main:elsewhere" }, { branch: "main\n" }, { auth_mode: "unknown" },
    { token: "abc\r\nInjected: header" }, { token_expires_at: "yesterday" },
  ]) await assert.rejects(f.publish({ credential: { ...credential(), ...changes } }), { code: "INVALID_CREDENTIAL" });
  await assert.rejects(f.publish({ credential: { ...credential(), token_expires_at: "2000-01-01T00:00:00Z" } }), { code: "EXPIRED_CREDENTIAL" });
  assert.ok(!f.calls.some(call => ["ls-remote", "fetch", "push"].includes(call.args[0])));
});

test("specific failures expose stable sanitized repair codes", async t => {
  const f = await fixture(t);
  for (const [stderr, code] of [
    ["SSL certificate problem", "TLS_FAILED"], ["detected dubious ownership", "UNTRUSTED_REPOSITORY"],
    ["token has expired", "EXPIRED_CREDENTIAL"], ["[rejected] non-fast-forward", "PUSH_REJECTED"],
  ]) {
    f.setIntercept((_executable, args) => args[0] === "check-ref-format" ? { status: 128, stderr: `${stderr} ${token}` } : undefined);
    await assert.rejects(f.publish(), error => error.code === code && !error.message.includes(token));
  }
});

test("Schannel diagnostics identify the failing operation without assuming a certificate problem", () => {
  const cases = [
    ["schannel: disabled automatic use of client certificate\nfatal: Authentication failed", "AUTHENTICATION_FAILED", "authentication"],
    ["schannel: shutting down SSL/TLS connection\nfatal: The requested URL returned error: 401", "AUTHENTICATION_FAILED", "http_401"],
    ["HTTP/2 403\nschannel: server closed abruptly (missing close_notify)", "AUTHENTICATION_FAILED", "http_403"],
    ["CONNECT tunnel failed, response 403\nschannel: TLS cleanup", "NETWORK_FAILED", "proxy_denied"],
    ["schannel: CertGetCertificateChain trust error CERT_TRUST_IS_UNTRUSTED_ROOT", "TLS_FAILED", "certificate_verification"],
    ["schannel: SEC_E_CERT_EXPIRED", "TLS_FAILED", "certificate_verification"],
    ["schannel: CRYPT_E_REVOCATION_OFFLINE", "TLS_FAILED", "certificate_revocation"],
    ["schannel: failed to receive handshake, SSL/TLS connection failed", "TLS_FAILED", "tls_handshake"],
    ["schannel: InitializeSecurityContext failed: SEC_E_ILLEGAL_MESSAGE", "TLS_FAILED", "tls_handshake"],
    ["schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS", "TLS_FAILED", "tls_credentials"],
    ["schannel: server closed abruptly (missing close_notify)", "TLS_FAILED", "tls_shutdown"],
    ["Recv failure: Connection was reset\nschannel: shutdown", "NETWORK_FAILED", "connection_reset"],
    ["schannel: disabled automatic use of client certificate\nfatal: request failed", "NETWORK_FAILED", "unknown"],
    ["schannel: shutting down SSL/TLS connection", "NETWORK_FAILED", "unknown"],
  ];
  for (const [stderr, code, subtype] of cases) {
    const git = publicationGitClient({ projectDir: ".", runner: () => ({ status: 128,
      stdout: `${token} ${remoteUrl}`, stderr: `${stderr}\nAuthorization: Bearer ${token}` }) });
    assert.throws(() => git(["push", remoteUrl], { stage: "push", fallback: "NETWORK_FAILED" }), error => {
      assert.equal(error.code, code, stderr); assert.equal(error.subtype, subtype, stderr);
      assert.equal(error.stage, "push"); assert.equal(error.operation, "push");
      assert.ok(Number.isSafeInteger(error.operationMilliseconds) && error.operationMilliseconds >= 0);
      assert.equal(error.message.includes("local certificate configuration"), subtype === "certificate_verification");
      assert.ok(!JSON.stringify(error).includes(token)); assert.ok(!error.stack.includes(token));
      assert.ok(!JSON.stringify(error).includes(remoteUrl));
      return true;
    });
  }
});

test("timed-out subprocesses report their own duration and override buffered Schannel diagnostics", () => {
  let actual;
  const git = publicationGitClient({ projectDir: gitConfigRoot, timeoutMs: 30, runner: (_executable, _args, options) => {
    actual = spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], options);
    return { ...actual, stderr: "schannel: disabled automatic use of client certificate" };
  } });
  assert.throws(() => git(["ls-remote", remoteUrl], { stage: "fetch", fallback: "NETWORK_FAILED" }), error => {
    assert.equal(actual.error?.code, "ETIMEDOUT");
    assert.equal(error.code, "GIT_TIMEOUT"); assert.equal(error.subtype, "timeout");
    assert.equal(error.operation, "ls-remote"); assert.equal(error.stage, "fetch");
    assert.ok(error.operationMilliseconds >= 20); assert.ok(error.operationMilliseconds < 5000);
    return true;
  });
});

function diagnosticFailure(stderr, { config = [[`http.${remoteUrl}.extraHeader`, `Authorization: Bearer ${token}`]], ...result } = {}) {
  const git = publicationGitClient({ projectDir: gitConfigRoot, runner: () => ({ status: 128, signal: null, stderr, ...result }) });
  try { git(["ls-remote", remoteUrl], { stage: "fetch", fallback: "NETWORK_FAILED", config }); }
  catch (error) { return error; }
  assert.fail("The fixture must fail.");
}

test("safe stderr retains the underlying Git failure and process outcome separately from classification", () => {
  const error = diagnosticFailure(`fatal: unable to access '${remoteUrl}?credential=another-secret':\n`
    + "schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030e)\n"
    + "remote: request 12345 failed", { stdout: "stdout-must-never-be-retained" });
  const details = getPublicationGitProcessDiagnostics(error);
  assert.equal(error.code, "TLS_FAILED"); assert.equal(error.operation, "ls-remote"); assert.equal(error.stage, "fetch");
  assert.equal(details.exitStatus, 128); assert.equal(details.signal, null);
  assert.ok(details.stderrExcerpt.includes("SEC_E_NO_CREDENTIALS (0x8009030e)"));
  assert.ok(details.stderrExcerpt.includes("remote: request 12345 failed"));
  assert.ok(!JSON.stringify(error).includes(remoteUrl)); assert.ok(!JSON.stringify(error).includes("another-secret"));
  assert.ok(!JSON.stringify(error).includes("stdout-must-never-be-retained"));
  error.stderrExcerpt = token; error.exitStatus = token; error.signal = token;
  details.stderrExcerpt = token;
  assert.ok(!JSON.stringify(getPublicationGitProcessDiagnostics(error)).includes(token));
  assert.equal(getPublicationGitProcessDiagnostics(new PublicationGitError("GIT_FAILED")), undefined);
  assert.equal(getPublicationGitProcessDiagnostics({ stderrExcerpt: token }), undefined);
});

test("credential literals, wrapped fragments, encodings and credential URLs never enter diagnostic receipts", () => {
  const secret = "fixture-private-unique-credential-0123456789ABCxyz";
  const config = [[`http.${remoteUrl}.extraHeader`, `Authorization: Bearer ${secret}`]];
  const encoded = Buffer.from(secret).toString("base64");
  const fragments = [
    secret, encoded, Buffer.from(encoded).toString("base64"),
    secret.slice(0, 17) + "\n  " + secret.slice(17),
    secret.slice(0, 17) + "\nremote: " + secret.slice(17),
    secret.slice(0, 17) + "\n12:00:00 => Send header: " + secret.slice(17),
    secret.slice(0, 17) + "\u001b[0m" + secret.slice(17),
    secret.slice(0, 17) + "\u200b\u0301" + secret.slice(17),
    secret.slice(0, 22), secret.slice(-22),
    [...secret].map(character => `%${character.charCodeAt(0).toString(16)}`).join(""),
    [...secret].map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""),
    [...secret].map(character => `&#${character.charCodeAt(0)};`).join(""),
  ];
  for (const fragment of fragments) {
    const details = getPublicationGitProcessDiagnostics(diagnosticFailure(`schannel: server closed abruptly (missing close_notify)\nremote: ${fragment}`, { config }));
    const serialized = JSON.stringify(details);
    assert.ok(!serialized.includes(secret)); assert.ok(!serialized.includes(fragment));
    assert.ok(details.stderrExcerpt.length <= 2048);
  }
  const headers = diagnosticFailure("schannel: failed to receive handshake\n"
    + "Authorization:\r\n\tBearer short-secret\nProxy-Authorization: Basic dXNlcjpwYXNz\n"
    + "remote: https://user:other-password@host.invalid/?api_key=other-key\n"
    + "fatal: unable to access 'https://host.invalid/path?token=third-secret'", { config });
  const safe = JSON.stringify(getPublicationGitProcessDiagnostics(headers));
  for (const value of ["short-secret", "dXNlcjpwYXNz", "other-password", "other-key", "third-secret", "host.invalid"]) assert.ok(!safe.includes(value));
});

test("credential normalization matches diagnostic normalization, including short Unicode credentials", () => {
  for (const secret of ["sho\u0301rt", "sho\u200brt", "sho\u001b[0mrt"]) {
    const error = diagnosticFailure(`remote: ${secret}\nfatal: request failed`, {
      config: [[`http.${remoteUrl}.extraHeader`, `Authorization: Bearer ${secret}`]],
    });
    const safe = JSON.stringify(getPublicationGitProcessDiagnostics(error));
    assert.ok(!safe.includes("short")); assert.ok(!safe.includes(secret));
  }
});

test("Windows certificate paths are redacted while their surrounding failure remains readable", () => {
  for (const [stderr, cause, path] of [
    ["fatal: error setting certificate file: C:\\runtime\\cert.pem", "error setting certificate file", "C:\\runtime\\cert.pem"],
    ["schannel: failed to open CA file 'C:\\temp\\ca.pem'", "failed to open CA file", "C:\\temp\\ca.pem"],
    ['schannel: failed to open CA file "C:\\Program Files\\Git\\cert.pem"', "failed to open CA file", "C:\\Program Files"],
    ["fatal: error setting certificate file: \\\\server\\share\\ca.pem", "error setting certificate file", "server"],
  ]) {
    const { stderrExcerpt } = getPublicationGitProcessDiagnostics(diagnosticFailure(stderr));
    assert.ok(stderrExcerpt.includes(cause)); assert.ok(stderrExcerpt.includes("[redacted-path]"));
    assert.ok(!stderrExcerpt.includes(path));
  }
});

test("diagnostic bounds fail closed before input truncation and validate process status and signal", () => {
  const oversized = "fatal: " + "x".repeat(65520) + token;
  const omitted = getPublicationGitProcessDiagnostics(diagnosticFailure(oversized));
  assert.ok(omitted.stderrExcerpt.includes("omitted")); assert.ok(!omitted.stderrExcerpt.includes("xxx"));
  const longSafe = getPublicationGitProcessDiagnostics(diagnosticFailure("warning: connection attempt failed\n".repeat(150) + `fatal: ${token}`));
  assert.ok(longSafe.stderrExcerpt.length <= 2048); assert.ok(!longSafe.stderrExcerpt.includes(token));
  for (const malformed of [{ secret: token }, [token], "remote: \\u0073\\u0065\\u0063\\u0072\\u0065\\u0074"]) {
    const detail = getPublicationGitProcessDiagnostics(diagnosticFailure(malformed, { status: "128", signal: token }));
    assert.ok(detail.stderrExcerpt.includes("omitted")); assert.equal(detail.exitStatus, null); assert.equal(detail.signal, null);
    assert.ok(!JSON.stringify(detail).includes(token));
  }
  const killed = getPublicationGitProcessDiagnostics(diagnosticFailure("fatal: process interrupted", { status: null, signal: "SIGTERM" }));
  assert.equal(killed.exitStatus, null); assert.equal(killed.signal, "SIGTERM");
});

test("changed candidate and mismatched receipt are rejected before another push", async t => {
  const f = await fixture(t);
  const receipt = await f.publish();
  const pushes = () => f.calls.filter(call => call.args[0] === "push").length;
  const count = pushes();
  await assert.rejects(f.publish({ receipt: { ...receipt, remoteUrl: "https://other.example.test/data.git" } }), { code: "INVALID_RECEIPT" });
  await put(f.publication, "src/界 rocket 🚀.jsx", "Changed after review");
  await assert.rejects(f.publish({ receipt }), { code: "SOURCE_CHANGED" });
  assert.equal(pushes(), count);
});

test("preflight verifies exact root and full HEAD, configured identity, and executable paths with spaces", async t => {
  const f = await fixture(t);
  rawGit(f.publication, ["init", "--quiet"]);
  rawGit(f.publication, ["config", "user.name", identity.name]);
  rawGit(f.publication, ["config", "user.email", identity.email]);
  rawGit(f.publication, ["add", "."]); rawGit(f.publication, ["commit", "--quiet", "-m", "authoring"]);
  const spacedPath = "C:\\Program Files\\Git\\cmd\\git.exe";
  const runner = (executable, args, options) => {
    assert.equal(executable, spacedPath); assert.equal(options.shell, false);
    return f.runner("git", args, options);
  };
  const result = await preflightPublicationGit({ projectDir: f.publication, gitExecutable: spacedPath, runner });
  assert.equal(result.sourceRevision, rawGit(f.publication, ["rev-parse", "HEAD"]));
  assert.deepEqual(result.identity, identity);
  await assert.rejects(preflightPublicationGit({ projectDir: join(f.publication, "src"), runner: f.runner }), { code: "INVALID_PROJECT_ROOT" });
  rawGit(f.publication, ["config", "--unset", "user.email"]);
  await assert.rejects(preflightPublicationGit({ projectDir: f.publication, runner: f.runner }), { code: "MISSING_GIT_IDENTITY" });
  await assert.rejects(preflightPublicationGit({ projectDir: f.publication, runner: () => ({ error: { code: "ENOENT" } }) }), { code: "MISSING_GIT" });
});

test("explicit initialization preserves parent history and never commits existing Git state", async t => {
  const f = await fixture(t);
  rawGit(f.root, ["init", "--quiet"]);
  rawGit(f.root, ["config", "user.name", identity.name]); rawGit(f.root, ["config", "user.email", identity.email]);
  await put(f.root, "parent.txt", "unrelated parent file");
  rawGit(f.root, ["add", "parent.txt"]); rawGit(f.root, ["commit", "--quiet", "-m", "parent"]);
  const parentHead = rawGit(f.root, ["rev-parse", "HEAD"]);
  const pending = await preflightPublicationGit({ projectDir: f.publication, runner: f.runner, allowNewProject: true });
  assert.equal(pending.needsInitialization, true); assert.equal(pending.sourceRevision, null);
  assert.deepEqual(pending.identity, identity);
  assert.ok(!f.calls.some(call => ["init", "add", "commit"].includes(call.args[0])));
  const result = await initializePublicationGit({ projectDir: f.publication, runner: f.runner });
  assert.equal(result.projectDir, f.publication); assert.match(result.sourceRevision, /^[a-f\d]{40}$/u);
  assert.equal(rawGit(f.root, ["rev-parse", "HEAD"]), parentHead);
  assert.equal(rawGit(f.publication, ["remote"]), "");
  await put(f.publication, "unrelated.txt", "must remain uncommitted");
  await assert.rejects(initializePublicationGit({ projectDir: f.publication, runner: f.runner }), { code: "EXISTING_GIT_REPOSITORY" });
  assert.equal(rawGit(f.publication, ["rev-parse", "HEAD"]), result.sourceRevision);
  assert.ok(!f.calls.some(call => ["ls-remote", "fetch", "push"].includes(call.args[0])));
});

test("preflight diagnoses an unborn repository without initializing or committing it", async t => {
  const f = await fixture(t);
  rawGit(f.publication, ["init", "--quiet"]);
  await assert.rejects(preflightPublicationGit({ projectDir: f.publication, runner: f.runner, allowNewProject: true }), { code: "MISSING_AUTHORING_HEAD" });
  await assert.rejects(initializePublicationGit({ projectDir: f.publication, runner: f.runner }), { code: "EXISTING_GIT_REPOSITORY" });
  assert.ok(!f.calls.some(call => ["init", "add", "commit", "push"].includes(call.args[0])));
});
