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
  /**
   * Seeds a repository, with an initial commit holding `files`, its `topics`
   * and `collaborators` (idempotent: an existing one is left as it is).
   */
  addRepo: (repo: RepoSeed) => Promise<{ full_name: string }>;
  /** Plays an edit made outside the app: commits `files` (`null` deletes) to the default branch, dated `date` (ISO 8601) or now. */
  commitFiles: (
    owner: string,
    name: string,
    change: { message: string; files: Record<string, string | null>; date?: string },
  ) => Promise<{ sha: string }>;
  /** Every file on the default branch, as text, by path. */
  files: (owner: string, name: string) => Promise<Record<string, string>>;
  /** One file on the default branch as bytes (an attachment), or `null` if there is none. */
  fileBytes: (owner: string, name: string, path: string) => Promise<Uint8Array | null>;
  /**
   * The owner of `owner/name` invites `invitee` (seeded if new). Idempotent:
   * the open invitation's id again, or `null` once they collaborate.
   */
  invite: (owner: string, name: string, invitee: string) => Promise<{ id: number | null }>;
  /** Logins with collaborator access to `owner/name`, the owner aside. */
  collaborators: (owner: string, name: string) => Promise<string[]>;
}

export function connectFakeGitHub(baseUrl: string): FakeGitHubControl {
  async function call<T>(path: string, init?: { method: "POST"; body: unknown }): Promise<T> {
    const response = await fetch(
      new URL(path, baseUrl),
      init && { method: init.method, headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) },
    );
    if (!response.ok) throw new Error(`Fake GitHub ${path} answered ${response.status}: ${await response.text()}`);
    return (await response.json()) as T;
  }
  const repoPath = (owner: string, name: string) => `/_fake/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  return {
    addUser: (user) => call("/_fake/users", { method: "POST", body: user }),
    accessTokensFor: (login) => call(`/_fake/users/${encodeURIComponent(login)}/tokens`),
    addRepo: (repo) => call("/_fake/repos", { method: "POST", body: repo }),
    commitFiles: (owner, name, change) => call(`${repoPath(owner, name)}/commits`, { method: "POST", body: change }),
    files: (owner, name) => call(`${repoPath(owner, name)}/files`),
    fileBytes: async (owner, name, path) => {
      const response = await fetch(new URL(`${repoPath(owner, name)}/file/${path.split("/").map(encodeURIComponent).join("/")}`, baseUrl));
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Fake GitHub file ${path} answered ${response.status}: ${await response.text()}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    invite: (owner, name, invitee) => call(`${repoPath(owner, name)}/invitations`, { method: "POST", body: { invitee } }),
    collaborators: (owner, name) => call(`${repoPath(owner, name)}/collaborators`),
  };
}
