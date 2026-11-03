import type { Page } from "@playwright/test";
import type { FakeGitHubControl } from "../test/fake-github/client";
import { tagMembers } from "./support/env";
import { expect, test } from "./support/fixtures";

// Tags: the field under a note's title, the sidebar's Tags section with its
// counts, and filtering the tree by one or several tags, on desktop and phone.

/** Notes with ids the tests can deep-link to. */
const ids = {
  garden: "9c4e7a1b-0000-4000-8000-000000000001",
  kitchen: "9c4e7a1b-0000-4000-8000-000000000002",
  everything: "9c4e7a1b-0000-4000-8000-000000000003",
};
const frontmatter = (id: string, tags: readonly string[]) => `---\nid: ${id}\ntags: [${tags.join(", ")}]\n---\n`;

const longTag = "quarterly planning with the Northwind Industries Holdings account team and their auditors";
/** The tags one real note can end up with: dozens, one far too long, non-Latin text and emoji. */
const manyTags = [...Array.from({ length: 30 }, (_, index) => `topic ${index + 1}`), longTag, "日本語", "🌱 seeds"];

/** A notebook with tagged notes, seeded once per fake GitHub. */
async function seedTagged(fakeGitHub: FakeGitHubControl, login: string) {
  await fakeGitHub.addUser({ login });
  await fakeGitHub.addRepo({
    owner: login,
    name: "my-notes",
    files: {
      "Garden.md": `${frontmatter(ids.garden, ["plants", "home"])}Raised beds.\n`,
      "Kitchen.md": `${frontmatter(ids.kitchen, ["home", "work"])}Shelves.\n`,
      "Loose.md": "No tags.\n",
      "Everything.md": `${frontmatter(ids.everything, manyTags)}All the tags.\n`,
    },
  });
}

const sidebarOf = (page: Page) => page.getByRole("complementary", { name: "Sidebar" });
const notebooksOf = (page: Page) => page.getByRole("region", { name: "Notebooks" });
const tagFieldOf = (page: Page) => page.getByRole("group", { name: "Tags" });
const chipsOf = (page: Page) => tagFieldOf(page).getByRole("button", { name: /^Remove tag / });
const addTagOf = (page: Page) => page.getByRole("combobox", { name: "Add tag" });
const tagListOf = (page: Page) => sidebarOf(page).getByRole("list", { name: "Tags" });

/** Opens the sidebar's Tags section once the seeded notebook has arrived. */
async function openTags(page: Page) {
  await expect(notebooksOf(page).getByRole("button", { name: "Garden", exact: true })).toBeVisible({ timeout: 20_000 });
  const tags = sidebarOf(page).getByRole("button", { name: "Tags", exact: true });
  if ((await tags.getAttribute("aria-expanded")) !== "true") await tags.click();
  await expect(tagListOf(page)).toBeVisible();
}

