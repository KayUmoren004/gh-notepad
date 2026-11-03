import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { authFromEnv, type CookieReader, type Session } from "@/lib/auth";
import {
  gatewayFromEnv,
  GitHubError,
  type Collaborator,
  type GitHubGateway,
  type Notebook,
  type NotebookInvitation,
  type NotebookRepository,
  type SharedNotebooksGitHub,
} from "@/lib/github-gateway";

/**
 * The shared-notebook routes: thin adapters between the app and the GitHub
 * gateway. They read the member's session, check every login, notebook name
 * and id before it reaches GitHub, and map GitHub's failures to the error
 * bodies below. Only a notebook's owner may invite, list invitations, cancel
 * them or remove collaborators; GitHub enforces that and the routes pass its
 * refusal on as `forbidden`.
 *
 *   GET    /api/notebooks                                        → NotebooksResponse
 *   POST   /api/notebooks                   { name }             → 201 NotebookResponse   create a shared notebook
 *   GET    /api/notebooks/:owner/:repo/collaborators             → CollaboratorsResponse
 *   DELETE /api/notebooks/:owner/:repo/collaborators/:username   → 204                    remove a collaborator
 *   GET    /api/notebooks/:owner/:repo/invitations               → InvitationsResponse
 *   POST   /api/notebooks/:owner/:repo/invitations { username }  → 201 | 200 InviteResponse
 *   DELETE /api/notebooks/:owner/:repo/invitations/:id           → 204                    cancel an invitation
 *   POST   /api/notebooks/:owner/:repo/leave                     → 204                    remove your own access
 *   GET    /api/invitations                                      → InvitationsResponse    the member's own
 *   POST   /api/invitations/:id/accept                           → 204
 */
export interface SharedNotebooksApi {
  handle: (request: NextRequest) => Promise<Response>;
}

export type { Collaborator, Notebook, NotebookInvitation, NotebookRepository };

export interface NotebooksResponse {
  notebooks: Notebook[];
}

export interface NotebookResponse {
  notebook: Notebook;
}

export interface CollaboratorsResponse {
  collaborators: Collaborator[];
}

export interface InvitationsResponse {
  invitations: NotebookInvitation[];
}

export type InviteResponse = { status: "invited"; invitation: NotebookInvitation } | { status: "already-collaborator" };

export type SharedNotebooksErrorCode =
  /** A name, login or id the routes refused before asking GitHub. */
  | "invalid"
  /** No session, or GitHub no longer accepts its token: sign in again. */
  | "signed_out"
  /** GitHub refused: only the notebook's owner may do that, or a cross-site request. */
  | "forbidden"
  | "not_found"
  /** GitHub has no account by that username. */
  | "no_such_user"
  /** The member already has a repository by that name. */
  | "name_taken"
  /** GitHub refused the request as invalid; `message` is GitHub's. */
  | "rejected"
  | "rate_limited"
  | "github_unavailable";

export interface SharedNotebooksErrorBody {
  error: SharedNotebooksErrorCode;
  message: string;
  /** Seconds, for `rate_limited`. */
  retryAfter?: number;
}

export interface SharedNotebooksApiOptions {
  appUrl: URL;
  readSession: (cookies: CookieReader) => Promise<Session | null>;
  github: GitHubGateway;
}

/** The shared-notebook routes configured from the environment, like `authFromEnv`. */
export function sharedNotebooksApiFromEnv(
  env: Record<string, string | undefined> = process.env,
  dependencies: { fetch?: typeof fetch } = {},
): SharedNotebooksApi {
  return createSharedNotebooksApi({
    appUrl: new URL(env.NEXT_PUBLIC_APP_URL ?? ""),
    readSession: authFromEnv(env, dependencies).readSession,
    github: gatewayFromEnv(env, dependencies),
  });
}

/** GitHub's login rule, loosely: letters, digits and hyphens, not starting or ending with a hyphen, at most 39. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
/** GitHub's repository name rule; GitHub would silently rewrite anything else. */
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/;
const INVITATION_ID = /^[1-9][0-9]{0,15}$/;
const PERSONAL_NOTEBOOK_NAME = "my-notes";

class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: SharedNotebooksErrorCode,
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

const done = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

function failed({ status, code, message, retryAfter }: ApiFailure): Response {
  const body: SharedNotebooksErrorBody = { error: code, message, ...(retryAfter === undefined ? {} : { retryAfter }) };
  return reply(body, status);
}

const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function login(value: unknown, what: string): string {
  const candidate = typeof value === "string" ? value.trim().replace(/^@/, "") : "";
  if (!LOGIN.test(candidate) || candidate.includes("--")) throw invalid(`Not a GitHub ${what}`);
  return candidate;
}

function repositoryName(value: unknown): string {
  const name = typeof value === "string" ? value : "";
  if (!REPOSITORY.test(name) || name === "." || name === ".." || name.toLowerCase().endsWith(".git")) {
    throw invalid("A notebook name uses letters, digits, '.', '-' and '_', up to 100 of them");
  }
  return name;
}

function invitationId(value: string): number {
  if (!INVITATION_ID.test(value)) throw invalid("Not an invitation id");
  return Number(value);
}

async function jsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid("Expected a JSON object");
  return body as Record<string, unknown>;
}

