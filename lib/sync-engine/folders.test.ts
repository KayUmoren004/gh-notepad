import { describe, expect, it } from "vitest";
import type { Device } from "@/test/devices";
import { readNote } from "@/lib/notebook-format";
import { createWorld } from "@/test/devices";

const member = "octo-member";
const notebook = "my-notes";

/** A note at `folder/title` on `device`, returning its id. */
function noteAt(device: Device, folder: string, title: string, body = `${title}\n`): string {
  const id = device.store.createNote({ folder });
  device.store.rename(id, title);
  device.store.editBody(id, body);
  return id;
}

const sortedFiles = (files: { path: string; status: string }[]) =>
  [...files].sort((a, b) => a.path.localeCompare(b.path)).map(({ path, status }) => `${status} ${path}`);
const folderPaths = (device: Device) => [...device.store.getState().folders.values()].map((folder) => folder.path).sort();

describe("renaming and moving folders", () => {
  it("renames a folder in one commit that moves every file under it, notes keeping their ids", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const plan = noteAt(laptop, "Garden", "Plan");
    const cedar = noteAt(laptop, "Garden/Beds", "Cedar");
    const kitchen = noteAt(laptop, "", "Kitchen");
    laptop.store.createFolder(laptop.store.personalNotebook, "Garden", "Tools");
    await laptop.sync();
    const commitsBefore = world.github.commits(member, notebook).length;

    laptop.store.renameFolder(laptop.store.personalNotebook, "Garden", "Allotment");
    await laptop.sync();

    const commits = world.github.commits(member, notebook);
    expect(commits).toHaveLength(commitsBefore + 1);
    expect(commits[0].message).toBe('Rename "Garden" to "Allotment"');
    expect(sortedFiles(commits[0].files)).toEqual([
      "added Allotment/Beds/Cedar.md",
      "added Allotment/Plan.md",
      "added Allotment/Tools/.gitkeep",
      "removed Garden/Beds/Cedar.md",
      "removed Garden/Plan.md",
      "removed Garden/Tools/.gitkeep",
    ]);
    const files = world.github.files(member, notebook);
    expect(readNote(files["Allotment/Plan.md"]).id).toBe(plan);
    expect(readNote(files["Allotment/Beds/Cedar.md"]).id).toBe(cedar);
    expect(files["Kitchen.md"]).toBeDefined();
    expect(laptop.store.note(plan)).toMatchObject({ path: "Allotment/Plan.md", synced: true });
    expect(laptop.store.note(cedar)).toMatchObject({ synced: true });
    expect(laptop.store.note(kitchen)).toMatchObject({ synced: true });
    expect([...laptop.store.getState().folders.values()]).toEqual([
      { notebook: laptop.store.personalNotebook, path: "Allotment/Tools", synced: true, trashed: null },
    ]);
  });

  it("moves a folder into another in one commit, and another device follows every note by id", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const phone = await world.signIn(member);
    const plan = noteAt(laptop, "Garden", "Plan");
    const cedar = noteAt(laptop, "Garden/Beds", "Cedar");
    noteAt(laptop, "Projects", "Kitchen");
    await laptop.sync();
    await phone.sync();
    phone.store.editBody(plan, "Plan\nTyped on the phone before the move arrived\n");

    laptop.store.moveFolder(laptop.store.personalNotebook, "Garden", "Projects");
    await laptop.sync();
    const [latest] = world.github.commits(member, notebook);
    expect(latest.message).toBe('Move "Garden" to Projects');
    expect(sortedFiles(latest.files)).toEqual([
      "removed Garden/Beds/Cedar.md",
      "removed Garden/Plan.md",
      "added Projects/Garden/Beds/Cedar.md",
      "added Projects/Garden/Plan.md",
    ]);

    await phone.sync();
    expect(phone.store.note(plan)).toMatchObject({ id: plan, path: "Projects/Garden/Plan.md" });
    expect(phone.store.note(cedar)).toMatchObject({ id: cedar, path: "Projects/Garden/Beds/Cedar.md" });
    expect(phone.store.note(plan)?.body).toBe("Plan\nTyped on the phone before the move arrived\n");
    expect(Object.keys(world.github.files(member, notebook)).sort()).toEqual([
      "Projects/Garden/Beds/Cedar.md",
      "Projects/Garden/Plan.md",
      "Projects/Kitchen.md",
      "README.md",
    ]);
    expect([...phone.store.getState().notes.values()].every((note) => note.synced)).toBe(true);

    laptop.store.moveFolder(laptop.store.personalNotebook, "Projects/Garden", "");
    await laptop.sync();
    expect(world.github.commits(member, notebook)[0].message).toBe('Move "Garden" to the top level');
  });

  it("de-duplicates a folder moved where one of the same name is, like a title", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const plan = noteAt(laptop, "Garden", "Plan");
    noteAt(laptop, "Archive/Garden", "Old plan");
    await laptop.sync();

    laptop.store.moveFolder(laptop.store.personalNotebook, "Garden", "Archive");
    await laptop.sync();

    expect(laptop.store.note(plan)).toMatchObject({ path: "Archive/Garden 2/Plan.md", synced: true });
    expect(Object.keys(world.github.files(member, notebook)).sort()).toEqual([
      "Archive/Garden 2/Plan.md",
      "Archive/Garden/Old plan.md",
      "README.md",
    ]);
  });

  it("moves a folder with more files than a commit holds in several commits, never splitting a note's move", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member, { maxChangesPerCommit: 4 });
    const ids = ["One", "Two", "Three"].map((title) => noteAt(laptop, "Garden", title));
    await laptop.sync();

    laptop.store.renameFolder(laptop.store.personalNotebook, "Garden", "Allotment");
    await laptop.sync();

    const commits = world.github.commits(member, notebook);
    expect(commits.slice(0, 2).map((commit) => commit.message)).toEqual([
      'Rename "Garden" to "Allotment" (2 of 2)',
      'Rename "Garden" to "Allotment" (1 of 2)',
    ]);
    // Each commit holds whole notes: a note's new file lands with the removal of its old one.
    for (const commit of commits.slice(0, 2)) {
      const added = commit.files.filter((file) => file.status === "added").map((file) => file.path.slice("Allotment/".length));
      const removed = commit.files.filter((file) => file.status === "removed").map((file) => file.path.slice("Garden/".length));
      expect(added.sort()).toEqual(removed.sort());
    }
    expect(Object.keys(world.github.files(member, notebook)).sort()).toEqual([
      "Allotment/One.md",
      "Allotment/Three.md",
      "Allotment/Two.md",
      "README.md",
    ]);
    for (const id of ids) expect(laptop.store.note(id)).toMatchObject({ synced: true });
  });
});

