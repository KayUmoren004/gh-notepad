import {
  buildTree,
  flattenTree,
  getObject,
  isAncestor,
  listTree,
  writeBlob,
  writeCommit,
  type CommitObject,
  type EntryMode,
  type Signature,
} from "../git";
import { apiError, json, type FakeRoute, type RouteContext } from "../router";
import { authenticate, signatureOf, type FakeRepo } from "../state";
import { accessRepo, resolveCommit } from "./repos";

/**
 * The Git Data API (https://docs.github.com/en/rest/git): blobs, trees,
 * commits and refs, as the gateway uses them to read a notebook and to commit
 * many file changes atomically.
 */

const MODES: readonly EntryMode[] = ["100644", "100755", "040000", "120000", "160000"];

/** Git Data endpoints on an empty repository answer 409. */
function gitRepo(context: RouteContext, access: "read" | "write"): { repo: FakeRepo } | { response: Response } {
  const result = accessRepo(context, access);
  if ("response" in result) return result;
  if (result.repo.refs.size === 0) return { response: apiError(409, "Git Repository is empty.") };
  return result;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function base(context: RouteContext, repo: FakeRepo): string {
  return `${context.url.origin}/repos/${repo.owner}/${repo.name}`;
}

function refJson(context: RouteContext, repo: FakeRepo, ref: string, sha: string) {
  return {
    ref: `refs/${ref}`,
    node_id: Buffer.from(`04:Ref${repo.id}:${ref}`).toString("base64"),
    url: `${base(context, repo)}/git/refs/${ref}`,
    object: { sha, type: "commit", url: `${base(context, repo)}/git/commits/${sha}` },
  };
}

function commitJson(context: RouteContext, repo: FakeRepo, commit: CommitObject) {
  return {
    sha: commit.sha,
    node_id: Buffer.from(`06:Commit${repo.id}:${commit.sha}`).toString("base64"),
    url: `${base(context, repo)}/git/commits/${commit.sha}`,
    html_url: `${context.url.origin}/${repo.owner}/${repo.name}/commit/${commit.sha}`,
    author: commit.author,
    committer: commit.committer,
    tree: { sha: commit.tree, url: `${base(context, repo)}/git/trees/${commit.tree}` },
    message: commit.message,
    parents: commit.parents.map((sha) => ({ sha, url: `${base(context, repo)}/git/commits/${sha}` })),
    verification: { verified: false, reason: "unsigned", signature: null, payload: null },
  };
}

function treeJson(context: RouteContext, repo: FakeRepo, sha: string, recursive: boolean) {
  return {
    sha,
    url: `${base(context, repo)}/git/trees/${sha}`,
    tree: listTree(repo.objects, sha, recursive).map(({ path, mode, type, sha: entrySha, size }) => ({
      path,
      mode,
      type,
      sha: entrySha,
      ...(size === undefined ? {} : { size }),
      url: `${base(context, repo)}/git/${type === "tree" ? "trees" : "blobs"}/${entrySha}`,
    })),
    truncated: false,
  };
}

/** GitHub wraps base64 blob content at 60 characters. */
function wrappedBase64(content: Buffer): string {
  return (content.toString("base64").match(/.{1,60}/g) ?? [""]).join("\n") + "\n";
}

function signature(value: unknown, fallback: Signature): Signature {
  if (!value || typeof value !== "object") return fallback;
  const fields = value as Record<string, unknown>;
  return {
    name: typeof fields.name === "string" ? fields.name : fallback.name,
    email: typeof fields.email === "string" ? fields.email : fallback.email,
    date: typeof fields.date === "string" ? fields.date : fallback.date,
  };
}

export const gitDataRoutes: FakeRoute[] = [
  {
    method: "GET",
    path: "/repos/:owner/:repo/git/ref/*",
    handle: (context) => {
      const access = gitRepo(context, "read");
      if ("response" in access) return access.response;
      const ref = context.params["*"];
      const sha = access.repo.refs.get(ref);
      return sha ? json(refJson(context, access.repo, ref, sha)) : apiError(404, "Not Found");
    },
  },
  {
    method: "PATCH",
    path: "/repos/:owner/:repo/git/refs/*",
    handle: async (context) => {
      const access = gitRepo(context, "write");
      if ("response" in access) return access.response;
      const { repo } = access;
      const ref = context.params["*"];
      const current = repo.refs.get(ref);
      if (!current) return apiError(422, "Reference does not exist");
      const body = await readBody(context.request);
      const sha = typeof body.sha === "string" ? body.sha : "";
      if (!getObject(repo.objects, sha, "commit")) return apiError(422, "Object does not exist");
      // Without `force`, the new commit must descend from the one the branch points at.
      if (body.force !== true && !isAncestor(repo.objects, current, sha)) {
        return apiError(422, "Update is not a fast forward");
      }
      repo.refs.set(ref, sha);
      return json(refJson(context, repo, ref, sha));
    },
  },
  {
    method: "GET",
    path: "/repos/:owner/:repo/git/commits/:sha",
    handle: (context) => {
      const access = gitRepo(context, "read");
      if ("response" in access) return access.response;
      const commit = getObject(access.repo.objects, context.params.sha, "commit");
      return commit ? json(commitJson(context, access.repo, commit)) : apiError(404, "Not Found");
    },
  },
  {
    method: "POST",
    path: "/repos/:owner/:repo/git/commits",
    handle: async (context) => {
      const access = gitRepo(context, "write");
      if ("response" in access) return access.response;
      const { repo } = access;
      const body = await readBody(context.request);
      if (typeof body.message !== "string") return apiError(422, 'Invalid request.\n\n"message" wasn\'t supplied.');
      if (typeof body.tree !== "string" || !getObject(repo.objects, body.tree, "tree")) {
        return apiError(422, "Tree SHA does not exist");
      }
      const parents = Array.isArray(body.parents) ? body.parents : [];
      if (!parents.every((parent) => typeof parent === "string" && getObject(repo.objects, parent, "commit"))) {
        return apiError(422, "Parent SHA does not exist or is not a commit object");
      }
      const user = authenticate(context.state, context.request);
      const fallback = signatureOf(context.state, user ?? { login: repo.owner, id: 0, nodeId: "", name: null, createdAt: "" });
      const author = signature(body.author, fallback);
      const commit = writeCommit(repo.objects, {
        tree: body.tree,
        parents: parents as string[],
        message: body.message,
        author,
        committer: signature(body.committer, author),
      });
      return json(commitJson(context, repo, commit), { status: 201 });
    },
  },
  {
    method: "GET",
    path: "/repos/:owner/:repo/git/trees/*",
    handle: (context) => {
      const access = gitRepo(context, "read");
      if ("response" in access) return access.response;
      const { repo } = access;
      // A tree SHA, or anything that names a commit (a commit SHA or branch name).
      const treeish = context.params["*"];
      const commit = resolveCommit(repo, treeish);
      const sha = getObject(repo.objects, treeish, "tree")
        ? treeish
        : commit
          ? getObject(repo.objects, commit, "commit")?.tree
          : undefined;
      if (!sha) return apiError(404, "Not Found");
      const recursive = !!context.url.searchParams.get("recursive");
      return json(treeJson(context, repo, sha, recursive));
    },
  },
  {
    method: "POST",
    path: "/repos/:owner/:repo/git/trees",
    handle: async (context) => {
      const access = gitRepo(context, "write");
      if ("response" in access) return access.response;
      const { repo } = access;
      const body = await readBody(context.request);
      if (!Array.isArray(body.tree)) return apiError(422, 'Invalid request.\n\n"tree" wasn\'t supplied.');

      let files = new Map<string, { mode: EntryMode; sha: string }>();
      if (body.base_tree !== undefined) {
        if (typeof body.base_tree !== "string" || !getObject(repo.objects, body.base_tree, "tree")) {
          return apiError(422, "base_tree is not a valid tree oid");
        }
        files = flattenTree(repo.objects, body.base_tree);
      }

      for (const item of body.tree as unknown[]) {
        const entry = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const path = typeof entry.path === "string" ? entry.path : "";
        const mode = MODES.find((candidate) => candidate === entry.mode);
        if (!path || !mode || entry.type !== "blob") return apiError(422, "Invalid tree info");
        if ("sha" in entry && "content" in entry) {
          return apiError(422, "Must supply either tree.sha or tree.content. Request will be rejected if both are present.");
        }
        if (entry.sha === null) {
          // Deleting a path the base tree doesn't have is an error.
          if (!files.delete(path)) return apiError(422, "GitRPC::BadObjectState");
        } else if (typeof entry.content === "string") {
          files.set(path, { mode, sha: writeBlob(repo.objects, Buffer.from(entry.content, "utf8")).sha });
        } else if (typeof entry.sha === "string" && getObject(repo.objects, entry.sha, "blob")) {
          files.set(path, { mode, sha: entry.sha });
        } else {
          return apiError(422, `tree.sha ${String(entry.sha)} is not a valid blob`);
        }
      }

      const tree = buildTree(repo.objects, files);
      return json(treeJson(context, repo, tree.sha, false), { status: 201 });
    },
  },
  {
    method: "GET",
    path: "/repos/:owner/:repo/git/blobs/:sha",
    handle: (context) => {
      const access = gitRepo(context, "read");
      if ("response" in access) return access.response;
      const blob = getObject(access.repo.objects, context.params.sha, "blob");
      if (!blob) return apiError(404, "Not Found");
      return json({
        sha: blob.sha,
        node_id: Buffer.from(`04:Blob${access.repo.id}:${blob.sha}`).toString("base64"),
        size: blob.content.length,
        url: `${base(context, access.repo)}/git/blobs/${blob.sha}`,
        content: wrappedBase64(blob.content),
        encoding: "base64",
      });
    },
  },
  {
    method: "POST",
    path: "/repos/:owner/:repo/git/blobs",
    handle: async (context) => {
      const access = gitRepo(context, "write");
      if ("response" in access) return access.response;
      const body = await readBody(context.request);
      if (typeof body.content !== "string") return apiError(422, 'Invalid request.\n\n"content" wasn\'t supplied.');
      const encoding = body.encoding ?? "utf-8";
      if (encoding !== "utf-8" && encoding !== "base64") return apiError(422, "Invalid encoding");
      const blob = writeBlob(access.repo.objects, Buffer.from(body.content, encoding === "base64" ? "base64" : "utf8"));
      return json({ sha: blob.sha, url: `${base(context, access.repo)}/git/blobs/${blob.sha}` }, { status: 201 });
    },
  },
];
