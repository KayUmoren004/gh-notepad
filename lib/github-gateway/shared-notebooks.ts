import "server-only";
import { GitHubError, record, text, type ApiCall } from "./http";
import { PERSONAL_NOTEBOOK } from "./notebooks";

/**
 * The GitHub side of shared notebooks (ADR 0004, research §6): creating them,
 * finding every notebook a member can open, and managing who collaborates.
 * GitHub is the permission system: a collaborator is whoever GitHub says has
 * access, and on a personal account's repository every collaborator can push.
 */

/** The topic that marks a repository as a notebook. GitHub saves topics lowercase. */
export const NOTEBOOK_TOPIC = "gh-notepad-notebook";

const SHARED_NOTEBOOK_DESCRIPTION = "A shared notebook, kept by gh-notepad";

/** Pages of 100 (GitHub's maximum), and a bound so a misbehaving `Link` header can't loop forever. */
const PER_PAGE = 100;
const MAX_PAGES = 50;

/** A notebook the member can open. */
export interface Notebook {
  owner: string;
  repo: string;
  /** The branch the app reads and writes: the repository's default branch. */
  branch: string;
  /** `personal` for the member's own `my-notes`; every other notebook is shared. */
  kind: "personal" | "shared";
  /** Whether the member owns the notebook (and manages its collaborators) or collaborates on it. */
  role: "owner" | "collaborator";
}

/** Which notebook an operation acts on. */
export type NotebookRepository = Pick<Notebook, "owner" | "repo">;

export interface Collaborator {
  login: string;
  avatarUrl: string;
  role: "owner" | "collaborator";
}

/** An open invitation to collaborate on a notebook, until the invitee accepts it or it is cancelled. */
export interface NotebookInvitation {
  id: number;
  notebook: NotebookRepository;
  invitee: string;
  inviter: string;
  /** ISO 8601, as GitHub sent it. */
  createdAt: string;
  /** GitHub expires pending invitations after 7 days; an expired one can't be accepted. */
  expired: boolean;
}

export type CreateNotebookOutcome = { status: "created"; notebook: Notebook } | { status: "name-taken" };

export type InviteOutcome =
  | { status: "invited"; invitation: NotebookInvitation }
  /** They can already open the notebook; GitHub sent no invitation. */
  | { status: "already-collaborator" }
  /** GitHub has no account by that username. */
  | { status: "no-such-user" };

/** Shared-notebook operations on GitHub, acting as one signed-in member. */
export interface SharedNotebooksGitHub {
  /** Every notebook the member owns or collaborates on: repositories tagged with the notebook topic, plus the personal notebook. */
  listNotebooks: () => Promise<Notebook[]>;
  /** A private repository in the member's account, with an initial commit, tagged as a notebook. */
  createSharedNotebook: (name: string) => Promise<CreateNotebookOutcome>;
  /** The owner and every collaborator. Any collaborator may ask. */
  listCollaborators: (notebook: NotebookRepository) => Promise<Collaborator[]>;
  /** Invites a GitHub user to collaborate; only the notebook's owner may. GitHub notifies the invitee. */
  inviteCollaborator: (notebook: NotebookRepository, username: string) => Promise<InviteOutcome>;
  /** The notebook's open invitations; only its owner may ask. */
  listInvitations: (notebook: NotebookRepository) => Promise<NotebookInvitation[]>;
  cancelInvitation: (notebook: NotebookRepository, invitationId: number) => Promise<void>;
  /** Open invitations addressed to the member, to any repository: GitHub shows an invitee neither its topics nor its files until they accept. */
  listMyInvitations: () => Promise<NotebookInvitation[]>;
  acceptInvitation: (invitationId: number) => Promise<void>;
  /** Takes away a collaborator's access; only the notebook's owner may. */
  removeCollaborator: (notebook: NotebookRepository, username: string) => Promise<void>;
  /** Removes the member's own access to a notebook someone else owns. */
  leaveNotebook: (notebook: NotebookRepository) => Promise<void>;
}

const segment = encodeURIComponent;

function repoPath({ owner, repo }: NotebookRepository): string {
  return `/repos/${segment(owner)}/${segment(repo)}`;
}

function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The `rel="next"` URL of a `Link` header, if any. */
function nextLink(response: Response): string | undefined {
  const header = response.headers.get("link") ?? "";
  return /<([^>]+)>;\s*rel="next"/.exec(header)?.[1];
}

function invitationFrom(value: unknown): NotebookInvitation {
  const body = record(value);
  const repository = record(body.repository);
  const owner = text(record(repository.owner).login);
  const repo = text(repository.name);
  const invitee = text(record(body.invitee).login);
  const inviter = text(record(body.inviter).login);
  const createdAt = text(body.created_at);
  if (typeof body.id !== "number" || !owner || !repo || !invitee || !inviter || !createdAt) {
    throw new GitHubError("Unexpected repository invitation", 502);
  }
  return { id: body.id, notebook: { owner, repo }, invitee, inviter, createdAt, expired: body.expired === true };
}

