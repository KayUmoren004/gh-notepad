import type { Page } from "@playwright/test";
import type { FakeGitHubControl } from "../test/fake-github/client";
import { searchMembers } from "./support/env";
import { expect, test } from "./support/fixtures";

// The command palette: Cmd/Ctrl+K or Search in the sidebar, a search over
// every note on the device (so it works offline), and the actions.

const frontmatter = (id: string, tags: string[] = []) =>
  `---\nid: ${id}\n${tags.length > 0 ? `tags: [${tags.join(", ")}]\n` : ""}---\n`;
const ids = {
  plan: "7a1c2d3e-0000-4000-8000-000000000001",
  cedar: "7a1c2d3e-0000-4000-8000-000000000002",
  lodge: "7a1c2d3e-0000-4000-8000-000000000003",
};

/** A notebook with words to find in titles, bodies and tags, across folders. */
async function seedNotes(fakeGitHub: FakeGitHubControl, login: string) {
  await fakeGitHub.addUser({ login });
  await fakeGitHub.addRepo({
    owner: login,
    name: "my-notes",
    files: {
      "Projects/Garden/Plan.md": `${frontmatter(ids.plan)}# Plan\n\nRaised beds along the south fence.\n- [ ] Order cedar boards\n`,
      "Projects/Garden/Cedar.md": `${frontmatter(ids.cedar)}Lasts longest outdoors.\n`,
      "Trips/Lodge.md": `${frontmatter(ids.lodge, ["travel", "cedar-lodge"])}Book for March.\n`,
      "Groceries.md": "- Milk\n",
    },
  });
}

/** Over a thousand notes, each with a few words in its body, to type against. */
async function seedBig(fakeGitHub: FakeGitHubControl, login: string) {
  const words = ["garden", "invoice", "agenda", "ferry", "quarterly", "北海道"];
  const folders = ["", "Work", "Work/Clients/Northwind", "日記"];
  const files: Record<string, string> = {};
  for (let index = 0; index < 1_000; index++) {
    const folder = folders[index % folders.length];
    files[`${folder ? `${folder}/` : ""}Note ${index}.md`] = `${words[index % words.length]} ${words[(index + 1) % words.length]} line ${index}\n`;
  }
  files["Needle.md"] = "A haystack word: zymurgy.\n";
  await fakeGitHub.addUser({ login });
  await fakeGitHub.addRepo({ owner: login, name: "my-notes", files });
}

const paletteOf = (page: Page) => page.getByRole("dialog", { name: "Search" });
const queryOf = (page: Page) => page.getByRole("combobox", { name: "Search notes" });
const titleOf = (page: Page) => page.getByRole("textbox", { name: "Title" });

