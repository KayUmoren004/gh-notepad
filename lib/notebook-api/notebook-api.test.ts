import { describe, expect, it } from "vitest";
import { createWorld } from "@/test/devices";

const member = "octo-member";

describe("notebook routes", () => {
  it("refuse a request without a session, before asking GitHub anything", async () => {
    const world = createWorld();

    const response = await world.callApi("/api/notebooks/personal", { method: "POST" });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "signed_out" });
    expect(world.github.requests()).toEqual([]);
  });

  it("refuse a repository that isn't one of the member's notebooks", async () => {
    const world = createWorld({ members: [member, "octo-friend"] });
    world.github.addRepo({ owner: "octo-friend", name: "my-notes", private: false, files: { "Hi.md": "Hi\n" } });
    const laptop = await world.signIn(member);
    const before = world.github.requests().length;

    const theirs = await world.callApi("/api/notebooks/octo-friend/my-notes/head?branch=main", { as: laptop });
    const other = await world.callApi(`/api/notebooks/${member}/dotfiles/head?branch=main`, { as: laptop });

    expect(theirs.status).toBe(404);
    expect(other.status).toBe(404);
    expect(world.github.requests().slice(before)).toEqual([]);
  });

  it.each(["../escape.md", "/etc/passwd", ".git/config", "Recipes//Pancakes.md", "back\\slash.md"])(
    "refuse to commit the unsafe path %j before it reaches GitHub",
    async (path) => {
      const world = createWorld();
      const laptop = await world.signIn(member);
      await laptop.sync();
      const before = world.github.requests().length;

      const response = await world.callApi(`/api/notebooks/${member}/my-notes/commits`, {
        method: "POST",
        as: laptop,
        body: { branch: "main", base: "0".repeat(40), message: "Sneaky", changes: [{ path, content: "x" }] },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid" });
      expect(world.github.requests().slice(before)).toEqual([]);
    },
  );

  it("refuse writes posted from another site", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);

    const response = await world.callApi("/api/notebooks/personal", {
      method: "POST",
      as: laptop,
      headers: { origin: "https://elsewhere.example" },
    });

    expect(response.status).toBe(403);
    expect(world.github.repo(member, "my-notes")).toBeUndefined();
  });

  it("answer a commit made on a stale base as branch_moved, writing nothing", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();
    const [{ sha: stale }] = world.github.commits(member, "my-notes");
    world.github.commitFiles(member, "my-notes", { message: "Edit on github.com", files: { "Remote.md": "Hi\n" } });

    const response = await world.callApi(`/api/notebooks/${member}/my-notes/commits`, {
      method: "POST",
      as: laptop,
      body: { branch: "main", base: stale, message: "Late", changes: [{ path: "Late.md", content: "x" }] },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "branch_moved" });
    expect(Object.keys(world.github.files(member, "my-notes")).sort()).toEqual(["README.md", "Remote.md"]);
  });
});
