import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  verifyEditorAskChatGPTSelectionModes,
  verifyLocalAskChatGPTHandoff,
  verifyViewerAskChatGPTHandoff,
} from "./data-app-browser-ask-chatgpt.mjs";
import { chooseHostedHandoff, verifyHostedHandoffChoices } from "./data-app-browser-handoff.mjs";

async function openConvertMenu(page) {
  return ensureOverflowMenu(page);
}

async function selectConversion(page, name) {
  const menu = await openConvertMenu(page);
  const item = menu.getByRole("menuitem", { name, exact: true });
  assert.equal(await item.evaluate(element => element.tagName), "A", "Exports must use genuine handoff links");
  await item.focus();
  await item.press("Enter");
}

async function ensureActionComposer(page) {
  const composer = page.getByRole("dialog", { name: "Ask ChatGPT about this dashboard" });
  if (!(await composer.isVisible())) await page.locator(".dashboard-ask-button").click();
  return composer;
}

async function ensureOverflowMenu(page) {
  const menu = page.getByRole("menu", { name: "More", exact: true });
  if (!(await menu.isVisible())) await page.getByRole("button", { name: "More", exact: true }).click();
  return menu;
}

async function verifyPromptAnchor(control, { protocol = "codex:", target = "_self" } = {}) {
  const anchor = await control.evaluate((element) => ({
    tagName: element.tagName,
    href: element.getAttribute("href"),
    target: element.getAttribute("target"),
  }));
  assert.equal(anchor.tagName, "A", "ChatGPT-bound actions must be real, user-activated hyperlinks");
  assert.equal(anchor.target, target, "The navigation target must match the current ChatGPT surface");
  const href = new URL(anchor.href);
  assert.equal(href.protocol, protocol);
  return href;
}

function verifyPdfHandoff(href, { viewUrl } = {}) {
  const prompt = href.searchParams.get("prompt") ?? href.searchParams.get("q");
  assert.match(prompt, /\[@Data\]\(plugin:\/\/data-analytics@openai-curated-remote\)/u);
  assert.match(prompt, /\$data-analytics:report-to-pdf\b/u);
  assert.match(prompt, /verified PDF\b/u);
  if (viewUrl) {
    assert.ok(prompt.includes(`](<${viewUrl}>)`), "PDF handoffs must preserve the exact selected view");
    if (href.protocol === "codex:") assert.equal(href.searchParams.get("browserUrl"), viewUrl);
    assert.match(prompt, /read its current Data app context/u);
  }
}

function verifyPublicationPrompt(prompt, audience) {
  assert.match(prompt, /\[@Sites\]\(plugin:\/\/sites@openai-curated-remote\)/u);
  assert.match(prompt, /publish this dashboard/u);
  assert.doesNotMatch(prompt, /read-only and does not authorize|confirmation before publishing|Unknown schedule state|permissions remain unresolved/u);
  assert.match(prompt, audience === "workspace_all"
    ? /workspace members with the link/u
    : /access limited to me until I invite others/u);
}

export async function verifyCodexEditorDashboardActions(page, { originatingThreadId }) {
  assert.doesNotMatch(await page.evaluate(() => navigator.userAgent), /(?:Codex|ChatGPT)Browser/u,
    "The in-app browser marker must work with the browser's ordinary user agent");
  const originalMarker = await page.evaluateHandle(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "__codexBrowser");
    Object.defineProperty(window, "__codexBrowser", { configurable: true, value: true });
    return descriptor;
  });
  try {
    const prompts = await verifyEditorDashboardExports(page);
    await verifyEditorDashboardPublishing(page, { originatingThreadId, promptCount: prompts.length });
  } finally {
    await page.evaluate((descriptor) => {
      if (descriptor) Object.defineProperty(window, "__codexBrowser", descriptor);
      else delete window.__codexBrowser;
    }, originalMarker);
    await originalMarker.dispose();
  }
}

