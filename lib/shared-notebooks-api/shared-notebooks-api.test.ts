import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { authFromEnv } from "@/lib/auth";
import { CookieJar } from "@/test/cookie-jar";
import { createFakeGitHub } from "@/test/fake-github";
import { sharedNotebooksApiFromEnv } from ".";

const appUrl = "https://notes.example";
const notebook = { topics: ["gh-notepad-notebook"], files: { "README.md": "# notebook\n" } };

/** The app's routes in one process, against the fake GitHub, with members signing in for real. */
function createWorld() {
  const github = createFakeGitHub();
  const app = github.addOAuthApp({ callbackUrl: `${appUrl}/api/auth/callback` });
  const env = {
    NEXT_PUBLIC_APP_URL: appUrl,
    SESSION_SECRET: "a-test-session-secret-that-is-long-enough",
    GITHUB_CLIENT_ID: app.clientId,
    GITHUB_CLIENT_SECRET: app.clientSecret,
    OWNER_GITHUB_USER: "octo-owner",
    ALLOWED_GITHUB_USERS: "octo-friend, octo-member",
  };
  const auth = authFromEnv(env, { fetch: github.fetch });
  const api = sharedNotebooksApiFromEnv(env, { fetch: github.fetch });

  /** Signs `login` in through GitHub and returns the browser's cookies. */
  async function signIn(login: string): Promise<CookieJar> {
    github.addUser({ login });
    const jar = new CookieJar();
    const request = (url: string | URL) => new NextRequest(url, { headers: { cookie: jar.header() } });
    const started = await auth.signIn(request(`${appUrl}/api/auth/login`));
    jar.store(started);
    const callback = await github.authorize(started.headers.get("location") ?? "", { login });
    jar.store(await auth.callback(request(callback)));
    return jar;
  }

  /** Calls a route as the browser holding `as` (or none), from the app's own pages unless `origin` says otherwise. */
  async function call(
    path: string,
    init: { method?: string; body?: unknown; as?: CookieJar; origin?: string } = {},
  ): Promise<Response> {
    const method = init.method ?? "GET";
    const headers = new Headers({ cookie: init.as?.header() ?? "" });
    if (method !== "GET") headers.set("origin", init.origin ?? appUrl);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    return api.handle(new NextRequest(new URL(path, appUrl), { method, headers, body }));
  }

  /** The GitHub requests made by `run`, to show a route refused before reaching GitHub. */
  async function gitHubRequestsDuring(run: () => Promise<unknown>) {
    const before = github.requests().length;
    await run();
    return github.requests().slice(before);
  }

  return { github, signIn, call, gitHubRequestsDuring };
}

