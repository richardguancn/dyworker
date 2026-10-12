import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

import { componentPermalinkId, componentPermalinkShortId } from "../templates/data-app/base/src/chart-permalink.js";
import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = join(pluginRoot, "templates/data-app/base");
const projectRoot = mkdtempSync(join(tmpdir(), "data-permalink-tabs-"));
const snapshot = JSON.parse(readFileSync(join(templateRoot, "src/data.json"), "utf8"));
const origin = "https://permalink-tabs.chatgpt.site";
const tabs = [
  { id: "dashboard", label: "Overview" },
  { id: "segments", label: "Segments" },
];
const hostHistoryState = { host: { frame: "permalink-regression", scroll: 17 } };
const aliases = {
  readable: (id) => id,
  uuid: (id) => componentPermalinkId(origin, id),
  short: (id) => componentPermalinkShortId(origin, id),
};
const failures = [];
const passed = [];
let browser;

function permalink(kind, id, { alias = "short", tab, detail = false } = {}) {
  const url = new URL(`/_data/${kind}/${encodeURIComponent(aliases[alias](id))}${detail ? "/detail" : ""}`, origin);
  if (tab) url.searchParams.set("tab", tab);
  url.searchParams.set("f.segment", "Studio");
  return url.href;
}

function withHostContext(link) {
  const url = new URL(link);
  url.searchParams.set("host_context", "frame-7");
  url.hash = "host-anchor";
  return url.href;
}

async function assertHostContext(page) {
  const url = new URL(page.url());
  assert.equal(url.searchParams.get("host_context"), "frame-7");
  assert.equal(url.hash, "#host-anchor");
  const { dataAppView, ...hostState } = await page.evaluate(() => history.state);
  assert.deepEqual(
    hostState,
    hostHistoryState,
    "Dashboard navigation must preserve the host's existing history state.",
  );
  return dataAppView;
}

async function historyState(page) {
  return page.evaluate(() => ({ length: history.length, pushes: window.__permalinkHistoryPushes }));
}

async function targetState(page, id) {
  return page.evaluate((componentId) => {
    const target = [...document.querySelectorAll("[data-component-id]")].find(
      (element) => element.dataset.componentId === componentId,
    );
    return {
      url: location.href,
      activeTab: document.querySelector("[data-fixture-view]")?.dataset.fixtureView,
      selectedTabs: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map((element) =>
        element.textContent.trim(),
      ),
      targetExists: Boolean(target),
      targetVisible: Boolean(target?.getClientRects().length),
      targetFocused: document.activeElement === target,
      targetHighlighted: target?.getAttribute("data-permalink-target") === "true",
      focusEvents: window.__permalinkFocus,
      highlightEvents: window.__permalinkHighlights,
    };
  }, id);
}

async function assertSelectedTab(page, tabId) {
  await page.waitForFunction(
    (expected) => document.querySelector("[data-fixture-view]")?.dataset.fixtureView === expected,
    tabId,
  );
  const label = tabs.find(({ id }) => id === tabId).label;
  assert.equal(
    await page.getByRole("tab", { name: label, exact: true, includeHidden: true }).getAttribute("aria-selected"),
    "true",
  );
  assert.equal(new URL(page.url()).searchParams.get("view"), "1");
  assert.equal(new URL(page.url()).searchParams.get("tab"), tabId);
  assert.equal(new URL(page.url()).searchParams.get("f.segment"), "Studio");
  assert.equal(await page.locator("[data-fixture-filter]").innerText(), "Studio");
}

async function assertResolved(page, id, { tab = "segments", detail = false } = {}) {
  await page.waitForFunction(
    ({ componentId, tabId }) => {
      // An invisible highlight is a useful immediate failure, not a reason to wait
      // for the highlight timeout and lose the evidence of the incorrect resolution.
      if (window.__permalinkHighlights.some((event) => event.id === componentId && !event.visible)) return true;
      const target = [...document.querySelectorAll("[data-component-id]")].find(
        (element) => element.dataset.componentId === componentId,
      );
      return (
        document.querySelector("[data-fixture-view]")?.dataset.fixtureView === tabId &&
        target?.getClientRects().length > 0 &&
        target.getAttribute("data-permalink-target") === "true" &&
        window.__permalinkFocus.includes(componentId)
      );
    },
    { componentId: id, tabId: tab },
  );
  const state = await targetState(page, id);
  assert.equal(state.activeTab, tab, `The permalink selected the wrong tab: ${JSON.stringify(state)}`);
  assert.equal(state.targetVisible, true, `The linked component is still hidden: ${JSON.stringify(state)}`);
  assert.equal(state.targetHighlighted, true, `The linked component was not highlighted: ${JSON.stringify(state)}`);
  assert.ok(
    state.focusEvents.includes(id),
    `The linked component never received real browser focus: ${JSON.stringify(state)}`,
  );
  assert.deepEqual(
    state.highlightEvents.filter((event) => !event.visible),
    [],
    `Permalinks must not resolve hidden elements: ${JSON.stringify(state)}`,
  );
  await assertSelectedTab(page, tab);
  if (detail) {
    const dialog = page.getByRole("dialog", { name: "Segment trend", exact: true });
    await dialog.waitFor();
    assert.equal(
      await dialog.evaluate((element) => element.contains(document.activeElement)),
      true,
      "Chart details should move focus from the visible chart into the real dialog.",
    );
  } else {
    assert.equal(state.targetFocused, true, `Focus did not reach the linked component: ${JSON.stringify(state)}`);
    assert.equal(await page.getByRole("dialog").count(), 0, "Plain component/chart links must not open chart details.");
  }
}

