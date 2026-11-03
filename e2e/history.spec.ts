import type { Page } from "@playwright/test";
import { members } from "./support/env";
import { expect, test } from "./support/fixtures";

// Every test writes to the same member's personal notebook on the shared fake
// GitHub, so each one names its notes uniquely.

const synced = { timeout: 30_000 };

// Syncs wait out the typing pause more than once.
test.setTimeout(90_000);

/** Opens the note called `title` from the list (the home screen on a phone). */
async function openNote(page: Page, title: string) {
  await page.getByRole("button", { name: title }).click({ timeout: 20_000 });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
}

/** Puts the cursor at the end of the paragraph holding `text` and types `suffix` after it. */
async function appendTo(page: Page, text: string, suffix: string) {
  await page.getByRole("textbox", { name: "Note text" }).getByText(text, { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(suffix);
}

/** The History panel: a side panel on a desktop, a full-screen sheet on a phone. */
function historyPanel(page: Page, isMobile: boolean) {
  return isMobile ? page.getByRole("dialog", { name: "History" }) : page.getByRole("complementary", { name: "History" });
}

test("a note edited across sessions can be previewed, compared and restored from its History, which then gains a version", async ({
  page,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  const title = `Chronicle ${testInfo.project.name} ${Date.now()}`;
  const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  // A session long before this one: a version written outside the app, dated yesterday.
  await fakeGitHub.addUser({ login: members.allowed });
  await fakeGitHub.addRepo({ owner: members.allowed, name: "my-notes", files: { "README.md": "# my-notes\n" } });
  await fakeGitHub.commitFiles(members.allowed, "my-notes", {
    message: "Draft from another editor",
    files: { [`${title}.md`]: "First thoughts\n" },
    date: yesterday,
  });

  await signInAs(members.allowed);
  await openNote(page, title);
  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText("First thoughts");
  // This session's edit, synced as a version of its own.
  await appendTo(page, "First thoughts", ", second thoughts");
  await expect(page.getByRole("status")).toHaveText("Synced", synced);

  await page.getByRole("button", { name: "History" }).click();
  const panel = historyPanel(page, isMobile);
  await expect(panel).toBeVisible();
  const versions = panel.getByRole("list", { name: "Versions" });
  await expect(versions.getByRole("listitem")).toHaveCount(2);
  await expect(versions.getByRole("listitem").first()).toContainText(/Today .*1 change/);
  await expect(versions.getByRole("listitem").last()).toContainText("Draft from another editor");

  // The older version, previewed read-only, then compared with the note as it is now.
  await versions.getByRole("button", { name: /Draft from another editor/ }).click();
  const preview = panel.getByRole("document", { name: "Version preview" });
  await expect(preview).toHaveText("First thoughts");
  await expect(preview).toHaveAttribute("contenteditable", "false");
  await panel.getByRole("button", { name: "Changes" }).click();
  await expect(panel.locator("[data-change=removed]")).toHaveText(/First thoughts$/);
  await expect(panel.locator("[data-change=added]")).toHaveText(/First thoughts, second thoughts$/);

  // Restoring makes it the note's text, which syncs as a new version: the history grows.
  await panel.getByRole("button", { name: "Restore this version" }).click();
  await page.getByRole("alertdialog", { name: "Restore this version?" }).getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveText("First thoughts");
  await expect(page.getByRole("status")).toHaveText("Synced", synced);
  const files = await fakeGitHub.files(members.allowed, "my-notes");
  expect(files[`${title}.md`]).toMatch(/First thoughts\n$/);
  await expect(versions.getByRole("listitem").first()).toContainText(/Today .*2 changes/, synced);
  await versions.getByRole("button", { name: "Show this session's changes" }).click();
  await expect(versions.getByRole("list", { name: /Changes Today/ }).getByRole("listitem")).toHaveCount(2);
});

test("offline, History says it needs a connection instead of failing, and loads once back online", async ({
  page,
  context,
  signInAs,
  isMobile,
}, testInfo) => {
  const title = `Unplugged ${testInfo.project.name} ${Date.now()}`;
  await signInAs(members.allowed);
  await page.getByRole("button", { name: "New note" }).click();
  const titleField = page.getByRole("textbox", { name: "Title" });
  await expect(titleField).toBeFocused();
  await titleField.fill(title);
  await titleField.press("Enter");
  await expect(page.getByRole("textbox", { name: "Note text" })).toBeFocused();
  await page.keyboard.type("Written online");
  await expect(page.getByRole("status")).toHaveText("Synced", synced);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  // Opened from the command palette this time, which lists "Open history" while a note is on screen.
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Search" });
  await palette.getByRole("combobox", { name: "Search notes" }).fill("history");
  await palette.getByRole("option", { name: "Open history" }).click();
  const panel = historyPanel(page, isMobile);
  await expect(panel.getByRole("status")).toContainText("History needs a connection");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  // One session: however many commits the typing took, they were minutes apart at most.
  await expect(panel.getByRole("list", { name: "Versions" }).getByRole("listitem")).toHaveCount(1, synced);
  await expect(panel.getByRole("list", { name: "Versions" })).toContainText(title);
});