test("tags are added with autocomplete, removed with a click or Backspace, and reach the note's frontmatter", async ({
  page,
  signInAs,
  fakeGitHub,
}, testInfo) => {
  const login = tagMembers[testInfo.project.name].field;
  await seedTagged(fakeGitHub, login);
  await signInAs(login);
  await page.goto(`/notes/${ids.garden}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Garden", { timeout: 20_000 });
  await expect(chipsOf(page)).toHaveCount(2);
  await expect(tagFieldOf(page).getByText("plants", { exact: true })).toBeVisible();
  await expect(tagFieldOf(page).getByText("home", { exact: true })).toBeVisible();

  // Typing offers the tags in use elsewhere; the arrow keys and Enter take one.
  const add = addTagOf(page);
  await add.click();
  await page.keyboard.type("wo");
  const options = page.getByRole("listbox", { name: "Existing tags" }).getByRole("option");
  await expect(options).toHaveText([/^work/]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(tagFieldOf(page).getByRole("button", { name: "Remove tag work" })).toBeVisible();
  await expect(add).toHaveValue("");
  await expect(add).toBeFocused();

  // A new tag is typed and entered; a tag the note has, in any casing, isn't added twice.
  await page.keyboard.type("Reading list");
  await page.keyboard.press("Enter");
  await expect(tagFieldOf(page).getByRole("button", { name: "Remove tag Reading list" })).toBeVisible();
  await page.keyboard.type("HOME");
  await page.keyboard.press("Enter");
  await expect(chipsOf(page)).toHaveCount(4);

  // Backspace on the empty field takes the last tag back; the chip's button removes any.
  await page.keyboard.press("Backspace");
  await expect(tagFieldOf(page).getByRole("button", { name: "Remove tag Reading list" })).toBeHidden();
  await tagFieldOf(page).getByRole("button", { name: "Remove tag plants" }).click();
  await expect(chipsOf(page)).toHaveCount(2);

  await expect(page.getByRole("status")).toHaveText("Synced", { timeout: 20_000 });
  const files = await fakeGitHub.files(login, "my-notes");
  expect(files["Garden.md"]).toMatch(/^---\nid: 9c4e7a1b-0000-4000-8000-000000000001\ntags: \[home, work\]\n/);
  expect(files["Garden.md"]).toMatch(/\n---\nRaised beds\.\n$/);

  // Tags edited on github.com show up once the app has pulled.
  await fakeGitHub.commitFiles(login, "my-notes", {
    message: "Tag on github.com",
    files: { "Garden.md": `${frontmatter(ids.garden, ["home", "work", "outdoors"])}Raised beds.\n` },
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(tagFieldOf(page).getByRole("button", { name: "Remove tag outdoors" })).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: testInfo.outputPath(`tag-field-${testInfo.project.name}.png`) });
});

test("the sidebar lists every tag with its count, and the tree narrows to the notes carrying every selected tag", async ({
  page,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  const login = tagMembers[testInfo.project.name].filter;
  await seedTagged(fakeGitHub, login);
  await signInAs(login);
  await openTags(page);
  const list = tagListOf(page);
  const notebooks = notebooksOf(page);

  // Most used first, each counted: "1 note", "2 notes".
  const home = list.getByRole("button", { name: "home", exact: true });
  const work = list.getByRole("button", { name: "work", exact: true });
  const plants = list.getByRole("button", { name: "plants", exact: true });
  await expect(list.getByRole("button").first()).toHaveText("home2");
  await expect(home).toHaveAttribute("title", "home: 2 notes");
  await expect(plants).toHaveAttribute("title", "plants: 1 note");

  // One tag: the notes carrying it, and their folders; nothing else.
  await home.click();
  await expect(home).toHaveAttribute("aria-pressed", "true");
  await expect(notebooks.getByRole("button", { name: "Garden", exact: true })).toBeVisible();
  await expect(notebooks.getByRole("button", { name: "Kitchen", exact: true })).toBeVisible();
  await expect(notebooks.getByRole("button", { name: "Loose", exact: true })).toBeHidden();
  await expect(notebooks.getByRole("button", { name: "Everything", exact: true })).toBeHidden();
  await expect(notebooks.getByText("Filtered by home")).toBeVisible();

  // Several tags: all of them must match.
  await work.click();
  await expect(notebooks.getByRole("button", { name: "Kitchen", exact: true })).toBeVisible();
  await expect(notebooks.getByRole("button", { name: "Garden", exact: true })).toBeHidden();
  await expect(notebooks.getByText("Filtered by home, work")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`filtered-${testInfo.project.name}.png`) });

  // The filter is remembered on this device.
  await page.reload();
  await expect(notebooks.getByText("Filtered by home, work")).toBeVisible({ timeout: 20_000 });
  await expect(notebooks.getByRole("button", { name: "Garden", exact: true })).toBeHidden();

  await notebooks.getByRole("button", { name: "Clear tag filter" }).click();
  await expect(notebooks.getByRole("button", { name: "Loose", exact: true })).toBeVisible();
  await expect(home).toHaveAttribute("aria-pressed", "false");

  // A selected tag taken off its last note stays selectable, at no notes, and the tree says so.
  await plants.click();
  await expect(notebooks.getByRole("button", { name: "Kitchen", exact: true })).toBeHidden();
  await notebooks.getByRole("button", { name: "Garden", exact: true }).click();
  await tagFieldOf(page).getByRole("button", { name: "Remove tag plants" }).click();
  await expect(page.getByRole("status")).toHaveText(/Saved|Synced/);
  if (isMobile) await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(plants).toHaveAttribute("title", "plants: No notes");
  await expect(plants).toHaveText("plants0");
  await expect(notebooks.getByText("No notes have all of these tags.")).toBeVisible();
  await expect(notebooks.getByRole("button", { name: "Garden", exact: true })).toBeHidden();
  // Recent follows the filter too: the note just edited has lost the tag, so it isn't listed.
  const recent = page.getByRole("region", { name: "Recent" });
  await expect(recent).toBeHidden();
  await notebooks.getByRole("button", { name: "Clear tag filter" }).click();
  await expect(notebooks.getByRole("button", { name: "Garden", exact: true })).toBeVisible();
  await expect(recent.getByRole("link", { name: "Garden" })).toBeVisible();
});

test("long tag names and many tags lay out without overflow, in the note and in the sidebar", async ({
  page,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  const login = tagMembers[testInfo.project.name].layout;
  await seedTagged(fakeGitHub, login);
  await signInAs(login);
  await page.goto(`/notes/${ids.everything}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Everything", { timeout: 20_000 });

  // The chips wrap onto several lines; the long one is cut cleanly and shown whole on hover.
  const field = tagFieldOf(page);
  await expect(chipsOf(page)).toHaveCount(manyTags.length);
  const fieldBox = (await field.boundingBox())!;
  expect(fieldBox.height).toBeGreaterThan(80);
  const long = field.getByText(longTag, { exact: true });
  await expect(long).toHaveAttribute("title", longTag);
  expect((await long.boundingBox())!.width).toBeLessThanOrEqual(fieldBox.width);
  await expect(field.getByText("🌱 seeds", { exact: true })).toBeVisible();
  await expect(field.getByText("日本語", { exact: true })).toBeVisible();
  const note = page.getByRole("article");
  expect(await note.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`many-tags-${testInfo.project.name}.png`) });

  // The sidebar's list cuts the long name too, never widening the sidebar.
  if (isMobile) await page.getByRole("button", { name: "Notes", exact: true }).click();
  await openTags(page);
  const sidebar = sidebarOf(page);
  const row = tagListOf(page).getByRole("button", { name: longTag, exact: true });
  await expect(row).toHaveAttribute("title", `${longTag}: 1 note`);
  const sidebarWidth = (await sidebar.boundingBox())!.width;
  expect((await row.boundingBox())!.width).toBeLessThanOrEqual(sidebarWidth);
  expect(await sidebar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(tagListOf(page).getByRole("button")).toHaveCount(manyTags.length + 3);
  await page.screenshot({ path: testInfo.outputPath(`sidebar-tags-${testInfo.project.name}.png`) });
});
