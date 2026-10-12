import assert from "node:assert/strict";
import { lstatSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { readBuildIntegrity } from "./verify-offline-build.mjs";

export function assertNoCustomerToolchain({ projectRoot, loadedModules, sharedObjects }) {
  assert.equal(
    lstatSync(join(projectRoot, "node_modules"), { throwIfNoEntry: false }),
    undefined,
    "A prebuilt customer app must not contain node_modules",
  );
  for (const filename of loadedModules) {
    assert.doesNotMatch(
      filename.replaceAll("\\", "/"),
      /(?:^|\/)node_modules(?:\/|$)/iu,
      "A prebuilt customer build must not load an installed npm package",
    );
  }
  for (const filename of [...loadedModules, ...sharedObjects]) {
    assert.doesNotMatch(
      filename.replaceAll("\\", "/"),
      /(?:^|\/)(?:@rolldown\/|(?:rolldown|lightningcss|esbuild)(?:[-.]|\/)|binding-wasm32-wasi(?:\/|$)|@napi-rs\/wasm-runtime(?:\/|$))/iu,
      "A prebuilt customer build must not load a native or WASM build toolchain",
    );
  }
}

function loadedSharedObjects() {
  const previous = process.report.excludeNetwork;
  try {
    process.report.excludeNetwork = true;
    return process.report.getReport().sharedObjects;
  } finally {
    process.report.excludeNetwork = previous;
  }
}

async function main() {
  const { values } = parseArgs({
    options: { "project-dir": { type: "string" } },
    strict: true,
  });
  assert.ok(values["project-dir"], "Usage: verify-prebuilt-runtime.mjs --project-dir <prebuilt-data-app>");
  const projectRoot = realpathSync(values["project-dir"]);
  const { assertPrebuiltProject, loadPrebuiltCompiler } = await import("../../scripts/data-app-runtime.mjs");
  const checked = await assertPrebuiltProject({ projectDir: projectRoot });
  const compiler = await loadPrebuiltCompiler({ pluginRoot: checked.pluginRoot, manifest: checked.manifest });
  const transformed = compiler.transform("export const View = () => <section>Offline JSX</section>;", {
    filePath: "offline-check.jsx",
  });
  assert.match(transformed, /Offline JSX/u);
  assert.equal(compiler.parseJavaScript(transformed).type, "Program");
  assert.equal(compiler.parseCss(":root { --offline: 1; }").type, "StyleSheet");
  const built = readBuildIntegrity(projectRoot);
  assert.equal(
    built.runtimeSha256,
    checked.manifest.artifacts.app.sha256,
    "The customer HTML must identify the verified shipped browser runtime",
  );
  assertNoCustomerToolchain({
    projectRoot,
    loadedModules: Object.keys(createRequire(import.meta.url).cache),
    sharedObjects: loadedSharedObjects(),
  });
  console.log(
    JSON.stringify({
      mode: "prebuilt",
      apiVersion: checked.manifest.apiVersion,
      runtimeSha256: checked.manifest.artifacts.app.sha256,
      compilerSha256: checked.manifest.artifacts.compiler.sha256,
      snapshotSha256: built.snapshotSha256,
      artifactCount: Object.keys(checked.manifest.artifacts).length,
    }),
  );
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
