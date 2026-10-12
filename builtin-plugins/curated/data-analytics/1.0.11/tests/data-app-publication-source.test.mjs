import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createPublicationSource, hydratePublicationSource, PUBLICATION_SOURCE_MANIFEST } from "../skills/publish-artifact-to-sites/scripts/publication-source.mjs";
import { preflightPublicationGit } from "../skills/publish-artifact-to-sites/scripts/publication-git.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const descriptor = (path, bytes) => ({ path, sha256: sha256(bytes), bytes: Buffer.byteLength(bytes) });
const projectId = "appgprj_source_fixture";
const siteUrl = "https://source-fixture.openai.chatgpt.site";
const sourceRevision = "a".repeat(40);
async function put(root, name, bytes) {
  await mkdir(dirname(join(root, name)), { recursive: true });
  await writeFile(join(root, name), bytes);
}
async function paths(root, prefix = "") {
  const values = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) values.push(...await paths(root, name));
    else values.push(name);
  }
  return values.sort();
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "data-publication-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const authoring = join(root, "authoring"), publication = join(root, "publication");
  const snapshot = { id: "reviewed-app", title: "Café", queries: { q: { rows: [{ label: "界", value: 0 }, { label: "missing", value: null }] } } };
  const raw = JSON.stringify(snapshot, null, 2) + "\n";
  const originalHtml = "<!doctype html><html><head></head><body>Original split app</body></html>";
  const hostedHtml = "<!doctype html><html><head></head><body>Hosted split app</body></html>";
  const snapshotDescriptor = descriptor(`snapshot.${sha256(raw)}.json`, raw);
  const build = { version: 1, kind: "separate-data-v1", sourceSnapshotSha256: sha256(raw), runtimeSha256: "b".repeat(64),
    html: descriptor("index.html", originalHtml), snapshot: snapshotDescriptor };
  const packaged = { version: 1, projectId, artifactId: snapshot.id, seedSnapshotSha256: sha256(JSON.stringify(snapshot)),
    source: { layout: "separate-data-v1", snapshotSha256: sha256(raw), htmlSha256: sha256(originalHtml),
      buildManifestPath: ".data-app-offline/separate-v1/data-app-build.json" },
    snapshotResponse: { ...descriptor("unused", JSON.stringify(snapshot)), queryCount: 1, rowCount: 2 },
    assets: { html: { ...descriptor("html.html", hostedHtml), key: `data-app/html/${sha256(hostedHtml)}` },
      snapshot: { ...descriptor("snapshot.json", raw), key: `data-app/snapshot/${sha256(raw)}` } } };
  const hosting = { project_id: projectId, d1: "DB", r2: "BUCKET", capabilities: { fixtureCapability: true } };
  for (const [name, bytes] of Object.entries({
    "src/data.json": raw,
    "src/content/DashboardContent.jsx": 'export default function Dashboard() { return "reviewed"; }\n',
    "src/worker.js": "export default {};\n",
    "scripts/custom-build.mjs": "process.stdout.write('reviewed');\n",
    "package.json": '{"name":"data-app","type":"module"}\n',
    ".gitignore": "node_modules/\n!src/data.json\n",
    ".git/HEAD": "ref: refs/heads/main\n",
    ".git/refs/heads/main": sourceRevision + "\n",
    ".openai/hosting.json": JSON.stringify(hosting),
    "dist/.openai/hosting.json": JSON.stringify(hosting),
    "dist/index.html": hostedHtml,
    "dist/server/index.js": "export default {fetch(){return new Response('reviewed')}};\n",
    ".data-app-assets/manifest.json": JSON.stringify(packaged),
    ".data-app-assets/html.html": hostedHtml,
    ".data-app-assets/snapshot.json": raw,
    ".data-app-offline/separate-v1/data-app-build.json": JSON.stringify(build),
    ".data-app-offline/separate-v1/index.html": originalHtml,
    [`.data-app-offline/separate-v1/${snapshotDescriptor.path}`]: raw,
    "node_modules/fixture/index.js": "not source",
    ".cache/fixture": "not source",
  })) await put(authoring, name, bytes);
  await rm(join(authoring, ".git"), { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: authoring });
  await chmod(join(authoring, "scripts/custom-build.mjs"), 0o755);
  return { root, authoring, publication, raw, snapshot, packaged, build,
    create: options => createPublicationSource({ authoringProjectDir: authoring, publicationProjectDir: publication, projectId, sourceRevision, siteUrl, ...options }),
    hydrate: options => hydratePublicationSource({ publicationProjectDir: publication, ...options }) };
}

