import "server-only";
import { apiCaller, errorMessage, GitHubError, record, text } from "./http";
import { sharedNotebooksGitHub, type SharedNotebooksGitHub } from "./shared-notebooks";

/**
 * The GitHub gateway: the only code that knows GitHub's URLs, headers, payload
 * shapes and error formats. Route handlers call it; the browser never talks to
 * GitHub. Tests inject the fake GitHub's `fetch`, and end-to-end runs point the
 * base URLs at the fake served over HTTP.
 */

export { GITHUB_API_VERSION, GitHubError } from "./http";
export {
  NOTEBOOK_TOPIC,
  type Collaborator,
  type CreateNotebookOutcome,
  type InviteOutcome,
  type Notebook,
  type NotebookInvitation,
  type NotebookRepository,
  type SharedNotebooksGitHub,
} from "./shared-notebooks";

export interface GitHubGatewayOptions {
  clientId: string;
  clientSecret: string;
  /** REST API base URL. Default `https://api.github.com`. */
  apiBaseUrl?: string;
  /** OAuth (github.com) base URL. Default `https://github.com`. */
  oauthBaseUrl?: string;
  fetch?: typeof fetch;
}

export interface OAuthGrant {
  accessToken: string;
  scopes: string[];
  /** Present when the OAuth App issues expiring tokens. */
  refreshToken?: string;
  /** Epoch milliseconds. */
  accessTokenExpiresAt?: number;
  refreshTokenExpiresAt?: number;
}

export interface GitHubUser {
  login: string;
  id: number;
  name: string | null;
  avatarUrl: string;
}

/** The signed-in member, as the session knows them: GitHub is never asked who they are again. */
export interface MemberCredentials {
  login: string;
  accessToken: string;
}

export interface GitHubGateway {
  /** Where to send the browser to ask the person to authorize the app. */
  authorizeUrl: (request: {
    redirectUri: string;
    state: string;
    codeChallenge: string;
    scopes: readonly string[];
  }) => URL;
  /** Trades an authorization code for tokens; throws `GitHubError` if GitHub refuses. */
  exchangeCode: (request: { code: string; redirectUri: string; codeVerifier: string }) => Promise<OAuthGrant>;
  /** The account a token belongs to. */
  getAuthenticatedUser: (accessToken: string) => Promise<GitHubUser>;
  /** Notebook operations acting as `member`, whose login was resolved once, at sign-in. */
  forMember: (member: MemberCredentials) => SharedNotebooksGitHub;
}

/** The gateway configured from `GITHUB_*` environment variables. */
export function gatewayFromEnv(
  env: Record<string, string | undefined>,
  dependencies: { fetch?: typeof fetch } = {},
): GitHubGateway {
  return createGitHubGateway({
    clientId: required(env, "GITHUB_CLIENT_ID"),
    clientSecret: required(env, "GITHUB_CLIENT_SECRET"),
    // Test-only overrides; production always talks to github.com.
    apiBaseUrl: env.GITHUB_API_BASE_URL || undefined,
    oauthBaseUrl: env.GITHUB_OAUTH_BASE_URL || undefined,
    fetch: dependencies.fetch,
  });
}

export function createGitHubGateway(options: GitHubGatewayOptions): GitHubGateway {
  const send = options.fetch ?? fetch;
  const apiBase = (options.apiBaseUrl ?? "https://api.github.com").replace(/\/+$/, "");
  const oauthBase = (options.oauthBaseUrl ?? "https://github.com").replace(/\/+$/, "");

  return {
    authorizeUrl: ({ redirectUri, state, codeChallenge, scopes }) => {
      const url = new URL(`${oauthBase}/login/oauth/authorize`);
      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        scope: scopes.join(" "),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }).toString();
      return url;
    },

    exchangeCode: async ({ code, redirectUri, codeVerifier }) => {
      const response = await send(`${oauthBase}/login/oauth/access_token`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "gh-notepad",
        },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });
      if (!response.ok) throw new GitHubError(await errorMessage(response), response.status);

      // GitHub reports OAuth errors with a 200 and an `error` field.
      const body = record(await response.json());
      if (typeof body.error === "string") {
        throw new GitHubError(text(body.error_description) ?? body.error, 400, body.error);
      }
      const accessToken = text(body.access_token);
      if (!accessToken) throw new GitHubError("GitHub returned no access token", 502);

      const now = Date.now();
      return {
        accessToken,
        scopes: (text(body.scope) ?? "").split(",").filter(Boolean),
        refreshToken: text(body.refresh_token),
        accessTokenExpiresAt: seconds(body.expires_in, now),
        refreshTokenExpiresAt: seconds(body.refresh_token_expires_in, now),
      };
    },

    getAuthenticatedUser: async (accessToken) => {
      const body = record(await (await apiCaller(send, apiBase, accessToken)("/user")).json());
      const login = text(body.login);
      if (!login || typeof body.id !== "number") throw new GitHubError("Unexpected /user response", 502);
      return { login, id: body.id, name: text(body.name) ?? null, avatarUrl: text(body.avatar_url) ?? "" };
    },

    forMember: ({ login, accessToken }) => sharedNotebooksGitHub(apiCaller(send, apiBase, accessToken), login),
  };
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function seconds(value: unknown, now: number): number | undefined {
  return typeof value === "number" ? now + value * 1000 : undefined;
}
