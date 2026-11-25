#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDataApp, formatCheckResult } from "./data-app-check.mjs";
import { describeDataApp } from "./data-app-describe.mjs";
import { watchDataApp } from "./data-app-watch.mjs";
import { parseArgs } from "node:util";

import { buildPrebuiltDataApp, preparePrebuiltDataApp, projectLocalDataThreadId } from "./data-app-build.mjs";
import { assertSupportedDataNode, localSourceVite, runDataNode } from "./data-app-runtime.mjs";
import { PLUGIN_ROOT, readRegularFile, sha256 } from "./prebuilt/manifest.mjs";
import { assertHydratedPublicationSource, exportOfflineDataApp } from "./data-app-separate.mjs";

function usage() {
  console.log(
    "Usage: <codex-node> data-app.mjs <prepare|build|check|describe|export-html> --project-dir <copied-data-app> [--offline] [--source | --separate-data] [build: --check] [check: --json] [check: --watch] [describe: --component NAME] [describe: --query ID] [--output <.data-app-offline/exports/name.html>]",
  );
}

async function sourceBuild(projectDir, build, onProgress) {
  assertHydratedPublicationSource(projectDir);
  const { projectRoot, vitePath } = await localSourceVite(projectDir);
  runDataNode([join(projectRoot, "scripts/verify-protected-runtime.mjs")], { cwd: projectRoot, onProgress });
  let documentation = {
    entryPoint: join(PLUGIN_ROOT, "skills/index/SKILL.md"),
    referenceRoot: join(PLUGIN_ROOT, "output_formats/html/docs/components"),
    source: "installed-plugin",
  };
  for (const entry of ["docs/components/README.md", "src/content/COMPONENTS.md"]) {
    try {
      await readRegularFile(projectRoot, entry);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    documentation = {
      entryPoint: join(projectRoot, entry),
      source: "project-source",
      protectedRuntimeSha256: sha256(await readRegularFile(projectRoot, "protected-runtime.json")),
    };
    break;
  }
  if (!build) return { projectRoot, prebuilt: false, source: true, vitePath, documentation };
  const localThreadId = await projectLocalDataThreadId(projectRoot);
  // Alpha-8 projects kept their chart aliases in a protected Vite config.
  const viteArgs = existsSync(join(projectRoot, "src/charting/cdn.json"))
    ? [vitePath, "build"]
    : [fileURLToPath(new URL("./build-alpha8-source.mjs", import.meta.url)), vitePath];
  runDataNode(viteArgs, {
    cwd: projectRoot,
    onProgress,
    environment: { ...process.env, CODEX_SESSION_ID: localThreadId, CODEX_THREAD_ID: localThreadId },
  });
  const html = await readRegularFile(projectRoot, "dist/index.html");
  return {
    projectRoot,
    prebuilt: false,
    source: true,
    documentation,
    htmlPath: join(projectRoot, "dist/index.html"),
    htmlSha256: sha256(html),
    snapshotSha256: sha256(await readRegularFile(projectRoot, "src/data.json")),
  };
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "project-dir": { type: "string" },
      component: { type: "string" },
      query: { type: "string" },
      offline: { type: "boolean" },
      source: { type: "boolean", default: false },
      "separate-data": { type: "boolean", default: false },
      output: { type: "string" },
      check: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      watch: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (values.help) usage();
  else {
    assertSupportedDataNode();
    const command = positionals[0] === "export-offline" ? "export-html" : positionals[0];
    if (positionals.length !== 1 || !["prepare", "build", "check", "describe", "export-html"].includes(command) || !values["project-dir"]?.trim()) {
      usage();
      throw new Error("Specify a copied Data app directory and prepare, build, check, describe, or export-html.");
    }
    if (values["separate-data"] && (values.source || command !== "build")) throw new Error("--separate-data is supported only for a prebuilt build; --source remains a distinct build path.");
    if (command === "export-html" && values.source) throw new Error("export-html requires a verified separate-data build; source builds already produce their own HTML.");
    if (values.output !== undefined && command !== "export-html") throw new Error("--output is supported only for export-html.");
    if ((values.watch || values.json) && command !== "check") throw new Error("--watch and --json are supported only for check.");
    if (command !== "describe" && (values.component !== undefined || values.query !== undefined)) throw new Error("--component and --query are supported only for describe.");
    if (command === "describe" && values.source) throw new Error("describe reads the prebuilt view contract.");
    if (values.check && (command !== "build" || values.source)) throw new Error("--check is supported only for a prebuilt build.");
    if (command === "check" && values.source) throw new Error("check validates ordinary authored content against the installed public API; --source is a distinct build path.");
    const onProgress = (message) => console.error(message);
    // --offline remains accepted for existing callers. Neither path installs or
    // downloads anything, and source compilation is always an explicit choice.
    if (command === "describe") {
      console.log(JSON.stringify(await describeDataApp({ projectDir: values["project-dir"], component: values.component, query: values.query })));
    } else if (command === "check") {
      const report = result => console.log(values.json ? JSON.stringify(result) : formatCheckResult(result));
      if (values.watch) {
        const controller = new AbortController();
        const stop = () => controller.abort();
        process.once("SIGINT", stop); process.once("SIGTERM", stop);
        try { await watchDataApp({ projectDir: values["project-dir"], cliPath: fileURLToPath(import.meta.url), signal: controller.signal, onResult: report }); }
        finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
      } else {
        const result = await checkDataApp({ projectDir: values["project-dir"] });
        report(result);
        if (result.status === "failed") process.exitCode = 1;
      }
    } else {
      const result = command === "export-html"
        ? await exportOfflineDataApp({ projectDir: values["project-dir"], outputPath: values.output })
        : values.source
        ? await sourceBuild(values["project-dir"], command === "build", onProgress)
        : await (command === "build" ? buildPrebuiltDataApp : preparePrebuiltDataApp)({
            projectDir: values["project-dir"],
            onProgress,
            separateData: values["separate-data"],
            check: values.check,
          });
      console.log(JSON.stringify(result));
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
