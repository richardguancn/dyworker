import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { describe } from "node:test";

import {
  digest,
  legacyFixture,
  fixtureOwnerSource,
  fixtureWorkerSource,
  packageDataApp,
  updateFixtureProtectedManifest,
  verifyFixtureProtectedManifest,
} from "./data-app-sites-package-fixtures.mjs";

// Older protected manifests retain their raw hashes; authorization must already
// use the deployed environment before their reviewed source can be packaged.
describe("explicit legacy source compatibility", () => {
  const fixture = legacyFixture;

  test("old packaged owner runtimes require a scoped upgrade without changing reviewed files", async t => {
    for (const source of [
      'import { dataAppOwnerUserIdSha256 } from "./data-app-owner.js";\n' +
        'export default { fetch() { return new Response("ok"); } };',
      'import { dataAppOwnerEmailSha256 } from "./data-app-owner.js";\n' +
        fixtureWorkerSource.replace("});", "  ownerEmailSha256: dataAppOwnerEmailSha256,\n});"),
    ]) await t.test(source.includes("UserId") ? "monolithic ID owner" : "factory email owner", () => {
      const state = fixture();
      const ownerPath = join(state.project, "src/data-app-owner.js");
      const workerPath = join(state.project, "src/worker.js");
      writeFileSync(ownerPath, fixtureOwnerSource(digest("historical-owner@example.com")));
      writeFileSync(workerPath, source);
      updateFixtureProtectedManifest(state);
      const owner = readFileSync(ownerPath);
      const manifest = readFileSync(join(state.project, "protected-runtime.json"));

      assert.throws(() => packageDataApp(state), /requires a confirmed, scoped protected runtime upgrade.*prebuilt packaging/u);
      assert.deepEqual(readFileSync(ownerPath), owner);
      assert.equal(readFileSync(workerPath, "utf8"), source);
      assert.deepEqual(readFileSync(join(state.project, "protected-runtime.json")), manifest);
      assert.equal(existsSync(join(state.project, "dist/server/index.js")), false);
      verifyFixtureProtectedManifest(state);
    });
  });

  test("legacy hosting migration preserves inert owner source and repairs only hosting", () => {
    const state = fixture();
    const ownerPath = join(state.project, "src/data-app-owner.js");
    const hostingPath = join(state.project, ".openai/hosting.json");
    const manifestPath = join(state.project, "protected-runtime.json");
    const historicalHash = digest("historical-owner@example.com");
    writeFileSync(ownerPath, `// Historical source retained\n${fixtureOwnerSource(historicalHash)}`);
    updateFixtureProtectedManifest(state, ["src/data-app-owner.js"]);
    writeFileSync(hostingPath, JSON.stringify({
      d1: "DB", r2: null, project_id: "appgprj_reviewed", existingDeployment: "preserved",
    }));
    const originalManifest = JSON.parse(readFileSync(manifestPath));
    const owner = readFileSync(ownerPath);
    const hosting = readFileSync(hostingPath);

    assert.throws(() => packageDataApp(state), /out of sync.*--migrate-packaging-manifest/u);
    assert.deepEqual(readFileSync(ownerPath), owner);
    assert.deepEqual(readFileSync(hostingPath), hosting);
    assert.deepEqual(JSON.parse(readFileSync(manifestPath)), originalManifest);

    const output = JSON.parse(packageDataApp(state, { migratePackagingManifest: true }));
    assert.equal(output.ownerAuthorization, "environment");
    assert.equal(output.ownerEnvironmentVariable, "DATA_APP_OWNER_EMAIL_SHA256");
    assert.deepEqual(readFileSync(ownerPath), owner);
    assert.doesNotMatch(readFileSync(output.serverPath, "utf8"), new RegExp(historicalHash));
    assert.deepEqual(JSON.parse(readFileSync(hostingPath)), {
      d1: "DB", r2: "BUCKET", project_id: "appgprj_reviewed", existingDeployment: "preserved",
    });
    const migrated = JSON.parse(readFileSync(manifestPath));
    for (const [path, hash] of Object.entries(originalManifest.files)) {
      if (path !== ".openai/hosting.json") assert.equal(migrated.files[path], hash, `${path} must stay protected`);
    }
    verifyFixtureProtectedManifest(state);
    packageDataApp(state);
    verifyFixtureProtectedManifest(state);
    assert.deepEqual(readFileSync(ownerPath), owner);
  });

  test("hosting migration cannot authorize owner or unrelated runtime changes", async t => {
    for (const path of ["src/data-app-owner.js", "src/worker.js", "src/data-app-worker.js"]) {
      await t.test(path, () => {
        const state = fixture();
        const hostingPath = join(state.project, ".openai/hosting.json");
        const changedPath = join(state.project, path);
        const manifestPath = join(state.project, "protected-runtime.json");
        writeFileSync(hostingPath, JSON.stringify({ d1: "DB", r2: null, project_id: "appgprj_reviewed" }));
        writeFileSync(changedPath, `${readFileSync(changedPath, "utf8")}\n// unapproved change\n`);
        const hosting = readFileSync(hostingPath);
        const changed = readFileSync(changedPath);
        const manifest = readFileSync(manifestPath);
        assert.throws(() => packageDataApp(state, { migratePackagingManifest: true }), /runtime files were modified outside packaging ownership/u);
        assert.deepEqual(readFileSync(hostingPath), hosting);
        assert.deepEqual(readFileSync(changedPath), changed);
        assert.deepEqual(readFileSync(manifestPath), manifest);
        assert.equal(existsSync(join(state.project, ".test-source-verified")), false);
        assert.equal(existsSync(join(state.project, "dist/server/index.js")), false);
      });
    }
  });

  test("hosting migration requires a stale hash and exact existing project and DB", async t => {
    for (const [name, hosting, expected] of [
      ["no stale entries", null, /requires an existing legacy hosting hash mismatch/u],
      ["missing project", { d1: "DB", r2: null }, /requires the existing exact Sites project identity and DB binding/u],
      ["different project", { d1: "DB", project_id: "appgprj_other" }, /does not belong to the requested Sites project/u],
      ["different DB", { d1: "OTHER_DB", project_id: "appgprj_reviewed" }, /requires the existing exact Sites project identity and DB binding/u],
    ]) await t.test(name, () => {
      const state = fixture();
      const hostingPath = join(state.project, ".openai/hosting.json");
      const manifestPath = join(state.project, "protected-runtime.json");
      if (hosting) writeFileSync(hostingPath, JSON.stringify(hosting));
      const originalHosting = readFileSync(hostingPath);
      const originalManifest = readFileSync(manifestPath);
      assert.throws(() => packageDataApp(state, { migratePackagingManifest: true }), expected);
      assert.deepEqual(readFileSync(hostingPath), originalHosting);
      assert.deepEqual(readFileSync(manifestPath), originalManifest);
      assert.equal(existsSync(join(state.project, "dist/server/index.js")), false);
    });
  });

  test("failed hosting migration restores the original manifest and deployed artifacts", () => {
    const state = fixture();
    const paths = ["src/data-app-owner.js", ".openai/hosting.json", "protected-runtime.json", "dist/server/index.js"];
    writeFileSync(join(state.project, ".openai/hosting.json"), JSON.stringify({
      d1: "DB", r2: null, project_id: "appgprj_reviewed",
    }));
    mkdirSync(join(state.project, "dist/server"), { recursive: true });
    writeFileSync(join(state.project, "dist/server/index.js"), "// previously deployed reviewed Worker\n");
    const vitePath = join(state.project, "node_modules/vite/bin/vite.js");
    writeFileSync(vitePath, `${readFileSync(vitePath, "utf8")}\nprocess.exit(23);\n`);
    const before = paths.map(path => readFileSync(join(state.project, path)));
    assert.throws(() => packageDataApp(state, { migratePackagingManifest: true }), /Sites Worker packaging failed with status 23/u);
    paths.forEach((path, index) => assert.deepEqual(readFileSync(join(state.project, path)), before[index], path));
    assert.equal(existsSync(join(state.project, "dist/.openai/hosting.json")), false);
    assert.equal(existsSync(join(state.project, "src/.sites-worker-entry.mjs")), false);
  });
});
