import { describe, expect, it } from "vitest";
import { readNote } from "@/lib/notebook-format";
import { createWorld } from "@/test/devices";

const member = "octo-member";
const notebook = "my-notes";

const groceries = "0b9e2c1a-5d7f-4a8e-9c3b-2f1e0d9c8b7a";
const roadmap = "7c4d1f2e-3b6a-4c9d-8e1f-0a2b3c4d5e6f";

/** A personal notebook as v1 left it: GitHub's README, `metadata.json`, and a JSON file per note. */
const v1Notebook: Record<string, string> = {
  "README.md": "# my-notes\nMy personal notes stored via gh-notepad\n",
  "metadata.json": JSON.stringify(
    { folders: ["Work", "Recipes"], tags: [{ name: "urgent", color: "#ef4444" }] },
    null,
    2,
  ),
  [`notes/${groceries}.json`]: JSON.stringify(
    {
      id: groceries,
      title: "Groceries",
      content: "- Milk\n- Bread\n",
      folder: null,
      tags: [],
      createdAt: "2024-01-01T09:00:00.000Z",
      updatedAt: "2024-01-02T18:30:00.000Z",
    },
    null,
    2,
  ),
  [`notes/${roadmap}.json`]: JSON.stringify(
    {
      id: roadmap,
      title: "Roadmap",
      content: "# Q1\n",
      folder: "Work",
      tags: ["urgent"],
      createdAt: "2024-02-01T10:00:00.000Z",
      updatedAt: "2024-02-03T11:15:00.000Z",
    },
    null,
    2,
  ),
};

/** The same notebook in the notebook format. */
const v2Notebook: Record<string, string> = {
  "Groceries.md": [
    "---",
    `id: ${groceries}`,
    "created: 2024-01-01T09:00:00.000Z",
    "updated: 2024-01-02T18:30:00.000Z",
    "---",
    "- Milk",
    "- Bread",
    "",
  ].join("\n"),
  "README.md": "# my-notes\nMy personal notes stored via gh-notepad\n",
  "Recipes/.gitkeep": "",
  "Work/Roadmap.md": [
    "---",
    `id: ${roadmap}`,
    "tags: [urgent]",
    "created: 2024-02-01T10:00:00.000Z",
    "updated: 2024-02-03T11:15:00.000Z",
    "---",
    "# Q1",
    "",
  ].join("\n"),
};

