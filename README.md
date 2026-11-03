# gh-notepad

An invite-only, local-first notepad: notes are Markdown files in GitHub repositories (notebooks) that each member owns or collaborates on. Everything is saved on the device first and synced to GitHub in the background. The v2 rebuild is planned in spec issue #1; vocabulary is in [`GLOSSARY.md`](GLOSSARY.md) and decisions in [`docs/adr/`](docs/adr/).

## Requirements

- Node.js 22.13 or later (CI and Vercel use Node 24).
- A GitHub OAuth App whose callback URL is `<NEXT_PUBLIC_APP_URL>/api/auth/callback`. The app requests the scopes `repo read:user` with PKCE.

## Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | The app's public origin, e.g. `https://notes.example.com` (`http://localhost:3000` in development). Cookies are `Secure` when it is `https`. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | The OAuth App's credentials. |
| `SESSION_SECRET` | At least 32 random characters; encrypts the session cookie. Changing it signs everyone out. |
| `OWNER_GITHUB_USER` | The owner's GitHub login; always allowed to sign in. Anyone the owner invites to one of their notebooks may sign in too, and their invitation is accepted as they do. |
| `ALLOWED_GITHUB_USERS` | Other logins allowed to sign in, comma-separated (case-insensitive). |
| `GITHUB_API_BASE_URL`, `GITHUB_OAUTH_BASE_URL` | Test-only: point the GitHub gateway at the fake GitHub. Leave unset in production. |

## Development

```bash
npm install
npm run dev        # http://localhost:3000, with the variables above in .env.local
```

To work without a real OAuth App, run the app against the fake GitHub: see [`test/fake-github/README.md`](test/fake-github/README.md#over-http-playwright-local-development).

## Installable app

Production builds register a service worker (`app/sw.ts`, bundled with esbuild by `@serwist/turbopack` in `app/serwist/[path]/route.ts` and served at `/serwist/sw.js`). It precaches the build's static assets and keeps the signed-in `/notes` shell, so the app opens with no network after one online visit; signing out forgets that shell. API routes (`/api/*`) never pass through its caches. Each new deployment waits behind a quiet "Update available" prompt until the member chooses Reload.

`npm run dev` runs without the service worker and unregisters one left behind by a local production build. The manifest is `app/manifest.ts`; `node scripts/generate-icons.mjs` redraws every icon from the landing page's wordmark.

## Checks

```bash
npm run typecheck  # route types, then tsc
npm run lint
npm test           # Vitest
npm run test:e2e   # Playwright: builds the app and starts it next to the fake GitHub
```

CI runs all four on every push (`.github/workflows/ci.yml`). Locally, Playwright reuses an app or fake GitHub already listening on ports 3100 and 4010; stop them to test a fresh build.
