import { describe, expect, it } from "vitest";
import { createMemoryShareStore, shareStoreFromEnv, type ShareFile } from ".";

const text = (path: string, body: string): ShareFile => ({
  path,
  contentType: "application/json",
  bytes: new TextEncoder().encode(body),
});

describe("the memory share store", () => {
  it("serves what was put, by id and path, and nothing for an unknown id or path", async () => {
    const store = createMemoryShareStore();
    await store.put("one", [text("note.json", "{}"), { path: "attachments/a.png", contentType: "image/png", bytes: new Uint8Array([1, 2]) }]);

    expect(await store.get("one", "note.json")).toEqual(text("note.json", "{}"));
    expect(await store.get("one", "attachments/a.png")).toMatchObject({ contentType: "image/png" });
    expect([...((await store.get("one", "attachments/a.png"))?.bytes ?? [])]).toEqual([1, 2]);
    expect(await store.get("one", "attachments/b.png")).toBeNull();
    expect(await store.get("two", "note.json")).toBeNull();
  });

  it("replaces the whole copy on a second put: files no longer listed are gone", async () => {
    const store = createMemoryShareStore();
    await store.put("one", [text("note.json", "v1"), text("attachments/old.png", "old")]);
    await store.put("one", [text("note.json", "v2")]);

    expect(new TextDecoder().decode((await store.get("one", "note.json"))?.bytes)).toBe("v2");
    expect(await store.get("one", "attachments/old.png")).toBeNull();
  });

  it("keeps its own copy of the bytes", async () => {
    const store = createMemoryShareStore();
    const bytes = new Uint8Array([1, 2, 3]);
    await store.put("one", [{ path: "a.bin", contentType: "application/octet-stream", bytes }]);
    bytes[0] = 9;
    expect([...((await store.get("one", "a.bin"))?.bytes ?? [])]).toEqual([1, 2, 3]);
  });

  it("deletes a copy, and deleting again or deleting nothing is fine", async () => {
    const store = createMemoryShareStore();
    await store.put("one", [text("note.json", "{}")]);
    await store.delete("one");
    expect(await store.get("one", "note.json")).toBeNull();
    await expect(store.delete("one")).resolves.toBeUndefined();
    await expect(store.delete("never")).resolves.toBeUndefined();
  });
});

describe("choosing a store from the environment", () => {
  it("is one memory store for the whole process without a Blob token, so a dev server's routes share it", async () => {
    const first = shareStoreFromEnv({});
    const second = shareStoreFromEnv({ BLOB_READ_WRITE_TOKEN: "" });
    await first.put("one", [text("note.json", "{}")]);
    expect(await second.get("one", "note.json")).toEqual(text("note.json", "{}"));
    await first.delete("one");
  });
});
