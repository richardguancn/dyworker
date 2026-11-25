#!/usr/bin/env node
import { readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { renderChart } from "../../src/tools/render.mjs";

try {
  const usage = "Usage: node render-chart.mjs --input chart.json --output chart.html [--surface inline|page|html] [--appearance auto|light|dark]\nPaths resolve from the working directory; the receipt returns an absolute output path. All surfaces use the pinned chart CDN.";
  const { values } = parseArgs({ options: {
    help: { type: "boolean", short: "h" },
    input: { type: "string" }, output: { type: "string" }, surface: { type: "string", default: "inline" },
    appearance: { type: "string", default: "auto" },
  } });
  if (values.help) { console.log(usage); process.exit(0); }
  if (!values.input || !values.output)
    throw new Error(usage);
  const output = resolve(values.output);
  const plugin = fileURLToPath(new URL("../../../..", import.meta.url));
  if (output.startsWith(plugin)) throw new Error("Write chart output outside the installed plugin.");
  const stat = await lstat(output).catch(error => { if (error.code !== "ENOENT") throw error; });
  if (stat?.isSymbolicLink()) throw new Error("Chart output cannot be a symbolic link.");
  const source = await readFile(values.input);
  if (source.length > 2_000_000) throw new Error("Chart input exceeds 2 MB.");
  const { html, chartApiVersion: _legacyProtocol, ...result } = await renderChart(JSON.parse(source), values);
  const { version: chartVersion } = JSON.parse(await readFile(new URL("../../assets/cdn.json", import.meta.url), "utf8"));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html, { mode: 0o600 });
  console.log(JSON.stringify({ path: output, ...result, chartVersion, validation: "payload-checked", rendering: "not-checked", ...(values.surface === "inline" ? { reference: `visualize${JSON.stringify({ path: output })}` } : {}) }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