async function assertOverviewNavigation(page, id) {
  const linkedUrl = page.url();
  const before = await historyState(page);
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await assertSelectedTab(page, "dashboard");
  const overviewUrl = page.url();
  assert.equal(new URL(overviewUrl).pathname, "/", "A deliberate tab change must leave the component route.");
  const overviewView = {
    artifactId: snapshot.id,
    tabId: "dashboard",
    filters: { ...Object.fromEntries(snapshot.filters.map(({ id, defaultValue }) => [id, defaultValue])), segment: "Studio" },
    focus: {},
    returnTo: null,
  };
  assert.deepEqual(await assertHostContext(page), overviewView);
  const after = await historyState(page);
  assert.equal(after.length, before.length + 1, "A deliberate tab change must add exactly one history entry.");
  assert.deepEqual(
    after.pushes.slice(before.pushes.length),
    [{ url: overviewUrl, state: { ...hostHistoryState, dataAppView: overviewView } }],
    "Tab navigation must push the canonical destination exactly once, preserving host state.",
  );

  await page.goBack();
  await assertResolved(page, id);
  assert.equal(page.url(), linkedUrl, "Back must restore the original component link.");
  const { scrollY, ...linkedView } = await assertHostContext(page);
  assert.deepEqual(linkedView, { ...overviewView, tabId: "segments" });
  assert.ok(Number.isFinite(scrollY) && scrollY >= 0, "The linked history entry must retain its scroll position.");
  await page.goForward();
  await assertSelectedTab(page, "dashboard");
  assert.equal(page.url(), overviewUrl, "Forward must restore the manually selected view's URL.");
  assert.deepEqual(await assertHostContext(page), overviewView);
  assert.deepEqual(await historyState(page), after, "Back/Forward resolution must not push extra history entries.");
  const state = await targetState(page, id);
  assert.equal(
    state.targetHighlighted,
    false,
    `Forward must not re-resolve a permalink hidden by a manual tab choice: ${JSON.stringify(state)}`,
  );
  assert.deepEqual(
    state.highlightEvents.filter((event) => !event.visible),
    [],
  );
  assert.equal(await page.getByRole("dialog").count(), 0);

  await page.reload();
  await assertSelectedTab(page, "dashboard");
  assert.equal(page.url(), overviewUrl, "Reload must stay on the manually chosen dashboard tab.");
  assert.deepEqual(await assertHostContext(page), overviewView);
  const reloaded = await targetState(page, id);
  assert.equal(reloaded.targetVisible, false);
  assert.deepEqual(reloaded.highlightEvents, [], "Reloading a canonical dashboard URL must not re-arm the old target.");
  assert.equal(await page.getByRole("dialog").count(), 0);
}

