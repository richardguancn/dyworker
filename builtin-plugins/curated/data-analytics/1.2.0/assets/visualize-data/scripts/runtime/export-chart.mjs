#!/usr/bin/env node
import { readFile, lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { exportChart } from "../../src/tools/export.mjs";

let browser;
try {
  const usage = "Usage: node export-chart.mjs --input chart.json --output /absolute/chart.png [--width 960] [--appearance light|dark] [--playwright-module /existing/playwright/index.mjs] [--browser-executable /existing/chromium]\nExports the pinned CDN chart at 2x resolution using the existing workspace browser.";
  const { values } = parseArgs({ options: {
    help: { type: "boolean", short: "h" },
    input: { type: "string" }, output: { type: "string" }, width: { type: "string", default: "960" },
    appearance: { type: "string", default: "light" }, "playwright-module": { type: "string" }, "browser-executable": { type: "string" },
  } });
  if (values.help) { console.log(usage); process.exit(0); }
  if (!values.input || !values.output || !isAbsolute(values.output) || !values.output.endsWith(".png"))
    throw new Error(usage);
  const width = Number(values.width);
  if (!Number.isInteger(width) || width < 320 || width > 2400) throw new Error("Export width must be 320–2400 pixels.");
  const output = resolve(values.output);
  if (output.startsWith(fileURLToPath(new URL("../../../..", import.meta.url)))) throw new Error("Write the image outside the installed plugin.");
  const existing = await lstat(output).catch(error => { if (error.code !== "ENOENT") throw error; });
  if (existing?.isSymbolicLink()) throw new Error("Image output cannot be a symbolic link.");
  const input = await readFile(values.input);
  if (input.length > 2_000_000) throw new Error("Chart input exceeds 2 MB.");
  const config = JSON.parse(input);
  const require = createRequire(import.meta.url);
  let modulePath = values["playwright-module"] ?? process.env.DATA_CHART_PLAYWRIGHT_MODULE;
  if (!modulePath) {
    try { modulePath = require.resolve("playwright"); }
    catch { try { modulePath = require.resolve("playwright-core"); }
      catch { throw new Error("Use the existing workspace Playwright runtime via --playwright-module; no package install is needed."); } }
  }
  const playwright = await import(pathToFileURL(resolve(modulePath)));
  const { chromium } = playwright.default ?? playwright;
  if (!chromium?.launch) throw new Error("The selected Playwright module does not expose Chromium.");
  browser = await chromium.launch({ headless: true, executablePath: values["browser-executable"] ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  const page = await browser.newPage({ viewport: { width: width + 40, height: 1000 }, deviceScaleFactor: 2, colorScheme: values.appearance === "dark" ? "dark" : "light" });
  console.log(JSON.stringify(await exportChart(config, { page, output, width, appearance: values.appearance })));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await browser?.close(); }
