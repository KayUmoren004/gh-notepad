import { apiError, escapeHtml, json, type FakeRoute } from "../router";
import { accessTokensFor, addRepo, addUser, findRepo, findUser, inviteCollaborator, type RepoSeed } from "../state";
import { userJson } from "./users";

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function repoSeed(value: unknown): RepoSeed | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.owner !== "string" || typeof body.name !== "string") return null;
  const files = body.files && typeof body.files === "object" ? (body.files as Record<string, unknown>) : undefined;
  return {
    owner: body.owner,
    name: body.name,
    private: typeof body.private === "boolean" ? body.private : undefined,
    topics: strings(body.topics) ? body.topics : undefined,
    collaborators: strings(body.collaborators) ? body.collaborators : undefined,
    files: files && Object.values(files).every((content) => typeof content === "string")
      ? (files as Record<string, string>)
      : undefined,
  };
}

/**
 * Endpoints real GitHub doesn't have, all under `/_fake/`: the control API that
 * end-to-end tests use to seed and inspect the fake over HTTP (see `client.ts`),
 * and the avatar images `avatar_url` points at.
 */
export const fakeOnlyRoutes: FakeRoute[] = [
  {
    method: "GET",
    path: "/_fake/health",
    handle: () => json({ ok: true }),
  },
  {
    method: "POST",
    path: "/_fake/users",
    handle: async ({ request, url, state }) => {
      const body: unknown = await request.json();
      if (!body || typeof body !== "object" || !("login" in body) || typeof body.login !== "string") {
        return apiError(422, "Validation Failed: login is required");
      }
      const name = "name" in body && typeof body.name === "string" ? body.name : null;
      return json(userJson(addUser(state, { login: body.login, name }), url.origin), { status: 201 });
    },
  },
  {
    method: "GET",
    path: "/_fake/users/:login/tokens",
    handle: ({ params, state }) => json(accessTokensFor(state, params.login)),
  },
  {
    method: "POST",
    path: "/_fake/repos",
    handle: async ({ request, state }) => {
      const seed = repoSeed(await request.json().catch(() => null));
      if (!seed) return apiError(422, "Validation Failed: owner and name are required");
      const repo = addRepo(state, seed);
      return json({ owner: repo.owner, name: repo.name }, { status: 201 });
    },
  },
  {
    method: "POST",
    path: "/_fake/repos/:owner/:repo/invitations",
    handle: async ({ request, params, state }) => {
      const repo = findRepo(state, params.owner, params.repo);
      const body: unknown = await request.json().catch(() => null);
      const invitee = body && typeof body === "object" && "invitee" in body ? body.invitee : undefined;
      if (!repo || typeof invitee !== "string") return apiError(404, "Not Found");
      // Idempotent, for retried tests: the open invitation again, or none once they collaborate.
      const invitation = inviteCollaborator(state, repo, addUser(state, { login: invitee }));
      return json({ id: invitation?.id ?? null }, { status: 201 });
    },
  },
  {
    method: "GET",
    path: "/_fake/repos/:owner/:repo/collaborators",
    handle: ({ params, state }) => {
      const repo = findRepo(state, params.owner, params.repo);
      return repo ? json([...repo.collaborators.values()].map((user) => user.login)) : apiError(404, "Not Found");
    },
  },
  {
    method: "GET",
    path: "/_fake/avatars/:login",
    handle: ({ params, state }) => {
      const user = findUser(state, params.login);
      if (!user) return apiError(404, "Not Found");
      const hue = [...user.login].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
      const initial = escapeHtml(user.login.charAt(0).toUpperCase());
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
        `<rect width="64" height="64" fill="hsl(${hue} 35% 40%)"/>` +
        `<text x="32" y="42" font-family="system-ui, sans-serif" font-size="28" fill="white" text-anchor="middle">${initial}</text>` +
        `</svg>`;
      return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } });
    },
  },
];
