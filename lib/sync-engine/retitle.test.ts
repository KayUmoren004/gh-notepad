import { describe, expect, it } from "vitest";
import { readNote } from "@/lib/notebook-format";
import { createWorld, type Device, type World } from "@/test/devices";

const member = "octo-member";
const notebook = "my-notes";

const titles = (device: Device) => [...device.store.getState().notes.values()].map((note) => note.title).sort();

/** Two devices press New note at the same moment: each gets "Untitled", and the laptop's reaches the notebook first. */
async function untitledOnBoth(world: World): Promise<{ laptop: Device; phone: Device; onLaptop: string; onPhone: string }> {
  const laptop = await world.signIn(member);
  const phone = await world.signIn(member);
  const onLaptop = laptop.store.createNote();
  const onPhone = phone.store.createNote();
  expect(laptop.store.note(onLaptop)).toMatchObject({ title: "Untitled" });
  expect(phone.store.note(onPhone)).toMatchObject({ title: "Untitled" });
  await laptop.sync();
  return { laptop, phone, onLaptop, onPhone };
}

describe("a fresh note re-titled by a pull", () => {
  it("is called what the member types over the re-title, on both devices and in the notebook", async () => {
    const world = createWorld();
    const { laptop, phone, onLaptop, onPhone } = await untitledOnBoth(world);

    // "Untitled.md" is taken, so the pull moves the phone's note aside.
    await phone.sync();
    expect(phone.store.note(onPhone)).toMatchObject({ title: "Untitled 2", path: "Untitled 2.md" });
    expect(titles(phone)).toEqual(["README", "Untitled", "Untitled 2"]);

    // The member types a title over the (re-selected) placeholder: that, and only that, is the note's title.
    phone.store.rename(onPhone, "Groceries");
    expect(phone.store.note(onPhone)).toMatchObject({ title: "Groceries", path: "Groceries.md" });
    await phone.sync();
    await laptop.sync();

    const files = world.github.files(member, notebook);
    expect(readNote(files["Groceries.md"]).id).toBe(onPhone);
    expect(readNote(files["Untitled.md"]).id).toBe(onLaptop);
    expect(Object.keys(files).filter((path) => path.startsWith("Untitled 2"))).toEqual([]);
    expect(laptop.store.note(onPhone)).toMatchObject({ title: "Groceries", synced: true });
    expect(laptop.store.note(onLaptop)).toMatchObject({ title: "Untitled", synced: true });
    expect(titles(laptop)).toEqual(["Groceries", "README", "Untitled"]);
  });

  it("leaves a title being typed alone when the pull lands mid-word", async () => {
    const world = createWorld();
    const { laptop, phone, onLaptop, onPhone } = await untitledOnBoth(world);

    const tree = world.holdGitHub((request) => request.method === "GET" && request.url.includes("/git/trees/"));
    const syncing = phone.sync();
    await tree.reached;
    phone.store.rename(onPhone, "Groc");
    tree.release();
    await syncing;

    // The typed title stands; the laptop's "Untitled" arrives beside it.
    expect(phone.store.note(onPhone)).toMatchObject({ title: "Groc", path: "Groc.md" });
    expect(titles(phone)).toEqual(["Groc", "README", "Untitled"]);

    phone.store.rename(onPhone, "Groceries");
    await phone.sync();
    await laptop.sync();
    const files = world.github.files(member, notebook);
    expect(readNote(files["Groceries.md"]).id).toBe(onPhone);
    expect(readNote(files["Untitled.md"]).id).toBe(onLaptop);
    expect(files["Groc.md"]).toBeUndefined();
    expect(Object.keys(files).filter((path) => path.startsWith("Untitled 2"))).toEqual([]);
    expect(titles(laptop)).toEqual(["Groceries", "README", "Untitled"]);
  });

  it("de-duplicates the typed title against the notebook once, never on top of a re-title", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const phone = await world.signIn(member);
    const onLaptop = laptop.store.createNote();
    laptop.store.rename(onLaptop, "Groceries");
    await laptop.sync();

    // The phone, not having pulled yet, types the same title; the pull finds it taken.
    const onPhone = phone.store.createNote();
    phone.store.rename(onPhone, "Groceries");
    await phone.sync();
    expect(phone.store.note(onPhone)).toMatchObject({ title: "Groceries 2", path: "Groceries 2.md" });

    // Typing on from the draft renames from what was typed, not from the re-title.
    phone.store.rename(onPhone, "Groceries list");
    expect(phone.store.note(onPhone)).toMatchObject({ title: "Groceries list", path: "Groceries list.md" });
    await phone.sync();
    await laptop.sync();

    const files = world.github.files(member, notebook);
    expect(readNote(files["Groceries.md"]).id).toBe(onLaptop);
    expect(readNote(files["Groceries list.md"]).id).toBe(onPhone);
    expect(Object.keys(files).filter((path) => path.startsWith("Groceries 2"))).toEqual([]);
    expect(titles(laptop)).toEqual(["Groceries", "Groceries list", "README"]);
    expect(laptop.store.note(onPhone)).toMatchObject({ synced: true });
  });
});
