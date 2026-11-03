import { sealData, unsealData } from "iron-session";
import { NextResponse, type NextRequest } from "next/server";
import {
  GitHubError,
  gatewayFromEnv,
  type GitHubGateway,
  type GitHubUser,
  type OAuthGrant,
} from "@/lib/github-gateway";
import { accessList, admittedByInvitation, type AccessList } from "./access";
import { randomUrlSafe, s256, safeEqual } from "./pkce";
import { SESSION_COOKIE, sealSession, sessionCookieOptions, unsealSession, type Session } from "./session";

/** OAuth scopes: `repo` for notebooks (private repos, collaborators), `read:user` for the profile. */
const SCOPES = ["repo", "read:user"] as const;

/** Holds one sign-in attempt's `state` and PKCE verifier until GitHub sends the browser back. */
const SIGN_IN_COOKIE = "gh-notepad-sign-in";
const SIGN_IN_TTL_S = 10 * 60;
const SIGN_IN_PATH = "/api/auth";

interface SignInAttempt {
  state: string;
  verifier: string;
}

export interface AuthOptions {
  /** The app's public origin; the OAuth callback is `<appUrl>/api/auth/callback`. */
  appUrl: URL;
  /** Encrypts the session cookie; at least 32 characters. */
  sessionSecret: string;
  access: AccessList;
  github: GitHubGateway;
}

/** Anything with Next's `cookies().get(name)` shape. */
export interface CookieReader {
  get: (name: string) => { value: string } | undefined;
}

/** The sign-in routes, plus reading the session they create. */
export interface Auth {
  /** `GET /api/auth/login`: starts a sign-in attempt and sends the browser to GitHub. */
  signIn: (request: NextRequest) => Promise<NextResponse>;
  /** `GET /api/auth/callback`: verifies `state` and PKCE, applies the access gate, creates the session. */
  callback: (request: NextRequest) => Promise<NextResponse>;
  /** `POST /api/auth/logout`: ends the session. */
  signOut: (request: NextRequest) => Promise<NextResponse>;
  /** The session in the request's cookies. Server-only: it holds the GitHub token. */
  readSession: (cookies: CookieReader) => Promise<Session | null>;
}

/** The auth routes configured from the environment (see README for the variables). */
export function authFromEnv(
  env: Record<string, string | undefined> = process.env,
  dependencies: { fetch?: typeof fetch } = {},
): Auth {
  const missing = ["NEXT_PUBLIC_APP_URL", "SESSION_SECRET", "OWNER_GITHUB_USER"].filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  const sessionSecret = env.SESSION_SECRET ?? "";
  if (sessionSecret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");

  return createAuth({
    appUrl: new URL(env.NEXT_PUBLIC_APP_URL ?? ""),
    sessionSecret,
    access: accessList(env.OWNER_GITHUB_USER ?? "", env.ALLOWED_GITHUB_USERS),
    github: gatewayFromEnv(env, dependencies),
  });
}

export function createAuth({ appUrl, sessionSecret, access, github }: AuthOptions): Auth {
  const secure = appUrl.protocol === "https:";
  const callbackUrl = new URL("/api/auth/callback", appUrl).toString();
  const signInCookie = { httpOnly: true, secure, sameSite: "lax" as const, path: SIGN_IN_PATH };

  const redirect = (path: string, status?: number) => NextResponse.redirect(new URL(path, appUrl), status);

  async function readAttempt(request: NextRequest): Promise<SignInAttempt | null> {
    const seal = request.cookies.get(SIGN_IN_COOKIE)?.value;
    if (!seal) return null;
    try {
      const data = await unsealData<Partial<SignInAttempt>>(seal, { password: sessionSecret, ttl: SIGN_IN_TTL_S });
      return typeof data.state === "string" && typeof data.verifier === "string"
        ? { state: data.state, verifier: data.verifier }
        : null;
    } catch {
      return null;
    }
  }

  /** Ends the sign-in attempt: its cookie is spent whatever the outcome. */
  function finishAttempt(path: string): NextResponse {
    const response = redirect(path);
    response.cookies.set(SIGN_IN_COOKIE, "", { ...signInCookie, maxAge: 0 });
    return response;
  }

  return {
    signIn: async () => {
      const attempt: SignInAttempt = { state: randomUrlSafe(), verifier: randomUrlSafe() };
      const response = NextResponse.redirect(
        github.authorizeUrl({
          redirectUri: callbackUrl,
          state: attempt.state,
          codeChallenge: await s256(attempt.verifier),
          scopes: SCOPES,
        }),
      );
      response.cookies.set(SIGN_IN_COOKIE, await sealData(attempt, { password: sessionSecret, ttl: SIGN_IN_TTL_S }), {
        ...signInCookie,
        maxAge: SIGN_IN_TTL_S,
      });
      return response;
    },

    callback: async (request) => {
      const params = request.nextUrl.searchParams;
      if (params.get("error") === "access_denied") return finishAttempt("/?sign-in=cancelled");

      const attempt = await readAttempt(request);
      const code = params.get("code");
      const state = params.get("state");
      // `state` ties the callback to the browser that started the attempt (forged callbacks fail here).
      if (!attempt || !code || !state || !safeEqual(state, attempt.state)) {
        return finishAttempt("/?sign-in=failed");
      }

      let grant: OAuthGrant;
      let user: GitHubUser;
      let admitted: boolean;
      try {
        // GitHub checks the PKCE verifier: a code issued to another attempt is refused.
        grant = await github.exchangeCode({ code, redirectUri: callbackUrl, codeVerifier: attempt.verifier });
        user = await github.getAuthenticatedUser(grant.accessToken);
        // Anyone the owner invited to one of their notebooks gets in too (ADR 0004).
        admitted =
          access.allows(user.login) ||
          (await admittedByInvitation(
            github.forMember({ login: user.login, accessToken: grant.accessToken }),
            access.owner,
          ));
      } catch (error) {
        if (!(error instanceof GitHubError)) throw error;
        if (error.code !== "bad_verification_code") {
          console.error(`Sign-in failed: GitHub answered ${error.code ?? error.status}`);
        }
        return finishAttempt("/?sign-in=failed");
      }

      if (!admitted) {
        return finishAttempt(`/invite-only?${new URLSearchParams({ login: user.login })}`);
      }

      const session: Session = {
        member: { login: user.login, id: user.id, name: user.name, avatarUrl: user.avatarUrl },
        github: {
          accessToken: grant.accessToken,
          refreshToken: grant.refreshToken,
          accessTokenExpiresAt: grant.accessTokenExpiresAt,
          refreshTokenExpiresAt: grant.refreshTokenExpiresAt,
        },
      };
      const response = finishAttempt("/notes");
      response.cookies.set(SESSION_COOKIE, await sealSession(session, sessionSecret), sessionCookieOptions(secure));
      return response;
    },

    signOut: async (request) => {
      // A cross-site form can't read our cookies, but it could still sign the member out.
      const origin = request.headers.get("origin");
      if (origin !== null && origin !== appUrl.origin) return new NextResponse("Forbidden", { status: 403 });

      const response = redirect("/", 303);
      response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(secure), maxAge: 0 });
      return response;
    },

    readSession: async (cookies) => {
      const seal = cookies.get(SESSION_COOKIE)?.value;
      return seal ? unsealSession(seal, sessionSecret) : null;
    },
  };
}
