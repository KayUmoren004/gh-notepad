import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";

// Rich text mode on its own, in the dev harness at /dev/rich-text: the editor,
// the Markdown it saves, and a button that changes the note as another device would.

const fixture = (name: string) => readFileSync(`lib/rich-text/corpus/gfm/${name}.md`, "utf8");

async function open(page: Page, name?: string): Promise<Locator> {
  await page.goto(name ? `/dev/rich-text?fixture=${name}` : "/dev/rich-text");
  const editor = page.getByRole("textbox", { name: "Note body" });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  return editor;
}

const saved = (page: Page) => page.getByTestId("saved-markdown");

/** The note body the editor last saved, byte for byte. */
const expectSaved = (page: Page, markdown: string) => expect.poll(() => saved(page).textContent()).toBe(markdown);

/** The formatting controls: a floating bar over the selection on desktop, the bar above the keyboard on a phone. */
const formatBar = (page: Page, isMobile: boolean) =>
  page.getByRole("toolbar", { name: isMobile ? "Formatting" : "Format", exact: true });

/** Extends the selection leftwards one character at a time, paced: a phone drops keys sent faster than it can read them. */
async function selectBackwards(page: Page, characters: number) {
  for (let index = 0; index < characters; index++) await page.keyboard.press("Shift+ArrowLeft", { delay: 40 });
}

test("renders only in the browser, without hydration errors, and never rewrites the note it loads", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // The fixture's image has nowhere to load from here; that isn't a page error.
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
  });

  const html = await (await request.get("/dev/rich-text?fixture=representative-note")).text();
  expect(html).not.toContain("contenteditable");

  const editor = await open(page, "representative-note");
  await expect(editor.getByRole("heading", { name: "Weekly planning" })).toBeVisible();
  await expect(page.getByLabel("Saves")).toHaveText("0");
  await expectSaved(page, fixture("representative-note"));
  expect(errors).toEqual([]);
});