async function verifyEditorDashboardExports(page) {
  await page.getByRole("button", { name: "Refresh data" }).click();
  const refreshAction = page.getByRole("menuitem", { name: "Refresh now" });
  await verifyPromptAnchor(refreshAction);
  assert.notEqual(
    await page.getByRole("menuitem", { name: "Schedule refresh" }).evaluate((element) => element.tagName),
    "A",
    "Opening the schedule dialog must remain a local interaction",
  );
  await refreshAction.click();
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 1);

  const actionMenu = await ensureActionComposer(page);
  for (const label of ["Share key insights", "Create a change alert", "Create a report", "Change this dashboard"]) {
    await verifyPromptAnchor(actionMenu.getByRole("link", { name: label }));
  }
  const editRequest = new URL(await actionMenu.getByRole("link", { name: "Change this dashboard" }).getAttribute("href"));
  assert.match(editRequest.searchParams.get("prompt"), /Verify that I own the original/u);
  assert.match(editRequest.searchParams.get("prompt"), /opening this action alone does not authorize edits/u);
  assert.equal(await actionMenu.getByRole("button", { name: "Switch theme" }).count(), 0);
  const report = actionMenu.getByRole("link", { name: "Create a report" });
  await report.focus();
  await report.press("Enter");
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 2);
  await actionMenu.waitFor({ state: "hidden" });
  assert.equal(await actionMenu.count(), 0, "Selecting an Ask suggestion closes the composer after native link activation");

  const overflowMenu = await ensureOverflowMenu(page);
  assert.notEqual(
    await overflowMenu.getByRole("menuitem", { name: "Switch theme" }).evaluate((element) => element.tagName),
    "A",
    "Theme customization must remain local instead of opening ChatGPT",
  );
  const copy = overflowMenu.getByRole("menuitem", { name: "Create a copy" });
  await verifyPromptAnchor(copy);
  await copy.focus();
  await copy.press("Enter");
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 3);
  await page.keyboard.press("Escape");
  const convertMenu = await openConvertMenu(page);
  const conversionItems = convertMenu.locator(".dashboard-convert-menu-item");
  const exportLabels = await conversionItems.allInnerTexts();
  for (const label of exportLabels) {
    const conversion = convertMenu.getByRole("menuitem", { name: label, exact: true });
    await verifyPromptAnchor(conversion);
    const href = new URL(await conversion.getAttribute("href"));
    const prompt = href.searchParams.get("prompt") ?? href.searchParams.get("q");
    assert.deepEqual(prompt.match(/\[@[^\]]+\]\(plugin:\/\/[^)]+\)/gu), [
      "[@Data](plugin://data-analytics@openai-curated-remote)",
    ], `${label} export should prefill only the Data plugin`);
    assert.doesNotMatch(prompt, /@(?:Documents|Presentations)\b/u);
  }
  const notebookIndex = exportLabels.indexOf("Jupyter Notebook");
  assert.notEqual(notebookIndex, -1, "Jupyter Notebook must be offered in the export menu");
  const notebookExport = convertMenu.getByRole("menuitem", {
    name: "Jupyter Notebook",
    exact: true,
  });
  assert.equal(
    await notebookExport.locator(".dashboard-convert-icon").count(),
    1,
    "Jupyter Notebook must use its dedicated conversion icon",
  );
  await notebookExport.focus();
  await notebookExport.press("Enter");
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 4);

  await selectConversion(page, "PDF");
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 5);
  verifyPdfHandoff(new URL(await page.evaluate(() => window.__dashboardDeepLinks.at(-1))));
  assert.equal(
    await page.evaluate(() => window.__dashboardPrints),
    0,
    "Dashboard PDF export must hand off without invoking browser print",
  );

  const prompts = (await page.evaluate(() => window.__dashboardDeepLinks)).map((href) =>
    new URL(href).searchParams.get("prompt"),
  );
  assert.equal(prompts.length, 5, "Refresh, report creation, copying, notebook and PDF export must each activate exactly one real link");
  assert.match(prompts[0], /"segment": "Studio"/);
  assert.match(
    prompts[0],
    /"activationLift":/,
    "Refresh requests must preserve the viewer's current scenario assumptions",
  );
  assert.match(prompts[0], /"chartOverrides"/);
  assert.match(prompts[1], /new, separate report/i);
  assert.match(prompts[1], /Never modify or overwrite the original Data app/i);
  assert.match(prompts[1], /Do not query new data, refresh the source, publish, send, or change access unless I explicitly ask/u);
  assert.doesNotMatch(prompts[1], /"activeUsers":/);
  assert.match(prompts[2], /new, separate dashboard/i);
  assert.match(prompts[2], /Never modify or overwrite the original dashboard/i);
  assert.doesNotMatch(prompts[2], /"activeUsers":/);
  assert.doesNotMatch(prompts[0], /"activeUsers":/);

  const notebookPrompt = prompts[3];
  assert.match(notebookPrompt, /\$data-analytics:jupyter-notebooks\b/u);
  assert.match(notebookPrompt, /\.ipynb\b/u);
  assert.match(notebookPrompt, /"segment": "Studio"/u, "Notebook export must preserve the viewer's current filters");
  assert.match(
    notebookPrompt,
    /"activationLift":/u,
    "Notebook export must preserve the viewer's current scenario assumptions",
  );
  assert.match(notebookPrompt, /"componentTitles":/u, "Notebook export must preserve edited presentation details");
  assert.match(notebookPrompt, /"chartOverrides":/u, "Notebook export must preserve current chart presentation");
  assert.doesNotMatch(
    notebookPrompt,
    /"(?:rows|sourceRows|displayRows|queries|activeUsers)"\s*:/u,
    "Notebook export must not embed reviewed rows in its ChatGPT handoff",
  );
  const pdfPrompt = prompts[4];
  assert.match(pdfPrompt, /\$data-analytics:report-to-pdf\b/u);
  assert.match(pdfPrompt, /"segment": "Studio"/u, "PDF export must preserve the viewer's current filters");
  assert.match(pdfPrompt, /"activationLift":/u, "PDF export must preserve current scenario assumptions");
  assert.match(pdfPrompt, /"componentTitles":/u, "PDF export must preserve edited presentation details");
  assert.match(pdfPrompt, /"chartOverrides":/u, "PDF export must preserve current chart presentation");
  assert.doesNotMatch(pdfPrompt, /"(?:rows|sourceRows|displayRows|queries|activeUsers)"\s*:/u,
    "PDF export must not embed reviewed rows in its ChatGPT handoff");
  assert.deepEqual(
    await page.evaluate(() => window.__dashboardPrompts),
    [],
    "Menu handoffs must activate trusted links instead of invoking an available host-message bridge",
  );
  assert.equal(
    await page.getByText("Request sent to the host.", { exact: true }).count(),
    0,
    "Accepted app handoffs must not claim that work was sent to a host",
  );
  assert.deepEqual(
    await page.evaluate(() => window.__dashboardNavigationEvents),
    Array.from({ length: 5 }, () => ({
      connected: true,
      trusted: true,
      defaultPrevented: false,
      target: "_self",
    })),
    "Native mouse and keyboard links must remain mounted and unprevented through document bubble",
  );

  await page.getByRole("button", { name: "Refresh data" }).click();
  await page.getByRole("menuitem", { name: "Schedule refresh" }).click();
  const scheduleDialog = page.getByRole("dialog", { name: "Schedule refresh" });
  const scheduledAction = scheduleDialog.locator(".dashboard-schedule-submit");
  const validSchedule = await verifyPromptAnchor(scheduledAction);
  assert.match(validSchedule.searchParams.get("prompt"), /every weekday at 09:00/u);
  await scheduleDialog.getByRole("button", { name: "Repeat schedule" }).click();
  await page.getByRole("menuitemradio", { name: "Custom days" }).click();
  for (const day of ["Monday", "Wednesday", "Friday"]) {
    await scheduleDialog.getByRole("button", { name: day }).click();
  }
  assert.equal(await scheduledAction.evaluate((element) => element.tagName), "BUTTON");
  assert.equal(await scheduledAction.isDisabled(), true, "Invalid custom schedules must not expose active hyperlinks");
  await scheduleDialog.getByRole("button", { name: "Monday" }).click();
  const customSchedule = await verifyPromptAnchor(scheduledAction);
  assert.match(customSchedule.searchParams.get("prompt"), /every Monday at 09:00/u);
  await scheduledAction.focus();
  await scheduledAction.press("Enter");
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 6);
  await page.keyboard.press("Escape");
  return [];
}