export function createSharedNotebooksApi({ appUrl, readSession, github }: SharedNotebooksApiOptions): SharedNotebooksApi {
  async function signedIn(request: NextRequest): Promise<{ member: string; gitHub: SharedNotebooksGitHub }> {
    const session = await readSession(request.cookies);
    if (!session) throw new ApiFailure(401, "signed_out", "Sign in again");
    const member = session.member.login;
    return { member, gitHub: github.forMember({ login: member, accessToken: session.github.accessToken }) };
  }

  /** The shared notebook a route names. The member's personal notebook is never shared. */
  function sharedNotebook(member: string, owner: string, repo: string): NotebookRepository {
    const notebook = { owner: login(owner, "account"), repo: repositoryName(repo) };
    if (sameLogin(notebook.owner, member) && notebook.repo.toLowerCase() === PERSONAL_NOTEBOOK_NAME) {
      throw invalid("Your personal notebook stays private");
    }
    return notebook;
  }

  async function notebooksRoute(request: NextRequest, path: string[]): Promise<Response> {
    const { member, gitHub } = await signedIn(request);
    const { method } = request;

    if (path.length === 0 && method === "GET") {
      const listed: NotebooksResponse = { notebooks: await gitHub.listNotebooks() };
      return reply(listed);
    }

    if (path.length === 0 && method === "POST") {
      const name = repositoryName((await jsonBody(request)).name);
      if (name.toLowerCase() === PERSONAL_NOTEBOOK_NAME) throw invalid(`${PERSONAL_NOTEBOOK_NAME} is your personal notebook`);
      const outcome = await gitHub.createSharedNotebook(name);
      if (outcome.status === "name-taken") throw new ApiFailure(409, "name_taken", `You already have a repository named ${name}`);
      const created: NotebookResponse = { notebook: outcome.notebook };
      return reply(created, 201);
    }

    const [owner = "", repo = "", resource, item, ...rest] = path;
    if (rest.length > 0 || resource === undefined) throw new ApiFailure(404, "not_found", "No such route");
    const notebook = sharedNotebook(member, owner, repo);
    const owned = sameLogin(notebook.owner, member);

    if (resource === "collaborators" && item === undefined && method === "GET") {
      const listed: CollaboratorsResponse = { collaborators: await gitHub.listCollaborators(notebook) };
      return reply(listed);
    }

    if (resource === "collaborators" && item !== undefined && method === "DELETE") {
      const username = login(item, "username");
      if (sameLogin(username, notebook.owner)) throw invalid("The owner can't be removed from their notebook");
      await gitHub.removeCollaborator(notebook, username);
      return done();
    }

    if (resource === "invitations" && item === undefined && method === "GET") {
      const listed: InvitationsResponse = { invitations: await gitHub.listInvitations(notebook) };
      return reply(listed);
    }

    if (resource === "invitations" && item === undefined && method === "POST") {
      const username = login((await jsonBody(request)).username, "username");
      if (sameLogin(username, notebook.owner)) throw invalid("The owner already has this notebook");
      const outcome = await gitHub.inviteCollaborator(notebook, username);
      if (outcome.status === "no-such-user") throw new ApiFailure(404, "no_such_user", `GitHub has no user ${username}`);
      const invited: InviteResponse = outcome;
      return reply(invited, outcome.status === "invited" ? 201 : 200);
    }

    if (resource === "invitations" && item !== undefined && method === "DELETE") {
      await gitHub.cancelInvitation(notebook, invitationId(item));
      return done();
    }

    if (resource === "leave" && item === undefined && method === "POST") {
      if (owned) throw invalid("You own this notebook, so you can't leave it");
      await gitHub.leaveNotebook(notebook);
      return done();
    }

    throw new ApiFailure(404, "not_found", "No such route");
  }

  async function invitationsRoute(request: NextRequest, path: string[]): Promise<Response> {
    const { gitHub } = await signedIn(request);

    if (path.length === 0 && request.method === "GET") {
      const listed: InvitationsResponse = { invitations: await gitHub.listMyInvitations() };
      return reply(listed);
    }

    if (path.length === 2 && path[1] === "accept" && request.method === "POST") {
      await gitHub.acceptInvitation(invitationId(path[0]));
      return done();
    }

    throw new ApiFailure(404, "not_found", "No such route");
  }

  async function route(request: NextRequest): Promise<Response> {
    if (request.method !== "GET") {
      // A cross-site page can't read these routes' answers, but it mustn't change anything either.
      const origin = request.headers.get("origin");
      if (origin !== null && origin !== appUrl.origin) throw new ApiFailure(403, "forbidden", "Cross-site request");
    }

    const [area, ...path] = request.nextUrl.pathname
      .replace(/^\/api\/?/, "")
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    if (area === "notebooks") return notebooksRoute(request, path);
    if (area === "invitations") return invitationsRoute(request, path);
    throw new ApiFailure(404, "not_found", "No such route");
  }

  return {
    handle: async (request) => {
      try {
        return await route(request);
      } catch (error) {
        if (error instanceof ApiFailure) return failed(error);
        if (error instanceof GitHubError) return failed(fromGitHub(error));
        if (error instanceof URIError) return failed(invalid("Malformed path"));
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
  if (error.status === 403) return new ApiFailure(403, "forbidden", "Only the notebook's owner can do that");
  if (error.status === 404) return new ApiFailure(404, "not_found", "GitHub has no such notebook or invitation");
  if (error.status === 422) return new ApiFailure(422, "rejected", error.message);
  // Logged without anything from the request: no tokens, no names.
  console.error(`GitHub request failed: ${error.status} ${error.message}`);
  return new ApiFailure(502, "github_unavailable", "GitHub couldn't be reached");
}
