import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { readNote } from "@/lib/notebook-format";
import { openDeviceStore, type DeviceStore } from ".";

const account = { id: 7, login: "octo-member" };

async function open(indexedDB = new IDBFactory()): Promise<DeviceStore & { indexedDB: IDBFactory }> {
  const store = await openDeviceStore({ account, indexedDB, IDBKeyRange, writeDelayMs: 0 });
  return Object.assign(store, { indexedDB });
}

/** The note's file as this device would push it. */
function fileOf(store: DeviceStore, id: string): string {
  const record = store.sync.records(store.personalNotebook).find((candidate) => candidate.id === id);
  if (!record) throw new Error(`No record for ${id}`);
  return record.text;
}

describe("tags on the device", () => {
  it("writes a note's tags into its frontmatter, and reads them back", async () => {
    const store = await open();
    const id = store.createNote();

    store.setTags(id, ["home", "garden"]);

    expect(store.note(id)).toMatchObject({ tags: ["home", "garden"], synced: false });
    expect(readNote(fileOf(store, id))).toMatchObject({ id, tags: ["home", "garden"] });
    expect(fileOf(store, id)).toMatch(/^---\nid: [^\n]+\n(?:[^\n]+\n)*tags: \[home, garden\]\n/);

    store.setTags(id, ["garden"]);
    expect(store.note(id)?.tags).toEqual(["garden"]);
    store.setTags(id, []);
    expect(store.note(id)?.tags).toEqual([]);
    expect(readNote(fileOf(store, id)).tags).toEqual([]);
    await store.close();
  });

  it("keeps the tags across a reload", async () => {
    const first = await open();
    const id = first.createNote();
    first.setTags(id, ["home"]);
    await first.close();

    const again = await open(first.indexedDB);
    expect(again.note(id)?.tags).toEqual(["home"]);
    await again.close();
  });

  it("gives a note written outside the app frontmatter with its id the first time it is tagged", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    const base = { path: "Groceries.md", text: "- Milk\n", sha: "a".repeat(40) };
    store.sync.applyPull(notebook, "b".repeat(40), [{ id: "groceries", base, device: { path: base.path, text: base.text } }]);
    expect(store.note("groceries")).toMatchObject({ tags: [], synced: true });

    store.setTags("groceries", ["shopping"]);

    expect(fileOf(store, "groceries")).toMatch(/^---\nid: groceries\ntags: \[shopping\]\nupdated: [^\n]+\n---\n- Milk\n$/);
    expect(store.note("groceries")).toMatchObject({ tags: ["shopping"], synced: false });
    await store.close();
  });

  it("cleans tags as typed, and keeps the casing a tag already has elsewhere on the device", async () => {
    const store = await open();
    const earlier = store.createNote();
    store.setTags(earlier, ["Reading list"]);
    const id = store.createNote();

    store.setTags(id, ["  reading   LIST ", "", "Home", "home", "  "]);

    expect(store.note(id)?.tags).toEqual(["Reading list", "Home"]);
    await store.close();
  });

  it("changes nothing when the tags are already what they are", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    const text = "---\nid: plan\ntags: [Garden, home]\n---\nRaised beds.\n";
    const base = { path: "Plan.md", text, sha: "c".repeat(40) };
    store.sync.applyPull(notebook, "d".repeat(40), [{ id: "plan", base, device: { path: base.path, text } }]);

    store.setTags("plan", ["garden ", "HOME"]);

    expect(store.note("plan")).toMatchObject({ tags: ["Garden", "home"], synced: true });
    expect(fileOf(store, "plan")).toBe(text);
    await store.close();
  });

  it("ignores a note that isn't on the device", async () => {
    const store = await open();
    expect(() => store.setTags("missing", ["home"])).not.toThrow();
    await store.close();
  });
});
