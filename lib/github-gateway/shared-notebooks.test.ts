import { describe, expect, it } from "vitest";
import { createFakeGitHub } from "@/test/fake-github";
import { createGitHubGateway, GitHubError, NOTEBOOK_TOPIC } from ".";

function setUp() {
  const github = createFakeGitHub();
  const gateway = createGitHubGateway({ clientId: "client-id", clientSecret: "client-secret", fetch: github.fetch });
  /** The gateway acting as `login`, signed in with a fresh token. */
  const as = (login: string) => {
    github.addUser({ login });
    return gateway.forMember({ login, accessToken: github.issueAccessToken(login) });
  };
  return { github, as };
}

describe("creating a shared notebook", () => {
  it("creates a private repository with an initial commit, tagged as a notebook", async () => {
    const { github, as } = setUp();

    const outcome = await as("octo-owner").createSharedNotebook("book-club");

    expect(outcome).toEqual({
      status: "created",
      notebook: { owner: "octo-owner", repo: "book-club", branch: "main", kind: "shared", role: "owner" },
    });
    expect(github.repo("octo-owner", "book-club")).toMatchObject({ private: true, topics: ["gh-notepad-notebook"] });
    expect(github.commits("octo-owner", "book-club")).toHaveLength(1);
  });

  it("reports a name the member already uses", async () => {
    const { github, as } = setUp();
    github.addRepo({ owner: "octo-owner", name: "book-club" });

    const outcome = await as("octo-owner").createSharedNotebook("book-club");

    expect(outcome).toEqual({ status: "name-taken" });
  });
});

describe("listing notebooks", () => {
  it("lists the notebooks a member owns or collaborates on, and no other repositories", async () => {
    const { github, as } = setUp();
    github.addRepo({ owner: "octo-member", name: "my-notes", files: { "README.md": "# my-notes\n" } });
    github.addRepo({ owner: "octo-member", name: "recipes", topics: [NOTEBOOK_TOPIC] });
    github.addRepo({ owner: "octo-member", name: "some-code" });
    github.addRepo({ owner: "octo-owner", name: "book-club", topics: [NOTEBOOK_TOPIC], collaborators: ["octo-member"] });
    github.addRepo({ owner: "octo-owner", name: "my-notes", collaborators: ["octo-member"] });
    github.addRepo({ owner: "octo-owner", name: "diary", topics: [NOTEBOOK_TOPIC] });
    github.addRepo({ owner: "octo-other", name: "invited-only", topics: [NOTEBOOK_TOPIC] });
    github.invite("octo-other", "invited-only", "octo-member");

    const notebooks = await as("octo-member").listNotebooks();

    expect(notebooks).toEqual([
      { owner: "octo-member", repo: "my-notes", branch: "main", kind: "personal", role: "owner" },
      { owner: "octo-member", repo: "recipes", branch: "main", kind: "shared", role: "owner" },
      { owner: "octo-owner", repo: "book-club", branch: "main", kind: "shared", role: "collaborator" },
    ]);
  });

  it("reads every page of the member's repositories", async () => {
    const { github, as } = setUp();
    const names = Array.from({ length: 150 }, (_, index) => `notebook-${String(index).padStart(3, "0")}`);
    for (const name of names) github.addRepo({ owner: "octo-member", name, topics: [NOTEBOOK_TOPIC] });

    const notebooks = await as("octo-member").listNotebooks();

    expect(notebooks.map((notebook) => notebook.repo)).toEqual(names);
  });
});

