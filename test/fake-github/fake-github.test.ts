import { describe, expect, it } from "vitest";
import { createFakeGitHub, type FakeGitHub } from ".";

// RFC 7636 Appendix B: a known verifier and its S256 challenge.
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const callbackUrl = "https://notes.example/api/auth/callback";

function authorizeUrl(clientId: string, extra: Record<string, string> = {}) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: "repo read:user",
    state: "state-123",
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...extra,
  }).toString();
  return url;
}

async function exchange(github: FakeGitHub, params: Record<string, string>) {
  const response = await github.fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return (await response.json()) as Record<string, unknown>;
}

function setUp() {
  const github = createFakeGitHub();
  const app = github.addOAuthApp({ name: "gh-notepad", callbackUrl });
  github.addUser({ login: "octo-member", name: "Octo Member" });
  return { github, app };
}

describe("fake GitHub: OAuth web flow", () => {
  it("redirects back with a code and the state, and the code buys a token for that user", async () => {
    const { github, app } = setUp();

    const redirect = await github.authorize(authorizeUrl(app.clientId), { login: "octo-member" });
    expect(`${redirect.origin}${redirect.pathname}`).toBe(callbackUrl);
    expect(redirect.searchParams.get("state")).toBe("state-123");

    const grant = await exchange(github, {
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code: redirect.searchParams.get("code") ?? "",
      redirect_uri: callbackUrl,
      code_verifier: verifier,
    });
    expect(grant).toMatchObject({ token_type: "bearer", scope: "repo,read:user" });
    expect(grant.access_token).toMatch(/^gho_[A-Za-z0-9]{36}$/);
    expect(grant).not.toHaveProperty("refresh_token");

    const user = await github.fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${grant.access_token}` },
    });
    expect(user.status).toBe(200);
    expect(user.headers.get("x-oauth-scopes")).toBe("repo, read:user");
    expect(await user.json()).toMatchObject({ login: "octo-member", name: "Octo Member", type: "User" });
  });

  it("refuses a code whose PKCE verifier doesn't match the challenge", async () => {
    const { github, app } = setUp();
    const redirect = await github.authorize(authorizeUrl(app.clientId), { login: "octo-member" });

    const grant = await exchange(github, {
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code: redirect.searchParams.get("code") ?? "",
      code_verifier: "a-different-verifier-that-is-at-least-43-characters",
    });

    expect(grant).toMatchObject({ error: "bad_verification_code" });
    expect(github.accessTokensFor("octo-member")).toEqual([]);
  });

  it("accepts a code only once", async () => {
    const { github, app } = setUp();
    const redirect = await github.authorize(authorizeUrl(app.clientId), { login: "octo-member" });
    const params = {
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code: redirect.searchParams.get("code") ?? "",
      code_verifier: verifier,
    };

    await exchange(github, params);
    const second = await exchange(github, params);

    expect(second).toMatchObject({ error: "bad_verification_code" });
    expect(github.accessTokensFor("octo-member")).toHaveLength(1);
  });

  it("refuses the wrong client secret", async () => {
    const { github, app } = setUp();
    const redirect = await github.authorize(authorizeUrl(app.clientId), { login: "octo-member" });

    const grant = await exchange(github, {
      client_id: app.clientId,
      client_secret: "not-the-secret",
      code: redirect.searchParams.get("code") ?? "",
      code_verifier: verifier,
    });

    expect(grant).toMatchObject({ error: "incorrect_client_credentials" });
  });

  it("refuses a challenge method other than S256", async () => {
    const { github, app } = setUp();

    const response = await github.fetch(authorizeUrl(app.clientId, { code_challenge_method: "plain" }));

    expect(response.status).toBe(400);
  });

  it("sends the browser back with access_denied when the person cancels", async () => {
    const { github, app } = setUp();

    const redirect = await github.authorize(authorizeUrl(app.clientId), "deny");

    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("state")).toBe("state-123");
    expect(redirect.searchParams.has("code")).toBe(false);
  });

  it("shows an account chooser listing the seeded users", async () => {
    const { github, app } = setUp();
    github.addUser({ login: "octo-stranger" });

    const response = await github.fetch(authorizeUrl(app.clientId));

    const page = await response.text();
    expect(page).toContain("Authorize as octo-member");
    expect(page).toContain("Authorize as octo-stranger");
  });

  it("issues expiring tokens with a refresh token when the app opts in", async () => {
    let now = Date.parse("2026-11-03T12:00:00Z");
    const github = createFakeGitHub({ now: () => now });
    const app = github.addOAuthApp({ callbackUrl, expiringTokens: true });
    github.addUser({ login: "octo-member" });
    const redirect = await github.authorize(authorizeUrl(app.clientId), { login: "octo-member" });

    const grant = await exchange(github, {
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code: redirect.searchParams.get("code") ?? "",
      code_verifier: verifier,
    });

    expect(grant).toMatchObject({ expires_in: 28800, refresh_token_expires_in: 15897600 });
    expect(grant.access_token).toMatch(/^ghu_/);
    expect(grant.refresh_token).toMatch(/^ghr_/);

    const headers = { authorization: `Bearer ${grant.access_token}` };
    now += 8 * 60 * 60 * 1000 - 1;
    expect((await github.fetch("https://api.github.com/user", { headers })).status).toBe(200);
    now += 1;
    expect((await github.fetch("https://api.github.com/user", { headers })).status).toBe(401);
  });
});

describe("fake GitHub: REST API", () => {
  it("rejects /user without a token, the way GitHub does", async () => {
    const github = createFakeGitHub();

    const response = await github.fetch("https://api.github.com/user");

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ message: "Bad credentials", status: "401" });
  });

  it("answers unknown endpoints with GitHub's 404 body", async () => {
    const github = createFakeGitHub();

    const response = await github.fetch("https://api.github.com/no/such/endpoint");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ message: "Not Found", status: "404" });
  });
});

/** A member with a token, calling the REST API the way the gateway does. */
function apiAs(github: FakeGitHub, login: string) {
  github.addUser({ login });
  const token = github.issueAccessToken(login);
  return (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    github.fetch(`https://api.github.com${path}`, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
}

describe("fake GitHub: repositories", () => {
  it("creates a private repository with an initial commit for the authenticated user", async () => {
    const github = createFakeGitHub();
    const api = apiAs(github, "octo-member");

    const created = await api("/user/repos", { method: "POST", body: { name: "my-notes", private: true, auto_init: true } });

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      name: "my-notes",
      full_name: "octo-member/my-notes",
      private: true,
      default_branch: "main",
      owner: { login: "octo-member" },
    });
    const repo = await api("/repos/octo-member/my-notes");
    expect(repo.status).toBe(200);
    expect(github.commits("octo-member", "my-notes")).toHaveLength(1);
    expect(Object.keys(github.files("octo-member", "my-notes"))).toEqual(["README.md"]);
  });

  it("refuses to create a repository whose name is taken", async () => {
    const github = createFakeGitHub();
    const api = apiAs(github, "octo-member");
    await api("/user/repos", { method: "POST", body: { name: "my-notes" } });

    const again = await api("/user/repos", { method: "POST", body: { name: "my-notes" } });

    expect(again.status).toBe(422);
    expect(await again.json()).toMatchObject({
      message: "Repository creation failed.",
      errors: [{ resource: "Repository", code: "custom", field: "name", message: "name already exists on this account" }],
    });
  });

  it("hides a private repository from everyone but its owner", async () => {
    const github = createFakeGitHub();
    github.addUser({ login: "octo-member" });
    github.addRepo({ owner: "octo-member", name: "my-notes", files: { "Secret.md": "shh\n" } });
    const stranger = apiAs(github, "octo-stranger");

    expect((await stranger("/repos/octo-member/my-notes")).status).toBe(404);
    expect((await stranger("/repos/octo-member/my-notes/git/ref/heads/main")).status).toBe(404);
  });

  it("answers Git Data requests on an empty repository with 409", async () => {
    const github = createFakeGitHub();
    const api = apiAs(github, "octo-member");
    await api("/user/repos", { method: "POST", body: { name: "empty" } });

    const ref = await api("/repos/octo-member/empty/git/ref/heads/main");

    expect(ref.status).toBe(409);
    expect(await ref.json()).toMatchObject({ message: "Git Repository is empty." });
  });
});

describe("fake GitHub: Git Data API", () => {
  async function seeded() {
    const github = createFakeGitHub();
    const api = apiAs(github, "octo-member");
    github.addRepo({ owner: "octo-member", name: "notes", files: { "Old.md": "old\n", "Keep/Me.md": "keep\n" } });
    const ref = (await (await api("/repos/octo-member/notes/git/ref/heads/main")).json()) as { object: { sha: string } };
    return { github, api, head: ref.object.sha };
  }

  it("hashes blobs and trees the way git does", async () => {
    const { api } = await seeded();

    // `echo "hello world" | git hash-object --stdin`, and git's empty tree.
    const blob = await api("/repos/octo-member/notes/git/blobs", { method: "POST", body: { content: "hello world\n" } });
    const encoded = await api("/repos/octo-member/notes/git/blobs", {
      method: "POST",
      body: { content: "aGVsbG8gd29ybGQK", encoding: "base64" },
    });
    const emptyTree = await api("/repos/octo-member/notes/git/trees", { method: "POST", body: { tree: [] } });

    expect(blob.status).toBe(201);
    expect(await blob.json()).toMatchObject({ sha: "3b18e512dba79e4c8300dd08aeb37f8e728b8dad" });
    expect(await encoded.json()).toMatchObject({ sha: "3b18e512dba79e4c8300dd08aeb37f8e728b8dad" });
    expect(await emptyTree.json()).toMatchObject({ sha: "4b825dc642cb6eb9a060e54bf8d69288fbee4904" });
  });

  it("commits several changes atomically: add, rename (add + delete) and edit in one tree", async () => {
    const { github, api, head } = await seeded();
    const commit = (await (await api(`/repos/octo-member/notes/git/commits/${head}`)).json()) as { tree: { sha: string } };

    const tree = await api("/repos/octo-member/notes/git/trees", {
      method: "POST",
      body: {
        base_tree: commit.tree.sha,
        tree: [
          { path: "New/Deep/Note.md", mode: "100644", type: "blob", content: "new\n" },
          { path: "Renamed.md", mode: "100644", type: "blob", content: "old\n" },
          { path: "Old.md", mode: "100644", type: "blob", sha: null },
        ],
      },
    });
    expect(tree.status).toBe(201);
    const { sha: treeSha } = (await tree.json()) as { sha: string };
    const created = await api("/repos/octo-member/notes/git/commits", {
      method: "POST",
      body: { message: 'Rename "Old" to "Renamed"', tree: treeSha, parents: [head] },
    });
    expect(created.status).toBe(201);
    const { sha } = (await created.json()) as { sha: string };
    const moved = await api("/repos/octo-member/notes/git/refs/heads/main", { method: "PATCH", body: { sha, force: false } });

    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ ref: "refs/heads/main", object: { sha, type: "commit" } });
    expect(github.files("octo-member", "notes")).toEqual({
      "Keep/Me.md": "keep\n",
      "New/Deep/Note.md": "new\n",
      "Renamed.md": "old\n",
    });
    expect(github.commits("octo-member", "notes")[0]).toMatchObject({
      sha,
      message: 'Rename "Old" to "Renamed"',
      files: [
        { path: "New/Deep/Note.md", status: "added" },
        { path: "Old.md", status: "removed" },
        { path: "Renamed.md", status: "added" },
      ],
    });
  });

  it("refuses to delete a file the base tree doesn't have", async () => {
    const { api, head } = await seeded();
    const commit = (await (await api(`/repos/octo-member/notes/git/commits/${head}`)).json()) as { tree: { sha: string } };

    const tree = await api("/repos/octo-member/notes/git/trees", {
      method: "POST",
      body: { base_tree: commit.tree.sha, tree: [{ path: "Missing.md", mode: "100644", type: "blob", sha: null }] },
    });

    expect(tree.status).toBe(422);
  });

  it("lists a commit's tree recursively, by commit SHA or branch name", async () => {
    const { api, head } = await seeded();

    const bySha = await api(`/repos/octo-member/notes/git/trees/${head}?recursive=1`);
    const byBranch = await api("/repos/octo-member/notes/git/trees/main?recursive=1");

    const listing = (await bySha.json()) as { truncated: boolean; tree: { path: string; type: string; mode: string }[] };
    expect(listing.truncated).toBe(false);
    expect(listing.tree.map(({ path, type, mode }) => ({ path, type, mode }))).toEqual([
      { path: "Keep", type: "tree", mode: "040000" },
      { path: "Keep/Me.md", type: "blob", mode: "100644" },
      { path: "Old.md", type: "blob", mode: "100644" },
    ]);
    expect(await byBranch.json()).toEqual(listing);
  });

  it("serves blobs as base64", async () => {
    const { api } = await seeded();
    const listing = (await (await api("/repos/octo-member/notes/git/trees/main?recursive=1")).json()) as {
      tree: { path: string; sha: string }[];
    };
    const old = listing.tree.find((entry) => entry.path === "Old.md");

    const blob = (await (await api(`/repos/octo-member/notes/git/blobs/${old?.sha}`)).json()) as {
      content: string;
      encoding: string;
      size: number;
    };

    expect(blob).toMatchObject({ encoding: "base64", size: 4 });
    expect(Buffer.from(blob.content, "base64").toString("utf8")).toBe("old\n");
  });

  it("refuses to move a branch to a commit that doesn't descend from it", async () => {
    const { github, api, head } = await seeded();
    const commit = (await (await api(`/repos/octo-member/notes/git/commits/${head}`)).json()) as { tree: { sha: string } };
    github.commitFiles("octo-member", "notes", { message: "Edit on github.com", files: { "Old.md": "edited\n" } });
    const stale = (await (
      await api("/repos/octo-member/notes/git/commits", {
        method: "POST",
        body: { message: "Built on the old head", tree: commit.tree.sha, parents: [head] },
      })
    ).json()) as { sha: string };

    const moved = await api("/repos/octo-member/notes/git/refs/heads/main", {
      method: "PATCH",
      body: { sha: stale.sha, force: false },
    });

    expect(moved.status).toBe(422);
    expect(await moved.json()).toMatchObject({ message: "Update is not a fast forward" });
    expect(github.files("octo-member", "notes")["Old.md"]).toBe("edited\n");
  });

  it("answers a head check with just the SHA, and 304 when it matches the ETag sent", async () => {
    const { api, head } = await seeded();

    const changed = await api("/repos/octo-member/notes/commits/main", { headers: { accept: "application/vnd.github.sha" } });
    const unchanged = await api("/repos/octo-member/notes/commits/main", {
      headers: { accept: "application/vnd.github.sha", "if-none-match": `"${head}"` },
    });

    expect(changed.status).toBe(200);
    expect(await changed.text()).toBe(head);
    expect(changed.headers.get("etag")).toBe(`"${head}"`);
    expect(unchanged.status).toBe(304);
  });

  it("logs the requests it answers, so tests can see what GitHub was asked", async () => {
    const { github, api, head } = await seeded();
    const before = github.requests().length;

    await api("/repos/octo-member/notes/commits/main", {
      headers: { accept: "application/vnd.github.sha", "if-none-match": `"${head}"` },
    });

    expect(github.requests().slice(before)).toEqual([
      { method: "GET", path: "/repos/octo-member/notes/commits/main", status: 304 },
    ]);
  });
});
