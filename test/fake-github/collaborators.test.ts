import { describe, expect, it } from "vitest";
import { createFakeGitHub, type FakeGitHub } from ".";
import { connectFakeGitHub } from "./client";
import { startFakeGitHubServer } from "./server";

// Repository topics, listing a member's repositories, collaborators and
// repository invitations: the GitHub side of shared notebooks. Expected values
// come from GitHub's REST reference (github/rest-api-description).

/** A member with a token, calling the REST API the way the gateway does. */
function apiAs(github: FakeGitHub, login: string) {
  github.addUser({ login });
  const token = github.issueAccessToken(login);
  return (path: string, init: { method?: string; body?: unknown } = {}) =>
    github.fetch(`https://api.github.com${path}`, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
}

async function names(response: Response): Promise<string[]> {
  return ((await response.json()) as { full_name: string }[]).map((repo) => repo.full_name);
}

describe("fake GitHub: users", () => {
  it("shows anyone a user's public profile by login, whatever its case, and 404 for an unknown login", async () => {
    const github = createFakeGitHub();
    github.addUser({ login: "Octo-Friend", name: "Octo Friend" });

    const found = await github.fetch("https://api.github.com/users/octo-friend");

    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ login: "Octo-Friend", name: "Octo Friend", type: "User" });
    expect((await github.fetch("https://api.github.com/users/nobody-by-that-name")).status).toBe(404);
  });
});

describe("fake GitHub: repository topics", () => {
  it("replaces a repository's topics, saving them lowercase", async () => {
    const github = createFakeGitHub();
    const owner = apiAs(github, "octo-owner");
    github.addRepo({ owner: "octo-owner", name: "Book-Club", files: { "README.md": "# Book-Club\n" } });

    const put = await owner("/repos/octo-owner/Book-Club/topics", {
      method: "PUT",
      body: { names: ["Gh-Notepad-Notebook", "reading"] },
    });

    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ names: ["gh-notepad-notebook", "reading"] });
    expect(await (await owner("/repos/octo-owner/book-club/topics")).json()).toEqual({
      names: ["gh-notepad-notebook", "reading"],
    });
    expect(await (await owner("/repos/octo-owner/Book-Club")).json()).toMatchObject({
      topics: ["gh-notepad-notebook", "reading"],
    });
  });

  it("refuses topics that aren't lowercase letters, numbers and hyphens", async () => {
    const github = createFakeGitHub();
    const owner = apiAs(github, "octo-owner");
    github.addRepo({ owner: "octo-owner", name: "book-club" });

    const put = await owner("/repos/octo-owner/book-club/topics", { method: "PUT", body: { names: ["no spaces"] } });

    expect(put.status).toBe(422);
  });

  it("lets only the owner change topics, though collaborators can read them", async () => {
    const github = createFakeGitHub();
    github.addRepo({ owner: "octo-owner", name: "book-club", topics: ["gh-notepad-notebook"], collaborators: ["octo-friend"] });
    const friend = apiAs(github, "octo-friend");
    const stranger = apiAs(github, "octo-stranger");

    expect(await (await friend("/repos/octo-owner/book-club/topics")).json()).toEqual({ names: ["gh-notepad-notebook"] });
    expect((await friend("/repos/octo-owner/book-club/topics", { method: "PUT", body: { names: [] } })).status).toBe(403);
    expect((await stranger("/repos/octo-owner/book-club/topics")).status).toBe(404);
  });
});

