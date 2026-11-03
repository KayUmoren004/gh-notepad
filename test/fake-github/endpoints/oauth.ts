import { escapeHtml, html, json, type FakeRoute } from "../router";
import { findUser, randomToken, type FakeOAuthApp, type FakeState } from "../state";

/**
 * github.com's OAuth web flow (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps):
 *
 * - `GET /login/oauth/authorize` shows an account chooser standing in for
 *   GitHub's sign-in and consent screens. Each seeded user is a button.
 * - `POST /login/oauth/authorize` is that chooser's form: it approves as the
 *   chosen login (or denies) and redirects to `redirect_uri` with `code` and `state`.
 * - `POST /login/oauth/access_token` exchanges the code, checking the client
 *   secret, the redirect URI and the PKCE verifier.
 */

const CODE_LIFETIME_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_LIFETIME_S = 28_800;
const REFRESH_TOKEN_LIFETIME_S = 15_897_600;

interface AuthorizeRequest {
  app: FakeOAuthApp;
  redirectUri: string;
  scopes: string[];
  state: string | null;
  codeChallenge: string | null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; response: Response };

function page(title: string, body: string, status = 200): Response {
  return html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"></head>` +
      `<body style="font-family: system-ui; max-width: 28rem; margin: 3rem auto; padding: 0 1rem">` +
      `<h1 style="font-size: 1.25rem">${escapeHtml(title)}</h1>${body}</body></html>`,
    { status },
  );
}

function redirectWith(target: string, params: Record<string, string | null>): Response {
  const url = new URL(target);
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { location: url.toString() } });
}

/** GitHub's rule: same scheme, host (or a subdomain of it) and port; path at or under the callback's. */
function redirectUriAllowed(redirectUri: string, callbackUrl: string): boolean {
  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    return false;
  }
  const callback = new URL(callbackUrl);
  const callbackDir = callback.pathname.endsWith("/") ? callback.pathname : `${callback.pathname}/`;
  return (
    redirect.protocol === callback.protocol &&
    redirect.port === callback.port &&
    (redirect.hostname === callback.hostname || redirect.hostname.endsWith(`.${callback.hostname}`)) &&
    (redirect.pathname === callback.pathname || redirect.pathname.startsWith(callbackDir))
  );
}

function parseScopes(scope: string | null): string[] {
  return (scope ?? "").split(/[\s,]+/).filter(Boolean);
}

function readAuthorizeRequest(state: FakeState, params: URLSearchParams): Parsed<AuthorizeRequest> {
  const app = state.oauthApps.get(params.get("client_id") ?? "");
  if (!app) return { ok: false, response: page("Not Found", "<p>Unknown client_id.</p>", 404) };

  const requested = params.get("redirect_uri");
  const redirectUri = requested ?? app.callbackUrl;
  if (!redirectUri) {
    return { ok: false, response: page("Bad request", "<p>No redirect_uri and no callback URL.</p>", 400) };
  }
  if (requested && app.callbackUrl && !redirectUriAllowed(requested, app.callbackUrl)) {
    return {
      ok: false,
      response: redirectWith(app.callbackUrl, {
        error: "redirect_uri_mismatch",
        error_description: "The redirect_uri MUST match the registered callback URL for this application.",
        state: params.get("state"),
      }),
    };
  }

  const codeChallenge = params.get("code_challenge");
  const method = params.get("code_challenge_method");
  if ((codeChallenge === null) !== (method === null)) {
    return {
      ok: false,
      response: page("Bad request", "<p>code_challenge and code_challenge_method go together.</p>", 400),
    };
  }
  if (method !== null && method !== "S256") {
    return { ok: false, response: page("Bad request", "<p>code_challenge_method must be S256.</p>", 400) };
  }
  if (codeChallenge !== null && codeChallenge.length !== 43) {
    return { ok: false, response: page("Bad request", "<p>code_challenge must be 43 characters.</p>", 400) };
  }

  return {
    ok: true,
    value: { app, redirectUri, scopes: parseScopes(params.get("scope")), state: params.get("state"), codeChallenge },
  };
}

function chooserPage(state: FakeState, request: AuthorizeRequest, params: URLSearchParams): Response {
  const hidden = [...params.entries()]
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join("");
  const accounts = [...state.users.values()]
    .map(
      (user) =>
        `<p><button type="submit" name="login" value="${escapeHtml(user.login)}">` +
        `Authorize as ${escapeHtml(user.login)}</button></p>`,
    )
    .join("");
  return page(
    `Authorize ${request.app.name}`,
    `<p>Fake GitHub: choose the account that signs in.</p>` +
      `<form method="post" action="/login/oauth/authorize">${hidden}${accounts || "<p>No users seeded.</p>"}` +
      `<p><button type="submit" name="deny" value="1">Cancel</button></p></form>`,
  );
}

