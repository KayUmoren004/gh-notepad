# gh-notepad: agent guide

An invite-only, local-first notepad: notes are Markdown files in GitHub repositories (notebooks) the member owns or collaborates on, saved on the device first and synced in the background. Vocabulary is defined in `GLOSSARY.md`; use its terms in code, tests, issues and commits.

## Status: v2 rebuild in progress

The v1 app is being replaced, not extended. The plan is spec issue **#1** ("Spec: gh-notepad v2 rebuild") on `KayUmoren004/gh-notepad`; its sub-issues are the tickets, each listing the issues that block it. Before starting work:

1. Read the spec issue and your ticket (body and comments).
2. Pick a ticket whose blockers are all closed, and claim it with a comment.
3. Read the ADRs in `docs/adr/` that touch your area, and the cited sections of `docs/research/v2-technical-research.md`.

All v2 work lands on the integration branch `claude/brave-hypatia-a0ozpg`; it reaches `main` through one pull request.

## Commits

Commits are authored as the repository owner: the repo-local git config sets `Godson Umoren <umorenkaykay@gmail.com>`. Check it with `git config user.name` before your first commit in a fresh clone or worktree, and set it there if missing. Commit messages describe the change and end there: no `Co-Authored-By` trailers, session links, or tool attribution of any kind.

## Agent skills

### Issue tracker

GitHub Issues on this repo; specs are parent issues, tickets are sub-issues with a `## Blocked by` section. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Architecture (target)

The spec's Implementation Decisions section is the source of truth; in brief:

- **Notebook format**: pure parse/serialise of note files (Markdown + YAML frontmatter via `yaml`), titles as file names, v1 migration.
- **Device store**: IndexedDB per GitHub account, in-memory mirror for the UI, intent-level operations.
- **Sync engine**: single-flight background sync; conditional head polling, atomic Git Data API commits, line-based 3-way merge, conflict copies.
- **Remote → route handlers → GitHub gateway**: the browser never calls GitHub; the gateway owns all GitHub knowledge, and its base URLs are configurable for tests.
- **Fake GitHub**: the single test seam for anything touching GitHub, used in-process by unit tests and over HTTP by Playwright.

## Codebase conventions

- **Modules** live in `lib/<module>/`, named after the architecture above (`notebook-format`, `device-store`, `sync-engine`, `remote`, `github-gateway`, `auth`), with their public interface in `index.ts`. Callers and tests import the module, never its internal files. Server-only modules begin with `import "server-only"`.
- **Composition**: modules take their dependencies (`fetch`, clock, gateway) as arguments; a `…FromEnv(env, deps)` function wires them from environment variables, and route handlers are one-line adapters over it (see `app/api/auth/`).
- **Tests**: Vitest files are `*.test.ts` beside the code, run in the `node` environment with `fake-indexeddb` installed. Playwright specs are `e2e/*.spec.ts` importing `test` and `expect` from `e2e/support/fixtures.ts`, and run at desktop and phone sizes. Read `test/fake-github/README.md` before testing a GitHub call or adding a fake endpoint or seed data.
- **Service worker**: `app/sw.ts` caches code only (the precached build and the signed-in `/notes` shell) and leaves `/api/*` to the network. Playwright blocks it; offline specs opt in with `test.use({ serviceWorkers: "allow" })` and use `e2e/support/service-worker.ts`.
- **Styling**: `hover:` is gated to fine pointers, so an arbitrary `[&:hover]`-style variant bypasses the gate and fails `e2e/baseline.spec.ts`. Motion comes from the tokens and the `pressable` and `animate-enter` utilities in `app/globals.css`. Server Components take button styles from `components/ui/button-variants.ts`, because every export of a `"use client"` module is a client reference on the server.

## Code style

- TypeScript strict; `unknown` plus type guards instead of `any`; shared types live with the module that owns them.
- Functional React components under ~400 lines; shadcn/Base UI primitives from `components/ui/`; `cn()` for conditional classes.
- Tailwind spacing scale and semantic tokens from `app/globals.css`; no arbitrary values where a token exists.
- File names in kebab-case.
- Tests exercise behaviour through public interfaces at the agreed seams (sync engine with the fake GitHub, notebook format round trips, editor round trips, Playwright flows).

## Design

- Dark only: warm grays, soft contrast, minimal chrome; content gets the space.
- Motion follows Emil Kowalski's rules: strong ease-out curves from the motion tokens, UI animations under 300 ms, no animation on keyboard-initiated actions or the command palette, press feedback on pressables, origin-aware popovers, reduced-motion fallbacks.
- Mobile feels native: safe areas, `100dvh` shell, 16 px inputs, hover styles only for fine pointers, no tap highlight.
- Lists and labels survive worst-case data: long and non-Latin titles, emoji, deep folders, counts of 0 and 1, 1,000+ notes.

## Security

- The GitHub token lives only in the encrypted HTTP-only session cookie and is read server-side.
- Frontmatter is parsed as data with `yaml`; notes from shared notebooks are untrusted input.
- Validate paths and names on the server before they reach GitHub.
