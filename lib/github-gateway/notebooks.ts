import "server-only";
import { createHash } from "node:crypto";
import { GitHubError, record, text, type ApiCall } from "./http";

/** The personal notebook's repository name, in the member's own account. */
export const PERSONAL_NOTEBOOK = "my-notes";

/** Blob reads in flight at once, well under GitHub's 100 concurrent requests. */
const BLOB_CONCURRENCY = 8;

/** Where a notebook lives: a repository and the branch the app reads and writes. */
export interface NotebookLocation {
  owner: string;
  repo: string;
  branch: string;
}

/** A notebook's repository, for reads that name a commit rather than a branch. */
export type RepositoryName = Pick<NotebookLocation, "owner" | "repo">;

/** A file in a notebook at some commit. */
export interface NotebookFile {
  path: string;
  /** Git blob SHA: equal SHAs mean equal content. */
  sha: string;
}

/** Text goes inline in the tree; a binary file is a blob stored first and named by `sha`. */
export type FileChange = { path: string; content: string } | { path: string; sha: string } | { path: string; delete: true };

/** An attachment's bytes as the notebook holds them. */
export interface NotebookBlob {
  sha: string;
  bytes: Buffer;
}

/** One commit that touched a file, wherever the file was at the time. */
export interface FileVersion {
  commit: string;
  /** The file's path at that commit. */
  path: string;
  message: string;
  /** ISO 8601, the commit's author date. */
  date: string;
  /** The author's login, or their name when GitHub can't match the commit to an account. */
  author: string;
}

/** Commits walked per history at most: enough for years of a note's sessions, bounded for the rate limit. */
export const MAX_VERSIONS = 500;

export type CommitOutcome =
  /** `blobs` holds the blob SHA of every file written, by path. */
  | { status: "committed"; commit: string; blobs: Record<string, string> }
  /** The branch no longer points at the base commit: pull, merge and try again. */
  | { status: "branch-moved" };

/** Notebook operations on GitHub, acting as one signed-in member. */
export interface MemberGitHub {
  /** The member's personal notebook (`<login>/my-notes`), created private with an initial commit if missing. */
  ensurePersonalNotebook: () => Promise<NotebookLocation>;
  /**
   * The branch's head commit. With the `known` commit it is a conditional
   * request: an unchanged branch answers 304, which costs no rate limit.
   */
  getHead: (notebook: NotebookLocation, known: string | null) => Promise<{ commit: string; changed: boolean }>;
  /** Every file in the notebook at `commit`. */
  listFiles: (notebook: RepositoryName, commit: string) => Promise<NotebookFile[]>;
  /** The content of text blobs (notes), by SHA. */
  readTextBlobs: (notebook: RepositoryName, shas: readonly string[]) => Promise<Record<string, string>>;
  /**
   * Commits every change at once on top of `base` and moves the branch to it,
   * never forcing: if someone else moved the branch first, nothing changes and
   * the outcome is `branch-moved`.
   */
  commitChanges: (
    notebook: NotebookLocation,
    commit: { base: string; message: string; changes: readonly FileChange[] },
  ) => Promise<CommitOutcome>;
  /** Stores bytes as a blob in the notebook's repository, to name in a later commit; returns its SHA. */
  storeBlob: (notebook: RepositoryName, bytes: Uint8Array) => Promise<string>;
  /**
   * The file at `path` on the branch, as bytes, or `null` if the branch has
   * none. With the blob `sha` the branch isn't consulted: a blob never changes.
   */
  readBlob: (notebook: NotebookLocation, path: string, sha: string | null) => Promise<NotebookBlob | null>;
  /**
   * Every commit on the branch that touched the file at `path`, newest first,
   * following the file back through renames and moves (GitHub's listing by
   * path stops at a rename; each rename's `previous_filename` continues it).
   * Bounded by `MAX_VERSIONS`.
   */
  listVersions: (notebook: NotebookLocation, path: string) => Promise<FileVersion[]>;
  /** The file's text at `commit`, or `null` if that commit has no file at `path`. */
  readFileAt: (notebook: RepositoryName, commit: string, path: string) => Promise<string | null>;
}

/** Git's blob SHA for UTF-8 text, so callers can recognise their own content in later listings. */
export function gitBlobSha(content: string): string {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest("hex");
}

const segment = encodeURIComponent;

function repoPath({ owner, repo }: { owner: string; repo: string }): string {
  return `/repos/${segment(owner)}/${segment(repo)}`;
}

function branchPath(branch: string): string {
  return branch.split("/").map(segment).join("/");
}

