import { describe, expect, it } from "vitest";
import { readNote } from "@/lib/notebook-format";
import { createWorld, type Device, type World } from "@/test/devices";
import type { SyncEngine, SyncStatus } from ".";

const member = "octo-member";
const notebook = "my-notes";

/** Every status the engine passes through from now on. */
function statuses(engine: SyncEngine): SyncStatus[] {
  const seen: SyncStatus[] = [];
  engine.subscribe(() => {
    const status = engine.getStatus();
    if (seen.at(-1) !== status) seen.push(status);
  });
  return seen;
}

/** `Note 0001` … `Note <count>`, as notes written outside the app. */
function noteFiles(count: number): Record<string, string> {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [`Note ${number(index + 1)}.md`, `Body ${index + 1}\n`]));
}

const number = (n: number) => String(n).padStart(4, "0");

/** Renames every `Note NNNN` on the device to `Renamed NNNN`: two changes each, which must land together. */
function renameAll(device: Device) {
  for (const note of device.store.getState().notes.values()) {
    if (note.title.startsWith("Note ")) device.store.rename(note.id, note.title.replace("Note ", "Renamed "));
  }
}

/** Each commit's removed and added titles, numbered: a rename is split when the two differ. */
function renamesIn(commit: { files: { path: string; status: string }[] }) {
  const numbered = (status: string) =>
    commit.files
      .filter((file) => file.status === status)
      .map((file) => file.path.replace(/^\D+/, "").replace(/\.md$/, ""))
      .sort();
  return { removed: numbered("removed"), added: numbered("added") };
}

/** Breaks the device's network right after the commit on its way to GitHub lands. */
async function failAfterNextCommit(world: World, device: Device, syncing: Promise<void>) {
  const landing = world.holdGitHub((request) => request.method === "PATCH" && request.url.includes("/git/refs/"));
  await landing.reached;
  landing.release();
  device.setNetwork("failing");
  await expect(syncing).rejects.toThrow();
  expect(device.engine.getStatus()).toMatchObject({ state: "failed" });
}

