import { members } from "./support/env";
import { expect, test } from "./support/fixtures";

// The access gate's way in for people the owner invites to a notebook. The
// fake GitHub is shared by every test and both projects, so each test seeds
// its own invitee and notebook, named after the project it runs in.

const notebookTopic = "gh-notepad-notebook";

test("a stranger with a pending invitation to the owner's notebook signs in and lands in the app", async ({
  page,
  signInAs,
  fakeGitHub,
}, testInfo) => {
  const invitee = `octo-invitee-${testInfo.project.name}`;
  const notebook = `book-club-${testInfo.project.name}`;
  await fakeGitHub.addRepo({
    owner: members.owner,
    name: notebook,
    topics: [notebookTopic],
    files: { "README.md": `# ${notebook}\n` },
  });
  await fakeGitHub.invite(members.owner, notebook, invitee);

  await signInAs(invitee);

  await expect(page).toHaveURL("/notes");
  await expect(page.getByRole("img", { name: invitee })).toBeVisible();
  // The invitation was accepted on the way in, so the notebook is theirs to open.
  expect(await fakeGitHub.collaborators(members.owner, notebook)).toEqual([invitee]);
});

test("a stranger invited only by another member sees the invite-only screen", async ({
  page,
  signInAs,
  fakeGitHub,
}, testInfo) => {
  const invitee = `octo-guest-${testInfo.project.name}`;
  const notebook = `reading-${testInfo.project.name}`;
  await fakeGitHub.addRepo({
    owner: members.allowed,
    name: notebook,
    topics: [notebookTopic],
    files: { "README.md": `# ${notebook}\n` },
  });
  await fakeGitHub.invite(members.allowed, notebook, invitee);

  await signInAs(invitee);

  await expect(page).toHaveURL(`/invite-only?login=${invitee}`);
  await expect(page.getByRole("heading", { name: "This notepad is invite-only" })).toBeVisible();
  expect(await fakeGitHub.collaborators(members.allowed, notebook)).toEqual([]);
});
