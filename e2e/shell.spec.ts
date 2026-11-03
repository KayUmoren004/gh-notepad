import type { Locator, Page } from "@playwright/test";
import type { FakeGitHubControl } from "../test/fake-github/client";
import { shellMembers } from "./support/env";
import { expect, test } from "./support/fixtures";

// The app shell: the sidebar's notebook tree, the note URL, the centred editor
// under its top bar, and the phone's push/pop navigation. Each test leaves a
// screenshot in its Playwright output directory (test-results/…).

const frontmatter = (id: string) => `---\nid: ${id}\n---\n`;
/** Notes with ids the tests can deep-link to. */
const ids = {
  plan: "5d2b1c4e-0000-4000-8000-000000000001",
  cedar: "5d2b1c4e-0000-4000-8000-000000000002",
};

/** A notebook with nested folders and enough notes to scroll, seeded once per fake GitHub. */
async function seedTree(fakeGitHub: FakeGitHubControl, login: string) {
  const files: Record<string, string> = {
    "Projects/Garden/Plan.md": `${frontmatter(ids.plan)}Raised beds along the south fence.\n`,
    "Projects/Garden/Beds/Cedar.md": `${frontmatter(ids.cedar)}Cedar lasts longest.\n`,
    "Projects/Kitchen shelves.md": "Measure twice.\n",
    "Journal/2026-01-01.md": "New year.\n",
    "Groceries.md": "- Milk\n",
    "Reading list.md": "Books.\n",
  };
  for (let index = 1; index <= 40; index++) files[`Archive/Entry ${String(index).padStart(2, "0")}.md`] = `Entry ${index}\n`;
  await fakeGitHub.addUser({ login });
  await fakeGitHub.addRepo({ owner: login, name: "my-notes", files });
}

const longTitle =
  "Minutes of the quarterly planning meeting with the Northwind Industries Holdings account team, including follow-ups";
const worstCase = {
  long: longTitle,
  emoji: "🌱 Seeds to start in March 🌻🌻🌻",
  arabic: "ملاحظات الاجتماع الأسبوعي",
  single: "x",
};
const lastTitle = "龍 dragon";

/** Over a thousand notes across folders of every depth, with the titles real people write. */
async function seedBig(fakeGitHub: FakeGitHubControl, login: string) {
  const folders = ["", "Work", "Work/Clients/Northwind", "日記", "Archive/2024/Q1/Weekly/Notes/Deep/Deeper/Deepest/Last"];
  const files: Record<string, string> = {};
  for (let index = 0; index < 1_000; index++) {
    const folder = folders[index % folders.length];
    files[`${folder ? `${folder}/` : ""}Note ${index}.md`] = `Note ${index}\n`;
  }
  for (const title of Object.values(worstCase)) files[`AAA worst case/${title}.md`] = `${title}\n`;
  files[`${lastTitle}.md`] = "Last.\n";
  await fakeGitHub.addUser({ login });
  await fakeGitHub.addRepo({ owner: login, name: "my-notes", files });
}

const sidebarOf = (page: Page) => page.getByRole("complementary", { name: "Sidebar" });
const notesOf = (page: Page) => page.getByRole("navigation", { name: "Notes" });
const notebooksOf = (page: Page) => page.getByRole("region", { name: "Notebooks" });
const breadcrumbOf = (page: Page) => page.getByRole("navigation", { name: "Breadcrumb" });
const titleOf = (page: Page) => page.getByRole("textbox", { name: "Title" });

/**
 * Waits for the seeded notebook to arrive from the fake GitHub, then folds the
 * Archive folder: its forty entries would otherwise push the rest of the tree
 * below the rows the virtualised list has rendered.
 */
async function openTreeNotebook(page: Page, signInAs: (login: string) => Promise<void>, login: string) {
  await signInAs(login);
  await expect(page).toHaveURL("/notes");
  const archive = notebooksOf(page).getByRole("button", { name: "Archive", exact: true });
  await expect(archive).toBeVisible({ timeout: 20_000 });
  await archive.click();
  await expect(notebooksOf(page).getByRole("button", { name: "Projects", exact: true })).toBeVisible();
}

