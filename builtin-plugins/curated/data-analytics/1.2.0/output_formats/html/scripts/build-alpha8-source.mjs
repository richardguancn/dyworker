import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chartRuntimePath } from "../../../scripts/plugin-paths.mjs";
import { PLUGIN_ROOT } from "./prebuilt/manifest.mjs";

// Load the same project-local Vite installation verified by the source-build CLI.
const vite = createRequire(process.argv[2]).resolve("vite");
const { build } = await import(pathToFileURL(vite));
const charting = join(PLUGIN_ROOT, "output_formats/html/src/charting");
await build({ resolve: { alias: [
  { find: "@openai/data-charts/chart.css", replacement: join(charting, "hosted-chart.css") },
  { find: "@openai/data-charts", replacement: join(charting, "HostedChart.jsx") },
  { find: "@openai/data-chart-pin", replacement: chartRuntimePath(PLUGIN_ROOT, "assets/cdn.json") },
] } });
