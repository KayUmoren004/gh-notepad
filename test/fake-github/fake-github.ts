import { fakeOnlyRoutes } from "./endpoints/fake-only";
import { gitDataRoutes } from "./endpoints/git-data";
import { oauthRoutes } from "./endpoints/oauth";
import { repoRoutes } from "./endpoints/repos";
import { userRoutes } from "./endpoints/users";
import { apiError, matchPath, type FakeRoute } from "./router";
import {
  accessTokensFor,
  addOAuthApp,
  addRepo,
  addUser,
  commitFiles,
  commitLog,
  createState,
  findRepo,
  issueAccessToken,
  readFiles,
  type FakeCommitSummary,
  type FakeOAuthApp,
  type FakeRepo,
  type FakeRequest,
  type FakeState,
  type FakeUser,
  type RepoSeed,
  type UserSeed,
} from "./state";

/** Every endpoint the fake answers. Add new endpoint modules here. */
const routes: FakeRoute[] = [...oauthRoutes, ...userRoutes, ...repoRoutes, ...gitDataRoutes, ...fakeOnlyRoutes];

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
  /** Issues a token for `login` without the OAuth dance, for tests that start signed in. */
  issueAccessToken: (login: string, scopes?: string[]) => string;

  /**
   * Seeds a repository (and its owner). With `files` it has an initial commit
   * holding them; without, it is empty. Adding one that exists returns it.
   */
  addRepo: (repo: RepoSeed) => FakeRepo;
  /** The repository `owner/name`, or `undefined`. */
  repo: (owner: string, name: string) => FakeRepo | undefined;
  /**
   * Plays an edit made outside the app (on github.com, or pushed from another
   * editor): commits `files` to the default branch, where `null` deletes a
   * path. Returns the new commit's SHA.
   */
  commitFiles: (owner: string, name: string, change: { message: string; files: Record<string, string | null> }) => string;
  /** Every file on the default branch, as text, by path. */
  files: (owner: string, name: string) => Record<string, string>;
  /** The default branch's history, newest first, with the paths each commit changed. */
  commits: (owner: string, name: string) => FakeCommitSummary[];
  /** Every GitHub request answered so far (control routes under `/_fake/` aside), oldest first. */
  requests: () => FakeRequest[];
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
    issueAccessToken: (login, scopes) => issueAccessToken(state, login, scopes),
    addRepo: (repo) => addRepo(state, repo),
    repo: (owner, name) => findRepo(state, owner, name),
    commitFiles: (owner, name, change) => commitFiles(state, requireRepo(state, owner, name), change),
    files: (owner, name) => readFiles(requireRepo(state, owner, name)),
    commits: (owner, name) => commitLog(requireRepo(state, owner, name)),
    requests: () => [...state.requests],

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

function requireRepo(state: FakeState, owner: string, name: string): FakeRepo {
  const repo = findRepo(state, owner, name);
  if (!repo) throw new Error(`Fake GitHub has no repository ${owner}/${name}`);
  return repo;
}

async function route(state: FakeState, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const response = await dispatch(state, request, url);
  if (!url.pathname.startsWith("/_fake/")) {
    state.requests.push({ method: request.method, path: url.pathname + url.search, status: response.status });
  }
  return response;
}

async function dispatch(state: FakeState, request: Request, url: URL): Promise<Response> {
  for (const candidate of routes) {
    if (candidate.method !== request.method) continue;
    const params = matchPath(candidate.path, url.pathname);
    if (params) return candidate.handle({ request, url, params, state });
  }
  return apiError(404, "Not Found");
}
