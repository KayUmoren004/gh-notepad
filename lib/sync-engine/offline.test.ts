import { describe, expect, it } from "vitest";
import { readNote } from "@/lib/notebook-format";
import { createWorld } from "@/test/devices";
import type { SyncEngine, SyncStatus, Timers } from ".";

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

/** Every status the engine passes through from now on. */
function statuses(engine: SyncEngine): SyncStatus[] {
  const seen: SyncStatus[] = [];
  engine.subscribe(() => {
    const status = engine.getStatus();
    if (seen.at(-1) !== status) seen.push(status);
  });
  return seen;
}

describe("working offline", () => {
  it("offline is a state, not an error: everything written offline is saved, then goes out in one commit on reconnect", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();
    const before = world.github.commits(member, notebook).length;

    laptop.setNetwork("offline");
    const trip = laptop.store.createNote();
    laptop.store.rename(trip, "Trip");
    laptop.store.editBody(trip, "- Passport\n");
    const packing = laptop.store.createNote();
    laptop.store.rename(packing, "Packing");
    laptop.store.editBody(packing, "- Socks\n");
    await expect(laptop.sync()).rejects.toThrow();
    expect(laptop.engine.getStatus()).toEqual({ state: "offline" });
    laptop.store.editBody(trip, "- Passport\n- Tickets\n");
    laptop.store.rename(packing, "Packing list");
    await laptop.store.flush();
    expect(laptop.store.note(trip)).toMatchObject({ title: "Trip", body: "- Passport\n- Tickets\n", saved: true, synced: false });
    expect(laptop.store.note(packing)).toMatchObject({ title: "Packing list", saved: true, synced: false });

    laptop.setNetwork("online");
    await laptop.sync();

    const commits = world.github.commits(member, notebook);
    expect(commits).toHaveLength(before + 1);
    expect(commits[0]).toMatchObject({
      message: "Update 2 notes",
      files: [
        { path: "Packing list.md", status: "added" },
        { path: "Trip.md", status: "added" },
      ],
    });
    const files = world.github.files(member, notebook);
    expect(readNote(files["Trip.md"])).toMatchObject({ id: trip, body: "- Passport\n- Tickets\n" });
    expect(readNote(files["Packing list.md"])).toMatchObject({ id: packing, body: "- Socks\n" });
    expect(laptop.store.note(trip)).toMatchObject({ synced: true });
    expect(laptop.store.note(packing)).toMatchObject({ synced: true });
    expect(laptop.engine.getStatus()).toMatchObject({ state: "idle" });
  });

  it("retries by itself while offline, waiting longer each time, and syncs as soon as it can", async () => {
    const timers = manualTimers();
    const world = createWorld();
    const laptop = await world.signIn(member, { timers });
    laptop.engine.start();
    await settled(laptop.engine);
    const seen = statuses(laptop.engine);

    laptop.setNetwork("offline");
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Offline");
    laptop.store.editBody(id, "Written offline\n");
    let done = settled(laptop.engine);
    timers.advance(3_000);
    await done;
    expect(laptop.engine.getStatus()).toEqual({ state: "offline" });
    const attempts = () => seen.filter((status) => status.state === "syncing").length;
    expect(attempts()).toBe(1);

    // Back-off: 2 s, then 4 s, then 8 s between attempts.
    for (const wait of [2_000, 4_000, 8_000]) {
      const soFar = attempts();
      timers.advance(wait - 1);
      expect(attempts()).toBe(soFar);
      done = settled(laptop.engine);
      timers.advance(1);
      await done;
      expect(attempts()).toBe(soFar + 1);
      expect(laptop.engine.getStatus()).toEqual({ state: "offline" });
    }

    laptop.setNetwork("online");
    done = settled(laptop.engine);
    timers.advance(16_000);
    await done;
    expect(laptop.engine.getStatus()).toMatchObject({ state: "idle" });
    expect(readNote(world.github.files(member, notebook)["Offline.md"]).body).toBe("Written offline\n");
    laptop.engine.stop();
  });

  it("a sync that fails shows when it will retry, and backs off while the failures continue", async () => {
    const timers = manualTimers();
    const world = createWorld();
    const laptop = await world.signIn(member, { timers });
    laptop.engine.start();
    await settled(laptop.engine);

    laptop.setNetwork("failing");
    const id = laptop.store.createNote();
    laptop.store.editBody(id, "Typed\n");
    let done = settled(laptop.engine);
    timers.advance(3_000);
    await done;
    expect(laptop.engine.getStatus()).toEqual({ state: "failed", message: expect.any(String), retryAt: 5_000 });

    done = settled(laptop.engine);
    timers.advance(2_000);
    await done;
    expect(laptop.engine.getStatus()).toMatchObject({ state: "failed", retryAt: 9_000 });

    laptop.setNetwork("online");
    done = settled(laptop.engine);
    timers.advance(4_000);
    await done;
    expect(laptop.engine.getStatus()).toMatchObject({ state: "idle" });
    expect(laptop.store.note(id)).toMatchObject({ synced: true });
    laptop.engine.stop();
  });

  it("reconnecting triggers a sync", async () => {
    const timers = manualTimers();
    const world = createWorld();
    const laptop = await world.signIn(member, { timers });
    laptop.engine.start();
    await settled(laptop.engine);
    laptop.setNetwork("offline");
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Reconnect");
    let done = settled(laptop.engine);
    timers.advance(3_000);
    await done;
    expect(laptop.engine.getStatus()).toEqual({ state: "offline" });

    // The browser's `online` event, long before the next retry would be due.
    laptop.setNetwork("online");
    done = settled(laptop.engine);
    laptop.engine.requestSync();
    await done;

    expect(laptop.engine.getStatus()).toMatchObject({ state: "idle" });
    expect(world.github.files(member, notebook)["Reconnect.md"]).toBeDefined();
    laptop.engine.stop();
  });
});

