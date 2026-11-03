import type { Locator, Page } from "@playwright/test";
import type { FakeGitHubControl } from "../test/fake-github/client";
import { folderMembers } from "./support/env";
import { expect, test } from "./support/fixtures";

// Folders: made from the sidebar or a row's menu, renamed in place, and moved
// with everything in them, by drag and drop on desktop and the Move to… sheet
// on a phone. Every move reaches the notebook on GitHub as file moves.

/** A notebook with a folder, some top-level notes and an empty folder kept by a .gitkeep, seeded once per fake GitHub. */
async function seed(fakeGitHub: FakeGitHubControl, login: string) {
  await fakeGitHub.addUser({ login });
  await fakeGitHub.addRepo({
    owner: login,
    name: "my-notes",
    files: {
      "Projects/Plan.md": "Raised beds along the south fence.\n",
      "Archive/Old.md": "Last year.\n",
      "Groceries.md": "- Milk\n",
      "Reading list.md": "Books.\n",
      "Ideas/.gitkeep": "",
    },
  });
}

const notebooksOf = (page: Page) => page.getByRole("region", { name: "Notebooks" });
const rowOf = (page: Page, name: string) => notebooksOf(page).getByRole("button", { name, exact: true });
/** The "…" of the row named `name`. */
const actionsOf = (page: Page, name: string) =>
  notebooksOf(page)
    .locator("[data-tree-row]", { has: page.getByRole("button", { name, exact: true }) })
    .getByRole("button", { name: "Actions" });

/** The tree rows' names as assistive technology reads them, top to bottom (the rows' menu buttons aside). */
async function labelsOf(region: Locator): Promise<string[]> {
  const tree = await region.getByRole("list").first().ariaSnapshot();
  return [...tree.matchAll(/button "((?:[^"\\]|\\.)*)"/g)]
    .map((match) => match[1])
    .filter((label) => label !== "Actions" && !label.startsWith("Options for "));
}

/** Waits for the notebook on GitHub to hold exactly these paths (README aside), as sync lands each move. */
async function expectNotebookFiles(fakeGitHub: FakeGitHubControl, login: string, paths: string[]) {
  await expect
    .poll(async () => Object.keys(await fakeGitHub.files(login, "my-notes")).filter((path) => path !== "README.md").sort(), {
      timeout: 20_000,
    })
    .toEqual([...paths].sort());
}

async function openNotebook(page: Page, signInAs: (login: string) => Promise<void>, login: string) {
  await signInAs(login);
  await expect(page).toHaveURL("/notes");
  await expect(rowOf(page, "Projects")).toBeVisible({ timeout: 20_000 });
  // The empty folder arrived from GitHub along with the notes.
  await expect(rowOf(page, "Ideas")).toBeVisible();
}

/** Drags with the mouse from one row to another, in steps, and leaves the pointer held down over the target. */
async function dragRow(page: Page, from: Locator, to: Locator) {
  const start = (await from.boundingBox())!;
  const end = (await to.boundingBox())!;
  await page.mouse.move(start.x + 40, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + 52, start.y + start.height / 2, { steps: 3 });
  await page.mouse.move(end.x + 40, end.y + end.height / 2, { steps: 8 });
}