async function verifyEditorDashboardPublishing(page, { originatingThreadId, promptCount }) {
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Publish dashboard", exact: true });
  assert.equal(
    await review.getByRole("radio", { name: "Invited people" }).isChecked(),
    true,
    "Initial publication must default to private access",
  );
  assert.equal(
    await review.getByRole("radio", { name: "Workspace members" }).isChecked(),
    false,
    "Workspace sharing must be an explicit choice",
  );
  const confirmation = review.getByRole("link", { name: "Publish in ChatGPT" });
  assert.equal(await review.getByRole("button", { name: "Cancel", exact: true }).count(), 0);
  assert.equal(
    await confirmation.evaluate((element) => element.tagName),
    "A",
    "Publication must use a native link activated directly by the user's click",
  );
  assert.equal(await confirmation.getAttribute("target"), "_self", "Native Codex publication must not open a new tab");
  const privateLink = new URL(await confirmation.getAttribute("href"));
  assert.equal(
    `${privateLink.protocol}//${privateLink.host}${privateLink.pathname}`,
    `codex://threads/${originatingThreadId}`,
  );
  assert.deepEqual([...privateLink.searchParams.keys()], ["prompt"]);
  verifyPublicationPrompt(privateLink.searchParams.get("prompt"), "custom");
  await review.getByRole("radio", { name: "Workspace members" }).check();
  assert.equal(await review.getByRole("radio", { name: "Workspace members" }).isChecked(), true);
  assert.equal(await review.getByRole("radio", { name: "Invited people" }).isChecked(), false);
  const sharedLink = new URL(await confirmation.getAttribute("href"));
  verifyPublicationPrompt(sharedLink.searchParams.get("prompt"), "workspace_all");
  const previousLinkCount = await page.evaluate(() => window.__dashboardDeepLinks.length);
  const originalConfirmation = await confirmation.elementHandle();
  await confirmation.click();
  await page.waitForFunction((count) => window.__dashboardDeepLinks.length === count + 1, previousLinkCount);
  assert.deepEqual(await page.evaluate(() => window.__dashboardNavigationEvents.at(-1)), {
    connected: true, trusted: true, defaultPrevented: false, target: "_self",
  }, "The first publication remains a trusted native link activation");
  const waiting = review.getByRole("link", { name: "Waiting for ChatGPT…", exact: true });
  await waiting.waitFor();
  assert.equal(await waiting.getAttribute("aria-disabled"), "true");
  assert.equal(await originalConfirmation.evaluate(element => element.isConnected), true,
    "Publishing must keep the activated link mounted through navigation");
  assert.match(await review.getByRole("status").innerText(), /send.*ChatGPT.*wait/iu,
    "The waiting state explains that the prepared message still needs to be sent in ChatGPT");
  await waiting.evaluate(element => { element.click(); element.click(); });
  await waiting.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => window.__dashboardDeepLinks.length), previousLinkCount + 1,
    "Repeated mouse and keyboard activation must not create another publication handoff");
  assert.equal(await page.evaluate(() => window.__dashboardNavigationEvents.at(-1).defaultPrevented), true);
  await originalConfirmation.dispose();
  assert.equal(
    (await page.evaluate(() => window.__dashboardPrompts)).length,
    promptCount,
    "Publication must use its native handoff link instead of invoking the host-message bridge",
  );
  await review.getByRole("button", { name: "Close", exact: true }).click();
  await review.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  assert.equal(await review.getByRole("link", { name: "Publish in ChatGPT", exact: true }).isEnabled(), true,
    "Closing and reopening publication lets the user start another handoff");
  await review.getByRole("button", { name: "Close", exact: true }).click();
  await review.waitFor({ state: "hidden" });
}

