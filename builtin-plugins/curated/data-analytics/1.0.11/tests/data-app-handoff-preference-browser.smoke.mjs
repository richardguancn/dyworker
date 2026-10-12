import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

import { installDashboardBrowserMocks, resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";
import { chooseHostedHandoff } from "./data-app-browser-handoff.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(pluginRoot, "templates/data-app/base");
const project = mkdtempSync(join(tmpdir(), "data-handoff-preference-"));
const snapshot = JSON.parse(readFileSync(join(template, "src/data.json"), "utf8"));
const cookieName = "data_app_handoff_destination_v1";
const unsavedMessage = "Your choice couldn't be saved in this browser. You'll be asked again next time";
const screenshotDirectory = process.env.DATA_APP_HANDOFF_SCREENSHOT_DIR;
const failures = [];
const presentationWrites = [];
let browser;
let html;

async function createContext(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  await context.route(/^https:\/\/[^/]+\.chatgpt\.site\//u, route => {
    const request = route.request();
    const { hostname, pathname } = new URL(request.url());
    if (request.method() !== "GET") presentationWrites.push({ url: request.url(), method: request.method() });
    const payload = pathname === "/api/snapshot" ? { ...snapshot, id: `dashboard:${hostname}` }
      : pathname === "/api/presentation" ? { canEdit: true, presentation: {}, revision: 0 } : null;
    return route.fulfill(payload
      ? { contentType: "application/json", body: JSON.stringify(payload) }
      : { contentType: "text/html", body: html });
  });
  return context;
}

async function openDashboard(context, hostname) {
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on("pageerror", error => failures.push(`${hostname}: ${error.message}`));
  await installDashboardBrowserMocks(page);
  await page.goto(`https://${hostname}/`, { waitUntil: "load" });
  await page.locator(".dashboard-topbar-title").waitFor();
  return page;
}

const chooser = page => page.getByRole("dialog", { name: "Open in ChatGPT", exact: true });
const navigationCount = page => page.evaluate(() => window.__dashboardDeepLinks.length);

async function openCopy(page) {
  const menu = page.getByRole("menu", { name: "More", exact: true });
  if (!(await menu.isVisible())) await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Create a copy", exact: true }).click();
}

async function expectRememberedCopy(page, destination) {
  const before = await navigationCount(page);
  const originalUrl = page.url();
  await openCopy(page);
  await page.waitForFunction(count => window.__dashboardDeepLinks.length === count + 1, before);
  assert.equal(await chooser(page).count(), 0, "A saved preference must bypass the chooser");
  const href = new URL(await page.evaluate(() => window.__dashboardDeepLinks.at(-1)));
  assert.equal(href.protocol, destination === "desktop" ? "codex:" : "https:");
  if (destination === "web") {
    assert.equal(href.origin, "https://chatgpt.com");
    assert.equal(href.searchParams.get("disable_auto_send"), "1");
  }
  assert.equal(page.url(), originalUrl, "The test must intercept all handoff navigation");
  assert.deepEqual(await page.evaluate(() => window.__dashboardPrompts), [], "Handoffs must not submit a host prompt");
}

async function expectChooser(page) {
  const before = await navigationCount(page);
  await openCopy(page);
  await chooser(page).waitFor();
  assert.equal(await navigationCount(page), before, "Showing the chooser must not navigate");
}

async function cancelChooser(page) {
  await chooser(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await chooser(page).waitFor({ state: "hidden" });
}

async function openSettings(page, selected) {
  const before = await navigationCount(page);
  const more = page.getByRole("button", { name: "More", exact: true });
  if (await page.getByRole("menu", { name: "More", exact: true }).isVisible()) await page.keyboard.press("Escape");
  await more.focus();
  await more.press("Enter");
  const action = page.getByRole("menuitem", { name: "Open ChatGPT in…", exact: true });
  await action.focus();
  await action.press("ArrowRight");
  const menu = page.getByRole("menu", { name: "Open ChatGPT in…", exact: true });
  await menu.waitFor();
  assert.equal(await menu.getByRole("menuitemradio", { name: selected, exact: true }).getAttribute("aria-checked"), "true");
  assert.equal(await navigationCount(page), before, "Opening preferences must not activate a handoff");
  return menu;
}

async function closeSettings(page, menu) {
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "More");
}