test("preflight and projection ignore the same inherited Git overrides and preserve configured CA trust", async t => {
  const f = await fixture(t);
  execFileSync("git", ["config", "user.name", "Publication Fixture"], { cwd: f.authoring });
  execFileSync("git", ["config", "user.email", "publication@example.test"], { cwd: f.authoring });
  execFileSync("git", ["add", "."], { cwd: f.authoring });
  execFileSync("git", ["commit", "--quiet", "-m", "Preserved fixture"], { cwd: f.authoring });
  const contamination = {
    GIT_DIR: join(f.root, "wrong-git-directory"), GIT_WORK_TREE: join(f.root, "wrong-work-tree"),
    GIT_INDEX_FILE: join(f.root, "wrong-index"), GIT_OBJECT_DIRECTORY: join(f.root, "wrong-objects"),
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.bare", GIT_CONFIG_VALUE_0: "true",
    GIT_TRACE: join(f.root, "must-not-write-trace"), GIT_SSL_CAINFO: join(f.root, "configured-ca.pem"),
  };
  const previous = Object.fromEntries(Object.keys(contamination).map(key => [key, process.env[key]]));
  const calls = [];
  const runner = (executable, args, options) => {
    calls.push(args);
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_TRACE", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"]) {
      assert.equal(options.env[key], undefined);
    }
    assert.equal(options.env.GIT_CONFIG_COUNT, "0");
    assert.equal(options.env.GIT_SSL_CAINFO, contamination.GIT_SSL_CAINFO);
    assert.equal(options.timeout, 120000); assert.equal(options.shell, false);
    return spawnSync(executable, args, options);
  };
  Object.assign(process.env, contamination);
  try {
    const preflight = await preflightPublicationGit({ projectDir: f.authoring, runner });
    const result = await f.create({ sourceRevision: preflight.sourceRevision, gitExecution: "sanitized", gitRunner: runner });
    assert.equal(result.manifest.sourceRevision, preflight.sourceRevision);
    assert.ok(calls.some(args => args.includes("check-ignore")));
    assert.ok(calls.some(args => args.includes("ls-files")));
    assert.ok(calls.some(args => args.some(arg => arg.startsWith("--git-dir="))));
    for (const [key, value] of Object.entries(contamination)) assert.equal(process.env[key], value);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  assert.equal((await paths(f.root)).includes("must-not-write-trace"), false);
});

