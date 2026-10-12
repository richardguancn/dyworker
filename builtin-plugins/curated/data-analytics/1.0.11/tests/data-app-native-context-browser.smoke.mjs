import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { presentationStorageKey } from "../templates/data-app/base/src/presentation-state.js";
import { installDashboardBrowserMocks, resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(pluginRoot, "templates/data-app/base");
const project = realpathSync(mkdtempSync(join(tmpdir(), "data-linked-context-browser-")));
const threadId = "550e8400-e29b-41d4-a716-446655440000";
const snapshot = { ...JSON.parse(readFileSync(join(template, "src/data.json"), "utf8")),
  id: "dashboard:linked-context-browser", title: "Linked context QA", buildStatus: "complete" };
const requests = [], failures = [];
const previewUrl = "http://127.0.0.1:4173/";
let browser;
function build(value) {
  writeFileSync(join(project, "src/data.json"), `${JSON.stringify(value, null, 2)}\n`);
  const result = runDataAppFixtureBuild(project, {
    pluginRoot, env: { ...process.env, CODEX_SESSION_ID: threadId, CODEX_THREAD_ID: threadId },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}
const navigation = page => page.evaluate(() => window.__dashboardDeepLinks);
async function open(page) {
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Publish dashboard", exact: true });
  await dialog.waitFor();
  return dialog;
}
async function close(dialog) {
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}
async function readHandoff(dialog, audience) {
  const href = await dialog.getByRole("link", { name: "Publish in ChatGPT", exact: true }).getAttribute("href");
  const url = new URL(href);
  assert.equal(`${url.protocol}//${url.host}${url.pathname}`, `codex://threads/${threadId}`);
  assert.deepEqual([...url.searchParams.keys()], ["prompt", "browserUrl"]);
  const prompt = url.searchParams.get("prompt"), viewUrl = url.searchParams.get("browserUrl");
  assert.ok(prompt.length < 700);
  assert.match(prompt, audience === "custom" ? /limited to me/ : /workspace members with the link/);
  assert.doesNotMatch(prompt, /Current presentation|Generated at|Data app ID|"filters"|"textEdits"/u);
  assert.ok(prompt.includes(`](<${viewUrl}>)`));
  assert.match(prompt, /read its current Data app context/u);
  const parsed = new URL(viewUrl);
  assert.equal(parsed.origin, new URL(previewUrl).origin);
  assert.equal(parsed.searchParams.get("view"), "1");
  return { href, viewUrl, prompt };
}
const readContext = page => page.evaluate(() => window.__contextTools.get("get_data_app_context").execute({}));
try {
  cpSync(template, project, { recursive: true, filter: path => !path.includes("/node_modules") && !path.includes("/dist") });
  build(snapshot);
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(6000);
  page.on("pageerror", error => failures.push(error.message));
  page.on("request", request => { if (request.method() !== "GET") requests.push({ method: request.method(), url: request.url() }); });
  await installDashboardBrowserMocks(page);
  // Serve the portable compiled HTML unchanged, matching the other browser fixtures.
  await page.route(`${previewUrl}**`, route => route.fulfill({
    contentType: "text/html", body: readFileSync(join(project, "dist/index.html"), "utf8"),
  }));
  await page.addInitScript(() => {
    window.__contextTools = new Map();
    Object.defineProperty(document, "modelContext", { configurable: true, value: {
      registerTool(tool, { signal } = {}) {
        if (signal?.aborted) return;
        window.__contextTools.set(tool.name, tool);
        signal?.addEventListener("abort", () => {
          if (window.__contextTools.get(tool.name) === tool) window.__contextTools.delete(tool.name);
        }, { once: true });
      },
    } });
  });
  await page.goto(previewUrl, { waitUntil: "load" });
  await page.locator(".dashboard-topbar-title").waitFor();
  assert.equal(await page.locator('meta[name="data-app-local-reference"], meta[name="data-app-publish-capture"]').count(), 0,
    "A standard static preview must not inject project paths or capture metadata");
  assert.equal(await page.locator('meta[name="data-app-local-thread"]').getAttribute("content"), threadId);
  const initialContext = await readContext(page);
  assert.deepEqual(initialContext.dataAppReference, {}, "Local project paths require separately verified task context");
  assert.equal(initialContext.artifact.id, snapshot.id);
  assert.equal(initialContext.viewUrl, `${previewUrl}?view=1&tab=dashboard`);
  assert.equal(JSON.stringify(initialContext).includes(project), false);
  let dialog = await open(page);
  assert.deepEqual(await navigation(page), []);
  const first = await readHandoff(dialog, "custom");
  assert.equal((await readContext(page)).presentation.title, snapshot.title);
  const link = dialog.getByRole("link", { name: "Publish in ChatGPT", exact: true });
  await link.evaluate(element => { element.click(); element.click(); });
  assert.deepEqual(await navigation(page), [first.href], "Synchronous repeated clicks open only once");
  assert.equal(await dialog.getByRole("link", { name: "Waiting for ChatGPT…", exact: true }).getAttribute("aria-disabled"), "true");
  await close(dialog);
  dialog = await open(page);
  assert.equal(await dialog.getByRole("radio", { name: "Invited people", exact: true }).isChecked(), true);
  await dialog.getByRole("radio", { name: "Workspace members", exact: true }).check();
  const workspace = await readHandoff(dialog, "workspace_all");
  await dialog.getByRole("link", { name: "Publish in ChatGPT", exact: true }).click();
  assert.deepEqual(await navigation(page), [first.href, workspace.href]);
  await close(dialog);

  await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  await page.locator(".dashboard-topbar-title").fill("Reviewed sales 📊");
  await page.locator(".dashboard-topbar-title").press("Enter");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Product segment", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Studio", exact: true }).click();
  dialog = await open(page);
  const edited = await readHandoff(dialog, "custom");
  const editedContext = await readContext(page);
  assert.equal(editedContext.presentation.title, "Reviewed sales 📊");
  assert.equal(editedContext.presentation.filters.segment, "Studio");
  assert.equal(new URL(edited.viewUrl).searchParams.get("f.segment"), "Studio");
  assert.ok(edited.prompt.includes("Reviewed sales 📊"));
  if (process.env.DATA_APP_HANDOFF_SCREENSHOT_DIR) {
    mkdirSync(process.env.DATA_APP_HANDOFF_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.DATA_APP_HANDOFF_SCREENSHOT_DIR, "linked-publish-review.png") });
  }
  await close(dialog);
  await page.evaluate(({ key }) => localStorage.setItem(key, JSON.stringify({ version: 1,
    presentation: { title: "Cleared text fixture", textEdits: { "qa-cleared-caption": "" },
      hiddenBlocks: [], componentTitles: {}, chartOverrides: {}, assumptions: { activationLift: 0, retentionLift: 0 } },
  })), { key: presentationStorageKey(snapshot, "/") });
  await page.reload({ waitUntil: "load" });
  await page.locator(".dashboard-topbar-title").waitFor();
  dialog = await open(page);
  await readHandoff(dialog, "custom");
  const cleared = (await readContext(page)).presentation;
  assert.equal(cleared.textEdits["qa-cleared-caption"], "");
  assert.equal(cleared.assumptions.activationLift, 0);
  await close(dialog);
  build({ ...snapshot, buildStatus: "in-progress" });
  await page.reload({ waitUntil: "load" });
  assert.equal(await page.getByRole("button", { name: "Publish", exact: true }).isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.__dashboardPrompts), [], "No host prompt is submitted");
  assert.deepEqual(requests, [], "Draft actions perform no database or transfer-capture writes");
  assert.equal(existsSync(join(project, ".data-app-publish")), false);
  assert.equal(existsSync(join(project, ".data-app-context")), false);
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ passed: true, checked: ["private and workspace access", "same task", "short view link and live context tools", "static preview without local-path injection", "double-click guard", "reopen audience reset", "UI title and filter edits", "explicit cleared text", "building disables Publish", "no capture writes or autosend"] }));
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
