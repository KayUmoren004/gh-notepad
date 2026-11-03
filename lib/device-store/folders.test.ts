import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { readNote } from "@/lib/notebook-format";
import { openDeviceStore, type DeviceStore } from ".";

const account = { id: 7, login: "octo-member" };

async function open(indexedDB = new IDBFactory()): Promise<DeviceStore & { indexedDB: IDBFactory }> {
  const store = await openDeviceStore({ account, indexedDB, IDBKeyRange, writeDelayMs: 0 });
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

describe("folders on the device", () => {
  it("creates an empty folder, at the top level or inside another, that survives a reload", async () => {
    const store = await open();
    const notebook = store.personalNotebook;

    expect(store.createFolder(notebook, "", "Projects")).toBe("Projects");
    expect(store.createFolder(notebook, "Projects", "Garden")).toBe("Projects/Garden");
    expect(folders(store)).toEqual(["Projects", "Projects/Garden"]);
    expect([...store.getState().folders.values()][0]).toMatchObject({ notebook, path: "Projects", synced: false });
    await store.close();

    const again = await open(store.indexedDB);
    expect(folders(again)).toEqual(["Projects", "Projects/Garden"]);
    await again.close();
  });

  it("names a new folder like a title: sanitised, de-duplicated among its siblings, never attachments", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    noteAt(store, "Projects/Garden", "Plan");

    expect(store.createFolder(notebook, "", " Garden / Beds ")).toBe("Garden - Beds");
    expect(store.createFolder(notebook, "Projects", "garden")).toBe("Projects/garden 2");
    expect(store.createFolder(notebook, "Projects", "Garden")).toBe("Projects/Garden 3");
    expect(store.createFolder(notebook, "", "")).toBe("New folder");
    expect(store.createFolder(notebook, "", "Attachments")).toBe("Attachments 2");
    await store.close();
  });

  it("renames a folder: every note and folder under it moves, keeping its id, and the name is de-duplicated", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    const plan = noteAt(store, "Projects/Garden", "Plan");
    const cedar = noteAt(store, "Projects/Garden/Beds", "Cedar");
    const elsewhere = noteAt(store, "Projects", "Kitchen");
    store.createFolder(notebook, "Projects/Garden", "Tools");
    store.createFolder(notebook, "Projects", "Allotment");

    expect(store.renameFolder(notebook, "Projects/Garden", "Allotment")).toBe("Projects/Allotment 2");

    expect(store.note(plan)).toMatchObject({ id: plan, path: "Projects/Allotment 2/Plan.md", folder: "Projects/Allotment 2" });
    expect(store.note(cedar)).toMatchObject({ path: "Projects/Allotment 2/Beds/Cedar.md" });
    expect(store.note(elsewhere)).toMatchObject({ path: "Projects/Kitchen.md" });
    expect(folders(store)).toEqual(["Projects/Allotment", "Projects/Allotment 2/Tools"]);
    expect(readNote(store.sync.records(notebook).find((record) => record.id === plan)!.text).id).toBe(plan);
    await store.close();
  });

  it("moves a folder into another folder or to the top level, but never into itself", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    const plan = noteAt(store, "Projects/Garden", "Plan");
    noteAt(store, "Archive", "Old");

    expect(store.moveFolder(notebook, "Projects/Garden", "Archive")).toBe("Archive/Garden");
    expect(store.note(plan)).toMatchObject({ path: "Archive/Garden/Plan.md" });
    expect(store.moveFolder(notebook, "Archive/Garden", "")).toBe("Garden");
    expect(store.note(plan)).toMatchObject({ path: "Garden/Plan.md" });

    noteAt(store, "Garden/Beds", "Cedar");
    expect(() => store.moveFolder(notebook, "Garden", "Garden/Beds")).toThrow("A folder can't go inside itself");
    expect(() => store.moveFolder(notebook, "Garden", "Garden")).toThrow("A folder can't go inside itself");
    expect(paths(store)).toEqual(["Archive/Old.md", "Garden/Beds/Cedar.md", "Garden/Plan.md"]);
    await store.close();
  });

  it("moves a note into a folder, de-duplicating its title there like a rename does", async () => {
    const store = await open();
    const id = noteAt(store, "", "Plan");
    noteAt(store, "Projects/Garden", "Plan");

    store.moveNote(id, "Projects/Garden");
    expect(store.note(id)).toMatchObject({ id, path: "Projects/Garden/Plan 2.md", title: "Plan 2", synced: false });

    store.moveNote(id, "");
    expect(store.note(id)).toMatchObject({ path: "Plan 2.md" });
    await store.close();
  });

  it("counts every folder change as an edit, so sync notices", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    const id = noteAt(store, "", "Plan");
    const before = store.getState().edits;

    store.createFolder(notebook, "", "Projects");
    store.moveNote(id, "Projects");
    store.renameFolder(notebook, "Projects", "Work");
    store.createFolder(notebook, "", "Archive");
    store.moveFolder(notebook, "Work", "Archive");
    expect(store.getState().edits).toBe(before + 5);
    // Moves that change nothing aren't edits.
    store.moveFolder(notebook, "Archive/Work", "Archive");
    store.moveNote(id, "Archive/Work");
    store.renameFolder(notebook, "Archive/Work", "Work");
    expect(store.getState().edits).toBe(before + 5);
    await store.close();
  });
});

