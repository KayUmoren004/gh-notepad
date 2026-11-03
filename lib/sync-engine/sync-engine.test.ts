import { describe, expect, it } from "vitest";
import { readNote } from "@/lib/notebook-format";
import { createWorld } from "@/test/devices";
import type { SyncEngine, Timers } from ".";

const member = "octo-member";
const notebook = "my-notes";

/** A clock that only moves when the test says so. */
function manualTimers(): Timers & { advance: (ms: number) => void } {
  let now = 0;
  let nextHandle = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => now,
    setTimeout: (callback, ms) => {
      pending.set(++nextHandle, { at: now + ms, callback });
      return nextHandle;
    },
    clearTimeout: (handle) => void pending.delete(handle as number),
    advance: (ms) => {
      const until = now + ms;
      for (;;) {
        const [handle, next] = [...pending].sort(([, a], [, b]) => a.at - b.at)[0] ?? [];
        if (handle === undefined || !next || next.at > until) break;
        pending.delete(handle);
        now = next.at;
        next.callback();
      }
      now = until;
    },
  };
}

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

describe("v1 regressions", () => {
  it("a new note typed into immediately reaches GitHub", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);

    const id = laptop.store.createNote();
    laptop.store.rename(id, "Groceries");
    laptop.store.editBody(id, "- Milk\n- Bread\n");
    await laptop.sync();

    const file = world.github.files(member, notebook)["Groceries.md"];
    expect(file).toBeDefined();
    expect(readNote(file)).toMatchObject({ id, body: "- Milk\n- Bread\n" });
    expect(laptop.store.note(id)).toMatchObject({ title: "Groceries", synced: true });
  });

  it("text typed while a sync is in flight survives it, and goes out with the next sync", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Draft");
    laptop.store.editBody(id, "First line\n");

    const commit = world.holdGitHub((request) => request.method === "PATCH" && request.url.includes("/git/refs/"));
    const syncing = laptop.sync();
    await commit.reached;
    laptop.store.editBody(id, "First line\nTyped during the sync\n");
    commit.release();
    await syncing;

    expect(laptop.store.note(id)).toMatchObject({ body: "First line\nTyped during the sync\n", synced: false });
    expect(readNote(world.github.files(member, notebook)["Draft.md"]).body).toBe("First line\n");

    await laptop.sync();
    expect(readNote(world.github.files(member, notebook)["Draft.md"]).body).toBe("First line\nTyped during the sync\n");
    expect(laptop.store.note(id)).toMatchObject({ synced: true });
  });

  it("text typed while a pull brings in other changes is not replaced by the notebook's copy", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Journal");
    laptop.store.editBody(id, "Monday\n");
    await laptop.sync();
    world.github.commitFiles(member, notebook, { message: "Add a note on github.com", files: { "Elsewhere.md": "Hi\n" } });

    const tree = world.holdGitHub((request) => request.method === "GET" && request.url.includes("/git/trees/"));
    const syncing = laptop.sync();
    await tree.reached;
    laptop.store.editBody(id, "Monday\nTuesday\n");
    tree.release();
    await syncing;

    expect(laptop.store.note(id)).toMatchObject({ body: "Monday\nTuesday\n" });
    expect(readNote(world.github.files(member, notebook)["Journal.md"]).body).toBe("Monday\nTuesday\n");
    expect([...laptop.store.getState().notes.values()].map((note) => note.title)).toContain("Elsewhere");
  });

  it("consecutive saves never send stale versions", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Counter");

    for (const body of ["one\n", "two\n", "three\n"]) {
      laptop.store.editBody(id, body);
      await laptop.sync();
    }

    expect(readNote(world.github.files(member, notebook)["Counter.md"]).body).toBe("three\n");
    expect(world.github.commits(member, notebook).map((commit) => commit.message)).toEqual([
      'Update "Counter"',
      'Update "Counter"',
      'Add "Counter"',
      "Initial commit",
    ]);
    // v1's symptom: GitHub rejecting writes made against a version it no longer had.
    expect(world.github.requests().filter((request) => request.method !== "GET" && request.status >= 400)).toEqual([]);
    expect(laptop.store.note(id)).toMatchObject({ synced: true });
  });

  it("a note keeps its identity across its first sync, on this device and the next", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Plans");
    const before = laptop.store.note(id);

    await laptop.sync();

    expect(laptop.store.note(id)).toMatchObject({ id, title: "Plans", path: "Plans.md", created: before?.created });
    expect([...laptop.store.getState().notes.values()].filter((note) => note.title === "Plans")).toHaveLength(1);
    const phone = await world.signIn(member);
    await phone.sync();
    expect(phone.store.note(id)).toMatchObject({ title: "Plans", synced: true });
  });
});

