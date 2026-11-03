import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { openDeviceStore, type DeviceStore } from ".";

const account = { id: 7, login: "octo-member" };
const notebook = "octo-member/my-notes";
const head = "a".repeat(40);
const older = "b".repeat(40);

async function open(indexedDB = new IDBFactory()): Promise<DeviceStore & { indexedDB: IDBFactory }> {
  const store = await openDeviceStore({ account, indexedDB, IDBKeyRange, writeDelayMs: 0 });
  return Object.assign(store, { indexedDB });
}

const versions = [
  { commit: head, path: "Ideas.md", message: 'Update "Ideas"', date: "2026-11-03T10:00:00Z", author: "octo-member" },
  { commit: older, path: "Draft.md", message: "Add Draft", date: "2026-11-02T10:00:00Z", author: "octo-member" },
];

describe("the device's version cache", () => {
  it("knows nothing about a note's history until told", async () => {
    const store = await open();
    expect(await store.versions.history(notebook, "Ideas.md")).toBeNull();
    expect(await store.versions.text(notebook, older, "Draft.md")).toBeNull();
    await store.close();
  });

  it("keeps a note's history and the text of versions fetched, across a reload", async () => {
    const first = await open();
    await first.versions.rememberHistory({ notebook, path: "Ideas.md", head, versions });
    await first.versions.rememberText(notebook, older, "Draft.md", "one\ntwo\n");
    await first.close();

    const again = await open(first.indexedDB);
    expect(await again.versions.history(notebook, "Ideas.md")).toEqual({ notebook, path: "Ideas.md", head, versions });
    expect(await again.versions.text(notebook, older, "Draft.md")).toBe("one\ntwo\n");
    expect(await again.versions.text(notebook, head, "Ideas.md")).toBeNull();
    await again.close();
  });

  it("replaces a note's history when told again, keeping the texts already fetched", async () => {
    const store = await open();
    await store.versions.rememberHistory({ notebook, path: "Ideas.md", head: older, versions: [versions[1]] });
    await store.versions.rememberText(notebook, older, "Draft.md", "one\ntwo\n");

    await store.versions.rememberHistory({ notebook, path: "Ideas.md", head, versions });

    expect(await store.versions.history(notebook, "Ideas.md")).toMatchObject({ head, versions });
    expect(await store.versions.text(notebook, older, "Draft.md")).toBe("one\ntwo\n");
    await store.close();
  });

  it("keeps each notebook's and each path's history apart", async () => {
    const store = await open();
    await store.versions.rememberHistory({ notebook, path: "Ideas.md", head, versions });

    expect(await store.versions.history("octo-member/other", "Ideas.md")).toBeNull();
    expect(await store.versions.history(notebook, "Other.md")).toBeNull();
    await store.close();
  });
});
