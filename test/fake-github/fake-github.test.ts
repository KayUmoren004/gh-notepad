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
