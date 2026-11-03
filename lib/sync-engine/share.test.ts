import { describe, expect, it } from "vitest";
import { readNote } from "@/lib/notebook-format";
import { newShareId, SHARE_NOTE_FILE } from "@/lib/share";
import { createMemoryShareStore, type ShareStore } from "@/lib/share-store";
import { createWorld, type World } from "@/test/devices";

const member = "octo-member";
const notebook = "my-notes";

/** Bytes that are not valid UTF-8, so a text round trip would corrupt them. */
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x01]);

/** The published note, as the public page reads it. */
async function publishedNote(world: World, id: string): Promise<{ title: string; html: string } | null> {
  const file = await world.shareStore.get(id, SHARE_NOTE_FILE);
  return file ? (JSON.parse(new TextDecoder().decode(file.bytes)) as { title: string; html: string }) : null;
}

/** A store whose first write fails, as a Blob outage would. */
function failingOnce(): ShareStore {
  const store = createMemoryShareStore();
  let failed = false;
  return {
    ...store,
    put: async (id, files) => {
      if (!failed) {
        failed = true;
        throw new Error("The share store is down");
      }
      return store.put(id, files);
    },
  };
}

describe("share links in sync", () => {
  it("publishes a note when its share id lands, and updates the copy with each sync that changes the note", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Trip notes");
    laptop.store.editBody(id, "# Day one\n\nSunny.\n");
    const other = laptop.store.createNote();
    laptop.store.rename(other, "Private");
    laptop.store.editBody(other, "Secret plans\n");
    await laptop.sync();

    const share = newShareId();
    expect(await publishedNote(world, share)).toBeNull();
    laptop.store.setShare(id, share);
    expect(laptop.store.note(id)).toMatchObject({ share, synced: false });
    await laptop.sync();

    expect(readNote(world.github.files(member, notebook)["Trip notes.md"]).share).toBe(share);
    expect(laptop.store.note(id)).toMatchObject({ share, synced: true });
    expect(await publishedNote(world, share)).toMatchObject({ title: "Trip notes", html: "<h1>Day one</h1>\n<p>Sunny.</p>\n" });

    laptop.store.editBody(id, "# Day one\n\nSunny.\n\n# Day two\n\nRain.\n");
    await laptop.sync();
    expect((await publishedNote(world, share))?.html).toContain("<h1>Day two</h1>");

    // The link rides on the note through a rename.
    laptop.store.rename(id, "Trip notes, revised");
    await laptop.sync();
    expect(await publishedNote(world, share)).toMatchObject({ title: "Trip notes, revised" });
    expect(laptop.store.note(id)).toMatchObject({ share, synced: true });

    // The copy holds this note and nothing else: no other note, no frontmatter, no app URL.
    const copy = new TextDecoder().decode((await world.shareStore.get(share, SHARE_NOTE_FILE))?.bytes);
    expect(copy).not.toContain("Secret plans");
    expect(copy).not.toContain(id);
    expect(copy).not.toMatch(/tags|created|share:/);
    expect(copy).not.toContain("/api/");
  });

  it("copies the attachments the note shows into the published copy, never linking them through the app", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Postcard");
    const link = laptop.store.addAttachment(laptop.store.personalNotebook, { type: "image/png", bytes: new Blob([pngBytes], { type: "image/png" }) });
    laptop.store.editBody(id, `Wish you were here\n\n![Beach](${link})\n`);
    const share = newShareId();
    laptop.store.setShare(id, share);
    await laptop.sync();

    const path = link.slice(1);
    const copied = await world.shareStore.get(share, path);
    expect(copied).toMatchObject({ contentType: "image/png" });
    expect([...(copied?.bytes ?? [])]).toEqual([...pngBytes]);
    const { html } = (await publishedNote(world, share)) ?? { html: "" };
    expect(html).toContain(`<img src="/s/${share}/${path}" alt="Beach">`);
    expect(html).not.toContain("/api/");
  });

  it("shows a note shared on one device as shared on another, which republishes it when it edits the note", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Agenda");
    laptop.store.editBody(id, "Item one\n");
    const share = newShareId();
    laptop.store.setShare(id, share);
    await laptop.sync();

    const phone = await world.signIn(member);
    await phone.sync();
    expect(phone.store.note(id)).toMatchObject({ title: "Agenda", share });

    phone.store.editBody(id, "Item one\nItem two\n");
    await phone.sync();
    expect((await publishedNote(world, share))?.html).toContain("Item two");
  });

  it("reports a publish that failed and does it with the next sync", async () => {
    const world = createWorld({ shareStore: failingOnce() });
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Flaky");
    laptop.store.editBody(id, "Hello\n");
    const share = newShareId();
    laptop.store.setShare(id, share);

    await expect(laptop.sync()).rejects.toThrow();
    expect(laptop.engine.getStatus().state).not.toBe("idle");
    // The note itself landed: only the publishing is outstanding.
    expect(readNote(world.github.files(member, notebook)["Flaky.md"]).share).toBe(share);
    expect(await publishedNote(world, share)).toBeNull();

    await laptop.sync();
    expect((await publishedNote(world, share))?.html).toContain("Hello");
    expect(laptop.engine.getStatus().state).toBe("idle");
  });

  it("stops sharing: the copy goes, then the frontmatter field goes with the next sync", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Ephemeral");
    laptop.store.editBody(id, "Gone soon\n");
    const share = newShareId();
    laptop.store.setShare(id, share);
    await laptop.sync();
    expect(await publishedNote(world, share)).not.toBeNull();

    const revoked = await world.callApi(`/api/notebooks/${member}/${notebook}/share`, {
      method: "DELETE",
      as: laptop,
      body: { id: share },
    });
    expect(revoked.status).toBe(200);
    laptop.store.setShare(id, null);
    expect(laptop.store.note(id)).toMatchObject({ share: null });
    await laptop.sync();

    expect(await publishedNote(world, share)).toBeNull();
    const file = world.github.files(member, notebook)["Ephemeral.md"];
    expect(readNote(file)).toMatchObject({ share: null, body: "Gone soon\n" });
    expect(file).not.toContain("share");
  });
});
