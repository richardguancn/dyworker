#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildPrebuiltDataApp } from "./scripts/data-app-build.mjs";
import { verifyDataApp } from "./scripts/data-app-verify.mjs";
import { assertHydratedPublicationSource } from "./scripts/data-app-separate.mjs";
import { readRegularFile } from "./scripts/prebuilt/manifest.mjs";
import { resolveBrowserRuntime } from "./scripts/browser-runtime.mjs";

const help = `Finish an authored HTML report: checked build, export, desktop and phone verification.
Usage: node finish-report.mjs --project-dir /absolute/report [--report-section ID] [--chart ID ...]
  --chart ID         Require this standard chart to be present. All standard charts are checked.
  --checks FILE      Extra async verify({page, width, output}) for authored interactions.
  --custom-chart ID  Delegate this nonstandard plot to --checks.
  --output FILE.html Write the checked HTML to this filename.
  --evidence-dir DIR Save browser screenshots and observations here.
  --playwright-module FILE  Use the host's supplied Playwright module.
  --browser-executable FILE Use the host's supplied Chromium executable.
  --preflight        Resolve the browser runtime without building or changing a report.
Uses the supplied Chromium and Playwright runtime. Returns htmlPath, hash and screenshots.`;

async function fileInfo(path) {
  return lstat(path).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
}

async function destinations(root, output, evidenceDir) {
  const html = output && /\.html?$/i.test(resolve(output)) ? resolve(output) : undefined;
  if (output && !html && evidenceDir) throw new Error("Choose one evidence directory; --output FILE.html is the report.");
  // Existing callers use --output DIR for verifier evidence.
  const evidence = resolve(evidenceDir ?? (html ? undefined : output) ?? join(root, ".data-app-qa"));
  if (/\.html?$/i.test(evidence) || (html && evidence.startsWith(html + sep)))
    throw new Error("Choose a directory for evidence, separate from the output HTML.");
  const existingEvidence = await fileInfo(evidence);
  if (existingEvidence && !existingEvidence.isDirectory()) throw new Error("The browser evidence path must be a directory.");
  if (html) {
    if (output.endsWith(sep)) throw new Error("Provide an output HTML filename without a trailing slash.");
    const existing = await fileInfo(html);
    if (existing && !existing.isFile()) throw new Error("The output HTML must be a regular file, not a directory or symlink.");
    const parent = await stat(dirname(html));
    if (!parent.isDirectory()) throw new Error("The parent of the output HTML must be a directory.");
    const part = relative(root, join(await realpath(dirname(html)), basename(html))).split(sep)[0];
    if (part === "index.html" || ["src","dist","node_modules"].includes(part) || part.startsWith(".data-app"))
      throw new Error("Choose an output HTML outside the project's source and build files.");
  }
  return { html, evidence };
}

export async function deliverVerifiedFile(result, html) {
  if (!html) return result;
  const bytes = await readFile(result.htmlPath);
  if (createHash("sha256").update(bytes).digest("hex") !== result.htmlSha256)
    throw new Error("The checked HTML changed before delivery.");
  const tmp = await mkdtemp(join(dirname(html), ".report-"));
  try {
    const staged = join(tmp, "report.html");
    await writeFile(staged, bytes);
    const previous = await fileInfo(html);
    if (previous && !previous.isFile()) throw new Error("The output HTML must be a regular file, not a directory or symlink.");
    if (previous) await chmod(staged, previous.mode & 0o777);
    await rename(staged, html);
  } finally { await rm(tmp, { recursive: true, force: true }); }
  return { ...result, htmlPath: html, reference: `[Open the report](${html})` };
}

// Preserve the reviewed snapshot byte-for-byte apart from its top-level status.
// This avoids reserializing user data, including numeric literals and SQL.
function completedSnapshot(raw, snapshot) {
  if (snapshot.buildStatus === "complete") return raw;
  if (snapshot.buildStatus === undefined) return raw.replace("{", '{"buildStatus":"complete",');
  if (typeof snapshot.buildStatus !== "string") throw new Error("The report needs a valid buildStatus.");
  let depth = 0;
  for (const token of raw.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]]/g)) {
    const t = token[0];
    if (t === "{" || t === "[") depth++;
    else if (t === "}" || t === "]") depth--;
    else if (depth === 1 && JSON.parse(t) === "buildStatus") {
      const offset = token.index + t.length, value = /^(\s*:\s*)"(?:\\[\s\S]|[^"\\])*"/.exec(raw.slice(offset));
      if (value) return raw.slice(0, offset) + value[1] + '"complete"' + raw.slice(offset + value[0].length);
    }
  }
  throw new Error("Unable to update the report's build status.");
}

export async function finishReport({ projectDir, reportSection, chartIds = [], customChartIds = [], checks,
  output, evidenceDir, playwrightModule, browserExecutable }) {
  if (customChartIds.length && !checks) throw new Error("--custom-chart requires --checks for the authored plot.");
  const root = await realpath(projectDir), file = join(root, "src/data.json");
  const destination = await destinations(root, output, evidenceDir);
  assertHydratedPublicationSource(root);
  const raw = (await readRegularFile(root, "src/data.json")).toString("utf8"), snapshot = JSON.parse(raw);
  if (snapshot.surface !== "report") throw new Error("finish-report requires a report project.");
  // Fail before rebuilding when the host cannot run visual verification.
  const browserRuntime = await resolveBrowserRuntime({ playwrightModule, browserExecutable });
  const complete = completedSnapshot(raw, snapshot);
  try {
    if (raw !== complete) await writeFile(file, complete);
    await buildPrebuiltDataApp({ projectDir: root, separateData: true, check: true, onProgress: message => console.error(message) });
    const verified = await verifyDataApp({ projectDir: root, reportSection, checks, output: destination.evidence, browserRuntime,
      finishReport: { chartIds, customChartIds } });
    return await deliverVerifiedFile(verified, destination.html);
  } catch (error) {
    // A failed first handoff leaves a draft editable. Never undo an author edit
    // that arrived while the browser was open.
    if (raw !== complete && (await readFile(file, "utf8")) === complete) await writeFile(file, raw);
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { "project-dir": { type: "string" }, "report-section": { type: "string" },
      chart: { type: "string", multiple: true }, "custom-chart": { type: "string", multiple: true },
      checks: { type: "string" }, output: { type: "string" }, "evidence-dir": { type: "string" },
      "playwright-module": { type: "string" }, "browser-executable": { type: "string" }, preflight: { type: "boolean" },
      help: { type: "boolean", short: "h" } } });
    if (values.help) console.log(help);
    else if (values.preflight) {
      const { chromium, ...runtime } = await resolveBrowserRuntime({ playwrightModule: values["playwright-module"], browserExecutable: values["browser-executable"] });
      console.log(JSON.stringify({ status: "ready", ...runtime }));
    }
    else {
      if (!values["project-dir"]) throw new Error(help);
      console.log(JSON.stringify(await finishReport({ projectDir: values["project-dir"], reportSection: values["report-section"],
        chartIds: values.chart, customChartIds: values["custom-chart"], checks: values.checks, output: values.output, evidenceDir: values["evidence-dir"],
        playwrightModule: values["playwright-module"], browserExecutable: values["browser-executable"] })));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
