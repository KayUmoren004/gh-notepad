import { apiError, json, type FakeRoute } from "../router";
import { authenticate, findUser, type FakeState, type FakeUser } from "../state";

/** The REST representation of a user, as `GET /user` returns it. */
export function userJson(user: FakeUser, apiOrigin: string) {
  return {
    login: user.login,
    id: user.id,
    node_id: user.nodeId,
    // Served by the fake itself so end-to-end runs never reach the internet.
    avatar_url: `${apiOrigin}/_fake/avatars/${encodeURIComponent(user.login)}`,
    gravatar_id: "",
    url: `${apiOrigin}/users/${user.login}`,
    html_url: `${apiOrigin}/${user.login}`,
    type: "User",
    site_admin: false,
    name: user.name,
    created_at: user.createdAt,
    updated_at: user.createdAt,
  };
}

/** The simple user GitHub nests in other payloads (invitations, collaborators): no profile fields. */
export function simpleUserJson(user: FakeUser, apiOrigin: string) {
  const { login, id, node_id, avatar_url, gravatar_id, url, html_url, type, site_admin } = userJson(user, apiOrigin);
  return { login, id, node_id, avatar_url, gravatar_id, url, html_url, type, site_admin };
}

function scopesHeader(state: FakeState, request: Request): string {
  const token = /^(?:bearer|token)\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  return token ? (state.accessTokens.get(token)?.scopes.join(", ") ?? "") : "";
}

export const userRoutes: FakeRoute[] = [
  {
    method: "GET",
    path: "/user",
    handle: ({ request, url, state }) => {
      const user = authenticate(state, request);
      if (!user) return apiError(401, "Bad credentials");
      return json(userJson(user, url.origin), {
        headers: { "x-oauth-scopes": scopesHeader(state, request) },
      });
    },
  },
  {
    // A user's public profile (https://docs.github.com/en/rest/users/users#get-a-user), no token needed.
    method: "GET",
    path: "/users/:username",
    handle: ({ params, url, state }) => {
      const user = findUser(state, params.username);
      return user ? json(userJson(user, url.origin)) : apiError(404, "Not Found");
    },
  },
];