export function sharedNotebooksGitHub(api: ApiCall, login: string): SharedNotebooksGitHub {
  /**
   * Every item of a paginated list. Each next page is fetched by its path and
   * query only, so a `Link` header can never send the member's token elsewhere.
   */
  async function all(path: string): Promise<unknown[]> {
    const items: unknown[] = [];
    let next: string | undefined = `${path}${path.includes("?") ? "&" : "?"}per_page=${PER_PAGE}`;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const response = await api(next);
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new GitHubError(`Unexpected response from ${path}`, 502);
      items.push(...body);
      const link = nextLink(response);
      next = link ? new URL(link).pathname + new URL(link).search : undefined;
    }
    return items;
  }

  function notebookFrom(value: unknown): Notebook | null {
    const body = record(value);
    const owner = text(record(body.owner).login);
    const repo = text(body.name);
    const branch = text(body.default_branch);
    if (!owner || !repo || !branch) throw new GitHubError("Unexpected repository response", 502);
    const topics = Array.isArray(body.topics) ? body.topics : [];
    const owned = sameLogin(owner, login);
    // The personal notebook is a notebook whether or not it carries the topic.
    const personal = owned && repo.toLowerCase() === PERSONAL_NOTEBOOK;
    if (!personal && !topics.includes(NOTEBOOK_TOPIC)) return null;
    return { owner, repo, branch, kind: personal ? "personal" : "shared", role: owned ? "owner" : "collaborator" };
  }

  async function exists(path: string): Promise<boolean> {
    try {
      await api(path);
      return true;
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return false;
      throw error;
    }
  }

  return {
    listNotebooks: async () => {
      const repos = await all("/user/repos?affiliation=owner,collaborator");
      return repos.map(notebookFrom).filter((notebook) => notebook !== null);
    },

    createSharedNotebook: async (name) => {
      let created: Record<string, unknown>;
      try {
        // `auto_init` gives the repository its first commit: the Git Data API refuses empty repositories.
        const response = await api("/user/repos", {
          method: "POST",
          body: { name, description: SHARED_NOTEBOOK_DESCRIPTION, private: true, auto_init: true },
        });
        created = record(await response.json());
      } catch (error) {
        // GitHub's 422 doesn't say which rule failed; a repository already there by that name does.
        if (error instanceof GitHubError && error.status === 422 && (await exists(repoPath({ owner: login, repo: name })))) {
          return { status: "name-taken" };
        }
        throw error;
      }
      const notebook = notebookFrom({ ...created, topics: [NOTEBOOK_TOPIC] });
      if (!notebook) throw new GitHubError("Unexpected repository response", 502);
      await api(`${repoPath(notebook)}/topics`, { method: "PUT", body: { names: [NOTEBOOK_TOPIC] } });
      return { status: "created", notebook };
    },

    listCollaborators: async (notebook) => {
      const people = await all(`${repoPath(notebook)}/collaborators`);
      return people.map((value) => {
        const body = record(value);
        const person = text(body.login);
        if (!person) throw new GitHubError("Unexpected collaborator", 502);
        const role = sameLogin(person, notebook.owner) ? "owner" : "collaborator";
        return { login: person, avatarUrl: text(body.avatar_url) ?? "", role };
      });
    },

    inviteCollaborator: async (notebook, username) => {
      let response: Response;
      try {
        response = await api(`${repoPath(notebook)}/collaborators/${segment(username)}`, { method: "PUT" });
      } catch (error) {
        // A 404 means the notebook or the user; only the user's absence is worth telling apart.
        if (error instanceof GitHubError && error.status === 404 && !(await exists(`/users/${segment(username)}`))) {
          return { status: "no-such-user" };
        }
        throw error;
      }
      if (response.status === 204) return { status: "already-collaborator" };
      return { status: "invited", invitation: invitationFrom(await response.json()) };
    },

    listInvitations: async (notebook) => (await all(`${repoPath(notebook)}/invitations`)).map(invitationFrom),

    cancelInvitation: async (notebook, invitationId) => {
      await api(`${repoPath(notebook)}/invitations/${invitationId}`, { method: "DELETE" });
    },

    listMyInvitations: async () => (await all("/user/repository_invitations")).map(invitationFrom),

    acceptInvitation: async (invitationId) => {
      await api(`/user/repository_invitations/${invitationId}`, { method: "PATCH" });
    },

    removeCollaborator: async (notebook, username) => {
      await api(`${repoPath(notebook)}/collaborators/${segment(username)}`, { method: "DELETE" });
    },

    leaveNotebook: async (notebook) => {
      // GitHub lets a collaborator remove themselves, which is all leaving is.
      await api(`${repoPath(notebook)}/collaborators/${segment(login)}`, { method: "DELETE" });
    },
  };
}
