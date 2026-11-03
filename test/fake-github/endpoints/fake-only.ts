import { apiError, escapeHtml, json, type FakeRoute } from "../router";
import { accessTokensFor, addUser, findUser } from "../state";
import { userJson } from "./users";

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