function filePath(path: string): string {
  return path.split("/").map(segment).join("/");
}

/** The `page` of the `rel="next"` link, or `null` on the last page. */
function nextPage(response: Response): string | null {
  const link = response.headers.get("link") ?? "";
  const match = /<([^>]+)>;\s*rel="next"/.exec(link);
  return match ? new URL(match[1]).searchParams.get("page") : null;
}

function versionOf(entry: Record<string, unknown>, path: string): FileVersion | null {
  const commit = text(entry.sha);
  const details = record(entry.commit);
  const author = record(details.author);
  const date = text(author.date);
  if (!commit || !date) return null;
  return {
    commit,
    path,
    message: typeof details.message === "string" ? details.message : "",
    date,
    author: text(record(entry.author).login) ?? text(author.name) ?? "",
  };
}

function locationOf(body: Record<string, unknown>): NotebookLocation {
  const owner = text(record(body.owner).login);
  const repo = text(body.name);
  const branch = text(body.default_branch);
  if (!owner || !repo || !branch) throw new GitHubError("Unexpected repository response", 502);
  return { owner, repo, branch };
}

export function memberGitHub(api: ApiCall, login: string): MemberGitHub {
  async function getJson(path: string): Promise<Record<string, unknown>> {
    return record(await (await api(path)).json());
  }

  return {
    ensurePersonalNotebook: async () => {
      const path = repoPath({ owner: login, repo: PERSONAL_NOTEBOOK });
      try {
        return locationOf(await getJson(path));
      } catch (error) {
        if (!(error instanceof GitHubError) || error.status !== 404) throw error;
      }
      try {
        // `auto_init` gives the repository its first commit: the Git Data API refuses empty repositories.
        const response = await api("/user/repos", {
          method: "POST",
          body: {
            name: PERSONAL_NOTEBOOK,
            description: "My notes, kept by gh-notepad",
            private: true,
            auto_init: true,
          },
        });
        return locationOf(record(await response.json()));
      } catch (error) {
        // Created meanwhile, by another device signing in at the same moment.
        if (error instanceof GitHubError && error.status === 422) return locationOf(await getJson(path));
        throw error;
      }
    },

    getHead: async (notebook, known) => {
      const response = await api(`${repoPath(notebook)}/commits/${branchPath(notebook.branch)}`, {
        accept: "application/vnd.github.sha",
        headers: known ? { "if-none-match": `"${known}"` } : {},
      });
      if (response.status === 304 && known) return { commit: known, changed: false };
      const commit = (await response.text()).trim();
      if (!/^[0-9a-f]{40}$/.test(commit)) throw new GitHubError("Unexpected head commit response", 502);
      return { commit, changed: commit !== known };
    },

    listFiles: async (notebook, commit) => {
      const body = await getJson(`${repoPath(notebook)}/git/trees/${segment(commit)}?recursive=1`);
      if (body.truncated === true) {
        throw new GitHubError("This notebook has more files than GitHub lists in one tree", 507);
      }
      const entries = Array.isArray(body.tree) ? body.tree.map(record) : [];
      return entries.flatMap((entry) => {
        const path = text(entry.path);
        const sha = text(entry.sha);
        return entry.type === "blob" && path && sha ? [{ path, sha }] : [];
      });
    },

    readTextBlobs: async (notebook, shas) => {
      const contents: Record<string, string> = {};
      const queue = [...new Set(shas)];
      async function worker() {
        for (let sha = queue.shift(); sha !== undefined; sha = queue.shift()) {
          const body = await getJson(`${repoPath(notebook)}/git/blobs/${segment(sha)}`);
          const content = typeof body.content === "string" ? body.content : "";
          contents[sha] =
            body.encoding === "base64" ? Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8") : content;
        }
      }
      await Promise.all(Array.from({ length: Math.min(BLOB_CONCURRENCY, queue.length) }, worker));
      return contents;
    },

    commitChanges: async (notebook, { base, message, changes }) => {
      const repo = repoPath(notebook);
      const baseCommit = await getJson(`${repo}/git/commits/${segment(base)}`);
      const baseTree = text(record(baseCommit.tree).sha);
      if (!baseTree) throw new GitHubError("Unexpected commit response", 502);

      // Text goes inline: GitHub writes the blobs itself, saving a request per file.
      const tree = record(
        await (
          await api(`${repo}/git/trees`, {
            method: "POST",
            body: {
              base_tree: baseTree,
              tree: changes.map((change) =>
                "delete" in change
                  ? { path: change.path, mode: "100644", type: "blob", sha: null }
                  : "sha" in change
                    ? { path: change.path, mode: "100644", type: "blob", sha: change.sha }
                    : { path: change.path, mode: "100644", type: "blob", content: change.content },
              ),
            },
          })
        ).json(),
      );
      const created = record(
        await (
          await api(`${repo}/git/commits`, { method: "POST", body: { message, tree: tree.sha, parents: [base] } })
        ).json(),
      );
      const commit = text(created.sha);
      if (!commit) throw new GitHubError("Unexpected commit response", 502);

      try {
        await api(`${repo}/git/refs/heads/${branchPath(notebook.branch)}`, {
          method: "PATCH",
          body: { sha: commit, force: false },
        });
      } catch (error) {
        // GitHub's only signal that someone else pushed first (the GitHub CLI branches on it too).
        if (error instanceof GitHubError && error.status === 422 && /not a fast forward/i.test(error.message)) {
          return { status: "branch-moved" };
        }
        throw error;
      }

      const blobs: Record<string, string> = {};
      for (const change of changes) {
        if ("delete" in change) continue;
        blobs[change.path] = "sha" in change ? change.sha : gitBlobSha(change.content);
      }
      return { status: "committed", commit, blobs };
    },

    storeBlob: async (notebook, bytes) => {
      const response = await api(`${repoPath(notebook)}/git/blobs`, {
        method: "POST",
        body: { content: Buffer.from(bytes).toString("base64"), encoding: "base64" },
      });
      const sha = text(record(await response.json()).sha);
      if (!sha) throw new GitHubError("Unexpected blob response", 502);
      return sha;
    },

    readBlob: async (notebook, path, sha) => {
      let blobSha = sha;
      if (!blobSha) {
        // The tree endpoint takes a branch name as well as a tree SHA.
        const body = await getJson(`${repoPath(notebook)}/git/trees/${branchPath(notebook.branch)}?recursive=1`);
        if (body.truncated === true) {
          throw new GitHubError("This notebook has more files than GitHub lists in one tree", 507);
        }
        const entries = Array.isArray(body.tree) ? body.tree.map(record) : [];
        blobSha = text(entries.find((entry) => entry.type === "blob" && entry.path === path)?.sha) ?? null;
        if (!blobSha) return null;
      }
      let body: Record<string, unknown>;
      try {
        body = await getJson(`${repoPath(notebook)}/git/blobs/${segment(blobSha)}`);
      } catch (error) {
        if (error instanceof GitHubError && error.status === 404) return null;
        throw error;
      }
      const content = typeof body.content === "string" ? body.content : "";
      const bytes =
        body.encoding === "base64" ? Buffer.from(content.replace(/\s/g, ""), "base64") : Buffer.from(content, "utf8");
      return { sha: blobSha, bytes };
    },

    listVersions: async (notebook, path) => {
      const repo = repoPath(notebook);
      const versions: FileVersion[] = [];
      const seen = new Set<string>();
      // Where the walk stands: the path to list, from the commit to start at (the branch head first).
      let current: { path: string; from: string } | null = { path, from: notebook.branch };
      while (current && versions.length < MAX_VERSIONS) {
        let oldest: string | null = null;
        let page: string | null = "1";
        while (page && versions.length < MAX_VERSIONS) {
          const query = new URLSearchParams({ sha: current.from, path: current.path, per_page: "100", page });
          const response = await api(`${repo}/commits?${query}`);
          const entries: unknown = await response.json();
          for (const entry of Array.isArray(entries) ? entries.map(record) : []) {
            const version = versionOf(entry, current.path);
            if (!version || seen.has(version.commit)) continue;
            seen.add(version.commit);
            versions.push(version);
            oldest = version.commit;
            if (versions.length >= MAX_VERSIONS) break;
          }
          page = nextPage(response);
        }
        if (!oldest) break;
        // The file's first commit under this path: a rename there says where it was before.
        const detail = await getJson(`${repo}/commits/${segment(oldest)}`);
        const files = Array.isArray(detail.files) ? detail.files.map(record) : [];
        const renamed = files.find((file) => file.filename === current?.path && file.status === "renamed");
        const previous = renamed && text(renamed.previous_filename);
        current = previous ? { path: previous, from: oldest } : null;
      }
      return versions;
    },

    readFileAt: async (notebook, commit, path) => {
      try {
        const response = await api(`${repoPath(notebook)}/contents/${filePath(path)}?${new URLSearchParams({ ref: commit })}`, {
          accept: "application/vnd.github.raw+json",
        });
        return await response.text();
      } catch (error) {
        if (error instanceof GitHubError && error.status === 404) return null;
        throw error;
      }
    },
  };
}
