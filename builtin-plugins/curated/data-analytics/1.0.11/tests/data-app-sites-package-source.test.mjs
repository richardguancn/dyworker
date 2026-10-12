import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { describe } from "node:test";

import {
  digest, fixture, fixtureOwnerSource, fixtureWorkerSource, legacyFixture,
  packageDataApp as packageDefaultDataApp, updateFixtureProtectedManifest,
  verifyFixtureProtectedManifest, writeSnapshot,
} from "./data-app-sites-package-fixtures.mjs";

const packageDataApp = (state, options = {}) => packageDefaultDataApp(state, { ...options, source: true });
const publicationPaths = [
  "dist/index.html", "src/data.json", "src/data-app-owner.js", ".openai/hosting.json",
  "protected-runtime.json", "dist/.openai/hosting.json", "dist/server/index.js",
  ".data-app-assets/manifest.json", ".data-app-assets/html.html", ".data-app-assets/snapshot.json", ".data-app-offline/index.html",
];
function publicationBytes({ project }) {
  return publicationPaths.map((path) => (existsSync(join(project, path)) ? readFileSync(join(project, path)) : null));
}

test("explicit source packaging verifies and retains a customized local Worker without installing packages", () => {
  const state = fixture();
  const originalHtml = readFileSync(join(state.project, "dist/index.html"));
  const originalSnapshot = JSON.parse(readFileSync(join(state.project, "src/data.json")));
  const customized = `${fixtureWorkerSource}\n// authorized source customization\n`;
  writeFileSync(join(state.project, "src/worker.js"), customized);
  updateFixtureProtectedManifest(state, ["src/worker.js"]);
  const output = JSON.parse(
    packageDataApp(state, {
      source: true,
      environment: { ...process.env, PATH: "", NAPI_RS_FORCE_WASI: "existing-selection" },
    }).trim(),
  );
  assert.equal(output.buildMode, "source");
  assert.equal(output.ownerAuthorization, "environment");
  assert.equal(output.ownerEnvironmentVariable, "DATA_APP_OWNER_EMAIL_SHA256");
  assert.equal(output.ownerSeeded, undefined);
  assert.equal(readFileSync(join(state.project, ".test-source-verified"), "utf8"), "yes");
  const worker = readFileSync(join(state.project, "dist/server/index.js"), "utf8");
  assert.match(worker, /authorized source customization/u);
  assert.match(worker, /initialPresentation: JSON\.parse\(/u);
  assert.match(worker, /inherited WASI mode "existing-selection"/u);
  assert.doesNotMatch(worker, /import\s+(?:dataAppHtml|seedSnapshot)\s/u);
  const assetManifest = JSON.parse(readFileSync(output.assetManifestPath));
  assert.equal(output.thinBootstrap, false);
  assert.deepEqual(readFileSync(output.offlineHtmlPath), originalHtml);
  assert.deepEqual(JSON.parse(readFileSync(output.assetFiles.snapshot)), originalSnapshot);
  for (const [kind, descriptor] of Object.entries(assetManifest.assets)) {
    const bytes = readFileSync(output.assetFiles[kind]);
    assert.equal(descriptor.sha256, digest(bytes));
    assert.equal(descriptor.bytes, bytes.length);
    assert.equal(output.deploymentAssets[kind].key, descriptor.key);
  }
  assert.equal(assetManifest.snapshotResponse.rowCount, 1);
  assert.equal(JSON.parse(readFileSync(join(state.project, ".openai/hosting.json"))).r2, "BUCKET");
  assert.deepEqual(JSON.parse(readFileSync(join(state.project, ".test-vite-node-arguments.json"))), []);
  assert.equal(JSON.parse(readFileSync(join(state.project, ".openai/hosting.json"))).artifact_metadata, undefined);
  assert.deepEqual(JSON.parse(readFileSync(join(state.project, "dist/.openai/hosting.json"))).artifact_metadata, {
    surface: "dashboard", producer: "data-analytics",
  });
});

test("source packaging attributes reviewed reports and rejects unapproved surfaces before mutation", () => {
  const state = fixture();
  writeSnapshot(state, { surface: "report", queries: { reviewed: { rows: [{ amount: 42 }] } } });
  packageDataApp(state);
  assert.equal(JSON.parse(readFileSync(join(state.project, ".openai/hosting.json"))).artifact_metadata, undefined);
  assert.deepEqual(JSON.parse(readFileSync(join(state.project, "dist/.openai/hosting.json"))).artifact_metadata, {
    surface: "report", producer: "data-analytics",
  });
  for (const surface of [null, "customer-authored-value", { customer_content: "secret" }]) {
    writeSnapshot(state, { surface, queries: { reviewed: { rows: [{ amount: 42 }] } } });
    const before = publicationBytes(state);
    assert.throws(() => packageDataApp(state), /surface must be dashboard or report/u);
    assert.deepEqual(publicationBytes(state), before);
  }
});

test("repeated embedded assets cannot bypass fragment validation or nested privacy checks", (t) => {
  const state = fixture();
  t.after(() => {
    rmSync(state.project, { recursive: true, force: true });
    rmSync(join(dirname(state.helperPath), "../../.."), { recursive: true, force: true });
  });
  const htmlPath = join(state.project, "dist/index.html");
  const reviewed = readFileSync(htmlPath, "utf8");
  const asset = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`;
  const repeated = `<link href="${asset}"><link href="${asset}">`;
  const clean = reviewed.replace("</head>", `${repeated}</head>`);
  writeFileSync(htmlPath, clean);
  packageDataApp(state);
  assert.equal(readFileSync(htmlPath, "utf8"), clean);

  const privateUrl = `data:text/plain;base64,${Buffer.from(state.project).toString("base64")}`;
  for (const [fragment, expected] of [
    ["%ZZ", /malformed embedded data URL/u],
    [encodeURIComponent(privateUrl), /local filesystem reference/u],
  ]) {
    writeFileSync(htmlPath, reviewed.replace("</head>", `${repeated}<link href="${asset}#${fragment}"></head>`));
    for (const path of [".test-source-verified", ".test-vite-arguments.json"]) {
      rmSync(join(state.project, path), { force: true });
    }
    const before = publicationBytes(state);
    assert.throws(() => packageDataApp(state), expected);
    assert.deepEqual(publicationBytes(state), before);
    for (const path of [".test-source-verified", ".test-vite-arguments.json", "src/.sites-worker-entry.mjs"]) {
      assert.equal(existsSync(join(state.project, path)), false);
    }
  }
});

test("source publication rejects an incompatible owner runtime and preserves customized Worker source", () => {
  const state = legacyFixture();
  const workerPath = join(state.project, "src/worker.js");
  const ownerPath = join(state.project, "src/data-app-owner.js");
  writeFileSync(ownerPath, `export const dataAppOwnerUserIdSha256 = "${digest("previous-site-owner")}";\n`);
  const source = [
    'import { dataAppOwnerUserIdSha256 } from "./data-app-owner.js";',
    'const id = "current";',
    'const store = (database) => database.prepare("presentation").bind(id, "{}", 0, new Date().toISOString()).run();',
    'export default { fetch(request) { return new Response(new URL(request.url).pathname === "/custom" ? "custom response" : "ok"); } };',
  ].join("\n");
  writeFileSync(workerPath, source);
  updateFixtureProtectedManifest(state, ["src/worker.js", "src/data-app-owner.js"]);
  const before = publicationBytes(state);
  assert.throws(() => packageDataApp(state), /requires a confirmed, scoped protected runtime upgrade/u);
  assert.deepEqual(publicationBytes(state), before);
  assert.equal(readFileSync(workerPath, "utf8"), source);
  verifyFixtureProtectedManifest(state);
});

test("source publication rejects copied factories that still authorize a packaged owner or ignore the environment", async t => {
  for (const [name, ownerSource] of [
    ["packaged owner fallback", "(environment.DATA_APP_OWNER_EMAIL_SHA256 || configuration.ownerEmailSha256)"],
    ["ignored environment", "configuration.ownerEmailSha256"],
  ]) await t.test(name, () => {
    const state = fixture();
    const runtimePath = join(state.project, "src/data-app-worker.js");
    const oldRuntime = readFileSync(runtimePath, "utf8").replace("environment.DATA_APP_OWNER_EMAIL_SHA256", ownerSource);
    writeFileSync(runtimePath, oldRuntime);
    updateFixtureProtectedManifest(state, ["src/data-app-worker.js"]);
    const before = publicationBytes(state);
    assert.throws(() => packageDataApp(state), /requires a confirmed, scoped protected runtime upgrade.*prebuilt packaging/u);
    assert.deepEqual(publicationBytes(state), before);
    assert.equal(readFileSync(runtimePath, "utf8"), oldRuntime);
    assert.equal(existsSync(join(state.project, ".test-vite-arguments.json")), false);
  });
});

test("source packaging preserves an existing inline factory's HTML and snapshot contract", async t => {
  for (const hybrid of [false, true]) await t.test(hybrid ? "asset-aware factory still requiring its seed" : "environment-aware inline factory", async () => {
  const state = fixture();
  const runtime = [
    'import { createHash } from "node:crypto";',
    "export function createDataAppWorker(configuration) {",
    hybrid ? "  Object.keys(configuration.seedSnapshot.queries);" : "  [...configuration.html.matchAll(/<head>/g)];",
    "  return { configuration, async fetch(request, environment) {",
    '    if (new URL(request.url).pathname === "/api/presentation") {',
    '      const hash = createHash("sha256").update(request.headers.get("oai-authenticated-user-email") ?? "").digest("hex");',
    '      return new Response(null, { status: hash === environment.DATA_APP_OWNER_EMAIL_SHA256 ? 400 : 403 });',
    "    }",
    "    const asset = configuration.deploymentAssets?.html;",
    "    return new Response(asset ? (await environment.BUCKET.get(asset.key)).body : configuration.html);",
    "  } };",
    "}",
  ].join("\n");
  writeFileSync(join(state.project, "src/data-app-worker.js"), runtime);
  updateFixtureProtectedManifest(state, ["src/data-app-worker.js"]);
  writeFileSync(join(state.project, "node_modules/vite/bin/vite.js"), [
    'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
    'const entry = process.argv[process.argv.indexOf("--ssr") + 1];',
    'const output = process.argv[process.argv.indexOf("--outDir") + 1];',
    'let source = readFileSync(entry, "utf8");',
    'source = source.replace(/^import dataAppHtml.*$/m, "const dataAppHtml = " + JSON.stringify(readFileSync("dist/index.html", "utf8")) + ";");',
    'source = source.replace(/^import seedSnapshot.*$/m, "const seedSnapshot = JSON.parse(" + JSON.stringify(readFileSync("src/data.json", "utf8")) + ");");',
    'source = source.replace(/^import .*createDataAppWorker.*$/m, readFileSync("src/data-app-worker.js", "utf8"));',
    'mkdirSync(output, { recursive: true }); writeFileSync(output + "/index.js", source);',
  ].join("\n"));
  const originalHtml = readFileSync(join(state.project, "dist/index.html"), "utf8");
  const originalSnapshot = JSON.parse(readFileSync(join(state.project, "src/data.json")));
  const output = JSON.parse(packageDataApp(state));
  const { default: worker } = await import(`data:text/javascript;base64,${readFileSync(output.serverPath).toString("base64")}`);
  assert.equal(await (await worker.fetch(new Request("https://site.example/"), {})).text(), originalHtml);
  assert.deepEqual(worker.configuration.seedSnapshot, originalSnapshot);
  assert.equal(output.deploymentAssets, undefined);
  assert.equal(JSON.parse(readFileSync(join(state.project, ".openai/hosting.json"))).r2, null);
  assert.equal(readFileSync(join(state.project, "src/data-app-worker.js"), "utf8"), runtime);
  verifyFixtureProtectedManifest(state);
  });
});

test("source-mode integrity and local dependency failures leave reviewed files unchanged", async (t) => {
  for (const [name, prepare, expected] of [
    [
      "modified source Worker",
      ({ project }) => writeFileSync(join(project, "src/data-app-worker.js"), "throw new Error('Unapproved source');\n"),
      /runtime files were modified outside packaging ownership/u,
    ],
    [
      "missing local Vite",
      ({ project }) => rmSync(join(project, "node_modules"), { recursive: true, force: true }),
      /already-installed project Vite/u,
    ],
    [
      "failed source verifier",
      ({ project }) => writeFileSync(join(project, "scripts/verify-protected-runtime.mjs"), "process.exit(17);\n"),
      /source verification failed with status 17/u,
    ],
    [
      "missing Worker factory",
      ({ project }) =>
        writeFileSync(
          join(project, "src/worker.js"),
          fixtureWorkerSource.replace("createDataAppWorker({", "customWorker({"),
        ),
      /requires a confirmed, scoped protected runtime upgrade/u,
    ],
    [
      "obsolete owner seed remains in the Worker",
      ({ project }) =>
        writeFileSync(
          join(project, "src/worker.js"),
          fixtureWorkerSource.replace("});", `  ownerEmailSha256: "${digest("another-owner@example.com")}",\n});`),
        ),
      /requires a confirmed, scoped protected runtime upgrade/u,
    ],
  ]) {
    await t.test(name, () => {
      const state = fixture();
      prepare(state);
      updateFixtureProtectedManifest(state, ["scripts/verify-protected-runtime.mjs", "src/worker.js"]);
      const before = publicationBytes(state);
      assert.throws(() => packageDataApp(state, { source: true }), expected);
      assert.deepEqual(publicationBytes(state), before);
      assert.equal(existsSync(join(state.project, "src/.sites-worker-entry.mjs")), false);
      assert.equal(existsSync(join(state.project, ".test-vite-arguments.json")), false);
    });
  }
});

test("source-mode Vite must stay inside the reviewed project", () => {
  const state = fixture();
  const outside = fixture();
  const localVite = join(state.project, "node_modules/vite/bin/vite.js");
  rmSync(localVite);
  symlinkSync(join(outside.project, "node_modules/vite/bin/vite.js"), localVite);
  const before = publicationBytes(state);
  assert.throws(() => packageDataApp(state, { source: true }), /inside the Data app project/u);
  assert.deepEqual(publicationBytes(state), before);
});


test("failed Sites Worker builds restore reviewed HTML and preserve source and hosting", () => {
  const state = fixture();
  const threadId = "550e8400-e29b-41d4-a716-446655440000";
  const ownerPath = join(state.project, "src/data-app-owner.js");
  const hostingPath = join(state.project, ".openai/hosting.json");
  const htmlPath = join(state.project, "dist/index.html");
  const previousOwnerHash = createHash("sha256").update("previous-site-owner").digest("hex");
  writeFileSync(ownerPath, fixtureOwnerSource(previousOwnerHash));
  updateFixtureProtectedManifest(state, ["src/data-app-owner.js"]);
  writeFileSync(
    htmlPath,
    readFileSync(htmlPath, "utf8").replace(
      "</head>",
      `<meta name="data-app-local-thread" content="${threadId}"></head>`,
    ),
  );
  const vitePath = join(state.project, "node_modules/vite/bin/vite.js");
  writeFileSync(vitePath, `${readFileSync(vitePath, "utf8")}\nprocess.exit(23);\n`);
  const ownerBefore = readFileSync(ownerPath);
  const hostingBefore = readFileSync(hostingPath);
  const htmlBefore = readFileSync(htmlPath);

  assert.throws(
    () =>
      packageDataApp(state, {
        environment: { ...process.env, CODEX_SESSION_ID: threadId },
        source: true,
      }),
    /Sites Worker packaging failed with status 23/u,
  );
  assert.deepEqual(readFileSync(ownerPath), ownerBefore);
  assert.deepEqual(readFileSync(hostingPath), hostingBefore);
  assert.deepEqual(readFileSync(htmlPath), htmlBefore);
  assert.equal(
    existsSync(join(state.project, "dist/server/index.js")),
    false,
    "A partially emitted Worker must not survive a failed Sites build",
  );
  assert.equal(existsSync(join(state.project, "dist/.openai/hosting.json")), false);
  assert.equal(existsSync(join(state.project, "src/.sites-worker-entry.mjs")), false);
});

test("failed Sites publication restores the previously published Worker byte-for-byte", async (t) => {
  const threadId = "550e8400-e29b-41d4-a716-446655440000";
  for (const [name, injectFailure, errorPattern] of [
    [
      "failed SSR build",
      ({ project }) => {
        const vitePath = join(project, "node_modules/vite/bin/vite.js");
        writeFileSync(vitePath, `${readFileSync(vitePath, "utf8")}\nprocess.exit(23);\n`);
      },
      /Sites Worker packaging failed with status 23/u,
    ],
    [
      "post-build local-task privacy failure",
      ({ project }) => {
        const workerPath = join(project, "src/worker.js");
        writeFileSync(workerPath, `${readFileSync(workerPath, "utf8")}\n// ${threadId.toUpperCase()}\n`);
      },
      /Sites Worker must not contain a local task identifier/u,
    ],
  ]) {
    await t.test(name, () => {
      const state = fixture();
      const htmlPath = join(state.project, "dist/index.html");
      const ownerPath = join(state.project, "src/data-app-owner.js");
      const hostingPath = join(state.project, ".openai/hosting.json");
      const publishedWorkerPath = join(state.project, "dist/server/index.js");
      mkdirSync(join(state.project, "dist/server"), { recursive: true });
      const publishedWorker = Buffer.from(
        'export default { fetch() { return new Response("previous reviewed Worker"); } };\n',
      );
      writeFileSync(publishedWorkerPath, publishedWorker);
      writeFileSync(
        htmlPath,
        readFileSync(htmlPath, "utf8").replace(
          "</head>",
          `<meta name="data-app-local-thread" content="${threadId}"></head>`,
        ),
      );
      injectFailure(state);
      updateFixtureProtectedManifest(state, ["src/worker.js"]);
      const originalHtml = readFileSync(htmlPath);
      const originalOwner = readFileSync(ownerPath);
      const originalHosting = readFileSync(hostingPath);

      assert.throws(
        () =>
          packageDataApp(state, {
            environment: { ...process.env, CODEX_SESSION_ID: threadId },
            source: true,
          }),
        errorPattern,
      );
      assert.deepEqual(
        readFileSync(publishedWorkerPath),
        publishedWorker,
        "A failed republication must restore the last reviewed Sites Worker exactly",
      );
      assert.deepEqual(readFileSync(htmlPath), originalHtml);
      assert.deepEqual(readFileSync(ownerPath), originalOwner);
      assert.deepEqual(readFileSync(hostingPath), originalHosting);
      assert.equal(existsSync(join(state.project, "src/.sites-worker-entry.mjs")), false);
    });
  }
});

