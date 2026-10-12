import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { setTimeout } from "node:timers/promises";

import { createPublicationArchive } from "../skills/publish-artifact-to-sites/scripts/publication-archive.mjs";

const projectId = "appgprj_archive_fixture";
const hosting = { project_id: projectId, d1: "DB", r2: "BUCKET", capabilities: ["fixture"] };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function put(root, path, bytes) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), bytes);
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "data-publication-archive-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectDir = join(root, "Café publication 📊");
  for (const [name, bytes] of Object.entries({
    ".openai/hosting.json": JSON.stringify(hosting),
    "dist/server/index.js": "export default {fetch() {return new Response('reviewed')}};\n",
    "dist/index.html": "<!doctype html><title>Reviewed</title>",
    "dist/.openai/hosting.json": '{"project_id":"stale-metadata"}',
    "dist/.openai/retained.json": '{"preserve":true}',
    "dist/.openai/drizzle/built.sql": "select 1;\n",
    "drizzle/0001_init.sql": "create table fixture (id text);\n",
    "src/data.json": "never archive source data",
    ".data-app-assets/html.html": "never archive R2 staging",
    ".data-app-offline/index.html": "never archive offline output",
    ".git/config": "never archive Git",
  })) await put(projectDir, name, bytes);
  return { root, projectDir, archivePath: join(root, "result with spaces 📊.tar.gz"),
    create: options => createPublicationArchive({ projectDir, projectId, archivePath: join(root, "result with spaces 📊.tar.gz"), ...options }) };
}
async function files(root, prefix = "") {
  const result = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await files(root, name));
    else result[name] = await readFile(join(root, name));
  }
  return result;
}
async function mutateDuringCompression(f, mutate) {
  await put(f.projectDir, "dist/large.bin", randomBytes(4 * 1024 * 1024));
  let changed = false, finished = false;
  const mutation = (async () => {
    while (!finished) {
      if ((await readdir(f.root)).some(name => name.startsWith(".data-publication-archive-"))) {
        await mutate();
        changed = true;
        return;
      }
      await setTimeout(1);
    }
  })();
  try { await assert.rejects(f.create(), /changed/); }
  finally { finished = true; await mutation; }
  assert(changed, "mutated an input after archive staging began");
  await assert.rejects(lstat(f.archivePath), { code: "ENOENT" });
  assert(!(await readdir(f.root)).some(name => name.startsWith(".data-publication-archive-")));
}

test("archive interoperates with system tar, preserves Unicode paths and overlays only deployment metadata", async t => {
  const f = await fixture(t);
  const longName = `dist/assets/${"long directory ".repeat(9)}/结果 📊.txt`;
  await put(f.projectDir, longName, "Unicode content 界 😀\n");
  await put(f.projectDir, "dist/assets/empty.txt", "");
  const before = await files(f.projectDir);
  const result = await f.create();
  const archive = await readFile(result.archivePath);
  assert.equal(result.bytes, archive.length);
  assert.equal(result.sha256, hash(archive));
  assert.deepEqual(await files(f.projectDir), before, "packaging must not modify the authored project");
  const unpacked = join(f.root, "unpacked");
  await mkdir(unpacked);
  // Use the platform tar reader as an independent compatibility oracle. Feed
  // bytes through stdin because Windows tar cannot open some Unicode archive
  // paths; reading the generated path above still verifies that output path.
  execFileSync("tar", ["-xzf", "-"], { cwd: unpacked, input: archive });
  const extracted = await files(unpacked);
  assert.deepEqual(Object.keys(extracted).sort(), result.files);
  assert.deepEqual(JSON.parse(extracted["dist/.openai/hosting.json"]), hosting);
  assert.equal(extracted[longName].toString(), "Unicode content 界 😀\n");
  assert.equal(extracted["dist/assets/empty.txt"].length, 0);
  assert.equal(extracted["dist/.openai/drizzle/0001_init.sql"].toString(), "create table fixture (id text);\n");
  assert.equal(extracted["dist/.openai/drizzle/built.sql"].toString(), "select 1;\n");
  assert.equal(extracted["dist/.openai/retained.json"].toString(), '{"preserve":true}');
  assert(result.files.every(name => name.startsWith("dist/") && !name.includes("\\")));
  for (const name of result.files) {
    assert.equal((await lstat(join(unpacked, name))).mtimeMs, 0);
    if (process.platform !== "win32") assert.equal((await lstat(join(unpacked, name))).mode & 0o777, 0o644);
  }
  await chmod(join(f.projectDir, "dist/server/index.js"), 0o755);
  await utimes(join(f.projectDir, "dist/server/index.js"), new Date(), new Date());
  const again = await f.create({ archivePath: join(f.root, "second.tar.gz") });
  assert.equal(again.sha256, result.sha256, "archive metadata must be deterministic and independent of source timestamps/modes");
});

