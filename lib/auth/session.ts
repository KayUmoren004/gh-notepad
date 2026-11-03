import { sealData, unsealData } from "iron-session";

/** The signed-in member, as pages may see them. Holds nothing secret. */
export interface Member {
  login: string;
  id: number;
  name: string | null;
  avatarUrl: string;
}

/** GitHub credentials. Server-only: never rendered, logged or returned by a route. */
export interface GitHubCredentials {
  accessToken: string;
  /** Present when the OAuth App issues expiring tokens. */
  refreshToken?: string;
  /** Epoch milliseconds. */
  accessTokenExpiresAt?: number;
  refreshTokenExpiresAt?: number;
}

export interface Session {
  member: Member;
  github: GitHubCredentials;
}

export const SESSION_COOKIE = "gh-notepad-session";
const SESSION_TTL_S = 180 * 24 * 60 * 60;

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    // iron-session's convention: the cookie expires a minute before the seal.
    maxAge: SESSION_TTL_S - 60,
  };
}

export function sealSession(session: Session, password: string): Promise<string> {
  return sealData(session, { password, ttl: SESSION_TTL_S });
}

/** The session in a cookie value, or `null` if it is missing, expired, tampered with or malformed. */
export async function unsealSession(seal: string, password: string): Promise<Session | null> {
  try {
    const data = await unsealData<unknown>(seal, { password, ttl: SESSION_TTL_S });
    return isSession(data) ? data : null;
  } catch {
    return null;
  }
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const { member, github } = value as Partial<Record<keyof Session, unknown>>;
  return (
    !!member &&
    typeof member === "object" &&
    typeof (member as Partial<Member>).login === "string" &&
    typeof (member as Partial<Member>).id === "number" &&
    !!github &&
    typeof github === "object" &&
    typeof (github as Partial<GitHubCredentials>).accessToken === "string"
  );
}
