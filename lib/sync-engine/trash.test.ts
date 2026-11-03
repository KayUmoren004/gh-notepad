import { describe, expect, it } from "vitest";
import type { Device } from "@/test/devices";
import { readNote, TRASH_RETENTION_MS } from "@/lib/notebook-format";
import type { Timers } from "@/lib/sync-engine";
import { createWorld } from "@/test/devices";

const member = "octo-member";
const notebook = "my-notes";
const DAY = 24 * 60 * 60 * 1000;

/** A note at `folder/title` on `device`, returning its id. */
function noteAt(device: Device, folder: string, title: string, body = `${title}\n`): string {
  const id = device.store.createNote({ folder });
  device.store.rename(id, title);
  device.store.editBody(id, body);
  return id;
}

const sortedFiles = (files: { path: string; status: string }[]) =>
  [...files].sort((a, b) => a.path.localeCompare(b.path)).map(({ path, status }) => `${status} ${path}`);
/** The notes on the device, the seeded README aside. */
const notePaths = (device: Device) =>
  [...device.store.getState().notes.values()]
    .map((note) => note.path)
    .filter((path) => path !== "README.md")
    .sort();
const folderPaths = (device: Device) => [...device.store.getState().folders.values()].map((folder) => folder.path).sort();

/** A clock the test moves: the engine's `now`, so the purge can be driven thirty days on. */
function clock(start = Date.now()): Timers & { advance: (ms: number) => void } {
  let now = start;
  return {
    now: () => now,
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    advance: (ms) => {
      now += ms;
    },
  };
}

