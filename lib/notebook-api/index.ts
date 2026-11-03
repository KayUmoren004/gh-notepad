import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { authFromEnv, type CookieReader, type Session } from "@/lib/auth";
import {
  gatewayFromEnv,
  GitHubError,
  PERSONAL_NOTEBOOK,
  type GitHubGateway,
  type MemberGitHub,
  type NotebookLocation,
  type RepositoryName,
  type SharedNotebooksGitHub,
} from "@/lib/github-gateway";
import { ATTACHMENTS_DIR, attachmentContentType, imageProblem, isAttachmentPath } from "@/lib/attachments";
import { isSafePath } from "@/lib/notebook-format";
import {
  BLOBS_PER_REQUEST,
  type ApiErrorBody,
  type ApiErrorCode,
  type AttachmentBlobResponse,
  type BlobsResponse,
  type CommitResponse,
  type FileChange,
  type FilesResponse,
  type HeadResponse,
  type NotebookRef,
} from "@/lib/remote";

/**
 * The notebook routes under `/api/notebooks/`: thin adapters between the
 * client-side remote and the GitHub gateway. They read the member's session,
 * check every name and path before it reaches GitHub, and map GitHub's
 * failures to the contract in `lib/remote`.
 *
 *   POST /api/notebooks/personal                     the personal notebook, created if missing
 *   GET  /api/notebooks/:owner/:repo/head            ?branch=&known=  head commit (conditional)
 *   GET  /api/notebooks/:owner/:repo/files           ?commit=         every file at a commit
 *   POST /api/notebooks/:owner/:repo/blobs           { shas }         text of blobs
 *   POST /api/notebooks/:owner/:repo/commits         { branch, base, message, changes }
 *   POST /api/notebooks/:owner/:repo/attachments     <image bytes>    stored as a blob, for a commit to name
 *   GET  /api/notebooks/:owner/:repo/attachments/:name ?branch=&sha=  the attachment's bytes, cacheable
 */
export interface NotebookApi {
  handle: (request: NextRequest) => Promise<Response>;
}

export interface NotebookApiOptions {
  appUrl: URL;
  readSession: (cookies: CookieReader) => Promise<Session | null>;
  github: GitHubGateway;
}

/** The notebook routes configured from the environment, like `authFromEnv`. */
export function notebookApiFromEnv(
  env: Record<string, string | undefined> = process.env,
  dependencies: { fetch?: typeof fetch } = {},
): NotebookApi {
  return createNotebookApi({
    appUrl: new URL(env.NEXT_PUBLIC_APP_URL ?? ""),
    readSession: authFromEnv(env, dependencies).readSession,
    github: gatewayFromEnv(env, dependencies),
  });
}

const MAX_CHANGES = 1000;
const MAX_FILE_CHARS = 1_000_000;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const SHA = /^[0-9a-f]{40}$/;

class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

const invalid = (message: string) => new ApiFailure(400, "invalid", message);

function reply<T>(body: T, status = 200): Response {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function failed({ status, code, message, retryAfter }: ApiFailure): Response {
  const body: ApiErrorBody = { error: code, message, ...(retryAfter === undefined ? {} : { retryAfter }) };
  return reply(body, status);
}

function isBranch(branch: string): boolean {
  return (
    /^[A-Za-z0-9._/-]{1,255}$/.test(branch) &&
    !branch.includes("..") &&
    !branch.startsWith("/") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".lock")
  );
}

async function jsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid("Expected a JSON object");
  return body as Record<string, unknown>;
}

function readChanges(value: unknown): FileChange[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHANGES) {
    throw invalid(`A commit holds 1 to ${MAX_CHANGES} changes`);
  }
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    const change = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const path = typeof change.path === "string" ? change.path : "";
    if (!isSafePath(path)) throw invalid(`Unsafe path: ${JSON.stringify(path)}`);
    if (seen.has(path)) throw invalid(`Changed twice: ${path}`);
    seen.add(path);
    if (change.delete === true) return { path, delete: true };
    if ("sha" in change) {
      if (typeof change.sha !== "string" || !SHA.test(change.sha)) throw invalid(`Invalid blob for ${path}`);
      return { path, sha: change.sha };
    }
    if (typeof change.content !== "string" || change.content.length > MAX_FILE_CHARS) {
      throw invalid(`Missing or oversized content for ${path}`);
    }
    return { path, content: change.content };
  });
}

