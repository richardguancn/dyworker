#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { documentSnapshot } from "../../../skills/publish-artifact-to-sites/scripts/publication-assets.mjs";
import { selectDateRange, selectFilter, verifyNumberedCitation, verifyReportSection, withSourcePanel } from "./report-checks.mjs";
import { assertPreviewBuild, servePreview } from "./preview/worker.mjs";
import { exportOfflineDataApp, SEPARATE_BUILD_MANIFEST } from "./data-app-separate.mjs";
import { resolveBrowserRuntime } from "./browser-runtime.mjs";

// Read the surface from the same build we hand off, even when the author supplies only custom checks.
function isReportBuild(html) {
  const { embedded, snapshotChunks } = documentSnapshot(html.toString("utf8"));
  return Boolean(embedded && JSON.parse(snapshotChunks?.join("") ?? embedded).surface === "report");
}

// Verify a report in its portable file, including when it only has custom checks.
// No persistent service, browser installation, or detached listener is created.
export async function verifyDataApp({ projectDir, checks, reportSection, finishReport, port, output, playwrightModule, browserExecutable, browserRuntime }) {
  const projectRoot = await realpath(projectDir);
  await assertPreviewBuild(projectRoot);
  const htmlPath = join(projectRoot, "dist/index.html");
  const html = await readFile(htmlPath);
  const htmlSha256 = createHash("sha256").update(html).digest("hex");
  const chosenPort = Number(port ?? process.env.EVAL_LAB_PREVIEW_PORT ?? process.env.DATA_APP_PREVIEW_PORT ?? 4173);
  const script = checks ? await import(pathToFileURL(resolve(checks)).href) : {};
  if ((checks || (!reportSection && !finishReport)) && typeof script.verify !== "function") throw new Error("Checks must export async function verify({ page, output }).");
  const runtime = browserRuntime ?? await resolveBrowserRuntime({ playwrightModule, browserExecutable });
  const evidence = resolve(output ?? join(projectRoot, ".data-app-qa"));
  await mkdir(evidence, { recursive: true });
  const exportHandoff = () => existsSync(join(projectRoot, "dist", SEPARATE_BUILD_MANIFEST))
    ? exportOfflineDataApp({ projectDir: projectRoot }) : { htmlPath, htmlSha256 };
  const report = (reportSection || isReportBuild(html)) ? await exportHandoff() : null;
  const server = report ? null : await servePreview({ version: 1, id: htmlSha256, projectRoot, port: chosenPort });
  const url = report ? pathToFileURL(report.htmlPath).href : `http://127.0.0.1:${chosenPort}/`;
  // The report can mount while external chart assets are still loading. Start
  // its shared readiness window at the usable app, not at the window load event.
  const navigation = { waitUntil: finishReport ? "domcontentloaded" : "load", timeout: 10000 };
  let browser;
  const errors = [], observations = [];
  try {
    browser = await runtime.chromium.launch({ executablePath: runtime.browserExecutable, headless: true, timeout: 15000 });
    const checkWidth = async width => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        // Optional routes are useful when the host supplies an authenticated
        // local runtime cache. Ordinary authors need only export verify.
        await script.setup?.({ context });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on("pageerror", error => errors.push({ width, message: error.message }));
        await page.goto(url, navigation);
        await page.locator("main").waitFor();
        if (report && await page.locator(".dashboard-authoring-status .dashboard-authoring-spinner").count()) {
          throw new Error('The exported report is still being authored. Finish the content, set buildStatus to "complete" in src/data.json, then rebuild with --check --separate-data before verifying the handoff.');
        }
        const finished = finishReport && await (await import("./report-finish-checks.mjs")).inspectFinishedReport(page, finishReport);
        const observation = { width, ...(await script.verify?.({ page, width, output: evidence,
          withSource: (trigger, inspect) => withSourcePanel(page, trigger, inspect),
          selectDateRange: options => selectDateRange(page, options),
          selectFilter: options => selectFilter(page, options),
        })), ...(finished && { charts: finished.charts }) };
        await page.screenshot({ path: join(evidence, `${report ? "report" : "dashboard"}-${width}.png`), fullPage: true });
        const section = reportSection ?? finished?.sectionId;
        if (section || finishReport) {
          if (script.verify) {
            await page.goto(url, navigation);
            await page.locator("main").waitFor();
          }
          observation.report = section ? await verifyReportSection(page, section) : { numberedCitation: await verifyNumberedCitation(page) };
        }
        return observation;
      } finally { await context.close(); }
    };
    if (finishReport && !script.verify) {
      // Built-in probes use isolated browser contexts. Caller scripts can share
      // files or mutable state across widths; preserve their sequential order.
      const results = await Promise.allSettled([1280, 390].map(checkWidth));
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
        observations.push(result.value);
      }
    } else {
      for (const width of [1280, 390]) observations.push(await checkWidth(width));
    }
    if (errors.length) throw new Error(`Browser errors: ${JSON.stringify(errors)}`);
    // Reuse the established verified export for local handoff. A separate-data
    // build needs HTTP for its sidecar; the export embeds that exact snapshot.
    const delivered = report ?? await exportHandoff();
    return { projectRoot, ...delivered, buildHtmlPath: htmlPath, buildHtmlSha256: htmlSha256,
      checks: "passed", observations, preview: server ? "stopped" : "not-started",
      reference: `[Open the ${report ? "report" : "dashboard"}](${delivered.htmlPath})`, evidence,
      screenshots: observations.map(({ width }) => join(evidence, `${report ? "report" : "dashboard"}-${width}.png`)) };
  } finally {
    try { await browser?.close(); }
    finally {
      if (server) {
        server.closeAllConnections();
        await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
      }
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { "project-dir": { type: "string" }, checks: { type: "string" }, "report-section": { type: "string" },
      port: { type: "string" }, output: { type: "string" }, help: { type: "boolean", short: "h" } } });
    if (values.help) console.log("Usage: node data-app-verify.mjs --project-dir /absolute/app [--checks /absolute/checks.mjs] [--report-section ID] [--port 4173] [--output /absolute/evidence]");
    else {
      if (!values["project-dir"] || (!values.checks && !values["report-section"]))
        throw new Error("Provide --project-dir and either --checks or --report-section.");
      console.log(JSON.stringify(await verifyDataApp({ projectDir: values["project-dir"], reportSection: values["report-section"], ...values })));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
