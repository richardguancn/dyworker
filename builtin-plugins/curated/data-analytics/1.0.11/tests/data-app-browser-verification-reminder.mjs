import assert from "node:assert/strict";

const reminderCookieName = "data_app_verification_reminder_v1";
const workspaceUrl = "https://dashboard.example.chatgpt.site/";
const siblingUrl = "https://second.example.chatgpt.site/";
const otherWorkspaceUrl = "https://dashboard.other-workspace.chatgpt.site/";

function controls(page) {
  const dialog = page.getByRole("dialog", { name: "What verification means" });
  return {
    edit: page.getByRole("button", { name: "Edit text and layout", exact: true }),
    save: page.getByRole("button", { name: "Save", exact: true }),
    cancel: page.getByRole("button", { name: "Cancel", exact: true }),
    mark: page.getByRole("button", { name: "Mark dashboard as verified", exact: true }),
    remove: page.getByRole("button", { name: "Remove dashboard verification", exact: true }),
    dialog,
    checkbox: dialog.getByRole("checkbox", { name: "Don't show again", exact: true }),
  };
}

async function reminderCookies(page) {
  return (await page.context().cookies(page.url())).filter(cookie => cookie.name === reminderCookieName);
}

async function openReminder(page) {
  const ui = controls(page);
  await ui.edit.click();
  await ui.mark.click();
  await ui.dialog.waitFor();
  assert.equal(await ui.checkbox.isChecked(), false, "An unconfirmed checkbox must start unchecked");
  return ui;
}

async function cancelReminder(ui) {
  await ui.dialog.getByRole("button", { name: "Close", exact: true }).click();
  await ui.dialog.waitFor({ state: "hidden" });
  await ui.cancel.click();
}

async function skipReminder(page) {
  const ui = controls(page);
  await ui.edit.click();
  await ui.mark.click();
  await ui.remove.waitFor();
  assert.equal(await ui.dialog.count(), 0, "A confirmed workspace cookie must skip the reminder");
  return ui;
}

