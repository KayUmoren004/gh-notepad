# The fake GitHub

An in-memory GitHub for tests: the subset of github.com OAuth and the REST API that `lib/github-gateway` uses, answering a `Request` with a `Response`. It is the single test seam for anything that touches GitHub (spec #1, Testing Decisions). Unit tests inject it in-process; Playwright serves it over HTTP and points the app at it.

## Layout

| File | What it holds |
| --- | --- |
| `index.ts` | Public in-process API: `createFakeGitHub()` and its types. |
| `fake-github.ts` | Composes state and routes; seeding and inspection methods; the `routes` list. |
| `state.ts` | The in-memory world (users, OAuth apps, codes, tokens) and the functions that change it. |
| `router.ts` | `FakeRoute`, path matching, and response helpers (`json`, `apiError`, `html`). |
| `endpoints/*.ts` | One module per GitHub area, each exporting `FakeRoute[]`. |
| `endpoints/fake-only.ts` | Routes GitHub doesn't have, under `/_fake/`: the control API and avatar images. |
| `server.ts` | `startFakeGitHubServer()`: serves a fake over HTTP. |
| `client.ts` | `connectFakeGitHub(url)`: typed client for the `/_fake/` control API. |
| `main.ts` | `npm run fake-github`: the standalone server Playwright starts. |

## In-process (Vitest)

Create one fake per test, seed it, and hand its `fetch` to the code under test. The gateway's default base URLs (`https://github.com`, `https://api.github.com`) can stay as they are: the fake routes by path.

```ts
const github = createFakeGitHub();
const app = github.addOAuthApp({ callbackUrl: "https://notes.example/api/auth/callback" });
github.addUser({ login: "octo-member" });

const gateway = createGitHubGateway({ clientId: app.clientId, clientSecret: app.clientSecret, fetch: github.fetch });
```

Drive the parts a person does on github.com with the fake's methods, and observe GitHub's side of the world through them too:

- `authorize(authorizeUrl, { login })` approves the app as `login` and returns the URL GitHub redirects to (`code` and `state`); `authorize(url, "deny")` cancels.
- `accessTokensFor(login)` lists the tokens issued, e.g. to show a forged callback never reached the token exchange.
- `createFakeGitHub({ now })` takes a clock for code and token expiry.

`lib/auth/sign-in.test.ts` is the worked example.

## Over HTTP (Playwright, local development)

`playwright.config.ts` starts `npm run fake-github` on port 4010 and the app (a production build) on port 3100 with `GITHUB_API_BASE_URL` and `GITHUB_OAUTH_BASE_URL` pointing at it; `e2e/support/env.ts` holds those values. `main.ts` reads:

| Variable | Meaning |
| --- | --- |
| `FAKE_GITHUB_PORT` | Port to listen on (default 4010). |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | The OAuth App to register; use the app's values. |
| `FAKE_GITHUB_CALLBACK_URL` | The OAuth App's callback URL (optional). |
| `FAKE_GITHUB_USERS` | Comma-separated logins to seed at start (optional). |

End-to-end tests seed through the control API, using the `fakeGitHub` fixture from `e2e/support/fixtures.ts` (a `connectFakeGitHub` client). One server is shared by every test and both projects, so seed idempotently, never reset, and give tests their own data (their own users or repositories) when they would otherwise collide. The `signInAs(login)` fixture seeds the account and clicks through the fake's account chooser.

To develop against the fake instead of a real OAuth App, run `npm run fake-github` with `FAKE_GITHUB_USERS` set, and start `npm run dev` with the same `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` plus `GITHUB_API_BASE_URL=http://localhost:4010` and `GITHUB_OAUTH_BASE_URL=http://localhost:4010`.

## What it covers

| Endpoint | Behaviour |
| --- | --- |
| `GET /login/oauth/authorize` | Account chooser (one button per seeded user) standing in for GitHub's sign-in and consent. Checks `client_id`, `redirect_uri` against the callback URL (GitHub's host, port and sub-path rule) and PKCE parameters (`S256` only, 43 characters). |
| `POST /login/oauth/authorize` | The chooser's form: redirects with `code` and `state`, or `error=access_denied`. |
| `POST /login/oauth/access_token` | Form or JSON body; JSON reply when `Accept: application/json`, form-encoded otherwise. GitHub's error bodies with HTTP 200: `incorrect_client_credentials`, `redirect_uri_mismatch`, `bad_verification_code` (unknown, expired, reused, or wrong PKCE verifier). Codes are single-use and last 10 minutes. `gho_` tokens by default; `ghu_` (8 h) plus `ghr_` refresh tokens when the app has `expiringTokens` or the request asks for `offline_access`. |
| `GET /user` | The token's user, with `X-OAuth-Scopes`; 401 `Bad credentials` for a missing, unknown or expired token. |
| anything else | 404 with GitHub's `{ message: "Not Found" }` body. |
| `GET /_fake/health` | Readiness probe for Playwright. |
| `POST /_fake/users` | Seeds a user: `{ login, name? }`. |
| `GET /_fake/users/:login/tokens` | Access tokens issued to `login`. |
| `GET /_fake/avatars/:login` | The SVG that `avatar_url` points at, so runs never reach the internet. |

## Adding an endpoint

1. Find GitHub's real contract: the REST reference (or its OpenAPI description, `github/rest-api-description`) for paths, status codes, headers and payloads, and the docs for behaviour around them. The fake earns its keep by failing the way GitHub fails: same status, same error body, same quirks (such as OAuth errors arriving with a 200).
2. Add the state it needs to `FakeState` in `state.ts`, with the functions that change it there too, so endpoints, seeding methods and control routes share them.
3. Add a `FakeRoute` to the area's module in `endpoints/` (create one per area: `repos.ts`, `git-data.ts`, `collaborators.ts`, …) and register new modules in the `routes` list in `fake-github.ts`. Paths take `:name` segments and a trailing `*` (`/repos/:owner/:repo/contents/*` puts the rest in `params["*"]`). Use `authenticate(state, request)` for endpoints that need a token, `json()` for replies and `apiError(status, message)` for failures.
4. Test it in `fake-github.test.ts` through `github.fetch`, against literals from GitHub's documentation rather than values recomputed the way the fake computes them.

## Adding seed data

Add a seeding function to `state.ts` (idempotent where it can be, like `addUser`) and expose it on `FakeGitHub` in `fake-github.ts`. When end-to-end tests need it too, add a `/_fake/` control route in `endpoints/fake-only.ts` and a matching method on the client in `client.ts`.