test("Markdown shortcuts turn into blocks as you type", async ({ page }) => {
  const editor = await open(page);
  await editor.click();

  for (const line of ["# Heading", "- bullet", "", "1. first", "", "[ ] task", "", "> quote", ""]) {
    if (line) await page.keyboard.type(line);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("``` ");
  await page.keyboard.type("plain code");

  await expectSaved(page, "# Heading\n\n- bullet\n\n1. first\n\n- [ ] task\n\n> quote\n\n```\nplain code\n```\n");
});

test("Markdown shortcuts format text as you type", async ({ page }) => {
  const editor = await open(page);
  await editor.click();

  await page.keyboard.type("Some **bold**, *italic*, ~~struck~~ and `code` text");

  await expect(editor.locator("strong")).toHaveText("bold");
  await expect(editor.locator("em")).toHaveText("italic");
  await expect(editor.locator("s")).toHaveText("struck");
  await expect(editor.locator("code")).toHaveText("code");
  await expectSaved(page, "Some **bold**, *italic*, ~~struck~~ and `code` text\n");
});

test("keyboard shortcuts format the selection", async ({ page }) => {
  const editor = await open(page);
  await editor.click();
  await page.keyboard.type("word");
  await selectBackwards(page, 4);

  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.press("ControlOrMeta+i");

  await expect(editor.locator("strong em, em strong")).toHaveText("word");
  await page.keyboard.press("ControlOrMeta+i");
  await expectSaved(page, "**word**\n");
});

test("the slash menu inserts blocks from the keyboard, appearing instantly", async ({ page }) => {
  const editor = await open(page);
  await editor.click();

  await page.keyboard.type("/head");
  const menu = page.getByRole("listbox", { name: "Insert block" });
  await expect(menu.getByRole("option", { name: "Heading 1" })).toHaveAttribute("aria-selected", "true");
  await expect(menu).toHaveAttribute("data-animate", "false");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("option", { name: "Heading 2" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Plan");

  await expect(menu).toBeHidden();
  await expectSaved(page, "## Plan\n");
});

test("the slash menu inserts a block picked with a pointer", async ({ page }) => {
  const editor = await open(page);
  await editor.click();

  await page.keyboard.type("/");
  await page.getByRole("option", { name: "Task list" }).click();
  await page.keyboard.type("Pack the bags");

  await expectSaved(page, "- [ ] Pack the bags\n");
});

test("the slash menu says when nothing matches, and Escape closes it", async ({ page }) => {
  const editor = await open(page);
  await editor.click();

  await page.keyboard.type("/zzz");
  const menu = page.getByRole("listbox", { name: "Insert block" });
  await expect(menu).toContainText("No matching blocks");
  await page.keyboard.press("Escape");

  await expect(menu).toBeHidden();
  await expectSaved(page, "/zzz\n");
});

test("the format bar formats the selection", async ({ page, isMobile }) => {
  const editor = await open(page);
  await editor.click();
  await page.keyboard.type("Make this bold");
  await selectBackwards(page, 4);

  await formatBar(page, isMobile).getByRole("button", { name: "Bold" }).click();

  await expectSaved(page, "Make this **bold**\n");
  await expect(formatBar(page, isMobile).getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
});

test("the format bar adds, edits and removes links", async ({ page, isMobile }) => {
  const editor = await open(page);
  await editor.click();
  await page.keyboard.type("Read the docs");
  await selectBackwards(page, 4);

  await formatBar(page, isMobile).getByRole("button", { name: "Link" }).click();
  await page.getByRole("textbox", { name: "Link address" }).fill("example.com/docs");
  await page.keyboard.press("Enter");
  await expectSaved(page, "Read the [docs](https://example.com/docs)\n");

  await editor.getByRole("link", { name: "docs" }).click();
  await formatBar(page, isMobile).getByRole("button", { name: "Link" }).click();
  await expect(page.getByRole("textbox", { name: "Link address" })).toHaveValue("https://example.com/docs");
  await page.getByRole("textbox", { name: "Link address" }).fill("https://example.com/guide");
  await page.keyboard.press("Enter");
  await expectSaved(page, "Read the [docs](https://example.com/guide)\n");

  await formatBar(page, isMobile).getByRole("button", { name: "Link" }).click();
  await page.getByRole("button", { name: "Remove link" }).click();
  await expectSaved(page, "Read the docs\n");
});

test.describe("desktop", () => {
  test.skip(({ isMobile }) => isMobile, "fine pointers only");

  test("the format bar animates in from its side for a mouse selection, and appears at once for a keyboard one", async ({ page }) => {
    const editor = await open(page);
    await editor.click();
    await page.keyboard.type("Select me please");
    const bar = page.getByRole("toolbar", { name: "Format", exact: true });

    await selectBackwards(page, 6);
    await expect(bar).toHaveAttribute("data-animate", "false");
    await page.keyboard.press("End");
    await expect(bar).toBeHidden();

    // On the first word: the paragraph is wider than its text.
    await editor.getByText("Select me please").dblclick({ position: { x: 8, y: 8 } });
    await expect(bar).toHaveAttribute("data-animate", "true");
    await expect(bar).toHaveAttribute("data-side", "top");
    const { animation, origin, height } = await bar.evaluate((element) => {
      const style = getComputedStyle(element);
      return { animation: style.animationName, origin: style.transformOrigin, height: (element as HTMLElement).offsetHeight };
    });
    expect(animation).toBe("enter");
    // Bottom centre: it grows out of the selection below it.
    expect(origin.split(" ")[1]).toBe(`${height}px`);
  });

  test("Ctrl/Cmd+K opens the link field for the selection", async ({ page }) => {
    const editor = await open(page);
    await editor.click();
    await page.keyboard.type("A link");
    await selectBackwards(page, 4);

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("textbox", { name: "Link address" })).toBeFocused();
    await page.keyboard.type("https://example.com");
    await page.keyboard.press("Enter");

    await expectSaved(page, "A [link](https://example.com)\n");
  });
});

test("task list checkboxes tick, changing only that task's line", async ({ page }) => {
  const editor = await open(page, "task-lists");

  await editor.getByRole("listitem").filter({ hasText: "Book flights" }).getByRole("checkbox").check();

  await expectSaved(page, fixture("task-lists").replace("- [ ] Book flights", "- [x] Book flights"));
});

test("code blocks are highlighted by language", async ({ page }) => {
  const editor = await open(page, "code");
  const keyword = editor.locator("pre .hljs-keyword").first();

  await expect(keyword).toHaveText("export");
  await expect(keyword).toHaveCSS("color", "rgb(224, 163, 112)");
  await expect(editor.locator("pre .hljs-string").first()).toBeVisible();
});

test("tables are inserted from the slash menu and edited in place", async ({ page, isMobile }) => {
  const editor = await open(page);
  await editor.click();

  await page.keyboard.type("/table");
  await page.keyboard.press("Enter");
  for (const cell of ["Fruit", "Count", "Kind", "Apple", "3"]) {
    await page.keyboard.type(cell);
    await page.keyboard.press("Tab");
  }
  await page.getByRole("toolbar", { name: isMobile ? "Formatting" : "Table", exact: true }).getByRole("button", { name: "Add row" }).click();

  await expect(editor.locator("tr")).toHaveCount(4);
  await expect.poll(() => saved(page).textContent()).toContain("| Fruit | Count | Kind |\n| --- | --- | --- |\n| Apple | 3 |");
});

test("a remote change appears without moving the cursor from where the member is typing", async ({ page }) => {
  const editor = await open(page, "representative-note");
  // The quote's two source lines show as one flowing line, as on GitHub: walk to the end of the first.
  await editor.getByText("Ship small, ship often.").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Home");
  for (let step = 0; step < "Ship small, ship often.".length; step++) await page.keyboard.press("ArrowRight");
  await page.keyboard.type(" Always");

  await page.getByRole("button", { name: "Simulate a remote change" }).click();
  await expect(editor.getByText("A paragraph from another device.")).toBeVisible();
  await page.keyboard.type("!");

  await expectSaved(page, `A paragraph from another device.\n\n${fixture("representative-note").replace("Ship small, ship often.", "Ship small, ship often. Always!")}`);
});

test.describe("phone", () => {
  test.skip(({ isMobile }) => !isMobile, "touch screens only");

  test("the formatting bar sits above the keyboard with 44 px touch targets", async ({ page }) => {
    const editor = await open(page);
    await expect(page.getByRole("toolbar", { name: "Formatting", exact: true })).toBeHidden();
    await editor.click();
    const bar = page.getByRole("toolbar", { name: "Formatting", exact: true });
    await expect(bar).toBeVisible();

    for (const button of await bar.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    // The software keyboard shrinks the visual viewport; the bar follows its bottom edge.
    const keyboardOpen = async (height: number) =>
      page.evaluate((visible) => {
        const viewport = window.visualViewport;
        if (!viewport) throw new Error("no visual viewport");
        Object.defineProperty(viewport, "height", { configurable: true, get: () => visible });
        viewport.dispatchEvent(new Event("resize"));
      }, height);
    await keyboardOpen(400);
    await expect.poll(async () => Math.round(((await bar.boundingBox())?.y ?? 0) + ((await bar.boundingBox())?.height ?? 0))).toBe(400);
  });

  test("the insert button opens the slash menu, which animates in", async ({ page }) => {
    const editor = await open(page);
    await editor.click();

    await page.getByRole("toolbar", { name: "Formatting", exact: true }).getByRole("button", { name: "Insert block" }).click();
    const menu = page.getByRole("listbox", { name: "Insert block" });
    await expect(menu).toHaveAttribute("data-animate", "true");
    await menu.getByRole("option", { name: "Quote" }).click();
    await page.keyboard.type("Said well");

    await expectSaved(page, "> Said well\n");
  });

  test("no floating format bar competes with the phone's own selection menu", async ({ page }) => {
    const editor = await open(page);
    await editor.click();
    await page.keyboard.type("Select this");
    await selectBackwards(page, 4);

    await expect(page.getByRole("toolbar", { name: "Formatting", exact: true })).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Format", exact: true })).toBeHidden();
  });
});