describe("renaming", () => {
  it("moves the note's file in the same commit, and the note keeps its id", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Shopping");
    laptop.store.editBody(id, "- Eggs\n");
    await laptop.sync();

    laptop.store.rename(id, "Groceries");
    await laptop.sync();

    const [latest] = world.github.commits(member, notebook);
    expect(latest).toMatchObject({
      message: 'Rename "Shopping" to "Groceries"',
      files: [
        { path: "Groceries.md", status: "added" },
        { path: "Shopping.md", status: "removed" },
      ],
    });
    expect(readNote(world.github.files(member, notebook)["Groceries.md"])).toMatchObject({ id, body: "- Eggs\n" });
    expect(laptop.store.note(id)).toMatchObject({ title: "Groceries", synced: true });
  });

  it("is followed by another device, which keeps the note's identity", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const phone = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Ideas");
    await laptop.sync();
    await phone.sync();

    laptop.store.rename(id, "Big ideas");
    await laptop.sync();
    await phone.sync();

    expect(phone.store.note(id)).toMatchObject({ title: "Big ideas", synced: true });
    expect([...phone.store.getState().notes.values()].map((note) => note.title).sort()).toEqual(["Big ideas", "README"]);
  });

  it("sanitises and de-duplicates titles, so a title never fails to save", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const first = laptop.store.createNote();
    const second = laptop.store.createNote();
    laptop.store.rename(first, "Q1/Q2: plans");
    laptop.store.rename(second, "Q1/Q2: plans");
    await laptop.sync();

    expect(laptop.store.note(first)?.title).toBe("Q1-Q2- plans");
    expect(laptop.store.note(second)?.title).toBe("Q1-Q2- plans 2");
    expect(Object.keys(world.github.files(member, notebook)).sort()).toEqual([
      "Q1-Q2- plans 2.md",
      "Q1-Q2- plans.md",
      "README.md",
    ]);
  });
});