describe("migrating v1 notes", () => {
  it("converts a v1 notebook to the notebook format in one sync, as one commit", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: member, name: notebook, files: v1Notebook });
    const laptop = await world.signIn(member);

    await laptop.sync();

    expect(world.github.files(member, notebook)).toEqual(v2Notebook);
    const commits = world.github.commits(member, notebook);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      message: "Convert v1 notes to Markdown",
      files: [
        { path: "Groceries.md", status: "added" },
        { path: "Recipes/.gitkeep", status: "added" },
        { path: "Work/Roadmap.md", status: "added" },
        { path: "metadata.json", status: "removed" },
        { path: `notes/${groceries}.json`, status: "removed" },
        { path: `notes/${roadmap}.json`, status: "removed" },
      ],
    });
    expect(laptop.store.note(groceries)).toMatchObject({ title: "Groceries", folder: "", synced: true });
    expect(laptop.store.note(roadmap)).toMatchObject({ title: "Roadmap", folder: "Work", tags: ["urgent"], synced: true });
  });

  it("does nothing when it runs again, on this device or another", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: member, name: notebook, files: v1Notebook });
    const laptop = await world.signIn(member);
    await laptop.sync();
    const commits = world.github.commits(member, notebook);
    const before = world.github.requests().length;

    await laptop.sync();
    expect(world.github.requests().slice(before)).toEqual([
      { method: "GET", path: `/repos/${member}/${notebook}/commits/main`, status: 304 },
    ]);

    const reopened = await laptop.reopen();
    await reopened.sync();
    const phone = await world.signIn(member);
    await phone.sync();

    expect(world.github.commits(member, notebook)).toEqual(commits);
    expect(world.github.files(member, notebook)).toEqual(v2Notebook);
    expect([...phone.store.getState().notes.values()].map(({ id, path, synced }) => ({ id, path, synced }))).toEqual(
      expect.arrayContaining([
        { id: groceries, path: "Groceries.md", synced: true },
        { id: roadmap, path: "Work/Roadmap.md", synced: true },
      ]),
    );
    expect(phone.store.getState().notes.size).toBe(3);
  });

  it("converts again in one commit, without duplicates or lost edits, when the app closes before the commit", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: member, name: notebook, files: v1Notebook });
    const laptop = await world.signIn(member);

    // The commit never gets made: the app closes while it is on its way.
    const commit = world.holdGitHub((request) => request.method === "POST" && request.url.includes("/git/"));
    void laptop.sync();
    await commit.reached;
    laptop.store.editBody(groceries, "- Milk\n- Bread\n- Eggs\n");
    const reopened = await laptop.reopen();
    expect(reopened.store.note(groceries)).toMatchObject({ body: "- Milk\n- Bread\n- Eggs\n", synced: false });

    await reopened.sync();

    const files = world.github.files(member, notebook);
    expect(Object.keys(files).sort()).toEqual(Object.keys(v2Notebook).sort());
    expect(readNote(files["Groceries.md"])).toMatchObject({
      id: groceries,
      created: "2024-01-01T09:00:00.000Z",
      body: "- Milk\n- Bread\n- Eggs\n",
    });
    expect(files["Work/Roadmap.md"]).toBe(v2Notebook["Work/Roadmap.md"]);
    expect(world.github.commits(member, notebook).map((entry) => entry.message)).toEqual([
      "Convert v1 notes to Markdown",
      "Initial commit",
    ]);
    expect(reopened.store.getState().notes.size).toBe(3);
    expect(reopened.store.note(groceries)).toMatchObject({ body: "- Milk\n- Bread\n- Eggs\n", synced: true });
  });

  it("converts once when two devices convert at the same time", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: member, name: notebook, files: v1Notebook });
    const laptop = await world.signIn(member);
    const phone = await world.signIn(member);

    const phoneCommit = world.holdGitHub((request) => request.method === "PATCH" && request.url.includes("/git/refs/"));
    const phoneSync = phone.sync();
    await phoneCommit.reached;
    await laptop.sync();
    phoneCommit.release();
    await phoneSync;

    expect(world.github.files(member, notebook)).toEqual(v2Notebook);
    expect(world.github.commits(member, notebook).map((entry) => entry.message)).toEqual([
      "Convert v1 notes to Markdown",
      "Initial commit",
    ]);
    for (const device of [laptop, phone]) {
      expect(device.store.getState().notes.size).toBe(3);
      expect(device.store.note(roadmap)).toMatchObject({ path: "Work/Roadmap.md", synced: true });
    }
  });

  it("converts what it can and tells the member which files it couldn't read", async () => {
    const world = createWorld();
    world.github.addRepo({
      owner: member,
      name: notebook,
      files: { ...v1Notebook, "notes/broken.json": '{ "title": "Half a no' },
    });
    const laptop = await world.signIn(member);
    expect(laptop.engine.getMigrationReport()).toBeNull();

    await laptop.sync();

    expect(world.github.files(member, notebook)).toEqual(v2Notebook);
    const [latest] = world.github.commits(member, notebook);
    expect(latest.message).toBe(
      [
        "Convert v1 notes to Markdown",
        "",
        "Left out 1 file that couldn't be read; this notebook's history keeps them:",
        "- notes/broken.json: isn't valid JSON",
      ].join("\n"),
    );
    expect(laptop.engine.getMigrationReport()).toEqual({
      notebook: `${member}/${notebook}`,
      commit: latest.sha,
      skipped: [{ path: "notes/broken.json", reason: "isn't valid JSON" }],
    });
  });
});
