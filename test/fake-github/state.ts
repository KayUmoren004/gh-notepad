import {
  buildTree,
  flattenTree,
  getObject,
  writeBlob,
  writeCommit,
  type FileEntry,
  type ObjectStore,
  type Signature,
} from "./git";

/**
 * The fake GitHub's in-memory world. Endpoints read and change it; seeding
 * methods on `FakeGitHub` add to it.
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

export interface FakeRepo {
  id: number;
  nodeId: string;
  /** The owner's login, as GitHub spells it. */
  owner: string;
  name: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  createdAt: string;
  /** Branches and tags: `heads/main` → commit SHA. Empty for an empty repository. */
  refs: Map<string, string>;
  objects: ObjectStore;
  /** Saved lowercase, in the order given. */
  topics: string[];
  /** People other than the owner with access, by lowercased login. */
  collaborators: Map<string, FakeUser>;
}

/** An open invitation to collaborate on a repository, until the invitee accepts or declines it. */
export interface FakeInvitation {
  id: number;
  nodeId: string;
  /** The repository's key in `FakeState.repos`. */
  repo: string;
  invitee: FakeUser;
  inviter: FakeUser;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** One request the fake answered, for tests that check what GitHub was asked. */
export interface FakeRequest {
  method: string;
  /** Path and query string, e.g. `/repos/octo/my-notes/git/trees/main?recursive=1`. */
  path: string;
  status: number;
}

export interface FakeState {
  now: () => number;
  users: Map<string, FakeUser>;
  oauthApps: Map<string, FakeOAuthApp>;
  authorizationCodes: Map<string, AuthorizationCode>;
  accessTokens: Map<string, AccessToken>;
  refreshTokens: Map<string, RefreshToken>;
  /** By lowercased `owner/name`. */
  repos: Map<string, FakeRepo>;
  invitations: Map<number, FakeInvitation>;
  requests: FakeRequest[];
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
    repos: new Map(),
    invitations: new Map(),
    requests: [],
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

/** Revokes every access and refresh token issued to `login`, as when they revoke the app on github.com. */
export function revokeAccessTokens(state: FakeState, login: string): void {
  for (const [key, token] of state.accessTokens) {
    if (token.login.toLowerCase() === login.toLowerCase()) state.accessTokens.delete(key);
  }
  for (const [key, token] of state.refreshTokens) {
    if (token.login.toLowerCase() === login.toLowerCase()) state.refreshTokens.delete(key);
  }
}

/** Issues an access token for `login` directly, as if they had authorized an app. */
export function issueAccessToken(state: FakeState, login: string, scopes: string[] = ["repo", "read:user"]): string {
  const user = findUser(state, login);
  if (!user) throw new Error(`Fake GitHub has no user ${login}`);
  const token = randomToken("gho_");
  state.accessTokens.set(token, { token, login: user.login, clientId: "fake-seeded", scopes, expiresAt: null });
  return token;
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

// ---------------------------------------------------------------- Repositories

export function findRepo(state: FakeState, owner: string, name: string): FakeRepo | undefined {
  return state.repos.get(`${owner}/${name}`.toLowerCase());
}

/** Private repositories are visible to their owner and collaborators only. */
export function canRead(user: FakeUser | null, repo: FakeRepo): boolean {
  return !repo.private || canWrite(user, repo);
}

/** Collaborators on a personal account's repository can always push: GitHub has no read-only collaborators there. */
export function canWrite(user: FakeUser | null, repo: FakeRepo): boolean {
  return isAdmin(user, repo) || (!!user && repo.collaborators.has(user.login.toLowerCase()));
}

/** Only the owner administers a personal account's repository: its topics, collaborators and invitations. */
export function isAdmin(user: FakeUser | null, repo: FakeRepo): boolean {
  return !!user && user.login.toLowerCase() === repo.owner.toLowerCase();
}

/** How GitHub signs commits made through the API: the user's name and no-reply address. */
export function signatureOf(state: FakeState, user: FakeUser): Signature {
  return {
    name: user.name ?? user.login,
    email: `${user.id}+${user.login}@users.noreply.github.com`,
    date: new Date(Math.floor(state.now() / 1000) * 1000).toISOString().replace(".000Z", "Z"),
  };
}

export interface RepoSeed {
  owner: string;
  name: string;
  private?: boolean;
  description?: string | null;
  /** Files in the initial commit, by path. Without files the repository is empty (no commits). */
  files?: Record<string, string>;
  topics?: string[];
  /** Logins with collaborator access already (their invitations accepted); seeded as users if new. */
  collaborators?: string[];
}

/** Creates a repository (and its owner, if new). Adding a repository that exists returns it unchanged. */
export function addRepo(state: FakeState, seed: RepoSeed): FakeRepo {
  const existing = findRepo(state, seed.owner, seed.name);
  if (existing) return existing;
  const owner = addUser(state, { login: seed.owner });
  const id = state.nextId();
  const repo: FakeRepo = {
    id,
    nodeId: Buffer.from(`010:Repository${id}`).toString("base64"),
    owner: owner.login,
    name: seed.name,
    private: seed.private ?? true,
    description: seed.description ?? null,
    defaultBranch: "main",
    createdAt: new Date(state.now()).toISOString(),
    refs: new Map(),
    objects: new Map(),
    topics: (seed.topics ?? []).map((topic) => topic.toLowerCase()),
    collaborators: new Map(),
  };
  for (const login of seed.collaborators ?? []) addCollaborator(repo, addUser(state, { login }));
  state.repos.set(`${repo.owner}/${repo.name}`.toLowerCase(), repo);
  if (seed.files) commitFiles(state, repo, { message: "Initial commit", files: seed.files });
  return repo;
}

/** The commit a branch points at, or `undefined` for an empty repository or unknown branch. */
export function branchHead(repo: FakeRepo, branch = repo.defaultBranch): string | undefined {
  return repo.refs.get(`heads/${branch}`);
}

/**
 * Commits file changes to a branch as its owner would by pushing from
 * elsewhere (github.com, another editor). `null` deletes a file.
 */
export function commitFiles(
  state: FakeState,
  repo: FakeRepo,
  change: { message: string; files: Record<string, string | null>; branch?: string },
): string {
  const branch = change.branch ?? repo.defaultBranch;
  const parent = branchHead(repo, branch);
  const parentTree = parent ? getObject(repo.objects, parent, "commit")?.tree : undefined;
  const files = parentTree ? flattenTree(repo.objects, parentTree) : new Map<string, FileEntry>();
  for (const [path, content] of Object.entries(change.files)) {
    if (content === null) files.delete(path);
    else files.set(path, { mode: "100644", sha: writeBlob(repo.objects, Buffer.from(content)).sha });
  }
  const signature = signatureOf(state, addUser(state, { login: repo.owner }));
  const commit = writeCommit(repo.objects, {
    tree: buildTree(repo.objects, files).sha,
    parents: parent ? [parent] : [],
    message: change.message,
    author: signature,
    committer: signature,
  });
  repo.refs.set(`heads/${branch}`, commit.sha);
  return commit.sha;
}

/** Every file on a branch, as text. */
export function readFiles(repo: FakeRepo, branch = repo.defaultBranch): Record<string, string> {
  const head = branchHead(repo, branch);
  const tree = head ? getObject(repo.objects, head, "commit")?.tree : undefined;
  const files: Record<string, string> = {};
  if (!tree) return files;
  for (const [path, { sha }] of flattenTree(repo.objects, tree)) {
    files[path] = getObject(repo.objects, sha, "blob")?.content.toString("utf8") ?? "";
  }
  return files;
}

export interface FakeCommitSummary {
  sha: string;
  message: string;
  parents: string[];
  author: Signature;
  /** What the commit changed relative to its first parent, by path. */
  files: { path: string; status: "added" | "modified" | "removed" }[];
}

/** A branch's history, newest first, following first parents. */
export function commitLog(repo: FakeRepo, branch = repo.defaultBranch): FakeCommitSummary[] {
  const log: FakeCommitSummary[] = [];
  let sha = branchHead(repo, branch);
  while (sha) {
    const commit = getObject(repo.objects, sha, "commit");
    if (!commit) break;
    const parent = commit.parents[0] ? getObject(repo.objects, commit.parents[0], "commit") : undefined;
    const before = parent ? flattenTree(repo.objects, parent.tree) : new Map<string, FileEntry>();
    const after = flattenTree(repo.objects, commit.tree);
    const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
    const files = paths.flatMap((path): FakeCommitSummary["files"] => {
      const old = before.get(path);
      const next = after.get(path);
      if (!old) return [{ path, status: "added" }];
      if (!next) return [{ path, status: "removed" }];
      return old.sha === next.sha ? [] : [{ path, status: "modified" }];
    });
    log.push({ sha: commit.sha, message: commit.message, parents: commit.parents, author: commit.author, files });
    sha = commit.parents[0];
  }
  return log;
}

// ---------------------------------------------------- Collaborators and invitations

/** Pending invitations expire after 7 days (GitHub: "Inviting collaborators to a personal repository"). */
export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function repoKey(repo: FakeRepo): string {
  return `${repo.owner}/${repo.name}`.toLowerCase();
}

export function isCollaborator(repo: FakeRepo, login: string): boolean {
  return repo.collaborators.has(login.toLowerCase());
}

export function addCollaborator(repo: FakeRepo, user: FakeUser): void {
  if (user.login.toLowerCase() !== repo.owner.toLowerCase()) repo.collaborators.set(user.login.toLowerCase(), user);
}

export function removeCollaborator(repo: FakeRepo, login: string): void {
  repo.collaborators.delete(login.toLowerCase());
}

export function invitationExpired(state: FakeState, invitation: FakeInvitation): boolean {
  return state.now() - invitation.createdAt >= INVITATION_LIFETIME_MS;
}

/** Open invitations to `repo`, oldest first. */
export function invitationsTo(state: FakeState, repo: FakeRepo): FakeInvitation[] {
  return [...state.invitations.values()].filter((invitation) => invitation.repo === repoKey(repo));
}

/** Open invitations addressed to `login`, oldest first. */
export function invitationsFor(state: FakeState, login: string): FakeInvitation[] {
  return [...state.invitations.values()].filter(
    (invitation) => invitation.invitee.login.toLowerCase() === login.toLowerCase(),
  );
}

/**
 * Invites `invitee` to collaborate on `repo`, as its owner does. Returns the
 * open invitation (the existing one if they were already invited and it hasn't
 * expired), or `null` when they already collaborate.
 */
export function inviteCollaborator(state: FakeState, repo: FakeRepo, invitee: FakeUser): FakeInvitation | null {
  if (isCollaborator(repo, invitee.login)) return null;
  const existing = invitationsTo(state, repo).find(
    (invitation) => invitation.invitee.login.toLowerCase() === invitee.login.toLowerCase(),
  );
  if (existing && !invitationExpired(state, existing)) return existing;
  if (existing) state.invitations.delete(existing.id);

  const id = state.nextId();
  const invitation: FakeInvitation = {
    id,
    nodeId: Buffer.from(`015:RepositoryInvitation${id}`).toString("base64"),
    repo: repoKey(repo),
    invitee,
    inviter: addUser(state, { login: repo.owner }),
    createdAt: state.now(),
  };
  state.invitations.set(id, invitation);
  return invitation;
}

/** The invitee accepts: they become a collaborator and the invitation closes. */
export function acceptInvitation(state: FakeState, invitation: FakeInvitation): void {
  const repo = state.repos.get(invitation.repo);
  if (repo) addCollaborator(repo, invitation.invitee);
  state.invitations.delete(invitation.id);
}
