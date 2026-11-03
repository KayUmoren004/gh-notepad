import type { Locator, Page } from "@playwright/test";
import { members } from "./support/env";
import { expect, test } from "./support/fixtures";

// Shared notebooks (ADR 0004): the owner creates one in the app and invites a
// member, who accepts in the app; both then write in it. The fake GitHub is
// shared by every test and both projects, so each test names its notebook
// after the project and the moment it runs.

const notebookTopic = "gh-notepad-notebook";
const synced = { timeout: 30_000 };

// Two members on two devices, each waiting out sync's typing pause more than once.
test.setTimeout(120_000);

const notebooksOf = (page: Page) => page.getByRole("region", { name: "Notebooks" });
const notebookRow = (page: Page, name: string) => notebooksOf(page).getByRole("button", { name, exact: true });
const optionsFor = (page: Page, name: string) => page.getByRole("button", { name: `Options for ${name}` });

/** Starts a note from a notebook row's menu and types `body` into it (each line a paragraph), then waits until it is synced. */
async function writeNoteIn(page: Page, notebook: string, title: string, body: string) {
  await optionsFor(page, notebook).click();
  await page.getByRole("menuitem", { name: "New note" }).click();
  const titleField = page.getByRole("textbox", { name: "Title" });
  await expect(titleField).toBeFocused();
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

/** Brings the device back to the app, which pulls what changed elsewhere. */
async function refocus(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

/** Playwright's offline mode cuts the network; the browser's own `online` event follows a reconnect. */
async function reconnect(page: Page) {
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

/** Folds the personal notebook, whose notes from every other test would otherwise push the shared ones out of the rendered rows. */
async function foldPersonalNotebook(page: Page) {
  const personal = notebookRow(page, "my-notes");
  await expect(personal).toBeVisible(synced);
  await personal.click();
  await expect(personal).toHaveAttribute("aria-expanded", "false");
}

/** Whether this device's IndexedDB still holds the notebook, or any note of it. */
function notebookOnDevice(page: Page, notebookId: string): Promise<boolean> {
  return page.evaluate(async (id) => {
    const names = (await indexedDB.databases()).flatMap((db) => (db.name?.startsWith("gh-notepad-account-") ? [db.name] : []));
    for (const name of names) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open(name);
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      try {
        const read = <T>(store: string) =>
          new Promise<T[]>((resolve, reject) => {
            const request = db.transaction(store).objectStore(store).getAll();
            request.onsuccess = () => resolve(request.result as T[]);
            request.onerror = () => reject(request.error);
          });
        const notebooks = await read<{ id: string }>("notebooks");
        const notes = await read<{ notebook: string }>("notes");
        if (notebooks.some((row) => row.id === id) || notes.some((row) => row.notebook === id)) return true;
      } finally {
        db.close();
      }
    }
    return false;
  }, notebookId);
}

test("the owner creates a notebook and invites a member, who accepts and writes in it; edits by both are merged", async ({
  page,
  signInAs,
  signInOnAnotherDevice,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  const typed = `Book club ${testInfo.project.name} ${Date.now()}`;
  const name = typed.toLowerCase().replace(/ /g, "-");
  await signInAs(members.owner);
  await expect(page).toHaveURL("/notes");
  await foldPersonalNotebook(page);

  // Creating: the name is shown as the repository it becomes.
  await page.getByRole("button", { name: "New shared notebook" }).click();
  const dialog = page.getByRole("dialog", { name: "New shared notebook" });
  await dialog.getByRole("textbox", { name: "Notebook name" }).fill(typed);
  await expect(dialog).toContainText(`Will be created as ${members.owner}/${name}`);
  await dialog.getByRole("button", { name: "Create notebook" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(notebookRow(page, name)).toBeVisible(synced);
  expect(await fakeGitHub.files(members.owner, name)).toHaveProperty(["README.md"]);

  // Inviting, by GitHub username.
  await optionsFor(page, name).click();
  await page.getByRole("menuitem", { name: "Collaborators…" }).click();
  const settings = page.getByRole("dialog", { name });
  await settings.getByRole("textbox", { name: "GitHub username to invite" }).fill(members.allowed);
  await settings.getByRole("button", { name: "Invite" }).click();
  await expect(settings.getByRole("status")).toHaveText(`Invited ${members.allowed}. GitHub lets them know.`);
  await expect(settings.getByRole("region", { name: "Invited" })).toContainText(members.allowed);
  await settings.getByRole("button", { name: "Done" }).click();

  // The invitee sees the invitation in the app and accepts it there; the notebook joins their sidebar.
  const other = await signInOnAnotherDevice(members.allowed);
  await foldPersonalNotebook(other);
  const invitations = other.getByRole("region", { name: "Invitations" });
  await expect(invitations).toContainText(`${members.owner} invited you to ${name}`, synced);
  await invitations.getByRole("button", { name: `Accept the invitation to ${name}` }).click();
  await expect(notebookRow(other, name)).toBeVisible(synced);
  expect(await fakeGitHub.collaborators(members.owner, name)).toEqual([members.allowed]);
  await expect(settings).toHaveCount(0);
  await optionsFor(page, name).click();
  await page.getByRole("menuitem", { name: "Collaborators…" }).click();
  await expect(settings.getByRole("region", { name: "Collaborators" })).toContainText(members.allowed);
  await settings.getByRole("button", { name: "Done" }).click();

  // The member writes a note in it, which the owner sees.
  const title = `Plan ${testInfo.project.name} ${Date.now()}`;
  await writeNoteIn(other, name, title, "Alpha\nBravo\nCharlie");
  await refocus(page);
  await page.getByRole("button", { name: title }).click(synced);
  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText("Charlie");

  // Both edit the same note, the member offline meanwhile: different paragraphs, so the edits merge
  // everywhere, by the same rules as between two devices of one member.
  const otherText = other.getByRole("textbox", { name: "Note text" });
  await other.context().setOffline(true);
  await appendTo(other, "Charlie", " from the member");
  await expect(other.getByRole("status")).toHaveText("Saved · Offline", synced);
  await appendTo(page, "Alpha", " from the owner");
  await expect(page.getByRole("status")).toHaveText("Synced", synced);
  await reconnect(other);
  await expect(otherText).toContainText("Alpha from the owner", synced);
  await expect(otherText).toContainText("Charlie from the member");
  await expect(other.getByRole("status")).toHaveText("Synced", synced);
  await refocus(page);
  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText("Charlie from the member", synced);
  const files = await fakeGitHub.files(members.owner, name);
  expect(files[`${title}.md`]).toMatch(/Alpha from the owner\n\nBravo\n\nCharlie from the member\n$/);
  expect(files[`${title} (conflict copy).md`]).toBeUndefined();

  // The same paragraph: each keeps their own, and the other's version is in a conflict copy beside it.
  await other.context().setOffline(true);
  await appendTo(other, "Alpha from the owner", " and the member");
  await expect(other.getByRole("status")).toHaveText("Saved · Offline", synced);
  await appendTo(page, "Alpha from the owner", ", twice");
  await expect(page.getByRole("status")).toHaveText("Synced", synced);
  await reconnect(other);
  await expect(other.getByRole("status")).toHaveText("Synced", synced);
  await expect(otherText).toContainText("Alpha from the owner and the member");
  await expect(otherText).not.toContainText("twice");
  await showList(other, isMobile);
  await expect(other.getByRole("alert", { name: "1 note couldn't be merged" })).toContainText(title);
  const after = await fakeGitHub.files(members.owner, name);
  expect(after[`${title}.md`]).toMatch(/Alpha from the owner and the member\n/);
  expect(after[`${title} (conflict copy).md`]).toMatch(/Alpha from the owner, twice\n/);
});

test("leaving a shared notebook removes it from the sidebar and from the device", async ({
  page,
  signInAs,
  fakeGitHub,
}, testInfo) => {
  const name = `reading-${testInfo.project.name}-${Date.now()}`;
  const notebookId = `${members.owner}/${name}`;
  await fakeGitHub.addRepo({
    owner: members.owner,
    name,
    topics: [notebookTopic],
    files: { "Agenda.md": "First chapter.\n" },
    collaborators: [members.allowed],
  });
  await signInAs(members.allowed);
  await foldPersonalNotebook(page);
  await expect(notebookRow(page, name)).toBeVisible(synced);
  const agenda: Locator = notebooksOf(page).getByRole("button", { name: "Agenda", exact: true });
  await expect(agenda).toBeVisible(synced);
  await expect.poll(() => notebookOnDevice(page, notebookId)).toBe(true);

  await optionsFor(page, name).click();
  await page.getByRole("menuitem", { name: "Leave notebook…" }).click();
  const confirm = page.getByRole("alertdialog", { name: `Leave ${name}?` });
  await confirm.getByRole("button", { name: "Leave notebook" }).click();

  await expect(confirm).toHaveCount(0);
  await expect(notebookRow(page, name)).toHaveCount(0);
  await expect(agenda).toHaveCount(0);
  expect(await fakeGitHub.collaborators(members.owner, name)).toEqual([]);
  await expect.poll(() => notebookOnDevice(page, notebookId)).toBe(false);
  // Still gone after a reload: it was removed from the device, not only from the screen.
  await page.reload();
  await expect(notebookRow(page, "my-notes")).toBeVisible(synced);
  await expect(notebookRow(page, name)).toHaveCount(0);
});
