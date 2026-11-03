import { changedFiles, flattenTree, getObject, listTree, type CommitObject, type FileEntry } from "../git";
import { apiError, json, paginate, type FakeRoute, type RouteContext } from "../router";
import {
  addRepo,
  authenticate,
  branchHead,
  canRead,
  canWrite,
  commitFiles,
  findRepo,
  findUser,
  isAdmin,
  isCollaborator,
  type FakeRepo,
  type FakeState,
  type FakeUser,
} from "../state";

/**
 * Repositories (https://docs.github.com/en/rest/repos/repos), commits
 * (https://docs.github.com/en/rest/commits/commits: the listing by path a
 * note's history is built from, the cheap "has the branch moved?" check, and
 * a commit's files with their renames) and file contents at a ref
 * (https://docs.github.com/en/rest/repos/contents).
 */

/** A repository as `viewer` sees it (its owner, by default): `permissions` are theirs. */
export function repoJson(state: FakeState, repo: FakeRepo, apiOrigin: string, viewer?: FakeUser | null) {
  const owner = findUser(state, repo.owner);
  const admin = viewer === undefined || isAdmin(viewer, repo);
  const push = admin || canWrite(viewer ?? null, repo);
  return {
    id: repo.id,
    node_id: repo.nodeId,
    name: repo.name,
    full_name: `${repo.owner}/${repo.name}`,
    private: repo.private,
    visibility: repo.private ? "private" : "public",
    owner: { login: repo.owner, id: owner?.id ?? 0, type: "User" },
    html_url: `${apiOrigin}/${repo.owner}/${repo.name}`,
    url: `${apiOrigin}/repos/${repo.owner}/${repo.name}`,
    description: repo.description,
    fork: false,
    created_at: repo.createdAt,
    updated_at: repo.createdAt,
    default_branch: repo.defaultBranch,
    topics: [...repo.topics],
    permissions: { admin, maintain: admin, push, triage: push, pull: true },
  };
}

/** The minimal repository GitHub nests in invitations: no topics, no permissions. */
export function minimalRepoJson(state: FakeState, repo: FakeRepo, apiOrigin: string) {
  const owner = findUser(state, repo.owner);
  return {
    id: repo.id,
    node_id: repo.nodeId,
    name: repo.name,
    full_name: `${repo.owner}/${repo.name}`,
    owner: { login: repo.owner, id: owner?.id ?? 0, type: "User", site_admin: false },
    private: repo.private,
    html_url: `${apiOrigin}/${repo.owner}/${repo.name}`,
    description: repo.description,
    fork: false,
    url: `${apiOrigin}/repos/${repo.owner}/${repo.name}`,
  };
}

/**
 * The repository a request names, if the caller may see it (and change it,
 * for `write`). GitHub answers 404 rather than 403 for a private repository the
 * caller can't see, so its existence isn't revealed.
 */
export function accessRepo(
  { request, params, state }: RouteContext,
  access: "read" | "write",
): { repo: FakeRepo } | { response: Response } {
  const user = authenticate(state, request);
  const repo = findRepo(state, params.owner, params.repo);
  if (!repo || !canRead(user, repo)) return { response: apiError(404, "Not Found") };
  if (access === "write" && !canWrite(user, repo)) {
    return { response: apiError(user ? 403 : 401, user ? "Resource not accessible by integration" : "Requires authentication") };
  }
  return { repo };
}

/** Resolves a branch name or full commit SHA to a commit SHA. */
export function resolveCommit(repo: FakeRepo, ref: string): string | undefined {
  return branchHead(repo, ref) ?? (getObject(repo.objects, ref, "commit") ? ref : undefined);
}

/** The files of a commit's first parent, by path. */
function parentFiles(repo: FakeRepo, commit: CommitObject): Map<string, FileEntry> {
  const parent = commit.parents[0] ? getObject(repo.objects, commit.parents[0], "commit") : undefined;
  return parent ? flattenTree(repo.objects, parent.tree) : new Map();
}