export async function verifyDashboardVerificationReminder(publishedPage, {
  getSnapshot,
  setSnapshot,
  getPresentation,
  setPresentation,
  presentationWrites,
  storedVerification,
  waitForDashboardTitle,
  assertVerificationView,
  assertPendingVerificationTooltip,
  createBrowserSession,
}) {
  const originalUrl = publishedPage.url();
  const reminderSnapshot = getSnapshot();
  const writesBeforeReminderPreference = presentationWrites.length;
  const ui = controls(publishedPage);
  await publishedPage.goto(workspaceUrl, { waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
  assert.deepEqual(await reminderCookies(publishedPage), []);

  // Closing a checked reminder is not consent to retain the preference.
  await ui.edit.click();
  for (const dismiss of ["Escape", "Close", "backdrop"]) {
    await ui.mark.click();
    await ui.dialog.waitFor();
    assert.equal(await ui.checkbox.isChecked(), false);
    await ui.checkbox.check();
    if (dismiss === "Escape") await publishedPage.keyboard.press("Escape");
    else if (dismiss === "backdrop") await publishedPage.locator(".dialog-backdrop").click({ position: { x: 5, y: 5 } });
    else await ui.dialog.getByRole("button", { name: dismiss, exact: true }).click();
    await ui.dialog.waitFor({ state: "hidden" });
    assert.deepEqual(await reminderCookies(publishedPage), [], "Dismissing a checked modal must not set a cookie");
  }
  await ui.mark.click();
  await ui.dialog.waitFor();
  assert.equal(await ui.checkbox.isChecked(), false);
  await ui.dialog.getByRole("button", { name: "Got it", exact: true }).click();
  await ui.remove.waitFor();
  assert.deepEqual(await reminderCookies(publishedPage), [], "Unchecked acknowledgement must not retain the preference");
  await ui.cancel.click();

  await openReminder(publishedPage);
  await ui.checkbox.check();
  assert.equal(await ui.checkbox.isChecked(), true);
  await ui.dialog.getByRole("button", { name: "Got it", exact: true }).click();
  await ui.remove.waitFor();
  const savedCookies = await reminderCookies(publishedPage);
  assert.equal(savedCookies.length, 1, "Checked acknowledgement must retain one real browser cookie");
  assert.equal(savedCookies[0].domain, ".example.chatgpt.site", "The cookie must be scoped to this workspace, not the global Sites domain");
  await ui.cancel.click();
  await publishedPage.reload({ waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
  await assertVerificationView(false);
  await skipReminder(publishedPage);
  await assertPendingVerificationTooltip();
  await ui.cancel.click();

  const sibling = await createBrowserSession(true);
  try {
    await sibling.goto(siblingUrl, { waitUntil: "load" });
    await waitForDashboardTitle(sibling);
    assert.deepEqual(await reminderCookies(sibling), savedCookies,
      "A sibling Site in the same browser must receive the workspace cookie");
    await (await skipReminder(sibling)).cancel.click();
    const requestsAfterBoot = [];
    sibling.on("request", request => requestsAfterBoot.push(new URL(request.url()).pathname));
    await sibling.setViewportSize({ width: 1100, height: 900 });
    await sibling.locator(".chart-frame").first().hover();
    await sibling.waitForTimeout(400);
    assert.equal(requestsAfterBoot.some(path => path.startsWith("/api/")), false,
      "Chart interaction and resize must not make reminder-related API requests");

    await sibling.goto(otherWorkspaceUrl, { waitUntil: "load" });
    await waitForDashboardTitle(sibling);
    assert.deepEqual(await reminderCookies(sibling), [], "A different workspace must not inherit the cookie");
    await cancelReminder(await openReminder(sibling));
  } finally { await sibling.close(); }

  setSnapshot({ ...reminderSnapshot, id: `${reminderSnapshot.id}-other-reminder-dashboard` });
  try {
    await publishedPage.reload({ waitUntil: "load" });
    await waitForDashboardTitle(publishedPage);
    await (await skipReminder(publishedPage)).cancel.click();
  } finally { setSnapshot(reminderSnapshot); }
  await publishedPage.reload({ waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);

  const otherBrowser = await createBrowserSession();
  try {
    await otherBrowser.goto(workspaceUrl, { waitUntil: "load" });
    await waitForDashboardTitle(otherBrowser);
    assert.deepEqual(await reminderCookies(otherBrowser), [], "A new browser session must not inherit another browser's preference");
    await cancelReminder(await openReminder(otherBrowser));
  } finally { await otherBrowser.close(); }

  const blockedBrowser = await createBrowserSession();
  try {
    await blockedBrowser.addInitScript(() => {
      const cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
      Object.defineProperty(document, "cookie", {
        configurable: true,
        get: () => cookie.get.call(document),
        set() {},
      });
    });
    await blockedBrowser.goto(workspaceUrl, { waitUntil: "load" });
    await waitForDashboardTitle(blockedBrowser);
    const blocked = await openReminder(blockedBrowser);
    await blocked.checkbox.check();
    await blocked.dialog.getByRole("button", { name: "Got it", exact: true }).click();
    await blocked.remove.waitFor();
    await blockedBrowser.getByRole("status").filter({ hasText: "Couldn't save your preference in this browser" }).waitFor();
    assert.deepEqual(await reminderCookies(blockedBrowser), [], "An ignored cookie write must not claim persistence");
    await blocked.cancel.click();
    await cancelReminder(await openReminder(blockedBrowser));
  } finally { await blockedBrowser.close(); }

  await publishedPage.waitForTimeout(400);
  assert.equal(presentationWrites.length, writesBeforeReminderPreference,
    "Cookie changes, skipped reminders, and canceled drafts must not write shared presentation before Save");
  await skipReminder(publishedPage);
  const rememberedVerificationSaved = publishedPage.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/presentation" && response.request().method() === "PUT" &&
    response.request().postDataJSON()?.verificationAction === "verify");
  await ui.save.click();
  assert.equal((await rememberedVerificationSaved).status(), 200);
  await assertVerificationView(true);
  assert.deepEqual(getPresentation().presentation.verification, storedVerification,
    "Skipping the reminder must still use a server-stamped verification record");

  const ownerPresentationWithReminder = structuredClone(getPresentation());
  setPresentation({ ...getPresentation(), canEdit: false });
  await publishedPage.reload({ waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
  await publishedPage.getByRole("img", { name: "Verified dashboard", exact: true }).click();
  for (const control of [ui.edit, ui.mark, ui.remove, ui.dialog]) {
    assert.equal(await control.count(), 0, "A workspace cookie must never grant a viewer verification controls");
  }
  assert.equal(presentationWrites.length, writesBeforeReminderPreference + 1,
    "Only the explicit owner Save may write while exercising the remembered preference");
  setPresentation(ownerPresentationWithReminder);
  await publishedPage.reload({ waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
  await ui.edit.click();
  await ui.remove.click();
  const rememberedVerificationRemoved = publishedPage.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/presentation" && response.request().method() === "PUT" &&
    response.request().postDataJSON()?.verificationAction === "remove");
  await ui.save.click();
  assert.equal((await rememberedVerificationRemoved).status(), 200);
  await assertVerificationView(false);
  assert.equal(presentationWrites.length, writesBeforeReminderPreference + 2);

  await publishedPage.goto(originalUrl, { waitUntil: "load" });
  await waitForDashboardTitle(publishedPage);
}
