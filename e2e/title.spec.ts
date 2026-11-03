import { titleMembers } from "./support/env";
import { expect, test } from "./support/fixtures";

// Two devices, each waiting out sync's typing pause.
test.setTimeout(60_000);

const synced = { timeout: 30_000 };

test("a title typed while a sync re-titles the fresh note is what the note is called, on both devices", async ({
  page,
  signInAs,
  signInOnAnotherDevice,
  fakeGitHub,
  isMobile,
}, testInfo) => {
  const login = titleMembers[testInfo.project.name];
  const title = `Groceries ${Date.now()}`;
  await signInAs(login);
  const other = await signInOnAnotherDevice(login);
  await expect(other).toHaveURL("/notes");

  // Both devices press New note at the same moment, the other one with no connection: each gets "Untitled".
  await other.context().setOffline(true);
  await other.getByRole("button", { name: "New note" }).click();
  const otherTitle = other.getByRole("textbox", { name: "Title" });
  await expect(otherTitle).toBeFocused();
  await expect(otherTitle).toHaveValue(/^Untitled/);
  await page.getByRole("button", { name: "New note" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(/^Untitled/);
  await expect(page.getByRole("status")).toHaveText("Synced", synced);

  // Back online, the other device's pull finds "Untitled.md" taken and moves its own note aside,
  // while the member has the title selected and is about to type.
  await other.context().setOffline(false);
  await other.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(otherTitle).toHaveValue(/^Untitled \d+$/, synced);
  await expect(otherTitle).toBeFocused();

  // Typing replaces the placeholder, re-title and all.
  await other.keyboard.type(title);
  await expect(otherTitle).toHaveValue(title);
  await other.keyboard.press("Enter");
  await expect(other.getByRole("textbox", { name: "Note text" })).toBeFocused();
  await expect(other.getByRole("status")).toHaveText("Synced", synced);

  // The notebook has a file named after the typed title, and no "Untitled 2Groceries".
  const files = await fakeGitHub.files(login, "my-notes");
  expect(Object.keys(files).filter((path) => path.endsWith(`${title}.md`))).toEqual([`${title}.md`]);

  if (isMobile) await other.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(other.getByRole("button", { name: title, exact: true })).toBeVisible();

  // This device pulls when it regains focus, and lists the note under the typed title too.
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  if (isMobile) await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible(synced);
});