describe("fake GitHub: the member's repositories", () => {
  it("lists repositories the member owns or collaborates on, by full name, with topics and permissions", async () => {
    const github = createFakeGitHub();
    github.addRepo({ owner: "octo-member", name: "my-notes" });
    github.addRepo({ owner: "octo-member", name: "Recipes", topics: ["gh-notepad-notebook"] });
    github.addRepo({ owner: "octo-owner", name: "book-club", topics: ["gh-notepad-notebook"], collaborators: ["octo-member"] });
    github.addRepo({ owner: "octo-owner", name: "secret" });
    const member = apiAs(github, "octo-member");

    const response = await member("/user/repos?affiliation=owner,collaborator&per_page=100");

    expect(response.status).toBe(200);
    const repos = (await response.json()) as Record<string, unknown>[];
    expect(repos.map((repo) => repo.full_name)).toEqual(["octo-member/my-notes", "octo-member/Recipes", "octo-owner/book-club"]);
    expect(repos[1]).toMatchObject({ topics: ["gh-notepad-notebook"], permissions: { admin: true, push: true, pull: true } });
    expect(repos[2]).toMatchObject({
      owner: { login: "octo-owner" },
      topics: ["gh-notepad-notebook"],
      permissions: { admin: false, push: true, pull: true },
    });
  });

  it("filters by affiliation", async () => {
    const github = createFakeGitHub();
    github.addRepo({ owner: "octo-member", name: "my-notes" });
    github.addRepo({ owner: "octo-owner", name: "book-club", collaborators: ["octo-member"] });
    const member = apiAs(github, "octo-member");

    expect(await names(await member("/user/repos?affiliation=owner"))).toEqual(["octo-member/my-notes"]);
    expect(await names(await member("/user/repos?affiliation=collaborator"))).toEqual(["octo-owner/book-club"]);
    expect((await member("/user/repos?affiliation=owner&type=all")).status).toBe(422);
  });

  it("pages with per_page and page, linking to the next and last pages", async () => {
    const github = createFakeGitHub();
    for (const name of ["a", "b", "c", "d", "e"]) github.addRepo({ owner: "octo-member", name });
    const member = apiAs(github, "octo-member");

    const first = await member("/user/repos?per_page=2");
    expect(await names(first)).toEqual(["octo-member/a", "octo-member/b"]);
    expect(first.headers.get("link")).toBe(
      '<https://api.github.com/user/repos?per_page=2&page=2>; rel="next", ' +
        '<https://api.github.com/user/repos?per_page=2&page=3>; rel="last"',
    );

    const last = await member("/user/repos?per_page=2&page=3");
    expect(await names(last)).toEqual(["octo-member/e"]);
    expect(last.headers.get("link")).toBe(
      '<https://api.github.com/user/repos?per_page=2&page=2>; rel="prev", ' +
        '<https://api.github.com/user/repos?per_page=2&page=1>; rel="first"',
    );
  });

  it("requires a token", async () => {
    const github = createFakeGitHub();

    expect((await github.fetch("https://api.github.com/user/repos")).status).toBe(401);
  });
});