async function installNoBridgeDashboardActionMocks(page) {
  await page.addInitScript(() => {
    window.__dashboardDeepLinks = [];
    window.__dashboardPrints = 0;
    window.__dashboardTrustedActivations = [];
    document.addEventListener("click", (event) => {
      const link = event.target.closest('a[href^="codex://"]');
      if (!link) return;
      window.__dashboardTrustedActivations.push({
        connected: link.isConnected,
        trusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented,
        target: link.target,
      });
      event.preventDefault();
      window.__dashboardDeepLinks.push(link.href);
      window.__dashboardLastDeepLinkTarget = link.target;
    });
    window.print = () => {
      window.__dashboardPrints += 1;
    };
  });
}

async function verifyLocalDashboardActions(page, { dataAppPath, originatingThreadId }) {
  await page.getByRole("button", { name: "Refresh data" }).click();
  await page.getByRole("menuitem", { name: "Refresh now" }).click();
  await selectConversion(page, "PDF");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Publish dashboard", exact: true });
  await review.getByRole("link", { name: "Publish in ChatGPT" }).click();
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 3);
  await review.getByRole("button", { name: "Close", exact: true }).click();
  await review.waitFor({ state: "hidden" });

  const dashboardActionLinks = (await page.evaluate(() => window.__dashboardDeepLinks)).map((href) => new URL(href));
  for (const action of dashboardActionLinks) {
    assert.equal(`${action.protocol}//${action.host}${action.pathname}`, `codex://threads/${originatingThreadId}`);
    assert.equal(action.searchParams.has("originUrl"), false);
    assert.equal(action.searchParams.has("path"), false);
    assert.equal(action.searchParams.get("prompt").includes(originatingThreadId), false);
  }
  assert.match(dashboardActionLinks[0].searchParams.get("prompt"), /refresh this dashboard/i);
  verifyPdfHandoff(dashboardActionLinks[1]);
  assert.ok(dashboardActionLinks[1].searchParams.get("prompt").includes(dataAppPath),
    "File-based PDF handoffs must retain the verified local artifact path");
  verifyPublicationPrompt(dashboardActionLinks[2].searchParams.get("prompt"), "custom");
  assert.equal(
    await page.evaluate(() => window.__dashboardPrints),
    0,
    "Local PDF export must use a Codex handoff without invoking browser print",
  );
  assert.match(
    readFileSync(dataAppPath, "utf8"),
    new RegExp(`<meta name="data-app-local-thread" content="${originatingThreadId}">`, "u"),
    "Local previews must retain their originating task in transient build metadata",
  );
}