test("projection preserves global and system config ignore rules and explicit system-config disabling", async t => {
  for (const selector of ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"]) await t.test(selector, async t => {
    const f = await fixture(t);
    const globalConfig = join(f.root, "global.gitconfig"), systemConfig = join(f.root, "system.gitconfig");
    const ignoreFile = join(f.root, "global-ignore");
    await writeFile(globalConfig, ""); await writeFile(systemConfig, "");
    await writeFile(ignoreFile, "private-notes.txt\n");
    execFileSync("git", ["config", "--file", selector === "GIT_CONFIG_GLOBAL" ? globalConfig : systemConfig, "core.excludesFile", ignoreFile]);
    // Explicit disabling must still suppress an otherwise unreadable system config.
    if (selector === "GIT_CONFIG_GLOBAL") await writeFile(systemConfig, "invalid git configuration\n");
    await put(f.authoring, "private-notes.txt", "Synthetic private notes excluded by the user's Git configuration.\n");
    const selected = { GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_SYSTEM: systemConfig,
      GIT_CONFIG_NOSYSTEM: selector === "GIT_CONFIG_GLOBAL" ? "1" : "0" };
    const previous = Object.fromEntries(Object.keys(selected).map(key => [key, process.env[key]]));
    Object.assign(process.env, selected);
    try {
      assert.equal(execFileSync("git", ["check-ignore", "private-notes.txt"], { cwd: f.authoring, encoding: "utf8" }).trim(), "private-notes.txt");
      const result = await f.create();
      assert.equal(Object.hasOwn(result.manifest.files, "private-notes.txt"), false);
      await assert.rejects(lstat(join(f.publication, "private-notes.txt")), { code: "ENOENT" });
      assert.equal(await readFile(join(f.authoring, "private-notes.txt"), "utf8"), "Synthetic private notes excluded by the user's Git configuration.\n");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});

test("default projection preserves per-command Git ignore configuration", async t => {
  for (const encoding of ["count", "parameters"]) await t.test(encoding, async t => {
    const f = await fixture(t);
    const ignoreFile = join(f.root, "command-ignore");
    await writeFile(ignoreFile, "private-notes.txt\n");
    await put(f.authoring, "private-notes.txt", "Synthetic private notes excluded by per-command Git configuration.\n");
    const names = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_CONFIG_PARAMETERS"];
    const previous = Object.fromEntries(names.map(key => [key, process.env[key]]));
    for (const key of names) delete process.env[key];
    if (encoding === "count") Object.assign(process.env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.excludesFile", GIT_CONFIG_VALUE_0: ignoreFile });
    else process.env.GIT_CONFIG_PARAMETERS = `'core.excludesFile=${ignoreFile.replaceAll("'", "'\\''")}'`;
    try {
      assert.equal(execFileSync("git", ["check-ignore", "private-notes.txt"], { cwd: f.authoring, encoding: "utf8" }).trim(), "private-notes.txt");
      const result = await f.create();
      assert.equal(Object.hasOwn(result.manifest.files, "private-notes.txt"), false);
      await assert.rejects(lstat(join(f.publication, "private-notes.txt")), { code: "ENOENT" });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});

test("projection Git timeout is bounded and identifies the failed ignore check without exposing credentials", async t => {
  const f = await fixture(t);
  let result;
  await assert.rejects(f.create({ gitExecution: "sanitized", gitTimeoutMs: 30, gitRunner: (_executable, args, options) => {
    assert.equal(args[0], "check-ignore"); assert.equal(options.timeout, 30);
    result = spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], options);
    return { ...result, stderr: "fatal: Authorization: Bearer fixture-secret" };
  } }), error => {
    assert.equal(result.error?.code, "ETIMEDOUT");
    assert.equal(error.code, "GIT_TIMEOUT"); assert.equal(error.subtype, "timeout");
    assert.equal(error.stage, "source"); assert.equal(error.operation, "check-ignore");
    assert.ok(error.operationMilliseconds >= 20 && error.operationMilliseconds < 5000);
    assert.ok(!JSON.stringify(error).includes("fixture-secret"));
    return true;
  });
  await assert.rejects(lstat(f.publication), { code: "ENOENT" });
});

test("projection preserves source, capability configuration and complete identities without copying data/history", async t => {
  const f = await fixture(t);
  const before = Object.fromEntries(await Promise.all((await paths(f.authoring)).map(async name => [name, {
    bytes: await readFile(join(f.authoring, name)), mode: (await lstat(join(f.authoring, name))).mode,
  }])));
  const result = await f.create();
  assert.equal(result.manifest.sourceSnapshotSha256, sha256(f.raw));
  assert.notEqual(result.manifest.seedSnapshotSha256, result.manifest.sourceSnapshotSha256);
  assert.equal(result.manifest.snapshotResponse.rowCount, 2);
  assert.equal(result.manifest.artifactId, f.snapshot.id);
  assert.equal(result.manifest.hydrationRequired, true);
  assert.ok(!JSON.stringify(result.manifest).includes(f.root));
  const included = await paths(f.publication);
  assert.ok(included.includes("dist/server/index.js"));
  assert.ok(included.includes(PUBLICATION_SOURCE_MANIFEST));
  assert.ok(!included.some(name => name === "src/data.json" || /^\.git\//u.test(name) || /^(?:node_modules|\.cache|\.data-app-)/u.test(name)));
  for (const name of ["src/content/DashboardContent.jsx", ".openai/hosting.json", "dist/.openai/hosting.json"]) {
    assert.deepEqual(await readFile(join(f.publication, name)), before[name].bytes);
  }
  assert.equal((await lstat(join(f.publication, "scripts/custom-build.mjs"))).mode & 0o777, 0o755);
  for (const [name, item] of Object.entries(before)) {
    assert.deepEqual(await readFile(join(f.authoring, name)), item.bytes);
    assert.equal((await lstat(join(f.authoring, name))).mode, item.mode);
  }
});

test("existing destinations and overlapping roots are rejected without changing either tree", async t => {
  const f = await fixture(t);
  await mkdir(f.publication); await put(f.publication, "keep", "existing");
  await assert.rejects(f.create(), /already exists/u);
  assert.equal(await readFile(join(f.publication, "keep"), "utf8"), "existing");
  for (const publicationProjectDir of [f.authoring, join(f.authoring, "nested"), f.root]) {
    await assert.rejects(createPublicationSource({ authoringProjectDir: f.authoring, publicationProjectDir, projectId, sourceRevision, siteUrl }), /overlap/u);
  }
});

test("a missing ignore file is generated with its actual filesystem identity", async t => {
  const f = await fixture(t); await rm(join(f.authoring, ".gitignore"));
  const previousMask = process.umask(0o077);
  try {
    const { manifest } = await f.create();
    const path = join(f.publication, ".gitignore");
    assert.equal(manifest.files[".gitignore"].mode, (await lstat(path)).mode & 0o777);
    assert.equal(manifest.files[".gitignore"].sha256, sha256(await readFile(path)));
    assert.equal(manifest.files[".gitignore"].generated, true);
  } finally { process.umask(previousMask); }
});

test("required source hidden by authored ignores fails before returning an incomplete projection", async t => {
  for (const tracked of [false, true]) await t.test(tracked ? "tracked authored source" : "required hosting metadata", async () => {
  const f = await fixture(t);
  await put(f.authoring, ".gitignore", `node_modules/\n${tracked ? "src/content/" : ".openai/"}\n`);
  if (tracked) execFileSync("git", ["add", "-f", "src/content/DashboardContent.jsx"], { cwd: f.authoring });
  await assert.rejects(f.create(), /ignore rule hides required publication source/u);
  await assert.rejects(lstat(f.publication), { code: "ENOENT" });
  assert.equal(await readFile(join(f.authoring, "src/content/DashboardContent.jsx"), "utf8"),
    'export default function Dashboard() { return "reviewed"; }\n');
  });
});

test("stale raw source, mismatched Site and leftover build data fail before creating a projection", async t => {
  for (const mutation of [
    f => put(f.authoring, "src/data.json", JSON.stringify(f.snapshot)),
    f => put(f.authoring, ".openai/hosting.json", JSON.stringify({ project_id: "appgprj_other", d1: "DB", r2: "BUCKET" })),
    f => put(f.authoring, `dist/snapshot.${sha256(f.raw)}.json`, f.raw),
    f => put(f.authoring, ".data-app-offline/separate-v1/index.html", "stale HTML"),
  ]) {
    const f = await fixture(t); await mutation(f);
    await assert.rejects(f.create());
    await assert.rejects(lstat(f.publication), { code: "ENOENT" });
  }
});

test("asset traversal and source symlinks cannot escape or mutate the authoring tree", async t => {
  const f = await fixture(t);
  f.packaged.assets.snapshot.path = "../outside.json";
  await put(f.authoring, ".data-app-assets/manifest.json", JSON.stringify(f.packaged));
  await assert.rejects(f.create(), /descriptor/u);
  f.packaged.assets.snapshot.path = "snapshot.json";
  await put(f.authoring, ".data-app-assets/manifest.json", JSON.stringify(f.packaged));
  await put(f.root, "outside", "untouched");
  await symlink(join(f.root, "outside"), join(f.authoring, "src/escape.js"));
  await assert.rejects(f.create(), /symlink/u);
  assert.equal(await readFile(join(f.root, "outside"), "utf8"), "untouched");
});

test("local hydration restores exact raw bytes and never replaces different existing data", async t => {
  const f = await fixture(t); await f.create();
  const local = join(f.authoring, ".data-app-assets/snapshot.json");
  const result = await f.hydrate({ snapshotFile: local });
  assert.equal(result.hydrated, true);
  assert.equal(await readFile(join(f.publication, "src/data.json"), "utf8"), f.raw);
  assert.equal((await f.hydrate({ snapshotFile: local })).alreadyHydrated, true);
  await put(f.publication, "src/data.json", "local reviewed edits");
  await assert.rejects(f.hydrate({ snapshotFile: local }), /verification/u);
  assert.equal(await readFile(join(f.publication, "src/data.json"), "utf8"), "local reviewed edits");
});

test("a checkout containing only Git-tracked files can hydrate without archived dist outputs", async t => {
  const f = await fixture(t);
  await put(f.authoring, ".gitignore", "node_modules/\ncoverage/\n!src/data.json\n");
  await put(f.authoring, "coverage/index.html", "ignored report");
  await put(f.authoring, "src/.gitignore", "!data.json\n!.data-app-hydrate-*.tmp\n");
  const projection = await f.create();
  assert.equal(Object.hasOwn(projection.manifest.files, "coverage/index.html"), false);
  await put(f.publication, "src/.data-app-hydrate-fixture.tmp", f.raw);
  execFileSync("git", ["init", "--quiet"], { cwd: f.publication });
  execFileSync("git", ["add", "."], { cwd: f.publication });
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: f.publication, encoding: "utf8" }).split("\0").filter(Boolean);
  assert.ok(!tracked.some(name => name.startsWith("dist/") || name === "src/data.json" || name.includes(".data-app-hydrate-")));
  const clone = join(f.root, "tracked-checkout");
  for (const name of tracked) {
    await mkdir(dirname(join(clone, name)), { recursive: true });
    await copyFile(join(f.publication, name), join(clone, name));
  }
  const result = await hydratePublicationSource({ publicationProjectDir: clone, snapshotFile: join(f.authoring, ".data-app-assets/snapshot.json") });
  assert.equal(result.hydrated, true);
  assert.equal(await readFile(join(clone, "src/data.json"), "utf8"), f.raw);
  execFileSync("git", ["init", "--quiet"], { cwd: clone });
  execFileSync("git", ["add", "."], { cwd: clone });
  assert.equal(execFileSync("git", ["ls-files", "src/data.json"], { cwd: clone, encoding: "utf8" }), "");
  await rm(join(clone, "src/data.json"));
  await rm(join(clone, "src/content/DashboardContent.jsx"));
  await assert.rejects(hydratePublicationSource({ publicationProjectDir: clone, snapshotFile: join(f.authoring, ".data-app-assets/snapshot.json") }), { code: "ENOENT" });
});

test("remote hydration uses only the trusted exact immutable Site URL and transient authorization", async t => {
  const f = await fixture(t); await f.create();
  const token = "INERT_PRIVATE_AUTHORIZATION";
  let calls = 0;
  const request = async (url, options) => {
    calls += 1;
    assert.equal(String(url), `${siteUrl}/api/deployment-assets/snapshot?sha256=${sha256(f.raw)}`);
    assert.equal(options.redirect, "error");
    assert.deepEqual(options.headers, { "OAI-Sites-Authorization": `Bearer ${token}` });
    return new Response(f.raw, { headers: { "content-length": String(Buffer.byteLength(f.raw)) } });
  };
  await assert.rejects(f.hydrate({ siteUrl: "https://other.example", projectId, sitesAuthorization: token, request }), /matching Site/u);
  assert.equal(calls, 0);
  await f.hydrate({ siteUrl, projectId, sitesAuthorization: token, request });
  assert.equal(calls, 1);
  assert.ok(!(await readFile(join(f.publication, PUBLICATION_SOURCE_MANIFEST), "utf8")).includes(token));
});

test("first-publication projections pin a Site ID with no origin and hydrate exact local bytes", async t => {
  for (const pendingOrigin of [null, undefined]) {
    const f = await fixture(t);
    const { manifest } = await f.create({ siteUrl: pendingOrigin });
    assert.equal(manifest.siteUrl, null);
    assert.equal(manifest.projectId, projectId);
    assert.equal(manifest.sourceSnapshotSha256, sha256(f.raw));
    const result = await f.hydrate({ snapshotFile: join(f.authoring, ".data-app-assets/snapshot.json") });
    assert.equal(result.hydrated, true);
    assert.equal(await readFile(join(f.publication, "src/data.json"), "utf8"), f.raw);
  }
});

test("an origin-less projection requires trusted caller Site identity before sending remote authorization", async t => {
  const f = await fixture(t); await f.create({ siteUrl: null });
  const token = "INERT_FIRST_PUBLICATION_AUTHORIZATION";
  let calls = 0;
  const request = async (url, options) => {
    calls += 1;
    assert.equal(String(url), `${siteUrl}/api/deployment-assets/snapshot?sha256=${sha256(f.raw)}`);
    assert.equal(options.redirect, "error");
    assert.deepEqual(options.headers, { "OAI-Sites-Authorization": `Bearer ${token}` });
    return new Response(f.raw);
  };
  for (const identity of [
    {}, { projectId }, { siteUrl }, { projectId, siteUrl: null },
    { projectId: "appgprj_other", siteUrl },
    { projectId, siteUrl: "http://source-fixture.openai.chatgpt.site" },
    { projectId, siteUrl: `${siteUrl}/unverified-path` },
    { projectId, siteUrl: `${siteUrl}?token=inert` },
  ]) await assert.rejects(f.hydrate({ ...identity, sitesAuthorization: token, request }));
  assert.equal(calls, 0);
  await f.hydrate({ projectId, siteUrl, sitesAuthorization: token, request });
  assert.equal(calls, 1);
  assert.equal(await readFile(join(f.publication, "src/data.json"), "utf8"), f.raw);
  const manifest = await readFile(join(f.publication, PUBLICATION_SOURCE_MANIFEST), "utf8");
  assert.equal(JSON.parse(manifest).siteUrl, null);
  assert.doesNotMatch(manifest, /INERT_FIRST_PUBLICATION_AUTHORIZATION/u);
});

test("failed, truncated, excessive and interrupted hydration streams never install partial data", async t => {
  for (const response of [
    raw => new Response(raw, { status: 403 }),
    raw => new Response(raw.slice(0, -1)),
    raw => new Response(raw + " "),
    raw => new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(raw.slice(0, 10))); controller.error(new Error("INERT_PRIVATE_RESPONSE")); } })),
  ]) {
    const f = await fixture(t); await f.create();
    await assert.rejects(f.hydrate({ siteUrl, projectId, sitesAuthorization: "INERT_TOKEN", request: async () => response(f.raw) }), error => {
      assert.doesNotMatch(String(error), /INERT_PRIVATE_RESPONSE|INERT_TOKEN/u); return true;
    });
    await assert.rejects(lstat(join(f.publication, "src/data.json")), { code: "ENOENT" });
    assert.ok(!(await readdir(join(f.publication, "src"))).some(name => name.startsWith(".data-app-hydrate-")));
  }
});

test("concurrent local edits win over a completing hydration", async t => {
  const f = await fixture(t); await f.create();
  const request = async () => {
    await put(f.publication, "src/data.json", "new local edits");
    return new Response(f.raw);
  };
  await assert.rejects(f.hydrate({ siteUrl, projectId, sitesAuthorization: "INERT_TOKEN", request }), /verification/u);
  assert.equal(await readFile(join(f.publication, "src/data.json"), "utf8"), "new local edits");
});

test("hydration rejects changed source files and symlinked destinations", async t => {
  const f = await fixture(t); await f.create();
  const snapshotFile = join(f.authoring, ".data-app-assets/snapshot.json");
  const source = join(f.publication, "src/content/DashboardContent.jsx");
  const before = await readFile(source);
  await writeFile(source, "changed source");
  await assert.rejects(f.hydrate({ snapshotFile }), /verification/u);
  await writeFile(source, before);
  await put(f.root, "outside-data", "outside");
  await symlink(join(f.root, "outside-data"), join(f.publication, "src/data.json"));
  await assert.rejects(f.hydrate({ snapshotFile }), /symlink/u);
  assert.equal(await readFile(join(f.root, "outside-data"), "utf8"), "outside");
});