describe("changes made outside the app", () => {
  it("a note added or edited directly in the repository appears after the next pull", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Todo");
    laptop.store.editBody(id, "- [ ] Call the bank\n");
    await laptop.sync();

    const todo = world.github.files(member, notebook)["Todo.md"];
    world.github.commitFiles(member, notebook, {
      message: "Edit on github.com",
      files: {
        "Todo.md": todo.replace("- [ ] Call", "- [x] Call"),
        "Recipes/Pancakes.md": "# Pancakes\n\nFlour, eggs, milk.\n",
      },
    });
    await laptop.sync();

    expect(laptop.store.note(id)).toMatchObject({ body: "- [x] Call the bank\n", synced: true });
    const pancakes = [...laptop.store.getState().notes.values()].find((note) => note.title === "Pancakes");
    expect(pancakes).toMatchObject({ folder: "Recipes", body: "# Pancakes\n\nFlour, eggs, milk.\n", synced: true });
  });

  it("a file written without frontmatter gets it the first time the app saves it, keeping its identity", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: member, name: notebook, files: { "Plain.md": "Written in vim.\n" } });
    const laptop = await world.signIn(member);
    const phone = await world.signIn(member);
    await laptop.sync();
    await phone.sync();
    const plain = [...laptop.store.getState().notes.values()].find((note) => note.title === "Plain");
    if (!plain) throw new Error("The plain note didn't arrive");

    // Opening and not changing it leaves the file alone.
    laptop.store.editBody(plain.id, plain.body);
    await laptop.sync();
    expect(world.github.files(member, notebook)["Plain.md"]).toBe("Written in vim.\n");

    laptop.store.editBody(plain.id, "Written in vim.\nEdited in the app.\n");
    await laptop.sync();
    await phone.sync();

    expect(readNote(world.github.files(member, notebook)["Plain.md"])).toMatchObject({
      id: plain.id,
      body: "Written in vim.\nEdited in the app.\n",
    });
    expect([...phone.store.getState().notes.values()].find((note) => note.title === "Plain")).toMatchObject({
      id: plain.id,
      body: "Written in vim.\nEdited in the app.\n",
    });
  });

  it("a new note whose title a note from elsewhere took meanwhile is re-titled, never written over it", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Ideas");
    laptop.store.editBody(id, "From the laptop\n");
    world.github.commitFiles(member, notebook, { message: "Add on github.com", files: { "Ideas.md": "From github.com\n" } });

    await laptop.sync();

    const files = world.github.files(member, notebook);
    expect(files["Ideas.md"]).toBe("From github.com\n");
    expect(readNote(files["Ideas 2.md"])).toMatchObject({ id, body: "From the laptop\n" });
    expect(laptop.store.note(id)).toMatchObject({ title: "Ideas 2", synced: true });
  });

  it("a note deleted in the repository leaves the device", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Temporary");
    await laptop.sync();

    world.github.commitFiles(member, notebook, { message: "Delete on github.com", files: { "Temporary.md": null } });
    await laptop.sync();

    expect(laptop.store.note(id)).toBeUndefined();
  });
});

describe("what a sync costs", () => {
  it("makes one commit for everything changed since the last sync, with a readable message", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();
    const before = world.github.commits(member, notebook).length;

    for (const title of ["Monday", "Tuesday", "Wednesday"]) {
      const id = laptop.store.createNote();
      laptop.store.rename(id, title);
      laptop.store.editBody(id, `${title}'s notes\n`);
    }
    await laptop.sync();

    const commits = world.github.commits(member, notebook);
    expect(commits).toHaveLength(before + 1);
    expect(commits[0]).toMatchObject({
      message: "Update 3 notes",
      files: [
        { path: "Monday.md", status: "added" },
        { path: "Tuesday.md", status: "added" },
        { path: "Wednesday.md", status: "added" },
      ],
    });
  });

  it("makes no commit when nothing changed on the device", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();
    const before = world.github.commits(member, notebook).length;

    world.github.commitFiles(member, notebook, { message: "Edit on github.com", files: { "Remote.md": "Hi\n" } });
    await laptop.sync();

    expect(world.github.commits(member, notebook)).toHaveLength(before + 1);
  });

  it("an unchanged notebook costs one conditional request that answers 304", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.editBody(id, "Something\n");
    await laptop.sync();
    const before = world.github.requests().length;

    await laptop.sync();

    expect(world.github.requests().slice(before)).toEqual([
      { method: "GET", path: `/repos/${member}/${notebook}/commits/main`, status: 304 },
    ]);
  });

  it("fetches only the notes that changed since the last pull", async () => {
    const world = createWorld();
    world.github.addRepo({
      owner: member,
      name: notebook,
      files: { "One.md": "1\n", "Two.md": "2\n", "Three.md": "3\n" },
    });
    const laptop = await world.signIn(member);
    await laptop.sync();
    world.github.commitFiles(member, notebook, { message: "Edit on github.com", files: { "Two.md": "two\n" } });
    const before = world.github.requests().length;

    await laptop.sync();

    const blobReads = world.github.requests().slice(before).filter((request) => request.path.includes("/git/blobs/"));
    expect(blobReads).toHaveLength(1);
    expect([...laptop.store.getState().notes.values()].find((note) => note.title === "Two")?.body).toBe("two\n");
  });
});

