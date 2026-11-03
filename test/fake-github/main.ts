/**
 * `npm run fake-github`: serves a fake GitHub over HTTP until stopped.
 *
 *   FAKE_GITHUB_PORT          port to listen on (default 4010)
 *   GITHUB_CLIENT_ID          OAuth App to register (the same values the app uses)
 *   GITHUB_CLIENT_SECRET
 *   FAKE_GITHUB_CALLBACK_URL  the OAuth App's callback URL (optional)
 *   FAKE_GITHUB_USERS         comma-separated logins to seed (optional)
 */
import { createFakeGitHub } from "./fake-github";
import { startFakeGitHubServer } from "./server";

const env = process.env;
const fake = createFakeGitHub();

fake.addOAuthApp({
  name: "gh-notepad (fake)",
  clientId: env.GITHUB_CLIENT_ID ?? "fake-client-id",
  clientSecret: env.GITHUB_CLIENT_SECRET ?? "fake-client-secret",
  callbackUrl: env.FAKE_GITHUB_CALLBACK_URL ?? null,
});
for (const login of (env.FAKE_GITHUB_USERS ?? "").split(",").map((value) => value.trim())) {
  if (login) fake.addUser({ login });
}

void startFakeGitHubServer({ port: Number(env.FAKE_GITHUB_PORT ?? 4010), fake }).then((server) => {
  console.log(`Fake GitHub listening on ${server.url}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void server.close().then(() => process.exit(0)));
  }
});
