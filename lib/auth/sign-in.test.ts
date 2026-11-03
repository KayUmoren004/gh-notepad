import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { CookieJar } from "@/test/cookie-jar";
import { createFakeGitHub, type FakeGitHub } from "@/test/fake-github";
import { authFromEnv, type Auth } from ".";

const appUrl = "https://notes.example";

function setUp({ expiringTokens = false, now }: { expiringTokens?: boolean; now?: () => number } = {}) {
  const github = createFakeGitHub({ now });
  const app = github.addOAuthApp({ callbackUrl: `${appUrl}/api/auth/callback`, expiringTokens });
  for (const login of ["octo-owner", "Octo-Member", "octo-stranger"]) github.addUser({ login });

  const auth = authFromEnv(
    {
      NEXT_PUBLIC_APP_URL: appUrl,
      SESSION_SECRET: "a-test-session-secret-that-is-long-enough",
      GITHUB_CLIENT_ID: app.clientId,
      GITHUB_CLIENT_SECRET: app.clientSecret,
      OWNER_GITHUB_USER: "octo-owner",
      ALLOWED_GITHUB_USERS: "octo-friend, @octo-member",
    },
    { fetch: github.fetch },
  );
  return { github, auth };
}

/** One browser: its cookies, and the requests it makes to the auth routes. */
function browser(auth: Auth) {
  const jar = new CookieJar();
  const send = async (
    handler: (request: NextRequest) => Promise<Response>,
    url: string | URL,
    init: { method?: string; headers?: Record<string, string> } = {},
  ) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", jar.header());
    const response = await handler(new NextRequest(url, { method: init.method, headers }));
    jar.store(response);
    return response;
  };

  return {
    jar,
    /** Clicks "Sign in with GitHub"; returns the GitHub authorize URL it was sent to. */
    startSignIn: async () => {
      const response = await send(auth.signIn, `${appUrl}/api/auth/login`);
      return new URL(response.headers.get("location") ?? "");
    },
    /** Arrives back from GitHub at the callback URL. */
    returnFromGitHub: (callbackUrl: URL) => send(auth.callback, callbackUrl),
    signOut: (origin = appUrl) =>
      send(auth.signOut, `${appUrl}/api/auth/logout`, { method: "POST", headers: { origin } }),
    session: () => auth.readSession(jar),
  };
}

describe("signing in with GitHub", () => {
  it("lets the owner in and lands them in the app", async () => {
    const { github, auth } = setUp();
    const visitor = browser(auth);

    const authorizeUrl = await visitor.startSignIn();
    const response = await visitor.returnFromGitHub(await github.authorize(authorizeUrl, { login: "octo-owner" }));

    expect(response.headers.get("location")).toBe(`${appUrl}/notes`);
    expect((await visitor.session())?.member).toMatchObject({ login: "octo-owner" });
  });

  it("asks GitHub for repo and read:user, protected by PKCE S256 and state", async () => {
    const { auth } = setUp();

    const authorizeUrl = await browser(auth).startSignIn();

    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(authorizeUrl.searchParams.get("scope")).toBe("repo read:user");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(`${appUrl}/api/auth/callback`);
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("code_challenge")).toHaveLength(43);
    expect(authorizeUrl.searchParams.get("state")?.length).toBeGreaterThanOrEqual(32);
  });

  it("lets in a login listed in ALLOWED_GITHUB_USERS, whatever its case", async () => {
    const { github, auth } = setUp();
    const visitor = browser(auth);

    const authorizeUrl = await visitor.startSignIn();
    const response = await visitor.returnFromGitHub(await github.authorize(authorizeUrl, { login: "Octo-Member" }));

    expect(response.headers.get("location")).toBe(`${appUrl}/notes`);
    expect((await visitor.session())?.member).toMatchObject({ login: "Octo-Member" });
  });

  it("shows anyone else the invite-only screen and gives them no session", async () => {
    const { github, auth } = setUp();
    const visitor = browser(auth);

    const authorizeUrl = await visitor.startSignIn();
    const response = await visitor.returnFromGitHub(
      await github.authorize(authorizeUrl, { login: "octo-stranger" }),
    );

    expect(response.headers.get("location")).toBe(`${appUrl}/invite-only?login=octo-stranger`);
    expect(await visitor.session()).toBeNull();
  });

  it("returns to the landing page when the visitor cancels on GitHub", async () => {
    const { github, auth } = setUp();
    const visitor = browser(auth);

    const authorizeUrl = await visitor.startSignIn();
    const response = await visitor.returnFromGitHub(await github.authorize(authorizeUrl, "deny"));

    expect(response.headers.get("location")).toBe(`${appUrl}/?sign-in=cancelled`);
    expect(await visitor.session()).toBeNull();
  });
});

