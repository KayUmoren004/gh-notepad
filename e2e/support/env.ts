/**
 * The world end-to-end tests run in: the app (a production build) and the
 * fake GitHub it is pointed at, each on its own port. `E2E_APP_PORT` and
 * `E2E_FAKE_GITHUB_PORT` move them, so checkouts side by side don't reuse
 * each other's servers.
 */

export const appUrl = `http://localhost:${process.env.E2E_APP_PORT ?? 3100}`;
export const fakeGitHubUrl = `http://localhost:${process.env.E2E_FAKE_GITHUB_PORT ?? 4010}`;

/** GitHub logins with a known place at the access gate. */
export const members = {
  owner: "octo-owner",
  allowed: "octo-member",
  /** Not on the allow list: gets the invite-only screen. */
  stranger: "octo-stranger",
} as const;

const oauthApp = {
  GITHUB_CLIENT_ID: "e2e-client-id",
  GITHUB_CLIENT_SECRET: "e2e-client-secret",
};

/** Environment for `npm run fake-github`. */
export const fakeGitHubEnv = {
  ...oauthApp,
  FAKE_GITHUB_PORT: new URL(fakeGitHubUrl).port,
  FAKE_GITHUB_CALLBACK_URL: `${appUrl}/api/auth/callback`,
};

/** Environment for the app under test. */
export const appEnv = {
  ...oauthApp,
  NEXT_PUBLIC_APP_URL: appUrl,
  SESSION_SECRET: "e2e-session-secret-that-is-at-least-32-characters",
  OWNER_GITHUB_USER: members.owner,
  ALLOWED_GITHUB_USERS: members.allowed,
  GITHUB_API_BASE_URL: fakeGitHubUrl,
  GITHUB_OAUTH_BASE_URL: fakeGitHubUrl,
  // Serves the component pages under /dev (the rich text mode harness) from the production build.
  ENABLE_DEV_ROUTES: "1",
};
