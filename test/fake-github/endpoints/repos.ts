import { getObject } from "../git";
import { apiError, json, type FakeRoute, type RouteContext } from "../router";
import {
  addRepo,
  authenticate,
  branchHead,
  canRead,
  canWrite,
  commitFiles,
  findRepo,
  findUser,
  type FakeRepo,
  type FakeState,
} from "../state";

/**
 * Repositories (https://docs.github.com/en/rest/repos/repos) and the cheap
 * "has the branch moved?" check on commits
 * (https://docs.github.com/en/rest/commits/commits#get-a-commit).
 */

export function repoJson(state: FakeState, repo: FakeRepo, apiOrigin: string) {
  const owner = findUser(state, repo.owner);
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
    topics: [],
    permissions: { admin: true, maintain: true, push: true, triage: true, pull: true },
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

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;

export const repoRoutes: FakeRoute[] = [
  {
    method: "GET",
    path: "/repos/:owner/:repo",
    handle: (context) => {
      const access = accessRepo(context, "read");
      return "response" in access ? access.response : json(repoJson(context.state, access.repo, context.url.origin));
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
      return json(
        {
          sha,
          commit: { message: commit?.message, tree: { sha: commit?.tree }, author: commit?.author, committer: commit?.committer },
          parents: (commit?.parents ?? []).map((parent) => ({ sha: parent })),
        },
        { headers: { etag } },
      );
    },
  },
];
