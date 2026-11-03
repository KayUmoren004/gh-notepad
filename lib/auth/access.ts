import { GitHubError, type SharedNotebooksGitHub } from "@/lib/github-gateway";

/**
 * Who may sign in (ADR 0004): the owner and the logins in the allow list.
 * GitHub logins are case-insensitive; a leading `@` is tolerated.
 */
export interface AccessList {
  /** The owner's login, whose notebook invitations also let people in. */
  owner: string;
  allows: (login: string) => boolean;
}

export function accessList(owner: string, allowed: string = ""): AccessList {
  const logins = new Set([owner, ...allowed.split(/[\s,]+/)].map(normalize).filter(Boolean));
  return { owner: owner.trim().replace(/^@/, ""), allows: (login) => logins.has(normalize(login)) };
}

function normalize(login: string): string {
  return login.trim().replace(/^@/, "").toLowerCase();
}

/**
 * The access gate's second check, for someone who isn't on the list: they may
 * sign in if they can open a notebook the owner owns. Invitations from anyone
 * else never count.
 *
 * Pending invitations from the owner are accepted first, so the member lands
 * in the notebook. Until an invitation is accepted GitHub shows the invitee
 * only who owns the repository, not its topics, so whether it is a notebook is
 * checked afterwards, against the notebooks the member can now open.
 */
export async function admittedByInvitation(github: SharedNotebooksGitHub, owner: string): Promise<boolean> {
  const isOwner = (login: string) => normalize(login) === normalize(owner);
  const invitations = await github.listMyInvitations();

  for (const invitation of invitations) {
    if (invitation.expired || !isOwner(invitation.notebook.owner)) continue;
    try {
      await github.acceptInvitation(invitation.id);
    } catch (error) {
      // Cancelled or expired since it was listed: it simply doesn't count.
      if (!(error instanceof GitHubError) || ![403, 404, 409].includes(error.status)) throw error;
    }
  }

  const notebooks = await github.listNotebooks();
  return notebooks.some((notebook) => notebook.role === "collaborator" && isOwner(notebook.owner));
}
