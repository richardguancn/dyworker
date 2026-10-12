import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";
import { chooseHostedHandoff } from "./data-app-browser-handoff.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(pluginRoot, "templates/data-app/base");
async function saveReportEdits(page) {
  await page.locator(".dashboard-topbar").getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
}
const project = mkdtempSync(join(tmpdir(), "data-report-follow-up-"));
const originatingThreadId = "550e8400-e29b-41d4-a716-446655440001";
const followUpId = "follow-up-check";
const editorOnlyId = "follow-up-owner-note";
const period = "2026-08-03 through 2026-08-10";
const originalQuestion = "Does the synthetic activation difference persist across segments?";
const revisedQuestion = "Check the revised synthetic definition before comparing the two periods.";
const revisedMarkdown = `**${revisedQuestion}**`;
const privateSentinels = ["RAW_ALPHA_ROW_73", "RAW_BETA_ROW_84", "SQL_ALPHA_SENTINEL", "SQL_BETA_SENTINEL",
  "UNRELATED_QUERY_SENTINEL"];
const query = (id, sentinel, sqlSentinel) => ({
  label: `Synthetic ${id}`, reportingField: "date",
  rows: [{ date: "2026-08-10", record: sentinel, value: 73 }],
  source: { label: `Synthetic ${id}`, sql: `SELECT '${sqlSentinel}' AS record FROM synthetic_${id}`,
    tables: [`synthetic_${id}`], executedAt: "2026-08-11T12:00:00Z",
    metricDefinitions: [{ label: "Value", definition: `Reviewed synthetic ${id} definition.` }] },
});
const snapshot = {
  id: "report-follow-up-contract", surface: "report", title: "Synthetic follow-up brief",
  status: "fixture", generatedAt: "2026-08-11T12:00:00Z", filters: [],
  queries: {
    alpha: query("alpha", privateSentinels[0], privateSentinels[2]),
    beta: query("beta", privateSentinels[1], privateSentinels[3]),
    unrelated: query("unrelated", privateSentinels[4], privateSentinels[4]),
  },
};
const authoredReport = `import React, { useRef, useState } from "react";
import { DataComponent, ReportSection, RichNarrative, useDataApp } from "../../data-app-public.jsx";
import { ReportDisclosure } from "../shared/ReportDisclosure.jsx";
import { ReportTaskLink } from "../shared/ReportTaskLink.jsx";
export function ReportContent() {
  const { appTitle, canEdit, mode, visible, requestTextEdit, requestReportFollowUp, reportFollowUpHref } = useDataApp();
  const textTarget = useRef(null);
  const [probeResult, setProbeResult] = useState(null);
  const followUp = { id: ${JSON.stringify(followUpId)}, narrativeId: ${JSON.stringify(`${followUpId}:body`)},
    text: ${JSON.stringify(originalQuestion)}, queryId: "alpha", queryIds: ["beta", "alpha"], period: ${JSON.stringify(period)} };
  async function probeViewerGuard() {
    const forged = { ...followUp, text: "Synthetic forbidden mutation probe", canEdit: true };
    const results = [];
    for (const action of ["report-investigate-update", "report-correct"])
      results.push(await requestReportFollowUp(action, forged));
    results.push(await requestReportFollowUp("report-investigate", { ...forged, editorOnly: true }));
    setProbeResult(results);
  }
  return <article className="report-content" aria-label="Synthetic follow-up fixture">
    <header className="report-hero"><h1>{appTitle}</h1></header>
    {visible(${JSON.stringify(followUpId)}) && <ReportSection id=${JSON.stringify(followUpId)} title="Check the comparison"
      queryId="alpha" queryIds={["beta", "alpha"]} showHeading={false}
      onEdit={() => requestTextEdit(textTarget.current)}>
      <div ref={textTarget}><RichNarrative id=${JSON.stringify(`${followUpId}:body`)} value=${JSON.stringify(originalQuestion)} /></div>
      <ReportTaskLink {...followUp}>Investigate comparison</ReportTaskLink>
      <ReportTaskLink {...followUp} intent="prepare" deliverable="recovery flow">Draft recovery flow</ReportTaskLink>
      {mode !== "edit" && <a className="report-task-link" href={reportFollowUpHref(followUp).href}
        target={reportFollowUpHref(followUp).target}>Legacy investigation</a>}
      {/* Invalid fixture-only handoffs must fail closed without blanking the report. */}
      <ReportTaskLink {...followUp} narrativeId="empty-request:body" text="">Invalid empty request</ReportTaskLink>
      <ReportTaskLink {...followUp} narrativeId="large-request:body" text={"A".repeat(4001)}>Invalid large request</ReportTaskLink>
      {/* Fixture-only probes exercise transport APIs without adding product controls. */}
      <div data-transport-probes>
        <button type="button" onClick={() => requestReportFollowUp("report-investigate", followUp)}>Probe investigation transport</button>
        <button type="button" onClick={() => requestReportFollowUp("report-investigate", {
          ...followUp, intent: "prepare", deliverable: "recovery flow" })}>Probe draft transport</button>
        {canEdit && <>
          <button type="button" onClick={() => requestReportFollowUp("report-investigate-update", followUp)}>Probe update transport</button>
          <button type="button" onClick={() => requestReportFollowUp("report-correct", followUp)}>Probe correction transport</button>
        </>}
      </div>
    </ReportSection>}
    {canEdit && <ReportSection id=${JSON.stringify(editorOnlyId)} title="Owner review" queryId="beta" showHeading={false}>
      <RichNarrative id=${JSON.stringify(`${editorOnlyId}:body`)} value="Review the synthetic source definition with the author." />
    </ReportSection>}
    <DataComponent id="disclosed-evidence" title="Evidence remains reachable" queryId="alpha" kind="custom">
      <p>The main finding stays visible.</p>
      <ReportDisclosure id="synthetic-methods" label="Show complete evidence">
        <RichNarrative id="synthetic-methods:body" value="READER_DISCLOSED_EVIDENCE_SENTINEL" />
        <table><caption>Synthetic complete evidence</caption><tbody><tr><th>Reviewed count</th><td>73</td></tr></tbody></table>
      </ReportDisclosure>
    </DataComponent>
    <button type="button" onClick={probeViewerGuard}>Probe viewer mutation guard</button>
    <output data-follow-up-probe-result>{probeResult && JSON.stringify(probeResult)}</output>
  </article>;
}`;

