import { apiError, json, paginate, type FakeRoute } from "../router";
import {
  authenticate,
  canWrite,
  findUser,
  inviteCollaborator,
  isAdmin,
  isCollaborator,
  removeCollaborator,
  type FakeUser,
} from "../state";
import { invitationJson } from "./invitations";
import { accessRepo } from "./repos";
import { simpleUserJson } from "./users";

/**
 * Collaborators (https://docs.github.com/en/rest/collaborators/collaborators)
 * on a personal account's repository: the owner invites people (creating an
 * invitation they must accept) and removes them; collaborators can push, see
 * each other, and remove themselves.
 */

function collaboratorJson(user: FakeUser, admin: boolean, apiOrigin: string) {
  return {
    ...simpleUserJson(user, apiOrigin),
    permissions: { pull: true, triage: true, push: true, maintain: admin, admin },
    role_name: admin ? "admin" : "write",
  };
}

const adminRequired = () => apiError(403, "Must have admin rights to Repository.");
const pushRequired = () => apiError(403, "Must have push access to view repository collaborators.");

export const collaboratorRoutes: FakeRoute[] = [
  {
    method: "GET",
    path: "/repos/:owner/:repo/collaborators",
    handle: (context) => {
      const access = accessRepo(context, "read");
      if ("response" in access) return access.response;
      const { repo } = access;
      if (!canWrite(authenticate(context.state, context.request), repo)) return pushRequired();
      const owner = findUser(context.state, repo.owner);
      const everyone = [
        ...(owner ? [collaboratorJson(owner, true, context.url.origin)] : []),
        ...[...repo.collaborators.values()].map((user) => collaboratorJson(user, false, context.url.origin)),
      ];
      const page = paginate(everyone, context.url);
      return json(page.items, { headers: page.headers });
    },
  },
  {
    method: "GET",
    path: "/repos/:owner/:repo/collaborators/:username",
    handle: (context) => {
      const access = accessRepo(context, "read");
      if ("response" in access) return access.response;
      const { repo } = access;
      if (!canWrite(authenticate(context.state, context.request), repo)) return pushRequired();
      const { username } = context.params;
      const collaborates = username.toLowerCase() === repo.owner.toLowerCase() || isCollaborator(repo, username);
      return collaborates ? new Response(null, { status: 204 }) : apiError(404, "Not Found");
    },
  },
  {
    method: "PUT",
    path: "/repos/:owner/:repo/collaborators/:username",
    handle: (context) => {
      const access = accessRepo(context, "read");
      if ("response" in access) return access.response;
      const { repo } = access;
      if (!isAdmin(authenticate(context.state, context.request), repo)) return adminRequired();
      const invitee = findUser(context.state, context.params.username);
      if (!invitee) return apiError(404, "Not Found");
      if (invitee.login.toLowerCase() === repo.owner.toLowerCase()) {
        return json(
          {
            message: "Validation Failed",
            errors: [{ resource: "Repository", code: "custom", message: "Repository owner cannot be a collaborator" }],
            documentation_url: "https://docs.github.com/rest/collaborators/collaborators#add-a-repository-collaborator",
            status: "422",
          },
          { status: 422 },
        );
      }
      const invitation = inviteCollaborator(context.state, repo, invitee);
      if (!invitation) return new Response(null, { status: 204 });
      return json(invitationJson(context.state, invitation, context.url.origin), { status: 201 });
    },
  },
  {
    method: "DELETE",
    path: "/repos/:owner/:repo/collaborators/:username",
    handle: (context) => {
      const access = accessRepo(context, "read");
      if ("response" in access) return access.response;
      const user = authenticate(context.state, context.request);
      const { username } = context.params;
      // The owner removes anyone; a collaborator may remove only themselves (leaving).
      const self = !!user && user.login.toLowerCase() === username.toLowerCase();
      if (!isAdmin(user, access.repo) && !self) return adminRequired();
      removeCollaborator(access.repo, username);
      return new Response(null, { status: 204 });
    },
  },
];