/** The tree rows' names as assistive technology reads them, top to bottom (the rows' menu buttons aside). */
async function labelsOf(region: Locator): Promise<string[]> {
  const tree = await region.getByRole("list").first().ariaSnapshot();
  return [...tree.matchAll(/button "((?:[^"\\]|\\.)*)"/g)]
    .map((match) => match[1])
    .filter((label) => label !== "Actions" && !label.startsWith("Options for "));
}

test("on a desktop the sidebar tree sits beside the centred editor, under a top bar with a breadcrumb", async ({
  page,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  test.skip(isMobile, "the desktop layout");
  await page.setViewportSize({ width: 1440, height: 900 });
  const login = shellMembers[testInfo.project.name].tree;
  await seedTree(fakeGitHub, login);
  await openTreeNotebook(page, signInAs, login);

  const sidebar = sidebarOf(page);
  await expect(sidebar).toBeVisible();
  const sidebarBox = (await sidebar.boundingBox())!;
  expect(sidebarBox.x).toBe(0);
  expect(sidebarBox.width).toBeGreaterThanOrEqual(260);
  expect(sidebarBox.width).toBeLessThanOrEqual(280);
  expect(sidebarBox.height).toBe(900);
  await expect(sidebar.getByRole("button", { name: "New note" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Sign out" })).toBeVisible();
  // The slot a later ticket fills is there, disabled.
  await expect(sidebar.getByRole("button", { name: "Trash" })).toBeDisabled();

  // Folders first, then notes, each in alphabetical order, nested as the paths say.
  expect((await labelsOf(notebooksOf(page))).slice(0, 12)).toEqual([
    "my-notes",
    "Archive",
    "Journal",
    "2026-01-01",
    "Projects",
    "Garden",
    "Beds",
    "Cedar",
    "Plan",
    "Kitchen shelves",
    "Groceries",
    "Reading list",
  ]);

  await notebooksOf(page).getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page).toHaveURL(`/notes/${ids.plan}`);
  await expect(breadcrumbOf(page).getByRole("listitem")).toHaveText(["my-notes", "Projects", "Garden", "Plan"]);
  await expect(page.getByRole("status")).toHaveText(/Saved|Synced/);
  await expect(notebooksOf(page).getByRole("button", { name: "Plan", exact: true })).toHaveAttribute("aria-current", "page");

  // The editor reads at a comfortable width, centred in the space beside the sidebar.
  const title = titleOf(page);
  await expect(title).toHaveValue("Plan");
  const titleBox = (await title.boundingBox())!;
  const editorCentre = sidebarBox.width + (1440 - sidebarBox.width) / 2;
  expect(Math.abs(titleBox.x + titleBox.width / 2 - editorCentre)).toBeLessThan(2);
  expect(titleBox.width).toBeLessThanOrEqual(640);
  const topBar = (await breadcrumbOf(page).locator("xpath=ancestor::header").boundingBox())!;
  expect(topBar.height).toBe(48);

  await page.screenshot({ path: testInfo.outputPath("desktop-1440.png") });
});

test("on a phone the tree is the home screen, and a note opens full screen with a way back", async ({
  page,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, "the phone layout");
  await page.setViewportSize({ width: 390, height: 844 });
  const login = shellMembers[testInfo.project.name].tree;
  await seedTree(fakeGitHub, login);
  await openTreeNotebook(page, signInAs, login);

  const sidebar = sidebarOf(page);
  const homeBox = (await sidebar.boundingBox())!;
  expect(homeBox).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await expect(titleOf(page)).toBeHidden();
  await expect(breadcrumbOf(page)).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("phone-390-home.png") });

  await notebooksOf(page).getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page).toHaveURL(`/notes/${ids.plan}`);
  const note = page.getByRole("article");
  await expect(titleOf(page)).toHaveValue("Plan");
  await expect.poll(async () => (await note.boundingBox())!).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  // The tree is still there underneath, keeping its place, but out of reach.
  await expect(sidebar).toBeHidden();
  await expect(breadcrumbOf(page)).toBeHidden();
  // The back button is named by where it leads: the folder the note is in.
  const back = page.getByRole("button", { name: "Garden", exact: true });
  await expect(back).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("phone-390-note.png") });

  await back.click();
  await expect(page).toHaveURL("/notes");
  await expect(sidebar).toBeVisible();
  await expect(note).toBeHidden();
});

