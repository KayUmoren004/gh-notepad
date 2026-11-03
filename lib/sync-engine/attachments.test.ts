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