async function scenario(name, run, { canEdit = false, savedTabs = tabs, hiddenBlocks = [] } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  const presentationWrites = [];
  page.setDefaultTimeout(4000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`${origin}/**`, (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/presentation" && request.method() === "PUT") {
      presentationWrites.push(request.postData());
    }
    const payload =
      pathname === "/api/snapshot"
        ? snapshot
        : pathname === "/api/presentation"
          ? {
              canEdit,
              presentation: {
                ...(savedTabs ? { tabs: savedTabs } : {}),
                ...(hiddenBlocks.length ? { hiddenBlocks } : {}),
              },
              revision: 0,
            }
          : null;
    return route.fulfill(
      payload
        ? { contentType: "application/json", body: JSON.stringify(payload) }
        : { contentType: "text/html", body: html },
    );
  });
  await page.addInitScript(() => {
    window.__permalinkFocus = [];
    window.__permalinkHighlights = [];
    window.__permalinkTabChanges = [];
    window.__permalinkHistoryPushes = [];
    const pushState = history.pushState;
    history.pushState = function capturePermalinkPush(...args) {
      window.__permalinkHistoryPushes.push({
        url: new URL(args[2] ?? location.href, location.href).href,
        state: args[0],
      });
      return pushState.apply(this, args);
    };
    document.addEventListener("focusin", (event) => {
      if (event.target.matches?.("[data-component-id]")) {
        window.__permalinkFocus.push(event.target.dataset.componentId);
      }
    });
    new MutationObserver((records) => {
      for (const { target, attributeName, oldValue } of records) {
        if (attributeName === "data-fixture-view") {
          if (oldValue !== null)
            window.__permalinkTabChanges.push({
              from: oldValue,
              to: target.getAttribute("data-fixture-view"),
            });
          continue;
        }
        if (target.getAttribute("data-permalink-target") !== "true") continue;
        window.__permalinkHighlights.push({
          id: target.dataset.componentId,
          visible: target.getClientRects().length > 0 && getComputedStyle(target).visibility !== "hidden",
        });
      }
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["data-permalink-target", "data-fixture-view"],
    });
  });
  try {
    await run(page);
    // Owner presentation persistence is debounced by 300 ms. Keep the page alive
    // long enough to catch an accidental shared write caused by tab discovery.
    await page.waitForTimeout(350);
    assert.deepEqual(presentationWrites, [], "Resolving a permalink must not write shared presentation.");
    assert.deepEqual(errors, [], "The source-authored dashboard must not report browser errors.");
    passed.push(name);
  } catch (error) {
    failures.push({ scenario: name, message: error.message, errors, presentationWrites });
  } finally {
    await page.close();
  }
}

