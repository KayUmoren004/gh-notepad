/**
 * The fake GitHub's in-memory world. Endpoints read and change it; seeding
 * methods on `FakeGitHub` add to it. Later tickets add repositories, refs,
 * commits, trees and blobs here.
 */

export interface FakeUser {
  login: string;
  id: number;
  nodeId: string;
  name: string | null;
  createdAt: string;
}

export interface FakeOAuthApp {
  clientId: string;
  clientSecret: string;
  name: string;
  /** The registered callback URL; `redirect_uri` must sit at or under it. */
  callbackUrl: string | null;
  /** Issue expiring access tokens (8 h) with refresh tokens (6 months). */
  expiringTokens: boolean;
}

export interface AuthorizationCode {
  code: string;
  clientId: string;
  login: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string | null;
  expiresAt: number;
}

export interface AccessToken {
  token: string;
  login: string;
  clientId: string;
  scopes: string[];
  /** Epoch milliseconds, or `null` for a token that never expires. */
  expiresAt: number | null;
}

export interface RefreshToken {
  token: string;
  login: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
}

export interface FakeState {
  now: () => number;
  users: Map<string, FakeUser>;
  oauthApps: Map<string, FakeOAuthApp>;
  authorizationCodes: Map<string, AuthorizationCode>;
  accessTokens: Map<string, AccessToken>;
  refreshTokens: Map<string, RefreshToken>;
  nextId: () => number;
}

export function createState(options: { now?: () => number } = {}): FakeState {
  let lastId = 1000;
  return {
    now: options.now ?? Date.now,
    users: new Map(),
    oauthApps: new Map(),
    authorizationCodes: new Map(),
    accessTokens: new Map(),
    refreshTokens: new Map(),
    nextId: () => ++lastId,
  };
}

/** GitHub logins are case-insensitive. */
export function findUser(state: FakeState, login: string): FakeUser | undefined {
  return state.users.get(login.toLowerCase());
}

export interface UserSeed {
  login: string;
  name?: string | null;
}

/** Adds a GitHub account; adding a login that exists returns the existing user. */
export function addUser(state: FakeState, { login, name = null }: UserSeed): FakeUser {
  const existing = findUser(state, login);
  if (existing) return existing;
  const id = state.nextId();
  const user: FakeUser = {
    login,
    id,
    nodeId: Buffer.from(`04:User${id}`).toString("base64"),
    name,
    createdAt: new Date(state.now()).toISOString(),
  };
  state.users.set(login.toLowerCase(), user);
  return user;
}

/** Registers an OAuth App; omitted credentials are generated. */
export function addOAuthApp(state: FakeState, app: Partial<FakeOAuthApp> = {}): FakeOAuthApp {
  const registered: FakeOAuthApp = {
    clientId: app.clientId ?? randomToken("Ov23li", 14),
    clientSecret: app.clientSecret ?? randomToken("", 40).toLowerCase(),
    name: app.name ?? "OAuth App",
    callbackUrl: app.callbackUrl ?? null,
    expiringTokens: app.expiringTokens ?? false,
  };
  state.oauthApps.set(registered.clientId, registered);
  return registered;
}

export function accessTokensFor(state: FakeState, login: string): string[] {
  return [...state.accessTokens.values()]
    .filter((token) => token.login.toLowerCase() === login.toLowerCase())
    .map((token) => token.token);
}

/** The user behind the request's `Authorization: Bearer|token <token>` header. */
export function authenticate(state: FakeState, request: Request): FakeUser | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^(?:bearer|token)\s+(\S+)$/i.exec(header);
  if (!match) return null;
  const token = state.accessTokens.get(match[1]);
  if (!token) return null;
  if (token.expiresAt !== null && token.expiresAt <= state.now()) return null;
  return findUser(state, token.login) ?? null;
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A random token in GitHub's shape, e.g. `gho_` + 36 alphanumerics. */
export function randomToken(prefix: string, length = 36): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return prefix + Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}
