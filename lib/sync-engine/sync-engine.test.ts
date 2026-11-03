import { describe, expect, it } from "vitest";
import { readNote } from "@/lib/notebook-format";
import { createWorld } from "@/test/devices";

const member = "octo-member";
const notebook = "my-notes";

describe("v1 regressions", () => {
  it("a new note typed into immediately reaches GitHub", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);

    const id = laptop.store.createNote();
    laptop.store.rename(id, "Groceries");
    laptop.store.editBody(id, "- Milk\n- Bread\n");
    await laptop.sync();

    const file = world.github.files(member, notebook)["Groceries.md"];
    expect(file).toBeDefined();
    expect(readNote(file)).toMatchObject({ id, body: "- Milk\n- Bread\n" });
    expect(laptop.store.note(id)).toMatchObject({ title: "Groceries", synced: true });
  });

  it("text typed while a sync is in flight survives it, and goes out with the next sync", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Draft");
    laptop.store.editBody(id, "First line\n");

    const commit = world.holdGitHub((request) => request.method === "PATCH" && request.url.includes("/git/refs/"));
    const syncing = laptop.sync();
    await commit.reached;
    laptop.store.editBody(id, "First line\nTyped during the sync\n");
    commit.release();
    await syncing;

    expect(laptop.store.note(id)).toMatchObject({ body: "First line\nTyped during the sync\n", synced: false });
    expect(readNote(world.github.files(member, notebook)["Draft.md"]).body).toBe("First line\n");

    await laptop.sync();
    expect(readNote(world.github.files(member, notebook)["Draft.md"]).body).toBe("First line\nTyped during the sync\n");
    expect(laptop.store.note(id)).toMatchObject({ synced: true });
  });

  it("text typed while a pull brings in other changes is not replaced by the notebook's copy", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Journal");
    laptop.store.editBody(id, "Monday\n");
    await laptop.sync();
    world.github.commitFiles(member, notebook, { message: "Add a note on github.com", files: { "Elsewhere.md": "Hi\n" } });

    const tree = world.holdGitHub((request) => request.method === "GET" && request.url.includes("/git/trees/"));
    const syncing = laptop.sync();
    await tree.reached;
    laptop.store.editBody(id, "Monday\nTuesday\n");
    tree.release();
    await syncing;

    expect(laptop.store.note(id)).toMatchObject({ body: "Monday\nTuesday\n" });
    expect(readNote(world.github.files(member, notebook)["Journal.md"]).body).toBe("Monday\nTuesday\n");
    expect([...laptop.store.getState().notes.values()].map((note) => note.title)).toContain("Elsewhere");
  });

  it("consecutive saves never send stale versions", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Counter");

    for (const body of ["one\n", "two\n", "three\n"]) {
      laptop.store.editBody(id, body);
      await laptop.sync();
    }

    expect(readNote(world.github.files(member, notebook)["Counter.md"]).body).toBe("three\n");
    expect(world.github.commits(member, notebook).map((commit) => commit.message)).toEqual([
      'Update "Counter"',
      'Update "Counter"',
      'Add "Counter"',
      "Initial commit",
    ]);
    // v1's symptom: GitHub rejecting writes made against a version it no longer had.
    expect(world.github.requests().filter((request) => request.method !== "GET" && request.status >= 400)).toEqual([]);
    expect(laptop.store.note(id)).toMatchObject({ synced: true });
  });

  it("a note keeps its identity across its first sync, on this device and the next", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Plans");
    const before = laptop.store.note(id);

    await laptop.sync();

    expect(laptop.store.note(id)).toMatchObject({ id, title: "Plans", path: "Plans.md", created: before?.created });
    expect([...laptop.store.getState().notes.values()].filter((note) => note.title === "Plans")).toHaveLength(1);
    const phone = await world.signIn(member);
    await phone.sync();
    expect(phone.store.note(id)).toMatchObject({ title: "Plans", synced: true });
  });
});
