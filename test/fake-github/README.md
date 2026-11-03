# The fake GitHub

An in-memory GitHub for tests: the subset of github.com OAuth and the REST API that `lib/github-gateway` uses, answering a `Request` with a `Response`. It is the single test seam for anything that touches GitHub (spec #1, Testing Decisions). Unit tests inject it in-process; Playwright serves it over HTTP and points the app at it.

## Layout

| File | What it holds |
| --- | --- |
| `index.ts` | Public in-process API: `createFakeGitHub()` and its types. |
| `fake-github.ts` | Composes state and routes; seeding and inspection methods; the `routes` list. |
| `state.ts` | The in-memory world (users, OAuth apps, codes, tokens, repositories, the request log) and the functions that change it. |
| `git.ts` | Git's object model: blobs, trees and commits under the SHA-1 git itself computes, tree building and flattening, ancestry. |
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
- `createFakeGitHub({ now })` takes a clock for code, token and invitation expiry.

Notebooks and Git data:

- `addRepo({ owner, name, private?, files?, topics?, collaborators? })` seeds a repository (private by default) with an initial commit holding `files`, or empty without them; its `collaborators` have already accepted.
- `commitFiles(owner, name, { message, files })` plays an edit made outside the app (on github.com, another editor): one commit on the default branch, where a `null` content deletes the path.
- `files(owner, name)` reads every file on the default branch; `commits(owner, name)` lists its history, newest first, with the paths each commit `added`, `modified` or `removed`; `repo(owner, name)` returns the repository record.
- `invite(owner, name, invitee)` plays the owner inviting someone to collaborate; `collaborators(owner, name)` and `invitations(owner, name)` show who has access and who is still invited.
- `requests()` lists every GitHub request answered (`{ method, path, status }`, control routes aside), e.g. to show an unchanged notebook costs one `304`, or that a route refused a bad name before asking GitHub.
- `issueAccessToken(login)` hands out a token without the OAuth dance, for tests that call the REST API directly; `revokeAccessTokens(login)` plays the member revoking the app on github.com, after which every REST request with one of their tokens answers 401 `Bad credentials`.

`lib/auth/sign-in.test.ts` is the worked example for sign-in (the access gate's invitation path included), and `lib/github-gateway/shared-notebooks.test.ts` for collaborators and invitations. For anything that syncs, use `createWorld()` from `test/devices.ts`: it runs the real auth and notebook routes against a fake, and `signIn(login)` returns a simulated device (its own IndexedDB and cookies) with the real device store, remote and sync engine. `holdGitHub(match)` pauses a request on its way to GitHub so a test can act while it is in flight; `callApi(path, { as })` calls the notebook routes directly. `lib/sync-engine/sync-engine.test.ts` is the worked example.

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
| any REST endpoint | 401 `Bad credentials` when the request carries an unknown, revoked or expired token, as on GitHub. |
| `GET /user` | The token's user, with `X-OAuth-Scopes`; 401 `Bad credentials` for a missing token too. |
| `GET /repos/:owner/:repo` | The repository, with the caller's own `permissions`; 404 for a private one they neither own nor collaborate on. |
| `POST /user/repos` | Creates a repository for the token's user; `auto_init` adds an initial commit with `README.md`. 422 `name already exists on this account` when taken. |
| `GET /repos/:owner/:repo/commits/:ref` | With `Accept: application/vnd.github.sha`: just the SHA, `ETag: "<sha>"`, and `304` when `If-None-Match` names it. 409 on an empty repository. |
| `GET /repos/:owner/:repo/git/ref/heads/:branch`, `PATCH …/git/refs/heads/:branch` | Read and move a branch. Without `force`, a commit that doesn't descend from the branch gets 422 `Update is not a fast forward`. |
| `GET`/`POST /repos/:owner/:repo/git/blobs` | Blobs as base64 wrapped at 60 characters; create from `utf-8` or `base64`. |
| `GET`/`POST /repos/:owner/:repo/git/trees` | `GET` takes a tree SHA, commit SHA or branch name, with `?recursive=1`. `POST` takes `base_tree` and entries with `content`, `sha`, or `sha: null` to delete (422 for a path the base doesn't have); empty directories vanish. |
| `GET`/`POST /repos/:owner/:repo/git/commits` | Commit objects; the author defaults to the token's user and their no-reply address. |
| Git Data on an empty repository | 409 `Git Repository is empty.` |
| `GET /users/:username` | A user's public profile; 404 for an unknown login. |
| `GET /user/repos` | Repositories the token's user owns or collaborates on (`affiliation`, `visibility`; `type` with either is a 422), by full name, with `topics` and the caller's own `permissions`. |
| `GET`, `PUT /repos/:owner/:repo/topics` | `{ names }`. `PUT` replaces them, saved lowercase; owner only (403 for collaborators); 422 for a topic GitHub refuses. |
| `GET /repos/:owner/:repo/collaborators` | The owner (`role_name: admin`) and every collaborator (`write`), for anyone who can push. `GET …/:username` answers 204 or 404. |
| `PUT /repos/:owner/:repo/collaborators/:username` | Owner only (403 otherwise): 201 with a new invitation (or the open one again), 204 if they already collaborate, 404 for an unknown login, 422 for the owner. |
| `DELETE /repos/:owner/:repo/collaborators/:username` | The owner removes anyone; a collaborator only themselves (leaving); 403 otherwise. |
| `GET /repos/:owner/:repo/invitations`, `DELETE …/:id` | Owner only: the open invitations, and cancelling one. |
| `GET /user/repository_invitations` | The token's user's open invitations, `expired` after 7 days. As on GitHub, the nested `repository` is the minimal one, without `topics`. |
| `PATCH`, `DELETE /user/repository_invitations/:id` | Accepts (the invitee becomes a collaborator) or declines; 404 for someone else's invitation and, an assumption GitHub doesn't document, for accepting an expired one. |
| lists | Paged like GitHub: `per_page` (default 30, at most 100) and `page`, with a `Link` header (`prev`, `next`, `last`, `first`). |
| anything else | 404 with GitHub's `{ message: "Not Found" }` body. |
| `GET /_fake/health` | Readiness probe for Playwright. |
| `POST /_fake/users` | Seeds a user: `{ login, name? }`. |
| `GET /_fake/users/:login/tokens` | Access tokens issued to `login`. |
| `POST /_fake/repos` | Seeds a repository: `{ owner, name, private?, files?, topics?, collaborators? }` (idempotent). |
| `POST /_fake/repos/:owner/:repo/commits` | An outside edit: `{ message, files }`, `null` deleting a path. |
| `GET /_fake/repos/:owner/:repo/files` | Every file on the default branch, by path. |
| `POST /_fake/repos/:owner/:repo/invitations` | The owner invites `{ invitee }`: `{ id }` of the open invitation, or `{ id: null }` once they collaborate. |
| `GET /_fake/repos/:owner/:repo/collaborators` | Collaborators' logins, the owner aside. |
| `GET /_fake/avatars/:login` | The SVG that `avatar_url` points at, so runs never reach the internet. |

## Adding an endpoint

1. Find GitHub's real contract: the REST reference (or its OpenAPI description, `github/rest-api-description`) for paths, status codes, headers and payloads, and the docs for behaviour around them. The fake earns its keep by failing the way GitHub fails: same status, same error body, same quirks (such as OAuth errors arriving with a 200).
2. Add the state it needs to `FakeState` in `state.ts`, with the functions that change it there too, so endpoints, seeding methods and control routes share them.
3. Add a `FakeRoute` to the area's module in `endpoints/` (create one per area: `repos.ts`, `git-data.ts`, `collaborators.ts`, …) and register new modules in the `routes` list in `fake-github.ts`. Paths take `:name` segments and a trailing `*` (`/repos/:owner/:repo/contents/*` puts the rest in `params["*"]`). Use `authenticate(state, request)` for endpoints that need a token, `json()` for replies and `apiError(status, message)` for failures.
4. Test it in `fake-github.test.ts` through `github.fetch`, against literals from GitHub's documentation rather than values recomputed the way the fake computes them.

## Adding seed data

Add a seeding function to `state.ts` (idempotent where it can be, like `addUser`) and expose it on `FakeGitHub` in `fake-github.ts`. When end-to-end tests need it too, add a `/_fake/` control route in `endpoints/fake-only.ts` and a matching method on the client in `client.ts`.
