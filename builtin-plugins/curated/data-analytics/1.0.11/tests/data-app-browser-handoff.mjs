import assert from "node:assert/strict";

export async function chooseHostedHandoff(page, destination, { remember = false } = {}) {
  const dialog = page.getByRole("dialog", { name: "Open in ChatGPT", exact: true });
  await dialog.waitFor();
  const checkbox = dialog.getByRole("checkbox", { name: "Remember in this browser", exact: true });
  if (await checkbox.count()) assert.equal(await checkbox.isChecked(), false, "Each fresh destination choice starts unremembered");
  else assert.equal(remember, false, "Unsupported origins cannot remember a destination");
  if (remember) await checkbox.check();
  const desktop = destination === "desktop";
  const choice = dialog.getByRole("link", { name: desktop ? "Open in desktop" : "Open on web", exact: true });
  const href = new URL(await choice.getAttribute("href"));
  assert.equal(href.protocol, desktop ? "codex:" : "https:");
  if (!desktop) assert.equal(href.searchParams.get("disable_auto_send"), "1");
  assert.equal(await choice.getAttribute("target"), desktop ? "_self" : "_blank");
  await choice.click();
  await dialog.waitFor({ state: "hidden" });
  return href;
}

export async function verifyHostedHandoffChoices(page, { originatingThreadId, screenshotPath }) {
  const chooser = page.getByRole("dialog", { name: "Open in ChatGPT", exact: true });
  const count = () => page.evaluate(() => window.__dashboardDeepLinks.length);
  const installHostProbe = () => page.evaluate(() => {
    window.__publishedHostPrompts = [];
    window.openai = { sendFollowUpMessage: async message => {
      window.__publishedHostPrompts.push(message);
      return { isError: false };
    } };
  });
  const openAsk = async () => {
    const composer = page.getByRole("dialog", { name: "Ask ChatGPT about this dashboard", exact: true });
    if (!(await composer.isVisible())) await page.locator(".dashboard-ask-button").click();
    return composer;
  };
  const chooseSuggestion = async () => {
    const composer = await openAsk();
    await composer.getByRole("link", { name: "Share key insights" }).click();
  };
  const chooseMenuAction = async name => {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  const assertLatest = async (destination, route) => {
    const href = new URL(await page.evaluate(() => window.__dashboardDeepLinks.at(-1)));
    const desktop = destination === "desktop";
    assert.equal(`${href.protocol}//${href.host}${href.pathname}`, desktop ? route : "https://chatgpt.com/");
    assert.equal(await page.evaluate(() => window.__dashboardLastDeepLinkTarget), desktop ? "_self" : "_blank");
    assert.equal(href.searchParams.has("path"), false, "Hosted actions cannot open an owner's local working directory");
    assert.equal(href.href.includes(originatingThreadId), false, "Hosted choices never recover a private originating thread");
    if (!desktop) assert.equal(href.searchParams.get("disable_auto_send"), "1");
    assert.doesNotMatch(href.href, /token=|secret|private-section/u);
    assert.deepEqual(await page.evaluate(() => window.__publishedHostPrompts), [], "Choosing a destination never sends through the host bridge");
    return href.searchParams.get(desktop ? "prompt" : "q");
  };
  assert.equal(await count(), 0);
  await installHostProbe();
  await chooseSuggestion();
  await chooser.waitFor();
  assert.equal(await count(), 0, "Opening a destination chooser must not activate the underlying handoff");
  assert.equal(await chooser.getByRole("checkbox", { name: "Remember in this browser", exact: true }).count(), 0, "Personal Sites cannot save a workspace preference");
  await chooser.getByRole("button", { name: "Cancel", exact: true }).click();
  await chooser.waitFor({ state: "hidden" });
  assert.equal(await count(), 0, "Canceling a destination choice must not open or send anything");

  await page.evaluate(() => {
    const marker = document.createElement("meta");
    marker.name = "data-app-sites-project";
    marker.content = "appgprj_browser_handoff";
    document.head.append(marker);
  });
  const question = "Explain this synthetic dashboard.";
  const composer = await openAsk();
  await composer.getByRole("textbox", { name: "Question for ChatGPT" }).fill(question);
  await composer.getByRole("link", { name: "Send to ChatGPT", exact: true }).click();
  await chooser.waitFor();
  if (screenshotPath) await page.screenshot({ path: screenshotPath, animations: "disabled" });
  await page.keyboard.press("Escape");
  await chooser.waitFor({ state: "hidden" });
  assert.equal(await composer.getByRole("textbox", { name: "Question for ChatGPT" }).inputValue(), question,
    "Canceling the destination chooser must retain a typed question");
  assert.equal(await count(), 0);
  await composer.getByRole("link", { name: "Send to ChatGPT", exact: true }).click();
  await chooseHostedHandoff(page, "desktop");
  assert.equal(await count(), 1);
  const prompt = await assertLatest("desktop", "codex://new");
  assert.ok(prompt.startsWith(question));
  assert.match(prompt, /Selected context: Entire dashboard/u,
    "The header action must use the whole dashboard even while selection actions are available");
  assert.match(prompt, /read its current Data app context/u);

  await chooseMenuAction("Jupyter Notebook");
  await chooseHostedHandoff(page, "web");
  assert.equal(await count(), 2, "An unchecked desktop choice must prompt again for the next action");
  assert.match(await assertLatest("web"), /\$data-analytics:jupyter-notebooks/u);
  await chooseSuggestion();
  await chooseHostedHandoff(page, "web");
  assert.equal(await count(), 3, "A personal Site without workspace cookie scope must ask again without a persistent preference");
  await assertLatest("web");

  await page.reload({ waitUntil: "load" });
  await page.locator(".dashboard-topbar-title").waitFor();
  await installHostProbe();
  await chooseSuggestion();
  await chooseHostedHandoff(page, "desktop");
  assert.equal(await count(), 1, "An unremembered choice cannot survive refresh");
  await assertLatest("desktop", "codex://new");
  await chooseMenuAction("Create a copy");
  await chooseHostedHandoff(page, "desktop");
  assert.equal(await count(), 2, "An unremembered desktop choice must ask again for menu actions");
  await assertLatest("desktop", "codex://new");
  await page.reload({ waitUntil: "load" });
  await page.locator(".dashboard-topbar-title").waitFor();
}
