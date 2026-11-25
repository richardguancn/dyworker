import { parseArgs } from "node:util";
import { prepareDataApp } from "./scripts/prepare-data-app.mjs";
async function main() {
  const { values: v } = parseArgs({ options: { help: {type:"boolean", short:"h"}, output: {type:"string"}, snapshot: {type:"string"},
    "from-reference": {type:"string"}, example: {type:"string"}, blank: {type:"boolean"}, "allow-draft": {type:"boolean"}, "component-kit": {type:"boolean"}, "legacy-starter": {type:"boolean"}, tsx: {type:"boolean"}, jsx: {type:"boolean"} } });
  if (v.help) {
    console.log(`Usage: node prepare-dashboard.mjs --output /absolute/new-project --snapshot /path/to/reviewed.json
Writes the production JSX dashboard composition in src/content/dashboard/DashboardContent.jsx by default.
  --from-reference ID        Adapt a selected reference using --snapshot.
  --example ID [--allow-draft]  Preview a sample with its own data.
  --blank                    Start an explicitly blank dashboard.
  --component-kit            Opt into the typed component kit.
  --legacy-starter           Compatibility alias for the default production starter.
  --tsx                      Opt into the component kit with a TypeScript body.
  --jsx                      Opt into the component kit with a checked JavaScript body.
  -h, --help                 Show this help without creating files.`);
    return;
  }
  console.log(JSON.stringify(await prepareDataApp({ output: v.output, surface: "dashboard", snapshot: v.snapshot,
    fromReference: v["from-reference"], example: v.example, blank: v.blank, allowDraft: v["allow-draft"], componentKit: v["component-kit"], legacyStarter: v["legacy-starter"], tsx: v.tsx, jsx: v.jsx })));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
