import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { readNote } from "@/lib/notebook-format";
import { openDeviceStore, type DeviceStore } from ".";

const account = { id: 7, login: "octo-member" };
const when = Date.parse("2026-11-10T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

async function open(indexedDB = new IDBFactory(), now = () => when): Promise<DeviceStore & { indexedDB: IDBFactory }> {
  const store = await openDeviceStore({ account, indexedDB, IDBKeyRange, writeDelayMs: 0, now });
  return Object.assign(store, { indexedDB });
}

/** A note at `folder/title`, returning its id. */
function noteAt(store: DeviceStore, folder: string, title: string): string {
  const id = store.createNote({ folder });
  store.rename(id, title);
  return id;
}

const paths = (store: DeviceStore) => [...store.getState().notes.values()].map((note) => note.path).sort();
const folders = (store: DeviceStore) => [...store.getState().folders.values()].map((folder) => folder.path).sort();
/** Plays a push: every note and folder lands where it is. */
function landed(store: DeviceStore, notebook: string) {
  store.sync.applyPush(
    notebook,
    "head",
    store.sync.records(notebook).map((record) => ({ id: record.id, base: { path: record.path, text: record.text, sha: `sha-${record.id}` } })),
    store.sync.folders(notebook).map((folder) => folder.path),
  );
}

describe("the Trash on the device", () => {
  it("moves a note to the Trash under its original path, recording when, and brings it back in place", async () => {
    const store = await open();
    const plan = noteAt(store, "Garden", "Plan");
    noteAt(store, "Garden", "Beds");

    store.trashNote(plan);
    expect(store.note(plan)).toMatchObject({ id: plan, path: ".trash/Garden/Plan.md", title: "Plan", trashed: "2026-11-10T09:00:00.000Z" });
    expect(readNote(store.sync.records(store.personalNotebook).find((record) => record.id === plan)!.text).trashed).toBe(
      "2026-11-10T09:00:00.000Z",
    );
    await store.close();

    // Still in the Trash after a reload; restored, it is back where it was, no longer trashed.
    const again = await open(store.indexedDB);
    expect(again.note(plan)).toMatchObject({ path: ".trash/Garden/Plan.md", trashed: "2026-11-10T09:00:00.000Z" });
    again.restoreNote(plan);
    expect(again.note(plan)).toMatchObject({ path: "Garden/Plan.md", folder: "Garden", trashed: null });
    expect(readNote(again.sync.records(again.personalNotebook).find((record) => record.id === plan)!.text).trashed).toBeNull();
    await again.close();
  });

  it("de-duplicates titles in the Trash, and again on the way back when the title is taken meanwhile", async () => {
    const store = await open();
    const first = noteAt(store, "", "Untitled");
    store.trashNote(first);
    const second = noteAt(store, "", "Untitled");
    store.trashNote(second);
    expect(store.note(first)?.path).toBe(".trash/Untitled.md");
    expect(store.note(second)?.path).toBe(".trash/Untitled 2.md");

    noteAt(store, "", "Untitled");
    store.restoreNote(first);
    expect(store.note(first)?.path).toBe("Untitled 2.md");
    await store.close();
  });

  it("moves a folder to the Trash with everything in it, kept by a marker, and restores it recreating the folder", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    const plan = noteAt(store, "Garden", "Plan");
    const cedar = noteAt(store, "Garden/Beds", "Cedar");
    const kitchen = noteAt(store, "", "Kitchen");
    store.createFolder(notebook, "Garden", "Tools");

    expect(store.trashFolder(notebook, "Garden")).toBe(".trash/Garden");
    expect(paths(store)).toEqual([".trash/Garden/Beds/Cedar.md", ".trash/Garden/Plan.md", "Kitchen.md"]);
    expect(store.note(plan)).toMatchObject({ id: plan, trashed: "2026-11-10T09:00:00.000Z" });
    expect(store.note(cedar)).toMatchObject({ id: cedar, trashed: "2026-11-10T09:00:00.000Z" });
    expect(store.note(kitchen)).toMatchObject({ trashed: null });
    expect([...store.getState().folders.values()].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { notebook, path: ".trash/Garden", synced: false, trashed: "2026-11-10T09:00:00.000Z" },
      { notebook, path: ".trash/Garden/Tools", synced: false, trashed: "2026-11-10T09:00:00.000Z" },
    ]);

    expect(store.restoreFolder(notebook, ".trash/Garden")).toBe("Garden");
    expect(paths(store)).toEqual(["Garden/Beds/Cedar.md", "Garden/Plan.md", "Kitchen.md"]);
    expect(store.note(plan)).toMatchObject({ id: plan, trashed: null });
    expect(folders(store)).toEqual(["Garden", "Garden/Tools"]);
    expect([...store.getState().folders.values()].every((folder) => folder.trashed === null)).toBe(true);
    await store.close();
  });

  it("de-duplicates a folder's name in the Trash and on the way back", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    const old = noteAt(store, "Garden", "Old plan");
    store.trashFolder(notebook, "Garden");
    const fresh = noteAt(store, "Garden", "New plan");
    expect(store.trashFolder(notebook, "Garden")).toBe(".trash/Garden 2");
    expect(store.note(fresh)?.path).toBe(".trash/Garden 2/New plan.md");

    noteAt(store, "Garden", "Newest plan");
    expect(store.restoreFolder(notebook, ".trash/Garden")).toBe("Garden 2");
    expect(store.note(old)?.path).toBe("Garden 2/Old plan.md");
    await store.close();
  });

  it("deletes a trashed note for good: gone at once when it never synced, otherwise once the next push removes it", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    const never = noteAt(store, "", "Never synced");
    const synced = noteAt(store, "", "Synced");
    const kept = noteAt(store, "", "Kept");
    landed(store, notebook);
    store.trashNote(never);
    store.trashNote(synced);
    landed(store, notebook);
    // Only what is in the Trash can go for good.
    store.deleteNoteForever(kept);
    expect(store.note(kept)).toBeDefined();

    store.deleteNoteForever(synced);
    expect(store.note(synced)).toBeUndefined();
    const record = store.sync.records(notebook).find((candidate) => candidate.id === synced);
    expect(record).toMatchObject({ deleted: true, dirty: false, base: { path: ".trash/Synced.md" } });
    await store.close();

    // Still waiting for its push after a reload.
    const again = await open(store.indexedDB);
    expect(again.note(synced)).toBeUndefined();
    expect(again.sync.records(notebook).find((candidate) => candidate.id === synced)).toMatchObject({ deleted: true });
    again.sync.applyPush(notebook, "head-2", [], [], { notes: [synced], folders: [] });
    expect(again.sync.records(notebook).find((candidate) => candidate.id === synced)).toBeUndefined();

    // A note the notebook never had just goes.
    const unsynced = noteAt(again, "", "Offline");
    again.trashNote(unsynced);
    again.deleteNoteForever(unsynced);
    expect(again.note(unsynced)).toBeUndefined();
    expect(again.sync.records(notebook).some((candidate) => candidate.id === unsynced)).toBe(false);
    expect(again.note(never)).toMatchObject({ path: ".trash/Never synced.md" });
    await again.close();
  });

  it("empties the Trash: every trashed note and folder goes, and nothing else", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    const plan = noteAt(store, "Garden", "Plan");
    const kitchen = noteAt(store, "", "Kitchen");
    const loose = noteAt(store, "", "Loose");
    store.createFolder(notebook, "", "Ideas");
    landed(store, notebook);
    store.trashFolder(notebook, "Garden");
    store.trashNote(loose);
    store.trashFolder(notebook, "Ideas");

    store.emptyTrash(notebook);
    expect(paths(store)).toEqual(["Kitchen.md"]);
    expect(folders(store)).toEqual([]);
    expect(store.note(kitchen)).toMatchObject({ trashed: null });
    // Synced ones wait for the push that removes them; the marker the trash made for Garden never reached the notebook.
    expect(
      store.sync
        .records(notebook)
        .filter((record) => record.deleted)
        .map((record) => record.id)
        .sort(),
    ).toEqual([loose, plan].sort());
    expect(store.sync.folders(notebook)).toEqual([
      { path: ".trash/Ideas", base: "Ideas", dirty: false, trashed: "2026-11-10T09:00:00.000Z", deleted: true },
    ]);
    await store.close();
  });

  it("purges, for sync, what has been in the Trash for thirty days", async () => {
    let now = when;
    const store = await open(undefined, () => now);
    const notebook = store.personalNotebook;
    const old = noteAt(store, "", "Old");
    const recent = noteAt(store, "", "Recent");
    store.createFolder(notebook, "", "Ideas");
    landed(store, notebook);
    store.trashNote(old);
    store.trashFolder(notebook, "Ideas");
    now += 20 * DAY;
    store.trashNote(recent);
    landed(store, notebook);
    const edits = store.getState().edits;

    expect(store.sync.purge(notebook, when + 31 * DAY)).toEqual({ notes: 1, folders: 1 });
    expect(store.note(old)).toBeUndefined();
    expect(store.note(recent)).toMatchObject({ path: ".trash/Recent.md" });
    expect(store.sync.records(notebook).find((record) => record.id === old)).toMatchObject({ deleted: true });
    expect(store.sync.folders(notebook)).toEqual([
      { path: ".trash/Ideas", base: ".trash/Ideas", dirty: false, trashed: "2026-11-10T09:00:00.000Z", deleted: true },
    ]);
    // A purge isn't an edit: it is sync's own doing, and mustn't ask for another sync.
    expect(store.getState().edits).toBe(edits);
    await store.close();
  });
});
