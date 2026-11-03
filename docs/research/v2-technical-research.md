# gh-notepad v2: technical research

## Summary of recommendations

1. **Editor:** Use Tiptap 3.32 with `@tiptap/markdown`, gated by a GFM round-trip fixture suite. The Markdown package is still labelled beta. If that suite fails, fall back to Milkdown 7.23, whose remark pipeline gives better fidelity.
2. **Source mode:** Use plain CodeMirror 6 with `markdown({ base: markdownLanguage })` from `@codemirror/lang-markdown` 6.5.2. Apply remote merges as minimal changes. `@uiw/react-codemirror` replaces the whole document whenever `value` changes.
3. **Commits:** Use the Git Data API: blobs, then a tree with `base_tree` and `sha: null` for deletes, then a commit, then `PATCH` the ref with `force: false`. A `422` "Update is not a fast forward" means someone else pushed: merge and retry.
4. **Change polling:** Call `GET /repos/{o}/{r}/commits/{branch}` with `Accept: application/vnd.github.sha` and the last known SHA as the ETag. An authenticated `304` costs no primary rate limit.
5. **History:** Use `GET /commits?path=` (it has no rename-following option), `GET /contents/{path}?ref={sha}` with the raw media type, and a local diff. Commit data never changes, so cache it permanently.
6. **Shared notebooks:** Invite with `PUT /collaborators/{user}`. On personal repos every collaborator gets read/write access. The invitee accepts with `PATCH /user/repository_invitations/{id}`. Discover notebooks via `/user/repos?affiliation=owner,collaborator` filtered by `topics`. Request `repo` scope.
7. **Share links:** Prefer our own snapshot storage (Vercel Blob plus a random ID) over secret gists. Gists can't take binary files via the API, need the extra `gist` scope, and anonymous reads are limited to 60 per hour per IP.
8. **OAuth:** Use PKCE (`S256`, now supported for OAuth Apps) plus `state`. Opt in to expiring tokens (8 h access, 6-month refresh). Request scopes `repo read:user`, plus `gist` only if we use gists.
9. **PWA:** Use Serwist through `@serwist/turbopack` 9.5.13 (experimental), or Serwist's configurator mode. Don't use the `@serwist/next` plugin: it is webpack-only and Next 16 builds with Turbopack by default.
10. **Platform and tooling:** Next 16.4: `proxy.ts`, async `cookies()`/`params`, `viewport.themeColor`. Use Node 24, because iron-session 9 needs Node 22.13 or later, and Vitest 5 and MSW 3 need Node 22.12 or later. Use Dexie 4, `fake-indexeddb`, MSW 3 with `@msw/serve`, `node-diff3` (pass it line arrays), `diff` 9, `yaml` (not gray-matter, which `eval`s `---js` front matter), and MiniSearch 7.

---

## Method and versions checked