describe("a push with more changes than one commit can carry", () => {
  it("lands 2,500 changes as three commits, every change present and no rename split across commits", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: member, name: notebook, files: { "README.md": "# my-notes\n", ...noteFiles(1250) } });
    const laptop = await world.signIn(member);
    await laptop.sync();
    const before = world.github.commits(member, notebook).length;

    renameAll(laptop);
    await laptop.sync();

    const commits = world.github.commits(member, notebook).slice(0, -before);
    expect(commits.map((commit) => commit.message)).toEqual([
      "Update 1,250 notes (3 of 3)",
      "Update 1,250 notes (2 of 3)",
      "Update 1,250 notes (1 of 3)",
    ]);
    for (const commit of commits) {
      expect(commit.files.length).toBeLessThanOrEqual(1000);
      const { removed, added } = renamesIn(commit);
      expect(added).toEqual(removed);
    }
    expect(commits.reduce((total, commit) => total + commit.files.length, 0)).toBe(2500);

    const files = world.github.files(member, notebook);
    expect(Object.keys(files)).toHaveLength(1251);
    expect(Object.keys(files).filter((path) => path.startsWith("Note "))).toEqual([]);
    expect(readNote(files["Renamed 1250.md"]).body).toBe("Body 1250\n");
    const notes = [...laptop.store.getState().notes.values()];
    expect(notes.filter((note) => note.title.startsWith("Renamed "))).toHaveLength(1250);
    expect(notes.filter((note) => !note.synced)).toEqual([]);
  }, 60_000);

  it("shows how far the push has come while it runs", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member, { maxChangesPerCommit: 2 });
    await laptop.sync();
    for (const title of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
      laptop.store.rename(laptop.store.createNote(), title);
    }
    const seen = statuses(laptop.engine);

    await laptop.sync();

    expect(seen.filter((status) => status.state === "syncing" && status.progress)).toEqual([
      { state: "syncing", progress: { done: 0, total: 3 } },
      { state: "syncing", progress: { done: 1, total: 3 } },
      { state: "syncing", progress: { done: 2, total: 3 } },
    ]);
    expect(laptop.engine.getStatus()).toMatchObject({ state: "idle" });
    expect(world.github.commits(member, notebook).map((commit) => commit.message).slice(0, 3)).toEqual([
      "Update 5 notes (3 of 3)",
      "Update 5 notes (2 of 3)",
      "Update 5 notes (1 of 3)",
    ]);
  });

  it("keeps a note and the attachments it embeds in the same commit", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member, { maxChangesPerCommit: 3 });
    await laptop.sync();
    const before = world.github.commits(member, notebook).length;
    const png = () => new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])], { type: "image/png" });
    for (const title of ["Alpha", "Beta", "Gamma"]) {
      const id = laptop.store.createNote();
      laptop.store.rename(id, title);
      const link = laptop.store.addAttachment(laptop.store.personalNotebook, { type: "image/png", bytes: png() });
      laptop.store.editBody(id, `![](${link})\n`);
    }

    await laptop.sync();

    const commits = world.github.commits(member, notebook).slice(0, -before);
    expect(commits.map((commit) => commit.message)).toEqual([
      "Update 3 notes and add 3 attachments (3 of 3)",
      "Update 3 notes and add 3 attachments (2 of 3)",
      "Update 3 notes and add 3 attachments (1 of 3)",
    ]);
    const files = world.github.files(member, notebook);
    for (const commit of commits) {
      const [note, attachment] = commit.files.map((file) => file.path).sort();
      expect(note).toMatch(/^(Alpha|Beta|Gamma)\.md$/);
      expect(attachment).toMatch(/^attachments\/.+\.png$/);
      expect(readNote(files[note]).body).toBe(`![](/${attachment})\n`);
    }
    expect(laptop.store.sync.pendingAttachments(laptop.store.personalNotebook)).toEqual([]);
    expect([...laptop.store.getState().notes.values()].filter((note) => !note.synced)).toEqual([]);
  });

  it("a failure after the first commit leaves it in place, and the next sync resumes without duplicating or losing changes", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: member, name: notebook, files: { "README.md": "# my-notes\n", ...noteFiles(5) } });
    const laptop = await world.signIn(member, { maxChangesPerCommit: 4 });
    await laptop.sync();
    const before = world.github.commits(member, notebook).length;
    renameAll(laptop);

    await failAfterNextCommit(world, laptop, laptop.sync());

    let commits = world.github.commits(member, notebook).slice(0, -before);
    expect(commits.map((commit) => commit.message)).toEqual(["Update 5 notes (1 of 3)"]);
    const landed = renamesIn(commits[0]).added;
    expect(landed).toHaveLength(2);
    const notes = () => [...laptop.store.getState().notes.values()].filter((note) => note.title.startsWith("Renamed "));
    expect(notes().filter((note) => note.synced).map((note) => note.title.replace("Renamed ", ""))).toEqual(landed);
    expect(notes().filter((note) => !note.synced)).toHaveLength(3);

    laptop.setNetwork("online");
    const reopened = await laptop.reopen();
    await reopened.sync();

    commits = world.github.commits(member, notebook).slice(0, -before);
    expect(commits.map((commit) => commit.message)).toEqual([
      "Update 3 notes (2 of 2)",
      "Update 3 notes (1 of 2)",
      "Update 5 notes (1 of 3)",
    ]);
    const added = commits.flatMap((commit) => renamesIn(commit).added).sort();
    expect(added).toEqual(["0001", "0002", "0003", "0004", "0005"]);
    for (const commit of commits) expect(renamesIn(commit).added).toEqual(renamesIn(commit).removed);
    expect(Object.keys(world.github.files(member, notebook)).sort()).toEqual([
      "README.md",
      ...Array.from({ length: 5 }, (_, index) => `Renamed ${number(index + 1)}.md`),
    ]);
    const after = [...reopened.store.getState().notes.values()];
    expect(after.filter((note) => note.title.startsWith("Renamed ") && note.synced)).toHaveLength(5);
    expect(after).toHaveLength(6);
  });
});

