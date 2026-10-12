import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

import { resolveChromiumExecutable } from "./browser-helpers.mjs";
import { exportOfflineDataApp, readSeparateDataBundle } from "../scripts/data-app-separate.mjs";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const template = join(pluginRoot, "templates/data-app/base"), project = mkdtempSync(join(tmpdir(), "data-app-separate-browser-"));
let browser;

async function verifyHostedStreaming(page, snapshot) {
  await page.evaluate((reviewed) => {
    const runtime = globalThis.CodexDataAppRuntime;
    const originalFetch = globalThis.fetch;
    const rootElement = document.createElement("div");
    rootElement.id = "streaming-hosted-test";
    document.body.append(rootElement);
    const state = globalThis.hostedStreamingTest = { captures: [], requests: [], aborts: 0 };
    globalThis.fetch = async (input, options) => {
      const endpoint = String(input);
      if (!["/api/snapshot", "/api/presentation"].includes(endpoint)) return originalFetch(input, options);
      state.requests.push(endpoint);
      const response = new Response(new ReadableStream({ start(controller) {
        state[endpoint === "/api/snapshot" ? "snapshot" : "presentation"] = controller;
        options.signal.addEventListener("abort", () => { state.aborts++; controller.error(options.signal.reason); }, { once: true });
      } }));
      if (endpoint === "/api/snapshot") {
        response.json = response.text = () => { throw new Error("Whole snapshot string parsing is forbidden"); };
      }
      return response;
    };
    const root = runtime.mount({ element: rootElement, hosted: true,
      reviewedSnapshot: { queries: {} }, createContent(value) {
        state.captures.push({ rows: value.queries.q.rows.length, text: value.queries.q.rows[0].text });
        const Content = () => runtime.modules.react.createElement("h2", {},
          `${runtime.publicApi.useDataApp().appTitle}: ${value.queries.q.rows.length} complete rows`);
        return { DashboardContent: Content, ReportContent: Content };
      } });
    state.writeSnapshot = (text) => {
      const bytes = new TextEncoder().encode(text);
      for (let offset = 0; offset < bytes.length; offset += 7) state.snapshot.enqueue(bytes.subarray(offset, offset + 7));
    };
    state.writeReviewed = () => state.writeSnapshot(JSON.stringify(reviewed));
    state.completePresentation = () => {
      state.presentation.enqueue(new TextEncoder().encode(JSON.stringify({
        canEdit: false, presentation: { title: "Saved hosted title" }, revision: 4,
      })));
      state.presentation.close();
    };
    state.dispose = () => { root.unmount(); globalThis.fetch = originalFetch; rootElement.remove(); };
  }, { ...snapshot, id: "streaming-hosted-test", queries: { q: { ...snapshot.queries.q,
    rows: snapshot.queries.q.rows.map((row, index) => index ? row : { ...row, text: "café 日本語 🧪" }) } } });
  const root = page.locator("#streaming-hosted-test");
  await root.getByText("Loading Data app…", { exact: true }).waitFor();
  await page.waitForFunction(() => globalThis.hostedStreamingTest.requests.length === 2);
  await page.evaluate(() => globalThis.hostedStreamingTest.writeReviewed());
  assert.deepEqual(await page.evaluate(() => globalThis.hostedStreamingTest.captures), [], "Authored code waits for the full response body to end");
  await page.evaluate(() => globalThis.hostedStreamingTest.snapshot.close());
  assert.deepEqual(await page.evaluate(() => globalThis.hostedStreamingTest.captures), [], "Authored code also waits for presentation");
  await page.evaluate(() => globalThis.hostedStreamingTest.completePresentation());
  await root.getByRole("heading", { name: "Saved hosted title: 10001 complete rows", exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => globalThis.hostedStreamingTest.captures), [{ rows: 10001, text: "café 日本語 🧪" }]);
  assert.equal(await root.getByRole("button", { name: "Edit text and layout", exact: true }).count(), 0);
  await page.evaluate(() => globalThis.hostedStreamingTest.dispose());
}

