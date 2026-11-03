import type { UserSeed } from "./state";

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
}

export function connectFakeGitHub(baseUrl: string): FakeGitHubControl {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, baseUrl), init);
    if (!response.ok) throw new Error(`Fake GitHub ${path} answered ${response.status}: ${await response.text()}`);
    return (await response.json()) as T;
  }

  return {
    addUser: (user) =>
      call("/_fake/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(user),
      }),
    accessTokensFor: (login) => call(`/_fake/users/${encodeURIComponent(login)}/tokens`),
  };
}
