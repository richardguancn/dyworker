import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chooseHostedHandoff } from "./data-app-browser-handoff.mjs";

async function settleSelectionUi(page) {
  await page.evaluate(
    () =>
      new Promise((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
      }),
  );
}

export async function verifyAskChatGPTSelectionContext(page, { componentTitle, selectedContextIncludes }) {
  const actions = page.getByRole("dialog", { name: "Selection actions" });
  await actions.getByRole("button", { name: "Ask ChatGPT", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Ask ChatGPT about this dashboard" });
  const questionInput = composer.getByRole("textbox", { name: "Question for ChatGPT" });
  const question = "Explain this selected dashboard evidence.";
  await questionInput.fill(question);
  const sendLink = composer.getByRole("link", { name: "Send to ChatGPT" });
  await sendLink.waitFor();
  const href = new URL(await sendLink.getAttribute("href"));
  const prompt = href.searchParams.get("prompt") ?? href.searchParams.get("q");
  assert.ok(prompt, "Selection actions must construct a real question handoff");
  assert.equal(
    prompt.split("\n").at(-1),
    `Question: ${question}`,
    "The selected-context handoff must retain the entered question as its final labeled line",
  );
  assert.ok(
    prompt.includes(`Chart: ${componentTitle}\n`),
    "The question must refer to the selected component, not the entire dashboard",
  );
  const selectedContext = /^Selected (?:point|context): (.+)$/mu.exec(prompt)?.[1];
  assert.ok(
    selectedContext && selectedContext !== "Entire dashboard",
    "Selection actions must retain nonempty selected evidence",
  );
  if (selectedContextIncludes) {
    assert.ok(selectedContext.includes(selectedContextIncludes), "The handoff must retain the selected label or text");
  }
  await questionInput.fill("");
  await page.keyboard.press("Escape");
  await composer.waitFor({ state: "hidden" });
}

export async function verifyEditorAskChatGPTSelectionModes(page) {
  const selectedBar = page.locator('[data-component-id="segment-breakdown"] .chart-ranked-list-row').first();
  await selectedBar.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Edit text and layout" }).click();
  await selectedBar.click();
  await settleSelectionUi(page);
  assert.equal(
    await page.getByRole("dialog", { name: "Selection actions" }).count(),
    0,
    "Ask ChatGPT must stay hidden in edit mode",
  );
  assert.equal(
    await page.locator(".dashboard-ask-selected-region").count(),
    0,
    "Edit mode must not show chart-selection regions",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Edit text and layout" }).waitFor();

  await selectedBar.click();
  await settleSelectionUi(page);
  await page.getByRole("dialog", { name: "Selection actions" }).waitFor();
  assert.equal(
    await page.getByRole("dialog", { name: "Selection actions" }).count(),
    1,
    "Ordinary file/browser viewers may select marks regardless of edit permission",
  );
  await page.keyboard.press("Escape");
}

export async function verifyLocalAskChatGPTHandoff(page, {
  originatingThreadId,
  projectRoot = dirname(dirname(fileURLToPath(page.url()))).replaceAll("\\", "/"),
}) {
  const original = await page.evaluate(() => ({
    markerPresent: Object.hasOwn(window, "__codexBrowser"),
    marker: window.__codexBrowser,
    userAgent: navigator.userAgent,
    threadId: document.querySelector('meta[name="data-app-local-thread"]')?.content,
    linkCount: window.__dashboardDeepLinks.length,
  }));
  assert.doesNotMatch(original.userAgent, /^(?:CodexBrowser|ChatGPTBrowser)(?:\s|\/|$)/u);
  assert.equal(original.threadId, originatingThreadId);
  const assertLocalDestination = (href, threadId) => {
    assert.equal(`${href.protocol}//${href.host}${href.pathname}`, threadId ? `codex://threads/${threadId}` : "codex://new");
    assert.deepEqual([...href.searchParams.keys()], threadId ? ["prompt"] : ["prompt", "path"]);
    assert.equal(href.searchParams.get("path"), threadId ? null : projectRoot);
  };
  try {
    for (const { codexMarker, threadId } of [
      { codexMarker: false, threadId: originatingThreadId },
      { codexMarker: true, threadId: originatingThreadId },
      { codexMarker: false, threadId: null },
    ]) {
      await page.evaluate(({ codexMarker, threadId }) => {
        if (codexMarker) window.__codexBrowser = true;
        else delete window.__codexBrowser;
        const meta = document.querySelector('meta[name="data-app-local-thread"]');
        if (threadId == null) meta.remove();
        else meta.content = threadId;
      }, { codexMarker, threadId });
      await page.locator(".dashboard-ask-button").click();
      const composer = page.getByRole("dialog", { name: "Ask ChatGPT about this dashboard", exact: true });
      const suggestions = await composer.getByRole("group", { name: "Suggested actions", exact: true })
        .getByRole("link").evaluateAll(links => links.map(link => ({ href: link.href, target: link.target })));
      assert.ok(suggestions.length > 0);
      for (const suggestion of suggestions) {
        assertLocalDestination(new URL(suggestion.href), threadId);
        assert.equal(suggestion.target, "_self");
      }
      const questionInput = composer.getByRole("textbox", { name: "Question for ChatGPT", exact: true });
      const question = "Explain this dashboard.";
      await questionInput.fill(question);
      const send = composer.getByRole("link", { name: "Send to ChatGPT", exact: true });
      const href = new URL(await send.getAttribute("href"));
      assertLocalDestination(href, threadId);
      assert.equal(await send.getAttribute("target"), "_self");
      assert.ok(href.searchParams.get("prompt").endsWith(`Question: ${question}`));
      assert.equal(await page.getByRole("dialog", { name: "Open in ChatGPT", exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => typeof window.openai), "undefined");
      await questionInput.fill("");
      await page.keyboard.press("Escape");
      await composer.waitFor({ state: "hidden" });
    }
    assert.equal(await page.evaluate(() => window.__dashboardDeepLinks.length), original.linkCount,
      "Preparing an Ask link must not activate a handoff");
  } finally {
    await page.evaluate(({ markerPresent, marker, threadId }) => {
      if (markerPresent) window.__codexBrowser = marker;
      else delete window.__codexBrowser;
      const meta = document.querySelector('meta[name="data-app-local-thread"]') ?? document.createElement("meta");
      meta.name = "data-app-local-thread";
      meta.content = threadId;
      if (!meta.isConnected) document.head.append(meta);
    }, original);
  }
}

export async function verifyViewerAskChatGPTHandoff(page) {
  await page.evaluate(() => {
    const marker = document.createElement("meta");
    marker.name = "data-app-sites-project";
    marker.content = "appgprj_browser_handoff";
    document.head.append(marker);
  });
  const selectedBar = page.locator('[data-component-id="segment-breakdown"] .chart-ranked-list-row').first();
  await selectedBar.scrollIntoViewIfNeeded();
  await selectedBar.click();
  await settleSelectionUi(page);

  const selectionActions = page.getByRole("dialog", {
    name: "Selection actions",
  });
  await selectionActions.waitFor();
  await selectionActions.getByRole("button", { name: "Ask ChatGPT" }).click();
  const composer = page.getByRole("dialog", {
    name: "Ask ChatGPT about this dashboard",
  });
  await composer.waitFor();
  assert.equal(
    await composer.getByText("Send to ChatGPT", { exact: true }).count(),
    0,
    "The handoff label must stay hidden until the viewer enters a question",
  );

  const viewerQuestion = "What explains this segment?";
  await composer.getByRole("textbox", { name: "Question for ChatGPT" }).fill(viewerQuestion);
  const sendLink = composer.getByRole("link", { name: "Send to ChatGPT" });
  assert.deepEqual(
    await sendLink.locator(".dashboard-ask-primary").evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        radius: getComputedStyle(button).borderRadius,
      };
    }),
    { width: 28, height: 28, radius: "50%" },
    "The handoff action must use the 28px circular system button",
  );

  await sendLink.click();
  await chooseHostedHandoff(page, "web");
  await page.waitForFunction(() => window.__dashboardDeepLinks.length === 1);
  const chatGPTLink = new URL((await page.evaluate(() => window.__dashboardDeepLinks))[0]);
  const chatGPTPrompt = chatGPTLink.searchParams.get("q");
  assert.equal(`${chatGPTLink.origin}${chatGPTLink.pathname}`, "https://chatgpt.com/");
  assert.deepEqual([...chatGPTLink.searchParams.keys()], ["q", "disable_auto_send"]);
  assert.equal(chatGPTLink.searchParams.get("disable_auto_send"), "1");
  assert.ok(chatGPTPrompt.startsWith(viewerQuestion));
  assert.ok(chatGPTPrompt.includes("https://dashboard.chatgpt.site/published?view=1&tab=dashboard"));
  assert.match(chatGPTPrompt, /read its current Data app context/u);
  assert.match(chatGPTPrompt, /Chart: Active accounts by feature/u);
  assert.match(chatGPTPrompt, /Selected point: .+/u);
  assert.doesNotMatch(chatGPTPrompt, /Dashboard URL:|token=secret|#private-section/u);
  await composer.waitFor({ state: "hidden" });
  assert.equal(await composer.count(), 0, "The composer must close after handing the question to ChatGPT");
  await page.evaluate(() => {
    window.__dashboardDeepLinks = [];
  });

  const externalUserAgent = await page.evaluate(() => navigator.userAgent);
  try {
    for (const userAgent of [externalUserAgent, "CodexBrowser/1.0"]) {
      const desktop = userAgent === "CodexBrowser/1.0";
      await page.evaluate((value) => Object.defineProperty(navigator, "userAgent", { configurable: true, value }), userAgent);
      await page.locator(".dashboard-ask-button").click();
      const dashboardComposer = page.getByRole("dialog", {
        name: "Ask ChatGPT about this dashboard",
      });
      const dashboardQuestion = "What should I know about this dashboard?";
      await dashboardComposer.getByRole("textbox", { name: "Question for ChatGPT" }).fill(dashboardQuestion);
      const dashboardSend = dashboardComposer.getByRole("link", { name: "Send to ChatGPT" });
      await dashboardSend.click();
      await chooseHostedHandoff(page, desktop ? "desktop" : "web");
      await page.waitForFunction(() => window.__dashboardDeepLinks.length === 1);
      const dashboardLink = new URL((await page.evaluate(() => window.__dashboardDeepLinks))[0]);
      assert.equal(`${dashboardLink.protocol}//${dashboardLink.host}${dashboardLink.pathname}`,
        desktop ? "codex://new" : "https://chatgpt.com/");
      assert.deepEqual([...dashboardLink.searchParams.keys()], desktop ? ["prompt", "browserUrl"] : ["q", "disable_auto_send"]);
      if (!desktop) assert.equal(dashboardLink.searchParams.get("disable_auto_send"), "1");
      if (desktop) assert.equal(dashboardLink.searchParams.get("browserUrl"), "https://dashboard.chatgpt.site/published?view=1&tab=dashboard");
      const prompt = dashboardLink.searchParams.get(desktop ? "prompt" : "q");
      assert.ok(prompt.startsWith(dashboardQuestion));
      assert.ok(prompt.includes("https://dashboard.chatgpt.site/published?view=1&tab=dashboard"));
      assert.match(prompt, /read its current Data app context/u);
      assert.match(prompt, /Selected context: Entire dashboard/u);
      await dashboardComposer.waitFor({ state: "hidden" });
      await page.evaluate(() => { window.__dashboardDeepLinks = []; });
    }
  } finally {
    await page.evaluate((value) => Object.defineProperty(navigator, "userAgent", { configurable: true, value }), externalUserAgent);
  }
}