describe("empty folders", () => {
  it("survive a round trip through GitHub as a .gitkeep, and follow renames and removals made there", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const personal = laptop.store.personalNotebook;
    laptop.store.createFolder(personal, "", "Ideas");
    laptop.store.createFolder(personal, "Ideas", "Later");
    await laptop.sync();

    expect(world.github.commits(member, notebook)[0].message).toBe("Add 2 folders");
    expect(Object.keys(world.github.files(member, notebook)).sort()).toEqual(["Ideas/.gitkeep", "Ideas/Later/.gitkeep", "README.md"]);
    expect(folderPaths(laptop)).toEqual(["Ideas", "Ideas/Later"]);
    expect([...laptop.store.getState().folders.values()].every((folder) => folder.synced)).toBe(true);

    const phone = await world.signIn(member);
    await phone.sync();
    expect(folderPaths(phone)).toEqual(["Ideas", "Ideas/Later"]);

    laptop.store.moveFolder(personal, "Ideas/Later", "");
    await laptop.sync();
    expect(world.github.commits(member, notebook)[0]).toMatchObject({
      message: 'Move "Later" to the top level',
      files: [
        { path: "Ideas/Later/.gitkeep", status: "removed" },
        { path: "Later/.gitkeep", status: "added" },
      ],
    });
    await phone.sync();
    expect(folderPaths(phone)).toEqual(["Ideas", "Later"]);

    // Deleted on github.com: gone from every device.
    world.github.commitFiles(member, notebook, { message: "Remove the folder", files: { "Later/.gitkeep": null } });
    await phone.sync();
    expect(folderPaths(phone)).toEqual(["Ideas"]);
  });

  it("names a push that only makes a folder, and keeps a folder made offline until it lands", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    laptop.setNetwork("offline");
    laptop.store.createFolder(laptop.store.personalNotebook, "", "Someday");
    await expect(laptop.sync()).rejects.toThrow();
    expect(folderPaths(laptop)).toEqual(["Someday"]);

    laptop.setNetwork("online");
    await laptop.sync();
    expect(world.github.commits(member, notebook)[0].message).toBe('Add folder "Someday"');
    expect(world.github.files(member, notebook)["Someday/.gitkeep"]).toBe("");
  });

  it("ignores markers that keep nothing a member sees; a trashed folder's is a folder in the Trash", async () => {
    const world = createWorld();
    world.github.addRepo({
      owner: member,
      name: notebook,
      files: { ".gitkeep": "", "attachments/.gitkeep": "", ".trash/Old/.gitkeep": "", ".hidden/.gitkeep": "", "Kept/.gitkeep": "" },
    });
    const laptop = await world.signIn(member);
    await laptop.sync();
    expect(folderPaths(laptop)).toEqual([".trash/Old", "Kept"]);
    // A marker that doesn't say when: in the Trash, for a time no one knows.
    expect([...laptop.store.getState().folders.values()].map((folder) => folder.trashed)).toEqual(["", null]);
  });
});

describe("moving notes", () => {
  it("moves a note into a folder, de-duplicating its title there", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = noteAt(laptop, "", "Plan", "Top-level plan\n");
    const other = noteAt(laptop, "Garden", "Plan", "Garden plan\n");
    await laptop.sync();

    laptop.store.moveNote(id, "Garden");
    await laptop.sync();

    expect(world.github.commits(member, notebook)[0]).toMatchObject({
      message: 'Move "Plan 2" to Garden',
      files: [
        { path: "Garden/Plan 2.md", status: "added" },
        { path: "Plan.md", status: "removed" },
      ],
    });
    const files = world.github.files(member, notebook);
    expect(readNote(files["Garden/Plan 2.md"])).toMatchObject({ id, body: "Top-level plan\n" });
    expect(readNote(files["Garden/Plan.md"])).toMatchObject({ id: other, body: "Garden plan\n" });
    expect(laptop.store.note(id)).toMatchObject({ title: "Plan 2", folder: "Garden", synced: true });
  });

  it("says what a push of several moved notes did", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const ids = ["A", "B", "C"].map((title) => noteAt(laptop, "", title));
    await laptop.sync();

    for (const id of ids) laptop.store.moveNote(id, "Archive");
    await laptop.sync();
    expect(world.github.commits(member, notebook)[0].message).toBe("Move 3 notes to Archive");

    laptop.store.moveNote(ids[0], "");
    laptop.store.moveNote(ids[1], "Elsewhere");
    await laptop.sync();
    expect(world.github.commits(member, notebook)[0].message).toBe("Move 2 notes");
  });
});
