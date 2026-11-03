import { describe, expect, it } from "vitest";
import { readNote } from "@/lib/notebook-format";
import { createWorld, type Device, type World } from "@/test/devices";
import { manualTimers } from "@/test/manual-timers";
import type { SyncEngine } from ".";

// Shared notebooks (ADR 0004): repositories with collaborators, synced next to
// the personal notebook. Two members, octo-alice and octo-bob, work in one.

const alice = "octo-alice";
const bob = "octo-bob";
const topic = "gh-notepad-notebook";
const notebook = "book-club";
const id = `${alice}/${notebook}`;

/** Resolves when the engine next finishes a sync. */
function settled(engine: SyncEngine): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = engine.subscribe(() => {
      if (engine.getStatus().state !== "syncing") {
        unsubscribe();
        resolve();
      }
    });
  });
}

const titlesOn = (device: Device, inNotebook: string) =>
  [...device.store.getState().notes.values()]
    .filter((note) => note.notebook === inNotebook)
    .map((note) => note.title)
    .sort();

/** Alice creates the notebook through the app's routes and invites Bob, who accepts in the app. */
async function shareNotebook(world: World, owner: Device, invitee: Device) {
  const created = await world.callApi("/api/notebooks", { method: "POST", as: owner, body: { name: notebook } });
  expect(created.status).toBe(201);
  const invited = await world.callApi(`/api/notebooks/${alice}/${notebook}/invitations`, {
    method: "POST",
    as: owner,
    body: { username: bob },
  });
  expect(invited.status).toBe(201);
  const { invitations } = (await (await world.callApi("/api/invitations", { as: invitee })).json()) as {
    invitations: { id: number; inviter: string }[];
  };
  expect(invitations).toMatchObject([{ inviter: alice }]);
  const accepted = await world.callApi(`/api/invitations/${invitations[0].id}/accept`, { method: "POST", as: invitee });
  expect(accepted.status).toBe(204);
}