describe("saving on the device", () => {
  it("marks a note saved once its latest edit is stored on the device", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.editBody(id, "Typed\n");
    expect(laptop.store.note(id)).toMatchObject({ saved: false, synced: false });

    await laptop.store.flush();

    expect(laptop.store.note(id)).toMatchObject({ saved: true, synced: false });
  });

  it("keeps every edit through closing and reopening the app before any sync", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Thoughts");
    laptop.store.editBody(id, "Typed before any sync\n");

    const reopened = await laptop.reopen();

    expect(reopened.store.note(id)).toMatchObject({
      title: "Thoughts",
      body: "Typed before any sync\n",
      saved: true,
      synced: false,
    });
    await reopened.sync();
    expect(reopened.store.note(id)).toMatchObject({ synced: true });
    expect(readNote(world.github.files(member, notebook)["Thoughts.md"]).body).toBe("Typed before any sync\n");
  });

  it("keeps each GitHub account's notes apart on a shared browser", async () => {
    const world = createWorld({ members: [member, "octo-friend"] });
    const mine = await world.signIn(member);
    const id = mine.store.createNote();
    mine.store.editBody(id, "Private\n");
    await mine.store.flush();

    const theirs = await world.signIn("octo-friend", { sameBrowserAs: mine });

    expect(theirs.store.note(id)).toBeUndefined();
    expect(theirs.store.getState().notes.size).toBe(0);
  });
});

describe("scheduling", () => {
  it("runs one sync at a time; asking during a sync schedules exactly one more", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();
    const before = world.github.requests().length;

    const head = world.holdGitHub((request) => request.url.includes("/commits/main"));
    const first = laptop.sync();
    await head.reached;
    const asked = [laptop.sync(), laptop.sync(), laptop.sync()];
    head.release();
    await Promise.all([first, ...asked]);

    const headChecks = world.github.requests().slice(before).filter((request) => request.path.endsWith("/commits/main"));
    expect(headChecks).toHaveLength(2);
  });

  it("syncs about 3 s after typing stops, and no later than about 20 s into continuous typing", async () => {
    const timers = manualTimers();
    const world = createWorld();
    const laptop = await world.signIn(member, { timers });
    laptop.engine.start();
    await settled(laptop.engine);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Typing");

    laptop.store.editBody(id, "a");
    timers.advance(2_900);
    expect(laptop.engine.getStatus().state).not.toBe("syncing");
    let done = settled(laptop.engine);
    timers.advance(100);
    expect(laptop.engine.getStatus().state).toBe("syncing");
    await done;
    expect(readNote(world.github.files(member, notebook)["Typing.md"]).body).toBe("a");

    // A keystroke every second: the pause never comes, so the 20 s cap does.
    for (let second = 1; second < 20; second++) {
      laptop.store.editBody(id, "a".repeat(second + 1));
      timers.advance(1_000);
      expect(laptop.engine.getStatus().state).not.toBe("syncing");
    }
    done = settled(laptop.engine);
    laptop.store.editBody(id, "a".repeat(21));
    timers.advance(1_000);
    expect(laptop.engine.getStatus().state).toBe("syncing");
    await done;
    expect(readNote(world.github.files(member, notebook)["Typing.md"]).body).toBe("a".repeat(21));
    laptop.engine.stop();
  });
});

describe("the personal notebook", () => {
  it("is created private, with an initial commit, the first time a member syncs", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);

    await laptop.sync();

    expect(world.github.repo(member, notebook)).toMatchObject({ private: true });
    expect(world.github.commits(member, notebook)).toHaveLength(1);
  });

  it("is used as it is when it already exists", async () => {
    const world = createWorld();
    world.github.addRepo({ owner: member, name: notebook, private: false, files: { "Existing.md": "Hello\n" } });
    const laptop = await world.signIn(member);

    await laptop.sync();

    expect(world.github.repo(member, notebook)).toMatchObject({ private: false });
    expect([...laptop.store.getState().notes.values()].map((note) => note.title)).toEqual(["Existing"]);
    expect(world.github.requests().filter((request) => request.path === "/user/repos")).toEqual([]);
  });
});