/** Whether `commit` changed what is at `path`: added, modified or removed it (`git log -- path`). */
function touches(repo: FakeRepo, commit: CommitObject, path: string): boolean {
  const before = parentFiles(repo, commit).get(path)?.sha;
  const after = flattenTree(repo.objects, commit.tree).get(path)?.sha;
  return before !== after;
}

/** A commit as the list and detail endpoints show it; the detail adds `files` and `stats`. */
function commitJson(state: FakeState, repo: FakeRepo, commit: CommitObject, apiOrigin: string) {
  const user = [...state.users.values()].find((candidate) => candidate.name === commit.author.name || candidate.login === commit.author.name);
  const account = user ? { login: user.login, id: user.id, type: "User" } : null;
  return {
    sha: commit.sha,
    node_id: Buffer.from(`06:Commit${repo.id}:${commit.sha}`).toString("base64"),
    commit: {
      message: commit.message,
      tree: { sha: commit.tree, url: `${apiOrigin}/repos/${repo.owner}/${repo.name}/git/trees/${commit.tree}` },
      author: commit.author,
      committer: commit.committer,
      comment_count: 0,
    },
    url: `${apiOrigin}/repos/${repo.owner}/${repo.name}/commits/${commit.sha}`,
    html_url: `${apiOrigin}/${repo.owner}/${repo.name}/commit/${commit.sha}`,
    author: account,
    committer: account,
    parents: commit.parents.map((sha) => ({ sha, url: `${apiOrigin}/repos/${repo.owner}/${repo.name}/commits/${sha}` })),
  };
}

/** GitHub's `files[]` entry for a changed file: no `patch`, which the app never reads. */
function fileJson(repo: FakeRepo, commit: CommitObject, apiOrigin: string, change: ReturnType<typeof changedFiles>[number]) {
  const contents = `${apiOrigin}/repos/${repo.owner}/${repo.name}/contents/${change.path}?ref=${commit.sha}`;
  return {
    sha: change.sha,
    filename: change.path,
    status: change.status,
    additions: change.additions,
    deletions: change.deletions,
    changes: change.additions + change.deletions,
    blob_url: `${apiOrigin}/${repo.owner}/${repo.name}/blob/${commit.sha}/${change.path}`,
    raw_url: `${apiOrigin}/${repo.owner}/${repo.name}/raw/${commit.sha}/${change.path}`,
    contents_url: contents,
    ...(change.previousPath === undefined ? {} : { previous_filename: change.previousPath }),
  };
}

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
/** GitHub's topic rule: lowercase letters, numbers and hyphens, starting with a letter or number, at most 50 characters. */
const TOPIC = /^[a-z0-9][a-z0-9-]{0,49}$/;
const MAX_TOPICS = 20;
const AFFILIATIONS = ["owner", "collaborator", "organization_member"];

const adminRequired = () => apiError(403, "Must have admin rights to Repository.");

