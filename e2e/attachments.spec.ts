import type { Locator, Page } from "@playwright/test";
import { members } from "./support/env";
import { expect, test } from "./support/fixtures";
import { waitUntilAvailableOffline } from "./support/service-worker";

// Attachments: images pasted, dropped or picked into a note live in the
// notebook under attachments/ and behave like text offline (ADR 0003). Every
// test writes to the same member's personal notebook, so notes are named uniquely.

/** A 1×1 PNG, as bytes and as base64 for the page. */
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const pngBytes = Uint8Array.from(Buffer.from(pngBase64, "base64"));

/** Pastes a file into the editor, as the clipboard would carry it. */
async function pasteFile(editor: Locator, file: { name: string; type: string; base64?: string; size?: number }) {
  await editor.evaluate((element, { name, type, base64, size }) => {
    const bytes = base64 ? Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)) : new Uint8Array(size ?? 0);
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], name, { type }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, file);
}

async function newNote(page: Page, title: string): Promise<Locator> {
  await page.getByRole("button", { name: "New note" }).click();
  const titleField = page.getByRole("textbox", { name: "Title" });
  await expect(titleField).toBeFocused();
  // Set in one go: a pull that renames the placeholder (another "Untitled" exists in the shared notebook)
  // would collapse the selection mid-typing. notes.spec.ts covers typing over the selected placeholder.
  await titleField.fill(title);
  await expect(titleField).toHaveValue(title);
  await page.keyboard.press("Enter");
  const body = page.getByRole("textbox", { name: "Note text" });
  await expect(body).toBeFocused();
  return body;
}

/** The images in the note body (ProseMirror's own cursor-separator images aside). */
const imagesIn = (body: Locator) => body.locator("img:not(.ProseMirror-separator)");

/** The refusal shown beside the note body (Next's route announcer is an alert too). */
const refusal = (page: Page) => page.getByRole("alert").filter({ hasText: /^Images/ });

/**
 * Resolves once the note titled `title` holds `marker` on this device (the
 * store's trailing write, ADR 0002), so a reload right after an edit can't
 * outrun it. Other notes in the notebook may hold the marker already.
 */
async function waitUntilOnDevice(page: Page, title: string, marker: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async ({ path, wanted }) => {
          const names = (await indexedDB.databases()).flatMap((db) =>
            db.name?.startsWith("gh-notepad-account-") ? [db.name] : [],
          );
          for (const name of names) {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const opening = indexedDB.open(name);
              opening.onsuccess = () => resolve(opening.result);
              opening.onerror = () => reject(opening.error);
            });
            try {
              const rows = await new Promise<{ path: string; text: string }[]>((resolve, reject) => {
                const reading = db.transaction("notes").objectStore("notes").getAll();
                reading.onsuccess = () => resolve(reading.result as { path: string; text: string }[]);
                reading.onerror = () => reject(reading.error);
              });
              if (rows.some((row) => row.path === path && row.text.includes(wanted))) return true;
            } finally {
              db.close();
            }
          }
          return false;
        }, { path: `${title}.md`, wanted: marker }),
      { timeout: 5_000 },
    )
    .toBe(true);
}

/** How many attachments this device's store holds, across every account on it. */
async function attachmentsOnDevice(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const names = (await indexedDB.databases()).flatMap((db) => (db.name?.startsWith("gh-notepad-account-") ? [db.name] : []));
    let total = 0;
    for (const name of names) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open(name);
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      try {
        if (!db.objectStoreNames.contains("attachments")) continue;
        total += await new Promise<number>((resolve, reject) => {
          const counting = db.transaction("attachments").objectStore("attachments").count();
          counting.onsuccess = () => resolve(counting.result);
          counting.onerror = () => reject(counting.error);
        });
      } finally {
        db.close();
      }
    }
    return total;
  });
}

/** The image in the note body, loaded: a broken or missing image has no natural width. */
async function expectLoadedImage(body: Locator, src: RegExp): Promise<Locator> {
  const image = imagesIn(body);
  await expect(image).toHaveAttribute("src", src);
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
  return image;
}

