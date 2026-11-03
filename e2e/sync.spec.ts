import type { Page } from "@playwright/test";
import { members } from "./support/env";
import { expect, test } from "./support/fixtures";
import { waitUntilAvailableOffline } from "./support/service-worker";

// Every test writes to the same member's personal notebook on the shared fake
// GitHub, so each one names its notes uniquely.

const synced = { timeout: 30_000 };

// Two devices, each waiting out sync's typing pause more than once.
test.setTimeout(60_000);

/** Creates a note from the list and types `body` into it (each line a paragraph), then waits until it is synced. */
async function writeNote(page: Page, title: string, body: string) {
  await page.getByRole("button", { name: "New note" }).click();
  const titleField = page.getByRole("textbox", { name: "Title" });
  await expect(titleField).toBeFocused();
  // Filled rather than typed over the selected placeholder: a pull from a test running alongside
  // may re-title the new note meanwhile, which would drop the selection.
  await titleField.fill(title);
  await titleField.press("Enter");
  await expect(page.getByRole("textbox", { name: "Note text" })).toBeFocused();
  await page.keyboard.type(body);
  await expect(page.getByRole("status")).toHaveText("Synced", synced);
}

/** Puts the cursor at the end of the paragraph holding `text` and types `suffix` after it. */
async function appendTo(page: Page, text: string, suffix: string) {
  await page.getByRole("textbox", { name: "Note text" }).getByText(text, { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(suffix);
}

/** On a phone the list is behind the open note, and its "Notes" button leads back; on a desktop it is beside it. */
async function showList(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole("button", { name: "Notes", exact: true }).click();
}

/** Playwright's offline mode cuts the network; the browser's own `online` event follows a reconnect. */
async function reconnect(page: Page) {
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

test("edits to different parts of a note on two devices, one of them offline, are merged everywhere", async ({
  page,
  signInAs,
  signInOnAnotherDevice,
  fakeGitHub,
}, testInfo) => {
  const title = `Merge ${testInfo.project.name} ${Date.now()}`;
  await signInAs(members.allowed);
  await writeNote(page, title, "Alpha\nBravo\nCharlie");

  const other = await signInOnAnotherDevice(members.allowed);
  await other.getByRole("button", { name: title }).click({ timeout: 20_000 });
  await expect(other.getByRole("textbox", { name: "Note text" })).toContainText("Charlie");
  await expect(other.getByRole("status")).toHaveText("Synced");

  // Offline, the other device edits the last paragraph; it is saved there and waits.
  await other.context().setOffline(true);
  await appendTo(other, "Charlie", " from the phone");
  await expect(other.getByRole("status")).toHaveText("Saved · Offline", synced);

  // Meanwhile this device edits the first paragraph and syncs it.
  await appendTo(page, "Alpha", " from the laptop");
  await expect(page.getByRole("status")).toHaveText("Synced", synced);

  // Back online, the other device syncs: both edits, on both devices and in the notebook.
  await reconnect(other);
  const otherText = other.getByRole("textbox", { name: "Note text" });
  await expect(otherText).toContainText("Alpha from the laptop", synced);
  await expect(otherText).toContainText("Charlie from the phone");
  await expect(other.getByRole("status")).toHaveText("Synced", synced);
  const files = await fakeGitHub.files(members.allowed, "my-notes");
  expect(files[`${title}.md`]).toMatch(/Alpha from the laptop\n\nBravo\n\nCharlie from the phone\n$/);
  expect(files[`${title} (conflict copy).md`]).toBeUndefined();

  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText("Charlie from the phone", synced);
});

test("edits to the same line on two devices keep each device's own text, with the other's in a conflict copy", async ({
  page,
  signInAs,
  signInOnAnotherDevice,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  const title = `Clash ${testInfo.project.name} ${Date.now()}`;
  await signInAs(members.allowed);
  await writeNote(page, title, "Alpha\nBravo\nCharlie");

  const other = await signInOnAnotherDevice(members.allowed);
  await other.getByRole("button", { name: title }).click({ timeout: 20_000 });
  await expect(other.getByRole("textbox", { name: "Note text" })).toContainText("Charlie");
  await expect(other.getByRole("status")).toHaveText("Synced");

  await other.context().setOffline(true);
  await appendTo(other, "Alpha", " from the phone");
  await expect(other.getByRole("status")).toHaveText("Saved · Offline", synced);
  await appendTo(page, "Alpha", " from the laptop");
  await expect(page.getByRole("status")).toHaveText("Synced", synced);

  await reconnect(other);
  await expect(other.getByRole("status")).toHaveText("Synced", synced);
  // The other device keeps what was typed on it.
  await expect(other.getByRole("textbox", { name: "Note text" })).toContainText("Alpha from the phone");
  await expect(other.getByRole("textbox", { name: "Note text" })).not.toContainText("from the laptop");

  // The notice names the note and opens the conflict copy, which holds this device's version.
  await showList(other, isMobile);
  const notice = other.getByRole("alert", { name: "1 note couldn't be merged" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(title);
  await notice.getByRole("button", { name: `Open the conflict copy of ${title}` }).click();
  await expect(other.getByRole("textbox", { name: "Title" })).toHaveValue(`${title} (conflict copy)`);
  await expect(other.getByRole("textbox", { name: "Note text" })).toContainText("Alpha from the laptop");
  await expect(notice).toHaveCount(0);

  // Both versions are in the notebook: nothing was lost.
  const files = await fakeGitHub.files(members.allowed, "my-notes");
  expect(files[`${title}.md`]).toMatch(/Alpha from the phone\n\nBravo\n\nCharlie\n$/);
  expect(files[`${title} (conflict copy).md`]).toMatch(/Alpha from the laptop\n\nBravo\n\nCharlie\n$/);
  expect(Object.keys(files).filter((path) => path.startsWith(title))).toHaveLength(2);

  // This device follows: the note takes the other's version and the copy appears.
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText("Alpha from the phone", synced);
  await showList(page, isMobile);
  await expect(page.getByRole("button", { name: `${title} (conflict copy)` })).toBeVisible();
});

test("an expired session asks the member to sign in again, keeps their writing, and syncs it once they have", async ({
  page,
  context,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  const title = `Expired ${testInfo.project.name} ${Date.now()}`;
  await signInAs(members.allowed);
  await writeNote(page, title, "Before the session ended");

  // The session ends (it expired, or GitHub revoked the token): the next sync is refused.
  await context.clearCookies();
  await appendTo(page, "Before the session ended", ", and after");
  await expect(page.getByRole("status")).toHaveText("Saved · Sign in to sync", synced);
  await showList(page, isMobile);
  const prompt = page.getByRole("alert", { name: "Sign in again to sync" });
  await expect(prompt).toBeVisible();

  // Writing carries on meanwhile; nothing on the device is touched.
  await page.getByRole("button", { name: title }).click();
  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText("Before the session ended, and after");
  await showList(page, isMobile);

  await prompt.getByRole("link", { name: "Sign in again" }).click();
  await page.getByRole("button", { name: `Authorize as ${members.allowed}` }).click();
  await expect(page).toHaveURL("/notes");
  await page.getByRole("button", { name: title }).click();
  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText("Before the session ended, and after");
  await expect(page.getByRole("status")).toHaveText("Synced", synced);
  await expect(page.getByRole("alert", { name: "Sign in again to sync" })).toHaveCount(0);
  const files = await fakeGitHub.files(members.allowed, "my-notes");
  expect(files[`${title}.md`]).toMatch(/Before the session ended, and after\n$/);
});

test.describe("opening the app offline", () => {
  // Needs the service worker, which every other spec blocks (playwright.config.ts).
  test.use({ serviceWorkers: "allow" });

  test("after one online visit, the app opens offline with the member's notes, and editing works", async ({
    page,
    context,
    signInAs,
    fakeGitHub,
    isMobile,
  }, testInfo) => {
    const title = `Offline ${testInfo.project.name} ${Date.now()}`;
    await signInAs(members.allowed);
    await writeNote(page, title, "Written online");
    await showList(page, isMobile);
    await waitUntilAvailableOffline(page);

    await context.setOffline(true);
    const response = await page.reload();
    expect(response?.fromServiceWorker()).toBe(true);

    await page.getByRole("button", { name: title }).click();
    await expect(page.getByRole("textbox", { name: "Note text" })).toContainText("Written online");
    await appendTo(page, "Written online", ", edited offline");
    await expect(page.getByRole("status")).toHaveText("Saved · Offline", synced);
    await showList(page, isMobile);
    await expect(page.getByText("Offline · syncs when you're back online")).toBeVisible();

    await reconnect(page);
    await page.getByRole("button", { name: title }).click();
    await expect(page.getByRole("status")).toHaveText("Synced", synced);
    const files = await fakeGitHub.files(members.allowed, "my-notes");
    expect(files[`${title}.md`]).toMatch(/Written online, edited offline\n$/);
  });
});