export async function verifyLocalDashboardHandoffs(browser, { dataAppPath, title, originatingThreadId, failures }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on("pageerror", (error) => failures.push(error.message));
  await installNoBridgeDashboardActionMocks(page);
  await page.goto(pathToFileURL(dataAppPath).href, { waitUntil: "load" });
  const dashboardTitle = page.locator(".dashboard-topbar-title");
  await dashboardTitle.waitFor();
  assert.equal((await dashboardTitle.innerText()).trim(), title);
  assert.equal(
    new URL(page.url()).hash,
    "",
    "A local dashboard without a host bridge must return to its build task without a URL fragment",
  );
  assert.equal(await page.evaluate(() => typeof window.openai), "undefined");
  await verifyEditorAskChatGPTSelectionModes(page);
  await verifyLocalAskChatGPTHandoff(page, { originatingThreadId });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "CodexBrowser/1.0" });
  });
  await verifyLocalDashboardActions(page, { dataAppPath, originatingThreadId });
  const actionComposer = await ensureActionComposer(page);
  const shareAction = actionComposer.getByRole("link", { name: "Share key insights" });
  await verifyPromptAnchor(shareAction);
  await shareAction.click();
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 4);
  assert.equal(
    await page.evaluate(() => window.__dashboardLastDeepLinkTarget),
    "_self",
    "User-activated native dashboard actions must not create empty browser tabs",
  );
  const share = new URL(await page.evaluate(() => window.__dashboardDeepLinks.at(-1)));
  assert.equal(`${share.protocol}//${share.host}${share.pathname}`, `codex://threads/${originatingThreadId}`);
  assert.match(
    share.searchParams.get("prompt"),
    /\[@Data\]\(plugin:\/\/data-analytics@openai-curated-remote\) and invoke \$share-artifact-summary/u,
    "Sharing must explicitly invoke its dedicated Data skill in the originating task",
  );
  assert.equal(
    page.url().includes(originatingThreadId),
    false,
    "The originating task must stay in transient build metadata, never the preview URL",
  );
  assert.deepEqual(
    await page.evaluate(() => window.__dashboardTrustedActivations),
    Array.from({ length: 4 }, () => ({
      connected: true,
      trusted: true,
      defaultPrevented: false,
      target: "_self",
    })),
    "Local refresh, PDF, publishing, and sharing links must remain mounted and unprevented through document bubble",
  );
  await page.close();
}