describe("signing in by invitation to one of the owner's notebooks", () => {
  /** A shared notebook: a repository tagged with the notebook topic. */
  const notebook = { topics: ["gh-notepad-notebook"], files: { "README.md": "# notebook\n" } };

  async function signIn(github: FakeGitHub, auth: Auth, login: string) {
    const visitor = browser(auth);
    const response = await visitor.returnFromGitHub(await github.authorize(await visitor.startSignIn(), { login }));
    return { location: response.headers.get("location"), session: await visitor.session() };
  }

  it("lets in a stranger with a pending invitation, accepting it so they land in the notebook", async () => {
    const { github, auth } = setUp();
    github.addRepo({ owner: "octo-owner", name: "book-club", ...notebook });
    github.invite("octo-owner", "book-club", "octo-stranger");

    const { location, session } = await signIn(github, auth, "octo-stranger");

    expect(location).toBe(`${appUrl}/notes`);
    expect(session?.member).toMatchObject({ login: "octo-stranger" });
    expect(github.collaborators("octo-owner", "book-club")).toEqual(["octo-stranger"]);
    expect(github.invitations("octo-owner", "book-club")).toEqual([]);
  });

  it("lets in a stranger who already accepted an invitation", async () => {
    const { github, auth } = setUp();
    github.addRepo({ owner: "octo-owner", name: "book-club", ...notebook, collaborators: ["octo-stranger"] });

    const { location, session } = await signIn(github, auth, "octo-stranger");

    expect(location).toBe(`${appUrl}/notes`);
    expect(session?.member).toMatchObject({ login: "octo-stranger" });
  });

  it("shows the invite-only screen to a stranger invited only by another member, and leaves the invitation alone", async () => {
    const { github, auth } = setUp();
    github.addRepo({ owner: "Octo-Member", name: "reading", ...notebook });
    github.addRepo({ owner: "Octo-Member", name: "recipes", ...notebook, collaborators: ["octo-stranger"] });
    github.invite("Octo-Member", "reading", "octo-stranger");

    const { location, session } = await signIn(github, auth, "octo-stranger");

    expect(location).toBe(`${appUrl}/invite-only?login=octo-stranger`);
    expect(session).toBeNull();
    expect(github.invitations("Octo-Member", "reading")).toHaveLength(1);
    expect(github.collaborators("Octo-Member", "reading")).toEqual([]);
  });

  it("doesn't count access to an owner's repository that isn't a notebook", async () => {
    const { github, auth } = setUp();
    github.addRepo({ owner: "octo-owner", name: "some-code", collaborators: ["octo-stranger"] });

    const { location } = await signIn(github, auth, "octo-stranger");

    expect(location).toBe(`${appUrl}/invite-only?login=octo-stranger`);
  });

  it("doesn't count an invitation that expired", async () => {
    let now = Date.parse("2026-11-03T12:00:00Z");
    const { github, auth } = setUp({ now: () => now });
    github.addRepo({ owner: "octo-owner", name: "book-club", ...notebook });
    github.invite("octo-owner", "book-club", "octo-stranger");
    now += 8 * 24 * 60 * 60 * 1000;

    const { location } = await signIn(github, auth, "octo-stranger");

    expect(location).toBe(`${appUrl}/invite-only?login=octo-stranger`);
    expect(github.collaborators("octo-owner", "book-club")).toEqual([]);
  });

  it("leaves allowlisted members' invitations for them to accept in the app", async () => {
    const { github, auth } = setUp();
    github.addRepo({ owner: "octo-owner", name: "book-club", ...notebook });
    github.invite("octo-owner", "book-club", "Octo-Member");

    const { location } = await signIn(github, auth, "Octo-Member");

    expect(location).toBe(`${appUrl}/notes`);
    expect(github.invitations("octo-owner", "book-club")).toHaveLength(1);
    expect(github.collaborators("octo-owner", "book-club")).toEqual([]);
  });
});