describe("shared-notebook routes", () => {
  it("refuse a request without a session, before asking GitHub anything", async () => {
    const world = createWorld();
    let response = new Response();

    const requests = await world.gitHubRequestsDuring(async () => (response = await world.call("/api/notebooks")));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "signed_out" });
    expect(requests).toEqual([]);
  });

  it("create a shared notebook and list it with the member's other notebooks", async () => {
    const world = createWorld();
    const owner = await world.signIn("octo-owner");

    const created = await world.call("/api/notebooks", { method: "POST", as: owner, body: { name: "book-club" } });

    expect(created.status).toBe(201);
    const shared = { owner: "octo-owner", repo: "book-club", branch: "main", kind: "shared", role: "owner" };
    expect(await created.json()).toEqual({ notebook: shared });
    expect(world.github.repo("octo-owner", "book-club")).toMatchObject({ topics: ["gh-notepad-notebook"] });
    expect(await (await world.call("/api/notebooks", { as: owner })).json()).toEqual({ notebooks: [shared] });
  });

  it("answer a name the member already uses with name_taken", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: "octo-owner", name: "book-club" });
    const owner = await world.signIn("octo-owner");

    const response = await world.call("/api/notebooks", { method: "POST", as: owner, body: { name: "book-club" } });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "name_taken" });
  });

  it.each(["", "Book Club", "../escape", "a/b", ".", "..", "x".repeat(101), "notes.git", "my-notes", "My-Notes", 42])(
    "refuse to create a notebook named %j before it reaches GitHub",
    async (name) => {
      const world = createWorld();
      const owner = await world.signIn("octo-owner");
      let response = new Response();

      const requests = await world.gitHubRequestsDuring(
        async () => (response = await world.call("/api/notebooks", { method: "POST", as: owner, body: { name } })),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid" });
      expect(requests).toEqual([]);
    },
  );

  it.each(["", "-octo", "octo-", "octo_friend", "octo friend", "a".repeat(40), "../octo", "octo/friend", null])(
    "refuse to invite the username %j before it reaches GitHub",
    async (username) => {
      const world = createWorld();
      world.github.addRepo({ owner: "octo-owner", name: "book-club", ...notebook });
      const owner = await world.signIn("octo-owner");
      let response = new Response();

      const requests = await world.gitHubRequestsDuring(
        async () =>
          (response = await world.call("/api/notebooks/octo-owner/book-club/invitations", {
            method: "POST",
            as: owner,
            body: { username },
          })),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid" });
      expect(requests).toEqual([]);
    },
  );

  it.each([
    ["an owner that can't be a login", "GET", "/api/notebooks/octo%2Fowner/book-club/collaborators"],
    ["a notebook name that can't be a repository", "GET", "/api/notebooks/octo-owner/book%20club/collaborators"],
    ["a collaborator that can't be a login", "DELETE", "/api/notebooks/octo-owner/book-club/collaborators/..%2Fadmin"],
    ["an invitation id that isn't a number", "DELETE", "/api/notebooks/octo-owner/book-club/invitations/latest"],
    ["an invitation id that isn't a number", "POST", "/api/invitations/1e3/accept"],
    ["inviting into the personal notebook", "POST", "/api/notebooks/octo-owner/my-notes/invitations"],
  ])("refuse %s (%s %s) before it reaches GitHub", async (_, method, path) => {
    const world = createWorld();
    const owner = await world.signIn("octo-owner");
    let response = new Response();

    const requests = await world.gitHubRequestsDuring(
      async () =>
        (response = await world.call(path, {
          method,
          as: owner,
          body: method === "POST" ? { username: "octo-friend" } : undefined,
        })),
    );

    expect(response.status).toBe(400);
    expect(requests).toEqual([]);
  });

  it("invite a collaborator, who accepts in the app, shows up as a collaborator and can be removed", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: "octo-owner", name: "book-club", ...notebook });
    const owner = await world.signIn("octo-owner");
    const friend = await world.signIn("octo-friend");

    const invited = await world.call("/api/notebooks/octo-owner/book-club/invitations", {
      method: "POST",
      as: owner,
      body: { username: "@octo-friend" },
    });
    expect(invited.status).toBe(201);
    const { invitation } = (await invited.json()) as { invitation: { id: number } };
    expect(invitation).toMatchObject({ notebook: { owner: "octo-owner", repo: "book-club" }, invitee: "octo-friend" });
    expect(await (await world.call("/api/notebooks/octo-owner/book-club/invitations", { as: owner })).json()).toEqual({
      invitations: [invitation],
    });
    expect(await (await world.call("/api/invitations", { as: friend })).json()).toEqual({ invitations: [invitation] });

    const accepted = await world.call(`/api/invitations/${invitation.id}/accept`, { method: "POST", as: friend });

    expect(accepted.status).toBe(204);
    expect(await (await world.call("/api/notebooks", { as: friend })).json()).toEqual({
      notebooks: [{ owner: "octo-owner", repo: "book-club", branch: "main", kind: "shared", role: "collaborator" }],
    });
    const listed = await world.call("/api/notebooks/octo-owner/book-club/collaborators", { as: friend });
    expect(await listed.json()).toMatchObject({
      collaborators: [
        { login: "octo-owner", role: "owner" },
        { login: "octo-friend", role: "collaborator" },
      ],
    });

    const removed = await world.call("/api/notebooks/octo-owner/book-club/collaborators/octo-friend", {
      method: "DELETE",
      as: owner,
    });

    expect(removed.status).toBe(204);
    expect(world.github.collaborators("octo-owner", "book-club")).toEqual([]);
  });

  it("tell the member when they invite someone who already collaborates, or a username GitHub doesn't know", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: "octo-owner", name: "book-club", ...notebook, collaborators: ["octo-friend"] });
    const owner = await world.signIn("octo-owner");
    const invite = (username: string) =>
      world.call("/api/notebooks/octo-owner/book-club/invitations", { method: "POST", as: owner, body: { username } });

    const existing = await invite("octo-friend");
    const unknown = await invite("nobody-by-that-name");

    expect(existing.status).toBe(200);
    expect(await existing.json()).toEqual({ status: "already-collaborator" });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: "no_such_user" });
  });

  it("cancel an invitation", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: "octo-owner", name: "book-club", ...notebook });
    const { id } = world.github.invite("octo-owner", "book-club", "octo-friend");
    const owner = await world.signIn("octo-owner");

    const response = await world.call(`/api/notebooks/octo-owner/book-club/invitations/${id}`, {
      method: "DELETE",
      as: owner,
    });

    expect(response.status).toBe(204);
    expect(world.github.invitations("octo-owner", "book-club")).toEqual([]);
  });

  it("let a collaborator leave, but not the notebook's owner", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: "octo-owner", name: "book-club", ...notebook, collaborators: ["octo-friend"] });
    const owner = await world.signIn("octo-owner");
    const friend = await world.signIn("octo-friend");
    let ownerLeaving = new Response();

    const left = await world.call("/api/notebooks/octo-owner/book-club/leave", { method: "POST", as: friend });
    const requests = await world.gitHubRequestsDuring(
      async () =>
        (ownerLeaving = await world.call("/api/notebooks/octo-owner/book-club/leave", { method: "POST", as: owner })),
    );

    expect(left.status).toBe(204);
    expect(world.github.collaborators("octo-owner", "book-club")).toEqual([]);
    expect(ownerLeaving.status).toBe(400);
    expect(requests).toEqual([]);
  });

  it("pass on GitHub's refusal when a collaborator tries to invite someone", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: "octo-owner", name: "book-club", ...notebook, collaborators: ["octo-friend"] });
    world.github.addUser({ login: "octo-member" });
    const friend = await world.signIn("octo-friend");

    const response = await world.call("/api/notebooks/octo-owner/book-club/invitations", {
      method: "POST",
      as: friend,
      body: { username: "octo-member" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "forbidden" });
    expect(world.github.invitations("octo-owner", "book-club")).toEqual([]);
  });

  it("refuse changes posted from another site", async () => {
    const world = createWorld();
    const owner = await world.signIn("octo-owner");

    const response = await world.call("/api/notebooks", {
      method: "POST",
      as: owner,
      origin: "https://elsewhere.example",
      body: { name: "book-club" },
    });

    expect(response.status).toBe(403);
    expect(world.github.repo("octo-owner", "book-club")).toBeUndefined();
  });
});