let html;
try {
  cpSync(templateRoot, projectRoot, {
    recursive: true,
    filter: (path) => !path.includes("/node_modules") && !path.includes("/dist"),
  });
  // Only authored content changes. Cover conditionally mounted targets and
  // mounted-but-hidden targets: a registered ref is not necessarily visible.
  writeFileSync(
    join(projectRoot, "src/content/dashboard/DashboardContent.jsx"),
    `
import React from "react";
import { ChartRenderer, DataComponent, useDataApp, useDashboardTabs } from "../../data-app-public.jsx";
const tabs = ${JSON.stringify(tabs)};
const trend = { type: "line", x: "week", y: "activeUsers", showXAxisLabel: false };
export function DashboardContent() {
  const { activeTabId } = useDashboardTabs(tabs);
  const { filters, reviewedRows, visible, chartProps } = useDataApp();
  const rows = reviewedRows("usage_summary", ["week"]);
  return <section data-fixture-view={activeTabId}>
    <output data-fixture-filter>{filters.segment}</output>
    <section data-fixture-panel="dashboard" hidden={activeTabId !== "dashboard"}>
      {activeTabId === "dashboard" && visible("overview-widget") && <DataComponent id="overview-widget" title="Overview metric"
        queryId="usage_summary" kind="metric"><p data-reviewed-rows>{rows.at(-1)?.activeUsers}</p></DataComponent>}
    </section>
    <section data-fixture-panel="segments" style={{ display: activeTabId === "segments" ? "block" : "none" }}>
      {visible("segments-widget") && <DataComponent id="segments-widget" title="Segment metric"
        queryId="usage_summary" kind="metric"><p data-reviewed-rows>{rows.at(-1)?.activeUsers}</p></DataComponent>}
      {visible("segments-chart") && <DataComponent id="segments-chart" title="Segment trend"
        queryId="usage_summary" kind="chart" chart={trend} displayRows={rows}>
        <ChartRenderer spec={trend} rows={rows} height={180} {...chartProps("segments-chart")} />
      </DataComponent>}
    </section>
  </section>;
}`,
  );
  const build = runDataAppFixtureBuild(projectRoot, { pluginRoot });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  html = readFileSync(join(projectRoot, "dist/index.html"), "utf8");
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });

  for (const [alias, tab] of [
    ["readable", "dashboard"],
    ["uuid", undefined],
    ["short", "deleted"],
  ]) {
    await scenario(
      `${alias} widget link discovers an inactive mounted panel`,
      async (page) => {
        await page.goto(permalink("components", "segments-widget", { alias, tab }));
        await assertResolved(page, "segments-widget");
      },
      { canEdit: alias === "readable", savedTabs: alias === "uuid" ? null : tabs },
    );
  }

  await scenario("a conditionally mounted target is discovered in the other direction", async (page) => {
    await page.goto(permalink("components", "overview-widget", { tab: "segments" }));
    await assertResolved(page, "overview-widget", { tab: "dashboard" });
  });

  await scenario("a readable chart link selects its tab without opening details", async (page) => {
    await page.goto(permalink("charts", "segments-chart", { alias: "readable" }));
    await assertResolved(page, "segments-chart");
  });

  await scenario("a component link to a chart does not open details", async (page) => {
    await page.goto(permalink("components", "segments-chart", { tab: "dashboard" }));
    await assertResolved(page, "segments-chart");
  });

  for (const [alias, tab] of [
    ["uuid", "dashboard"],
    ["short", "segments"],
  ]) {
    await scenario(`${alias} chart details retain the selected tab and filters on close`, async (page) => {
      const link = permalink("charts", "segments-chart", { alias, tab, detail: true });
      await page.goto(link);
      await assertResolved(page, "segments-chart", { detail: true });
      const dialog = page.getByRole("dialog", { name: "Segment trend", exact: true });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await assertResolved(page, "segments-chart");
      const closed = new URL(page.url());
      assert.equal(closed.pathname, new URL(link).pathname.replace(/\/detail$/u, ""));
    });
  }

  await scenario("chart routes reject metric targets and restore the starting view", async (page) => {
    await page.goto(permalink("charts", "segments-widget", { tab: "dashboard" }));
    await page.getByText("The linked chart is unavailable", { exact: true }).waitFor();
    await assertSelectedTab(page, "dashboard");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.deepEqual((await targetState(page, "segments-widget")).highlightEvents, []);
  });

  await scenario(
    "saved-hidden targets stay hidden without probing other tabs",
    async (page) => {
      await page.goto(permalink("components", "segments-widget", { tab: "dashboard" }));
      await page.getByText("The linked component is unavailable", { exact: true }).waitFor();
      await assertSelectedTab(page, "dashboard");
      assert.deepEqual(
        await page.evaluate(() => window.__permalinkTabChanges),
        [],
        "A saved-hidden component must be rejected before exposing another tab.",
      );
      const state = await targetState(page, "segments-widget");
      assert.equal(state.targetExists, false);
      assert.deepEqual(state.highlightEvents, []);
      assert.deepEqual(state.focusEvents, []);
      assert.deepEqual((await historyState(page)).pushes, []);
      await page.getByRole("tab", { name: "Segments", exact: true }).click();
      await assertSelectedTab(page, "segments");
      assert.equal(
        (await targetState(page, "segments-widget")).targetExists,
        false,
        "Choosing the target's tab must not restore an owner-hidden component.",
      );
    },
    { canEdit: true, hiddenBlocks: ["segments-widget"] },
  );

  await scenario(
    "a genuinely missing target restores its original nondefault tab",
    async (page) => {
      const link = permalink("components", "missing-widget", { tab: "segments" });
      await page.goto(link);
      await page.getByText("The linked component is unavailable", { exact: true }).waitFor();
      await assertSelectedTab(page, "segments");
      const expected = new URL(link);
      expected.search = new URLSearchParams({ view: "1", ...Object.fromEntries(expected.searchParams) }).toString();
      assert.equal(page.url(), expected.href);
      const state = await targetState(page, "missing-widget");
      assert.equal(state.targetExists, false);
      assert.deepEqual(state.highlightEvents, []);
      assert.deepEqual(state.focusEvents, []);
      assert.deepEqual((await historyState(page)).pushes, [], "Automatic discovery must not add history entries.");
    },
    { canEdit: true },
  );

  await scenario(
    "Back and Forward preserve manual navigation away from a resolved link",
    async (page) => {
      await page.goto(withHostContext(permalink("components", "segments-widget", { tab: "segments" })));
      await assertResolved(page, "segments-widget");
      await page.evaluate((state) => history.replaceState(state, "", location.href), hostHistoryState);
      await assertOverviewNavigation(page, "segments-widget");
    },
    { canEdit: true },
  );

  await scenario(
    "closing chart details then leaving its tab preserves navigation history",
    async (page) => {
      const link = withHostContext(
        permalink("charts", "segments-chart", {
          alias: "uuid",
          tab: "segments",
          detail: true,
        }),
      );
      await page.goto(link);
      await assertResolved(page, "segments-chart", { detail: true });
      await page.evaluate((state) => history.replaceState(state, "", location.href), hostHistoryState);
      const beforeClose = await historyState(page);
      const dialog = page.getByRole("dialog", { name: "Segment trend", exact: true });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await assertResolved(page, "segments-chart");
      assert.equal(new URL(page.url()).pathname, new URL(link).pathname.replace(/\/detail$/u, ""));
      await assertHostContext(page);
      assert.deepEqual(
        await historyState(page),
        beforeClose,
        "Closing linked details must replace, not push, history.",
      );
      await assertOverviewNavigation(page, "segments-chart");
    },
    { canEdit: true },
  );

  assert.deepEqual(failures, [], `${JSON.stringify({ passed, failures }, null, 2)}`);
  process.stdout.write(`${JSON.stringify({ status: "passed", scenarios: passed }, null, 2)}\n`);
} finally {
  await browser?.close();
  rmSync(projectRoot, { recursive: true, force: true });
}