describe("a session that ended", () => {
  it("pauses sync without touching the device's notes, and sync resumes once the member signs in again", async () => {
    const timers = manualTimers();
    const world = createWorld();
    const laptop = await world.signIn(member, { timers });
    laptop.engine.start();
    await settled(laptop.engine);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Journal");
    laptop.store.editBody(id, "Monday\n");
    let done = settled(laptop.engine);
    timers.advance(3_000);
    await done;
    expect(laptop.store.note(id)).toMatchObject({ synced: true });

    // GitHub stops accepting the session's token (revoked on github.com, or expired).
    world.github.revokeAccessTokens(member);
    laptop.store.editBody(id, "Monday\nTuesday\n");
    done = settled(laptop.engine);
    timers.advance(3_000);
    await done;
    expect(laptop.engine.getStatus()).toEqual({ state: "signed-out" });

    // Writing carries on; nothing on the device changes, and sync stays paused rather than failing again and again.
    const seen = statuses(laptop.engine);
    laptop.store.editBody(id, "Monday\nTuesday\nWednesday\n");
    timers.advance(10 * 60_000);
    expect(seen.filter((status) => status.state === "syncing")).toHaveLength(0);
    expect(laptop.engine.getStatus()).toEqual({ state: "signed-out" });
    await laptop.store.flush();
    expect(laptop.store.note(id)).toMatchObject({ body: "Monday\nTuesday\nWednesday\n", saved: true, synced: false });
    expect(readNote(world.github.files(member, notebook)["Journal.md"]).body).toBe("Monday\n");

    // Signing in again loads the app afresh on the same browser.
    laptop.engine.stop();
    await laptop.store.close();
    const again = await world.signIn(member, { sameBrowserAs: laptop, timers });
    again.engine.start();
    await settled(again.engine);

    expect(again.store.note(id)).toMatchObject({ title: "Journal", body: "Monday\nTuesday\nWednesday\n", synced: true });
    expect(readNote(world.github.files(member, notebook)["Journal.md"]).body).toBe("Monday\nTuesday\nWednesday\n");
    expect(again.engine.getStatus()).toMatchObject({ state: "idle" });
    again.engine.stop();
  });
});
