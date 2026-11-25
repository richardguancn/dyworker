import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { prepareDataApp } from "./scripts/prepare-data-app.mjs";
import { dateLabel, reportScaffold } from "./report/scaffold.mjs";
import { resolveBrowserRuntime } from "./scripts/browser-runtime.mjs";

async function main() {
  const { values: v } = parseArgs({ options: {
    help: { type: "boolean", short: "h" }, output: { type: "string" }, snapshot: { type: "string" }, "prepared-on": { type: "string" },
    author: { type: "string" }, source: { type: "string", multiple: true }, chart: { type: "string" },
    blank: { type: "boolean" }, "from-reference": { type: "string" }, example: { type: "string" }, "component-kit": { type: "boolean" },
    "allow-draft": { type: "boolean" }, "legacy-starter": { type: "boolean" }, tsx: { type: "boolean" }, jsx: { type: "boolean" },
  } });
  if (v.help) {
    console.log(`Usage: node prepare-report.mjs --output /absolute/new-project --snapshot /path/to/reviewed.json
Writes the production JSX report composition in src/content/report/ReportContent.jsx by default.
Snapshot: use output_formats/html/README.md for reviewed rows, source identity, scope, definitions and evidence flow.
  --source QUERY_ID           Cite a reviewed query; repeat in first-citation order.
  --chart FILE               Add a standard chart: {queryId, config}. Rows come from that query.
  --prepared-on YYYY-MM-DD   Set the preparation date.
  --author NAME              Show a known author.
  --from-reference ID        Adapt a selected reference using --snapshot.
  --example ID [--allow-draft]  Preview a sample with its own data.
  --blank                    Start an explicitly blank report.
  --component-kit            Opt into the typed component kit.
  --legacy-starter           Compatibility alias for the default production starter.
  --tsx                      Opt into the component kit with a TypeScript body.
  --jsx                      Opt into the component kit with a checked JavaScript body.
  -h, --help                 Show this help without creating files.`);
    return;
  }
  if (!v.snapshot && !v.example && !v.blank) throw new Error("Supply --snapshot with reviewed data, or explicitly use --blank.");
  if ((v.example || v.blank || v["from-reference"]) && (v.source || v.chart || v.author || v["prepared-on"]))
    throw new Error("Source, chart and byline options require the default report scaffold or component kit.");
  const chart = v.chart ? JSON.parse(readFileSync(v.chart, "utf8")) : null;
  const now = new Date();
  const localDate = [now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
  const receipt = await prepareDataApp({ output: v.output, snapshot: v.snapshot, surface: "report",
    fromReference: v["from-reference"], example: v.example, allowDraft: v["allow-draft"], blank: v.blank,
    componentKit: v["component-kit"], legacyStarter: v["legacy-starter"], tsx: v.tsx, jsx: v.jsx,
    componentKitByline: { preparedOn: dateLabel(v["prepared-on"] ?? localDate), author: v.author, sources: v.source, chart },
    ...((v.source || v.chart || v.author || v["prepared-on"]) ? {
      makeReportContent: data => reportScaffold(data, { preparedOn: v["prepared-on"] ?? localDate, author: v.author, sources: v.source, chart }),
    } : {}) });
  if (receipt.finishScript) {
    receipt.finishCommand = [process.execPath, receipt.finishScript, "--project-dir", receipt.output];
    try {
      const { chromium, ...runtime } = await resolveBrowserRuntime();
      receipt.validationRuntime = { status: "resolved", ...runtime };
      receipt.finishCommand.push("--playwright-module", runtime.playwrightModule, "--browser-executable", runtime.browserExecutable);
    } catch (error) {
      receipt.validationRuntime = { status: "unavailable", code: error.code, message: error.message };
    }
  }
  console.log(JSON.stringify(receipt));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
