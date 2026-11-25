import { chartRuntimePath } from "../../../../scripts/plugin-paths.mjs";
import { sourcePath } from "../template/source-path.mjs";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { uiComponentFiles } from "../ui-components.mjs";
import { sortedObject, validateReleaseLock } from "./release-lock.mjs";

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const MANIFEST_FORMAT = 1;
export const API_VERSION = 1;
export const RUNTIME_MODULE_SPECIFIERS = Object.freeze([
  "@openai/data-app",
  "react",
  "react-dom",
  "react-dom/client",
  "react-markdown",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
  "recharts",
]);
export const RECEIPT_CANONICAL_MODULES = Object.freeze([
  "src/components/SourceInspector.jsx",
  "src/components/SourcesReceipt.jsx",
]);
export const ARTIFACT_PATHS = Object.freeze({
  app: "app.js",
  styles: "styles.css",
  print: "print.css",
  receipt: "receipt.js",
  worker: "worker.mjs",
  compiler: "compiler.cjs",
  notices: "THIRD_PARTY_NOTICES.txt",
});

export const RELEASE_INPUTS = Object.freeze([
  "assets/datascience-small.svg",
  "skills/visualize-data/assets/cdn.json",
  "skills/visualize-data/src/tools/dashboard.css",
  "output_formats/html/scripts/ui-components.mjs",
  "scripts/sync-chart-semantics.mjs",
  "scripts/plugin-paths.mjs",
  "skills/index/SKILL.md",
  "output_formats/html/scripts/prebuilt/build.mjs",
  "output_formats/html/scripts/prebuilt/compiler-entry.mjs",
  "output_formats/html/scripts/prebuilt/license-overrides.json",
  "output_formats/html/scripts/prebuilt/manifest.mjs",
  "output_formats/html/scripts/prebuilt/package.json",
  "output_formats/html/scripts/prebuilt/package-lock.json",
  "output_formats/html/scripts/prebuilt/refresh-lock.mjs",
  "output_formats/html/scripts/prebuilt/release-lock.mjs",
  "skills/visualize-data/assets/inline-sources-fragment.html",
  "skills/visualize-data/assets/inline-sources-example.json",
  "skills/visualize-data/scripts/runtime/sources-common.mjs",
  "skills/visualize-data/scripts/runtime/inline-sources-input.mjs",
  "skills/visualize-data/scripts/runtime/fragment-output.mjs",
  "skills/visualize-data/scripts/runtime/render-inline-sources.mjs",
  "skills/visualize-data/scripts/runtime/replacement-safe-javascript.mjs",
  "output_formats/html/themes/codex-classic/theme.css",
]);

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

export function validateRelativePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    /[:\u0000-\u001f\u007f]/u.test(value) ||
    isAbsolute(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`Invalid prebuilt source path: ${String(value)}`);
  return value;
}

export function isInside(parent, child) {
  const result = relative(resolve(parent), resolve(child));
  return result === "" || (result !== ".." && !result.startsWith(`..${sep}`) && !isAbsolute(result));
}

export async function readRegularFile(root, name) {
  validateRelativePath(name);
  let current = resolve(root);
  const parts = name.split("/");
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const entry = await lstat(current);
    if (entry.isSymbolicLink() || (index === parts.length - 1 ? !entry.isFile() : !entry.isDirectory())) {
      throw new Error(`Prebuilt input must be a regular, nonsymlinked file: ${name}`);
    }
  }
  return readFile(current);
}

