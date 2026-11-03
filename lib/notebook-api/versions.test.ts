import { describe, expect, it } from "vitest";
import type { FileAtResponse, VersionsResponse } from "@/lib/remote";
import { createWorld } from "@/test/devices";

const member = "octo-member";
const notebook = "my-notes";

/** A note's life in the notebook: written, renamed, moved twice and edited along the way, outside the app. */
function seedHistory(world: ReturnType<typeof createWorld>) {
  const edit = (message: string, files: Record<string, string | null>, date: string) =>
    world.github.commitFiles(member, notebook, { message, files, date });
  world.github.addRepo({ owner: member, name: notebook, files: { "README.md": "# my-notes\n" } });
  return [
    edit("Add Draft", { "Draft.md": "one\n" }, "2026-01-01T09:00:00Z"),
    edit("Edit Draft", { "Draft.md": "one\ntwo\n" }, "2026-01-01T09:05:00Z"),
    edit("Rename to Ideas", { "Draft.md": null, "Ideas.md": "one\ntwo\n" }, "2026-01-02T09:00:00Z"),
    edit("Move to Projects", { "Ideas.md": null, "Projects/Ideas.md": "one\ntwo\nthree\n" }, "2026-01-03T09:00:00Z"),
    edit("Edit Other", { "Other.md": "unrelated\n" }, "2026-01-03T09:01:00Z"),
    edit("Move to Archive", { "Projects/Ideas.md": null, "Archive/Ideas.md": "one\ntwo\nthree\n" }, "2026-01-04T09:00:00Z"),
    edit("Edit in Archive", { "Archive/Ideas.md": "one\ntwo\nthree\nfour\n" }, "2026-01-04T09:02:00Z"),
  ];
}

const versionsPath = (path: string) =>
  `/api/notebooks/${member}/${notebook}/versions?${new URLSearchParams({ branch: "main", path })}`;
const filePath = (commit: string, path: string) =>
  `/api/notebooks/${member}/${notebook}/file?${new URLSearchParams({ commit, path })}`;

describe("version routes", () => {
  it("list every version of a note that was renamed and moved twice, following each rename back", async () => {
    const world = createWorld();
    const shas = seedHistory(world);
    const laptop = await world.signIn(member);

    const response = await world.callApi(versionsPath("Archive/Ideas.md"), { as: laptop });
    const { versions } = (await response.json()) as VersionsResponse;

    expect(response.status).toBe(200);
    expect(versions.map(({ commit, path, message }) => ({ commit, path, message }))).toEqual([
      { commit: shas[6], path: "Archive/Ideas.md", message: "Edit in Archive" },
      { commit: shas[5], path: "Archive/Ideas.md", message: "Move to Archive" },
      { commit: shas[3], path: "Projects/Ideas.md", message: "Move to Projects" },
      { commit: shas[2], path: "Ideas.md", message: "Rename to Ideas" },
      { commit: shas[1], path: "Draft.md", message: "Edit Draft" },
      { commit: shas[0], path: "Draft.md", message: "Add Draft" },
    ]);
    expect(versions[0]).toMatchObject({ date: "2026-01-04T09:02:00Z", author: member });
  });

  it("list nothing for a path the notebook never had", async () => {
    const world = createWorld();
    seedHistory(world);
    const laptop = await world.signIn(member);

    const response = await world.callApi(versionsPath("Never.md"), { as: laptop });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ versions: [] });
  });

  it("serve a note's text at a commit, under the path it had then, and 404 where that commit has none", async () => {
    const world = createWorld();
    const shas = seedHistory(world);
    const laptop = await world.signIn(member);

    const then = await world.callApi(filePath(shas[3], "Projects/Ideas.md"), { as: laptop });
    const gone = await world.callApi(filePath(shas[3], "Ideas.md"), { as: laptop });

    expect(then.status).toBe(200);
    expect((await then.json()) as FileAtResponse).toEqual({ text: "one\ntwo\nthree\n" });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ error: "not_found" });
  });

  it.each([
    ["an unsafe path", versionsPath("../secrets.md")],
    ["a path outside the notes", versionsPath(".git/config")],
    ["an invalid branch", `/api/notebooks/${member}/${notebook}/versions?branch=..&path=Ideas.md`],
    ["an invalid commit", filePath("not-a-sha", "Ideas.md")],
    ["an unsafe file path", filePath("0".repeat(40), "/etc/passwd")],
  ])("refuse %s before asking GitHub", async (_, path) => {
    const world = createWorld();
    seedHistory(world);
    const laptop = await world.signIn(member);
    const before = world.github.requests().length;

    const response = await world.callApi(path, { as: laptop });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid" });
    expect(world.github.requests().slice(before)).toEqual([]);
  });

  it("refuse a request without a session", async () => {
    const world = createWorld();
    seedHistory(world);

    const response = await world.callApi(versionsPath("Archive/Ideas.md"));

    expect(response.status).toBe(401);
  });
});
