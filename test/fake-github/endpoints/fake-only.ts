import { apiError, escapeHtml, json, type FakeRoute } from "../router";
import { accessTokensFor, addRepo, addUser, commitFiles, findRepo, findUser, readFiles } from "../state";
import { repoJson } from "./repos";
import { userJson } from "./users";

async function readObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** A `{ path: content }` map; with `nullable`, `null` (delete) is allowed too. */
function fileMap(value: unknown, nullable: boolean): Record<string, string | null> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const files = value as Record<string, unknown>;
  const valid = Object.values(files).every((content) => typeof content === "string" || (nullable && content === null));
  return valid ? (files as Record<string, string | null>) : null;
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
    handle: async ({ request, url, state }) => {
      const body = await readObject(request);
      const files = body.files === undefined ? undefined : fileMap(body.files, false);
      if (typeof body.owner !== "string" || typeof body.name !== "string" || files === null) {
        return apiError(422, "Validation Failed: owner, name and files ({ path: content }) are required");
      }
      const repo = addRepo(state, {
        owner: body.owner,
        name: body.name,
        private: body.private !== false,
        files: files as Record<string, string> | undefined,
      });
      return json(repoJson(state, repo, url.origin), { status: 201 });
    },
  },
  {
    method: "POST",
    path: "/_fake/repos/:owner/:repo/commits",
    handle: async ({ request, params, state }) => {
      const repo = findRepo(state, params.owner, params.repo);
      if (!repo) return apiError(404, "Not Found");
      const body = await readObject(request);
      const files = fileMap(body.files, true);
      if (typeof body.message !== "string" || !files) {
        return apiError(422, "Validation Failed: message and files ({ path: content | null }) are required");
      }
      return json({ sha: commitFiles(state, repo, { message: body.message, files }) }, { status: 201 });
    },
  },
  {
    method: "GET",
    path: "/_fake/repos/:owner/:repo/files",
    handle: ({ params, state }) => {
      const repo = findRepo(state, params.owner, params.repo);
      return repo ? json(readFiles(repo)) : apiError(404, "Not Found");
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
