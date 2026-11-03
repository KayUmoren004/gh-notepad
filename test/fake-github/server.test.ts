import { afterEach, describe, expect, it } from "vitest";
import { connectFakeGitHub } from "./client";
import { startFakeGitHubServer, type FakeGitHubServer } from "./server";

let server: FakeGitHubServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("fake GitHub over HTTP", () => {
  it("reports healthy once listening", async () => {
    server = await startFakeGitHubServer({ port: 0 });

    const response = await fetch(`${server.url}/_fake/health`);

    expect(response.status).toBe(200);
  });

  it("runs the OAuth web flow for a user seeded through the control API", async () => {
    server = await startFakeGitHubServer({ port: 0 });
    const app = server.fake.addOAuthApp({ callbackUrl: "http://localhost:3100/api/auth/callback" });
    const control = connectFakeGitHub(server.url);
    await control.addUser({ login: "octo-member" });

    const authorize = new URL("/login/oauth/authorize", server.url);
    authorize.search = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: "http://localhost:3100/api/auth/callback",
      state: "s",
    }).toString();
    const chooser = await fetch(authorize);
    expect(await chooser.text()).toContain("Authorize as octo-member");

    const approve = await fetch(new URL("/login/oauth/authorize", server.url), {
      method: "POST",
      body: new URLSearchParams([...authorize.searchParams, ["login", "octo-member"]]),
      redirect: "manual",
    });
    expect(approve.status).toBe(302);
    const code = new URL(approve.headers.get("location") ?? "").searchParams.get("code") ?? "";

    const grant = await fetch(new URL("/login/oauth/access_token", server.url), {
      method: "POST",
      headers: { accept: "application/json" },
      body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, code }),
    }).then((response) => response.json() as Promise<{ access_token: string }>);

    expect(await control.accessTokensFor("octo-member")).toEqual([grant.access_token]);
    const user = await fetch(new URL("/user", server.url), {
      headers: { authorization: `Bearer ${grant.access_token}` },
    }).then((response) => response.json() as Promise<{ login: string; avatar_url: string }>);
    expect(user.login).toBe("octo-member");

    const avatar = await fetch(user.avatar_url);
    expect(avatar.status).toBe(200);
    expect(avatar.headers.get("content-type")).toContain("image/svg+xml");
  });
});
