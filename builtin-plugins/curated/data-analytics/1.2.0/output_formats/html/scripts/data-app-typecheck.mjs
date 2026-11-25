import { chartRuntimePath } from "../../../scripts/plugin-paths.mjs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultPluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Load only the release-pinned offline checker, never a host TypeScript install. */
export async function loadDataTypeScript({ pluginRoot = defaultPluginRoot } = {}) {
  const root = chartRuntimePath(pluginRoot, "assets");
  const manifest = JSON.parse(await readFile(resolve(root, "chart-assets.json"), "utf8"));
  const entry = manifest.assets?.["chart-check.mjs"];
  if (manifest.schemaVersion !== 1 || manifest.typecheck?.apiVersion !== 1 || !entry)
    throw new Error("The installed Data plugin lacks a compatible offline typechecker; rebuild its authoring assets.");
  const filename = resolve(root, "chart-check.mjs");
  const bytes = await readFile(filename);
  if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
    throw new Error("Retained chart asset does not match its release manifest: chart-check.mjs");
  const url = pathToFileURL(filename);
  url.searchParams.set("sha256", entry.sha256);
  const checker = await import(url.href);
  if (checker.dataTypecheckApiVersion !== 1 || checker.typescript?.version !== manifest.typecheck.typescriptVersion ||
      typeof checker.checkTypeScript !== "function" || typeof checker.createTypeScriptProgram !== "function" || !checker.declarations)
    throw new Error("The installed Data typechecker does not match its release API/version.");
  return { typescript: checker.typescript, checkTypeScript: checker.checkTypeScript, createTypeScriptProgram: checker.createTypeScriptProgram, declarations: checker.declarations };
}