test("a stale source Worker entry rejects source packaging before source, hosting, or HTML mutation", () => {
  const state = fixture();
  const threadId = "550e8400-e29b-41d4-a716-446655440000";
  const ownerPath = join(state.project, "src/data-app-owner.js");
  const hostingPath = join(state.project, ".openai/hosting.json");
  const htmlPath = join(state.project, "dist/index.html");
  const temporaryWorkerPath = join(state.project, "src/.sites-worker-entry.mjs");
  const previousOwnerHash = createHash("sha256").update("previous-site-owner").digest("hex");
  writeFileSync(ownerPath, fixtureOwnerSource(previousOwnerHash));
  updateFixtureProtectedManifest(state, ["src/data-app-owner.js"]);
  writeFileSync(
    htmlPath,
    readFileSync(htmlPath, "utf8").replace(
      "</head>",
      `<meta name="data-app-local-thread" content="${threadId}"></head>`,
    ),
  );
  writeFileSync(temporaryWorkerPath, "// existing Worker entry\n");
  const ownerBefore = readFileSync(ownerPath);
  const hostingBefore = readFileSync(hostingPath);
  const htmlBefore = readFileSync(htmlPath);

  assert.throws(
    () => packageDataApp(state),
    /A stale Sites Worker entry must be removed first/u,
  );
  assert.deepEqual(
    readFileSync(ownerPath),
    ownerBefore,
    "A failed republication must preserve protected source",
  );
  assert.deepEqual(readFileSync(hostingPath), hostingBefore);
  assert.deepEqual(readFileSync(htmlPath), htmlBefore);
  assert.equal(readFileSync(temporaryWorkerPath, "utf8"), "// existing Worker entry\n");
  assert.equal(existsSync(join(state.project, "dist/server/index.js")), false);
});