describe("shared notebooks", () => {
  it("a notebook the member accepted an invitation to appears on the device, and notes written there reach the other member", async () => {
    const world = createWorld({ members: [alice, bob] });
    const alicesLaptop = await world.signIn(alice);
    const bobsPhone = await world.signIn(bob);
    await shareNotebook(world, alicesLaptop, bobsPhone);

    await bobsPhone.engine.refreshNotebooks();

    expect([...bobsPhone.store.getState().notebooks.keys()].sort()).toEqual([id, bobsPhone.store.personalNotebook]);
    const noteId = bobsPhone.store.createNote({ notebook: id });
    bobsPhone.store.rename(noteId, "Next meeting");
    bobsPhone.store.editBody(noteId, "Thursday at 7\n");
    await bobsPhone.sync();
    expect(readNote(world.github.files(alice, notebook)["Next meeting.md"])).toMatchObject({ id: noteId, body: "Thursday at 7\n" });

    await alicesLaptop.engine.refreshNotebooks();
    expect(alicesLaptop.store.note(noteId)).toMatchObject({ notebook: id, title: "Next meeting", body: "Thursday at 7\n", synced: true });
    // Her own notes stayed in her personal notebook, untouched.
    expect(titlesOn(alicesLaptop, alicesLaptop.store.personalNotebook)).toEqual(["README"]);
  });

  it("finds a notebook shared with the member within a few minutes, with no action on their part", async () => {
    const world = createWorld({ members: [alice, bob] });
    const timers = manualTimers();
    const alicesLaptop = await world.signIn(alice);
    const bobsPhone = await world.signIn(bob, { timers, pollMs: 30_000, listNotebooksMs: 5 * 60_000 });
    bobsPhone.engine.start();
    await settled(bobsPhone.engine);
    expect(bobsPhone.store.getState().notebooks.has(id)).toBe(false);

    await shareNotebook(world, alicesLaptop, bobsPhone);
    // The next poll pulls the notebooks it knows; the list isn't asked for again this soon.
    timers.advance(60_000);
    await settled(bobsPhone.engine);
    expect(bobsPhone.store.getState().notebooks.has(id)).toBe(false);

    // The first poll after five minutes asks for the list again.
    timers.advance(5 * 60_000);
    await settled(bobsPhone.engine);
    timers.advance(30_000);
    await settled(bobsPhone.engine);
    expect(bobsPhone.store.getState().notebooks.has(id)).toBe(true);
    bobsPhone.engine.stop();
  });

  it("edits by two members to different lines of one note are merged, and to the same line make a conflict copy", async () => {
    const world = createWorld({ members: [alice, bob] });
    const alicesLaptop = await world.signIn(alice);
    const bobsPhone = await world.signIn(bob);
    await shareNotebook(world, alicesLaptop, bobsPhone);
    await alicesLaptop.engine.refreshNotebooks();
    const noteId = alicesLaptop.store.createNote({ notebook: id });
    alicesLaptop.store.rename(noteId, "Reading list");
    alicesLaptop.store.editBody(noteId, "Alpha\n\nBravo\n\nCharlie\n");
    await alicesLaptop.sync();
    await bobsPhone.engine.refreshNotebooks();
    expect(bobsPhone.store.note(noteId)?.body).toBe("Alpha\n\nBravo\n\nCharlie\n");

    // Different lines: both edits end up everywhere.
    alicesLaptop.store.editBody(noteId, "Alpha by alice\n\nBravo\n\nCharlie\n");
    await alicesLaptop.sync();
    bobsPhone.store.editBody(noteId, "Alpha\n\nBravo\n\nCharlie by bob\n");
    await bobsPhone.sync();
    expect(bobsPhone.store.note(noteId)?.body).toBe("Alpha by alice\n\nBravo\n\nCharlie by bob\n");
    await alicesLaptop.sync();
    expect(alicesLaptop.store.note(noteId)?.body).toBe("Alpha by alice\n\nBravo\n\nCharlie by bob\n");
    expect(readNote(world.github.files(alice, notebook)["Reading list.md"]).body).toBe("Alpha by alice\n\nBravo\n\nCharlie by bob\n");

    // The same line: each keeps their own, the other's version is in a conflict copy, and nothing is lost.
    alicesLaptop.store.editBody(noteId, "Alpha by alice, again\n\nBravo\n\nCharlie by bob\n");
    await alicesLaptop.sync();
    bobsPhone.store.editBody(noteId, "Alpha by bob\n\nBravo\n\nCharlie by bob\n");
    await bobsPhone.sync();
    expect(bobsPhone.store.note(noteId)?.body).toBe("Alpha by bob\n\nBravo\n\nCharlie by bob\n");
    expect(bobsPhone.engine.getConflicts()).toMatchObject([{ notebook: id, noteId, title: "Reading list" }]);
    const files = world.github.files(alice, notebook);
    expect(readNote(files["Reading list.md"]).body).toBe("Alpha by bob\n\nBravo\n\nCharlie by bob\n");
    expect(readNote(files["Reading list (conflict copy).md"]).body).toBe("Alpha by alice, again\n\nBravo\n\nCharlie by bob\n");
    await alicesLaptop.sync();
    expect(titlesOn(alicesLaptop, id)).toEqual(["README", "Reading list", "Reading list (conflict copy)"]);
  });

  it("a notebook the member can no longer open leaves the device at the next look, notes included, for good", async () => {
    const world = createWorld({ members: [alice, bob] });
    const alicesLaptop = await world.signIn(alice);
    const bobsPhone = await world.signIn(bob);
    await shareNotebook(world, alicesLaptop, bobsPhone);
    await bobsPhone.engine.refreshNotebooks();
    const mine = bobsPhone.store.createNote();
    const theirs = bobsPhone.store.createNote({ notebook: id });
    await bobsPhone.sync();

    const removal = await world.callApi(`/api/notebooks/${alice}/${notebook}/collaborators/${bob}`, {
      method: "DELETE",
      as: alicesLaptop,
    });
    expect(removal.status).toBe(204);
    await bobsPhone.engine.refreshNotebooks();

    expect(bobsPhone.store.getState().notebooks.has(id)).toBe(false);
    expect(bobsPhone.store.note(theirs)).toBeUndefined();
    expect(bobsPhone.store.note(mine)).toBeDefined();
    const reopened = await bobsPhone.reopen();
    expect(reopened.store.getState().notebooks.has(id)).toBe(false);
    expect(reopened.store.note(theirs)).toBeUndefined();
    expect(reopened.store.note(mine)).toBeDefined();
  });

  it("a shared notebook that can't be synced doesn't hold up the others", async () => {
    const world = createWorld({ members: [alice, bob] });
    // An empty repository: GitHub's Git Data API refuses it, so every sync of it fails.
    world.github.addRepo({ owner: alice, name: "empty", topics: [topic], collaborators: [bob] });
    const bobsPhone = await world.signIn(bob);
    const mine = bobsPhone.store.createNote();
    bobsPhone.store.rename(mine, "Groceries");

    await expect(bobsPhone.sync()).rejects.toThrow();

    expect(bobsPhone.engine.getStatus()).toMatchObject({ state: "failed" });
    expect(bobsPhone.store.note(mine)).toMatchObject({ synced: true });
    expect(world.github.files(bob, "my-notes")["Groceries.md"]).toBeDefined();
  });
});
