import { describe, expect, it } from "vitest";
import { createWorld } from "@/test/devices";

// The notebook routes serve every notebook a member can open: their personal
// notebook, and any repository tagged as a notebook they own or collaborate on.

const owner = "octo-alice";
const collaborator = "octo-bob";
const topic = "gh-notepad-notebook";

describe("notebook routes for shared notebooks", () => {
  it("serve a shared notebook the member collaborates on", async () => {
    const world = createWorld({ members: [owner, collaborator] });
    world.github.addRepo({ owner, name: "book-club", topics: [topic], files: { "Plan.md": "Read\n" }, collaborators: [collaborator] });
    const bob = await world.signIn(collaborator);

    const head = await world.callApi(`/api/notebooks/${owner}/book-club/head?branch=main`, { as: bob });

    expect(head.status).toBe(200);
    const { commit } = (await head.json()) as { commit: string };
    const files = await world.callApi(`/api/notebooks/${owner}/book-club/files?commit=${commit}`, { as: bob });
    expect(files.status).toBe(200);
    expect(await files.json()).toEqual({ files: [{ path: "Plan.md", sha: expect.any(String) }] });
  });

  it("serve a shared notebook its owner opens by name", async () => {
    const world = createWorld({ members: [owner, collaborator] });
    world.github.addRepo({ owner, name: "book-club", topics: [topic], files: { "Plan.md": "Read\n" } });
    const alice = await world.signIn(owner);

    const head = await world.callApi(`/api/notebooks/${owner}/book-club/head?branch=main`, { as: alice });

    expect(head.status).toBe(200);
  });

  it("refuse a repository the member can open that isn't a notebook, reading nothing from it", async () => {
    const world = createWorld({ members: [owner, collaborator] });
    world.github.addRepo({ owner, name: "dotfiles", files: { "Secrets.md": "shh\n" }, collaborators: [collaborator] });
    const bob = await world.signIn(collaborator);
    const before = world.github.requests().length;

    const head = await world.callApi(`/api/notebooks/${owner}/dotfiles/head?branch=main`, { as: bob });

    expect(head.status).toBe(404);
    expect(await head.json()).toMatchObject({ error: "not_found" });
    // GitHub was asked only whether the repository is a notebook.
    expect(world.github.requests().slice(before)).toEqual([{ method: "GET", path: `/repos/${owner}/dotfiles`, status: 200 }]);
  });

  it("refuse a notebook the member was removed from", async () => {
    const world = createWorld({ members: [owner, collaborator] });
    world.github.addRepo({ owner, name: "book-club", topics: [topic], files: { "Plan.md": "Read\n" }, collaborators: [collaborator] });
    const alice = await world.signIn(owner);
    const bob = await world.signIn(collaborator);
    expect((await world.callApi(`/api/notebooks/${owner}/book-club/head?branch=main`, { as: bob })).status).toBe(200);

    const removal = await world.callApi(`/api/notebooks/${owner}/book-club/collaborators/${collaborator}`, {
      method: "DELETE",
      as: alice,
    });
    expect(removal.status).toBe(204);

    const head = await world.callApi(`/api/notebooks/${owner}/book-club/head?branch=main`, { as: bob });
    expect(head.status).toBe(404);
  });
});
