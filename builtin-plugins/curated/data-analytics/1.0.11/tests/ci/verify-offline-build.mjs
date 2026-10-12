import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { digestProtectedFile } from "../../templates/data-app/base/scripts/protected-file-digest.mjs";

const digest = (contents) => createHash("sha256").update(contents).digest("hex");

function regularFile(path, description, { allowEmpty = false } = {}) {
  const metadata = lstatSync(path, { throwIfNoEntry: false });
  assert.ok(metadata?.isFile() && (allowEmpty || metadata.size > 0), `Missing or invalid ${description}: ${path}`);
  return metadata;
}

function markerHash(html, name) {
  const head = /<head(?:\s[^>]*)?>([\s\S]*?)<\/head\s*>/iu.exec(html)?.[1] ?? "";
  const markers = [...head.matchAll(new RegExp(`<meta\\b[^>]*\\bname\\s*=\\s*(["'])${name}\\1[^>]*>`, "giu"))];
  const hash = markers.length === 1 ? /\bcontent\s*=\s*(["'])([a-f\d]{64})\1/u.exec(markers[0][0])?.[2] : null;
  assert.ok(hash, `The Data HTML must contain exactly one valid ${name} marker`);
  return hash;
}

function clientContents(html) {
  // The CI starter emits this inert payload in either supported attribute order.
  // Only its data and publication metadata may differ; client code and layout may not.
  return html
    .replace(/(<head(?:\s[^>]*)?>)([\s\S]*?)(<\/head>)/u, (_, open, head, close) => open + head
      .replace(/<meta name="data-app-(?:local-thread|local-reference|sites-project|snapshot-storage)" content="[^"]*">/gu, "") + close)
    .replace(/(<script (?:type="application\/json" id="data-app-reviewed-snapshot"|id="data-app-reviewed-snapshot" type="application\/json")>)[\s\S]*?(<\/script>)/gu, "$1$2");
}

export function readBuildIntegrity(projectRoot) {
  regularFile(join(projectRoot, "dist/index.html"), "Data client build");
  regularFile(join(projectRoot, "src/data.json"), "reviewed Data snapshot");
  const html = readFileSync(join(projectRoot, "dist/index.html"), "utf8");
  const snapshotSha256 = digest(readFileSync(join(projectRoot, "src/data.json")));
  assert.equal(
    markerHash(html, "data-app-snapshot-sha256"),
    snapshotSha256,
    "The Data HTML must match the exact reviewed snapshot bytes",
  );
  return {
    htmlSha256: digest(html),
    snapshotSha256,
    runtimeSha256: markerHash(html, "data-app-runtime-sha256"),
  };
}

function sourceState(projectRoot) {
  const manifest = JSON.parse(readFileSync(join(projectRoot, "protected-runtime.json"), "utf8"));
  assert.equal(manifest.version, 1, "Unexpected protected runtime format");
  assert.ok(manifest.files && typeof manifest.files === "object" && !Array.isArray(manifest.files));
  const names = new Set([
    "package.json",
    "package-lock.json",
    "protected-runtime.json",
    "src/data.json",
    "src/theme.css",
    ...Object.keys(manifest.files),
  ]);
  function visit(name) {
    for (const entry of readdirSync(join(projectRoot, name), { withFileTypes: true })) {
      const child = `${name}/${entry.name}`;
      assert.ok(!entry.isSymbolicLink(), `The offline source must not contain symlinks: ${child}`);
      if (entry.isDirectory()) visit(child);
      else {
        assert.ok(entry.isFile(), `The offline source must contain regular files: ${child}`);
        names.add(child);
      }
    }
  }
  visit("src/content");
  return Object.fromEntries(
    [...names].sort().map((name) => {
      assert.ok(
        !isAbsolute(name) &&
          !name.includes("\\") &&
          !name.split("/").some((part) => !part || part === "." || part === ".."),
        `Invalid protected source path: ${name}`,
      );
      regularFile(join(projectRoot, name), `Data source ${name}`, { allowEmpty: true });
      return [name, digestProtectedFile(name, readFileSync(join(projectRoot, name)))];
    }),
  );
}

async function verifyWorker(projectRoot, built, packaged) {
  assert.equal(packaged.projectRoot, projectRoot, "The Sites package must identify the original Data project");
  assert.equal(packaged.htmlPath, join(projectRoot, "dist/index.html"), "Sites packaging must preserve the existing HTML path");
  assert.equal(packaged.serverPath, join(projectRoot, "dist/server/index.js"));
  const workerPath = packaged.serverPath;
  regularFile(workerPath, "Sites Worker build");
  regularFile(packaged.htmlPath, "Sites client build");
  regularFile(join(projectRoot, "dist/.openai/hosting.json"), "Sites hosting metadata");
  regularFile(join(projectRoot, ".openai/hosting.json"), "Sites package project metadata");
  const html = readFileSync(packaged.htmlPath, "utf8");
  assert.equal(markerHash(html, "data-app-snapshot-sha256"), built.snapshotSha256);
  assert.equal(markerHash(html, "data-app-runtime-sha256"), built.runtimeSha256);
  const hosting = JSON.parse(readFileSync(join(projectRoot, "dist/.openai/hosting.json"), "utf8"));
  const { artifact_metadata, ...projectHosting } = hosting;
  assert.deepEqual(JSON.parse(readFileSync(join(projectRoot, ".openai/hosting.json"), "utf8")), projectHosting);
  const snapshot = JSON.parse(readFileSync(join(projectRoot, "src/data.json"), "utf8"));
  assert.deepEqual(
    artifact_metadata,
    { surface: snapshot.surface ?? "dashboard", producer: "data-analytics" },
    "Sites attribution must identify the reviewed Data artifact",
  );
  assert.equal(hosting.d1, "DB", "The offline Sites package must preserve its database binding");
  assert.equal(hosting.r2, "BUCKET", "The Sites package must bind its publication assets");
  assert.ok(
    typeof hosting.project_id === "string" && hosting.project_id.trim(),
    "The Sites package must identify its project",
  );
  const assets = new Map();
  for (const kind of ["html", "snapshot"]) {
    const path = join(projectRoot, ".data-app-assets", kind === "html" ? "html.html" : "snapshot.json");
    assert.equal(packaged.assetFiles[kind], path);
    regularFile(path, `Sites ${kind} asset`);
    const bytes = readFileSync(path);
    const descriptor = packaged.deploymentAssets[kind];
    assert.equal(descriptor.sha256, digest(bytes), `The Sites ${kind} asset hash must match`);
    assert.equal(descriptor.bytes, bytes.length, `The Sites ${kind} asset size must match`);
    assert.equal(descriptor.key, `data-app/${kind}/${descriptor.sha256}`);
    assets.set(descriptor.key, { bytes, descriptor });
    if (kind === "html") {
      assert.equal(bytes.toString("utf8"), html, "The hosted HTML must match its publication asset");
      assert.equal(digest(bytes), packaged.hostedHtmlSha256);
    } else {
      assert.deepEqual(JSON.parse(bytes), snapshot, "The published asset must preserve the complete reviewed snapshot");
    }
  }
  const projectMarkers = [...html.matchAll(/<meta\s+name="data-app-sites-project"\s+content="([^"]*)">/gu)];
  assert.deepEqual(projectMarkers.map((match) => match[1]), [hosting.project_id]);
  // Loading from a data URL also proves the Worker has no filesystem-relative
  // chunks or package imports that happened to be installed by the CI worker.
  const workerUrl = `data:text/javascript;base64,${readFileSync(workerPath).toString("base64")}`;
  const worker = (await import(workerUrl)).default;
  assert.equal(typeof worker?.fetch, "function", "The offline Sites package must export a real Worker");
  const response = await worker.fetch(new Request("https://offline-data.example/"), {
    BUCKET: {
      async get(key) {
        const asset = assets.get(key);
        if (!asset) return null;
        return {
          body: new Response(asset.bytes).body,
          size: asset.bytes.length,
          customMetadata: { sha256: asset.descriptor.sha256 },
        };
      },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(
    await response.text(),
    html,
    "The offline Sites Worker must serve the exact reviewed HTML with its Sites project marker",
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "project-dir": { type: "string" },
      "state-file": { type: "string" },
      "require-worker": { type: "boolean", default: false },
      "package-result-file": { type: "string" },
    },
    strict: true,
  });
  const [command] = positionals;
  assert.ok(
    positionals.length === 1 &&
      ["capture", "verify"].includes(command) &&
      values["project-dir"] &&
      values["state-file"],
    "Usage: verify-offline-build.mjs <capture|verify> --project-dir <app> --state-file <state.json> [--require-worker --package-result-file <package.json>]",
  );
  const projectRoot = realpathSync(values["project-dir"]);
  const statePath = resolve(values["state-file"]);
  assert.equal(
    lstatSync(join(projectRoot, "node_modules"), { throwIfNoEntry: false }),
    undefined,
    "The prebuilt Data build must not create project node_modules",
  );
  const built = readBuildIntegrity(projectRoot);
  const sources = sourceState(projectRoot);
  const hosting = JSON.parse(readFileSync(join(projectRoot, ".openai/hosting.json"), "utf8"));
  if (values["require-worker"]) {
    assert.ok(values["package-result-file"], "Worker verification requires the Sites package result file");
  }
  const packaged = values["require-worker"]
    ? JSON.parse(readFileSync(values["package-result-file"], "utf8"))
    : null;
  if (command === "capture") {
    assert.equal(values["require-worker"], false, "Capture the baseline before Sites packaging");
    writeFileSync(statePath, `${JSON.stringify({ format: 3, projectRoot, built, sources, hosting }, null, 2)}\n`, {
      flag: "wx",
    });
  } else {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.format, 3, "Unexpected offline build checkpoint format");
    assert.equal(state.projectRoot, projectRoot, "Offline build checkpoint belongs to another app");
    if (packaged) {
      const expectedHosting = { ...state.hosting, project_id: packaged.projectId, d1: "DB", r2: "BUCKET" };
      delete expectedHosting.static;
      assert.deepEqual(hosting, expectedHosting, "Sites packaging must change only its declared hosting bindings");
      // Verify the publication-owned change before comparing every other source.
      sources[".openai/hosting.json"] = state.sources[".openai/hosting.json"];
      assert.equal(packaged.offlineHtmlPath, join(projectRoot, ".data-app-offline/index.html"));
      regularFile(packaged.offlineHtmlPath, "preserved offline HTML");
      assert.equal(digest(readFileSync(packaged.offlineHtmlPath)), state.built.htmlSha256,
        "Sites packaging must preserve the original offline HTML bytes");
      assert.equal(packaged.htmlSha256, state.built.htmlSha256);
      assert.equal(clientContents(readFileSync(packaged.htmlPath, "utf8")),
        clientContents(readFileSync(packaged.offlineHtmlPath, "utf8")),
        "Sites packaging must preserve the reviewed client code and layout");
    }
    assert.deepEqual(sources, state.sources, "The reviewed Data app source was modified by an offline build");
    assert.equal(built.snapshotSha256, state.built.snapshotSha256, "The reviewed Data snapshot changed");
    assert.equal(built.runtimeSha256, state.built.runtimeSha256, "The prebuilt browser runtime changed between builds");
    assert.equal(
      built.htmlSha256,
      packaged ? packaged.hostedHtmlSha256 : state.built.htmlSha256,
      "Repeated builds or packaged assets must preserve the same HTML bytes",
    );
  }
  if (values["require-worker"]) {
    await verifyWorker(projectRoot, built, packaged);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
