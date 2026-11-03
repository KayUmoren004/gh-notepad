import { describe, expect, it } from "vitest";
import { readNote } from "@/lib/notebook-format";
import { createWorld } from "@/test/devices";

const member = "octo-member";
const notebook = "my-notes";

/** Bytes that are not valid UTF-8, so a text round trip would corrupt them. */
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x01]);
const png = () => new Blob([pngBytes], { type: "image/png" });

describe("attachments in sync", () => {
  it("an image inserted while offline survives a reload and is committed with its note on reconnect", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Trip notes");

    // Offline: nothing reaches the notebook, but the image is on the device at once.
    const link = laptop.store.addAttachment(laptop.store.personalNotebook, { type: "image/png", bytes: png() });
    laptop.store.editBody(id, `Day one\n\n![Beach](${link})\n`);
    expect(laptop.store.attachmentSrc(laptop.store.personalNotebook, link.slice(1))).toMatch(/^blob:/);
    expect(Object.keys(world.github.files(member, notebook))).toEqual(["README.md"]);

    const reopened = await laptop.reopen();
    expect(reopened.store.note(id)?.body).toBe(`Day one\n\n![Beach](${link})\n`);
    expect(reopened.store.attachmentSrc(reopened.store.personalNotebook, link.slice(1))).toMatch(/^blob:/);

    // Back online: one commit holds the note and its attachment, linked from the repository root.
    await reopened.sync();

    const path = link.slice(1);
    expect(path).toMatch(/^attachments\/[0-9a-f-]{36}\.png$/);
    expect([...(world.github.fileBytes(member, notebook, path) ?? [])]).toEqual([...pngBytes]);
    expect(readNote(world.github.files(member, notebook)["Trip notes.md"]).body).toBe(`Day one\n\n![Beach](/${path})\n`);
    const [commit] = world.github.commits(member, notebook);
    expect(commit.message).toBe('Add "Trip notes" and add 1 attachment');
    expect(commit.files.map((file) => file.path).sort()).toEqual(["Trip notes.md", path]);
    expect(reopened.store.note(id)).toMatchObject({ synced: true });
    expect(reopened.store.sync.pendingAttachments(reopened.store.personalNotebook)).toEqual([]);
  });

  it("names the attachments beside the notes in the commit message", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Gallery");
    await laptop.sync();

    const first = laptop.store.addAttachment(laptop.store.personalNotebook, { type: "image/png", bytes: png() });
    const second = laptop.store.addAttachment(laptop.store.personalNotebook, { type: "image/png", bytes: png() });
    laptop.store.editBody(id, `![](${first})\n![](${second})\n`);
    await laptop.sync();

    expect(world.github.commits(member, notebook)[0].message).toBe('Update "Gallery" and add 2 attachments');
  });

  it("commits an attachment that lost its push to another device's commit, without storing its bytes twice", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Race");
    const link = laptop.store.addAttachment(laptop.store.personalNotebook, { type: "image/png", bytes: png() });
    laptop.store.editBody(id, `![](${link})\n`);

    // Another device commits between this one's pull and push.
    const commit = world.holdGitHub((request) => request.method === "PATCH" && request.url.includes("/git/refs/"));
    const syncing = laptop.sync();
    await commit.reached;
    world.github.commitFiles(member, notebook, { message: "Elsewhere", files: { "Other.md": "Hi\n" } });
    commit.release();
    await syncing;

    expect([...(world.github.fileBytes(member, notebook, link.slice(1)) ?? [])]).toEqual([...pngBytes]);
    const blobsStored = world.github.requests().filter(({ method, path }) => method === "POST" && path.endsWith("/git/blobs"));
    expect(blobsStored).toHaveLength(1);
    expect(laptop.store.note(id)).toMatchObject({ synced: true });
  });

  it("commits the notes when the notebook refuses an attachment, reports it in the status, and never sends it again", async () => {
    // The deployment stores less than the device believed: a hosting cap, or a limit lowered since the app was loaded.
    const world = createWorld({ env: { NEXT_PUBLIC_ATTACHMENT_LIMIT_BYTES: "1024" } });
    const laptop = await world.signIn(member);
    await laptop.sync();
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Trip notes");
    const small = laptop.store.addAttachment(laptop.store.personalNotebook, { type: "image/png", bytes: png() });
    const big = laptop.store.addAttachment(laptop.store.personalNotebook, {
      type: "image/png",
      bytes: new Blob([new Uint8Array(2048)], { type: "image/png" }),
    });
    laptop.store.editBody(id, `![Beach](${small})\n\n![Huge](${big})\n`);

    await laptop.sync();

    // The note and the attachment the notebook took went out together; the refused one stayed on the device.
    expect(readNote(world.github.files(member, notebook)["Trip notes.md"]).body).toBe(`![Beach](${small})\n\n![Huge](${big})\n`);
    expect(world.github.fileBytes(member, notebook, small.slice(1))).toBeDefined();
    expect(world.github.fileBytes(member, notebook, big.slice(1))).toBeUndefined();
    expect(world.github.commits(member, notebook)[0].message).toBe('Add "Trip notes" and add 1 attachment');
    expect(laptop.store.note(id)).toMatchObject({ synced: true });
    expect(laptop.engine.getStatus()).toEqual({ state: "idle", lastSyncedAt: expect.any(Number), failedAttachments: 1 });
    expect(laptop.store.getState().failedAttachments).toEqual([
      { notebook: laptop.store.personalNotebook, path: big.slice(1), reason: "Images must be under 1 kB" },
    ]);
    expect(laptop.store.attachmentSrc(laptop.store.personalNotebook, big.slice(1))).toMatch(/^blob:/);

    // Later syncs leave it alone: the same upload would be refused the same way.
    const blobsStored = () => world.github.requests().filter(({ method, path }) => method === "POST" && path.endsWith("/git/blobs"));
    expect(blobsStored()).toHaveLength(1);
    laptop.store.editBody(id, `![Beach](${small})\n\n![Huge](${big})\n\nMore\n`);
    await laptop.sync();
    expect(blobsStored()).toHaveLength(1);
    expect(laptop.engine.getStatus()).toMatchObject({ state: "idle", failedAttachments: 1 });

    // Removing it takes the image out of the note, which then syncs clean.
    laptop.store.removeAttachment(laptop.store.personalNotebook, big.slice(1));
    expect(laptop.store.note(id)?.body).toBe(`![Beach](${small})\n\nMore\n`);
    await laptop.sync();
    expect(readNote(world.github.files(member, notebook)["Trip notes.md"]).body).toBe(`![Beach](${small})\n\nMore\n`);
    expect(laptop.store.note(id)).toMatchObject({ synced: true });
    expect(laptop.engine.getStatus()).toEqual({ state: "idle", lastSyncedAt: expect.any(Number) });
    expect(laptop.store.getState().failedAttachments).toEqual([]);
  });

  it("shows an attachment from the notebook on another device, through the app's own route", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Postcard");
    const link = laptop.store.addAttachment(laptop.store.personalNotebook, { type: "image/png", bytes: png() });
    laptop.store.editBody(id, `![Beach](${link})\n`);
    await laptop.sync();

    const phone = await world.signIn(member);
    await phone.sync();

    expect(phone.store.note(id)?.body).toBe(`![Beach](${link})\n`);
    // The phone holds no copy: the image is fetched from the notebook with the session.
    expect(phone.store.attachmentSrc(phone.store.personalNotebook, link.slice(1))).toBeNull();
    const response = await world.callApi(`/api/notebooks/${member}/${notebook}${link}?branch=main`, { as: phone });
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...pngBytes]);
  });
});