describe("the Trash in the notebook", () => {
  it("trashes a note in one commit that moves it under .trash/, recording when; another device sees it trashed", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const phone = await world.signIn(member);
    const plan = noteAt(laptop, "Garden", "Plan");
    noteAt(laptop, "Garden", "Beds");
    await laptop.sync();
    await phone.sync();
    const commitsBefore = world.github.commits(member, notebook).length;

    laptop.store.trashNote(plan);
    await laptop.sync();

    const commits = world.github.commits(member, notebook);
    expect(commits).toHaveLength(commitsBefore + 1);
    expect(commits[0].message).toBe('Delete "Plan"');
    expect(sortedFiles(commits[0].files)).toEqual(["added .trash/Garden/Plan.md", "removed Garden/Plan.md"]);
    const files = world.github.files(member, notebook);
    const trashed = readNote(files[".trash/Garden/Plan.md"]);
    expect(trashed.id).toBe(plan);
    expect(trashed.trashed).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(laptop.store.note(plan)).toMatchObject({ path: ".trash/Garden/Plan.md", synced: true });

    await phone.sync();
    expect(phone.store.note(plan)).toMatchObject({ id: plan, path: ".trash/Garden/Plan.md", trashed: trashed.trashed, synced: true });
    expect(notePaths(phone)).toEqual([".trash/Garden/Plan.md", "Garden/Beds.md"]);
  });

  it("restores a note in one commit that moves it back, dropping the trashed field", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const plan = noteAt(laptop, "Garden", "Plan");
    await laptop.sync();
    laptop.store.trashNote(plan);
    await laptop.sync();
    const commitsBefore = world.github.commits(member, notebook).length;

    laptop.store.restoreNote(plan);
    await laptop.sync();

    const commits = world.github.commits(member, notebook);
    expect(commits).toHaveLength(commitsBefore + 1);
    expect(commits[0].message).toBe('Restore "Plan"');
    expect(sortedFiles(commits[0].files)).toEqual(["removed .trash/Garden/Plan.md", "added Garden/Plan.md"]);
    const files = world.github.files(member, notebook);
    expect(readNote(files["Garden/Plan.md"])).toMatchObject({ id: plan, trashed: null, body: "Plan\n" });
    expect(laptop.store.note(plan)).toMatchObject({ path: "Garden/Plan.md", trashed: null, synced: true });
  });

  it("trashes a folder in one commit that moves every file under it, and restores it the same way", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const phone = await world.signIn(member);
    const plan = noteAt(laptop, "Garden", "Plan");
    const cedar = noteAt(laptop, "Garden/Beds", "Cedar");
    laptop.store.createFolder(laptop.store.personalNotebook, "Garden", "Tools");
    noteAt(laptop, "", "Kitchen");
    await laptop.sync();
    await phone.sync();
    const commitsBefore = world.github.commits(member, notebook).length;

    laptop.store.trashFolder(laptop.store.personalNotebook, "Garden");
    await laptop.sync();

    let commits = world.github.commits(member, notebook);
    expect(commits).toHaveLength(commitsBefore + 1);
    expect(commits[0].message).toBe('Delete "Garden"');
    expect(sortedFiles(commits[0].files)).toEqual([
      "added .trash/Garden/.gitkeep",
      "added .trash/Garden/Beds/Cedar.md",
      "added .trash/Garden/Plan.md",
      "added .trash/Garden/Tools/.gitkeep",
      "removed Garden/Beds/Cedar.md",
      "removed Garden/Plan.md",
      "removed Garden/Tools/.gitkeep",
    ]);
    const files = world.github.files(member, notebook);
    // The folder's marker says when it was trashed, so other devices know.
    const when = files[".trash/Garden/.gitkeep"];
    expect(when).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readNote(files[".trash/Garden/Plan.md"])).toMatchObject({ id: plan, trashed: when });

    await phone.sync();
    expect(phone.store.note(cedar)).toMatchObject({ path: ".trash/Garden/Beds/Cedar.md", trashed: when });
    expect([...phone.store.getState().folders.values()].sort((a, b) => a.path.localeCompare(b.path))).toMatchObject([
      { path: ".trash/Garden", trashed: when, synced: true },
      { path: ".trash/Garden/Tools", trashed: when, synced: true },
    ]);

    phone.store.restoreFolder(phone.store.personalNotebook, ".trash/Garden");
    await phone.sync();
    commits = world.github.commits(member, notebook);
    expect(commits).toHaveLength(commitsBefore + 2);
    expect(commits[0].message).toBe('Restore "Garden"');
    expect(sortedFiles(commits[0].files)).toEqual([
      "removed .trash/Garden/.gitkeep",
      "removed .trash/Garden/Beds/Cedar.md",
      "removed .trash/Garden/Plan.md",
      "removed .trash/Garden/Tools/.gitkeep",
      "added Garden/.gitkeep",
      "added Garden/Beds/Cedar.md",
      "added Garden/Plan.md",
      "added Garden/Tools/.gitkeep",
    ]);
    expect(world.github.files(member, notebook)["Garden/.gitkeep"]).toBe("");
    await laptop.sync();
    expect(laptop.store.note(plan)).toMatchObject({ path: "Garden/Plan.md", trashed: null, synced: true });
    expect(folderPaths(laptop)).toEqual(["Garden", "Garden/Tools"]);
  });

  it("deletes for good in one commit that removes the file, says what it removed, and empties the Trash", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const phone = await world.signIn(member);
    const personal = laptop.store.personalNotebook;
    const plan = noteAt(laptop, "Garden", "Plan");
    const cedar = noteAt(laptop, "Garden/Beds", "Cedar");
    const loose = noteAt(laptop, "", "Loose");
    const kept = noteAt(laptop, "", "Kept");
    await laptop.sync();
    laptop.store.trashFolder(personal, "Garden");
    laptop.store.trashNote(loose);
    await laptop.sync();
    await phone.sync();
    const commitsBefore = world.github.commits(member, notebook).length;

    laptop.store.deleteNoteForever(loose);
    await laptop.sync();
    let commits = world.github.commits(member, notebook);
    expect(commits).toHaveLength(commitsBefore + 1);
    expect(commits[0]).toMatchObject({ message: 'Remove "Loose" from Trash', files: [{ path: ".trash/Loose.md", status: "removed" }] });
    expect(laptop.store.note(loose)).toBeUndefined();
    expect(laptop.store.sync.records(personal).some((record) => record.id === loose)).toBe(false);

    laptop.store.emptyTrash(personal);
    await laptop.sync();
    commits = world.github.commits(member, notebook);
    expect(commits).toHaveLength(commitsBefore + 2);
    expect(commits[0].message).toBe("Empty Trash");
    expect(sortedFiles(commits[0].files)).toEqual([
      "removed .trash/Garden/.gitkeep",
      "removed .trash/Garden/Beds/Cedar.md",
      "removed .trash/Garden/Plan.md",
    ]);
    expect(Object.keys(world.github.files(member, notebook)).sort()).toEqual(["Kept.md", "README.md"]);
    expect(notePaths(laptop)).toEqual(["Kept.md"]);
    expect(folderPaths(laptop)).toEqual([]);

    // The other device follows: what left the notebook leaves it too.
    await phone.sync();
    expect(notePaths(phone)).toEqual(["Kept.md"]);
    expect(folderPaths(phone)).toEqual([]);
    expect(phone.store.note(kept)).toMatchObject({ synced: true });
    expect([plan, cedar, loose].map((id) => phone.store.note(id))).toEqual([undefined, undefined, undefined]);
  });

  it("purges what has been in the Trash for thirty days during sync, in a commit of its own", async () => {
    const world = createWorld();
    const timers = clock();
    const laptop = await world.signIn(member, { timers });
    const personal = laptop.store.personalNotebook;
    const old = noteAt(laptop, "", "Old");
    const recent = noteAt(laptop, "", "Recent");
    const kept = noteAt(laptop, "", "Kept");
    laptop.store.createFolder(personal, "", "Ideas");
    await laptop.sync();
    laptop.store.trashNote(old);
    laptop.store.trashFolder(personal, "Ideas");
    await laptop.sync();
    const commitsBefore = world.github.commits(member, notebook).length;

    // Twenty days on: nothing is due, and a sync with nothing else to do commits nothing.
    timers.advance(20 * DAY);
    await laptop.sync();
    expect(world.github.commits(member, notebook)).toHaveLength(commitsBefore);

    // Trashed now, so it stays while the older things go.
    laptop.store.trashNote(recent);
    await laptop.sync();
    timers.advance(TRASH_RETENTION_MS - 20 * DAY + DAY);
    await laptop.sync();

    const commits = world.github.commits(member, notebook);
    expect(commits).toHaveLength(commitsBefore + 2);
    expect(commits[0].message).toBe("Remove 1 note from Trash");
    expect(sortedFiles(commits[0].files)).toEqual(["removed .trash/Ideas/.gitkeep", "removed .trash/Old.md"]);
    expect(notePaths(laptop)).toEqual([".trash/Recent.md", "Kept.md"]);
    expect(folderPaths(laptop)).toEqual([]);
    expect(laptop.store.note(kept)).toMatchObject({ synced: true });

    // Another device that only learns of a trashed folder from its marker still knows when it was trashed.
    const phone = await world.signIn(member, { timers });
    laptop.store.createFolder(personal, "", "Later");
    laptop.store.trashFolder(personal, "Later");
    await laptop.sync();
    await phone.sync();
    const marker = world.github.files(member, notebook)[".trash/Later/.gitkeep"];
    expect([...phone.store.getState().folders.values()]).toMatchObject([{ path: ".trash/Later", trashed: marker }]);
    timers.advance(TRASH_RETENTION_MS + DAY);
    await phone.sync();
    expect(world.github.commits(member, notebook)[0].message).toBe("Empty Trash");
    expect(Object.keys(world.github.files(member, notebook)).sort()).toEqual(["Kept.md", "README.md"]);
  });

  it("names a push of several trashed or restored notes", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const ids = ["A", "B", "C"].map((title) => noteAt(laptop, "", title));
    await laptop.sync();

    for (const id of ids) laptop.store.trashNote(id);
    await laptop.sync();
    expect(world.github.commits(member, notebook)[0].message).toBe("Delete 3 notes");

    for (const id of ids) laptop.store.restoreNote(id);
    await laptop.sync();
    expect(world.github.commits(member, notebook)[0].message).toBe("Restore 3 notes");

    for (const id of ids) laptop.store.trashNote(id);
    await laptop.sync();
    laptop.store.deleteNoteForever(ids[0]);
    laptop.store.deleteNoteForever(ids[1]);
    await laptop.sync();
    expect(world.github.commits(member, notebook)[0].message).toBe("Remove 2 notes from Trash");
  });
});