test("a note's URL names it by id: it survives a reload and a rename, and Back and Forward follow it", async ({
  page,
  signInAs,
  fakeGitHub,
}, testInfo) => {
  const login = shellMembers[testInfo.project.name].tree;
  await seedTree(fakeGitHub, login);
  await openTreeNotebook(page, signInAs, login);
  const title = `Stable ${testInfo.project.name} ${Date.now()}`;

  await page.getByRole("button", { name: "New note" }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  const url = page.url();
  await expect(titleOf(page)).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Note text" })).toBeFocused();
  await page.keyboard.type("Body");
  await expect(page.getByRole("status")).toHaveText("Synced", { timeout: 20_000 });

  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(titleOf(page)).toHaveValue(title);
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveText("Body");

  // Renaming changes the file, never the address.
  await titleOf(page).fill(`${title} renamed`);
  await expect(page).toHaveURL(url);
  await expect(page.getByRole("status")).toHaveText("Synced", { timeout: 20_000 });
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(titleOf(page)).toHaveValue(`${title} renamed`);

  await page.goBack();
  await expect(page).toHaveURL("/notes");
  await expect(titleOf(page)).toBeHidden();
  await expect(sidebarOf(page)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(url);
  await expect(titleOf(page)).toHaveValue(`${title} renamed`);
});

test("a link to a note that isn't on this device says so once sync has looked", async ({
  page,
  signInAs,
  fakeGitHub,
}, testInfo) => {
  const login = shellMembers[testInfo.project.name].tree;
  await seedTree(fakeGitHub, login);
  await signInAs(login);
  await expect(page).toHaveURL("/notes");

  await page.goto("/notes/5d2b1c4e-0000-4000-8000-00000000dead");
  await expect(page.getByText("This note isn't in your notebooks.")).toBeVisible({ timeout: 20_000 });
  await expect(titleOf(page)).toBeHidden();

  // A note that is in the notebook opens straight from its link.
  await page.goto(`/notes/${ids.cedar}`);
  await expect(titleOf(page)).toHaveValue("Cedar");
});

test("the sidebar collapses, from a button or the keyboard, and stays collapsed on this device", async ({
  page,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  test.skip(isMobile, "a phone's sidebar is the home screen");
  const login = shellMembers[testInfo.project.name].tree;
  await seedTree(fakeGitHub, login);
  await openTreeNotebook(page, signInAs, login);
  const sidebar = sidebarOf(page);

  // Folders fold and stay folded too.
  await notebooksOf(page).getByRole("button", { name: "Garden", exact: true }).click();
  await expect(notebooksOf(page).getByRole("button", { name: "Plan", exact: true })).toBeHidden();
  await page.reload();
  await expect(notebooksOf(page).getByRole("button", { name: "Garden", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(notebooksOf(page).getByRole("button", { name: "Plan", exact: true })).toBeHidden();
  await notebooksOf(page).getByRole("button", { name: "Garden", exact: true }).click();
  await expect(notebooksOf(page).getByRole("button", { name: "Plan", exact: true })).toBeVisible();

  await sidebar.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(sidebar).not.toBeInViewport();
  await expect(page.getByRole("button", { name: "Show sidebar" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Show sidebar" })).toBeVisible();
  await expect(sidebar).not.toBeInViewport();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await expect(sidebar).toBeInViewport({ ratio: 1 });

  await page.keyboard.press("ControlOrMeta+\\");
  await expect(sidebar).not.toBeInViewport();
  await page.keyboard.press("ControlOrMeta+\\");
  await expect(sidebar).toBeInViewport({ ratio: 1 });
});

test("the keyboard starts a note without leaving it", async ({ page, signInAs, fakeGitHub, isMobile }, testInfo) => {
  test.skip(isMobile, "phones have no modifier keys to speak of");
  const login = shellMembers[testInfo.project.name].tree;
  await seedTree(fakeGitHub, login);
  await openTreeNotebook(page, signInAs, login);

  await page.keyboard.press("ControlOrMeta+n");
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  await expect(titleOf(page)).toBeFocused();
  await expect(titleOf(page)).toHaveValue(/^Untitled/);
});

test("on a phone, going back returns to the tree where it was scrolled", async ({
  page,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, "the phone layout");
  await page.setViewportSize({ width: 390, height: 844 });
  const login = shellMembers[testInfo.project.name].tree;
  await seedTree(fakeGitHub, login);
  await openTreeNotebook(page, signInAs, login);
  const notes = notesOf(page);
  // The Archive's forty entries give the tree something to scroll.
  await notebooksOf(page).getByRole("button", { name: "Archive", exact: true }).click();
  await expect(notebooksOf(page).getByRole("button", { name: "Entry 01" })).toBeVisible();

  await notes.evaluate((element) => (element.scrollTop = 600));
  const scrolled = await notes.evaluate((element) => element.scrollTop);
  expect(scrolled).toBeGreaterThanOrEqual(500);
  // Whatever note is under the finger there.
  await page.touchscreen.tap(195, 500);
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  await expect(sidebarOf(page)).toBeHidden();

  // The note tapped is an Archive entry, so the way back is named after that folder.
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page).toHaveURL("/notes");
  await expect(sidebarOf(page)).toBeVisible();
  expect(await notes.evaluate((element) => element.scrollTop)).toBe(scrolled);
});

test("on a phone, a drag from the left edge goes back to the tree", async ({ page, signInAs, fakeGitHub, isMobile }, testInfo) => {
  test.skip(!isMobile, "the phone layout");
  await page.setViewportSize({ width: 390, height: 844 });
  const login = shellMembers[testInfo.project.name].tree;
  await seedTree(fakeGitHub, login);
  await signInAs(login);
  await page.goto(`/notes/${ids.plan}`);
  await expect(titleOf(page)).toHaveValue("Plan");

  await page.mouse.move(6, 500);
  await page.mouse.down();
  await page.mouse.move(120, 505, { steps: 6 });
  await page.mouse.move(280, 510, { steps: 6 });
  await page.mouse.up();

  await expect(page).toHaveURL("/notes");
  await expect(sidebarOf(page)).toBeVisible();
  await expect(page.getByRole("article")).toBeHidden();
});

test("a notebook with over a thousand notes and the worst titles stays readable and scrolls smoothly", async ({
  page,
  signInAs,
  fakeGitHub,
}, testInfo) => {
  const login = shellMembers[testInfo.project.name].big;
  await seedBig(fakeGitHub, login);
  await signInAs(login);
  await expect(page).toHaveURL("/notes");

  const notebook = notebooksOf(page).getByRole("button", { name: "my-notes", exact: true });
  await expect(notebook).toHaveAttribute("title", /^my-notes: 1,00\d notes$/, { timeout: 60_000 });
  const notes = notesOf(page);
  const sidebarWidth = (await sidebarOf(page).boundingBox())!.width;

  // The worst titles: shown whole on hover, cut cleanly on screen, never widening the sidebar.
  for (const title of Object.values(worstCase)) {
    const row = notebooksOf(page).getByRole("button", { name: title, exact: true });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("title", title);
    expect((await row.boundingBox())!.width).toBeLessThanOrEqual(sidebarWidth);
  }
  expect(await notes.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  // Twelve folders deep, the row still has room for its name.
  await expect(notebooksOf(page).getByRole("button", { name: "Last", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`big-${testInfo.project.name}.png`) });

  // Only the rows in view are on the page, which is what keeps a thousand rows smooth.
  expect(await notebooksOf(page).getByRole("listitem").count()).toBeLessThan(120);
  const frames = await notes.evaluate(async (element) => {
    const times: number[] = [];
    let last = performance.now();
    for (let step = 0; step < 30; step++) {
      element.scrollTop += 600;
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      times.push(now - last);
      last = now;
    }
    return times;
  });
  expect(frames.filter((ms) => ms > 100)).toHaveLength(0);

  await notes.evaluate((element) => (element.scrollTop = element.scrollHeight));
  await expect(notebooksOf(page).getByRole("button", { name: lastTitle, exact: true })).toBeVisible();
});
