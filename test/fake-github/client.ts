import type { RepoSeed, UserSeed } from "./state";

/**
 * Seeds and inspects a fake GitHub served over HTTP, through its `/_fake/`
 * control API. End-to-end tests use this; unit tests call the in-process
 * `FakeGitHub` directly instead.
 */
export interface FakeGitHubControl {
  /** Seeds a GitHub account (idempotent). */
  addUser: (user: UserSeed) => Promise<{ login: string; id: number }>;
  /** Every access token issued to `login`, oldest first. */
  accessTokensFor: (login: string) => Promise<string[]>;
  /** Seeds a repository and its owner; one that exists is left as it is. */
  addRepo: (repo: RepoSeed) => Promise<{ owner: string; name: string }>;
  /**
   * The owner of `owner/name` invites `invitee` (seeded if new). Idempotent:
   * the open invitation's id again, or `null` once they collaborate.
   */
  invite: (owner: string, name: string, invitee: string) => Promise<{ id: number | null }>;
  /** Logins with collaborator access to `owner/name`, the owner aside. */
  collaborators: (owner: string, name: string) => Promise<string[]>;
}

export function connectFakeGitHub(baseUrl: string): FakeGitHubControl {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, baseUrl), init);
    if (!response.ok) throw new Error(`Fake GitHub ${path} answered ${response.status}: ${await response.text()}`);
    return (await response.json()) as T;
  }

  const post = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const repoPath = (owner: string, name: string) =>
    `/_fake/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  return {
    addUser: (user) => call("/_fake/users", post(user)),
    accessTokensFor: (login) => call(`/_fake/users/${encodeURIComponent(login)}/tokens`),
    addRepo: (repo) => call("/_fake/repos", post(repo)),
    invite: (owner, name, invitee) => call(`${repoPath(owner, name)}/invitations`, post({ invitee })),
    collaborators: (owner, name) => call(`${repoPath(owner, name)}/collaborators`),
  };
}
