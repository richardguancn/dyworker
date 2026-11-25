#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { validateChartConfig, PAGE_MAX_BYTES, INLINE_MAX_BYTES } from "../../src/tools/config.mjs";
import { readChartAsset } from "../../src/tools/assets.mjs";

try {
  const usage = "Usage: node check-chart.mjs chart.json|chart.html|- [--surface inline|page|html]\nChecks payloads and HTML structure offline; rendering is not checked.";
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { help: { type: "boolean", short: "h" }, surface: { type: "string", default: "inline" } } });
  if (values.help) { console.log(usage); process.exit(0); }
  if (positionals.length !== 1) throw new Error(usage);
  if (!["inline", "page", "html"].includes(values.surface)) throw new Error("Choose inline, page, or html.");
  const source = positionals[0] === "-" ? await text(process.stdin) : await readFile(positionals[0], "utf8");
  if (positionals[0].endsWith(".json")) {
    const checked = validateChartConfig(JSON.parse(source));
    console.log(JSON.stringify({ status: "passed", charts: checked.charts?.length ?? 1, rendering: "not-checked" }));
  } else {
    const max = values.surface === "page" ? PAGE_MAX_BYTES : INLINE_MAX_BYTES;
    if (Buffer.byteLength(source) > max) throw new Error(`HTML exceeds the ${max}-byte ${values.surface} limit.`);
    await readChartAsset("chart-check.mjs");
    await readChartAsset("chart_structure.py");
    const { checkFragment } = await import("../../assets/chart-check.mjs");
    const pin = JSON.parse(await readFile(new URL("../../assets/cdn.json", import.meta.url), "utf8"));
    console.log(JSON.stringify(checkFragment(source, pin)));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
