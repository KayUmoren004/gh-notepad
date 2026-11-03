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

/** Allowed members whose personal notebooks are seeded with v1 data, one per Playwright project. */
export const v1Members: Record<string, string> = {
  desktop: "octo-v1-desktop",
  phone: "octo-v1-phone",
};

/**
 * Allowed members whose personal notebooks the app shell specs seed, one set
 * per Playwright project: `tree` holds a few nested folders, `big` over a
 * thousand notes with worst-case titles.
 */
export const shellMembers: Record<string, { tree: string; big: string }> = {
  desktop: { tree: "octo-tree-desktop", big: "octo-big-desktop" },
  phone: { tree: "octo-tree-phone", big: "octo-big-phone" },
};

/**
 * Allowed members whose personal notebooks the tags spec seeds with tagged
 * notes: one per test and Playwright project, since each test changes them.
 */
export const tagMembers: Record<string, { field: string; filter: string; layout: string }> = {
  desktop: { field: "octo-tags-field-desktop", filter: "octo-tags-filter-desktop", layout: "octo-tags-layout-desktop" },
  phone: { field: "octo-tags-field-phone", filter: "octo-tags-filter-phone", layout: "octo-tags-layout-phone" },
};

/**
 * Allowed members whose personal notebooks the search specs seed, one set per
 * Playwright project: `notes` a few notes with words to find, `big` over a
 * thousand notes to type against.
 */
export const searchMembers: Record<string, { notes: string; big: string }> = {
  desktop: { notes: "octo-search-desktop", big: "octo-search-big-desktop" },
  phone: { notes: "octo-search-phone", big: "octo-search-big-phone" },
};

/**
 * Two allowed members per Playwright project who share a browser in the sign-out
 * flows, so their notebooks are theirs alone. Neither login starts with the
 * other's: the fake's account chooser is searched by name.
 */
/** Allowed members whose personal notebooks the folder specs reorganise, one per Playwright project. */
export const folderMembers: Record<string, string> = {
  desktop: "octo-folders-desktop",
  phone: "octo-folders-phone",
};

export const signOutMembers: Record<string, { first: string; second: string }> = {
  desktop: { first: "octo-signout-one-desktop", second: "octo-signout-two-desktop" },
  phone: { first: "octo-signout-one-phone", second: "octo-signout-two-phone" },
};

/** Allowed members whose notes the share link spec publishes, one per Playwright project. */
export const shareMembers: Record<string, string> = {
  desktop: "octo-share-desktop",
  phone: "octo-share-phone",
};

/**
 * Allowed members whose personal notebooks the title spec uses, one per
 * Playwright project, so a re-title of a fresh note there is its own doing.
 */
export const titleMembers: Record<string, string> = {
  desktop: "octo-title-desktop",
  phone: "octo-title-phone",
};

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
  ALLOWED_GITHUB_USERS: [
    members.allowed,
    ...Object.values(v1Members),
    ...Object.values(shellMembers).flatMap(({ tree, big }) => [tree, big]),
    ...Object.values(tagMembers).flatMap(({ field, filter, layout }) => [field, filter, layout]),
    ...Object.values(searchMembers).flatMap(({ notes, big }) => [notes, big]),
    ...Object.values(folderMembers),
    ...Object.values(signOutMembers).flatMap(({ first, second }) => [first, second]),
    ...Object.values(titleMembers),
    ...Object.values(shareMembers),
  ].join(","),
  GITHUB_API_BASE_URL: fakeGitHubUrl,
  GITHUB_OAUTH_BASE_URL: fakeGitHubUrl,
  // Serves the component pages under /dev (the rich text mode harness) from the production build.
  ENABLE_DEV_ROUTES: "1",
};