async function readParams(request: Request, url: URL): Promise<URLSearchParams> {
  const params = new URLSearchParams(url.searchParams);
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body: unknown = await request.json();
    if (body && typeof body === "object") {
      for (const [key, value] of Object.entries(body)) if (typeof value === "string") params.set(key, value);
    }
  } else if (type.includes("application/x-www-form-urlencoded")) {
    for (const [key, value] of new URLSearchParams(await request.text())) params.set(key, value);
  }
  return params;
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString("base64url");
}

/** Token endpoint replies: JSON when asked for it, form-encoded otherwise, like GitHub. */
function tokenReply(request: Request, body: Record<string, string | number>): Response {
  if ((request.headers.get("accept") ?? "").includes("application/json")) return json(body);
  const form = new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)]));
  return new Response(form.toString(), { headers: { "content-type": "application/x-www-form-urlencoded" } });
}

const tokenErrors = {
  incorrect_client_credentials: "The client_id and/or client_secret passed are incorrect.",
  redirect_uri_mismatch: "The redirect_uri MUST match the registered callback URL for this application.",
  bad_verification_code: "The code passed is incorrect or expired.",
} as const;

function tokenError(request: Request, error: keyof typeof tokenErrors): Response {
  return tokenReply(request, {
    error,
    error_description: tokenErrors[error],
    error_uri: `/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors/#${error.replaceAll("_", "-")}`,
  });
}

export const oauthRoutes: FakeRoute[] = [
  {
    method: "GET",
    path: "/login/oauth/authorize",
    handle: ({ url, state }) => {
      const parsed = readAuthorizeRequest(state, url.searchParams);
      return parsed.ok ? chooserPage(state, parsed.value, url.searchParams) : parsed.response;
    },
  },
  {
    method: "POST",
    path: "/login/oauth/authorize",
    handle: async ({ request, url, state }) => {
      const params = await readParams(request, url);
      const parsed = readAuthorizeRequest(state, params);
      if (!parsed.ok) return parsed.response;
      const { app, redirectUri, scopes, codeChallenge } = parsed.value;

      if (params.get("deny")) {
        return redirectWith(redirectUri, {
          error: "access_denied",
          error_description: "The user has denied your application access.",
          state: parsed.value.state,
        });
      }

      const user = findUser(state, params.get("login") ?? "");
      if (!user) return page("Bad request", "<p>Unknown login.</p>", 400);

      const code = randomToken("", 20).toLowerCase();
      state.authorizationCodes.set(code, {
        code,
        clientId: app.clientId,
        login: user.login,
        redirectUri,
        scopes,
        codeChallenge,
        expiresAt: state.now() + CODE_LIFETIME_MS,
      });
      return redirectWith(redirectUri, { code, state: parsed.value.state });
    },
  },
  {
    method: "POST",
    path: "/login/oauth/access_token",
    handle: async ({ request, url, state }) => {
      const params = await readParams(request, url);
      const app = state.oauthApps.get(params.get("client_id") ?? "");
      if (!app || app.clientSecret !== params.get("client_secret")) {
        return tokenError(request, "incorrect_client_credentials");
      }

      // A code is spent by the first attempt to use it, successful or not.
      const code = state.authorizationCodes.get(params.get("code") ?? "");
      if (code) state.authorizationCodes.delete(code.code);
      if (!code || code.clientId !== app.clientId || code.expiresAt <= state.now()) {
        return tokenError(request, "bad_verification_code");
      }
      const redirectUri = params.get("redirect_uri");
      if (redirectUri !== null && redirectUri !== code.redirectUri) {
        return tokenError(request, "redirect_uri_mismatch");
      }
      const verifier = params.get("code_verifier");
      if (code.codeChallenge !== null && (verifier === null || (await s256(verifier)) !== code.codeChallenge)) {
        return tokenError(request, "bad_verification_code");
      }

      // `offline_access` asks for an expiring token but is not a granted scope.
      const scopes = code.scopes.filter((scope) => scope !== "offline_access");
      const expiring = app.expiringTokens || code.scopes.includes("offline_access");
      if (!expiring) {
        const token = randomToken("gho_");
        state.accessTokens.set(token, { token, login: code.login, clientId: app.clientId, scopes, expiresAt: null });
        return tokenReply(request, { access_token: token, token_type: "bearer", scope: scopes.join(",") });
      }

      const now = state.now();
      const token = randomToken("ghu_");
      const refreshToken = randomToken("ghr_", 76);
      state.accessTokens.set(token, {
        token,
        login: code.login,
        clientId: app.clientId,
        scopes,
        expiresAt: now + ACCESS_TOKEN_LIFETIME_S * 1000,
      });
      state.refreshTokens.set(refreshToken, {
        token: refreshToken,
        login: code.login,
        clientId: app.clientId,
        scopes,
        expiresAt: now + REFRESH_TOKEN_LIFETIME_S * 1000,
      });
      return tokenReply(request, {
        access_token: token,
        expires_in: ACCESS_TOKEN_LIFETIME_S,
        refresh_token: refreshToken,
        refresh_token_expires_in: REFRESH_TOKEN_LIFETIME_S,
        token_type: "bearer",
        scope: scopes.join(","),
      });
    },
  },
];