export async function installPublishedDashboardActionMocks(page) {
  await page.addInitScript(() => {
    window.__dashboardDeepLinks = [];
    window.__dashboardTrustedActivations = [];
    window.__dashboardPrints = 0;
    window.__dashboardClipboard = [];
    window.__dashboardScrollCalls = [];
    window.__dashboardHistoryReplacements = [];
    window.__dashboardStatusAnnouncements = [];
    document.addEventListener("click", (event) => {
      const link = event.target.closest('a[href^="codex://"], a[href^="https://chatgpt.com/"]');
      if (!link || event.defaultPrevented) return;
      window.__dashboardTrustedActivations.push({
        connected: link.isConnected,
        trusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented,
        target: link.target,
      });
      event.preventDefault();
      window.__dashboardDeepLinks.push(link.href);
      window.__dashboardLastDeepLinkTarget = link.target;
    });
    const replaceState = history.replaceState;
    history.replaceState = function captureDashboardHistoryReplacement(state, title, url) {
      window.__dashboardHistoryReplacements.push({ state, title, url: url == null ? null : String(url) });
      return replaceState.apply(this, arguments);
    };
    let previousStatusElement;
    let previousStatusText;
    new MutationObserver(() => {
      const status = document.querySelector('[role="status"]');
      const text = status?.textContent.trim();
      if (!status) {
        previousStatusElement = undefined;
        previousStatusText = undefined;
      } else if (status !== previousStatusElement || text !== previousStatusText) {
        window.__dashboardStatusAnnouncements.push(text);
        previousStatusElement = status;
        previousStatusText = text;
      }
    }).observe(document, { childList: true, characterData: true, subtree: true });
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function captureDashboardChartScroll(options) {
      window.__dashboardScrollCalls.push({
        componentId: this.dataset.componentId ?? this.closest("[data-component-id]")?.dataset.componentId,
        options: typeof options === "object" ? { ...options } : options,
      });
      return scrollIntoView.call(this, options);
    };
    window.print = () => {
      window.__dashboardPrints += 1;
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => window.__dashboardClipboard.push(text) },
    });
  });
}

export async function verifyPublishedDashboardActions(page) {
  await page.getByRole("button", { name: "Refresh data" }).click();
  const refreshAction = page.getByRole("menuitem", { name: "Refresh now" });
  await refreshAction.click();
  await chooseHostedHandoff(page, "web");
  await selectConversion(page, "PDF");
  await chooseHostedHandoff(page, "web");
  await selectConversion(page, "Jupyter Notebook");
  await chooseHostedHandoff(page, "web");
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 3);
  assert.equal(
    await page.getByText("Request sent to the host.", { exact: true }).count(),
    0,
    "Published exports must hand off without claiming that work was sent to a host",
  );
  const actionMenu = await ensureOverflowMenu(page);
  const copyAction = actionMenu.getByRole("menuitem", { name: "Copy link", exact: true });
  assert.notEqual(await copyAction.evaluate((element) => element.tagName), "A", "Copy link must remain local");
  await copyAction.click();
  const deepLinks = await page.evaluate(() => window.__dashboardDeepLinks);
  assert.deepEqual(
    await page.evaluate(() => window.__dashboardTrustedActivations),
    Array.from({ length: 3 }, () => ({
      connected: true,
      trusted: true,
      defaultPrevented: false,
      target: "_blank",
    })),
    "Published web refresh, PDF and notebook export links must stay mounted through browser navigation",
  );
  for (const href of deepLinks) {
    const action = new URL(href);
    assert.equal(`${action.origin}${action.pathname}`, "https://chatgpt.com/");
    assert.equal(action.searchParams.get("disable_auto_send"), "1");
    assert.match(action.searchParams.get("q"), /https:\/\/dashboard\.chatgpt\.site\/published/u);
    assert.doesNotMatch(action.toString(), /secret|private-section|codexThreadId|550e8400/u);
  }
  verifyPdfHandoff(new URL(deepLinks[1]), {
    viewUrl: "https://dashboard.chatgpt.site/published?view=1&tab=dashboard",
  });
  assert.match(
    new URL(deepLinks[2]).searchParams.get("q"),
    /Use \[@Data\]\(plugin:\/\/data-analytics@openai-curated-remote\)[\s\S]*\$data-analytics:jupyter-notebooks/u,
    "Published notebook exports must use the Data notebook skill without exposing the originating task",
  );
  assert.deepEqual(await page.evaluate(() => window.__dashboardClipboard), [
    "https://dashboard.chatgpt.site/published?view=1&tab=dashboard",
  ]);
  assert.equal(
    await page.evaluate(() => window.__dashboardPrints),
    0,
    "Published PDF export must hand off without invoking browser print",
  );

  await page.emulateMedia({ media: "print" });
  assert.equal(
    await page.locator(".dashboard-topbar").evaluate((element) => getComputedStyle(element).display),
    "none",
    "Printed dashboards must omit application chrome",
  );
  assert.notEqual(
    await page
      .locator('main[data-data-app-content="dashboard"]')
      .evaluate((element) => getComputedStyle(element).display),
    "none",
    "Printed dashboards must retain the rendered dashboard content",
  );
  assert.match(
    await page
      .locator('[data-component-id="usage-trend"]')
      .evaluate((element) => getComputedStyle(element).breakInside),
    /avoid/u,
    "Printed dashboard components must avoid splitting across pages when possible",
  );
  await page.emulateMedia({ media: "screen" });
  assert.equal(await page.getByRole("button", { name: /^Publish(?: changes)?$/u }).count(), 0,
    "Hosted dashboard owners must not see Publish");
}