describe("the ledger's side of folders", () => {
  it("offers folders made here to sync until a push lands them, and remembers them across a reload", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    store.createFolder(notebook, "", "Projects");

    expect(store.sync.folders(notebook)).toEqual([{ path: "Projects", base: null, dirty: true, trashed: null, deleted: false }]);
    store.sync.applyPush(notebook, "c1", [], ["Projects"]);
    expect(store.sync.folders(notebook)).toEqual([{ path: "Projects", base: "Projects", dirty: false, trashed: null, deleted: false }]);
    expect([...store.getState().folders.values()][0]).toMatchObject({ path: "Projects", synced: true });
    await store.close();

    const again = await open(store.indexedDB);
    expect(again.sync.folders(notebook)).toEqual([{ path: "Projects", base: "Projects", dirty: false, trashed: null, deleted: false }]);
    await again.close();
  });

  it("keeps a renamed folder's old marker until the push removes it, and names the move for the commit message", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    store.createFolder(notebook, "", "Projects");
    store.sync.applyPush(notebook, "c1", [], ["Projects"]);

    store.renameFolder(notebook, "Projects", "Work");
    expect(store.sync.folders(notebook)).toEqual([{ path: "Work", base: "Projects", dirty: true, trashed: null, deleted: false }]);
    expect(store.sync.folderMoves(notebook)).toEqual([{ from: "Projects", to: "Work" }]);

    store.sync.applyPush(notebook, "c2", [], ["Work"]);
    expect(store.sync.folders(notebook)).toEqual([{ path: "Work", base: "Work", dirty: false, trashed: null, deleted: false }]);
    expect(store.sync.folderMoves(notebook)).toEqual([]);
    await store.close();
  });

  it("takes a pull's folders: new ones appear, gone ones leave unless they changed here", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    store.createFolder(notebook, "", "Made here");
    store.sync.applyPull(notebook, "c1", [], [
      { path: "From GitHub", base: "From GitHub" },
      { path: "Gone later", base: "Gone later" },
    ]);
    expect(folders(store)).toEqual(["From GitHub", "Gone later", "Made here"]);

    store.renameFolder(notebook, "From GitHub", "Renamed here");
    store.sync.applyPull(notebook, "c2", [], [
      { path: "Gone later", remove: true },
      { path: "Renamed here", base: null },
    ]);
    expect(store.sync.folders(notebook)).toEqual([
      { path: "Made here", base: null, dirty: true, trashed: null, deleted: false },
      { path: "Renamed here", base: null, dirty: true, trashed: null, deleted: false },
    ]);
    await store.close();
  });
});