test("packaging accepts no migration directory and no pre-existing dist sidecars", async t => {
  const f = await fixture(t);
  await rm(join(f.projectDir, "drizzle"), { recursive: true });
  await rm(join(f.projectDir, "dist/.openai"), { recursive: true });
  const result = await f.create();
  assert.deepEqual(result.files, ["dist/.openai/hosting.json", "dist/index.html", "dist/server/index.js"]);
});

test("invalid Site identity, logical bindings, and missing Worker fail before an archive is published", async t => {
  for (const change of [{ project_id: "another-site" }, { d1: "physical-database-id" }, { r2: undefined }, { static: { directory: "dist" } }]) {
    const f = await fixture(t);
    await put(f.projectDir, ".openai/hosting.json", JSON.stringify({ ...hosting, ...change }));
    await assert.rejects(f.create(), /selected Site.*DB\/BUCKET/);
    await assert.rejects(lstat(f.archivePath), { code: "ENOENT" });
  }
  const f = await fixture(t);
  await rm(join(f.projectDir, "dist/server/index.js"));
  await assert.rejects(f.create(), /Missing Data Worker/);
});

test("archive output never clobbers a file or appears inside its inputs", async t => {
  const f = await fixture(t);
  await writeFile(f.archivePath, "keep this existing file");
  await assert.rejects(f.create(), /already exists/);
  assert.equal(await readFile(f.archivePath, "utf8"), "keep this existing file");
  for (const name of ["dist/new/archive.tar.gz", ".openai/archive.tar.gz", "drizzle/archive.tar.gz"]) {
    await assert.rejects(f.create({ archivePath: join(f.projectDir, name) }), /outside its input/);
    await assert.rejects(lstat(join(f.projectDir, name)), { code: "ENOENT" });
  }
});

test("symlinks and dangerous archive member names are rejected", async t => {
  const f = await fixture(t);
  const unsafe = join(f.projectDir, "dist/assets/linked.txt");
  await mkdir(dirname(unsafe));
  try { await symlink(join(f.projectDir, "src/data.json"), unsafe); }
  catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") { t.diagnostic("Symlink check requires Windows Developer Mode; traversal cases still run."); }
    else throw error;
  }
  try {
    await lstat(unsafe);
    await assert.rejects(f.create(), /without symlinks/);
    await rm(unsafe);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const name of ["dist/.git/config", "dist/.data-app-assets/secret", "dist/.data-app-offline/index.html"] ) {
    await put(f.projectDir, name, "must not publish");
    await assert.rejects(f.create(), /unsafe path/);
    await rm(join(f.projectDir, name.split("/").slice(0, -1).join("/")), { recursive: true });
  }
  if (process.platform !== "win32") {
    await put(f.projectDir, "dist/assets/..\\outside.txt", "a backslash must not become a Windows traversal");
    await assert.rejects(f.create(), /unsafe path/);
  }
  await assert.rejects(lstat(f.archivePath), { code: "ENOENT" });
});

test("changes during compression abort publication and remove partial archives", async t => {
  const f = await fixture(t);
  await mutateDuringCompression(f, () => writeFile(join(f.projectDir, "dist/server/index.js"), "concurrently changed Worker"));
});

test("migrations created during packaging are not silently omitted", async t => {
  const f = await fixture(t);
  await rm(join(f.projectDir, "drizzle"), { recursive: true });
  await mutateDuringCompression(f, () => put(f.projectDir, "drizzle/new.sql", "alter table fixture add column value text;\n"));
});
