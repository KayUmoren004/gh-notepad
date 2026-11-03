import { v1Members } from "./support/env";
import { expect, test } from "./support/fixtures";

test("notes from v1 are converted on sign-in, and files that couldn't be read are reported", async ({
  page,
  signInAs,
  fakeGitHub,
}, testInfo) => {
  const login = v1Members[testInfo.project.name];
  // The fake GitHub outlives runs: each run adds v1 files of its own to the member's notebook.
  const run = Date.now().toString(36);
  const title = `From v1 ${run}`;
  await fakeGitHub.addUser({ login });
  await fakeGitHub.addRepo({ owner: login, name: "my-notes", files: { "README.md": "# my-notes\n" } });
  await fakeGitHub.commitFiles(login, "my-notes", {
    message: "Notes written with v1",
    files: {
      "metadata.json": JSON.stringify({ folders: ["Work"], tags: [{ name: "old", color: "#888888" }] }, null, 2),
      [`notes/${run}.json`]: JSON.stringify(
        {
          id: `v1-${run}`,
          title,
          content: "Written in v1",
          folder: "Work",
          tags: ["old"],
          createdAt: "2024-01-01T09:00:00.000Z",
          updatedAt: "2024-01-02T09:00:00.000Z",
        },
        null,
        2,
      ),
      [`notes/broken-${run}.json`]: '{ "title": "Half a no',
    },
  });

  await signInAs(login);

  const notice = page.getByRole("alert", { name: "1 old note couldn't be converted" });
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(notice).toContainText(`notes/broken-${run}.json`);
  const files = await fakeGitHub.files(login, "my-notes");
  expect(files[`Work/${title}.md`]).toBe(
    `---\nid: v1-${run}\ntags: [old]\ncreated: 2024-01-01T09:00:00.000Z\nupdated: 2024-01-02T09:00:00.000Z\n---\nWritten in v1`,
  );
  expect(Object.keys(files).filter((path) => path.endsWith(".json"))).toEqual([]);

  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toBeHidden();
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
  await expect(page.getByRole("textbox", { name: "Note text" })).toHaveText("Written in v1");
});
