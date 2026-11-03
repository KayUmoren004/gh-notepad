import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  clearDeviceKeys,
  deleteDeviceData,
  deviceKey,
  deviceKeyPrefix,
  openDeviceStore,
  unsyncedNotes,
  type Account,
  type DeviceStore,
} from "./index";

const alice: Account = { id: 1, login: "octo-alice" };
const bob: Account = { id: 2, login: "octo-bob" };

/** A browser's localStorage, for tests: `Storage`'s shape over a map. */
function fakeStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
  };
}

const keysOf = (storage: Storage) => Array.from({ length: storage.length }, (_, i) => storage.key(i)).sort();

/** A long trailing write, so tests can tell memory from what reached IndexedDB. */
function open(account: Account, indexedDB: IDBFactory, writeDelayMs = 0) {
  return openDeviceStore({ account, indexedDB, writeDelayMs });
}

function createNote(store: DeviceStore, title: string, body: string) {
  const id = store.createNote();
  store.rename(id, title);
  store.editBody(id, body);
  return id;
}

/** Plays a push that reached GitHub: the note's current text becomes its agreed version. */
function markSynced(store: DeviceStore, id: string) {
  const record = store.sync.records(store.personalNotebook).find((candidate) => candidate.id === id);
  if (!record) throw new Error(`no record for ${id}`);
  store.sync.applyPush(store.personalNotebook, "head-1", [
    { id, base: { path: record.path, text: record.text, sha: "sha-1" } },
  ]);
}

async function databaseNames(indexedDB: IDBFactory) {
  return (await indexedDB.databases()).map((info) => info.name).sort();
}

describe("deleteDeviceData", () => {
  it("removes the account's notes from the device and leaves another account's alone", async () => {
    const indexedDB = new IDBFactory();
    const aliceStore = await open(alice, indexedDB);
    createNote(aliceStore, "Groceries", "Milk");
    const bobStore = await open(bob, indexedDB);
    createNote(bobStore, "Bob's list", "Bread");
    await Promise.all([aliceStore.flush(), bobStore.flush()]);
    expect(await databaseNames(indexedDB)).toHaveLength(2);

    // Alice's store is still open, as it is while the app is showing her notes.
    await deleteDeviceData(alice, { indexedDB, storage: fakeStorage() });

    expect(await databaseNames(indexedDB)).toHaveLength(1);
    const aliceAgain = await open(alice, indexedDB);
    expect(aliceAgain.getState().notes.size).toBe(0);
    await aliceAgain.close();
    const bobAgain = await open(bob, indexedDB);
    expect([...bobAgain.getState().notes.values()].map((note) => note.title)).toEqual(["Bob's list"]);
    await bobAgain.close();
    await bobStore.close();
  });

  it("clears the account's keys in localStorage and no others", async () => {
    const indexedDB = new IDBFactory();
    const storage = fakeStorage({
      [deviceKey(alice.login, "sidebar")]: "open",
      [deviceKey(alice.login, "note:1:mode")]: "source",
      [deviceKey(bob.login, "sidebar")]: "closed",
      "app-version": "2",
    });

    await deleteDeviceData(alice, { indexedDB, storage });

    expect(keysOf(storage)).toEqual(["app-version", deviceKey(bob.login, "sidebar")]);
  });
});

describe("device keys", () => {
  it("scope a localStorage key to the account, whatever the login's case", () => {
    expect(deviceKeyPrefix("Octo-Alice")).toBe("notepad:octo-alice:");
    expect(deviceKey("octo-alice", "sidebar")).toBe("notepad:octo-alice:sidebar");
    expect(deviceKey("Octo-Alice", "sidebar")).toBe(deviceKey("octo-alice", "sidebar"));
  });

  it("can be cleared on their own", () => {
    const storage = fakeStorage({ [deviceKey(alice.login, "sidebar")]: "open", theme: "dark" });
    clearDeviceKeys(alice.login, storage);
    expect(keysOf(storage)).toEqual(["theme"]);
  });
});

describe("unsyncedNotes", () => {
  it("lists the notes whose latest edits haven't reached GitHub, by title", async () => {
    const indexedDB = new IDBFactory();
    const store = await open(alice, indexedDB, 60_000);
    const groceries = createNote(store, "Groceries", "Milk");
    createNote(store, "Trip plan", "Pack");
    createNote(store, "Agenda", "Monday");
    markSynced(store, groceries);

    expect((await unsyncedNotes(alice, { indexedDB })).map((note) => note.title)).toEqual(["Agenda", "Trip plan"]);

    // An edit made a moment ago counts, before the trailing write has stored it.
    store.editBody(groceries, "Milk, eggs");
    expect((await unsyncedNotes(alice, { indexedDB })).map((note) => note.title)).toEqual([
      "Agenda",
      "Groceries",
      "Trip plan",
    ]);
    await store.close();
  });

  it("reads the device when no store is open on it", async () => {
    const indexedDB = new IDBFactory();
    const store = await open(alice, indexedDB, 60_000);
    const groceries = createNote(store, "Groceries", "Milk");
    createNote(store, "Trip plan", "Pack");
    markSynced(store, groceries);
    await store.close();

    expect((await unsyncedNotes(alice, { indexedDB })).map((note) => note.title)).toEqual(["Trip plan"]);
    expect(await unsyncedNotes(bob, { indexedDB })).toEqual([]);
  });
});
