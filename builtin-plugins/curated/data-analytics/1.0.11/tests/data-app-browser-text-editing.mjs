import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDataAppFixtureBuild } from "./browser-helpers.mjs";

export async function verifyHostedTextEditing({ browser, pluginRoot }) {
  const project = mkdtempSync(join(tmpdir(), "data-hosted-text-"));
  const template = join(pluginRoot, "templates/data-app/base");
  const contexts = [];
  const releaseContentRequests = [];
  const errors = [];
  const writes = [];
  const reads = [];
  let record = { canEdit: true, revision: 0, presentation: {} };
  try {
    cpSync(template, project, {
      recursive: true,
      filter: (path) => !["node_modules", "dist", "examples"].some((part) =>
        path === join(template, part) || path.startsWith(`${join(template, part)}/`)),
    });
    const snapshotPath = join(project, "src/data.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    snapshot.id = "hosted-text-regression";
    snapshot.title = "Hosted text regression";
    snapshot.filters = [];
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`);
    writeFileSync(join(project, "src/content/dashboard/DashboardContent.jsx"), `
import React, { useEffect, useState } from "react";
import { EditableText } from "../../data-app-public.jsx";

export function DashboardContent() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/fixture/content-ready").then((response) => response.json()).then(() => {
      if (active) setLoaded(true);
    });
    return () => { active = false; };
  }, []);
  return <article>
    <EditableText data-editable-id="fixture:caption" data-testid="caption">
      Original caption
    </EditableText>
    <EditableText data-editable-id="fixture:formatted" data-testid="formatted-copy">
      Original <strong>formatted</strong> statement
    </EditableText>
    {loaded && <EditableText data-editable-id="fixture:late" data-testid="late-copy">
      Original delayed paragraph
    </EditableText>}
  </article>;
}
`);
    const build = runDataAppFixtureBuild(project, { pluginRoot });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    const html = readFileSync(join(project, "dist/index.html"), "utf8")
      .replace(/<meta name="data-app-local-thread"[^>]*>\s*/gu, "");

    async function openPublishedPage() {
      const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
      contexts.push(context);
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      let releaseContent;
      const contentReady = new Promise((resolve) => { releaseContent = resolve; });
      releaseContentRequests.push(releaseContent);
      await page.route("**/*", async (route) => {
        const { hostname, pathname } = new URL(route.request().url());
        if (hostname !== "text-regression.chatgpt.site") return route.abort();
        if (pathname === "/fixture/content-ready") {
          await contentReady;
          return route.fulfill({ contentType: "application/json", body: "{}" });
        }
        if (pathname === "/api/presentation") {
          if (route.request().method() === "PUT") {
            const submitted = route.request().postDataJSON();
            assert.equal(submitted.revision, record.revision, "The owner saves against the acknowledged revision");
            writes.push(submitted);
            record = { canEdit: true, revision: record.revision + 1, presentation: submitted.presentation };
          } else {
            reads.push(structuredClone(record));
          }
          return route.fulfill({ contentType: "application/json", body: JSON.stringify(record) });
        }
        return route.fulfill(pathname === "/api/snapshot"
          ? { contentType: "application/json", body: JSON.stringify(snapshot) }
          : { contentType: "text/html", body: html });
      });
      await page.goto("https://text-regression.chatgpt.site/published", { waitUntil: "load" });
      await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
      assert.equal(await page.getByTestId("late-copy").count(), 0,
        "The async fixture must remain unmounted until its response is released");
      return { page, releaseContent };
    }

    async function saveText(page, id, value) {
      const saved = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/presentation"
        && response.request().method() === "PUT" && response.ok());
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const response = await saved;
      assert.equal(response.request().postDataJSON().presentation.textEdits[id], value);
      assert.equal((await response.json()).presentation.textEdits[id], value);
      await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
      assert.equal(record.presentation.textEdits[id], value, "Saved text must reach the hosted presentation record");
    }

    const first = await openPublishedPage();
    first.releaseContent();
    await first.page.getByTestId("late-copy").waitFor();
    await first.page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
    const edited = "Saved delayed paragraph";
    await first.page.getByTestId("late-copy").fill(edited);
    const formattedEdit = "Saved formatted statement";
    await first.page.getByTestId("formatted-copy").fill(formattedEdit);
    await saveText(first.page, "fixture:late", edited);
    assert.equal(record.presentation.textEdits["fixture:formatted"], formattedEdit);
    assert.equal(await first.page.getByTestId("formatted-copy").locator("strong").innerText(), "formatted",
      "Committing an inline edit must retain authored emphasis");
    assert.equal(writes.length, 1);
    await first.page.close();

    // A fresh browser context proves restoration comes from the server response,
    // without any prior DOM, React state, or viewer-local presentation storage.
    const restored = await openPublishedPage();
    assert.equal(reads.at(-1).presentation.textEdits["fixture:late"], edited);
    assert.equal(await restored.page.getByTestId("formatted-copy").innerText(), formattedEdit);
    assert.equal(await restored.page.getByTestId("formatted-copy").locator("strong").innerText(), "formatted",
      "Restoring saved text in a fresh context must preserve its authored strong element");
    restored.releaseContent();
    await restored.page.getByTestId("late-copy").waitFor();
    assert.equal(await restored.page.getByTestId("late-copy").innerText(), edited,
      "Text mounted after the initial hosted render must display its acknowledged saved edit");
    await restored.page.close();

    const editing = await openPublishedPage();
    const page = editing.page;
    const caption = page.getByTestId("caption");
    await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
    await caption.fill("");
    editing.releaseContent();
    await page.getByTestId("late-copy").waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="late-copy"]')?.isContentEditable);
    assert.equal(await page.getByTestId("late-copy").innerText(), edited,
      "Late content must restore saved text when it joins an active edit session");
    assert.equal(await caption.textContent(), "",
      "Mounting unrelated async content must not replace a temporarily empty focused draft");
    assert.equal(await caption.evaluate((element) => element === document.activeElement), true,
      "Discovering late content must preserve the active text editor's focus");
    await page.keyboard.insertText("Original caption");
    const editedAgain = "Saved after mounting in Edit mode";
    await page.getByTestId("late-copy").fill(editedAgain);
    await saveText(page, "fixture:late", editedAgain);

    const writesBeforeCancel = writes.length;
    await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
    await caption.fill("Unsaved first caption edit");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
    assert.equal(await caption.innerText(), "Original caption",
      "Cancel must restore authored plain text when no saved override exists");
    assert.equal(writes.length, writesBeforeCancel, "Cancel must not save its discarded text");

    const savedCaption = "Saved caption baseline";
    await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
    await caption.fill(savedCaption);
    await saveText(page, "fixture:caption", savedCaption);
    await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
    await caption.fill("Unsaved second caption edit");
    await caption.press("Tab");
    await page.getByRole("button", { name: "Save", exact: true }).focus();
    await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+z`);
    await page.waitForFunction(() =>
      document.querySelector('[aria-label="Redo dashboard change"]')?.disabled === false);
    assert.equal(await caption.innerText(), savedCaption,
      "Undo must update visible plain text while the edit session stays open");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
    assert.equal(await caption.innerText(), savedCaption);

    const writesBeforeRoundTrip = writes.length;
    await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
    await caption.fill("Intermediate committed caption");
    await caption.press("Tab");
    await caption.fill(savedCaption);
    await caption.press("Tab");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Edit text and layout", exact: true }).waitFor();
    assert.equal(await caption.innerText(), savedCaption);
    assert.equal(record.presentation.textEdits["fixture:caption"], savedCaption,
      "Editing A to B, then refocusing and committing A, must not save the intermediate B");
    assert.equal(writes.length, writesBeforeRoundTrip, "Returning to the saved text is a net unchanged edit");

    await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
    const committedCaption = "Most recently committed caption";
    await caption.fill(committedCaption);
    await caption.press("Tab");
    await caption.fill("Uncommitted caption draft");
    await caption.press("Escape");
    assert.equal(await caption.innerText(), committedCaption,
      "Escape must discard only the focused draft, preserving the most recent committed text");
    await saveText(page, "fixture:caption", committedCaption);

    await page.getByRole("button", { name: "Edit text and layout", exact: true }).click();
    const formatted = page.getByTestId("formatted-copy");
    const pastedCaption = "Pasted formatted statement";
    const inserted = await formatted.evaluate((element, value) => {
      element.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      const accepted = document.execCommand("insertHTML", false, `<a href="#pasted-draft">${value}</a>`);
      return { accepted, pastedLink: Boolean(element.querySelector("a")) };
    }, pastedCaption);
    assert.deepEqual(inserted, { accepted: true, pastedLink: true },
      "The browser must insert a real formatted draft before reconciliation runs");
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    assert.equal(await formatted.evaluate((element) => element.isContentEditable && element === document.activeElement), true,
      "Temporary pasted descendants must not disable or blur the focused editor");
    await formatted.press("Tab");
    await saveText(page, "fixture:formatted", pastedCaption);
    assert.equal(await formatted.innerText(), pastedCaption);
    assert.equal(await formatted.locator("a").count(), 0, "Committing pasted text must remove unauthored links");
    assert.equal(await formatted.locator("strong").innerText(), "formatted",
      "Committing a formatted paste must retain the paragraph's authored emphasis");
    assert.deepEqual(errors, [], "Hosted text editing must not emit browser errors");
  } finally {
    releaseContentRequests.forEach((release) => release());
    await Promise.all(contexts.map((context) => context.close()));
    rmSync(project, { recursive: true, force: true });
  }
}
