import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { openDeviceStore, type DeviceStore } from ".";

const account = { id: 7, login: "octo-member" };
const shared = "octo-friend/book-club";
const png = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });

async function open(indexedDB = new IDBFactory()): Promise<DeviceStore & { indexedDB: IDBFactory }> {
  const store = await openDeviceStore({ account, indexedDB, IDBKeyRange, writeDelayMs: 0 });
  return Object.assign(store, { indexedDB });
}

describe("notebooks on the device", () => {
  it("shows a notebook once sync has located it, and remembers it across a reload", async () => {
    const first = await open();
    expect([...first.getState().notebooks.keys()]).toEqual([]);

    first.sync.locate(shared, { owner: "octo-friend", repo: "book-club", branch: "main" });

    expect(first.getState().notebooks.get(shared)).toMatchObject({ owner: "octo-friend", repo: "book-club", branch: "main" });
    await first.close();
    const again = await open(first.indexedDB);
    expect([...again.getState().notebooks.keys()]).toEqual([shared]);
    await again.close();
  });

  it("forgets a notebook: its notes and attachments leave the device, now and after a reload", async () => {
    const first = await open();
    first.sync.locate(shared, { owner: "octo-friend", repo: "book-club", branch: "main" });
    const theirs = first.createNote({ notebook: shared });
    const mine = first.createNote();
    const link = first.addAttachment(shared, { type: "image/png", bytes: png });

    first.forgetNotebook(shared);

    expect(first.getState().notebooks.has(shared)).toBe(false);
    expect(first.note(theirs)).toBeUndefined();
    expect(first.note(mine)).toBeDefined();
    expect(first.attachmentSrc(shared, link.slice(1))).toBeNull();
    expect(first.sync.pendingAttachments(shared)).toEqual([]);
    await first.close();

    const again = await open(first.indexedDB);
    expect(again.getState().notebooks.has(shared)).toBe(false);
    expect(again.note(theirs)).toBeUndefined();
    expect(again.note(mine)).toBeDefined();
    expect(again.attachmentSrc(shared, link.slice(1))).toBeNull();
    await again.close();
  });

  it("never forgets the personal notebook", async () => {
    const store = await open();
    store.sync.locate(store.personalNotebook, { owner: "octo-member", repo: "my-notes", branch: "main" });
    const id = store.createNote();

    store.forgetNotebook(store.personalNotebook);

    expect(store.getState().notebooks.has(store.personalNotebook)).toBe(true);
    expect(store.note(id)).toBeDefined();
    await store.close();
  });
});