describe("fake GitHub: inviting collaborators", () => {
  function setUp() {
    let now = Date.parse("2026-11-03T12:00:00Z");
    const github = createFakeGitHub({ now: () => now });
    github.addRepo({
      owner: "octo-owner",
      name: "book-club",
      topics: ["gh-notepad-notebook"],
      files: { "README.md": "# book-club\n" },
    });
    const owner = apiAs(github, "octo-owner");
    const invitee = apiAs(github, "octo-invitee");
    return { github, owner, invitee, advance: (ms: number) => (now += ms) };
  }

  it("invites a user, who sees the invitation and gets access by accepting it", async () => {
    const { github, owner, invitee } = setUp();

    const invited = await owner("/repos/octo-owner/book-club/collaborators/octo-invitee", { method: "PUT" });

    expect(invited.status).toBe(201);
    const invitation = (await invited.json()) as Record<string, unknown> & { id: number };
    expect(invitation).toMatchObject({
      repository: { full_name: "octo-owner/book-club", owner: { login: "octo-owner" }, private: true },
      invitee: { login: "octo-invitee" },
      inviter: { login: "octo-owner" },
      permissions: "write",
      created_at: "2026-11-03T12:00:00Z",
      expired: false,
    });
    // GitHub's invitation payload nests a minimal repository, without topics.
    expect(invitation.repository).not.toHaveProperty("topics");
    expect(await (await owner("/repos/octo-owner/book-club/invitations")).json()).toMatchObject([
      { id: invitation.id, invitee: { login: "octo-invitee" } },
    ]);
    expect(await (await invitee("/user/repository_invitations")).json()).toMatchObject([
      { id: invitation.id, repository: { full_name: "octo-owner/book-club" } },
    ]);
    expect((await invitee("/repos/octo-owner/book-club")).status).toBe(404);

    const accepted = await invitee(`/user/repository_invitations/${invitation.id}`, { method: "PATCH" });

    expect(accepted.status).toBe(204);
    expect(await (await invitee("/repos/octo-owner/book-club")).json()).toMatchObject({
      permissions: { admin: false, push: true, pull: true },
    });
    expect(github.collaborators("octo-owner", "book-club")).toEqual(["octo-invitee"]);
    expect(await (await invitee("/user/repository_invitations")).json()).toEqual([]);
    expect(await (await owner("/repos/octo-owner/book-club/invitations")).json()).toEqual([]);
  });

  it("answers 204 for someone who already collaborates, and 422 for the owner", async () => {
    const { github, owner } = setUp();
    github.addRepo({ owner: "octo-owner", name: "recipes", collaborators: ["octo-friend"] });

    expect((await owner("/repos/octo-owner/recipes/collaborators/octo-friend", { method: "PUT" })).status).toBe(204);
    const self = await owner("/repos/octo-owner/recipes/collaborators/octo-owner", { method: "PUT" });
    expect(self.status).toBe(422);
    expect(await self.json()).toMatchObject({ message: "Validation Failed" });
  });

  it("answers 404 for a login GitHub doesn't know", async () => {
    const { owner } = setUp();

    const response = await owner("/repos/octo-owner/book-club/collaborators/nobody-by-that-name", { method: "PUT" });

    expect(response.status).toBe(404);
  });

  it("lets only the owner invite, list and cancel invitations", async () => {
    const { github, invitee } = setUp();
    github.addRepo({ owner: "octo-owner", name: "recipes", collaborators: ["octo-friend"] });
    const friend = apiAs(github, "octo-friend");
    const { id } = github.invite("octo-owner", "recipes", "octo-invitee");

    expect((await friend("/repos/octo-owner/recipes/collaborators/octo-invitee", { method: "PUT" })).status).toBe(403);
    expect((await friend("/repos/octo-owner/recipes/invitations")).status).toBe(403);
    expect((await friend(`/repos/octo-owner/recipes/invitations/${id}`, { method: "DELETE" })).status).toBe(403);
    expect((await invitee("/repos/octo-owner/recipes/invitations")).status).toBe(404);
  });

  it("cancels an invitation, which the invitee can then no longer accept", async () => {
    const { github, owner, invitee } = setUp();
    const { id } = github.invite("octo-owner", "book-club", "octo-invitee");

    const cancelled = await owner(`/repos/octo-owner/book-club/invitations/${id}`, { method: "DELETE" });

    expect(cancelled.status).toBe(204);
    expect(await (await invitee("/user/repository_invitations")).json()).toEqual([]);
    expect((await invitee(`/user/repository_invitations/${id}`, { method: "PATCH" })).status).toBe(404);
    expect(github.collaborators("octo-owner", "book-club")).toEqual([]);
  });

  it("lets only the invitee accept or decline", async () => {
    const { github, invitee } = setUp();
    const { id } = github.invite("octo-owner", "book-club", "octo-invitee");
    const someoneElse = apiAs(github, "octo-someone");

    expect((await someoneElse(`/user/repository_invitations/${id}`, { method: "PATCH" })).status).toBe(404);
    expect((await invitee(`/user/repository_invitations/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(await (await invitee("/user/repository_invitations")).json()).toEqual([]);
    expect(github.collaborators("octo-owner", "book-club")).toEqual([]);
  });

  it("expires a pending invitation after 7 days", async () => {
    const { github, invitee, advance } = setUp();
    const { id } = github.invite("octo-owner", "book-club", "octo-invitee");

    advance(7 * 24 * 60 * 60 * 1000);

    expect(await (await invitee("/user/repository_invitations")).json()).toMatchObject([{ id, expired: true }]);
    expect((await invitee(`/user/repository_invitations/${id}`, { method: "PATCH" })).status).toBe(404);
    expect(github.collaborators("octo-owner", "book-club")).toEqual([]);
  });
});

describe("fake GitHub: collaborators", () => {
  it("lists the owner and collaborators to anyone who can push", async () => {
    const github = createFakeGitHub();
    github.addRepo({ owner: "octo-owner", name: "book-club", collaborators: ["octo-friend"] });
    const friend = apiAs(github, "octo-friend");
    const stranger = apiAs(github, "octo-stranger");

    const listed = await friend("/repos/octo-owner/book-club/collaborators");

    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject([
      { login: "octo-owner", permissions: { admin: true, push: true }, role_name: "admin" },
      { login: "octo-friend", permissions: { admin: false, push: true }, role_name: "write" },
    ]);
    expect((await friend("/repos/octo-owner/book-club/collaborators/octo-friend")).status).toBe(204);
    expect((await friend("/repos/octo-owner/book-club/collaborators/octo-stranger")).status).toBe(404);
    expect((await stranger("/repos/octo-owner/book-club/collaborators")).status).toBe(404);
  });

  it("removes a collaborator when the owner asks, or when they remove themselves", async () => {
    const github = createFakeGitHub();
    github.addRepo({ owner: "octo-owner", name: "book-club", collaborators: ["octo-friend", "octo-leaver"] });
    const owner = apiAs(github, "octo-owner");
    const friend = apiAs(github, "octo-friend");
    const leaver = apiAs(github, "octo-leaver");

    const byPeer = await friend("/repos/octo-owner/book-club/collaborators/octo-leaver", { method: "DELETE" });
    const bySelf = await leaver("/repos/octo-owner/book-club/collaborators/octo-leaver", { method: "DELETE" });
    const byOwner = await owner("/repos/octo-owner/book-club/collaborators/octo-friend", { method: "DELETE" });

    expect([byPeer.status, bySelf.status, byOwner.status]).toEqual([403, 204, 204]);
    expect(github.collaborators("octo-owner", "book-club")).toEqual([]);
    expect((await friend("/repos/octo-owner/book-club")).status).toBe(404);
  });
});

describe("fake GitHub over HTTP: seeding notebooks and invitations", () => {
  it("seeds a repository and an invitation, idempotently, and reports collaborators", async () => {
    const server = await startFakeGitHubServer({ port: 0 });
    try {
      const control = connectFakeGitHub(server.url);
      const seed = { owner: "octo-owner", name: "book-club", topics: ["gh-notepad-notebook"], files: { "README.md": "# b\n" } };

      expect(await control.addRepo({ ...seed, collaborators: ["octo-friend"] })).toMatchObject({
        full_name: "octo-owner/book-club",
        topics: ["gh-notepad-notebook"],
      });
      expect(await control.addRepo({ ...seed, topics: [] })).toMatchObject({ topics: ["gh-notepad-notebook"] });
      expect(await control.collaborators("octo-owner", "book-club")).toEqual(["octo-friend"]);
      const first = await control.invite("octo-owner", "book-club", "octo-invitee");
      const again = await control.invite("octo-owner", "book-club", "octo-invitee");

      expect(first.id).toEqual(expect.any(Number));
      expect(again).toEqual(first);
      expect(server.fake.invitations("octo-owner", "book-club")).toHaveLength(1);

      const invitation = server.fake.invitations("octo-owner", "book-club")[0];
      const token = server.fake.issueAccessToken("octo-invitee");
      await fetch(`${server.url}/user/repository_invitations/${invitation.id}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(await control.collaborators("octo-owner", "book-club")).toEqual(["octo-friend", "octo-invitee"]);
      expect(await control.invite("octo-owner", "book-club", "octo-invitee")).toEqual({ id: null });
    } finally {
      await server.close();
    }
  });
});
