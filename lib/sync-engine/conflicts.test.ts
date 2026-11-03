import { describe, expect, it } from "vitest";
import { readNote } from "@/lib/notebook-format";
import { createWorld, type Device, type World } from "@/test/devices";

const member = "octo-member";
const notebook = "my-notes";

const body = "Alpha\n\nBravo\n\nCharlie\n";

/** A note both devices have synced, so each holds the same agreed version. */
async function sharedNote(world: World, title: string): Promise<{ laptop: Device; phone: Device; id: string }> {
  const laptop = await world.signIn(member);
  const phone = await world.signIn(member);
  const id = laptop.store.createNote();
  laptop.store.rename(id, title);
  laptop.store.editBody(id, body);
  await laptop.sync();
  await phone.sync();
  expect(phone.store.note(id)).toMatchObject({ title, body, synced: true });
  return { laptop, phone, id };
}

const titles = (device: Device) => [...device.store.getState().notes.values()].map((note) => note.title).sort();

describe("a note changed on two devices", () => {
  it("merges edits to different lines, and both devices end up with both", async () => {
    const world = createWorld();
    const { laptop, phone, id } = await sharedNote(world, "Plan");

    laptop.store.editBody(id, "Alpha, from the laptop\n\nBravo\n\nCharlie\n");
    phone.store.editBody(id, "Alpha\n\nBravo\n\nCharlie, from the phone\n");
    await laptop.sync();
    await phone.sync();
    await laptop.sync();

    const merged = "Alpha, from the laptop\n\nBravo\n\nCharlie, from the phone\n";
    expect(phone.store.note(id)).toMatchObject({ body: merged, synced: true });
    expect(laptop.store.note(id)).toMatchObject({ body: merged, synced: true });
    expect(readNote(world.github.files(member, notebook)["Plan.md"]).body).toBe(merged);
    expect(titles(phone)).toEqual(["Plan", "README"]);
    expect(phone.engine.getConflicts()).toEqual([]);
  });

  it("keeps the device's version where both changed the same lines, with one conflict copy holding the notebook's", async () => {
    const world = createWorld();
    const { laptop, phone, id } = await sharedNote(world, "Plan");

    laptop.store.editBody(id, "Alpha, from the laptop\n\nBravo\n\nCharlie\n");
    phone.store.editBody(id, "Alpha, from the phone\n\nBravo\n\nCharlie\n");
    await laptop.sync();
    await phone.sync();

    // The phone keeps what was typed on it; the laptop's version sits beside it as a conflict copy.
    expect(phone.store.note(id)).toMatchObject({ body: "Alpha, from the phone\n\nBravo\n\nCharlie\n", synced: true });
    expect(titles(phone)).toEqual(["Plan", "Plan (conflict copy)", "README"]);
    const copy = [...phone.store.getState().notes.values()].find((note) => note.title === "Plan (conflict copy)");
    expect(copy).toMatchObject({ body: "Alpha, from the laptop\n\nBravo\n\nCharlie\n", folder: "", synced: true });
    expect(copy?.id).not.toBe(id);
    expect(phone.engine.getConflicts()).toEqual([{ notebook: `${member}/${notebook}`, noteId: id, copyId: copy?.id, title: "Plan" }]);

    // Both versions reached the notebook, so nothing was lost anywhere.
    const files = world.github.files(member, notebook);
    expect(readNote(files["Plan.md"])).toMatchObject({ id, body: "Alpha, from the phone\n\nBravo\n\nCharlie\n" });
    expect(readNote(files["Plan (conflict copy).md"])).toMatchObject({
      id: copy?.id,
      body: "Alpha, from the laptop\n\nBravo\n\nCharlie\n",
    });

    // The laptop follows: it takes the phone's version and sees the copy too. Still exactly one copy.
    await laptop.sync();
    await phone.sync();
    await laptop.sync();
    expect(laptop.store.note(id)).toMatchObject({ body: "Alpha, from the phone\n\nBravo\n\nCharlie\n", synced: true });
    expect(titles(laptop)).toEqual(["Plan", "Plan (conflict copy)", "README"]);
    expect(titles(phone)).toEqual(["Plan", "Plan (conflict copy)", "README"]);
    expect(Object.keys(world.github.files(member, notebook)).sort()).toEqual([
      "Plan (conflict copy).md",
      "Plan.md",
      "README.md",
    ]);
    expect(laptop.engine.getConflicts()).toEqual([]);
  });

  it("a conflict notice stays until the member dismisses it", async () => {
    const world = createWorld();
    const { laptop, phone, id } = await sharedNote(world, "Plan");
    laptop.store.editBody(id, "Alpha, from the laptop\n\nBravo\n\nCharlie\n");
    phone.store.editBody(id, "Alpha, from the phone\n\nBravo\n\nCharlie\n");
    await laptop.sync();
    await phone.sync();
    const [conflict] = phone.engine.getConflicts();
    expect(conflict).toBeDefined();

    await phone.sync();
    expect(phone.engine.getConflicts()).toHaveLength(1);

    phone.engine.dismissConflict(conflict.copyId);
    expect(phone.engine.getConflicts()).toEqual([]);
  });

  it("a push that races another device's push succeeds after a retry, losing neither change", async () => {
    const world = createWorld();
    const { laptop, phone, id } = await sharedNote(world, "Plan");
    laptop.store.editBody(id, "Alpha, from the laptop\n\nBravo\n\nCharlie\n");
    phone.store.editBody(id, "Alpha\n\nBravo\n\nCharlie, from the phone\n");

    // The laptop's commit is about to land when the phone's gets there first.
    const moveRef = world.holdGitHub((request) => request.method === "PATCH" && request.url.includes("/git/refs/"));
    const syncing = laptop.sync();
    await moveRef.reached;
    await phone.sync();
    moveRef.release();
    await syncing;

    const merged = "Alpha, from the laptop\n\nBravo\n\nCharlie, from the phone\n";
    expect(readNote(world.github.files(member, notebook)["Plan.md"]).body).toBe(merged);
    expect(laptop.store.note(id)).toMatchObject({ body: merged, synced: true });
    await phone.sync();
    expect(phone.store.note(id)).toMatchObject({ body: merged, synced: true });
    expect(world.github.commits(member, notebook).map((commit) => commit.message).slice(0, 2)).toEqual([
      'Update "Plan"',
      'Update "Plan"',
    ]);
  });

  it("a note renamed on one device while edited on another ends up renamed, with the edits", async () => {
    const world = createWorld();
    const { laptop, phone, id } = await sharedNote(world, "Ideas");
    laptop.store.rename(id, "Big ideas");
    phone.store.editBody(id, "Alpha\n\nBravo\n\nCharlie\n\nDelta, from the phone\n");
    await laptop.sync();
    await phone.sync();

    expect(phone.store.note(id)).toMatchObject({
      title: "Big ideas",
      body: "Alpha\n\nBravo\n\nCharlie\n\nDelta, from the phone\n",
      synced: true,
    });
    const files = world.github.files(member, notebook);
    expect(Object.keys(files).sort()).toEqual(["Big ideas.md", "README.md"]);
    expect(readNote(files["Big ideas.md"])).toMatchObject({ id, body: "Alpha\n\nBravo\n\nCharlie\n\nDelta, from the phone\n" });
    await laptop.sync();
    expect(laptop.store.note(id)).toMatchObject({ title: "Big ideas", body: "Alpha\n\nBravo\n\nCharlie\n\nDelta, from the phone\n" });
    expect(phone.engine.getConflicts()).toEqual([]);
  });
});
