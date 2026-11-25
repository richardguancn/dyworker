#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { dataAppThemes } from "../../../../output_formats/html/src/theme-presets.js";
import { canonicalInlinePath, isInside } from "./sources-runtime.mjs";
import {
  assertReplacementSafe,
  inlineJson,
  MAX_INLINE_FRAGMENT_BYTES,
} from "./sources-common.mjs";

const htmlAttribute = (value) =>
  value.replace(
    /[&<>"'$]/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
        $: "&#36;",
      })[character],
  );

export async function loadInlineTheme(id, { pluginRoot, themeCssPath }) {
  const preset = dataAppThemes.find((theme) => theme.id === id);
  if (!themeCssPath && (!preset || id === "original")) throw new Error(`Unknown bundled Data theme: ${id}`);
  const path = themeCssPath ? resolve(themeCssPath) : join(pluginRoot, "output_formats/html/themes", id, "theme.css");
  const css = await readFile(path, "utf8");
  if (Buffer.byteLength(css) > 100_000 || /@import\b|@font-face\b|\burl\s*\(|\bexpression\s*\(/iu.test(css)) {
    throw new Error("Inline themes must be local token stylesheets without external resources (maximum 100 KB).");
  }
  const declaredScheme = css.match(/--fixed-theme-scheme\s*:\s*(light|dark)\s*[;}]/iu)?.[1]?.toLowerCase();
  const fixedScheme = declaredScheme || (!themeCssPath && preset?.darkOnly ? "dark" : undefined);
  return { id: themeCssPath ? "original" : id, css, ...(fixedScheme ? { fixedScheme } : {}) };
}

/** The renderer and release capacity gate must measure the same complete fragment. */
export function assembleInlineFragment({ normalized, theme, runtimeCode, template, title = normalized.component?.title ?? "Sources" }) {
  // The normalized inspector and chart share the same reviewed rows. Serialize
  // that array once; the mount restores the inspector reference without copying it.
  const query = normalized.query && normalized.query.rows === normalized.rows
    ? Object.fromEntries(Object.entries(normalized.query).filter(([key]) => key !== "rows"))
    : normalized.query;
  const serialized = inlineJson({ ...normalized, query, theme });
  const rootId = `data-inline-${createHash("sha256").update(serialized).digest("hex").slice(0, 16)}`;
  const replacements = {
    ROOT_ID: rootId,
    TITLE: htmlAttribute(title),
    PAYLOAD: serialized,
    RUNTIME: runtimeCode,
  };
  const fragment = template.replace(/__INLINE_(ROOT_ID|TITLE|PAYLOAD|RUNTIME)__/gu, (_, key) => replacements[key]);
  assertReplacementSafe(fragment);
  const bytes = Buffer.byteLength(fragment);
  if (bytes > MAX_INLINE_FRAGMENT_BYTES) {
    throw new Error(
      `Inline chart is ${bytes} bytes (limit ${MAX_INLINE_FRAGMENT_BYTES}). Aggregate rows, remove unneeded preview columns or source detail, and retry.`,
    );
  }
  return { fragment, bytes, rootId };
}

export async function inlineOutputPath(output, pluginRoot) {
  if (typeof output !== "string" || !isAbsolute(output) || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.html$/u.test(basename(output)))
    throw new Error("Choose an explicit output path with a lowercase-hyphenated .html filename.");
  const path = join(await canonicalInlinePath(dirname(output)), basename(output));
  if (isInside(pluginRoot, path)) throw new Error("Write inline output outside the installed Data plugin.");
  return path;
}

export async function writeInlineOutput(requestedOutput, fragment, { pluginRoot, legacyCacheDir }) {
  if (isInside(legacyCacheDir, requestedOutput))
    throw new Error("Reviewed data must not be written into the shared renderer cache.");
  await mkdir(dirname(requestedOutput), { recursive: true });
  const outputPath = join(await realpath(dirname(requestedOutput)), basename(requestedOutput));
  if (isInside(pluginRoot, outputPath) || isInside(legacyCacheDir, outputPath))
    throw new Error("Output resolves inside a read-only source or shared cache.");
  try {
    if ((await lstat(outputPath)).isSymbolicLink()) throw new Error("Refusing to overwrite a symlinked inline output.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = `${outputPath}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, fragment, { mode: 0o600 });
    await rename(temporary, outputPath);
  } finally {
    await rm(temporary, { force: true });
  }
  return outputPath;
}