test.describe("offline", () => {
  // Reloading offline needs the service worker, which every other spec blocks (playwright.config.ts).
  test.use({ serviceWorkers: "allow" });

  test("an image pasted offline appears at once, survives a reload, and is committed with its note on reconnect", async ({
    page,
    context,
    signInAs,
    fakeGitHub,
  }, testInfo) => {
    const title = `Trip notes ${testInfo.project.name} ${Date.now()}`;
    await signInAs(members.allowed);
    await expect(page).toHaveURL("/notes");
    await waitUntilAvailableOffline(page);
    const body = await newNote(page, title);
    await page.keyboard.type("Day one");
    await expect(page.getByRole("status")).toHaveText("Synced", { timeout: 20_000 });

    await context.setOffline(true);
    await pasteFile(body, { name: "image.png", type: "image/png", base64: pngBase64 });

    // Shown from the device's copy, before anything reaches the notebook.
    await expectLoadedImage(body, /^blob:/);
    await expect(page.getByRole("status")).toHaveText("Saved · Offline", { timeout: 20_000 });
    await waitUntilOnDevice(page, title, "/attachments/");

    // The note's URL survives the reload, so it is still the open note.
    await page.reload();
    await expectLoadedImage(page.getByRole("textbox", { name: "Note text" }), /^blob:/);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("status")).toHaveText("Synced", { timeout: 20_000 });

    // The note links the attachment from the repository root, and the notebook holds its bytes unchanged.
    const files = await fakeGitHub.files(members.allowed, "my-notes");
    const link = /!\[\]\((\/attachments\/[0-9a-f-]{36}\.png)\)/.exec(files[`${title}.md`] ?? "")?.[1];
    expect(link).toBeDefined();
    // Images are inline: pasted at the cursor, right after what was typed.
    expect(files[`${title}.md`]).toContain(`Day one![](${link})`);
    expect(await fakeGitHub.fileBytes(members.allowed, "my-notes", (link as string).slice(1))).toEqual(pngBytes);
  });
});

test("an image picked from the slash menu is synced and shown on another device through the app", async ({
  page,
  request,
  signInAs,
  signInOnAnotherDevice,
}, testInfo) => {
  const title = `Postcard ${testInfo.project.name} ${Date.now()}`;
  await signInAs(members.allowed);
  const body = await newNote(page, title);

  await page.keyboard.type("/image");
  await expect(page.getByRole("option", { name: "Image" })).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles({ name: "beach.png", mimeType: "image/png", buffer: Buffer.from(pngBytes) });
  await expectLoadedImage(body, /^blob:/);
  await expect(page.getByRole("status")).toHaveText("Synced", { timeout: 20_000 });

  const other = await signInOnAnotherDevice(members.allowed);
  const served = other.waitForResponse((response) => response.url().includes("/attachments/"));
  await other.getByRole("button", { name: title }).click({ timeout: 20_000 });
  const image = await expectLoadedImage(
    other.getByRole("textbox", { name: "Note text" }),
    /\/api\/notebooks\/octo-member\/my-notes\/attachments\/[0-9a-f-]{36}\.png\?branch=main$/,
  );
  await expect(image).toHaveAttribute("alt", "beach");

  // Served to the member's own browser, cacheable there; nobody else gets it.
  const response = await served;
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, max-age=3600");
  expect(response.headers()["content-type"]).toBe("image/png");
  const anonymous = await request.get(response.url());
  expect(anonymous.status()).toBe(401);
});

test("a file that isn't an image, or is over the deployment's limit, is refused with a clear message and stored nowhere", async ({
  page,
  signInAs,
  fakeGitHub,
}, testInfo) => {
  const title = `Not an image ${testInfo.project.name} ${Date.now()}`;
  await signInAs(members.allowed);
  const body = await newNote(page, title);
  await page.keyboard.type("Text only");

  await pasteFile(body, { name: "notes.txt", type: "text/plain", base64: btoa("hello") });
  await expect(refusal(page)).toHaveText("Images only (JPEG, PNG, GIF, WebP, SVG)");

  // One byte over what the deployment stores in a request: refused here, so it can never fail to sync later.
  await pasteFile(body, { name: "huge.png", type: "image/png", size: 4 * 1024 * 1024 + 1 });
  await expect(refusal(page)).toHaveText("Images must be under 4 MB");

  await expect(imagesIn(body)).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Synced", { timeout: 20_000 });
  expect(await attachmentsOnDevice(page)).toBe(0);
  const files = await fakeGitHub.files(members.allowed, "my-notes");
  expect(files[`${title}.md`]).toMatch(/Text only\n$/);
  expect(files[`${title}.md`]).not.toContain("attachments");
});
