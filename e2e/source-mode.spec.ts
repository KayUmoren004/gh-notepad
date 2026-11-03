import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { members } from "./support/env";
import { expect, test } from "./support/fixtures";

// Source mode on its own in the dev harness at /dev/source-mode, and the
// switch between rich text mode and source mode in the notes app.

const fixture = (name: string) => readFileSync(`lib/rich-text/corpus/gfm/${name}.md`, "utf8");

async function openHarness(page: Page, name?: string): Promise<Locator> {
  await page.goto(name ? `/dev/source-mode?fixture=${name}` : "/dev/source-mode");
  const editor = page.getByRole("textbox", { name: "Note body" });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  return editor;
}

const saved = (page: Page) => page.getByTestId("saved-markdown");

/** The note body the editor last saved, byte for byte. */
const expectSaved = (page: Page, markdown: string) => expect.poll(() => saved(page).textContent()).toBe(markdown);

/** The note body in the app, whichever mode it is in. */
const noteText = (page: Page) => page.getByRole("textbox", { name: "Note text" });
const modeToggle = (page: Page) => page.getByRole("group", { name: "Editing mode" });
const expectMode = (page: Page, mode: "Rich text" | "Source") =>
  expect(modeToggle(page).getByRole("button", { name: mode })).toHaveAttribute("aria-pressed", "true");

/** A file in a notebook without the frontmatter the app adds the first time it saves the note. */
const withoutFrontmatter = (file: string) => file.replace(/^---\n[\s\S]*?\n---\n/, "");

/** Every script this page has loaded so far. */
const loadedScripts = (page: Page) =>
  page.evaluate(() => {
    const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
    const tags = [...document.scripts].map((script) => script.src);
    return [...new Set([...resources, ...tags])].filter((url) => /\.js(\?|$)/.test(url));
  });

test("shows the exact Markdown in the app's colours, rendered only in the browser, and never rewrites the note it loads", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const html = await (await request.get("/dev/source-mode?fixture=representative-note")).text();
  expect(html).not.toContain("cm-content");

  const editor = await openHarness(page, "representative-note");
  await expect(editor.getByText("Weekly planning")).toHaveCSS("font-weight", "600");
  await expect(editor.getByText("Weekly planning")).toHaveCSS("font-size", "24px");
  await expect(editor.locator("span", { hasText: "**" }).first()).toHaveCSS("color", "rgb(157, 152, 144)");
  // The editor draws only the lines near the viewport; the note's end has the link and the code block.
  await editor.evaluate((element) => element.scrollIntoView({ block: "end" }));
  await expect(editor.getByText("https://example.com/roadmap")).toHaveCSS("color", "rgb(143, 181, 214)");
  await expect(editor.getByText("npm run build")).toHaveCSS("font-family", /mono/i);
  await expect(editor).toHaveCSS("font-size", "16px");
  await expect(editor).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.getByLabel("Saves")).toHaveText("0");
  await expectSaved(page, fixture("representative-note"));
  expect(errors).toEqual([]);
});

test("edits are saved as typed, and undo steps back through them", async ({ page }) => {
  const editor = await openHarness(page);
  await editor.click();

  // Paced like typing: on Android, CodeMirror lets the browser handle an Enter and reads the result from the
  // DOM, and drops one that lands within 50 ms of the previous key with nothing to read.
  await page.keyboard.type("# Title\n\n- [ ] a task with **bold** text", { delay: 60 });
  await expectSaved(page, "# Title\n\n- [ ] a task with **bold** text");

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => saved(page).textContent()).not.toBe("# Title\n\n- [ ] a task with **bold** text");
});

test("a remote change appears without moving the cursor from where the member is typing", async ({ page }) => {
  const editor = await openHarness(page, "representative-note");
  await editor.getByText("Ship small, ship often.").click();
  await page.keyboard.press("End");
  // Paced like typing: on Android, CodeMirror reads typed text back from the DOM, and synthetic keys
  // faster than any thumb can drop one on the way.
  await page.keyboard.type(" Always", { delay: 60 });

  await page.getByRole("button", { name: "Simulate a remote change" }).click();
  await page.keyboard.type("!");

  // Had the change not reached the editor, this keystroke would have saved the note without it.
  const merged = `A paragraph from another device.\n\n${fixture("representative-note").replace("Ship small, ship often.", "Ship small, ship often. Always!")}`;
  await expectSaved(page, merged);
  // The editor draws only the lines near the viewport; the new paragraph is at the top.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(editor.getByText("A paragraph from another device.")).toBeVisible();

  // The remote change isn't the member's to undo: undo takes back their own typing only.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => saved(page).textContent()).not.toBe(merged);
  await expect.poll(() => saved(page).textContent()).toContain("A paragraph from another device.");
});

