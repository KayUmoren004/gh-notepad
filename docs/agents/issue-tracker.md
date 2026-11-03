# Issue tracker: GitHub

Specs and tickets for this repo live as GitHub issues on `KayUmoren004/gh-notepad`. File issues only into this repo.

## Tooling

Use whichever GitHub tooling the session has:

- **`gh` CLI** (local sessions): `gh issue create|view|list|comment|edit|close`.
- **GitHub MCP tools** (Claude Code cloud sessions, where `gh` is limited to search): `issue_write` (create/update/close), `issue_read` (get, get_comments, get_sub_issues), `sub_issue_write` (attach a ticket to its spec), `add_issue_comment`.

## Conventions

- **Spec**: one parent issue holding the whole plan (the v2 spec is #1).
- **Ticket**: a sub-issue of its spec. Every open ticket is agent-ready by construction; the repo uses no triage labels.
- **Blocking**: every ticket body has a `## Blocked by` section listing the issue numbers that gate it (or "None"). That section is authoritative; native GitHub dependencies may mirror it when tooling allows. A ticket is startable when every issue it lists is closed.
- **Claim**: assign yourself, or comment `Claimed by <agent/session>` before starting, so two agents don't take the same ticket.
- **Close**: comment what landed (commit SHAs, anything deferred), then close as completed. Closing is how work is marked done; the next frontier is every open ticket whose blockers are all closed.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read the issue body and its comments.
