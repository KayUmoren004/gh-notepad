import "server-only";
import { cookies } from "next/headers";
import { authFromEnv } from "./auth";
import type { Member } from "./session";

export { authFromEnv, createAuth, type Auth, type AuthOptions, type CookieReader } from "./auth";
export type { GitHubCredentials, Member, Session } from "./session";

/**
 * The signed-in member for the current request, or `null`. For Server
 * Components: it exposes the member's profile and never their token.
 */
export async function getSignedInMember(): Promise<Member | null> {
  const session = await authFromEnv().readSession(await cookies());
  return session?.member ?? null;
}
