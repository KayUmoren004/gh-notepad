import type { Locator, Page } from "@playwright/test";
import { shareMembers } from "./support/env";
import { expect, test } from "./support/fixtures";

// Share links: a member publishes a read-only copy of a note that anyone with
// the link can read without signing in; it follows the note's syncs until the
// member stops sharing. One member per Playwright project, so runs don't collide.

/** A 1×1 PNG, as base64 for the page. */
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Pastes a file into the editor, as the clipboard would carry it. */
async function pasteFile(editor: Locator, file: { name: string; type: string; base64: string }) {
  await editor.evaluate((element, { name, type, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], name, { type }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, file);
}

async function newNote(page: Page, title: string): Promise<Locator> {
  await page.getByRole("button", { name: "New note" }).click();
  const titleField = page.getByRole("textbox", { name: "Title" });
  await expect(titleField).toBeFocused();
  await titleField.fill(title);
  await expect(titleField).toHaveValue(title);
  await page.keyboard.press("Enter");
  const body = page.getByRole("textbox", { name: "Note text" });
  await expect(body).toBeFocused();
  return body;
}

/** The images in the note body (ProseMirror's own cursor-separator images aside). */
const imagesIn = (body: Locator) => body.locator("img:not(.ProseMirror-separator)");

const synced = (page: Page) => expect(page.getByRole("status")).toHaveText("Synced", { timeout: 20_000 });

/** The Share button in the note's actions ("New shared notebook" in the sidebar also contains the word). */
const shareButton = (page: Page, name = "Share") => page.getByRole("button", { name, exact: true });

// Copying the link writes to the clipboard, which Chromium only allows a page that was granted it.
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("a share link shows the note and its image to anyone, follows the next sync, and stops working when revoked", async ({
  page,
  browser,
  signInAs,
}, testInfo) => {
  const member = shareMembers[testInfo.project.name];
  const title = `Trip notes ${testInfo.project.name} ${Date.now()}`;
  await signInAs(member);
  const body = await newNote(page, title);
  await page.keyboard.type("Day one was sunny.");
  await pasteFile(body, { name: "beach.png", type: "image/png", base64: pngBase64 });
  await expect(imagesIn(body)).toHaveCount(1);
  await synced(page);

  // Share: the link appears once the copy is published, and can be copied.
  await shareButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Share" });
  await expect(dialog.getByText("Not shared")).toBeVisible();
  await dialog.getByRole("button", { name: "Create link" }).click();
  const linkField = dialog.getByRole("textbox", { name: "Share link" });
  await expect(linkField).toHaveValue(/\/s\/[A-Za-z0-9_-]{22}$/, { timeout: 20_000 });
  const link = await linkField.inputValue();
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(shareButton(page, "Share, link active")).toBeVisible();

  // Anyone: a browser with no cookies and no account.
  const visitor = await browser.newContext();
  const view = await visitor.newPage();
  const opened = await view.goto(link);
  expect(opened?.status()).toBe(200);
  await expect(view.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(view.getByText("Day one was sunny.")).toBeVisible();
  const image = view.locator("article img");
  await expect(image).toHaveAttribute("src", /^\/s\/[A-Za-z0-9_-]{22}\/attachments\/[0-9a-f-]{36}\.png$/);
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
  const imageUrl = new URL((await image.getAttribute("src")) ?? "", link).toString();
  await expect(view.getByRole("link", { name: "Shared from Notepad" })).toBeVisible();
  expect(await view.title()).toBe(`${title} · Notepad`);
  await expect(view.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  // Only the page and its images are public: nothing of the copy or the notebook is reachable otherwise.
  expect((await visitor.request.get(`${link}/note.json`)).status()).toBe(404);
  expect((await visitor.request.get(`${new URL(link).origin}/api/notebooks/${member}/my-notes/files?commit=0`)).status()).toBe(401);

  // Edit and sync: the link shows the update.
  await body.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Day two brought rain.");
  await synced(page);
  await view.reload();
  await expect(view.getByText("Day two brought rain.")).toBeVisible();

  // Stop sharing: the link is gone for everyone.
  await shareButton(page, "Share, link active").click();
  await dialog.getByRole("button", { name: "Stop sharing" }).click();
  await expect(dialog.getByText("The link stops working for everyone who has it.")).toBeVisible();
  await dialog.getByRole("button", { name: "Stop sharing" }).click();
  await expect(dialog.getByText("Not shared")).toBeVisible();
  const gone = await view.reload();
  expect(gone?.status()).toBe(404);
  await expect(view.getByText("This note is no longer shared")).toBeVisible();
  expect((await visitor.request.get(imageUrl)).status()).toBe(404);
  await visitor.close();

  // The note itself is untouched, and synced without the share.
  await page.keyboard.press("Escape");
  await synced(page);
  await expect(shareButton(page)).toBeVisible();
});
