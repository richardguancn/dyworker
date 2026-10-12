import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { assembleDataAppHtml } from "../scripts/data-app-build.mjs";
import { packageDataAppForSites } from "../skills/publish-artifact-to-sites/scripts/package-data-app-for-sites.mjs";
import { preflightPublicationGit, publishPublicationSource } from "../skills/publish-artifact-to-sites/scripts/publication-git.mjs";
import { PUBLICATION_SOURCE_MANIFEST } from "../skills/publish-artifact-to-sites/scripts/publication-source.mjs";
import { createPublicationSession } from "../skills/publish-artifact-to-sites/scripts/publish-data-app.mjs";
import { fixture } from "./data-app-sites-package-fixtures.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;

async function files(root, prefix = "") {
  const result = {};
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) Object.assign(result, await files(root, name));
    else result[name] = await readFile(join(root, name));
  }
  return result;
}

test("session publishes one verified source/archive pair while preserving authoring Git and Unicode paths", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "data publication integration 界-")));
  const item = fixture();
  const fixturePlugin = resolve(dirname(item.helperPath), "../../..");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(item.project, { recursive: true, force: true });
    await rm(fixturePlugin, { recursive: true, force: true });
  });
  // Git for Windows cannot use Node's Windows null-device path as a config.
  const emptyGitConfig = join(root, "empty.gitconfig");
  await writeFile(emptyGitConfig, "");
  const isolatedEnv = env => ({ ...env, GIT_CONFIG_GLOBAL: emptyGitConfig, GIT_CONFIG_NOSYSTEM: "1" });
  const git = (cwd, args) => execFileSync("git", args, { cwd, env: isolatedEnv(process.env), encoding: "utf8" }).trim();
  const authoring = join(root, "reviewed café 🚀"), publication = join(root, "publication 日本語 🚀");
  const archivePath = join(root, "reviewed café 🚀.tar.gz"), remote = join(root, "local remote.git");
  await rename(item.project, authoring);
  await mkdir(remote);
  git(remote, ["init", "--bare", "--quiet"]);
  const projectId = "appgprj_session_integration", siteUrl = "https://reviewed.example.test";
  const remoteUrl = "https://selected-site.example.test/git/data.git";
  const runtimeSha256 = "a".repeat(64);
  const snapshot = { id: "reviewed-integration", title: "Café 日本語 🚀", surface: "dashboard", buildStatus: "complete",
    generatedAt: "2026-09-07T00:00:00Z", queries: { reviewed: { rows: [
      { amount: 42, note: "complete private reviewed row 🚀" }, { amount: null, note: "second reviewed row 界" },
    ] } } };
  const snapshotBytes = Buffer.from(json(snapshot)), snapshotSha256 = hash(snapshotBytes);
  const snapshotPath = `snapshot.${snapshotSha256}.json`;
  const { html } = assembleDataAppHtml({
    appCode: "globalThis.CodexDataAppRuntime={apiVersion:1,mount(){}};", protectedStyles: "", printStyles: "",
    authored: { themeCss: "", conventionalCss: "", importedCss: "",
      factorySource: "(function(runtime,snapshot){return {DashboardContent(){return snapshot.queries.reviewed.rows;}};})" },
    runtimeSha256, snapshotBytes, separateData: true,
  });
  for (const [name, bytes] of Object.entries({
    "src/data.json": snapshotBytes, "dist/index.html": html, [`dist/${snapshotPath}`]: snapshotBytes,
    "dist/data-app-build.json": json({ version: 1, kind: "separate-data-v1", runtimeSha256, sourceSnapshotSha256: snapshotSha256,
      html: { path: "index.html", sha256: hash(html), bytes: Buffer.byteLength(html) },
      snapshot: { path: snapshotPath, sha256: snapshotSha256, bytes: snapshotBytes.length } }),
    ".gitignore": "node_modules/\ndist/\nsrc/data.json\n.data-app-*/\n",
    "src/content/Review café 🚀.jsx": "export const title = 'Reviewed café 🚀';\n",
    "drizzle/0001 日本語 🚀.sql": "CREATE TABLE reviewed_fixture (id INTEGER PRIMARY KEY);\n",
  })) {
    await mkdir(dirname(join(authoring, name)), { recursive: true });
    await writeFile(join(authoring, name), bytes);
  }
  git(authoring, ["init", "--quiet"]);
  git(authoring, ["config", "user.name", "Data Integration Fixture"]);
  git(authoring, ["config", "user.email", "data-integration@example.test"]);
  git(authoring, ["add", "."]);
  git(authoring, ["commit", "--quiet", "-m", "Reviewed authoring fixture"]);
  const authoringRevision = git(authoring, ["rev-parse", "HEAD"]);
  const originalGit = await files(join(authoring, ".git"));
  const networkCalls = [];
  const runner = (executable, args, options) => {
    const env = isolatedEnv(options.env);
    if (["ls-remote", "fetch", "push"].includes(args[0])) networkCalls.push(args[0]);
    // Only this injected test transport substitutes a local bare repository for
    // the trusted HTTPS endpoint; production keeps the authenticated HTTPS URL.
    const count = Number(env.GIT_CONFIG_COUNT ?? 0);
    env.GIT_CONFIG_COUNT = String(count + 1);
    env[`GIT_CONFIG_KEY_${count}`] = "protocol.file.allow";
    env[`GIT_CONFIG_VALUE_${count}`] = "always";
    return spawnSync(executable, args.map(value => value === remoteUrl ? remote : value), { ...options, env });
  };
  const session = createPublicationSession({
    preflightPublicationGit: options => preflightPublicationGit({ ...options, runner }),
    packageDataAppForSites: options => packageDataAppForSites(options, fixturePlugin),
    publishPublicationSource: options => publishPublicationSource({ ...options, runner }),
  });
  t.after(() => session.dispatch({ op: "close" }));
  const prepared = await session.dispatch({ op: "prepare", projectDir: authoring, projectId, siteUrl,
    publicationProjectDir: publication, archivePath, presentationFile: join(authoring, "presentation.json") });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  assert.equal(prepared.stage, "prepared");
  assert.deepEqual(networkCalls, [], "All local preparation completes before requesting a short-lived source credential");
  const pushed = await session.dispatch({ op: "push", credential: { remote_url: remoteUrl, branch: "main",
    auth_mode: "http_extra_header", token: "synthetic-source-credential", token_expires_at: new Date(Date.now() + 600000).toISOString() } });
  assert.equal(pushed.ok, true, JSON.stringify(pushed));
  assert.equal(pushed.stage, "archived");
  assert.deepEqual(pushed.saveArguments, { project_id: projectId, commit_sha: pushed.source.commitSha, archive: archivePath });
  assert.equal(git(remote, ["rev-parse", "refs/heads/main"]), pushed.source.commitSha);
  const committedManifestBytes = execFileSync("git", ["show", `main:${PUBLICATION_SOURCE_MANIFEST}`], { cwd: remote, env: isolatedEnv(process.env) });
  const manifest = JSON.parse(committedManifestBytes);
  assert.equal(hash(committedManifestBytes), pushed.source.manifestSha256);
  assert.equal(manifest.sourceRevision, authoringRevision);
  assert.equal(manifest.sourceSnapshotSha256, snapshotSha256);
  assert.equal(manifest.snapshotResponse.rowCount, snapshot.queries.reviewed.rows.length);
  const committedPaths = git(remote, ["-c", "core.quotePath=false", "ls-tree", "-r", "--name-only", "main"]).split("\n");
  assert.ok(committedPaths.includes("src/content/Review café 🚀.jsx"));
  assert.ok(!committedPaths.some(name => name === "src/data.json" || name.startsWith("dist/") || name.startsWith(".data-app-")));

  // Read the Unicode output path with Node and pass bytes to the independent
  // tar reader, avoiding Windows tar's Unicode archive-path limitation.
  // Extraction still checks UTF-8 migration names and Sites staging overlays.
  const archive = await readFile(archivePath);
  const extracted = join(root, "independent extraction");
  await mkdir(extracted);
  execFileSync("tar", ["-xzf", "-"], { cwd: extracted, input: archive });
  const archiveFiles = await files(extracted);
  const expectedPaths = Object.keys(manifest.files).filter(name => name.startsWith("dist/") || name.startsWith("drizzle/"))
    .map(name => name.startsWith("drizzle/") ? `dist/.openai/${name}` : name).sort();
  const archiveMembers = execFileSync("tar", ["-tzf", "-"], { input: archive, encoding: "utf8" }).trim().split(/\r?\n/).filter(name => !name.endsWith("/")).sort();
  assert.deepEqual(archiveMembers, [...new Set(expectedPaths)], "Archive member spelling matches the committed manifest exactly");
  assert.deepEqual(Object.keys(archiveFiles).sort(), [...new Set(expectedPaths)]);
  for (const [name, bytes] of Object.entries(archiveFiles)) {
    const sourcePath = name === "dist/.openai/hosting.json" ? ".openai/hosting.json"
      : name.startsWith("dist/.openai/drizzle/") ? name.slice("dist/.openai/".length) : name;
    assert.equal(hash(bytes), manifest.files[sourcePath].sha256, name);
    assert.equal(bytes.length, manifest.files[sourcePath].bytes, name);
    assert.ok(!bytes.includes(Buffer.from(snapshot.queries.reviewed.rows[0].note)), "Complete data remains outside the deployment archive");
  }
  assert.equal(hash(archive), pushed.archive.sha256);
  assert.equal(archive.length, pushed.archive.bytes);
  assert.equal(pushed.archive.fileCount, Object.keys(archiveFiles).length);
  assert.deepEqual(await readFile(join(authoring, "src/data.json")), snapshotBytes);
  assert.deepEqual(await files(join(authoring, ".git")), originalGit, "Publication never changes authoring history, index, config, or refs");
  assert.equal((await session.dispatch({ op: "push" })).source.commitSha, pushed.source.commitSha);
  assert.equal(networkCalls.filter(name => name === "push").length, 1);
});