test("on desktop, folders are made nested, a note is dragged into one, and it all survives a reload", async ({
  page,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  test.skip(isMobile, "dragging is for pointers; phones use Move to…");
  const login = folderMembers[testInfo.project.name];
  await seed(fakeGitHub, login);
  await openNotebook(page, signInAs, login);

  // A folder at the top level, from the sidebar.
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Folder name" }).fill("Garden");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(rowOf(page, "Garden")).toBeVisible();

  // One inside it, from the folder's menu.
  await rowOf(page, "Garden").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await dialog.getByRole("textbox", { name: "Folder name" }).fill("Beds");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(rowOf(page, "Beds")).toBeVisible();
  await expectNotebookFiles(fakeGitHub, login, [
    "Archive/Old.md",
    "Garden/.gitkeep",
    "Garden/Beds/.gitkeep",
    "Groceries.md",
    "Ideas/.gitkeep",
    "Projects/Plan.md",
    "Reading list.md",
  ]);

  // A note dragged into the nested folder: the ghost says where it is going, the drop moves it.
  await dragRow(page, rowOf(page, "Groceries"), rowOf(page, "Beds"));
  await expect(page.getByText("Move to Beds")).toBeVisible();
  await page.mouse.up();
  expect(await labelsOf(notebooksOf(page))).toEqual([
    "my-notes",
    "Archive",
    "Old",
    "Garden",
    "Beds",
    "Groceries",
    "Ideas",
    "Projects",
    "Plan",
    "Reading list",
  ]);
  await expectNotebookFiles(fakeGitHub, login, [
    "Archive/Old.md",
    "Garden/.gitkeep",
    "Garden/Beds/.gitkeep",
    "Garden/Beds/Groceries.md",
    "Ideas/.gitkeep",
    "Projects/Plan.md",
    "Reading list.md",
  ]);
  await page.screenshot({ path: testInfo.outputPath("desktop-after-drop.png") });

  // A folder can't go into its own descendant: the drop is refused, with the reason, and nothing moves.
  await dragRow(page, rowOf(page, "Garden"), rowOf(page, "Beds"));
  // Said twice: in the ghost by the pointer, and in the live region for assistive technology.
  await expect(page.getByText("A folder can't go inside itself")).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath("desktop-refused-drop.png") });
  await page.mouse.up();
  await expect(page.getByText("A folder can't go inside itself")).toHaveCount(0);
  expect((await labelsOf(notebooksOf(page))).slice(3, 6)).toEqual(["Garden", "Beds", "Groceries"]);

  // Renamed in place: everything under the folder moves with it.
  await rowOf(page, "Beds").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const field = notebooksOf(page).getByRole("textbox", { name: "Folder name" });
  await expect(field).toBeFocused();
  await field.fill("Raised beds");
  await field.press("Enter");
  await expect(rowOf(page, "Raised beds")).toBeVisible();
  await expect(rowOf(page, "Raised beds")).toBeFocused();
  await expectNotebookFiles(fakeGitHub, login, [
    "Archive/Old.md",
    "Garden/.gitkeep",
    "Garden/Raised beds/.gitkeep",
    "Garden/Raised beds/Groceries.md",
    "Ideas/.gitkeep",
    "Projects/Plan.md",
    "Reading list.md",
  ]);

  await page.reload();
  await expect(rowOf(page, "Groceries")).toBeVisible({ timeout: 20_000 });
  expect(await labelsOf(notebooksOf(page))).toEqual([
    "my-notes",
    "Archive",
    "Old",
    "Garden",
    "Raised beds",
    "Groceries",
    "Ideas",
    "Projects",
    "Plan",
    "Reading list",
  ]);
});

test("on a phone, Move to… moves a note from the tree and from the note itself, and a folder is renamed from its menu", async ({
  page,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, "the phone layout");
  const login = folderMembers[testInfo.project.name];
  await seed(fakeGitHub, login);
  await openNotebook(page, signInAs, login);

  // From a row's menu: a sheet listing the folders, the note's own folder out of bounds.
  await actionsOf(page, "Groceries").click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  const sheet = page.getByRole("dialog", { name: "Move Groceries to" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^my-notes/ })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("phone-move-to.png") });
  await sheet.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(await labelsOf(notebooksOf(page))).toEqual(["my-notes", "Archive", "Old", "Ideas", "Projects", "Groceries", "Plan", "Reading list"]);
  await expectNotebookFiles(fakeGitHub, login, [
    "Archive/Old.md",
    "Ideas/.gitkeep",
    "Projects/Groceries.md",
    "Projects/Plan.md",
    "Reading list.md",
  ]);

  // From the note's own menu in the top bar; the way back is then named after the new folder.
  await rowOf(page, "Plan").click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Plan");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  const planSheet = page.getByRole("dialog", { name: "Move Plan to" });
  await planSheet.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(planSheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Synced", { timeout: 20_000 });
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page).toHaveURL("/notes");

  // A folder renamed from its menu, everything in it along.
  await actionsOf(page, "Projects").click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const field = notebooksOf(page).getByRole("textbox", { name: "Folder name" });
  await field.fill("Work");
  await field.press("Enter");
  await expect(rowOf(page, "Work")).toBeVisible();
  await expectNotebookFiles(fakeGitHub, login, [
    "Archive/Old.md",
    "Archive/Plan.md",
    "Ideas/.gitkeep",
    "Reading list.md",
    "Work/Groceries.md",
  ]);

  await page.reload();
  await expect(rowOf(page, "Work")).toBeVisible({ timeout: 20_000 });
  expect(await labelsOf(notebooksOf(page))).toEqual(["my-notes", "Archive", "Old", "Plan", "Ideas", "Work", "Groceries", "Reading list"]);
});