export const repoRoutes: FakeRoute[] = [
  {
    method: "GET",
    path: "/repos/:owner/:repo",
    handle: (context) => {
      const access = accessRepo(context, "read");
      if ("response" in access) return access.response;
      const viewer = authenticate(context.state, context.request);
      return json(repoJson(context.state, access.repo, context.url.origin, viewer));
    },
  },
  {
    method: "POST",
    path: "/user/repos",
    handle: async ({ request, url, state }) => {
      const user = authenticate(state, request);
      if (!user) return apiError(401, "Requires authentication");
      const body: unknown = await request.json().catch(() => null);
      const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      const name = typeof fields.name === "string" ? fields.name : "";
      if (!REPO_NAME.test(name)) return apiError(422, "Repository creation failed.");
      if (findRepo(state, user.login, name)) {
        return json(
          {
            message: "Repository creation failed.",
            errors: [
              { resource: "Repository", code: "custom", field: "name", message: "name already exists on this account" },
            ],
            documentation_url: "https://docs.github.com/rest/repos/repos#create-a-repository-for-the-authenticated-user",
            status: "422",
          },
          { status: 422 },
        );
      }
      const description = typeof fields.description === "string" ? fields.description : null;
      const repo = addRepo(state, { owner: user.login, name, private: fields.private === true, description });
      if (fields.auto_init === true) {
        // GitHub's initial commit: a README titled with the repository name.
        const readme = `# ${name}${description ? `\n${description}` : ""}\n`;
        commitFiles(state, repo, { message: "Initial commit", files: { "README.md": readme } });
      }
      return json(repoJson(state, repo, url.origin), { status: 201 });
    },
  },
  {
    // Before the `commits/*` route: a trailing `*` matches an empty rest too.
    method: "GET",
    path: "/repos/:owner/:repo/commits",
    handle: (context) => {
      const access = accessRepo(context, "read");
      if ("response" in access) return access.response;
      const { repo } = access;
      if (repo.refs.size === 0) return apiError(409, "Git Repository is empty.");
      const { searchParams } = context.url;
      const start = searchParams.get("sha") ?? repo.defaultBranch;
      const path = searchParams.get("path");
      const first = resolveCommit(repo, start);
      if (!first) return apiError(404, `No commit found for SHA: ${start}`);

      // The first-parent history, as `git log` walks it, narrowed to commits that touch `path`.
      const commits: CommitObject[] = [];
      let sha: string | undefined = first;
      while (sha) {
        const commit: CommitObject | undefined = getObject(repo.objects, sha, "commit");
        if (!commit) break;
        if (!path || touches(repo, commit, path)) commits.push(commit);
        sha = commit.parents[0];
      }
      const page = paginate(commits, context.url);
      return json(
        page.items.map((commit) => commitJson(context.state, repo, commit, context.url.origin)),
        { headers: page.headers },
      );
    },
  },
  {
    method: "GET",
    path: "/repos/:owner/:repo/commits/*",
    handle: (context) => {
      const access = accessRepo(context, "read");
      if ("response" in access) return access.response;
      const { repo } = access;
      if (repo.refs.size === 0) return apiError(409, "Git Repository is empty.");
      const ref = context.params["*"];
      const sha = resolveCommit(repo, ref);
      if (!sha) return apiError(422, `No commit found for SHA: ${ref}`);

      const etag = `"${sha}"`;
      if ((context.request.headers.get("accept") ?? "").includes("application/vnd.github.sha")) {
        // An If-None-Match that names the current SHA answers 304, which costs no rate limit.
        const known = (context.request.headers.get("if-none-match") ?? "").split(",").map((tag) => tag.trim());
        if (known.includes(etag) || known.includes(`W/${etag}`)) {
          return new Response(null, { status: 304, headers: { etag } });
        }
        return new Response(sha, { headers: { etag, "content-type": "application/vnd.github.sha; charset=utf-8" } });
      }
      const commit = getObject(repo.objects, sha, "commit");
      if (!commit) return apiError(422, `No commit found for SHA: ${ref}`);
      const files = changedFiles(repo.objects, commit).map((change) => fileJson(repo, commit, context.url.origin, change));
      const additions = files.reduce((sum, file) => sum + file.additions, 0);
      const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
      return json(
        {
          ...commitJson(context.state, repo, commit, context.url.origin),
          stats: { total: additions + deletions, additions, deletions },
          files,
        },
        { headers: { etag } },
      );
    },
  },
  {
    method: "GET",
    path: "/repos/:owner/:repo/contents/*",
    handle: (context) => {
      const access = accessRepo(context, "read");
      if ("response" in access) return access.response;
      const { repo } = access;
      if (repo.refs.size === 0) return apiError(404, "This repository is empty.");
      const ref = context.url.searchParams.get("ref") ?? repo.defaultBranch;
      const sha = resolveCommit(repo, ref);
      if (!sha) return apiError(404, `No commit found for the ref ${ref}`);
      const tree = getObject(repo.objects, sha, "commit")?.tree ?? "";
      const path = context.params["*"].replace(/\/+$/, "");
      const origin = context.url.origin;
      const urls = (entryPath: string) => ({
        url: `${origin}/repos/${repo.owner}/${repo.name}/contents/${entryPath}?ref=${ref}`,
        html_url: `${origin}/${repo.owner}/${repo.name}/blob/${ref}/${entryPath}`,
      });

      const file = flattenTree(repo.objects, tree).get(path);
      if (file) {
        const blob = getObject(repo.objects, file.sha, "blob");
        const content = blob?.content ?? Buffer.alloc(0);
        if ((context.request.headers.get("accept") ?? "").includes("application/vnd.github.raw")) {
          return new Response(new Uint8Array(content), {
            headers: { "content-type": "application/vnd.github.raw; charset=utf-8", etag: `"${file.sha}"` },
          });
        }
        return json({
          type: "file",
          encoding: "base64",
          size: content.length,
          name: path.slice(path.lastIndexOf("/") + 1),
          path,
          content: (content.toString("base64").match(/.{1,60}/g) ?? [""]).join("\n") + "\n",
          sha: file.sha,
          ...urls(path),
          git_url: `${origin}/repos/${repo.owner}/${repo.name}/git/blobs/${file.sha}`,
          download_url: `${origin}/${repo.owner}/${repo.name}/raw/${ref}/${path}`,
        });
      }

      // A directory lists its entries; the root is the empty path.
      const entries = listTree(repo.objects, tree, true).filter(
        (entry) => path === "" ? !entry.path.includes("/") : entry.path.startsWith(`${path}/`) && !entry.path.slice(path.length + 1).includes("/"),
      );
      if (entries.length === 0) return apiError(404, "Not Found");
      return json(
        entries.map((entry) => ({
          type: entry.type === "tree" ? "dir" : "file",
          size: entry.size ?? 0,
          name: entry.name,
          path: entry.path,
          sha: entry.sha,
          ...urls(entry.path),
        })),
      );
    },
  },
  {
    method: "GET",
    path: "/user/repos",
    handle: ({ request, url, state }) => {
      const user = authenticate(state, request);
      if (!user) return apiError(401, "Requires authentication");
      const affiliation = url.searchParams.get("affiliation");
      if (url.searchParams.has("type") && (affiliation !== null || url.searchParams.has("visibility"))) {
        return apiError(422, "Validation Failed");
      }
      const wanted = (affiliation ?? AFFILIATIONS.join(",")).split(",").map((value) => value.trim());
      if (!wanted.every((value) => AFFILIATIONS.includes(value))) return apiError(422, "Validation Failed");
      const visibility = url.searchParams.get("visibility") ?? "all";

      // Organizations aren't modelled, so `organization_member` adds nothing.
      const repos = [...state.repos.values()]
        .filter(
          (repo) =>
            (wanted.includes("owner") && isAdmin(user, repo)) ||
            (wanted.includes("collaborator") && isCollaborator(repo, user.login)),
        )
        .filter((repo) => visibility === "all" || (visibility === "private") === repo.private)
        .sort((a, b) => `${a.owner}/${a.name}`.toLowerCase().localeCompare(`${b.owner}/${b.name}`.toLowerCase()));
      const page = paginate(repos, url);
      return json(
        page.items.map((repo) => repoJson(state, repo, url.origin, user)),
        { headers: page.headers },
      );
    },
  },
  {
    method: "GET",
    path: "/repos/:owner/:repo/topics",
    handle: (context) => {
      const access = accessRepo(context, "read");
      return "response" in access ? access.response : json({ names: [...access.repo.topics] });
    },
  },
  {
    method: "PUT",
    path: "/repos/:owner/:repo/topics",
    handle: async (context) => {
      const access = accessRepo(context, "read");
      if ("response" in access) return access.response;
      if (!isAdmin(authenticate(context.state, context.request), access.repo)) return adminRequired();
      const body: unknown = await context.request.json().catch(() => null);
      const given = body && typeof body === "object" ? (body as Record<string, unknown>).names : undefined;
      if (!Array.isArray(given) || !given.every((name) => typeof name === "string")) {
        return apiError(422, "Invalid request.\n\n\"names\" wasn't supplied.");
      }
      const topics = [...new Set(given.map((name: string) => name.trim().toLowerCase()))];
      if (topics.length > MAX_TOPICS || !topics.every((topic) => TOPIC.test(topic))) {
        return apiError(422, "Validation Failed");
      }
      access.repo.topics = topics;
      return json({ names: [...topics] });
    },
  },
];