export function createNotebookApi({ appUrl, readSession, github }: NotebookApiOptions): NotebookApi {
  /** The member and their GitHub, or a 401 when the session is missing or expired. */
  async function signedIn(
    request: NextRequest,
  ): Promise<{ session: Session; gitHub: MemberGitHub & SharedNotebooksGitHub }> {
    const session = await readSession(request.cookies);
    if (!session) throw new ApiFailure(401, "signed_out", "Sign in again to sync");
    return {
      session,
      gitHub: github.forMember({ login: session.member.login, accessToken: session.github.accessToken }),
    };
  }

  /** Shared notebooks already confirmed as such for a member (`login\0owner/repo`, lowercased), so one request asks GitHub once. */
  const confirmed = new Set<string>();

  /**
   * The notebook a route names: the member's personal notebook, which costs
   * GitHub nothing, or a repository tagged as a notebook that the member can
   * open, which GitHub is asked about (ADR 0004: GitHub is the permission
   * system). Anything else is 404, whether or not the repository exists.
   */
  async function notebookOf(
    { session, gitHub }: { session: Session; gitHub: SharedNotebooksGitHub },
    owner: string,
    repo: string,
  ): Promise<RepositoryName> {
    if (!OWNER.test(owner) || !REPO.test(repo)) throw invalid("Invalid notebook");
    const personal =
      owner.toLowerCase() === session.member.login.toLowerCase() && repo.toLowerCase() === PERSONAL_NOTEBOOK;
    if (personal) return { owner, repo };
    const key = `${session.member.login}\u0000${owner}/${repo}`.toLowerCase();
    if (confirmed.has(key)) return { owner, repo };
    const notebook = await gitHub.findNotebook({ owner, repo });
    if (!notebook) throw new ApiFailure(404, "not_found", "No such notebook");
    confirmed.add(key);
    return { owner: notebook.owner, repo: notebook.repo };
  }

  async function branchOf(
    member: { session: Session; gitHub: SharedNotebooksGitHub },
    owner: string,
    repo: string,
    branch: unknown,
  ): Promise<NotebookLocation> {
    if (typeof branch !== "string" || !isBranch(branch)) throw invalid("Invalid branch");
    const notebook = await notebookOf(member, owner, repo);
    return { ...notebook, branch };
  }

  async function route(request: NextRequest): Promise<Response> {
    const url = request.nextUrl;
    const segments = url.pathname
      .replace(/^\/api\/notebooks\/?/, "")
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));

    if (request.method === "POST") {
      // A cross-site page can't read these routes' answers, but it mustn't write either.
      const origin = request.headers.get("origin");
      if (origin !== null && origin !== appUrl.origin) throw new ApiFailure(403, "forbidden", "Cross-site request");
    }

    if (segments.length === 1 && segments[0] === "personal" && request.method === "POST") {
      const { gitHub } = await signedIn(request);
      const notebook: NotebookRef = await gitHub.ensurePersonalNotebook();
      return reply(notebook);
    }

    if (segments.length === 4 && segments[2] === ATTACHMENTS_DIR && request.method === "GET") {
      const member = await signedIn(request);
      const notebook = await branchOf(member, segments[0], segments[1], url.searchParams.get("branch"));
      return serveAttachment(request, member.gitHub, notebook, segments[3]);
    }

    if (segments.length !== 3) throw new ApiFailure(404, "not_found", "No such route");
    const [owner, repo, action] = segments;
    const member = await signedIn(request);
    const { gitHub } = member;

    if (action === ATTACHMENTS_DIR && request.method === "POST") {
      const notebook = await notebookOf(member, owner, repo);
      const type = request.headers.get("content-type")?.split(";")[0].trim() ?? "";
      const declared = Number(request.headers.get("content-length"));
      const problem = imageProblem({ type, size: Number.isFinite(declared) && declared > 0 ? declared : 1 });
      if (problem) throw invalid(problem);
      const bytes = new Uint8Array(await request.arrayBuffer());
      const late = imageProblem({ type, size: bytes.length });
      if (late) throw invalid(late);
      const stored: AttachmentBlobResponse = { sha: await gitHub.storeBlob(notebook, bytes) };
      return reply(stored, 201);
    }

    if (action === "head" && request.method === "GET") {
      const notebook = await branchOf(member, owner, repo, url.searchParams.get("branch"));
      const known = url.searchParams.get("known");
      if (known !== null && !SHA.test(known)) throw invalid("Invalid commit");
      const head: HeadResponse = await gitHub.getHead(notebook, known);
      return reply(head);
    }

    if (action === "files" && request.method === "GET") {
      const notebook = await notebookOf(member, owner, repo);
      const commit = url.searchParams.get("commit") ?? "";
      if (!SHA.test(commit)) throw invalid("Invalid commit");
      const files: FilesResponse = { files: await gitHub.listFiles(notebook, commit) };
      return reply(files);
    }

    if (action === "blobs" && request.method === "POST") {
      const notebook = await notebookOf(member, owner, repo);
      const { shas } = await jsonBody(request);
      if (!Array.isArray(shas) || shas.length > BLOBS_PER_REQUEST || !shas.every((sha) => typeof sha === "string" && SHA.test(sha))) {
        throw invalid(`Ask for up to ${BLOBS_PER_REQUEST} blob SHAs`);
      }
      const blobs: BlobsResponse = { blobs: await gitHub.readTextBlobs(notebook, shas as string[]) };
      return reply(blobs);
    }

    if (action === "commits" && request.method === "POST") {
      const body = await jsonBody(request);
      const notebook = await branchOf(member, owner, repo, body.branch);
      const base = typeof body.base === "string" ? body.base : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!SHA.test(base)) throw invalid("Invalid base commit");
      if (!message || message.length > 1000) throw invalid("A commit needs a message");
      const outcome = await gitHub.commitChanges(notebook, { base, message, changes: readChanges(body.changes) });
      if (outcome.status === "branch-moved") {
        throw new ApiFailure(409, "branch_moved", "The notebook changed since the device last pulled");
      }
      const created: CommitResponse = { commit: outcome.commit, blobs: outcome.blobs };
      return reply(created, 201);
    }

    throw new ApiFailure(404, "not_found", "No such route");
  }

  /**
   * An attachment's bytes, for the member's own browser cache: for good when
   * the request names the blob (a blob never changes), otherwise for an hour
   * and then revalidated by ETag. Sandboxed and never sniffed, so an SVG opened
   * on its own can't run scripts against the app.
   */
  async function serveAttachment(
    request: NextRequest,
    gitHub: MemberGitHub,
    notebook: NotebookLocation,
    name: string,
  ): Promise<Response> {
    const path = `${ATTACHMENTS_DIR}/${name}`;
    if (!isAttachmentPath(path)) throw invalid("Not an attachment");
    const wanted = request.nextUrl.searchParams.get("sha");
    if (wanted !== null && !SHA.test(wanted)) throw invalid("Invalid blob");

    const blob = await gitHub.readBlob(notebook, path, wanted);
    if (!blob) throw new ApiFailure(404, "not_found", "The notebook has no such attachment");
    const etag = `"${blob.sha}"`;
    const headers = {
      etag,
      "cache-control": wanted ? "private, max-age=31536000, immutable" : "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(blob.bytes), {
      headers: {
        ...headers,
        "content-type": attachmentContentType(path),
        "content-length": String(blob.bytes.length),
        "content-disposition": `inline; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      },
    });
  }

  return {
    handle: async (request) => {
      try {
        return await route(request);
      } catch (error) {
        if (error instanceof ApiFailure) return failed(error);
        if (error instanceof GitHubError) return failed(fromGitHub(error));
        throw error;
      }
    },
  };
}

function fromGitHub(error: GitHubError): ApiFailure {
  if (error.status === 401) return new ApiFailure(401, "signed_out", "GitHub no longer accepts this session");
  if (error.code === "rate_limited") {
    return new ApiFailure(429, "rate_limited", "GitHub asked us to slow down", error.retryAfterSeconds);
  }
  if (error.status === 404) return new ApiFailure(404, "not_found", "GitHub has no such notebook");
  // Logged without anything from the request: no tokens, no note content.
  console.error(`GitHub request failed: ${error.status} ${error.message}`);
  return new ApiFailure(502, "github_unavailable", "GitHub couldn't be reached");
}