describe("inviting collaborators", () => {
  function withNotebook(collaborators: string[] = []) {
    const context = setUp();
    context.github.addRepo({
      owner: "octo-owner",
      name: "book-club",
      topics: [NOTEBOOK_TOPIC],
      files: { "README.md": "# book-club\n" },
      collaborators,
    });
    return { ...context, notebook: { owner: "octo-owner", repo: "book-club" } };
  }

  it("invites someone by GitHub username; they see the invitation, accept it and can open the notebook", async () => {
    const { github, as, notebook } = withNotebook();
    const owner = as("octo-owner");
    const friend = as("octo-friend");

    const outcome = await owner.inviteCollaborator(notebook, "octo-friend");

    expect(outcome).toMatchObject({
      status: "invited",
      invitation: { notebook, invitee: "octo-friend", inviter: "octo-owner", expired: false },
    });
    const invitation = outcome.status === "invited" ? outcome.invitation : null;
    expect(await owner.listInvitations(notebook)).toEqual([invitation]);
    expect(await friend.listMyInvitations()).toEqual([invitation]);
    expect(await friend.listNotebooks()).toEqual([]);

    await friend.acceptInvitation(invitation?.id ?? 0);

    expect(github.collaborators("octo-owner", "book-club")).toEqual(["octo-friend"]);
    expect(await friend.listMyInvitations()).toEqual([]);
    expect(await friend.listNotebooks()).toEqual([{ ...notebook, branch: "main", kind: "shared", role: "collaborator" }]);
  });

  it("tells an existing collaborator and an unknown username apart from a new invitation", async () => {
    const { as, notebook } = withNotebook(["octo-friend"]);
    const owner = as("octo-owner");

    expect(await owner.inviteCollaborator(notebook, "octo-friend")).toEqual({ status: "already-collaborator" });
    expect(await owner.inviteCollaborator(notebook, "nobody-by-that-name")).toEqual({ status: "no-such-user" });
  });

  it("cancels an invitation before it is accepted", async () => {
    const { github, as, notebook } = withNotebook();
    const owner = as("octo-owner");
    const { id } = github.invite("octo-owner", "book-club", "octo-friend");

    await owner.cancelInvitation(notebook, id);

    expect(await owner.listInvitations(notebook)).toEqual([]);
    expect(await as("octo-friend").listMyInvitations()).toEqual([]);
  });

  it("refuses a collaborator who tries to invite others", async () => {
    const { github, as, notebook } = withNotebook(["octo-friend"]);
    github.addUser({ login: "octo-other" });

    const attempt = as("octo-friend").inviteCollaborator(notebook, "octo-other");

    await expect(attempt).rejects.toBeInstanceOf(GitHubError);
    await expect(attempt).rejects.toMatchObject({ status: 403 });
    expect(github.invitations("octo-owner", "book-club")).toEqual([]);
  });
});

describe("collaborators", () => {
  function withCollaborators() {
    const context = setUp();
    context.github.addRepo({
      owner: "octo-owner",
      name: "book-club",
      topics: [NOTEBOOK_TOPIC],
      collaborators: ["octo-friend", "octo-reader"],
    });
    return { ...context, notebook: { owner: "octo-owner", repo: "book-club" } };
  }

  it("lists the owner and every collaborator", async () => {
    const { as, notebook } = withCollaborators();

    const collaborators = await as("octo-friend").listCollaborators(notebook);

    expect(collaborators.map(({ login, role }) => ({ login, role }))).toEqual([
      { login: "octo-owner", role: "owner" },
      { login: "octo-friend", role: "collaborator" },
      { login: "octo-reader", role: "collaborator" },
    ]);
    expect(collaborators[0].avatarUrl).toMatch(/^https:\/\//);
  });

  it("removes a collaborator, who loses the notebook", async () => {
    const { github, as, notebook } = withCollaborators();

    await as("octo-owner").removeCollaborator(notebook, "octo-friend");

    expect(github.collaborators("octo-owner", "book-club")).toEqual(["octo-reader"]);
    expect(await as("octo-friend").listNotebooks()).toEqual([]);
  });

  it("lets a collaborator leave, which removes only their own access", async () => {
    const { github, as, notebook } = withCollaborators();

    await as("octo-reader").leaveNotebook(notebook);

    expect(github.collaborators("octo-owner", "book-club")).toEqual(["octo-friend"]);
    expect(await as("octo-reader").listNotebooks()).toEqual([]);
    expect(await as("octo-owner").listNotebooks()).toHaveLength(1);
  });
});