export async function verifyPublishedViewerHandoffs(page, { title, originatingThreadId, sensitivePreviewPattern }) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("https://dashboard.chatgpt.site/published?token=secret#private-section", { waitUntil: "load" });
  const dashboardTitle = page.locator(".dashboard-topbar-title");
  await dashboardTitle.waitFor();
  assert.equal((await dashboardTitle.innerText()).trim(), title);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  await page.locator(".dashboard-topbar-title").dblclick();
  assert.notEqual(
    await page.locator(".dashboard-topbar-title").getAttribute("contenteditable"),
    "true",
    "View-only users must not be able to edit a dashboard title by double-clicking it",
  );
  assert.equal(
    await page.getByRole("button", { name: "Edit text and layout" }).count(),
    0,
    "Published viewers must remain read-only when duplicating a dashboard",
  );
  await dashboardTitle.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await page.getByRole("dialog", { name: "Selection actions", exact: true }).waitFor();
  await verifyHostedHandoffChoices(page, { originatingThreadId });
  await verifyViewerAskChatGPTHandoff(page);
  const viewerOverflowMenu = await ensureOverflowMenu(page);
  await viewerOverflowMenu.waitFor();
  assert.equal(
    await viewerOverflowMenu.getByRole("menuitem", { name: "Switch theme", exact: true }).count(),
    0,
    "Published viewers must not be able to customize the dashboard theme",
  );
  await page.keyboard.press("Escape");
  const webComposer = await ensureActionComposer(page);
  assert.equal(await webComposer.getByRole("link", { name: "Change this dashboard" }).count(), 0,
    "Viewers must not receive the owner-only original-editing handoff");
  await page.keyboard.press("Escape");
  await webComposer.waitFor({ state: "hidden" });
  const webRemix = (await ensureOverflowMenu(page)).getByRole("menuitem", { name: "Create a copy" });
  await webRemix.click();
  await chooseHostedHandoff(page, "web");
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__dashboardTrustedActivations.at(-1)), {
    connected: true,
    trusted: true,
    defaultPrevented: false,
    target: "_blank",
  });
  const web = new URL((await page.evaluate(() => window.__dashboardDeepLinks))[0]);
  assert.equal(`${web.origin}${web.pathname}`, "https://chatgpt.com/");
  assert.match(web.searchParams.get("q"), /https:\/\/dashboard\.chatgpt\.site\/published/u);
  assert.match(web.searchParams.get("q"), /only data I can access/u);
  assert.match(web.searchParams.get("q"), /leave the original unchanged/iu);
  assert.doesNotMatch(web.toString(), /secret|private-section/);
  await selectConversion(page, "PDF");
  const webPdf = await chooseHostedHandoff(page, "web");
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 2);
  verifyPdfHandoff(webPdf, { viewUrl: "https://dashboard.chatgpt.site/published?view=1&tab=dashboard" });
  assert.equal(await page.evaluate(() => window.__dashboardPrints), 0);
  assert.equal(await page.getByRole("button", { name: /^Publish(?: changes)?$/u }).count(), 0,
    "Hosted dashboard viewers must not see Publish");

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "CodexBrowser/1.0" });
  });
  await page.goto(
    `https://dashboard.chatgpt.site/published?token=secret&surface=desktop#codexThreadId=${originatingThreadId}`,
    {
      waitUntil: "load",
    },
  );
  assert.match(await page.evaluate(() => navigator.userAgent), /^CodexBrowser/u);
  await page.evaluate(() => {
    window.__publishedHostPrompts = [];
    window.openai = {
      sendFollowUpMessage: async (message) => {
        window.__publishedHostPrompts.push(message);
        return { isError: false };
      },
    };
  });
  const desktopRemix = (await ensureOverflowMenu(page)).getByRole("menuitem", { name: "Create a copy" });
  await desktopRemix.click();
  await chooseHostedHandoff(page, "desktop");
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__dashboardTrustedActivations.at(-1)), {
    connected: true,
    trusted: true,
    defaultPrevented: false,
    target: "_self",
  });
  assert.equal(
    await page.evaluate(() => window.__dashboardLastDeepLinkTarget),
    "_self",
    "Published desktop actions must open a new task without creating an empty browser tab",
  );
  const desktop = new URL(await page.evaluate(() => window.__dashboardDeepLinks[0]));
  assert.equal(`${desktop.protocol}//${desktop.host}${desktop.pathname}`, "codex://new");
  assert.deepEqual([...desktop.searchParams.keys()], ["prompt", "browserUrl"]);
  assert.equal(desktop.searchParams.get("browserUrl"), "https://dashboard.chatgpt.site/published?view=1&tab=dashboard");
  assert.match(desktop.searchParams.get("prompt"), /only data I can access/u);
  assert.doesNotMatch(desktop.toString(), sensitivePreviewPattern);
  await selectConversion(page, "PDF");
  const desktopPdf = await chooseHostedHandoff(page, "desktop");
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 2);
  verifyPdfHandoff(desktopPdf, { viewUrl: "https://dashboard.chatgpt.site/published?view=1&tab=dashboard" });
  assert.equal(`${desktopPdf.protocol}//${desktopPdf.host}${desktopPdf.pathname}`, "codex://new");
  assert.doesNotMatch(desktopPdf.toString(), sensitivePreviewPattern);
  assert.equal(await page.evaluate(() => window.__dashboardPrints), 0);
  assert.deepEqual(
    await page.evaluate(() => window.__publishedHostPrompts),
    [],
    "Published dashboard actions must open a new task instead of messaging the originating task",
  );
  assert.equal(await page.getByRole("button", { name: /^Publish(?: changes)?$/u }).count(), 0,
    "Hosted dashboards must not show Publish in Codex Browser");
}

export async function verifyWidgetPermalinkPdfExport(page) {
  await selectConversion(page, "PDF");
  const handoff = await chooseHostedHandoff(page, "desktop");
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 1);
  verifyPdfHandoff(handoff, { viewUrl: "https://dashboard.chatgpt.site/?view=1&tab=dashboard" });
  assert.equal(`${handoff.protocol}//${handoff.host}${handoff.pathname}`, "codex://new");
  assert.match(handoff.searchParams.get("prompt"), /export the entire/u,
    "A widget permalink must retain whole-dashboard PDF scope");
  assert.doesNotMatch(handoff.toString(), /token=|secret|private-section|codexThreadId/u);
  assert.deepEqual(await page.evaluate(() => window.__dashboardTrustedActivations.at(-1)), {
    connected: true, trusted: true, defaultPrevented: false, target: "_self",
  });
  assert.equal(
    await page.evaluate(() => window.__dashboardPrints),
    0,
    "PDF export from a widget permalink must hand off without invoking browser print",
  );
}