test("a note with Markdown rich text mode can't show opens in source mode; switching keeps the content, the cursor's place and the file", async ({
  page,
  signInAs,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  const title = `Raw ${testInfo.project.name} ${Date.now()}`;
  const body =
    "# Agenda\n\nSome _emphasis_ and __strong__ text.\n\n* one\n    * nested\n\n<details>\n<summary>Raw HTML</summary>\n</details>\n";
  await fakeGitHub.addUser({ login: members.allowed });
  await fakeGitHub.addRepo({ owner: members.allowed, name: "my-notes", files: { "README.md": "# my-notes\n" } });
  await fakeGitHub.commitFiles(members.allowed, "my-notes", {
    message: "Written on github.com",
    files: { [`${title}.md`]: body },
  });
  await signInAs(members.allowed);
  await page.getByRole("button", { name: title }).click({ timeout: 20_000 });

  await expectMode(page, "Source");
  await expect(noteText(page)).toHaveClass(/cm-content/);
  await expect(noteText(page)).toContainText("<summary>Raw HTML</summary>");

  // Toggling back and forth without edits leaves the file alone: it isn't even given frontmatter.
  await modeToggle(page).getByRole("button", { name: "Rich text" }).click();
  await expect(noteText(page)).toHaveClass(/rich-text/);
  await expect(noteText(page).getByRole("heading", { name: "Agenda" })).toBeVisible();
  await modeToggle(page).getByRole("button", { name: "Source" }).click();
  await expect(noteText(page)).toHaveClass(/cm-content/);
  // Switching notes syncs; on a phone the open note covers the list, so go back to it first.
  if (isMobile) await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "New note" }).click();
  await expect(page.getByRole("status")).toHaveText("Synced", { timeout: 20_000 });
  expect((await fakeGitHub.files(members.allowed, "my-notes"))[`${title}.md`]).toBe(body);

  // The chosen mode is remembered for the note on this device, and not for other notes.
  await page.reload();
  await page.getByRole("button", { name: title }).click();
  await expectMode(page, "Source");
  await expect(noteText(page)).toHaveClass(/cm-content/);

  // The cursor's place is carried across: after "nested" in source mode, after "nested" in rich text mode.
  await noteText(page).getByText("nested").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ControlOrMeta+Shift+M");
  await expectMode(page, "Rich text");
  await expect(noteText(page)).toHaveClass(/rich-text/);
  await expect(noteText(page)).toBeFocused();
  await page.keyboard.type(" item");

  await page.keyboard.press("ControlOrMeta+Shift+M");
  await expectMode(page, "Source");
  await expect(noteText(page)).toHaveClass(/cm-content/);
  await expect(noteText(page)).toBeFocused();
  await page.keyboard.type("s");

  // Edits made in source mode sync like any other edit, and the rest of the file is as it was.
  await expect(page.getByRole("status")).toHaveText("Synced", { timeout: 20_000 });
  const files = await fakeGitHub.files(members.allowed, "my-notes");
  expect(withoutFrontmatter(files[`${title}.md`])).toBe(body.replace("* nested", "* nested items"));
});

test("a note written in the app opens in rich text mode, and source mode arrives only when asked for", async ({
  page,
  signInAs,
}, testInfo) => {
  const title = `Plain ${testInfo.project.name} ${Date.now()}`;
  await signInAs(members.allowed);
  await page.getByRole("button", { name: "New note" }).click();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await expect(noteText(page)).toBeFocused();
  await page.keyboard.type("- Milk");
  await expectMode(page, "Rich text");
  await expect(noteText(page).getByRole("listitem")).toHaveText(["Milk"]);

  // Nothing of CodeMirror is in the scripts the app has loaded so far.
  const before = await loadedScripts(page);
  expect(before.length).toBeGreaterThan(0);
  for (const url of before) expect((await page.request.get(url)).text(), url).resolves.not.toContain("cm-content");

  await modeToggle(page).getByRole("button", { name: "Source" }).click();
  await expect(noteText(page)).toHaveClass(/cm-content/);
  await expect(noteText(page)).toHaveText("- Milk");
  const added = (await loadedScripts(page)).filter((url) => !before.includes(url));
  const contents = await Promise.all(added.map(async (url) => (await page.request.get(url)).text()));
  expect(contents.some((script) => script.includes("cm-content"))).toBe(true);
});