- **Date:** research done 2026-11-03. Versions come from the npm registry `latest` dist-tag that day (`https://registry.npmjs.org/<pkg>`).
- **Blocked hosts:** this sandbox blocks docs.github.com, nextjs.org, tiptap.dev, milkdown.dev, serwist.pages.dev, vercel.com, mswjs.io, vitest.dev, playwright.dev and codemirror.net. Each of these docs sites publishes its source on GitHub, so I read the source instead:
  - [github/docs](https://github.com/github/docs) at `7fa55a0`, 2026-11-02;
  - the REST OpenAPI description in [github/rest-api-description](https://github.com/github/rest-api-description/blob/main/descriptions/api.github.com/api.github.com.json), which generates every docs.github.com REST reference page;
  - [vercel/next.js](https://github.com/vercel/next.js/tree/v16.4.4/docs) at tag `v16.4.4`;
  - [ueberdosis/tiptap-docs](https://github.com/ueberdosis/tiptap-docs) at `e6517b9`;
  - [Milkdown/website](https://github.com/Milkdown/website);
  - [serwist/serwist](https://github.com/serwist/serwist);
  - [mswjs/mswjs.io](https://github.com/mswjs/mswjs.io);
  - [vitest-dev/vitest](https://github.com/vitest-dev/vitest);
  - [microsoft/playwright](https://github.com/microsoft/playwright).

  Links below point to the canonical rendered page wherever the source-to-URL mapping is certain.
- **Package code:** READMEs, type definitions and built code were read from the published npm tarballs.
- **Bundle sizes:** sizes marked "measured" are `gzip -9` of the published file. bundlephobia was unreachable.
- **Inferences:** anything not stated by a source is marked **(inference)**.

| Package | Version | Published |
|---|---|---|
| next | 16.4.4 | 2026-11-02 |
| @tiptap/react, @tiptap/markdown, @tiptap/starter-kit | 3.32.2 | 2026-10-30 |
| @milkdown/kit, @milkdown/crepe, @milkdown/react | 7.23.0 | 2026-10-27 |
| @codemirror/lang-markdown / @lezer/markdown / codemirror | 6.5.2 / 1.8.1 / 6.0.2 | 2026-08-04 / - / 2025-06-19 |
| @uiw/react-codemirror | 4.25.12 | 2026-09-24 |
| @serwist/turbopack, @serwist/next, serwist | 9.5.13 (10.0.0-preview.14 on `preview`) | 2026-10-04 |
| @vercel/blob | 2.8.2 | 2026-10-14 |
| idb / dexie / fake-indexeddb | 8.0.4 / 4.4.7 / 6.2.7 | 2026-10-06 / 2026-10-19 / 2026-10-30 |
| vitest / @playwright/test / msw / @msw/serve | 5.1.0 / 1.64.1 / 3.0.3 / 0.11.0 | 2026-11-02 / 2026-10-14 / 2026-10-10 / 2026-09-28 |
| node-diff3 / diff | 3.2.1 / 9.0.0 | 2026-06-03 / 2026-04-13 |
| iron-session / jose | 9.0.1 / 6.2.15 | 2026-08-30 / 2026-11-01 |
| gray-matter / yaml | 4.0.3 / 2.9.1 | 2021-04-24 / 2026-09-11 |
| minisearch / flexsearch / @orama/orama | 7.2.0 / 0.8.212 / 3.1.18 | 2025-09-16 / 2025-09-06 / 2025-12-19 |

---

## 1. Rich-text editor that round-trips GFM

### Findings: Tiptap v3 with `@tiptap/markdown`

- **Packages and status**
  - The package is `@tiptap/markdown` 3.32.2. Its peers are `@tiptap/core` and `@tiptap/pm` at the same version, and it depends on `marked ^17.0.1` ([npm](https://www.npmjs.com/package/@tiptap/markdown/v/3.32.2)).
  - The docs tag it **beta**: "The markdown extension is a early release and can be subject to change or may have edge cases that may not be supported yet" ([tiptap.dev/docs/editor/markdown](https://tiptap.dev/docs/editor/markdown)).
- **Architecture:** the MarkedJS lexer produces tokens, each extension's parse handler turns them into Tiptap JSON, and each extension's `renderMarkdown` turns JSON back into a Markdown string ([docs](https://tiptap.dev/docs/editor/markdown)).
- **API** ([installation](https://tiptap.dev/docs/editor/markdown/getting-started/installation), [basic usage](https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage)):
  - `new Editor({ extensions: [StarterKit, Markdown], content, contentType: 'markdown' })`
  - `editor.getMarkdown()`
  - `setContent` / `insertContent` / `insertContentAt` all accept `{ contentType: 'markdown' }`. Without it, a string is parsed as HTML.
  - `Markdown.configure({ indentation: { style: 'space' | 'tab', size }, markedOptions: { gfm: true } })`
- **GFM coverage**
  - StarterKit 3 bundles blockquote, bold, code, code-block, hard-break, heading, horizontal-rule, italic, link, list, strike, underline and more ([starter-kit package.json](https://github.com/ueberdosis/tiptap/tree/main/packages/starter-kit)).
  - Strikethrough serializes as `~~text~~` ([extension-strike](https://github.com/ueberdosis/tiptap/tree/main/packages/extension-strike)).
  - Code blocks serialize as fenced blocks with the language as the info string ([extension-code-block](https://github.com/ueberdosis/tiptap/tree/main/packages/extension-code-block)).
  - Tables come from `@tiptap/extension-table`, which has its own `markdownTokenizer` and a `renderMarkdown` that supports column alignment ([extension-table](https://github.com/ueberdosis/tiptap/tree/main/packages/extension-table)).
  - Task items in `@tiptap/extension-list` serialize as `- [x] ` / `- [ ] ` ([extension-list](https://github.com/ueberdosis/tiptap/tree/main/packages/extension-list)).
  - The docs' GFM example registers the Table, TableRow, TableCell, TableHeader, TaskList and TaskItem extensions together with `markedOptions: { gfm: true }` ([basic usage](https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage)).
- **Known round-trip losses**
  - Documented: comments are not supported, and a table cell may hold only one child node ([docs, Limitations](https://tiptap.dev/docs/editor/markdown)).
  - The table renderer joins multi-block cells using a `cellLineSeparator` option (extension-table source).
  - Underline serializes as raw `<u>…</u>` HTML, which is not GFM ([extension-underline](https://github.com/ueberdosis/tiptap/tree/main/packages/extension-underline)).
  - Recent changelog entries show the serializer is still settling ([CHANGELOG](https://github.com/ueberdosis/tiptap/blob/main/packages/markdown/CHANGELOG.md)):
    - it now backslash-escapes `* _ \` [ ] \ ~` in plain text;
    - it writes runs of empty paragraphs as `&nbsp;`;
    - it fixed blank lines being dropped on every parse/serialize cycle;
    - it fixed nesting of overlapping bold and italic;
    - it fixed handling of HTML entities.
  - **(inference)** The serializer writes its own canonical syntax (bullet marker, fence style, escapes), so an untouched note can come out with different bytes.
- **React 19 and Next SSR**
  - `@tiptap/react` 3.32.2 has peer dependencies `react` and `react-dom` `^17 || ^18 || ^19` ([npm](https://www.npmjs.com/package/@tiptap/react/v/3.32.2)).
  - The Next.js guide uses `'use client'` and `useEditor({ …, immediatelyRender: false })`, which "prevents the editor from rendering on the server, which avoids React hydration mismatch errors" ([tiptap.dev/docs/editor/getting-started/install/nextjs](https://tiptap.dev/docs/editor/getting-started/install/nextjs)).
- **Notion-like building blocks:** `@tiptap/extension-drag-handle-react`, `@tiptap/suggestion` (for slash menus), `@tiptap/extension-unique-id` and `@tiptap/extension-file-handler` are all MIT-licensed, version 3.32.2, on npm ([npm: drag-handle-react](https://www.npmjs.com/package/@tiptap/extension-drag-handle-react)).

### Findings: Milkdown 7

- **Packages:** `@milkdown/kit`, `@milkdown/crepe` and `@milkdown/react` are all at 7.23.0. `@milkdown/react` has peer dependencies `react: *` and `react-dom: *` ([npm](https://www.npmjs.com/package/@milkdown/kit)).
- **Markdown-native pipeline:** `@milkdown/core` uses `unified ^11`, `remark-parse ^11` and `remark-stringify ^11`. `@milkdown/preset-gfm` uses `remark-gfm ^4.0.1`, the same parser v1 already uses with react-markdown ([npm @milkdown/core](https://www.npmjs.com/package/@milkdown/core), [npm @milkdown/preset-gfm](https://www.npmjs.com/package/@milkdown/preset-gfm)).
- **GFM coverage** ([preset-gfm API](https://github.com/Milkdown/milkdown/blob/main/docs/api/preset-gfm.md), [preset-commonmark API](https://github.com/Milkdown/milkdown/blob/main/docs/api/preset-commonmark.md)):
  - tables (with `setAlignCommand`), task lists, strikethrough and footnotes, via `footnoteDefinitionSchema` and `footnoteReferenceSchema`;
  - raw HTML is kept as an `html` node by the commonmark preset.
- **Output control:** `remarkStringifyOptionsCtx` sets options such as `bullet`, `fences` and `incrementListMarker`. remark-stringify writes a normalized form, so this option set is what controls the output ([FAQ](https://github.com/Milkdown/website/blob/main/docs/guide/faq.md)).
- **Getting Markdown out:** `crepe.getMarkdown()`, or the listener plugin's `markdownUpdated(ctx, markdown, prev)` ([FAQ](https://github.com/Milkdown/website/blob/main/docs/guide/faq.md)).
- **Crepe** is the batteries-included editor ([using-crepe](https://github.com/Milkdown/website/blob/main/docs/guide/using-crepe.md), [crepe API](https://github.com/Milkdown/milkdown/blob/main/docs/api/crepe.md)):
  - features include CodeMirror code blocks, Table, ImageBlock, BlockEdit, Toolbar, LinkTooltip and Latex;
  - it ships its own theme CSS (`@milkdown/crepe/theme/common/style.css`, `frame.css`).
  - **(inference)** Matching our shadcn/Tailwind tokens therefore means overriding Crepe's CSS.
- **SSR:** "Milkdown relies on DOM APIs and cannot run on the server". Create it inside `'use client'` plus `useEffect` and destroy it on unmount ([FAQ](https://github.com/Milkdown/website/blob/main/docs/guide/faq.md), [Next.js recipe](https://github.com/Milkdown/website/blob/main/docs/recipes/nextjs.md)).

### Recommendation

Use **Tiptap 3 with `@tiptap/markdown`**:

- It is headless and React-first, so it fits shadcn/Base UI.
- Its open-source building blocks (drag handle, suggestion) cover the Notion-like UX.
- Its API (`contentType: 'markdown'`, `getMarkdown()`) is small and well documented, which helps AI agents implement it.

Fidelity is the risk, so make it a gate:

- Build a fixture corpus (GFM tables with alignment, nested and task lists, fences with info strings, escapes, HTML, frontmatter-free bodies).
- CI asserts that `serialize(parse(x))` is idempotent after one normalization pass.
- Only write a note back to GitHub when the user actually edited it. Never re-serialize on open.

If the corpus fails in ways we can't fix with custom `renderMarkdown`, switch to **Milkdown**: its remark/micromark pipeline gives higher fidelity, including footnotes and raw HTML.

## 2. CodeMirror 6 for Markdown source mode

### Findings

- **Packages:**
  - `codemirror` 6.0.2 provides `basicSetup` and `EditorView`.
  - `@codemirror/lang-markdown` 6.5.2 provides `markdown(config)`.
  - Its `base` option "Defaults to `commonmarkLanguage`". `markdownLanguage` is "Language support for GFM plus subscript, superscript, and emoji syntax".
  - Code-block highlighting comes from `codeLanguages`, typically fed from `@codemirror/language-data` 6.5.2 ([npm README](https://www.npmjs.com/package/@codemirror/lang-markdown/v/6.5.2)).
  - The repositories have moved to `code.haverbeke.berlin`, according to the npm `repository` field.
- **GFM parsing:** `@lezer/markdown` 1.8.1 exports a `GFM` bundle of `Table`, `TaskList`, `Strikethrough` and `Autolink` ([npm README](https://www.npmjs.com/package/@lezer/markdown)).
- **`@uiw/react-codemirror` 4.25.12**
  - Peer dependencies are `react >=17`, `codemirror`, `@codemirror/state` and `@codemirror/view` ([npm](https://www.npmjs.com/package/@uiw/react-codemirror/v/4.25.12)).
  - When the `value` prop changes from outside, it dispatches `{ changes: { from: 0, to: doc.length, insert: value } }`, replacing the whole document ([src/useCodeMirror.ts](https://github.com/uiwjs/react-codemirror/blob/master/core/src/useCodeMirror.ts)).
  - **(inference)** That resets the selection and undo granularity whenever a sync merge lands.

### Recommendation

Write a small `'use client'` wrapper around plain `EditorView` (useRef plus useEffect):

- Configure it with `extensions: [basicSetup, markdown({ base: markdownLanguage, codeLanguages: languages })]`.
- Keep one `EditorState` per note.
- Apply remote merges as minimal `ChangeSpec`s computed with jsdiff, so the cursor and undo history survive.

`@uiw/react-codemirror` is fine for a first prototype.

## 3. Atomic multi-file commit via the Git Data API

### Findings

The sequence below follows the [Git database guide](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database). All parameter names come from the OpenAPI spec.

1. **Get the ref:** `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` returns `object.sha`, which becomes the parent commit.
   - It returns `404` if the ref doesn't exist ([refs](https://docs.github.com/en/rest/git/refs#get-a-reference)).
   - The Git DB API returns `409 Conflict` on an empty repository ([guide](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database)). Create notebook repos with `auto_init: true` ([create repo](https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user)).
2. **Get the commit:** `GET /repos/{owner}/{repo}/git/commits/{commit_sha}` returns `tree.sha`, which becomes `base_tree` ([commits](https://docs.github.com/en/rest/git/commits#get-a-commit-object)).
3. **Create blobs:** `POST /repos/{owner}/{repo}/git/blobs` with `{ content, encoding }`, where `encoding` is `"utf-8"` (the default) or `"base64"`. Use base64 for images. It returns `201` with a `sha` ([blobs](https://docs.github.com/en/rest/git/blobs#create-a-blob)).
4. **Create the tree:** `POST /repos/{owner}/{repo}/git/trees` with `{ base_tree, tree: [{ path, mode, type, sha | content }] }` ([trees](https://docs.github.com/en/rest/git/trees#create-a-tree)).
   - `mode` is one of `100644`, `100755`, `040000`, `160000` or `120000`. `type` is `blob`, `tree` or `commit`.
   - **Delete** a file with `sha: null`. It is an error to delete a file that doesn't exist.
   - For text files, `content` can replace a separate blob call: "GitHub will write this blob out and use that SHA". Sending both `sha` and `content` is an error.
   - Without `base_tree`, every file not listed in `tree` is deleted.
   - **Rename** (inference from the above): add the new path with the existing blob `sha` and set the old path's `sha` to `null`, in the same tree.
5. **Create the commit:** `POST /repos/{owner}/{repo}/git/commits` with `{ message, tree, parents: [parentSha], author?, committer? }` returns `201` ([commits](https://docs.github.com/en/rest/git/commits#create-a-commit)).
6. **Update the ref:** `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}` with `{ sha, force: false }`. Leaving `force` out or setting it to `false` "will make sure you're not overwriting work". Documented responses are `200`, `409` and `422` ([refs](https://docs.github.com/en/rest/git/refs#update-a-reference)).

**Detecting a concurrent push:**

- When the ref moved, the fast-forward check fails with **`422`** and the message **`"Update is not a fast forward"`**.
- GitHub's own CLI branches on exactly that message after calling this endpoint ([cli/cli `pkg/cmd/repo/sync`](https://github.com/cli/cli/blob/c4513d446bf98cfcbe72ed83f17cd3220174d88f/pkg/cmd/repo/sync/sync.go)). The OpenAPI only says "Validation failed".
- **(inference)** The check is about ancestry, not compare-and-swap. A ref that was force-moved *backward* to an ancestor of our parent would still accept our commit.
- The orphaned blobs, trees and commits from a failed attempt are harmless.

**Limits:**

- `GET /git/blobs/{sha}` "supports blobs up to 100 megabytes" ([blobs](https://docs.github.com/en/rest/git/blobs#get-a-blob)).
- Pushes are blocked for files over 100 MiB and get a warning over 50 MiB. Repos should ideally stay under 1 GB, and under 5 GB is "strongly recommended" ([about large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)).
- With `recursive`, `GET /git/trees/{sha}` is capped at "100,000 entries with a maximum size of 7 MB". Beyond that it sets `truncated: true`, and you must walk subtrees non-recursively ([trees](https://docs.github.com/en/rest/git/trees#get-a-tree)).
- Contents API ([contents](https://docs.github.com/en/rest/repos/contents#get-repository-content)):
  - files of 1 MB or less: all features;
  - 1–100 MB: only the `raw` and `object` media types work, and `object` returns empty `content` with `encoding: "none"`;
  - over 100 MB: not supported;
  - directory listings stop at 1,000 entries.
- `PUT` and `DELETE` contents calls made in parallel conflict, and must be run one at a time ([create or update file](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)). This is another reason to use the Git Data API for batches.

### Recommendation

Implement one `commitChanges(base, changes[])` server function that runs steps 1–6:

- Inline `content` for Markdown files and use blobs only for binary attachments. This cuts write requests, which matters under the secondary limits in §4 (inference).
- On `422` "not a fast forward": re-fetch the ref, three-way merge each conflicting note (§12), rebuild the tree on the new base, and retry with capped attempts.
- Never send `force: true`.

## 4. GitHub rate limits

### Findings

All from [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) unless noted.

- **Primary limits**
  - OAuth App user tokens count toward the **user's 5,000 requests per hour**. That budget is shared with every other app and personal access token acting for that user.
  - It is 15,000 per hour if the OAuth App is owned or approved by a GitHub Enterprise Cloud org and the user is a member.
  - Unauthenticated requests get 60 per hour per IP.
  - App client-ID/secret requests for public data get 5,000 per hour per app.
- **Secondary limits** (subject to change):
  - 100 concurrent requests;
  - 900 points per minute per REST endpoint, where GET/HEAD/OPTIONS cost 1 point and POST/PATCH/PUT/DELETE cost 5;
  - 90 s of CPU per 60 s;
  - **80 content-generating requests per minute and 500 per hour**;
  - 2,000 OAuth token requests per hour.
- **When a limit is hit:**
  - You get `403` or `429`, and should honour `retry-after`, or `x-ratelimit-reset` when `x-ratelimit-remaining` is `0`.
  - There is no way to check secondary-limit status.
  - `GET /rate_limit` doesn't count toward the primary limit.
  - Rate-limit values can vary between responses because requests are served in several regions.
- **Conditional requests** ([best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests)):
  - Use the `etag` and `last-modified` response headers.
  - A `304 Not Modified` "does not count against your primary rate limit if … made while correctly authorized with an `Authorization` header".
  - Unsafe methods don't support conditional requests.
  - Honour `x-poll-interval`.
- **Cheapest "has it changed?" check:**
  - `GET /repos/{owner}/{repo}/commits/{ref}` with `Accept: application/vnd.github.sha` returns just the SHA.
  - The docs describe using it "to check if a remote reference's SHA-1 hash is the same as your local reference's SHA-1 hash by providing the local SHA-1 reference as the ETag" ([get a commit](https://docs.github.com/en/rest/commits/commits#get-a-commit)).
  - Alternative: `GET /git/ref/heads/{branch}` with the stored `etag` in `If-None-Match`.

### Recommendation

- Poll `commits/{branch}` with the `vnd.github.sha` media type and `If-None-Match` set to the last synced SHA. Run it on focus, on reconnect and on a backoff timer.
- Only on `200` fetch the tree and changed blobs.
- Queue writes through one server-side limiter that allows about 1 commit request in flight per user.

## 5. Version history from git commits

### Findings

- **Listing commits for a note**
  - `GET /repos/{owner}/{repo}/commits?path={path}&sha={branch}&per_page=100&page=N` ([list commits](https://docs.github.com/en/rest/commits/commits#list-commits)).
  - The documented parameters are `sha`, `path` ("Only commits containing this file path"), `author`, `committer`, `since`, `until`, `per_page` (default 30, maximum 100) and `page`.
  - Paginate with the `link` header's `rel="next"` ([pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)).
- **Renames:** no parameter follows renames.
  - **(inference)** It behaves like `git log -- <path>` without `--follow`.
  - To bridge a rename, call `GET /repos/{o}/{r}/commits/{sha}`, whose `files[]` gives `status` and `previous_filename`. That file list paginates past 300 files, up to 3,000 ([get a commit](https://docs.github.com/en/rest/commits/commits#get-a-commit)).
- **File at a commit:**
  - `GET /repos/{o}/{r}/contents/{path}?ref={sha}` with `Accept: application/vnd.github.raw+json`. `ref` is "The name of the commit/branch/tag" ([contents](https://docs.github.com/en/rest/repos/contents#get-repository-content)).
  - Alternatively `GET /git/blobs/{file_sha}` with the raw media type, if the blob SHA is known ([blobs](https://docs.github.com/en/rest/git/blobs#get-a-blob)).
- **Compare** ([compare](https://docs.github.com/en/rest/commits/commits#compare-two-commits)):
  - `GET /repos/{o}/{r}/compare/{BASE}...{HEAD}` returns per-file `status` (`added`, `removed`, `modified`, `renamed`), `previous_filename` and `patch`.
  - Without paging it returns up to 250 commits. The changed-files list appears only on page 1 and holds at most 300 files.
  - The `application/vnd.github.diff` media type returns a plain diff.

### Recommendation

- Build the history list from `commits?path=` and cache it by commit SHA in IndexedDB. Commits never change, so the cache never expires.
- Fetch content per version with `contents?ref=` (raw) and diff locally with jsdiff (§12). Skip `compare` for single-note views.
- Our app performs every rename, so also record a stable `id` in each note's frontmatter. Stitch history across renames by finding the `renamed` entry in the commit that created the new path.

## 6. Collaborators for shared notebooks

### Findings

- **Create a notebook:** `POST /user/repos` with `{ name, private: true, auto_init: true }`. A private repo needs the `repo` scope ([create repo](https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user)).
- **Invite a collaborator:** `PUT /repos/{owner}/{repo}/collaborators/{username}` ([add collaborator](https://docs.github.com/en/rest/collaborators/collaborators#add-a-repository-collaborator)).
  - It returns `201` when an invitation is created and `204` if the user is already a collaborator.
  - The body field `permission` (`pull`, `triage`, `push`, `maintain`, `admin`) is "**Only valid on organization-owned repositories**".
  - It is limited to 50 invitations per repo per 24 hours, and the invitee is notified.
  - `DELETE` on the same path removes a collaborator. `GET` returns `204` or `404` to check membership.
- **Permissions on personal repos:** "Collaborators on a personal repository can pull (read) … and push (write)". Read-only collaborators aren't possible there ([permission levels](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository)). The same page lists managing topics as an owner-only action.
- **Owner managing invites:** `GET /repos/{o}/{r}/invitations` lists them, and `PATCH` / `DELETE /repos/{o}/{r}/invitations/{invitation_id}` update or cancel one ([invitations](https://docs.github.com/en/rest/collaborators/invitations)).
- **Invitee:** `GET /user/repository_invitations` (`per_page` max 100) lists open invitations. `PATCH /user/repository_invitations/{invitation_id}` accepts (`204`) and `DELETE` declines ([invitations](https://docs.github.com/en/rest/collaborators/invitations)).
- **Scopes for invitations:** `repo:invite` "grants targeted access to invitations **without** also granting access to repository code"; `repo` covers both ([invitations](https://docs.github.com/en/rest/collaborators/invitations), [scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)).
- **Listing a user's repos:** `GET /user/repos?affiliation=owner,collaborator&per_page=100` ([list repos](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user)).
  - `affiliation` takes `owner`, `collaborator` and `organization_member`.
  - `type` returns `422` if combined with `visibility` or `affiliation`.
  - The response `repository` objects include `topics` and `permissions` (`admin`, `push`, `pull`, …), according to the OpenAPI schema.
- **Topics:** `PUT /repos/{o}/{r}/topics` with `{ names: [...] }` replaces all topics, which are saved lowercase. `GET` reads them ([topics](https://docs.github.com/en/rest/repos/repos#replace-all-repository-topics)).
- **`repo` scope** grants full access to private repos, "including … repository invitations, collaborators". The scope list has no narrower scope for private-repo contents ([scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)).

### Recommendation

- Request only `repo`; it covers creating, collaborators, invitations and topics.
- Mark notebooks with a topic such as `gh-notepad-notebook`, set by the owner, **and** a root marker file `.gh-notepad.json`. Collaborators can't edit topics, but the marker file still identifies the repo for them.
- Discover notebooks via `/user/repos?affiliation=owner,collaborator`, filtered on `topics`, with the marker file as a fallback check.
- Show pending invites from `/user/repository_invitations`, with an in-app "Accept" button.
- Tell users that shared notebooks are always read/write.

## 7. Read-only share links

### Findings

- **Gist API** ([gists](https://docs.github.com/en/rest/gists/gists)):
  - **Create:** `POST /gists` with `{ description, public: false, files: { "note.md": { content } } }`.
  - **Update:** `PATCH /gists/{gist_id}`. Setting a file to `null` deletes it. `filename` renames it.
  - **Delete:** `DELETE /gists/{gist_id}` returns `204`.
  - **Read:** `GET /gists/{gist_id}`.
- **Scope:** "To read or write gists on a user's behalf, you need the gist OAuth scope". `repo` doesn't include it ([gists, Authentication](https://docs.github.com/en/rest/gists/gists#about-gists); `gist` "Grants write access to gists" in [scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)).
- **Secret gists** "aren't private. If you send the URL of a secret gist to a friend, they'll be able to see it" ([creating gists](https://docs.github.com/en/get-started/writing-on-github/editing-and-sharing-content-with-gists/creating-gists#about-gists)).
- **Anonymous reads:**
  - Unauthenticated server reads count toward 60 per hour **per originating IP** ([rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
  - **(inference)** That is unreliable from shared serverless egress IPs.
  - App client-ID/secret auth gives 5,000 per hour, but is documented only for "public data". Verify it for secret gists before relying on it.
  - The `raw_url` on `gist.githubusercontent.com` has no documented REST rate limit.
- **Truncation:** the API returns at most 1 MB per file (`truncated: true`), so fetch `raw_url` for the rest. Files over 10 MB need `git_pull_url`. The file list is truncated after 300 files ([gists, Truncation](https://docs.github.com/en/rest/gists/gists#about-gists)).
- **Binary:** `files.*.content` is a plain `string` with no `encoding` field in the create and update schemas, so **binary images can't be added via the API** (OpenAPI request bodies). **(inference)** The only route for binary files is `git push` to the gist's repo.
- **Vercel Blob private storage**
  - Added in `@vercel/blob` **2.3.0** as "private storage support (beta)": `put(path, body, { access: 'private' })`, a new `get(pathname, { access: 'private', ifNoneMatch })`, and conditional gets ([CHANGELOG](https://github.com/vercel/storage/blob/main/packages/blob/CHANGELOG.md)).
  - 2.4.0 added presigned URLs (`presignUrl`) and Vercel OIDC auth.
  - In 2.8.2 the types say "`access` (Required) Must be 'public' or 'private' … private blobs require authentication" ([npm 2.8.2](https://www.npmjs.com/package/@vercel/blob/v/2.8.2)).
  - Nothing in the changelog announces general availability. Confirm on vercel.com/docs, which was blocked from this sandbox.

### Recommendation

Implement share links as **our own snapshots**:

- On "Share", render the note's Markdown with its images copied out of `attachments/`.
- Store the snapshot under a random 128-bit share ID in Vercel Blob. Use private access served through our route handler, or public access with `addRandomSuffix`.
- Serve `/s/{id}` read-only with CDN caching. Revoke by deleting.

This avoids the `gist` scope, anonymous GitHub rate limits and the binary limitation. Use secret gists only if "the share must live in the user's GitHub account" is a hard requirement, and then host images separately.

## 8. GitHub OAuth App

### Findings

All from [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) unless noted.

- **PKCE is supported:**
  - `code_challenge` must be a 43-character SHA-256 value, and `code_challenge_method` must be `S256`; `plain` is not supported.
  - `code_verifier` is sent on `POST /login/oauth/access_token`.
  - The `pkce_support` feature flag is enabled for github.com and GHEC ([data/features/pkce_support.yml](https://github.com/github/docs/blob/main/data/features/pkce_support.yml)).
- **`state`:** "Strongly recommended". It is "An unguessable random string … to protect against cross-site request forgery attacks". Abort if it doesn't match.
  - The code expires after 10 minutes.
  - The docs suggest storing `code_verifier` "in a cookie alongside the `state` parameter".
- **Token expiry:**
  - OAuth App tokens are long-lived by default and are revoked after **one year without use** ([token expiration](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation)).
  - **New option:** OAuth Apps can opt in to expiring tokens. The access token lasts **8 h** (`expires_in=28800`), and the refresh token lasts **6 months** unused (`refresh_token_expires_in`).
  - You can enable it app-wide, or per sign-in by adding the `offline_access` scope.
  - Refresh with `grant_type=refresh_token` on `/login/oauth/access_token`. Each refresh invalidates the old pair.
  - The `oauth-token-expiration` feature flag is enabled for github.com and GHEC ([data/features](https://github.com/github/docs/blob/main/data/features/oauth-token-expiration.yml)).
- **Token count limit:** each user/app/scope combination can have at most 10 tokens, and only 10 can be created per hour. GitHub then revokes the oldest unused token, or else the least recently used one. Hitting the hourly limit forces a re-authorization prompt. **(inference)** Logging in on more than 10 devices silently logs out the oldest.
- **Scopes** ([scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)):
  - `repo`: full private and public repo access, including collaborators and invitations;
  - `gist`: write access to gists;
  - `read:user`: read profile data;
  - no scope: public info only.
  - The `scope` parameter is space-delimited.
  - A user who has already authorized the app isn't shown the consent screen again.
- **Login rate limit:** 2,000 access-token requests per hour per OAuth App ([rate limits for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/rate-limits-for-oauth-apps)).

### Recommendation

- Use the authorization-code flow with **PKCE `S256` plus `state`**. Keep both values in a short-lived HTTP-only cookie set by `/api/auth/login`.
- Request `repo read:user`, and `offline_access` if we adopt expiring tokens. Add `gist` only if we choose gist shares.
- Enable expiring tokens and refresh inside route handlers. The encrypted cookie (§13) then holds the access token, the refresh token and the expiry time.

## 9. PWA on Next.js 16

### Findings

- **Turbopack is the default** for both `next dev` and `next build` in v16. A custom `webpack` config makes `next build` **fail** unless you pass `--webpack`, and the docs warn that plugins can add such a config ([v16 upgrade](https://nextjs.org/docs/app/guides/upgrading/version-16)).
- **`@serwist/next` 9.5.13** is a webpack plugin: it imports `InjectManifest` from `@serwist/webpack-plugin`. Under Turbopack it warns that it "doesn't support Turbopack" and suggests three ways out ([packages/next/src/index.ts](https://github.com/serwist/serwist/blob/main/packages/next/src/index.ts)):
  - use `--webpack`;
  - migrate to `@serwist/turbopack`, which "has experimental support for Turbopack";
  - use **configurator mode**.
- **`@serwist/turbopack` 9.5.13** ([examples/next-turbo-basic](https://github.com/serwist/serwist/tree/main/examples/next-turbo-basic), [packages/turbo/src/index.ts](https://github.com/serwist/serwist/blob/main/packages/turbo/src/index.ts)):
  - `withSerwist(nextConfig)` adds `esbuild` and `esbuild-wasm` to `serverExternalPackages`.
  - A route at `app/serwist/[path]/route.ts` exports `createSerwistRoute({ swSrc: 'app/sw.ts', additionalPrecacheEntries, useNativeEsbuild })`. Its exports include `generateStaticParams`.
  - That route bundles the service worker with esbuild and serves it with `Service-Worker-Allowed: /`.
  - `<SerwistProvider swUrl="/serwist/sw.js">` in the layout registers it with scope `/`.
  - The example is pinned to `next 16.3.8`.
- **Configurator mode:** `serwist.config.js` uses `serwist({ swSrc: 'app/sw.ts', swDest: 'public/sw.js' })` from `@serwist/next/config`. The build script becomes `next build && serwist build`, which is bundler-agnostic ([examples/next-basic-cli](https://github.com/serwist/serwist/tree/main/examples/next-basic-cli)).
- **The Next.js PWA guide** ([progressive-web-apps](https://nextjs.org/docs/app/guides/progressive-web-apps)):
  - It covers `app/manifest.ts` (`MetadataRoute.Manifest`).
  - It registers a hand-written worker with `navigator.serviceWorker.register(new URL('../lib/service-worker.js', import.meta.url), { scope: '/', updateViaCache: 'none' })`. That worker handles **push only**.
  - It sets headers for `/sw.js` (`Cache-Control: no-cache, no-store, must-revalidate`, and a CSP).
  - For "full service-worker-based offline caching, one option is Serwist", with Turbopack and webpack examples.
- **`useOffline` (new, experimental):** `experimental.useOffline` plus `useOffline()` from `next/offline` was introduced in "v16.x.0".
  - It retries failed soft navigations and Server Actions when the connection returns.
  - "A full page reload while offline still fails … full offline loads would need a service worker" ([offline support](https://nextjs.org/docs/app/guides/offline-support), [use-offline](https://nextjs.org/docs/app/api-reference/functions/use-offline)).

### Recommendation

- Use **Serwist with `@serwist/turbopack`**:
  - precache the app shell and the `/~offline`-style fallback;
  - set `fallbacks` for `document` requests;
  - keep the default Turbopack build.
- Configurator mode (`serwist build` after `next build`) is the fallback if the experimental route has problems.
- Don't hand-roll the precache manifest, and don't use `@serwist/next`, which needs webpack.
- The local-first data lives in IndexedDB, so the service worker only has to cache code. Never let it cache `/api/*`.

## 10. Next.js 16 changes to respect

### Findings

All from the [v16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16), checked against the v16.4.4 docs, unless noted.

- **`middleware` becomes `proxy`**
  - Rename the file to `proxy.ts` and export `function proxy(request)`. The old names are deprecated.
  - The proxy runtime is `nodejs` and "cannot be configured"; Edge is not supported in `proxy`.
  - Config flags were renamed, for example `skipMiddlewareUrlNormalize` became `skipProxyUrlNormalize`.
  - Without a `matcher`, the proxy runs on every request, including `_next/static` and `public/` ([proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)).
  - The auth guide positions the proxy for **optimistic** checks only ([authentication](https://nextjs.org/docs/app/guides/authentication)).
- **Async request APIs: synchronous access is fully removed**
  - `cookies()`, `headers()`, `draftMode()`, `params` (in layout, page, route, default and metadata images) and `searchParams` must all be awaited.
  - `npx next typegen` generates `PageProps`, `LayoutProps` and `RouteContext` helpers.
  - `context.params` has been a Promise in Route Handlers since 15.0, and `GET` handlers have been dynamic (uncached) by default since then ([route](https://nextjs.org/docs/app/api-reference/file-conventions/route)).
- **Cookies:** `(await cookies()).set()` and `.delete()` only work in Server Functions or Route Handlers. They are not allowed during Server Component rendering ([cookies](https://nextjs.org/docs/app/api-reference/functions/cookies)).
- **Viewport:** use `export const viewport: Viewport = { themeColor }` or `generateViewport`. `metadata.themeColor`, `colorScheme` and `viewport` have been deprecated since 14 ([generate-viewport](https://nextjs.org/docs/app/api-reference/functions/generate-viewport)).
- **Other breaking items:**
  - minimums: Node **20.9+**, TypeScript 5.1+, and browsers Chrome/Edge/Firefox 111+ and Safari 16.4+;
  - Turbopack is the default (see §9);
  - `next lint` is removed, so use ESLint flat config directly;
  - parallel routes require `default.js`;
  - `next/image` defaults changed (local images with query strings, `minimumCacheTTL`, `qualities`, local-IP restriction);
  - AMP and `serverRuntimeConfig`/`publicRuntimeConfig` are removed;
  - React 19.2.

### Recommendation

- Put session decryption in a `lib/session.ts` used by every route handler, and re-verify there.
- Use `proxy.ts` only for redirecting signed-out users away from `/notes`, with a matcher that excludes `_next/*`, `api/*` and static assets.
- Type route handlers with `RouteContext<'/api/…/[id]'>` and `await ctx.params`.
- Put `themeColor` in the root layout's `viewport` export.

## 11. Local storage and tests

### Findings

- **`idb` 8.0.4:** "tiny (~1.19kB brotli'd)" (measured: 1.45 kB gzip UMD). It is a promise wrapper over IndexedDB with typed `DBSchema` ([jakearchibald/idb](https://github.com/jakearchibald/idb)).
- **Dexie 4.4.7** ([dexie/Dexie.js](https://github.com/dexie/Dexie.js)):
  - `dexie.min.js` measures 30.8 kB gzip.
  - Schema versioning via `db.version(n).stores({...})`.
  - Reactive queries via `liveQuery` and `useLiveQuery` from `dexie-react-hooks` 4.4.0.
  - Dexie Cloud sync is optional; we don't need it.
- **`fake-indexeddb` 6.2.7** ([dumbmatter/fakeIndexedDB](https://github.com/dumbmatter/fakeIndexedDB)):
  - `import "fake-indexeddb/auto"` installs the globals. Import it before `dexie`.
  - Since v5 there is no `structuredClone` polyfill, and **jsdom lacks it**: polyfill it, or run the DB tests in the `node` environment.
- **Vitest 5.1.0 setup** (`latest`; 5.0 shipped recently, and 4.1.12 is still tagged `V4`):
  - It requires **Vite ≥ 6.4 and Node ≥ 22.12**.
  - Notable defaults: `clearMocks` is on, unawaited async assertions fail the test, and config files are no longer looked up in parent directories ([migration](https://github.com/vitest-dev/vitest/blob/main/docs/guide/migration/index.md)).
  - The Next.js recipe installs `vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom vite-tsconfig-paths` with `environment: 'jsdom'`. Async Server Components are not supported, so cover them with E2E tests ([testing/vitest](https://nextjs.org/docs/app/guides/testing/vitest)). The current versions are `@vitejs/plugin-react` 6.2.1 and `@testing-library/react` 16.3.3.
- **Playwright 1.64.1**
  - The Next.js docs recommend testing against `next build && next start`, or using `webServer` ([testing/playwright](https://nextjs.org/docs/app/guides/testing/playwright)).
  - `browserContext.setOffline(offline)` exists ([class-browsercontext](https://playwright.dev/docs/api/class-browsercontext#browser-context-set-offline)).
  - `route()` "will not intercept requests intercepted by Service Worker", so set `serviceWorkers: 'block'` when mocking ([same page](https://playwright.dev/docs/api/class-browsercontext#browser-context-route)).
- **MSW 3.0.3** ([2.x→3.x migration](https://github.com/mswjs/mswjs.io/blob/main/src/content/docs/migrations/2.x-to-3.x.md)):
  - It needs Node ≥ 22 (npm `engines` says ≥ 22.12.0).
  - Handlers moved to sub-entrypoints, for example `import { http, HttpResponse } from 'msw/http'` and `delay` from `msw/utils/delay`.
  - `setupServer` still comes from `msw/node` and `setupWorker` from `msw/browser`.
  - `onUnhandledRequest` was renamed `onUnhandledFrame`.
  - A new `msw/vite` plugin serves the worker script.
  - For Vitest in Node, use the Node integration. For Browser Mode, extend `test` with a `worker` fixture ([vitest integration](https://github.com/mswjs/mswjs.io/blob/main/src/content/guides/integrations/vitest.md)).
  - `@msw/serve` 0.11.0 provides `createServer(...handlers).listen(9090)`, a standalone HTTP server running MSW handlers ([serve getting started](https://github.com/mswjs/mswjs.io/blob/main/src/content/ecosystem/serve/getting-started.md)).

### Recommendation

- Use **Dexie 4**. Versioned schemas, compound indexes, transactions and `useLiveQuery` remove a lot of sync-engine plumbing. The 30 kB cost is acceptable for an app shell.
- Tests:
  - **Vitest 5** with `fake-indexeddb/auto` in `setupFiles`; run storage and sync-engine tests in `environment: 'node'`.
  - **MSW 3 `setupServer`** to fake `api.github.com` for route-handler and sync tests. Keep one shared `handlers.ts` that models refs, trees, commits and the 422 case.
  - **Playwright** against a production build, with the route handlers pointed at an **`@msw/serve`** GitHub fake via a `GITHUB_API_URL` env var.
- **(inference)** MSW's browser worker and our Serwist worker would compete for scope `/`. Disable the app's service worker whenever browser MSW is on, and run PWA/offline E2E tests as a separate unmocked project.
- Use Node 24 locally, in CI and on Vercel.

## 12. Three-way text merge and diffs

### Findings

- **`node-diff3` 3.2.1** ([bhousel/node-diff3](https://github.com/bhousel/node-diff3)):
  - Ships ESM, CJS and a browser IIFE.
  - `merge(a, o, b, opts)` returns `{ conflict: boolean, result: string[] }`, with `<<<<<<<` / `=======` / `>>>>>>>` markers.
  - `mergeDiff3(a, o, b, { label: { a, o, b } })` adds the original section, as in git's diff3 style.
  - `diff3Merge(a, o, b)` returns regions `{ ok: T[] }` or `{ conflict: { a, aIndex, o, oIndex, b, bIndex } }`, which can drive a custom conflict UI (types in `src/diff3.d.ts`).
  - Options are `excludeFalseConflicts` (default `true`) and `stringSeparator`.
  - **`stringSeparator` defaults to `/\s+/`** (`src/diff3.mjs`), so string inputs are split into words. For Markdown, pass `text.split('\n')` arrays and join the result with `'\n'`.
- **`diff` (jsdiff) 9.0.0** ([kpdecker/jsdiff](https://github.com/kpdecker/jsdiff), [release notes](https://github.com/kpdecker/jsdiff/blob/master/release-notes.md)):
  - Ships ESM with bundled types. v9 dropped ES5 support; 10.0.0 is a prerelease.
  - Diff functions:
    - `diffLines(old, new, { newlineIsToken, ignoreWhitespace, stripTrailingCr })`;
    - `diffWords(old, new, { ignoreCase, intlSegmenter })`, where `intlSegmenter` takes an `Intl.Segmenter` with `granularity: 'word'`;
    - `diffWordsWithSpace` and `diffChars`.
  - Patch functions: `structuredPatch` and `createTwoFilesPatch`.
  - Change objects are `{ value, added, removed, count }`.
  - `maxEditLength` caps the cost and returns `undefined` when exceeded. `oneChangePerToken` and an async callback mode are also available.

### Recommendation

- Merge with `node-diff3` `diff3Merge` on line arrays, using base = last synced version, a = local, b = remote.
  - If there are no conflicts, auto-commit the merge.
  - If there are conflicts, show a per-hunk chooser. Write conflict markers only into the raw CodeMirror mode.
- Render history diffs with jsdiff: `diffLines`, then `diffWordsWithSpace` inside changed lines for word highlighting, with `maxEditLength` as a guard.

## 13. Encrypted session cookies

### Findings

- **`iron-session` 9.0.1** ([vvo/iron-session](https://github.com/vvo/iron-session), [CHANGELOG](https://github.com/vvo/iron-session/blob/main/CHANGELOG.md)):
  - It needs **Node ≥ 22.13** and is ESM-only. Use v8 for older Node.
  - App Router route handlers call `getIronSession(await cookies(), { password, cookieName })`. The new `nextProxyCookies(request, response)` adapter covers `proxy.ts`.
  - `password` must be at least 32 characters. It can be an object `{2: '…', 1: '…'}` for rotation.
  - `chunk: true` splits cookies over 4096 bytes.
  - Reads are typed `Partial<T>`, and sealing a `Date` throws.
  - v8 and v9 can read each other's cookies.
  - Its own examples are pinned to `next 16.3.3`.
  - It is listed in the Next.js authentication guide ([authentication](https://nextjs.org/docs/app/guides/authentication)).
- **`jose` 6.2.15** ([panva/jose](https://github.com/panva/jose)):
  - Zero dependencies; runs on Web Crypto in Node, browsers, Workers and other runtimes.
  - JWE: `new EncryptJWT(payload).setProtectedHeader({ alg: 'dir', enc: 'A128CBC-HS256' }).setExpirationTime('2h').encrypt(secret)`, then `jwtDecrypt` ([EncryptJWT](https://github.com/panva/jose/blob/main/docs/jwt/encrypt/classes/EncryptJWT.md)).
  - The Next.js guide's jose example uses `SignJWT` / `jwtVerify`. That is a *signed* JWT, and its payload is readable by the client.

### Recommendation

Use **iron-session 9**:

- It is built for encrypted cookie sessions.
- It handles key rotation, chunking, the Next `cookies()` API and the `proxy.ts` adapter out of the box.
- Set the Vercel project's Node version to 24.

If you use jose instead, it must be JWE (`EncryptJWT`, `dir` + `A256GCM`), never `SignJWT`, because the GitHub token must not be readable.

## 14. Frontmatter parsing in the browser

### Findings

- **`gray-matter` 4.0.3** was last published 2021-04-24 ([jonschlinkert/gray-matter](https://github.com/jonschlinkert/gray-matter)). Problems for browser use:
  - It depends on `js-yaml ^3.13.1`, while the current js-yaml is 5.5.0.
  - `index.js` does `require('fs')`, which `package.json` stubs with `"browser": { "fs": false }`.
  - `lib/utils.js#toBuffer` calls the Node global `Buffer.from`, so browser builds need a polyfill.
  - **Security:** the built-in `javascript` engine calls **`eval`** on front matter whose opening delimiter is `---js` or `---javascript` ([lib/engines.js](https://github.com/jonschlinkert/gray-matter/blob/master/lib/engines.js), alias in [lib/engine.js](https://github.com/jonschlinkert/gray-matter/blob/master/lib/engine.js)). In a shared notebook, a collaborator could plant a note that runs code in other members' browsers.
- **`yaml` 2.9.1** ([eemeli/yaml](https://github.com/eemeli/yaml)):
  - No dependencies; "runs on Node.js as well as modern browsers" (it has a `browser` export map).
  - Supports YAML 1.1 and 1.2 and passes the yaml-test-suite.
  - "Supports parsing, modifying, and writing YAML comments and blank lines" via `parseDocument(str)`, `doc.set()` and `doc.toString()`.
  - `parse` and `stringify` are available for simple cases.

### Recommendation

- Use `yaml` with a roughly 20-line splitter:
  - strip a BOM and normalize CRLF;
  - require that the file starts with `---\n`;
  - find the next line that is `---` or `...`;
  - `parseDocument()` that block with `version: '1.2'`;
  - set app-owned keys (`id`, `title`, `tags`, `created`, `updated`) with `doc.set`;
  - re-emit with `doc.toString()` so unknown keys and comments survive.
- Don't use gray-matter.

## 15. Client-side full-text search

### Findings

- **MiniSearch 7.2.0** ([lucaong/minisearch](https://github.com/lucaong/minisearch)):
  - Zero dependencies. The unminified UMD measures 18.6 kB gzip; a minified build is smaller.
  - Incremental updates: `add`, `addAll`, `addAllAsync`, `remove(doc)` (needs the full document), `discard(id)` / `discardAll` (by ID, cleaned up by `autoVacuum`), `replace` and `vacuum`.
  - Persistence: `JSON.stringify(index)` with `MiniSearch.loadJSON(json, options)` or `loadJSONAsync`.
  - Search features: fuzzy, prefix, field boosts and `autoSuggest` (type definitions in `dist/es/index.d.ts`).
- **FlexSearch 0.8.212** ([nextapps-de/flexsearch](https://github.com/nextapps-de/flexsearch)):
  - The README size table gives 16.3 kB (bundle), 11.4 kB (compact) and 4.5 kB (light) gzip.
  - Incremental updates: `add`, `update` and `remove`.
  - Persistence: export/import, plus "Persistent Indexes" with an IndexedDB adapter, new in 0.8. Worker support.
  - It is still 0.x, and the API changed between 0.7 and 0.8.
- **Orama 3.1.18** ([oramasearch/orama](https://github.com/oramasearch/orama)):
  - Updates: `insert` / `insertMultiple`, `update`, `upsert` and `remove`.
  - Typo tolerance, plus vector and hybrid search.
  - Persistence via `save(db)` / `load(db, raw)`, and `@orama/plugin-data-persistence` 3.1.18.
  - The unminified browser build measures 45.5 kB gzip, an upper bound.
  - The last release was 2025-12-19.

### Recommendation

Use **MiniSearch 7**:

- It fits a notes-scale corpus.
- `discard(id)` plus `add(doc)` or `replace(doc)` map one-to-one onto sync-engine events.
- `toJSON` / `loadJSON` lets us persist the index as a single IndexedDB record, rebuilding it if the schema version changes.
- It has no dependencies and its API is stable.
- Index `title`, `tags`, `folder` and `body`. Run indexing in a Web Worker if the corpus grows large.
