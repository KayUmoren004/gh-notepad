import { apiError, json, paginate, type FakeRoute } from "../router";
import {
  acceptInvitation,
  authenticate,
  invitationExpired,
  invitationsFor,
  invitationsTo,
  isAdmin,
  type FakeInvitation,
  type FakeState,
} from "../state";
import { accessRepo, minimalRepoJson } from "./repos";
import { simpleUserJson } from "./users";

/**
 * Repository invitations (https://docs.github.com/en/rest/collaborators/invitations):
 * the owner lists and cancels a repository's open invitations; the invitee
 * lists theirs and accepts or declines them. Invitations are created by
 * inviting a collaborator (see `collaborators.ts`) and expire after 7 days.
 */

/** GitHub's timestamps carry no milliseconds. */
function timestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function invitationJson(state: FakeState, invitation: FakeInvitation, apiOrigin: string) {
  const repo = state.repos.get(invitation.repo);
  if (!repo) throw new Error(`Invitation ${invitation.id} names a missing repository`);
  return {
    id: invitation.id,
    node_id: invitation.nodeId,
    repository: minimalRepoJson(state, repo, apiOrigin),
    invitee: simpleUserJson(invitation.invitee, apiOrigin),
    inviter: simpleUserJson(invitation.inviter, apiOrigin),
    // Personal accounts' repositories have one collaborator permission: write.
    permissions: "write",
    created_at: timestamp(invitation.createdAt),
    expired: invitationExpired(state, invitation),
    url: `${apiOrigin}/user/repository_invitations/${invitation.id}`,
    html_url: `${apiOrigin}/${repo.owner}/${repo.name}/invitations`,
  };
}

const adminRequired = () => apiError(403, "Must have admin rights to Repository.");

/** The open invitation `:invitation_id` addressed to the caller, or `undefined`. */
function ownInvitation(state: FakeState, request: Request, id: string): FakeInvitation | undefined {
  const user = authenticate(state, request);
  const invitation = state.invitations.get(Number(id));
  return user && invitation && invitation.invitee.login.toLowerCase() === user.login.toLowerCase()
    ? invitation
    : undefined;
}

export const invitationRoutes: FakeRoute[] = [
  {
    method: "GET",
    path: "/repos/:owner/:repo/invitations",
    handle: (context) => {
      const access = accessRepo(context, "read");
      if ("response" in access) return access.response;
      if (!isAdmin(authenticate(context.state, context.request), access.repo)) return adminRequired();
      const page = paginate(invitationsTo(context.state, access.repo), context.url);
      return json(
        page.items.map((invitation) => invitationJson(context.state, invitation, context.url.origin)),
        { headers: page.headers },
      );
    },
  },
  {
    method: "DELETE",
    path: "/repos/:owner/:repo/invitations/:invitation_id",
    handle: (context) => {
      const access = accessRepo(context, "read");
      if ("response" in access) return access.response;
      if (!isAdmin(authenticate(context.state, context.request), access.repo)) return adminRequired();
      const invitation = invitationsTo(context.state, access.repo).find(
        ({ id }) => id === Number(context.params.invitation_id),
      );
      if (!invitation) return apiError(404, "Not Found");
      context.state.invitations.delete(invitation.id);
      return new Response(null, { status: 204 });
    },
  },
  {
    method: "GET",
    path: "/user/repository_invitations",
    handle: ({ request, url, state }) => {
      const user = authenticate(state, request);
      if (!user) return apiError(401, "Requires authentication");
      const page = paginate(invitationsFor(state, user.login), url);
      return json(
        page.items.map((invitation) => invitationJson(state, invitation, url.origin)),
        { headers: page.headers },
      );
    },
  },
  {
    method: "PATCH",
    path: "/user/repository_invitations/:invitation_id",
    handle: ({ request, params, state }) => {
      if (!authenticate(state, request)) return apiError(401, "Requires authentication");
      const invitation = ownInvitation(state, request, params.invitation_id);
      // An expired invitation can't be accepted; the owner has to invite again.
      if (!invitation || invitationExpired(state, invitation)) return apiError(404, "Not Found");
      acceptInvitation(state, invitation);
      return new Response(null, { status: 204 });
    },
  },
  {
    method: "DELETE",
    path: "/user/repository_invitations/:invitation_id",
    handle: ({ request, params, state }) => {
      if (!authenticate(state, request)) return apiError(401, "Requires authentication");
      const invitation = ownInvitation(state, request, params.invitation_id);
      if (!invitation) return apiError(404, "Not Found");
      state.invitations.delete(invitation.id);
      return new Response(null, { status: 204 });
    },
  },
];
