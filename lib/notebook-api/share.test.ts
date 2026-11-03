import { describe, expect, it } from "vitest";
import { newShareId, SHARE_NOTE_FILE } from "@/lib/share";
import { createWorld, type Device, type World } from "@/test/devices";

const member = "octo-member";
const notebook = `/api/notebooks/${member}/my-notes`;

/** A note in the member's notebook, synced, carrying share id `share`. */
async function sharedNote(world: World, laptop: Device, title: string, share: string): Promise<string> {
  const id = laptop.store.createNote();
  laptop.store.rename(id, title);
  laptop.store.editBody(id, "# Hello\n\nThere.\n");
  laptop.store.setShare(id, share);
  await laptop.sync();
  return id;
}

const publish = (world: World, path: string, as?: Device, headers?: Record<string, string>) =>
  world.callApi(`${notebook}/share`, { method: "POST", as, headers, body: { branch: "main", path } });

const revoke = (world: World, id: string, as?: Device, headers?: Record<string, string>) =>
  world.callApi(`${notebook}/share`, { method: "DELETE", as, headers, body: { id } });

describe("the share routes", () => {
  it("refuse to publish or revoke without a session, before asking GitHub anything", async () => {
    const world = createWorld();
    await (await world.signIn(member)).sync();
    const before = world.github.requests().length;

    expect((await publish(world, "Trip.md")).status).toBe(401);
    expect((await revoke(world, newShareId())).status).toBe(401);
    expect(world.github.requests().slice(before)).toEqual([]);
  });

  it("refuse writes from another site", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();
    const origin = { origin: "https://evil.example" };

    expect((await publish(world, "Trip.md", laptop, origin)).status).toBe(403);
    expect((await revoke(world, newShareId(), laptop, origin)).status).toBe(403);
  });

  it("publish the note at the notebook's head under its share id and answer with the link", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const share = newShareId();
    await sharedNote(world, laptop, "Trip notes", share);
    await world.shareStore.delete(share);

    const response = await publish(world, "Trip notes.md", laptop);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: share, url: `https://notes.example/s/${share}` });
    const copy = await world.shareStore.get(share, SHARE_NOTE_FILE);
    expect(JSON.parse(new TextDecoder().decode(copy?.bytes))).toMatchObject({
      title: "Trip notes",
      html: "<h1>Hello</h1>\n<p>There.</p>\n",
    });
  });

  it("refuse a path that isn't a note, a note the notebook doesn't have, and a note that isn't shared", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Plain");
    await laptop.sync();

    expect((await publish(world, "../Plain.md", laptop)).status).toBe(400);
    expect((await publish(world, "attachments/x.png", laptop)).status).toBe(400);
    expect((await publish(world, "Nope.md", laptop)).status).toBe(404);
    const unshared = await publish(world, "Plain.md", laptop);
    expect(unshared.status).toBe(400);
    expect(await unshared.json()).toMatchObject({ error: "invalid" });
  });

  it("never let one notebook replace or revoke another's copy", async () => {
    const world = createWorld({ members: [member, "octo-other"] });
    const laptop = await world.signIn(member);
    const share = newShareId();
    const copy = JSON.stringify({ title: "Theirs", html: "<p>Theirs</p>\n", updated: null, notebook: "octo-other/my-notes" });
    await world.shareStore.put(share, [{ path: SHARE_NOTE_FILE, contentType: "application/json", bytes: new TextEncoder().encode(copy) }]);
    await sharedNote(world, laptop, "Mine", share).catch(() => undefined);

    expect((await publish(world, "Mine.md", laptop)).status).toBe(403);
    expect((await revoke(world, share, laptop)).status).toBe(403);
    expect(new TextDecoder().decode((await world.shareStore.get(share, SHARE_NOTE_FILE))?.bytes)).toBe(copy);
  });

  it("revoke a share link, and revoking it again is fine", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const share = newShareId();
    await sharedNote(world, laptop, "Revoked", share);
    expect(await world.shareStore.get(share, SHARE_NOTE_FILE)).not.toBeNull();

    expect((await revoke(world, "not-a-share-id", laptop)).status).toBe(400);
    expect((await revoke(world, share, laptop)).status).toBe(200);
    expect(await world.shareStore.get(share, SHARE_NOTE_FILE)).toBeNull();
    expect((await revoke(world, share, laptop)).status).toBe(200);
  });
});