try {
  cpSync(template, project, { recursive: true, filter: path => !["node_modules", "dist", "examples"].some(name => path === join(template, name) || path.startsWith(`${join(template, name)}/`)) });
  const snapshot = { ...JSON.parse(readFileSync(join(project, "src/data.json"))), id: "separate-test", title: "Separate test", buildStatus: "complete",
    queries: { q: { rows: Array.from({ length: 10001 }, (_, value) => ({ value: value + 42 })), columns: [{ name: "value", type: "number" }] } } };
  writeFileSync(join(project, "src/data.json"), JSON.stringify(snapshot));
  writeFileSync(join(project, "src/content/dashboard/DashboardContent.jsx"), `
import React, { useState } from "react";
import snapshot from "../../data.json";
import { useDataApp } from "../../data-app-public.jsx";
const captured = snapshot.queries.q.rows[0].value;
const total = snapshot.queries.q.rows.length;
export function DashboardContent() {
  const [clicks, setClicks] = useState(0);
  const { appTitle, setAppTitle } = useDataApp();
  return <section><h1>Captured {captured} from {total} rows</h1><p>{appTitle}</p>
    <button onClick={() => setClicks(clicks + 1)}>Count {clicks}</button>
    <button onClick={() => setAppTitle("Updated dashboard")}>Change title</button></section>;
}`);
  const build = spawnSync(process.execPath, [join(pluginRoot, "scripts/data-app.mjs"), "build", "--project-dir", project, "--separate-data"],
    { encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const bundle = readSeparateDataBundle({ projectDir: project });
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const page = await browser.newPage(), errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const fetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const response = await fetch(...args);
      if (/snapshot\.[a-f\d]+\.json$/u.test(response.url)) {
        response.json = response.text = () => { throw new Error("Local reviewed data must use the shared streaming reader"); };
      }
      return response;
    };
  });
  let release;
  const gate = new Promise(resolveGate => { release = resolveGate; });
  await page.route("http://localhost:18364/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    requests.push(pathname);
    if (pathname === `/${bundle.manifest.snapshot.path}`) {
      await gate;
      return route.fulfill({ contentType: "application/json", body: readFileSync(bundle.snapshotPath) });
    }
    return route.fulfill({ contentType: "text/html", body: bundle.htmlBytes });
  });
  await page.goto("http://localhost:18364/", { waitUntil: "domcontentloaded" });
  await page.getByText("Loading data…", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  release();
  await page.getByRole("heading", { name: "Captured 42 from 10001 rows", exact: true }).waitFor();
  await page.getByRole("button", { name: "Count 0", exact: true }).click();
  await page.getByRole("button", { name: "Change title", exact: true }).click();
  await page.getByRole("button", { name: "Count 1", exact: true }).waitFor();
  assert.equal(requests.filter(path => path === `/${bundle.manifest.snapshot.path}`).length, 1);
  assert.equal(requests.some(path => path.startsWith("/api/")), false);
  await verifyHostedStreaming(page, snapshot);
  const exported = await exportOfflineDataApp({ projectDir: project });
  const offline = await browser.newPage(), offlineRequests = [];
  offline.on("pageerror", error => errors.push(error.message));
  offline.on("request", request => { if (/^https?:/u.test(request.url())) offlineRequests.push(request.url()); });
  await offline.goto(pathToFileURL(exported.htmlPath).href);
  await offline.getByRole("heading", { name: "Captured 42 from 10001 rows", exact: true }).waitFor();
  assert.deepEqual(offlineRequests, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "passed", rows: 10001, checks: ["real separate prebuilt build", "delayed local streaming data fetch", "complete module-scope capture", "one immutable snapshot request", "state preserved on title edit", "streaming hosted UTF-8 data and presentation gating", "hosted viewer remains read-only", "standalone file export without network"] }));
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
