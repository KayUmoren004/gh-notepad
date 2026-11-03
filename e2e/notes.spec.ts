import { members } from "./support/env";
import { expect, test } from "./support/fixtures";

// Every test here writes to the same member's personal notebook on the shared
// fake GitHub, so each one names its notes uniquely.

test("a note is saved on the device, synced, still there after a reload, and on another device", async ({
  page,
  signInAs,
  signInOnAnotherDevice,
  fakeGitHub,
}, testInfo) => {
  const title = `Groceries ${testInfo.project.name} ${Date.now()}`;
  await signInAs(members.allowed);
  await expect(page).toHaveURL("/notes");

  await page.getByRole("button", { name: "New note" }).click();
  const titleField = page.getByRole("textbox", { name: "Title" });
  await expect(titleField).toBeFocused();
  await expect(titleField).toHaveValue(/^Untitled/);
  // The untitled placeholder title is selected, so typing replaces it.
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  const body = page.getByRole("textbox", { name: "Note text" });
  await expect(body).toBeFocused();
  // Rich text mode turns the typed Markdown into a list as it goes.
  await page.keyboard.type("- Milk\nBread");

  const status = page.getByRole("status");
  await expect(status).toHaveText("Synced", { timeout: 20_000 });
  // Synced means the notebook on GitHub has it: a Markdown file named after the title.
  const files = await fakeGitHub.files(members.allowed, "my-notes");
  expect(files[`${title}.md`]).toMatch(/^---\nid: [0-9a-f-]{36}\n[\s\S]*\n---\n- Milk\n- Bread\n$/);

  // The note's URL survives the reload, so it is still the open note.
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
  await expect(page.getByRole("textbox", { name: "Note text" }).getByRole("listitem")).toHaveText(["Milk", "Bread"]);
  await expect(page.getByRole("status")).toHaveText("Synced");

  const phone = await signInOnAnotherDevice(members.allowed);
  await expect(phone).toHaveURL("/notes");
  await phone.getByRole("button", { name: title }).click({ timeout: 20_000 });
  await expect(phone.getByRole("textbox", { name: "Note text" }).getByRole("listitem")).toHaveText(["Milk", "Bread"]);
  await expect(phone.getByRole("status")).toHaveText("Synced");
});

test("an edit on one device shows up on the other without a reload", async ({
  page,
  signInAs,
  signInOnAnotherDevice,
}, testInfo) => {
  const title = `Shared thought ${testInfo.project.name} ${Date.now()}`;
  await signInAs(members.allowed);
  await page.getByRole("button", { name: "New note" }).click();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("First draft");
  await expect(page.getByRole("status")).toHaveText("Synced", { timeout: 20_000 });

  const other = await signInOnAnotherDevice(members.allowed);
  await other.getByRole("button", { name: title }).click({ timeout: 20_000 });
  await expect(other.getByRole("textbox", { name: "Note text" })).toHaveText("First draft");

  await page.getByRole("textbox", { name: "Note text" }).press("End");
  await page.keyboard.type(", revised");
  await expect(page.getByRole("status")).toHaveText("Synced", { timeout: 20_000 });

  // The other device pulls when it regains focus (and periodically while visible).
  await other.bringToFront();
  await other.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(other.getByRole("textbox", { name: "Note text" })).toHaveText("First draft, revised", {
    timeout: 20_000,
  });
});