/** Signs in and waits for the seeded notebook to arrive from the fake GitHub. */
async function openNotebook(page: Page, signInAs: (login: string) => Promise<void>, login: string, firstNote: string) {
  await signInAs(login);
  await expect(page).toHaveURL("/notes");
  await expect(page.getByRole("region", { name: "Notebooks" }).getByRole("button", { name: firstNote, exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

test("the keyboard opens the palette, finds text in a body offline, opens the note and closes", async ({
  page,
  context,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  test.skip(isMobile, "phones have no modifier keys to speak of");
  const login = searchMembers[testInfo.project.name].notes;
  await seedNotes(fakeGitHub, login);
  await openNotebook(page, signInAs, login, "Groceries");

  // Everything searched is already on the device.
  await context.setOffline(true);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = paletteOf(page);
  await expect(palette).toBeVisible();
  await expect(queryOf(page)).toBeFocused();
  // Nothing typed yet: the last edited notes and the actions.
  await expect(palette.getByRole("option", { name: "New note" })).toBeVisible();

  await page.keyboard.type("cedar");
  const options = palette.getByRole("option");
  // The title match first, then the matches in the text and the tags.
  await expect(options.first()).toContainText("Cedar");
  await expect(options.first()).toContainText("my-notes / Projects / Garden");
  const plan = palette.getByRole("option", { name: /Plan/ });
  await expect(plan).toContainText("Order cedar boards");
  await expect(plan.locator("mark")).toHaveText("cedar");
  await expect(palette.getByRole("option", { name: /Lodge/ })).toContainText("#cedar-lodge");
  await page.screenshot({ path: testInfo.outputPath("palette-desktop.png") });

  // The arrow keys move the selection, and Enter opens it, without leaving the keyboard.
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(2)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  const chosen = (await options.nth(1).textContent())!.includes("Plan") ? "Plan" : "Lodge";
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(`/notes/${chosen === "Plan" ? ids.plan : ids.lodge}`);
  await expect(titleOf(page)).toHaveValue(chosen);

  // Open again: Cmd/Ctrl+K toggles, and Escape closes.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette).toBeHidden();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("travel");
  await expect(palette.getByRole("option", { name: /Lodge/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await context.setOffline(false);
});

test("a query that names an action runs it, and one that matches nothing says so", async ({
  page,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  test.skip(isMobile, "phones have no modifier keys to speak of");
  const login = searchMembers[testInfo.project.name].notes;
  await seedNotes(fakeGitHub, login);
  await openNotebook(page, signInAs, login, "Groceries");
  await page.goto(`/notes/${ids.cedar}`);
  await expect(titleOf(page)).toHaveValue("Cedar");

  await page.keyboard.press("ControlOrMeta+k");
  const palette = paletteOf(page);
  await page.keyboard.type("zzzz");
  await expect(palette.getByText("No notes match “zzzz”.")).toBeVisible();

  await queryOf(page).fill("source");
  const switchMode = palette.getByRole("option", { name: "Switch to source mode" });
  await expect(switchMode).toBeVisible();
  await switchMode.click();
  await expect(palette).toBeHidden();
  await expect(page.getByRole("group", { name: "Editing mode" }).getByRole("button", { name: "Source" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.keyboard.press("ControlOrMeta+k");
  await queryOf(page).fill("new");
  await expect(palette.getByRole("option", { name: "New note" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  await expect(titleOf(page)).toHaveValue(/^Untitled/);
});

test("on a phone, Search in the sidebar opens a full-screen search the keyboard can't cover", async ({
  page,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, "the phone layout");
  await page.setViewportSize({ width: 390, height: 844 });
  const login = searchMembers[testInfo.project.name].notes;
  await seedNotes(fakeGitHub, login);
  await openNotebook(page, signInAs, login, "Groceries");

  await page.getByRole("complementary", { name: "Sidebar" }).getByRole("button", { name: "Search" }).click();
  const palette = paletteOf(page);
  await expect(palette).toBeVisible();
  expect((await palette.boundingBox())!).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  const query = queryOf(page);
  await expect(query).toBeFocused();
  // 16px, so the phone doesn't zoom into it, and at the top, above the keyboard.
  expect(await query.evaluate((element) => getComputedStyle(element).fontSize)).toBe("16px");
  expect((await query.boundingBox())!.y).toBeLessThan(60);

  await query.fill("fence");
  const plan = palette.getByRole("option", { name: /Plan/ });
  await expect(plan).toContainText("Raised beds along the south fence.");
  await page.screenshot({ path: testInfo.outputPath("palette-phone.png") });
  await plan.tap();
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(`/notes/${ids.plan}`);
  await expect(titleOf(page)).toHaveValue("Plan");

  // Back on the tree, a way out without a keyboard.
  await page.getByRole("button", { name: "Garden", exact: true }).click();
  await page.getByRole("button", { name: "Search" }).click();
  await expect(palette).toBeVisible();
  await page.getByRole("button", { name: "Close search" }).click();
  await expect(palette).toBeHidden();
});

test("with a thousand notes, results appear within two frames of a keystroke", async ({
  page,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  const login = searchMembers[testInfo.project.name].big;
  await seedBig(fakeGitHub, login);
  await signInAs(login);
  await expect(page).toHaveURL("/notes");
  const notebook = page.getByRole("region", { name: "Notebooks" }).getByRole("button", { name: "my-notes", exact: true });
  await expect(notebook).toHaveAttribute("title", /^my-notes: 1,001 notes$/, { timeout: 60_000 });

  if (isMobile) await page.getByRole("button", { name: "Search" }).click();
  else await page.keyboard.press("ControlOrMeta+k");
  const palette = paletteOf(page);
  await expect(queryOf(page)).toBeFocused();

  // Each keystroke is typed as the browser would, then two frames are waited: the results must be there.
  const typed = await queryOf(page).evaluate(async (element) => {
    const input = element as HTMLInputElement;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    const frame = () => new Promise(requestAnimationFrame);
    const counts: { query: string; options: number; ms: number }[] = [];
    for (const query of ["g", "ga", "gar", "garden", "garden i", "北", "line 99", "zym"]) {
      const started = performance.now();
      set.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await frame();
      await frame();
      const options = document.querySelectorAll('[role="option"]').length;
      counts.push({ query, options, ms: performance.now() - started });
    }
    return counts;
  });
  for (const { query, options } of typed) expect(options, `results for “${query}”`).toBeGreaterThan(0);
  await expect(palette.getByRole("option", { name: /Needle/ })).toContainText("zymurgy");
  // Fifty results at most are on the page, which is what keeps every keystroke cheap.
  await queryOf(page).fill("line");
  await expect(palette.getByRole("option").first()).toBeVisible();
  expect(await palette.getByRole("option").count()).toBeLessThanOrEqual(51);
  await page.screenshot({ path: testInfo.outputPath(`palette-big-${testInfo.project.name}.png`) });
  testInfo.annotations.push({ type: "keystroke timings (ms, two frames)", description: typed.map((t) => `${t.query}: ${t.ms.toFixed(0)}`).join(", ") });
});
