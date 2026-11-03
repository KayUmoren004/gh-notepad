import type { DeviceStore } from "@/lib/device-store";
import { fallbackNoteId, isNotePath, isV1Path } from "@/lib/notebook-format";
import { RemoteError, type NotebookRef, type Remote, type RemoteFile } from "@/lib/remote";
import { planMigration, type MigrationReport, type PendingMigration } from "./migration";
import { planPush } from "./push";
import { reconcile, type RemoteNote } from "./reconcile";

export type SyncStatus =
  | { state: "idle"; lastSyncedAt: number | null }
  | { state: "syncing" }
  /** The app's server can't be reached; sync resumes on reconnect. */
  | { state: "offline" }
  /** The session ended: sync waits for the member to sign in again. Device data is untouched. */
  | { state: "signed-out" }
  /** The last sync failed; it is retried automatically at `retryAt`. */
  | { state: "failed"; message: string; retryAt: number | null };

/** Time, injectable so tests can drive the triggers. */
export interface Timers {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface SyncEngineOptions {
  store: DeviceStore;
  remote: Remote;
  timers?: Timers;
  /** Quiet time after the last edit before syncing. Default 3 s. */
  idleMs?: number;
  /** Longest wait while edits keep coming. Default 20 s. */
  maxWaitMs?: number;
  /** Pull interval while the app is visible. Default 30 s. */
  pollMs?: number;
}

export interface SyncEngine {
  getStatus: () => SyncStatus;
  subscribe: (listener: () => void) => () => void;
  /**
   * Syncs now, or right after the sync already running (at most one follow-up
   * however often it is asked). Resolves when that sync is done; rejects if it failed.
   */
  sync: () => Promise<void>;
  /** `sync()` for triggers that don't wait: switching notes, focus, reconnecting. */
  requestSync: () => void;
  /**
   * Starts the automatic triggers: a pause after typing, periodic pulls, retries
   * with back-off and, in a browser, focus, tab hide and reconnect.
   */
  start: () => void;
  stop: () => void;
}

/** A pull, merge and retry when another device pushed between our pull and push. */
const MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 60_000;

const systemTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createSyncEngine({
  store,
  remote,
  timers = systemTimers,
  idleMs = 3_000,
  maxWaitMs = 20_000,
  pollMs = 30_000,
}: SyncEngineOptions): SyncEngine {
  const listeners = new Set<() => void>();
  let status: SyncStatus = { state: "idle", lastSyncedAt: null };
  let running: Promise<void> | null = null;
  let followUp: Promise<void> | null = null;
  let started = false;
  let failures = 0;
  /** v1 conversions found by a pull, waiting for the push that commits them, by notebook. */
  const migrations = new Map<string, PendingMigration>();
  let migrated: MigrationReport | null = null;

  let idleTimer: unknown;
  let firstPendingEdit: number | null = null;
  let pollTimer: unknown;
  let retryTimer: unknown;
  let unsubscribe: (() => void) | undefined;
  let removeBrowserTriggers: (() => void) | undefined;

  function setStatus(next: SyncStatus) {
    status = next;
    for (const listener of [...listeners]) listener();
  }

  function sync(): Promise<void> {
    if (!running) {
      running = run();
      return running;
    }
    followUp ??= running
      .catch(() => undefined)
      .then(() => {
        followUp = null;
        return sync();
      });
    return followUp;
  }

  function requestSync() {
    sync().catch(() => undefined);
  }

  async function run() {
    // This run covers every edit so far.
    timers.clearTimeout(idleTimer);
    firstPendingEdit = null;
    timers.clearTimeout(retryTimer);
    setStatus({ state: "syncing" });
    let outcome: SyncStatus;
    let failure: unknown;
    try {
      await syncNotebook(store.personalNotebook);
      failures = 0;
      outcome = { state: "idle", lastSyncedAt: timers.now() };
    } catch (error) {
      failure = error;
      outcome = failedStatus(error);
    }
    if (started) schedulePoll();
    // Finished before anyone hears so: a sync asked for on hearing it starts afresh.
    running = null;
    setStatus(outcome);
    if (failure !== undefined) throw failure;
  }

  function failedStatus(error: unknown): SyncStatus {
    if (error instanceof RemoteError && error.kind === "signed-out") return { state: "signed-out" };
    failures++;
    const backoff = Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** (failures - 1));
    const wait = error instanceof RemoteError && error.retryAfterMs ? Math.max(error.retryAfterMs, backoff) : backoff;
    if (started) {
      timers.clearTimeout(retryTimer);
      retryTimer = timers.setTimeout(requestSync, wait);
    }
    if (error instanceof RemoteError && error.kind === "offline") return { state: "offline" };
    const message = error instanceof Error ? error.message : "Sync failed";
    return { state: "failed", message, retryAt: started ? timers.now() + wait : null };
  }