async function saveSettings(page, before, after) {
  const menu = await openSettings(page, before);
  const option = menu.getByRole("menuitemradio", { name: after, exact: true });
  await option.focus();
  await option.press("Enter");
  await menu.waitFor({ state: "hidden" });
}

async function blockCookieWrites(page, blocked) {
  await page.evaluate(value => {
    if (!value) {
      delete document.cookie;
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get() { return descriptor.get.call(this); },
      set() {},
    });
  }, blocked);
}

try {
  cpSync(template, project, { recursive: true,
    filter: path => !path.includes("/node_modules") && !path.includes("/dist") });
  const build = runDataAppFixtureBuild(project, { pluginRoot });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  html = readFileSync(join(project, "dist/index.html"), "utf8");
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
  const touchContext = await createContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const touch = await openDashboard(touchContext, "pdf-mobile.openai.chatgpt.site");
  for (const destination of ["desktop", "web"]) {
    const count = await navigationCount(touch);
    const picker = touch.locator(".dashboard-native-overflow select");
    await picker.waitFor({ state: "visible" });
    await picker.selectOption("export:pdf");
    assert.equal(await picker.evaluate(element => element.selectedIndex), -1);
    await chooser(touch).waitFor();
    assert.equal(await navigationCount(touch), count, "The native picker waits for a user-activated handoff link");
    const href = await chooseHostedHandoff(touch, destination);
    assert.equal(await navigationCount(touch), count + 1);
    const viewUrl = "https://pdf-mobile.openai.chatgpt.site/?view=1&tab=dashboard";
    const prompt = href.searchParams.get(destination === "desktop" ? "prompt" : "q");
    assert.ok(prompt.includes(`](<${viewUrl}>)`));
    assert.match(prompt, /\$data-analytics:report-to-pdf\b/u);
    if (destination === "desktop") assert.equal(href.searchParams.get("browserUrl"), viewUrl);
    assert.equal(await touch.evaluate(() => window.__dashboardPrints), 0);
    assert.deepEqual(await touch.evaluate(() => window.__dashboardPrompts), []);
  }
  await touchContext.close();
  console.log("PASS: mobile PDF picker preserves the exact view through desktop/web handoffs without printing or host prompts.");
  const context = await createContext();
  const first = await openDashboard(context, "first.workspace-a.chatgpt.site");
  const sibling = await openDashboard(context, "second.workspace-a.chatgpt.site");
  const otherWorkspace = await openDashboard(context, "first.workspace-b.chatgpt.site");

  await expectChooser(first);
  if (screenshotDirectory) await first.screenshot({ path: join(screenshotDirectory, "handoff-chooser.png"), animations: "disabled" });
  await chooseHostedHandoff(first, "desktop", { remember: true });
  const savedCookies = (await context.cookies()).filter(cookie => cookie.name === cookieName);
  assert.equal(savedCookies.length, 1);
  assert.equal(savedCookies[0].value, "desktop");
  assert.equal(savedCookies[0].domain, ".workspace-a.chatgpt.site");
  assert.equal(savedCookies[0].path, "/");
  assert.equal(savedCookies[0].secure, true);
  assert.ok(savedCookies[0].expires > Date.now() / 1000, "Remembered choice must use persistent browser storage");
  await first.evaluate(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute("data-data-app-handoff-navigation")) {
        HTMLAnchorElement.prototype.click = click;
        throw new Error("Navigation temporarily unavailable");
      }
      return click.call(this);
    };
  });
  await expectChooser(first);
  await chooseHostedHandoff(first, "desktop");
  await expectRememberedCopy(sibling, "desktop");
  await first.reload({ waitUntil: "load" });
  await first.locator(".dashboard-topbar-title").waitFor();
  await expectRememberedCopy(first, "desktop");
  const newTab = await openDashboard(context, "third.workspace-a.chatgpt.site");
  await expectRememberedCopy(newTab, "desktop");
  await expectChooser(otherWorkspace);
  await cancelChooser(otherWorkspace);

  const separateProfile = await createContext();
  const isolated = await openDashboard(separateProfile, "first.workspace-a.chatgpt.site");
  await expectChooser(isolated);
  await cancelChooser(isolated);
  await separateProfile.close();

  const canceled = await openSettings(first, "Desktop app");
  if (screenshotDirectory) await first.screenshot({ path: join(screenshotDirectory, "handoff-settings.png"), animations: "disabled" });
  await closeSettings(first, canceled);
  await first.setViewportSize({ width: 390, height: 844 });
  const mobileMenu = await openSettings(first, "Desktop app");
  await mobileMenu.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  const mobileBounds = await mobileMenu.boundingBox();
  if (screenshotDirectory) await first.screenshot({ path: join(screenshotDirectory, "handoff-mobile-bounds.png"), animations: "disabled" });
  assert.ok(mobileBounds && mobileBounds.x >= 0 && mobileBounds.x + mobileBounds.width <= 390,
    `Preferences must fit the mobile viewport without horizontal clipping: ${JSON.stringify(mobileBounds)}`);
  if (screenshotDirectory) await first.screenshot({ path: join(screenshotDirectory, "handoff-settings-mobile.png"), animations: "disabled" });
  await closeSettings(first, mobileMenu);
  await first.setViewportSize({ width: 1280, height: 900 });
  await expectRememberedCopy(sibling, "desktop");
  await saveSettings(first, "Desktop app", "Web browser");
  await expectRememberedCopy(sibling, "web");
  await expectRememberedCopy(newTab, "web");

  await blockCookieWrites(first, true);
  for (const rejectedValue of ["Desktop app", "Always ask"]) {
    await saveSettings(first, "Web browser", rejectedValue);
    await first.getByRole("status").filter({ hasText: "Your ChatGPT opening preference couldn't be saved in this browser" }).waitFor();
    const unchanged = await openSettings(first, "Web browser");
    await closeSettings(first, unchanged);
    await expectRememberedCopy(sibling, "web");
  }
  await blockCookieWrites(first, false);
  await saveSettings(first, "Web browser", "Always ask");
  assert.deepEqual((await context.cookies()).filter(cookie => cookie.name === cookieName), []);
  await expectChooser(sibling);
  await chooseHostedHandoff(sibling, "desktop");
  await expectChooser(sibling);
  await cancelChooser(sibling);

  await blockCookieWrites(first, true);
  await expectChooser(first);
  await chooseHostedHandoff(first, "web", { remember: true });
  await first.getByRole("status").filter({ hasText: unsavedMessage }).waitFor();
  await expectChooser(first);
  await cancelChooser(first);
  await blockCookieWrites(first, false);

  const personal = await openDashboard(context, "dashboard.chatgpt.site");
  await expectChooser(personal);
  assert.equal(await chooser(personal).getByRole("checkbox").count(), 0, "Unsupported origins must not offer a preference they cannot save");
  await chooseHostedHandoff(personal, "desktop");
  await expectChooser(personal);
  await cancelChooser(personal);
  await personal.reload({ waitUntil: "load" });
  await personal.locator(".dashboard-topbar-title").waitFor();
  await expectChooser(personal);
  await cancelChooser(personal);
  assert.deepEqual((await context.cookies()).filter(cookie => cookie.name === cookieName), []);
  assert.deepEqual(presentationWrites, [], "Browser destination choices must never write dashboard presentation");
  assert.deepEqual(failures, [], "Handoff preference flows must not report browser errors");
  console.log("PASS: handoff cookies persist across reloads and sibling dashboards; settings, reset, isolation, blocked writes and mobile PDF handoffs verified.");
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