describe("source integrity and independent publication rollback", () => {
  test("a dangling asset symlink cannot create an outside-project target", t => {
    const state = fixture();
    packageDataApp(state);
    const asset = join(state.project, ".data-app-assets/snapshot.json");
    const outside = `${state.project}-missing-target`;
    t.after(() => rmSync(outside, { force: true }));
    assert.equal(existsSync(outside), false);
    const previousWorker = readFileSync(join(state.project, "dist/server/index.js"));
    rmSync(asset); symlinkSync(outside, asset);
    assert.throws(() => packageDataApp(state), /asset outputs must be regular files/u);
    assert.equal(existsSync(outside), false);
    assert.deepEqual(readFileSync(join(state.project, "dist/server/index.js")), previousWorker);
  });

  test("nonregular prior asset outputs are rejected without replacing their contents", () => {
    const state = fixture();
    packageDataApp(state);
    const asset = join(state.project, ".data-app-assets/snapshot.json");
    const server = join(state.project, "dist/server/index.js");
    const previousWorker = readFileSync(server);
    rmSync(asset); mkdirSync(asset); writeFileSync(join(asset, "keep"), "unrelated content");
    assert.throws(() => packageDataApp(state), /asset outputs must be regular files/u);
    assert.equal(readFileSync(join(asset, "keep"), "utf8"), "unrelated content");
    assert.deepEqual(readFileSync(server), previousWorker);
  });

  test("repackaging does not read prior snapshot assets into memory for rollback", () => {
    const state = fixture();
    packageDataApp(state);
    const preloadPath = join(state.project, "reject-asset-read.cjs");
    writeFileSync(preloadPath, [
      'const fs = require("node:fs");',
      "const read = fs.readFileSync;",
      `const asset = ${JSON.stringify(join(state.project, ".data-app-assets/snapshot.json"))};`,
      'fs.readFileSync = function(path, ...args) { if (String(path) === asset) throw new Error("Prior asset must stay on disk"); return read.call(this, path, ...args); };',
      'require("node:module").syncBuiltinESMExports();',
    ].join("\n"));
    assert.doesNotThrow(() => packageDataApp(state, {
      environment: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=${JSON.stringify(preloadPath)}`.trim() },
    }));
  });

  test("requires protected verifier and existing digest-helper entries before executing source tools", async (t) => {
    for (const [name, omittedPath, linkedHelper, expected] of [
      [
        "omitted regular digest helper",
        "scripts/protected-file-digest.mjs",
        false,
        /must protect its existing digest helper before any source verification/u,
      ],
      [
        "omitted symlinked digest helper",
        "scripts/protected-file-digest.mjs",
        true,
        /must protect its existing digest helper before any source verification/u,
      ],
      [
        "omitted source verifier",
        "scripts/verify-protected-runtime.mjs",
        false,
        /manifest does not protect scripts\/verify-protected-runtime\.mjs/u,
      ],
      [
        "omitted source factory",
        "src/data-app-worker.js",
        false,
        /manifest does not protect src\/data-app-worker\.js/u,
      ],
    ]) {
      await t.test(name, () => {
        const state = fixture();
        packageDefaultDataApp(state);
        const digestHelperPath = join(state.project, "scripts/protected-file-digest.mjs");
        const helperProbe = join(state.project, ".test-digest-helper-executed");
        const helperSource =
          `${readFileSync(digestHelperPath, "utf8")}\n` +
          'import { writeFileSync as recordHelperProbe } from "node:fs";\n' +
          `recordHelperProbe(${JSON.stringify(helperProbe)}, "yes");\n`;
        if (linkedHelper) {
          const target = join(mkdtempSync(join(tmpdir(), "data-app-external-digest-")), "digest.mjs");
          writeFileSync(target, helperSource);
          rmSync(digestHelperPath);
          symlinkSync(target, digestHelperPath);
        } else {
          writeFileSync(digestHelperPath, helperSource);
        }
        const verifierPath = join(state.project, "scripts/verify-protected-runtime.mjs");
        writeFileSync(
          verifierPath,
          'import { writeFileSync as recordVerifierProbe } from "node:fs";\n' +
            'recordVerifierProbe(".test-source-verifier-entered", "yes");\n' +
            readFileSync(verifierPath, "utf8"),
        );
        updateFixtureProtectedManifest(state, [
          "scripts/protected-file-digest.mjs",
          "scripts/verify-protected-runtime.mjs",
        ]);
        const manifestPath = join(state.project, "protected-runtime.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        delete manifest.files[omittedPath];
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        writeFileSync(
          join(state.project, ".openai/hosting.json"),
          JSON.stringify({
            d1: "DB",
            r2: null,
            project_id: "appgprj_reviewed",
          }),
        );
        const before = publicationBytes(state);

        assert.throws(
          () =>
            packageDataApp(state, {
              source: true,
              migratePackagingManifest: true,
            }),
          expected,
        );
        assert.deepEqual(publicationBytes(state), before);
        for (const path of [
          ".test-digest-helper-executed",
          ".test-source-verifier-entered",
          ".test-source-verified",
          ".test-vite-arguments.json",
          "src/.sites-worker-entry.mjs",
        ]) {
          assert.equal(existsSync(join(state.project, path)), false, `${path} must not be created`);
        }
      });
    }
  });

  test("temporary legacy manifest repair restores the exact original before a verifier or build failure", async (t) => {
    for (const [name, verifierFails] of [
      ["verifier failure", true],
      ["later source build failure", false],
    ]) {
      await t.test(name, () => {
        const state = legacyFixture();
        packageDataApp(state);
        const verifierPath = join(state.project, "scripts/verify-protected-runtime.mjs");
        writeFileSync(
          verifierPath,
          `${readFileSync(verifierPath, "utf8")}\n` +
            'writeFileSync(".test-manifest-during-verification.json", JSON.stringify(manifest));\n' +
            (verifierFails ? "process.exit(17);\n" : ""),
        );
        updateFixtureProtectedManifest(state, ["scripts/verify-protected-runtime.mjs"]);
        writeFileSync(
          join(state.project, ".openai/hosting.json"),
          JSON.stringify({
            d1: "DB",
            r2: null,
            project_id: "appgprj_reviewed",
            existingDeployment: "preserved",
          }),
        );
        const manifestPath = join(state.project, "protected-runtime.json");
        const originalManifest = readFileSync(manifestPath);
        const prospectiveManifest = JSON.parse(originalManifest);
        for (const path of [".openai/hosting.json"]) {
          prospectiveManifest.files[path] = digest(readFileSync(join(state.project, path)));
        }
        rmSync(join(state.project, ".test-vite-arguments.json"), { force: true });
        if (!verifierFails) {
          const vitePath = join(state.project, "node_modules/vite/bin/vite.js");
          writeFileSync(
            vitePath,
            `${readFileSync(vitePath, "utf8")}\n` +
              'writeFileSync(join(process.cwd(), ".test-manifest-during-build.json"), ' +
              'readFileSync(join(process.cwd(), "protected-runtime.json")));\n' +
              "process.exit(23);\n",
          );
        }
        const before = publicationBytes(state);

        assert.throws(
          () =>
            packageDataApp(state, {
              migratePackagingManifest: true,
            }),
          verifierFails
            ? /Protected Data app source verification failed with status 17/u
            : /Sites Worker packaging failed with status 23/u,
        );
        assert.deepEqual(
          JSON.parse(readFileSync(join(state.project, ".test-manifest-during-verification.json"), "utf8")),
          prospectiveManifest,
          "Only the hosting hash may be repaired for verification",
        );
        if (verifierFails) {
          assert.equal(existsSync(join(state.project, ".test-vite-arguments.json")), false);
        } else {
          assert.deepEqual(
            readFileSync(join(state.project, ".test-manifest-during-build.json")),
            originalManifest,
            "The source build must observe the original manifest, not a temporary authorization repair",
          );
        }
        assert.deepEqual(publicationBytes(state), before);
        assert.equal(existsSync(join(state.project, "src/.sites-worker-entry.mjs")), false);
      });
    }
  });

  test("legacy hosting migration rejects owner-file changes before tools run", async (t) => {
    const ownerHash = digest("previous-verified-owner");
    const realExport = fixtureOwnerSource(ownerHash);
    for (const [name, source] of [
      ["line separator ends a line comment", `${realExport}// harmless\u2028globalThis.ownerSideEffect = true;\n`],
      ["paragraph separator ends a line comment", `${realExport}// harmless\u2029globalThis.ownerSideEffect = true;\n`],
      ["line-commented fake export", `// ${realExport}`],
      ["block-commented fake export", `/* ${realExport} */\n`],
      ["duplicate owner export", `${realExport}${realExport}`],
    ]) {
      await t.test(name, () => {
        const state = legacyFixture();
        packageDataApp(state);
        rmSync(join(state.project, ".test-source-verified"), { force: true });
        rmSync(join(state.project, ".test-vite-arguments.json"), { force: true });
        writeFileSync(
          join(state.project, ".openai/hosting.json"),
          JSON.stringify({
            d1: "DB",
            r2: null,
            project_id: "appgprj_reviewed",
          }),
        );
        writeFileSync(join(state.project, "src/data-app-owner.js"), source);
        const before = publicationBytes(state);

        assert.throws(
          () =>
            packageDataApp(state, {
              migratePackagingManifest: true,
            }),
          /runtime files were modified outside packaging ownership: src\/data-app-owner\.js/u,
        );
        assert.deepEqual(publicationBytes(state), before);
        for (const path of [".test-source-verified", ".test-vite-arguments.json", "src/.sites-worker-entry.mjs"]) {
          assert.equal(existsSync(join(state.project, path)), false, `${path} must not be created`);
        }
      });
    }
  });

  test("a failed final manifest write restores other artifacts even if Worker restoration also fails", async (t) => {
    for (const failServerRestore of [false, true]) {
      await t.test(failServerRestore ? "independent restoration after a second failure" : "complete rollback", () => {
        const state = fixture();
        packageDataApp(state);
        const presentationPath = join(state.project, "presentation.json");
        const presentation = JSON.parse(readFileSync(presentationPath));
        writeFileSync(presentationPath, JSON.stringify({ ...presentation, title: "Updated reviewed presentation" }));
        const htmlPath = join(state.project, "dist/index.html");
        writeFileSync(
          htmlPath,
          readFileSync(htmlPath, "utf8").replace(
            "</head>",
            '<meta name="data-app-local-thread" content="550e8400-e29b-41d4-a716-446655440000"></head>',
          ),
        );
        const before = publicationBytes(state);
        const injectionDirectory = mkdtempSync(join(tmpdir(), "data-app-write-failure-"));
        const preloadPath = join(injectionDirectory, "inject-write-failure.cjs");
        const logPath = join(injectionDirectory, "restoration-attempts.json");
        const manifestPath = join(state.project, "protected-runtime.json");
        const serverPath = join(state.project, "dist/server/index.js");
        writeFileSync(
          preloadPath,
          [
            'const fs = require("node:fs");',
            "const originalWrite = fs.writeFileSync;",
            "const originalRename = fs.renameSync;",
            `const manifestPath = ${JSON.stringify(manifestPath)};`,
            `const serverPath = ${JSON.stringify(serverPath)};`,
            `const logPath = ${JSON.stringify(logPath)};`,
            `const failServerRestore = ${JSON.stringify(failServerRestore)};`,
            "const attempts = [];",
            "let manifestFailed = false;",
            "fs.renameSync = function (from, to) {",
            "  if (manifestFailed) { attempts.push(String(to)); originalWrite.call(fs, logPath, JSON.stringify(attempts)); }",
            "  return originalRename.call(this, from, to);",
            "};",
            "fs.writeFileSync = function (file, ...args) {",
            "  const path = String(file);",
            "  if (path === manifestPath && !manifestFailed) {",
            "    manifestFailed = true;",
            '    originalWrite.call(fs, file, "partially written manifest");',
            '    throw new Error("Injected final manifest write failure");',
            "  }",
            "  if (manifestFailed) {",
            "    attempts.push(path);",
            "    originalWrite.call(fs, logPath, JSON.stringify(attempts));",
            "    if (failServerRestore && path === serverPath)",
            '      throw new Error("Injected Worker restore failure");',
            "  }",
            "  return originalWrite.call(this, file, ...args);",
            "};",
            'require("node:module").syncBuiltinESMExports();',
          ].join("\n"),
        );

        assert.throws(
          () =>
            packageDataApp(state, {
              environment: {
                ...process.env,
                NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=${JSON.stringify(preloadPath)}`.trim(),
              },
            }),
          (error) => {
            assert.match(error.stderr, /Injected final manifest write failure/u);
            if (failServerRestore) {
              assert.match(
                error.stderr,
                /AggregateError: Sites packaging failed and some prior artifacts could not be restored/u,
              );
              assert.match(error.stderr, /Injected Worker restore failure/u);
            }
            return true;
          },
        );
        assert.deepEqual(JSON.parse(readFileSync(logPath, "utf8")), [
          join(state.project, ".data-app-assets/manifest.json"),
          join(state.project, ".data-app-assets/snapshot.json"),
          join(state.project, ".data-app-assets/html.html"),
          join(state.project, ".data-app-offline/index.html"),
          manifestPath,
          serverPath,
          join(state.project, ".openai/hosting.json"),
          join(state.project, "dist/.openai/hosting.json"),
          htmlPath,
        ]);
        const after = publicationBytes(state);
        for (const [index, path] of publicationPaths.entries()) {
          if (failServerRestore && path === "dist/server/index.js") {
            assert.notDeepEqual(
              after[index],
              before[index],
              "The injected Worker restoration failure must actually fire",
            );
          } else {
            assert.deepEqual(after[index], before[index], `${path} must be restored independently`);
          }
        }
        assert.equal(existsSync(join(state.project, "src/.sites-worker-entry.mjs")), false);
      });
    }
  });
});