/** A v1 notebook of `count` notes, every other one in the Work folder, with v1's metadata file. */
function v1Notebook(count: number): Record<string, string> {
  const files: Record<string, string> = {
    "README.md": "# my-notes\n",
    "metadata.json": JSON.stringify({ folders: ["Work"], tags: [] }),
  };
  for (let n = 1; n <= count; n++) {
    files[`notes/v1-${number(n)}.json`] = JSON.stringify({
      id: `v1-${number(n)}`,
      title: `Note ${number(n)}`,
      content: `Body ${n}\n`,
      folder: n % 2 ? "Work" : null,
      tags: [],
      createdAt: "2024-01-01T09:00:00.000Z",
      updatedAt: "2024-01-02T18:30:00.000Z",
    });
  }
  return files;
}

/** The converted notebook's files: `Work/Note 0001.md`, `Note 0002.md`, …, and the README. */
function convertedPaths(count: number): string[] {
  return ["README.md", ...Array.from({ length: count }, (_, i) => `${i % 2 ? "" : "Work/"}Note ${number(i + 1)}.md`)].sort();
}

/** True when every converted note added by `commit` has its v1 file removed by the same commit. */
function conversionsWhole(commit: { files: { path: string; status: string }[] }): boolean {
  const added = commit.files.filter((file) => file.status === "added").map((file) => file.path.replace(/^.*Note (\d+)\.md$/, "$1"));
  const removed = commit.files.filter((file) => file.status === "removed").map((file) => file.path.replace(/^notes\/v1-(\d+)\.json$/, "$1"));
  return added.every((n) => removed.includes(n)) && removed.filter((n) => /^\d+$/.test(n)).every((n) => added.includes(n));
}

describe("converting a large v1 notebook", () => {
  it("converts 600 notes completely, over two commits that each keep every conversion whole", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: member, name: notebook, files: v1Notebook(600) });
    const laptop = await world.signIn(member);

    await laptop.sync();

    const files = world.github.files(member, notebook);
    expect(Object.keys(files).sort()).toEqual(convertedPaths(600));
    expect(readNote(files["Work/Note 0599.md"])).toMatchObject({ id: "v1-0599", body: "Body 599\n" });
    const commits = world.github.commits(member, notebook);
    expect(commits.map((commit) => commit.message)).toEqual([
      "Convert v1 notes to Markdown (2 of 2)",
      "Convert v1 notes to Markdown (1 of 2)",
      "Initial commit",
    ]);
    for (const commit of commits.slice(0, 2)) {
      expect(commit.files.length).toBeLessThanOrEqual(1000);
      expect(conversionsWhole(commit)).toBe(true);
    }
    const notes = [...laptop.store.getState().notes.values()];
    expect(notes).toHaveLength(601);
    expect(notes.filter((note) => !note.synced)).toEqual([]);
    expect(laptop.engine.getMigrationReport()).toEqual({ notebook: `${member}/${notebook}`, commit: commits[0].sha, skipped: [] });

    const before = world.github.requests().length;
    await laptop.sync();
    expect(world.github.requests().slice(before)).toEqual([
      { method: "GET", path: `/repos/${member}/${notebook}/commits/main`, status: 304 },
    ]);
  }, 60_000);

  it("finishes a conversion that failed part-way on the next sync, without converting anything twice", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: member, name: notebook, files: v1Notebook(600) });
    const laptop = await world.signIn(member);

    await failAfterNextCommit(world, laptop, laptop.sync());
    expect(world.github.commits(member, notebook)).toHaveLength(2);
    expect(laptop.engine.getMigrationReport()).toBeNull();

    laptop.setNetwork("online");
    await laptop.sync();

    const files = world.github.files(member, notebook);
    expect(Object.keys(files).sort()).toEqual(convertedPaths(600));
    const commits = world.github.commits(member, notebook);
    expect(commits.map((commit) => commit.message)).toEqual([
      "Convert v1 notes to Markdown",
      "Convert v1 notes to Markdown (1 of 2)",
      "Initial commit",
    ]);
    for (const commit of commits.slice(0, 2)) expect(conversionsWhole(commit)).toBe(true);
    const converted = commits.slice(0, 2).flatMap((commit) => commit.files.filter((file) => file.status === "added"));
    expect(converted).toHaveLength(600);
    const notes = [...laptop.store.getState().notes.values()];
    expect(notes).toHaveLength(601);
    expect(notes.filter((note) => !note.synced)).toEqual([]);
    expect(laptop.engine.getMigrationReport()).toMatchObject({ commit: commits[0].sha });
  }, 60_000);
});
