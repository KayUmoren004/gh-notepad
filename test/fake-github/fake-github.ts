import { fakeOnlyRoutes } from "./endpoints/fake-only";
import { oauthRoutes } from "./endpoints/oauth";
import { userRoutes } from "./endpoints/users";
import { apiError, matchPath, type FakeRoute } from "./router";
import {
  accessTokensFor,
  addOAuthApp,
  addUser,
  createState,
  type FakeOAuthApp,
  type FakeState,
  type FakeUser,
  type UserSeed,
} from "./state";

/** Every endpoint the fake answers. Add new endpoint modules here. */
const routes: FakeRoute[] = [...oauthRoutes, ...userRoutes, ...fakeOnlyRoutes];

export interface FakeGitHubOptions {
  /** Clock for token and code expiry, in epoch milliseconds. */
  now?: () => number;
}

/**
 * An in-memory GitHub: the subset of github.com OAuth and the REST API that
 * the app's GitHub gateway uses, answering `Request`s with `Response`s.
 */
export interface FakeGitHub {
  /** Answers one request the way GitHub would. */
  handle: (request: Request) => Promise<Response>;
  /** `handle` in the shape of `fetch`, to inject wherever code under test takes one. */
  fetch: typeof fetch;

  /** Seeds a GitHub account. Adding a login that exists returns the existing user. */
  addUser: (user: UserSeed) => FakeUser;
  /** Registers an OAuth App; omitted credentials are generated. */
  addOAuthApp: (app?: Partial<FakeOAuthApp>) => FakeOAuthApp;

  /**
   * Plays the person on GitHub's authorize screen: approves `authorizeUrl` as
   * `login` (or cancels) and returns the URL GitHub sends the browser to: the
   * app's callback with `code` and `state`, or with `error`.
   */
  authorize: (authorizeUrl: string | URL, as: { login: string } | "deny") => Promise<URL>;
  /** Every access token issued to `login`, oldest first. */
  accessTokensFor: (login: string) => string[];
}

export function createFakeGitHub(options: FakeGitHubOptions = {}): FakeGitHub {
  const state = createState(options);
  const handle = (request: Request) => route(state, request);

  return {
    handle,
    fetch: (input, init) => handle(new Request(input, init)),
    addUser: (user) => addUser(state, user),
    addOAuthApp: (app) => addOAuthApp(state, app),
    accessTokensFor: (login) => accessTokensFor(state, login),

    authorize: async (authorizeUrl, as) => {
      const url = new URL(authorizeUrl);
      const form = new URLSearchParams(url.searchParams);
      if (as === "deny") form.set("deny", "1");
      else form.set("login", as.login);
      const response = await handle(
        new Request(new URL("/login/oauth/authorize", url), {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form,
        }),
      );
      const location = response.headers.get("location");
      if (response.status !== 302 || !location) {
        throw new Error(`Fake GitHub refused to authorize (${response.status}): ${await response.text()}`);
      }
      return new URL(location);
    },
  };
}

async function route(state: FakeState, request: Request): Promise<Response> {
  const url = new URL(request.url);
  for (const candidate of routes) {
    if (candidate.method !== request.method) continue;
    const params = matchPath(candidate.path, url.pathname);
    if (params) return candidate.handle({ request, url, params, state });
  }
  return apiError(404, "Not Found");
}
