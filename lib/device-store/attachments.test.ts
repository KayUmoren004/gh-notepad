import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { ATTACHMENT_LIMIT_BYTES } from "@/lib/attachments";
import { openDeviceStore, type DeviceStore } from ".";

const account = { id: 7, login: "octo-member" };
const png = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], { type: "image/png" });

async function open(indexedDB = new IDBFactory()): Promise<DeviceStore & { indexedDB: IDBFactory }> {
  const store = await openDeviceStore({ account, indexedDB, IDBKeyRange, writeDelayMs: 0 });
  return Object.assign(store, { indexedDB });
}

async function bytesAt(url: string): Promise<number[]> {
  return [...new Uint8Array(await (await fetch(url)).arrayBuffer())];
}

describe("attachments on the device", () => {
  it("stores an image at once, links it from the notebook root, and shows it from the device copy", async () => {
    const store = await open();
    const notebook = store.personalNotebook;

    const link = store.addAttachment(notebook, { type: "image/png", bytes: png });

    expect(link).toMatch(/^\/attachments\/[0-9a-f-]{36}\.png$/);
    const src = store.attachmentSrc(notebook, link.slice(1));
    expect(src).toMatch(/^blob:/);
    expect(await bytesAt(src as string)).toEqual([...new Uint8Array(await png.arrayBuffer())]);
    await store.close();
  });

  it("keeps the device copy across a reload, still pending for the next sync", async () => {
    const first = await open();
    const notebook = first.personalNotebook;
    const link = first.addAttachment(notebook, { type: "image/png", bytes: png });
    await first.close();

    const again = await open(first.indexedDB);
    const [pending] = again.sync.pendingAttachments(notebook);
    expect(pending).toMatchObject({ path: link.slice(1), type: "image/png", sha: null });
    expect([...new Uint8Array(await pending.bytes.arrayBuffer())]).toEqual([...new Uint8Array(await png.arrayBuffer())]);
    expect(again.attachmentSrc(notebook, link.slice(1))).toMatch(/^blob:/);
    await again.close();
  });

  it("refuses a file that isn't an attachable image, storing nothing", async () => {
    const store = await open();
    const notebook = store.personalNotebook;

    expect(() => store.addAttachment(notebook, { type: "text/plain", bytes: new Blob(["hi"]) })).toThrow(
      "Images only (JPEG, PNG, GIF, WebP, SVG)",
    );
    expect(() =>
      store.addAttachment(notebook, { type: "image/png", bytes: new Blob([new Uint8Array(ATTACHMENT_LIMIT_BYTES + 1)]) }),
    ).toThrow("Images must be under 4 MB");

    expect(store.sync.pendingAttachments(notebook)).toEqual([]);
    expect(store.getState().failedAttachments).toEqual([]);
    await store.close();

    const again = await open(store.indexedDB);
    expect(again.sync.pendingAttachments(notebook)).toEqual([]);
    await again.close();
  });

  it("keeps an attachment the notebook refused out of future pushes, listed as failed across a reload, still shown", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    const path = store.addAttachment(notebook, { type: "image/png", bytes: png }).slice(1);

    store.sync.failAttachment(notebook, path, "Images must be under 4 MB");

    expect(store.sync.pendingAttachments(notebook)).toEqual([]);
    expect(store.getState().failedAttachments).toEqual([{ notebook, path, reason: "Images must be under 4 MB" }]);
    expect(store.attachmentSrc(notebook, path)).toMatch(/^blob:/);
    await store.close();

    const again = await open(store.indexedDB);
    expect(again.sync.pendingAttachments(notebook)).toEqual([]);
    expect(again.getState().failedAttachments).toEqual([{ notebook, path, reason: "Images must be under 4 MB" }]);
    await again.close();
  });

  it("removing an attachment takes its images out of the notes that embed it and forgets the device copy", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    const link = store.addAttachment(notebook, { type: "image/png", bytes: png });
    const path = link.slice(1);
    const id = store.createNote();
    store.editBody(id, `Day one\n\n![Beach](${link})\n\nDay two\n`);
    const other = store.createNote();
    store.editBody(other, "No image\n");
    store.sync.failAttachment(notebook, path, "Images must be under 4 MB");
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.note(id)?.body ?? ""));

    store.removeAttachment(notebook, path);

    expect(store.note(id)?.body).toBe("Day one\n\nDay two\n");
    expect(store.note(other)?.body).toBe("No image\n");
    expect(seen.at(-1)).toBe("Day one\n\nDay two\n");
    expect(store.getState().failedAttachments).toEqual([]);
    expect(store.attachmentSrc(notebook, path)).toBeNull();
    await store.close();

    const again = await open(store.indexedDB);
    expect(again.note(id)?.body).toBe("Day one\n\nDay two\n");
    expect(again.attachmentSrc(notebook, path)).toBeNull();
    expect(again.sync.pendingAttachments(notebook)).toEqual([]);
    await again.close();
  });

  it("stops offering an attachment to sync once it is committed, but still shows it", async () => {
    const store = await open();
    const notebook = store.personalNotebook;
    const path = store.addAttachment(notebook, { type: "image/png", bytes: png }).slice(1);

    store.sync.recordAttachmentBlob(notebook, path, "a".repeat(40));
    expect(store.sync.pendingAttachments(notebook)).toMatchObject([{ path, sha: "a".repeat(40) }]);
    store.sync.applyAttachmentPush(notebook, [path]);
    expect(store.sync.pendingAttachments(notebook)).toEqual([]);
    expect(store.attachmentSrc(notebook, path)).toMatch(/^blob:/);
    await store.close();

    const again = await open(store.indexedDB);
    expect(again.sync.pendingAttachments(notebook)).toEqual([]);
    expect(again.attachmentSrc(notebook, path)).toMatch(/^blob:/);
    await again.close();
  });

  it("only shows attachments it holds; anything else is fetched from the notebook", async () => {
    const store = await open();
    expect(store.attachmentSrc(store.personalNotebook, "attachments/elsewhere.png")).toBeNull();
    await store.close();
  });
});