const block = (page, id = followUpId) => page.locator(`[data-component-id="${id}"]`);
async function openActions(page, id = followUpId) {
  await block(page, id).getByRole("button", { name: / actions$/u }).click();
}
async function chooseAction(page, name, id = followUpId) {
  await openActions(page, id);
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function installHostMock(page) {
  await page.addInitScript(() => {
    window.__followUpPrompts = [];
    window.__followUpLinks = [];
    window.__followUpHostMode = "accept";
    window.__followUpRegisteredTools = [];
    window.__followUpTools = new Map();
    Object.defineProperty(document, "modelContext", { configurable: true, value: {
      registerTool: (tool) => {
        window.__followUpRegisteredTools.push(tool.name);
        window.__followUpTools.set(tool.name, tool);
      }, unregisterTool: (name) => window.__followUpTools.delete(name),
    } });
    document.addEventListener("click", (event) => {
      const link = event.target.closest('a[href^="codex://"], a[href^="https://chatgpt.com/?"]');
      if (!link || event.defaultPrevented) return;
      event.preventDefault();
      window.__followUpLinks.push({ href: link.href, target: link.target });
    });
    window.openai = { sendFollowUpMessage: async (message) => {
      window.__followUpPrompts.push(message);
      if (window.__followUpHostMode === "throw") throw new Error("Synthetic host unavailable");
      return { isError: window.__followUpHostMode === "reject" };
    } };
  });
}
async function localPresentation(page) {
  return page.evaluate((id) => Object.entries(localStorage)
    .filter(([key]) => key.endsWith(`:${id}`))
    .map(([, value]) => JSON.parse(value).presentation).find(Boolean) ?? {}, snapshot.id);
}
function assertScopedPrompt(prompt, question) {
  assert.equal(typeof prompt, "string");
  assert.deepEqual(prompt.match(/\[@[^\]]+\]\(plugin:\/\/[^)]+\)/gu), [
    "[@Data](plugin://data-analytics@openai-curated-remote)",
  ]);
  if (prompt.includes("\n\n{")) {
    const context = JSON.parse(prompt.slice(prompt.indexOf("\n\n{") + 2));
    assert.equal(context.text, question, "The handoff must use the currently displayed question");
    assert.equal(context.componentId, followUpId, "The handoff must identify the exact follow-up block");
    assert.equal(context.narrativeId, `${followUpId}:body`);
    assert.deepEqual(context.sources.map(({ queryId }) => queryId), ["alpha", "beta"],
      "Only the selected, deduplicated reviewed source IDs may enter the handoff");
    assert.equal(context.period, period, "The handoff must retain the authored reporting period");
  } else {
    assert.ok(prompt.includes(question));
    assert.ok(prompt.includes(`Component: ${followUpId}; narrative: ${followUpId}:body.`));
    assert.ok(prompt.includes(period), "Authored reporting periods must survive even when absent from the snapshot");
    assert.match(prompt, /https:\/\/follow-up-fixture\.chatgpt\.site\/\?view=1/u);
    assert.match(prompt, /read its current Data app context/u);
    assert.doesNotMatch(prompt, /"sources"|"queries"|"presentation"/u);
  }
  for (const sentinel of privateSentinels) assert.ok(!prompt.includes(sentinel),
    `The handoff must not copy raw reviewed rows or SQL (${sentinel})`);
  assert.doesNotMatch(prompt, /SELECT\s+['"*]|FROM\s+synthetic_/iu);
}
function promptFromLink(link) {
  const url = new URL(link.href);
  assert.ok(url.protocol === "codex:" || url.origin === "https://chatgpt.com");
  assert.equal(url.hostname, url.protocol === "codex:" ? "new" : "chatgpt.com");
  assert.equal(url.pathname, url.protocol === "codex:" ? "" : "/",
    "A hosted handoff must not reopen an originating private local task");
  assert.equal(link.target, url.protocol === "codex:" ? "_self" : "_blank");
  if (url.protocol === "https:") assert.equal(url.searchParams.get("disable_auto_send"), "1");
  assert.ok(!link.href.includes(originatingThreadId));
  return url.searchParams.get("prompt") ?? url.searchParams.get("q");
}
function promptFromLocalLink(link) {
  const url = new URL(link.href);
  assert.equal(`${url.protocol}//${url.host}${url.pathname}`, `codex://threads/${originatingThreadId}`);
  assert.equal(link.target, "_self");
  assert.deepEqual([...url.searchParams.keys()], ["prompt"]);
  return url.searchParams.get("prompt");
}
function assertPreparationLink(link, question, { hosted = false } = {}) {
  const url = new URL(link.href);
  assert.equal(`${url.protocol}//${url.host}${url.pathname}`,
    url.protocol === "codex:" ? (hosted ? "codex://new" : `codex://threads/${originatingThreadId}`) : "https://chatgpt.com/");
  assert.equal(link.target, url.protocol === "codex:" ? "_self" : "_blank");
  if (url.protocol === "https:") assert.equal(url.searchParams.get("disable_auto_send"), "1");
  const prompt = url.searchParams.get("prompt") ?? url.searchParams.get("q");
  assertScopedPrompt(prompt, question);
  if (prompt.includes("\n\n{")) assert.deepEqual(JSON.parse(prompt.slice(prompt.indexOf("\n\n{") + 2)).request,
    { intent: "prepare", deliverable: "recovery flow" });
  else assert.match(prompt, /recovery flow/u);
  assert.match(prompt, /Prepare a reviewable draft/u);
  assert.match(prompt, /Do not edit the report(?: or act on the proposal|, implement the proposal, create tasks, schedule work, or execute external actions)/u);
  assert.ok(!prompt.includes(originalQuestion), "The authored fallback must not replace the saved recommendation");
}

let browser;
const errors = [];
try {
  cpSync(template, project, { recursive: true,
    filter: (path) => !path.includes("/node_modules") && !path.includes("/dist") });
  writeFileSync(join(project, "src/data.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFileSync(join(project, "src/content/report/ReportContent.jsx"), authoredReport);
  const build = runDataAppFixtureBuild(project, { pluginRoot,
    env: { ...process.env, CODEX_SESSION_ID: originatingThreadId, CODEX_THREAD_ID: originatingThreadId } });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const compiledHtml = readFileSync(join(project, "dist/index.html"), "utf8");
  assert.ok(compiledHtml.includes(originatingThreadId), "The fixture must contain originating-task metadata");
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });

  const local = await browser.newPage({ userAgent: "CodexBrowser/1.0", viewport: { width: 1100, height: 850 } });
  local.on("pageerror", (error) => errors.push(error.message));
  await installHostMock(local);
  await local.goto(pathToFileURL(join(project, "dist/index.html")).href, { waitUntil: "load" });
  await block(local).getByRole("link", { name: "Investigate comparison", exact: true }).waitFor();
  assert.equal(await local.getByRole("link", { name: /^Invalid (empty|large) request$/u }).count(), 0);
  assert.equal(await block(local, editorOnlyId).count(), 1, "The fixture exposes its owner-only section to the owner");
  const directLink = local.getByRole("link", { name: "Investigate comparison", exact: true });
  const beforeDirect = await localPresentation(local);
  assert.equal(await directLink.locator("a,button,[contenteditable]").count(), 0,
    "A direct task link must not contain nested controls");
  await directLink.focus();
  await directLink.press("Enter");
  const direct = (await local.evaluate(() => window.__followUpLinks))[0];
  assertScopedPrompt(promptFromLocalLink(direct), originalQuestion);
  assert.deepEqual(await local.evaluate(() => window.__followUpPrompts), [],
    "A direct task link stays unsent even when a local host accepts prompts");
  assert.deepEqual(await localPresentation(local), beforeDirect, "A direct task link must not change the report");
  assert.equal(await block(local).getByRole("status").count(), 0, "An intercepted link must not claim success");
  await local.evaluate(() => { window.__followUpLinks = []; });

  const disclosure = block(local, "disclosed-evidence");
  const disclosureToggle = disclosure.getByRole("button", { name: "Show complete evidence", exact: true });
  const disclosedText = disclosure.getByText("READER_DISCLOSED_EVIDENCE_SENTINEL", { exact: true });
  assert.equal(await disclosureToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await disclosedText.isVisible(), false);
  assert.ok(await disclosure.getByRole("button", { name: / actions$/u }).isVisible(),
    "A collapsed disclosure must leave its enclosing source component reachable");
  await disclosureToggle.focus();
  await disclosureToggle.press("Enter");
  assert.equal(await disclosureToggle.getAttribute("aria-expanded"), "true");
  assert.ok(await disclosedText.isVisible());
  assert.ok(await disclosure.getByRole("table", { name: "Synthetic complete evidence" }).isVisible());
  await local.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  assert.equal(await disclosureToggle.getAttribute("aria-expanded"), "true",
    "Entering Edit mode preserves an already-open evidence disclosure");
  assert.equal(await disclosureToggle.isDisabled(), false);
  await disclosure.locator('[data-editable-id="synthetic-methods:body"] [contenteditable="true"]').waitFor();
  await disclosureToggle.click();
  assert.equal(await disclosedText.isVisible(), false, "Evidence can be closed while editing");
  await local.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await disclosureToggle.getAttribute("aria-expanded"), "false",
    "Leaving Edit mode preserves the reader's evidence choice");

  await chooseAction(local, "Edit text");
  assert.equal(await disclosureToggle.getAttribute("aria-expanded"), "false",
    "Editing another block must not auto-expand evidence");
  assert.equal(await disclosedText.isVisible(), false);
  assert.equal(await local.getByRole("link", { name: "Investigate comparison", exact: true }).count(), 0,
    "The authored report keeps launch links out of Edit mode");
  const editor = block(local).locator(`[data-editable-id="${followUpId}:body"] [contenteditable="true"]`);
  await editor.waitFor();
  await editor.fill(revisedQuestion);
  await editor.selectText();
  const formatToolbar = local.getByRole("toolbar", { name: "Format selected text" });
  await formatToolbar.waitFor();
  await formatToolbar.getByRole("button", { name: "Bold", exact: true }).click();
  await local.keyboard.press("Escape");
  await editor.blur();
  await saveReportEdits(local);
  await local.waitForFunction(({ id, value }) => Object.values(localStorage).some((entry) =>
    JSON.parse(entry).presentation?.textEdits?.[`${id}:body`] === value), { id: followUpId, value: revisedMarkdown });
  await local.emulateMedia({ media: "print" });
  assert.ok(await disclosedText.isVisible(), "Print reveals reader evidence even when collapsed on screen");
  assert.ok(await disclosure.getByRole("table", { name: "Synthetic complete evidence" }).isVisible());
  assert.equal(await disclosureToggle.isVisible(), false, "Disclosure controls must not print");
  assert.match(await block(local).innerText(), new RegExp(revisedQuestion, "u"), "Reader recommendations must print");
  const pdf = await local.pdf({ format: "A4" });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF", "Chromium must produce a real print artifact");
  await local.emulateMedia({ media: "screen" });
  assert.equal(await disclosedText.isVisible(), false, "Printing must restore collapsed screen evidence");

  const presentationBeforeHandoff = await localPresentation(local);
  await block(local).getByRole("button", { name: "Probe investigation transport", exact: true }).click();
  await local.waitForFunction(() => window.__followUpLinks.length === 1);
  await block(local).getByRole("button", { name: "Probe update transport", exact: true }).click();
  await local.waitForFunction(() => window.__followUpLinks.length === 2);
  await block(local).getByRole("button", { name: "Probe correction transport", exact: true }).click();
  await local.waitForFunction(() => window.__followUpLinks.length === 3);
  const messages = (await local.evaluate(() => window.__followUpLinks)).map(link => ({ prompt: promptFromLocalLink(link) }));
  for (const message of messages) assertScopedPrompt(message.prompt, revisedMarkdown);
  assert.equal(new Set(messages.map(({ prompt }) => prompt)).size, 3,
    "Read-only investigation, report update, and correction must have distinct instructions");
  assert.match(messages[0].prompt, /(?:do not|without|never)[^.\n]*(?:modify|edit|update|change)[^.\n]*(?:report|artifact)|answer[^.\n]*(?:chat|conversation)/iu,
    "Investigate must request an answer without silently editing the report");
  assert.match(messages[1].prompt, /(?:update|revise)[^.\n]*(?:report|artifact)|\$build-report/iu,
    "Investigate and update must explicitly request an artifact revision");
  assert.match(messages[2].prompt, /correct|correction/iu,
    "Correct with Codex must make correction intent explicit");
  assert.deepEqual(await localPresentation(local), presentationBeforeHandoff,
    "Sending a follow-up must not mutate local presentation state");
  assert.deepEqual(await local.evaluate(() => window.__followUpPrompts), [],
    "Imperative report buttons must use the same deeplink transport even when a host bridge accepts prompts");

  for (const hostMode of ["reject", "throw"]) {
    await local.evaluate((mode) => { window.__followUpHostMode = mode; }, hostMode);
    const attempts = await local.evaluate(() => window.__followUpLinks.length);
    await block(local).getByRole("button", { name: "Probe investigation transport", exact: true }).click();
    await local.waitForFunction(count => window.__followUpLinks.length === count + 1, attempts);
    assertScopedPrompt(promptFromLocalLink((await local.evaluate(() => window.__followUpLinks)).at(-1)), revisedMarkdown);
    assert.deepEqual(await local.evaluate(() => window.__followUpPrompts), [],
      `An available ${hostMode} bridge must not change deeplink behavior`);
    assert.deepEqual(await localPresentation(local), presentationBeforeHandoff,
      `A ${hostMode} result must not mutate the report`);
  }
  await local.evaluate(() => { window.__followUpHostMode = "accept"; });

  await local.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  await chooseAction(local, "Hide");
  await block(local).waitFor({ state: "hidden" });
  await saveReportEdits(local);
  await local.reload({ waitUntil: "load" });
  await block(local, editorOnlyId).waitFor();
  assert.equal(await block(local).count(), 0, "A hidden follow-up must remain hidden after reload");
  await local.getByRole("button", { name: "Edit text and layout", exact: true }).click();
  await local.getByRole("button", { name: "Restore hidden (1)", exact: true }).click();
  await block(local).waitFor();
  assert.ok((await block(local).innerText()).includes(revisedQuestion),
    "Restoring a follow-up must retain its edited text");
  await saveReportEdits(local);

  const beforePrepareSends = await local.evaluate(() => window.__followUpPrompts.length);
  const draftLink = local.getByRole("link", { name: "Draft recovery flow", exact: true });
  assertPreparationLink(await draftLink.evaluate((element) => ({ href: element.href, target: element.target })), revisedMarkdown);
  await draftLink.click();
  assertPreparationLink((await local.evaluate(() => window.__followUpLinks)).at(-1), revisedMarkdown);
  assert.equal(await local.evaluate(() => window.__followUpPrompts.length), beforePrepareSends,
    "A specific prepare link must prefill the original thread without invoking an accepting host bridge");
  const beforePrepareLinks = await local.evaluate(() => window.__followUpLinks.length);
  await block(local).getByRole("button", { name: "Probe draft transport", exact: true }).click();
  await local.waitForFunction(count => window.__followUpLinks.length === count + 1, beforePrepareLinks);
  assertPreparationLink((await local.evaluate(() => window.__followUpLinks)).at(-1), revisedMarkdown);
  assert.deepEqual(await local.evaluate(() => window.__followUpPrompts), []);

  // Serve only this compiled synthetic app. Every request is intercepted, and the
  // generated handoff links are captured before navigation or a real prompt send.
  const writes = [];
  let canEdit = false;
  let revision = 0;
  let hostedPresentation = { textEdits: { [`${followUpId}:body`]: revisedMarkdown } };
  const hosted = await browser.newPage({ viewport: { width: 390, height: 844 } });
  hosted.on("pageerror", (error) => errors.push(error.message));
  await installHostMock(hosted);
  await hosted.route("https://follow-up-fixture.chatgpt.site/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() !== "GET") writes.push({ path: pathname, method: request.method(), body: request.postDataJSON() });
    if (pathname === "/api/snapshot") return route.fulfill({ contentType: "application/json", body: JSON.stringify(snapshot) });
    if (pathname === "/api/presentation") {
      if (request.method() === "PUT" && canEdit) {
        hostedPresentation = request.postDataJSON().presentation;
        revision += 1;
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ canEdit, revision, presentation: hostedPresentation }) });
    }
    return route.fulfill({ contentType: "text/html", body: compiledHtml });
  });
  await hosted.goto("https://follow-up-fixture.chatgpt.site/", { waitUntil: "load" });
  await block(hosted).getByRole("link", { name: "Investigate comparison", exact: true }).waitFor();
  assert.equal(await hosted.getByRole("link", { name: /^Invalid (empty|large) request$/u }).count(), 0);
  assert.equal(await block(hosted, editorOnlyId).count(), 0, "The fixture omits its owner-only section for viewers");
  for (const name of ["Probe update transport", "Probe correction transport"])
    assert.equal(await hosted.getByRole("button", { name, exact: true }).count(), 0);
  assert.equal(await hosted.getByRole("button", { name: "Edit text and layout", exact: true }).count(), 0);
  assert.equal(await hosted.locator('[contenteditable="true"]').count(), 0);
  assert.deepEqual((await hosted.evaluate(() => window.__followUpRegisteredTools)).sort(), [
    "get_data_app_context", "get_data_app_query_rows", "get_data_app_text",
    "list_data_app_cards", "get_data_app_card_image", "get_data_app_card_images",
  ].sort(), "A hosted viewer may read its context and visible card images but must not receive mutation tools");
  const linkedContext = await hosted.evaluate(async (id) => {
    const context = await window.__followUpTools.get("get_data_app_context").execute({});
    const text = await window.__followUpTools.get("get_data_app_text").execute({ id, contextVersion: context.contextVersion });
    return { artifactId: context.artifact.id, canEdit: context.canEdit, text: text.text,
      savedText: context.presentation.textEdits[id] };
  }, `${followUpId}:body`);
  assert.deepEqual(linkedContext, { artifactId: snapshot.id, canEdit: false, text: revisedQuestion, savedText: revisedMarkdown },
    "The compact selected-item link must lead to the actual saved narrative through the current browser context");
  await hosted.getByRole("button", { name: "Probe viewer mutation guard", exact: true }).click();
  await hosted.locator("[data-follow-up-probe-result]").getByText("[false,false,false]", { exact: true }).waitFor();
  assert.deepEqual(await hosted.evaluate(() => window.__followUpPrompts), [],
    "The shell must reject forged viewer mutation requests before the host bridge");
  assert.deepEqual(await hosted.evaluate(() => window.__followUpLinks), [],
    "The shell must reject forged viewer mutation requests before fallback navigation");
  assert.deepEqual(writes, [], "The viewer permission guard must reject mutation before any hosted write");
  await openActions(hosted);
  for (const name of ["Investigate and update", "Correct with Codex", "Edit text", "Hide"]) {
    assert.equal(await hosted.getByRole("menuitem", { name, exact: true }).count(), 0,
      `A hosted viewer must not be offered ${name}`);
  }
  await hosted.keyboard.press("Escape");
  await chooseAction(hosted, "View data source");
  const source = hosted.getByRole("complementary", { name: /Data source for/u });
  await source.getByRole("tab", { name: "Overview", exact: true }).waitFor();
  assert.match(await source.innerText(), /Reviewed synthetic alpha definition/u);
  await source.getByRole("button", { name: "Choose reviewed data source" }).click();
  await hosted.getByRole("menuitemradio", { name: "Synthetic beta", exact: true }).click();
  assert.match(await source.innerText(), /Reviewed synthetic beta definition/u);
  await source.getByRole("button", { name: "Close data source", exact: true }).click();
  await source.waitFor({ state: "hidden" });
  await block(hosted).getByRole("button", { name: "Probe investigation transport", exact: true }).click();
  await chooseHostedHandoff(hosted, "web");
  await hosted.waitForFunction(() => window.__followUpLinks.length === 1);
  assertScopedPrompt(promptFromLink((await hosted.evaluate(() => window.__followUpLinks))[0]), revisedMarkdown);
  assert.deepEqual(await hosted.evaluate(() => window.__followUpPrompts), [],
    "Sites follow-ups must use the existing link transport, not send through an injected host bridge");
  assert.deepEqual(writes, [], "A hosted viewer investigation must not write data or presentation");
  await hosted.getByRole("link", { name: "Investigate comparison", exact: true }).click();
  await chooseHostedHandoff(hosted, "desktop");
  const readerLink = (await hosted.evaluate(() => window.__followUpLinks)).at(-1);
  assertScopedPrompt(promptFromLink(readerLink), revisedMarkdown);
  assert.equal(`${new URL(readerLink.href).protocol}//${new URL(readerLink.href).host}`, "codex://new",
    "A desktop reader investigation must create a new task without targeting the owner's local project");
  await hosted.getByRole("link", { name: "Draft recovery flow", exact: true }).click();
  await chooseHostedHandoff(hosted, "web");
  assertPreparationLink((await hosted.evaluate(() => window.__followUpLinks)).at(-1), revisedMarkdown, { hosted: true });
  await block(hosted).getByRole("button", { name: "Probe draft transport", exact: true }).click();
  await chooseHostedHandoff(hosted, "web");
  assertPreparationLink((await hosted.evaluate(() => window.__followUpLinks)).at(-1), revisedMarkdown, { hosted: true });
  for (const path of [originatingThreadId, "new"]) {
    const legacy = hosted.getByRole("link", { name: "Legacy investigation", exact: true });
    await legacy.evaluate((element, path) => {
      const previous = new URL(element.href);
      const url = new URL(`codex://threads/${path}`);
      url.searchParams.set("prompt", previous.searchParams.get("q") ?? previous.searchParams.get("prompt"));
      element.href = url.toString();
    }, path);
    await legacy.click();
    await chooseHostedHandoff(hosted, "desktop");
    assertScopedPrompt(promptFromLink((await hosted.evaluate(() => window.__followUpLinks)).at(-1)), revisedMarkdown);
  }
  assert.deepEqual(await hosted.evaluate(() => window.__followUpPrompts), []);
  assert.deepEqual(writes, [], "Preparing a draft must not write the viewer's shared report");

  canEdit = true;
  await hosted.reload({ waitUntil: "load" });
  await block(hosted, editorOnlyId).waitFor();
  await block(hosted).getByRole("button", { name: "Probe update transport", exact: true }).click();
  await chooseHostedHandoff(hosted, "web");
  await hosted.waitForFunction(() => window.__followUpLinks.length === 1);
  const updateLink = (await hosted.evaluate(() => window.__followUpLinks))[0];
  const updatePrompt = promptFromLink(updateLink);
  assertScopedPrompt(updatePrompt, revisedMarkdown);
  assert.match(updatePrompt, /(?:update|revise)[^.\n]*(?:report|artifact)|\$build-report/iu);
  assert.deepEqual(writes, [], "An owner handoff requests a later revision; it must not directly write the hosted artifact");
  assert.deepEqual(errors, [], "Follow-up browser runtime emitted errors");
  assert.deepEqual(JSON.parse(readFileSync(join(project, "src/data.json"), "utf8")), snapshot,
    "Follow-up interactions must not alter the synthetic reviewed snapshot");
  console.log(JSON.stringify({ status: "passed", interactions: ["current edited Markdown", "scoped source IDs",
    "distinct investigation/update/correction", "specific draft survives saved edits", "prepare reuses local origin", "host bridges remain unused", "legacy report links use chooser", "hide/reload/restore",
    "direct unsent task links", "disclosure keyboard/edit/print state", "hosted viewer permission", "hosted handoff without mutation"] }, null, 2));
} finally {
  await browser?.close();
  rmSync(project, { recursive: true, force: true });
}