async function filesUnder(root, prefix) {
  const result = [];
  async function visit(name) {
    const entries = (await readdir(join(root, name), { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const next = `${name}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Prebuilt source cannot contain symlinks: ${next}`);
      if (entry.isDirectory()) await visit(next);
      else if (entry.isFile()) result.push(next);
      else throw new Error(`Unsupported prebuilt source file: ${next}`);
    }
  }
  await visit(prefix);
  return result;
}

export async function readSourceState(pluginRoot = PLUGIN_ROOT) {
  pluginRoot = resolve(pluginRoot);
  const base = "output_formats/html";
  const projectFile = name => relative(pluginRoot, sourcePath(join(pluginRoot, base), name)).split(sep).join("/");
  const protectedBytes = await readRegularFile(pluginRoot, projectFile("protected-runtime.json"));
  const protectedManifest = JSON.parse(protectedBytes);
  if (protectedManifest.version !== 1 || !protectedManifest.files || Array.isArray(protectedManifest.files)) {
    throw new Error("Invalid canonical protected-runtime manifest.");
  }
  const names = new Set([
    projectFile("protected-runtime.json"),
    ...Object.keys(protectedManifest.files).map((name) => projectFile(validateRelativePath(name))),
    ...uiComponentFiles(pluginRoot),
    ...(await filesUnder(pluginRoot, "output_formats/html/docs/components")),
    ...(await filesUnder(pluginRoot, "skills/visualize-data/docs/react")),
    ...(await filesUnder(pluginRoot, "skills/visualize-data/docs/charts")),
    ...(await filesUnder(pluginRoot, "skills/visualize-data/src/inline")),
    ...(await filesUnder(pluginRoot, "output_formats/html/scripts/prebuilt/licenses")),
    ...(await filesUnder(pluginRoot, "output_formats/html/scripts/prebuilt/inline-source-parity")),
    ...RELEASE_INPUTS,
            "skills/visualize-data/src/ChartRenderer.jsx",
    ...(await filesUnder(pluginRoot, "skills/visualize-data/src/core")),
    ...(await filesUnder(pluginRoot, "skills/visualize-data/src/families")),
    ...(await filesUnder(pluginRoot, "skills/visualize-data/src/adapters")),
  ]);
  for (const required of [
    "src/prebuilt-runtime-entry.jsx",
    "src/data-app-worker.js",
    "src/styles.css",
    "src/data-app-styles.css",
    "src/print.css",
  ]) {
    if (!Object.hasOwn(protectedManifest.files, required)) {
      throw new Error(`Refresh the canonical protected runtime before rebuilding: ${required}`);
    }
  }
  const files = new Map();
  for (const name of [...names].sort()) files.set(name, await readRegularFile(pluginRoot, name));
  const buildInputs = sortedObject(Object.fromEntries([...files].map(([name, bytes]) => [name, sha256(bytes)])));
  for (const [name, hash] of Object.entries(protectedManifest.files)) {
    if (buildInputs[projectFile(name)] !== hash) {
      throw new Error(`Canonical protected runtime is stale: ${name}. Refresh it before rebuilding prebuilt assets.`);
    }
  }
  const sourcePackage = JSON.parse(files.get(projectFile("package.json")));
  const sourceLock = JSON.parse(files.get(projectFile("package-lock.json")));
  const packageJson = JSON.parse(files.get("output_formats/html/scripts/prebuilt/package.json"));
  const lock = JSON.parse(files.get("output_formats/html/scripts/prebuilt/package-lock.json"));
  validateReleaseLock(sourcePackage, sourceLock, packageJson, lock);
  return {
    pluginRoot,
    files,
    sourcePackage,
    sourceLock,
    packageJson,
    lock,
    buildInputs,
    source: {
      packageSha256: buildInputs[projectFile("package.json")],
      lockSha256: buildInputs[projectFile("package-lock.json")],
      protectedRuntimeSha256: sha256(protectedBytes),
      buildInputsSha256: sha256(JSON.stringify(buildInputs)),
    },
  };
}

/** Validate publisher-derived own export names without evaluating browser code. */
export function validateRuntimeModuleExports(value) {
  const keys = value && typeof value === "object" && !Array.isArray(value) ? Reflect.ownKeys(value) : null;
  if (
    !keys ||
    keys.some((key) => typeof key !== "string") ||
    !isDeepStrictEqual(keys.sort(), RUNTIME_MODULE_SPECIFIERS)
  )
    throw new Error("Invalid prebuilt runtime module export map.");
  const entries = [];
  for (const specifier of RUNTIME_MODULE_SPECIFIERS) {
    const names = value[specifier];
    if (!Array.isArray(names) || names.length < 1 || names.length > 1024) {
      throw new Error(`Invalid prebuilt runtime exports for ${specifier}.`);
    }
    let previous;
    for (let index = 0; index < names.length; index++) {
      const name = names[index];
      if (
        !Object.hasOwn(names, index) ||
        typeof name !== "string" ||
        !name ||
        name.length > 256 ||
        /[\u0000-\u001f\u007f]/u.test(name) ||
        (previous !== undefined && previous >= name)
      )
        throw new Error(`Invalid or unsorted prebuilt runtime export name for ${specifier}.`);
      previous = name;
    }
    if (!names.includes("default") || !names.includes("__esModule")) {
      throw new Error(`Prebuilt runtime exports lack interop names for ${specifier}.`);
    }
    entries.push([specifier, Object.freeze([...names])]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function validateAppMetadata(metadata) {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    !isDeepStrictEqual(Reflect.ownKeys(metadata), ["moduleExports"])
  ) {
    throw new Error("Invalid release-time app runtime metadata.");
  }
  return { moduleExports: validateRuntimeModuleExports(metadata.moduleExports) };
}

function validateInlineMetadata(metadata, canonicalModules = RECEIPT_CANONICAL_MODULES) {
  if (
    !metadata ||
    !isDeepStrictEqual(Object.keys(metadata).sort(), [
      "canonicalModules",
      "dynamicImports",
      "encodedTokens",
      "externalImports",
    ]) ||
    !isDeepStrictEqual(metadata.canonicalModules, canonicalModules) ||
    !isDeepStrictEqual(metadata.externalImports, []) ||
    !isDeepStrictEqual(metadata.dynamicImports, []) ||
    !Number.isSafeInteger(metadata.encodedTokens) ||
    metadata.encodedTokens < 0
  )
    throw new Error("Invalid release-time inline runtime diagnostics.");
  return structuredClone(metadata);
}

export function makeManifest(state, artifacts, { appMetadata, receiptMetadata } = {}) {
  if (!isDeepStrictEqual(Object.keys(artifacts).sort(), Object.keys(ARTIFACT_PATHS).sort())) {
    throw new Error("Prebuilt runtime must contain precisely the required artifacts.");
  }
  const verifiedAppMetadata = validateAppMetadata(appMetadata);
  return {
    format: MANIFEST_FORMAT,
    apiVersion: API_VERSION,
    source: state.source,
    buildInputs: state.buildInputs,
    artifacts: Object.fromEntries(
      Object.entries(ARTIFACT_PATHS).map(([name, path]) => {
        const bytes = Buffer.isBuffer(artifacts[name]) ? artifacts[name] : Buffer.from(artifacts[name]);
        return [
          name,
          {
            path,
            sha256: sha256(bytes),
            bytes: bytes.length,
            ...(name === "app" ? { metadata: verifiedAppMetadata } : {}),
            ...(name === "receipt" && receiptMetadata !== undefined
              ? { metadata: validateInlineMetadata(receiptMetadata, RECEIPT_CANONICAL_MODULES) }
              : {}),
          },
        ];
      }),
    ),
  };
}

export async function verifyAssets({
  pluginRoot = PLUGIN_ROOT,
  assetDir = join(pluginRoot, "assets/data-app-runtime"),
} = {}) {
  const manifest = JSON.parse(await readRegularFile(assetDir, "manifest.json"));
  const sourcePresent = await lstat(join(pluginRoot, "skills/visualize-data/src")).then(() => true, error => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  const state = sourcePresent ? await readSourceState(pluginRoot) : manifest;
  if (!sourcePresent) {
    if (sha256(JSON.stringify(sortedObject(manifest.buildInputs))) !== manifest.source.buildInputsSha256)
      throw new Error("Invalid installed build input inventory.");
    for (const [path, digest] of Object.entries(manifest.buildInputs)) {
      if (path.startsWith("skills/visualize-data/src/") || path === "skills/visualize-data/src/tools/dashboard.jsx") continue;
      if (sha256(await readRegularFile(pluginRoot, path.startsWith("skills/visualize-data/assets/") || path.startsWith("skills/visualize-data/scripts/runtime/")
        ? relative(pluginRoot, chartRuntimePath(pluginRoot, path.slice("skills/visualize-data/".length))) : path)) !== digest) throw new Error(`Stale installed build input: ${path}`);
    }
  }
  if (manifest.format !== MANIFEST_FORMAT || manifest.apiVersion !== API_VERSION) {
    throw new Error("Unsupported prebuilt Data runtime manifest.");
  }
  if (
    !isDeepStrictEqual(manifest.source, state.source) ||
    !isDeepStrictEqual(manifest.buildInputs, state.buildInputs)
  ) {
    throw new Error("Prebuilt Data runtime assets are stale; rebuild output_formats/html/scripts/prebuilt/build.mjs.");
  }
  const artifacts = {};
  for (const [name, filename] of Object.entries(ARTIFACT_PATHS)) {
    const entry = manifest.artifacts?.[name];
    if (entry?.path !== filename) throw new Error(`Invalid prebuilt artifact path: ${name}`);
    artifacts[name] = await readRegularFile(assetDir, filename);
  }
  const reconstructed = makeManifest(state, artifacts, {
        appMetadata: manifest.artifacts.app.metadata,
        receiptMetadata: manifest.artifacts.receipt.metadata,
      });
  if (!isDeepStrictEqual(manifest, reconstructed)) {
    throw new Error("Prebuilt Data runtime artifact integrity does not match its manifest.");
  }
  return manifest;
}