describe("forged sign-in callbacks", () => {
  it("rejects a callback whose state isn't the one this browser started, without using its code", async () => {
    const { github, auth } = setUp();
    const visitor = browser(auth);
    const callback = await github.authorize(await visitor.startSignIn(), { login: "octo-owner" });

    callback.searchParams.set("state", "a-state-this-browser-never-saw");
    const response = await visitor.returnFromGitHub(callback);

    expect(response.headers.get("location")).toBe(`${appUrl}/?sign-in=failed`);
    expect(await visitor.session()).toBeNull();
    expect(github.accessTokensFor("octo-owner")).toEqual([]);
  });

  it("rejects a code issued to another sign-in attempt, because its PKCE verifier doesn't match", async () => {
    const { github, auth } = setUp();
    const victim = browser(auth);
    const attacker = browser(auth);
    const victimState = (await victim.startSignIn()).searchParams.get("state") ?? "";

    // Even with the victim's state, the attacker's code is bound to the attacker's challenge.
    const forged = await github.authorize(await attacker.startSignIn(), { login: "octo-owner" });
    forged.searchParams.set("state", victimState);
    const response = await victim.returnFromGitHub(forged);

    expect(response.headers.get("location")).toBe(`${appUrl}/?sign-in=failed`);
    expect(await victim.session()).toBeNull();
    expect(github.accessTokensFor("octo-owner")).toEqual([]);
  });

  it("rejects a callback from a browser that never started signing in", async () => {
    const { github, auth } = setUp();
    const callback = await github.authorize(await browser(auth).startSignIn(), { login: "octo-owner" });
    const stranger = browser(auth);

    const response = await stranger.returnFromGitHub(callback);

    expect(response.headers.get("location")).toBe(`${appUrl}/?sign-in=failed`);
    expect(await stranger.session()).toBeNull();
  });

  it("accepts each sign-in attempt's callback only once", async () => {
    const { github, auth } = setUp();
    const visitor = browser(auth);
    const callback = await github.authorize(await visitor.startSignIn(), { login: "octo-owner" });
    await visitor.returnFromGitHub(callback);
    await visitor.signOut();

    const replay = await visitor.returnFromGitHub(callback);

    expect(replay.headers.get("location")).toBe(`${appUrl}/?sign-in=failed`);
    expect(await visitor.session()).toBeNull();
  });
});

describe("the session", () => {
  it("lives in an encrypted, HTTP-only cookie that never shows the token", async () => {
    const { github, auth } = setUp();
    const visitor = browser(auth);

    const callback = await github.authorize(await visitor.startSignIn(), { login: "octo-owner" });
    const response = await visitor.returnFromGitHub(callback);

    const [token] = github.accessTokensFor("octo-owner");
    expect(token).toBeDefined();
    expect(await response.text()).not.toContain(token);
    const cookies = visitor.jar.all();
    expect(cookies).toHaveLength(1);
    expect(cookies[0].value).not.toContain(token);
    expect(cookies[0].attributes).toEqual(expect.arrayContaining(["httponly", "secure", "samesite=lax", "path=/"]));
    expect((await visitor.session())?.github.accessToken).toBe(token);
  });

  it("keeps the refresh token and expiry when the OAuth App issues expiring tokens", async () => {
    const { github, auth } = setUp({ expiringTokens: true });
    const visitor = browser(auth);

    await visitor.returnFromGitHub(await github.authorize(await visitor.startSignIn(), { login: "octo-owner" }));

    const session = await visitor.session();
    expect(session?.github.refreshToken).toMatch(/^ghr_/);
    expect(session?.github.accessTokenExpiresAt).toBeGreaterThan(Date.now() + 7 * 60 * 60 * 1000);
  });
});

describe("signing out", () => {
  it("ends the session and returns to the landing page", async () => {
    const { github, auth } = setUp();
    const visitor = browser(auth);
    await visitor.returnFromGitHub(await github.authorize(await visitor.startSignIn(), { login: "octo-owner" }));

    const response = await visitor.signOut();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${appUrl}/`);
    expect(await visitor.session()).toBeNull();
  });

  it("refuses a sign-out posted from another site", async () => {
    const { github, auth } = setUp();
    const visitor = browser(auth);
    await visitor.returnFromGitHub(await github.authorize(await visitor.startSignIn(), { login: "octo-owner" }));

    const response = await visitor.signOut("https://elsewhere.example");

    expect(response.status).toBe(403);
    expect(await visitor.session()).not.toBeNull();
  });
});