  async function syncNotebook(id: string) {
    let notebook = store.sync.notebook(id);
    if (!notebook?.branch) {
      store.sync.locate(id, await remote.personalNotebook());
      notebook = store.sync.notebook(id);
    }
    if (!notebook?.branch) throw new Error("The notebook couldn't be found");
    const ref: NotebookRef = { owner: notebook.owner, repo: notebook.repo, branch: notebook.branch };

    for (let attempt = 1; ; attempt++) {
      await pull(id, ref);
      if ((await push(id, ref)) !== "branch-moved") return;
      if (attempt >= MAX_ATTEMPTS) throw new Error("The notebook kept changing while syncing");
    }
  }

  /** Brings remote changes onto the device. An unchanged notebook costs one conditional request. */
  async function pull(id: string, ref: NotebookRef) {
    const head = await remote.head(ref, store.sync.notebook(id)?.head ?? null);
    if (!head.changed) return;

    const tree = await remote.files(ref, head.commit);
    const files = tree.filter((file) => isNotePath(file.path));
    const v1 = tree.filter((file) => isV1Path(file.path));
    // Only blobs this device hasn't seen are fetched.
    const known = new Map<string, string>();
    for (const record of store.sync.records(id)) if (record.base) known.set(record.base.sha, record.base.text);
    const fetched = await remote.blobs(
      ref,
      [...files, ...v1].filter((file) => !known.has(file.sha)).map((file) => file.sha),
    );
    const withText = (file: RemoteFile) => ({ ...file, text: known.get(file.sha) ?? fetched.get(file.sha) ?? "" });
    const notes: RemoteNote[] = files.map(withText);

    // Decided and applied in one step: no edit can land in between.
    const records = store.sync.records(id);
    const ids = { fallback: (path: string) => fallbackNoteId(id, path), random: () => crypto.randomUUID() };
    const changes = reconcile(records, notes, ids);
    const migration = v1.length > 0 ? planMigration(head.commit, v1.map(withText), { records, pulled: changes, remote: notes }) : null;
    if (migration) migrations.set(id, migration);
    else migrations.delete(id);
    // Until the conversion is committed this head counts as unseen, so a reload before then converts again.
    store.sync.applyPull(id, migration ? null : head.commit, migration ? [...changes, ...migration.notes] : changes);
  }

  /** Pushes every unsynced note in one commit on top of the head this device last saw. */
  async function push(id: string, ref: NotebookRef): Promise<"clean" | "pushed" | "branch-moved"> {
    const migration = migrations.get(id);
    const base = migration?.base ?? store.sync.notebook(id)?.head;
    const dirty = store.sync.records(id).filter((record) => record.dirty);
    if (dirty.length === 0 && !migration) return "clean";
    if (!base) throw new Error("The notebook has no commits yet");

    const plan = planPush(dirty);
    const result = await remote.commit(ref, {
      base,
      message: migration?.message ?? plan.message,
      changes: [...plan.changes, ...(migration?.changes ?? [])],
    });
    if (result.status === "branch-moved") return "branch-moved";
    if (migration) {
      migrations.delete(id);
      migrated = { notebook: id, commit: result.commit, skipped: migration.skipped };
    }
    store.sync.applyPush(
      id,
      result.commit,
      plan.pushed.map(({ id: noteId, path, text }) => ({ id: noteId, base: { path, text, sha: result.blobs[path] } })),
    );
    return "pushed";
  }

  function onEdit() {
    const now = timers.now();
    firstPendingEdit ??= now;
    // ~3 s after typing pauses, but never more than ~20 s after the first unsynced edit.
    const due = Math.min(now + idleMs, firstPendingEdit + maxWaitMs);
    timers.clearTimeout(idleTimer);
    idleTimer = timers.setTimeout(requestSync, Math.max(0, due - now));
  }

  function schedulePoll() {
    timers.clearTimeout(pollTimer);
    pollTimer = timers.setTimeout(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") requestSync();
      else schedulePoll();
    }, pollMs);
  }

  function browserTriggers(): () => void {
    if (typeof window === "undefined") return () => undefined;
    const onVisibility = () => {
      // Leaving the tab syncs what was typed; coming back pulls what changed elsewhere.
      requestSync();
    };
    const onFocus = () => requestSync();
    const onOnline = () => requestSync();
    const onOffline = () => setStatus({ state: "offline" });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }

  return {
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sync,
    requestSync,

    start: () => {
      if (started) return;
      started = true;
      let edits = store.getState().edits;
      unsubscribe = store.subscribe(() => {
        const next = store.getState().edits;
        if (next !== edits) {
          edits = next;
          onEdit();
        }
      });
      removeBrowserTriggers = browserTriggers();
      requestSync();
    },

    stop: () => {
      started = false;
      unsubscribe?.();
      removeBrowserTriggers?.();
      for (const timer of [idleTimer, pollTimer, retryTimer]) timers.clearTimeout(timer);
    },
  };
}
