import type { Page, Route } from "@playwright/test";
import { signOutMembers } from "./support/env";
import { expect, test } from "./support/fixtures";

// Each Playwright project has its own pair of members here, so the notebooks
// these flows read and write belong to one test file and one project.

const NOTEBOOK_ROUTES = "**/api/notebooks/**";

async function createNote(page: Page, title: string, body: string) {
  await page.getByRole("button", { name: "New note" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Note text" })).toBeFocused();
  await page.keyboard.type(body);
}

async function waitUntilSynced(page: Page) {
  await expect(page.getByRole("status")).toHaveText("Synced", { timeout: 20_000 });
}

/** On a phone the open note covers the home screen, where the account controls are; its back button leads there. */
async function showHome(page: Page) {
  const back = page.getByRole("button", { name: /^Back to / });
  if (await back.isVisible()) await back.click();
}

/** Opens the sign-out dialog and takes `choice`. */
async function signOut(page: Page, choice: "Keep notes on this device" | "Remove notes from this device") {
  await showHome(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("alertdialog", { name: "Sign out?" }).getByRole("button", { name: choice }).click();
}

/** Holds every request to the notebook routes until released, so nothing can sync meanwhile. */
async function holdSync(page: Page) {
  const held: Route[] = [];
  let holding = true;
  await page.route(NOTEBOOK_ROUTES, (route) => (holding ? void held.push(route) : route.continue()));
  return {
    release: async () => {
      holding = false;
      for (const route of held) await route.continue();
      await page.unroute(NOTEBOOK_ROUTES);
    },
  };
}

/** Resolves once this page's sync has reached the notebook routes and been answered. */
function syncHasRun(page: Page) {
  return page.waitForResponse((response) => response.url().includes("/api/notebooks/"));
}

const accountDatabases = (page: Page) =>
  page.evaluate(async () =>
    (await indexedDB.databases()).flatMap((db) => (db.name?.startsWith("gh-notepad-account-") ? [db.name] : [])),
  );

const deviceKeys = (page: Page, login: string) =>
  page.evaluate((prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)), `notepad:${login}:`);

test("signing out keeping the notes: they are on the device, before any sync, when the member signs back in", async ({
  page,
  signInAs,
}, testInfo) => {
  const { first } = signOutMembers[testInfo.project.name];
  const title = `Keep me ${testInfo.project.name} ${Date.now()}`;
  await signInAs(first);
  await createNote(page, title, "Still here");
  await waitUntilSynced(page);

  await signOut(page, "Keep notes on this device");
  await expect(page).toHaveURL("/");

  const sync = await holdSync(page);
  await signInAs(first);
  await expect(page).toHaveURL("/notes");
  // The note renders from the device while GitHub is still unreachable.
  await page.getByRole("button", { name: title }).click();
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveText("Still here");

  await sync.release();
  await waitUntilSynced(page);
});

test("signing out removing the notes: they are gone from the device and come back from GitHub", async ({
  page,
  signInAs,
}, testInfo) => {
  const { first } = signOutMembers[testInfo.project.name];
  const title = `Remove me ${testInfo.project.name} ${Date.now()}`;
  await signInAs(first);
  await createNote(page, title, "On GitHub");
  await waitUntilSynced(page);
  await page.evaluate(
    ([login]) => {
      localStorage.setItem(`notepad:${login}:sidebar`, "open");
      localStorage.setItem("unrelated", "stays");
    },
    [first],
  );

  // Everything is synced, so removing needs no further confirmation.
  await signOut(page, "Remove notes from this device");
  await expect(page).toHaveURL("/");
  expect(await accountDatabases(page)).toEqual([]);
  expect(await deviceKeys(page, first)).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("unrelated"))).toBe("stays");

  const sync = await holdSync(page);
  await signInAs(first);
  await expect(page).toHaveURL("/notes");
  await expect(page.getByRole("button", { name: "New note" })).toBeVisible();
  await expect(page.getByRole("button", { name: title })).toHaveCount(0);

  await sync.release();
  await page.getByRole("button", { name: title }).click({ timeout: 20_000 });
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveText("On GitHub");
  await waitUntilSynced(page);
});

test("removing with unsynced changes warns first, naming the notes that would lose them", async ({
  page,
  signInAs,
  isMobile,
}, testInfo) => {
  const { first } = signOutMembers[testInfo.project.name];
  const stamp = `${testInfo.project.name} ${Date.now()}`;
  const titles = [`Unsynced A ${stamp}`, `Unsynced B ${stamp}`];
  await signInAs(first);
  // GitHub is out of reach: the notes are saved on the device and nowhere else.
  await page.route(NOTEBOOK_ROUTES, (route) => route.abort());
  await createNote(page, titles[0], "Only here");
  await showHome(page);
  await createNote(page, titles[1], "Also only here");
  await expect(page.getByRole("status")).toHaveText(/^Saved/);

  await showHome(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("alertdialog", { name: "Sign out?" }).getByRole("button", { name: "Remove notes from this device" }).click();
  const warning = page.getByRole("alertdialog", { name: "Remove unsynced changes?" });
  await expect(warning).toContainText("2 notes have changes that haven't synced to GitHub");
  await expect(warning.getByRole("listitem")).toHaveText(titles);
  await expect(warning).toContainText("Removing them from this device loses those changes.");

  // Cancelling keeps everything: still signed in, notes still here (the open note on a desktop, the tree on a phone).
  await warning.getByRole("button", { name: "Cancel" }).click();
  await expect(warning).toBeHidden();
  await expect(page).toHaveURL(/\/notes/);
  if (isMobile) await expect(page.getByRole("button", { name: titles[1] })).toBeVisible();
  else await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(titles[1]);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("alertdialog", { name: "Sign out?" }).getByRole("button", { name: "Remove notes from this device" }).click();
  await warning.getByRole("button", { name: "Remove anyway" }).click();
  await expect(page).toHaveURL("/");
  expect(await accountDatabases(page)).toEqual([]);

  // Those edits never reached GitHub, so nothing brings them back.
  await page.unroute(NOTEBOOK_ROUTES);
  await Promise.all([syncHasRun(page), signInAs(first)]);
  await expect(page.getByRole("button", { name: "New note" })).toBeVisible();
  for (const title of titles) await expect(page.getByRole("button", { name: title })).toHaveCount(0);
});

test("a second account on the same browser sees none of the first account's notes", async ({
  page,
  signInAs,
}, testInfo) => {
  const { first, second } = signOutMembers[testInfo.project.name];
  const stamp = `${testInfo.project.name} ${Date.now()}`;
  const firstTitle = `First's note ${stamp}`;
  const secondTitle = `Second's note ${stamp}`;

  await signInAs(first);
  await createNote(page, firstTitle, "Mine");
  await waitUntilSynced(page);
  await signOut(page, "Keep notes on this device");
  await expect(page).toHaveURL("/");

  await Promise.all([syncHasRun(page), signInAs(second)]);
  await expect(page).toHaveURL("/notes");
  await expect(page.getByRole("button", { name: "New note" })).toBeVisible();
  await expect(page.getByRole("button", { name: firstTitle })).toHaveCount(0);
  // The first account's notes are still on the device, in their own database.
  expect(await accountDatabases(page)).toHaveLength(2);
  await createNote(page, secondTitle, "Theirs");
  await waitUntilSynced(page);
  await signOut(page, "Keep notes on this device");
  await expect(page).toHaveURL("/");

  await Promise.all([syncHasRun(page), signInAs(first)]);
  await expect(page.getByRole("button", { name: firstTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: secondTitle })).toHaveCount(0);
});
