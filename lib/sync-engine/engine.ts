import { notebookId, type DeviceStore } from "@/lib/device-store";
import {
  fallbackNoteId,
  folderOfKeepPath,
  folderOfTrashedKeepPath,
  isNotePath,
  isTrashPath,
  isTrashedNotePath,
  isV1Path,
  purgeTime,
  titleOfPath,
} from "@/lib/notebook-format";
import { RemoteError, type NotebookRef, type Remote, type RemoteFile } from "@/lib/remote";
import { attachmentUnits, stageAttachments, withAttachments } from "./attachments";
import { batchMessage, planBatches } from "./batches";
import { reconcileFolders } from "./folders";
import { migrationUnits, planMigration, type MigrationReport, type PendingMigration } from "./migration";
import { planPush } from "./push";
import { reconcile, type RemoteNote } from "./reconcile";
import { createShareRepublisher } from "./share";

export type SyncStatus =
  /**
   * `failedAttachments`, when any: attachments this device holds that its
   * notebook refused (over the deployment's size limit). The notes synced
   * without them; they stay listed in the store until removed.
   */
  | { state: "idle"; lastSyncedAt: number | null; failedAttachments?: number }
  /** `progress` while a push takes several commits: `done` of `total` have landed. */
  | { state: "syncing"; progress?: { done: number; total: number } }
  /** The app's server can't be reached; sync resumes on reconnect. */
  | { state: "offline" }
  /** The session ended: sync waits for the member to sign in again. Device data is untouched. */
  | { state: "signed-out" }
  /** The last sync failed; it is retried automatically at `retryAt`. */
  | { state: "failed"; message: string; retryAt: number | null };

/**
 * A note that changed on this device and in its notebook in ways that
 * couldn't be merged. The note kept the device's version; the notebook's is
 * in a conflict copy beside it, for the member to look at.
 */
export interface Conflict {
  notebook: string;
  noteId: string;
  /** The conflict copy. */
  copyId: string;
  /** The note's title when the conflict was found. */
  title: string;
}

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
  /** How long the member's list of notebooks is trusted before a sync asks GitHub for it again. Default 5 min. */
  listNotebooksMs?: number;
  /** Changes per commit; a larger push is split into several. Default 1,000, the notebook routes' limit. */
  maxChangesPerCommit?: number;
}

export interface SyncEngine {
  getStatus: () => SyncStatus;
  /**
   * The v1 conversion this device committed since it opened, if any, so the
   * member can be told about files it left out. Changes are announced through
   * `subscribe`, with the sync that made them.
   */
  getMigrationReport: () => MigrationReport | null;
  /**
   * Conflicts found since the app opened, oldest first, until the member
   * dismisses them (the conflict copies themselves stay). Changes are
   * announced through `subscribe`.
   */
  getConflicts: () => readonly Conflict[];
  dismissConflict: (copyId: string) => void;
  subscribe: (listener: () => void) => () => void;
  /**
   * Syncs now, or right after the sync already running (at most one follow-up
   * however often it is asked). Resolves when that sync is done; rejects if it failed.
   */
  sync: () => Promise<void>;
  /** `sync()` for triggers that don't wait: switching notes, focus, reconnecting. */
  requestSync: () => void;
  /**
   * Asks GitHub which notebooks the member can open before syncing, instead of
   * waiting for the periodic look: after creating one or accepting an
   * invitation. Resolves like `sync()`.
   */
  refreshNotebooks: () => Promise<void>;
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
  listNotebooksMs = 5 * 60_000,
  maxChangesPerCommit = 1000,
}: SyncEngineOptions): SyncEngine {
  const listeners = new Set<() => void>();
  // Share links: notes that land with a share id get their published copies replaced after the push (share.ts).
  const shares = createShareRepublisher(store, remote);
  let status: SyncStatus = { state: "idle", lastSyncedAt: null };
  let running: Promise<void> | null = null;
  let followUp: Promise<void> | null = null;
  let started = false;
  let failures = 0;
  /** When the member's notebooks were last listed, and whether the next sync must list them whatever the time. */
  let notebooksListedAt: number | null = null;
  let listDue = false;
  /** v1 conversions found by a pull, waiting for the push that commits them, by notebook. */
  const migrations = new Map<string, PendingMigration>();
  let migrated: MigrationReport | null = null;
  let conflicts: readonly Conflict[] = [];

  let idleTimer: unknown;
  let firstPendingEdit: number | null = null;
  let pollTimer: unknown;
  let retryTimer: unknown;
  let unsubscribe: (() => void) | undefined;
  let removeBrowserTriggers: (() => void) | undefined;

  function notify() {
    for (const listener of [...listeners]) listener();
  }

  function setStatus(next: SyncStatus) {
    status = next;
    notify();
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
      if (listDue || notebooksListedAt === null || timers.now() - notebooksListedAt >= listNotebooksMs) {
        await listNotebooks();
      }
      await syncNotebooks();
      failures = 0;
      const failed = store.getState().failedAttachments.length;
      outcome = { state: "idle", lastSyncedAt: timers.now(), ...(failed > 0 ? { failedAttachments: failed } : {}) };
    } catch (error) {
      failure = error;
      outcome = failedStatus(error);
    }
    // Signed out, sync pauses: no polls or retries until the member signs in again (focus and reconnect still try).
    if (started && outcome.state === "signed-out") timers.clearTimeout(pollTimer);
    else if (started) schedulePoll();
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

  // ------------------------------------------------------------ Every notebook the member can open

  /**
   * Brings the device's notebooks in line with GitHub's answer: a notebook the
   * member can now open is located (and synced from here on); one they can no
   * longer open (they left it, or were removed) is forgotten, notes and all.
   * The personal notebook is never forgotten: it is created if missing instead.
   */
  async function listNotebooks() {
    // Cleared before asking, so a refresh asked for meanwhile asks again.
    listDue = false;
    const notebooks = await remote.listNotebooks();
    notebooksListedAt = timers.now();
    const open = new Set<string>();
    for (const notebook of notebooks) {
      const id = notebookId(notebook.owner, notebook.repo);
      open.add(id);
      store.sync.locate(id, { owner: notebook.owner, repo: notebook.repo, branch: notebook.branch });
    }
    for (const id of store.getState().notebooks.keys()) {
      if (id !== store.personalNotebook && !open.has(id)) store.forgetNotebook(id);
    }
  }

  /** Syncs the personal notebook, then every shared one. A notebook that fails doesn't hold up the others. */
  async function syncNotebooks() {
    const shared = [...store.getState().notebooks.keys()].filter((id) => id !== store.personalNotebook).sort();
    let failure: unknown;
    for (const id of [store.personalNotebook, ...shared]) {
      // Forgotten since the list was read (the member left it meanwhile).
      if (id !== store.personalNotebook && !store.getState().notebooks.has(id)) continue;
      try {
        await syncNotebook(id);
      } catch (error) {
        // Nothing else will work either without a session or a network: stop here.
        if (error instanceof RemoteError && (error.kind === "signed-out" || error.kind === "offline")) throw error;
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
  }

  // ------------------------------------------------------------ One notebook

  async function syncNotebook(id: string) {
    let notebook = store.sync.notebook(id);
    if (!notebook?.branch && id === store.personalNotebook) {
      store.sync.locate(id, await remote.personalNotebook());
      notebook = store.sync.notebook(id);
    }
    if (!notebook?.branch) throw new Error("The notebook couldn't be found");
    const ref: NotebookRef = { owner: notebook.owner, repo: notebook.repo, branch: notebook.branch };

    for (let attempt = 1; ; attempt++) {
      await pull(id, ref);
      if ((await push(id, ref)) !== "branch-moved") return shares.republish(id, ref);
      if (attempt >= MAX_ATTEMPTS) throw new Error("The notebook kept changing while syncing");
    }
  }

  /** Brings remote changes onto the device. An unchanged notebook costs one conditional request. */
  async function pull(id: string, ref: NotebookRef) {
    const head = await remote.head(ref, store.sync.notebook(id)?.head ?? null);
    if (!head.changed) return;

    const tree = await remote.files(ref, head.commit);
    // Notes, the trashed ones among them: those read as trashed from their path and frontmatter.
    const files = tree.filter((file) => isNotePath(file.path) || isTrashedNotePath(file.path));
    const v1 = tree.filter((file) => isV1Path(file.path));
    // Folders kept while empty: their markers are listed, never fetched, except a trashed folder's marker new
    // to this device, which says when the folder was trashed.
    const keptFolders = tree.flatMap((file) => {
      const folder = folderOfKeepPath(file.path) ?? folderOfTrashedKeepPath(file.path);
      return folder === null ? [] : [folder];
    });
    const knownFolders = new Set(store.sync.folders(id).map((folder) => folder.path));
    const trashedMarkers = tree.filter((file) => {
      const folder = folderOfTrashedKeepPath(file.path);
      return folder !== null && !knownFolders.has(folder);
    });
    // Only blobs this device hasn't seen are fetched.
    const known = new Map<string, string>();
    for (const record of store.sync.records(id)) if (record.base) known.set(record.base.sha, record.base.text);
    const fetched = await remote.blobs(
      ref,
      [...files, ...v1, ...trashedMarkers].filter((file) => !known.has(file.sha)).map((file) => file.sha),
    );
    const withText = (file: RemoteFile) => ({ ...file, text: known.get(file.sha) ?? fetched.get(file.sha) ?? "" });
    const notes: RemoteNote[] = files.map(withText);
    const trashedDates = new Map(
      trashedMarkers.map((file) => {
        const date = withText(file).text.trim();
        return [folderOfTrashedKeepPath(file.path) ?? "", purgeTime(date) === null ? "" : date];
      }),
    );

    // Decided and applied in one step: no edit can land in between.
    const records = store.sync.records(id);
    const ids = { fallback: (path: string) => fallbackNoteId(id, path), random: () => crypto.randomUUID() };
    const { changes, conflicts: found } = reconcile(records, notes, ids);
    const migration =
      v1.length > 0 ? planMigration(head.commit, v1.map(withText), { records, pulled: changes, remote: notes }) : null;
    if (migration) migrations.set(id, migration);
    else migrations.delete(id);
    const folderChanges = reconcileFolders(store.sync.folders(id), keptFolders, trashedDates);
    // Until the conversion is committed this head counts as unseen, so a reload before then converts again.
    store.sync.applyPull(
      id,
      migration ? null : head.commit,
      migration ? [...changes, ...migration.notes] : changes,
      folderChanges,
    );
    if (found.length > 0) {
      conflicts = [
        ...conflicts,
        ...found.map(({ noteId, copyId }) => ({
          notebook: id,
          noteId,
          copyId,
          title: titleOfPath(store.note(noteId)?.path ?? ""),
        })),
      ];
      // The status change that ends this sync announces them too; this covers listeners that read conflicts alone.
      notify();
    }
  }

  /**
   * Pushes every unsynced note on top of the head this device last saw: one
   * commit, or when more changes than a commit can carry, the fewest commits
   * that keep each note's changes together, each on top of the last. What
   * landed stays landed: a failure part-way is resumed by the next sync.
   */
  async function push(id: string, ref: NotebookRef): Promise<"clean" | "pushed" | "branch-moved"> {
    const migration = migrations.get(id);
    let base = migration?.base ?? store.sync.notebook(id)?.head;
    // Whatever has waited in the Trash for the retention period leaves it for good with this push.
    store.sync.purge(id, timers.now());
    const records = store.sync.records(id);
    const folderRecords = store.sync.folders(id);
    const dirty = records.filter((record) => record.dirty);
    // Folders kept while empty whose markers must be added or moved, and what moved since the last push.
    const folders = { dirty: folderRecords.filter((record) => record.dirty), moves: store.sync.folderMoves(id) };
    // Notes and folders deleted from the Trash for good, still in the notebook until this push removes them.
    const deletions = {
      notes: records.filter((record) => record.deleted),
      folders: folderRecords.filter((record) => record.deleted),
      emptiesTrash:
        !records.some((record) => !record.deleted && isTrashPath(record.path)) &&
        !folderRecords.some((record) => !record.deleted && isTrashPath(record.path)),
    };
    const removing = deletions.notes.length + deletions.folders.length > 0;
    // Attachments inserted on this device go into the same commit as the notes that embed them (ADR 0003).
    const attachments = await stageAttachments(store, remote, id, ref);
    if (dirty.length === 0 && folders.dirty.length === 0 && !removing && !migration && attachments.paths.length === 0) return "clean";
    if (!base) throw new Error("The notebook has no commits yet");

    const plan = planPush(dirty, folders, deletions);
    let units = attachmentUnits(plan.units, attachments);
    if (migration) units = migrationUnits(migration, units);
    const batches = planBatches(units, maxChangesPerCommit);
    const changed = dirty.length + folders.dirty.length + deletions.notes.length + deletions.folders.length;
    const message = withAttachments(migration?.message ?? plan.message, changed, attachments);
    for (const [index, batch] of batches.entries()) {
      if (batches.length > 1) setStatus({ state: "syncing", progress: { done: index, total: batches.length } });
      const result = await remote.commit(ref, {
        base,
        message: batchMessage(message, index + 1, batches.length),
        changes: batch.changes,
      });
      if (result.status === "branch-moved") return "branch-moved";
      base = result.commit;
      // Until the whole conversion is committed its head counts as unseen, as after the pull that planned it:
      // a sync that resumes part-way pulls what landed and plans the rest.
      const landed = migration && index < batches.length - 1 ? migration.base : result.commit;
      const paths = new Set(batch.changes.map((change) => change.path));
      store.sync.applyAttachmentPush(id, attachments.paths.filter((path) => paths.has(path)));
      store.sync.applyPush(
        id,
        landed,
        batch.notes.map(({ id: noteId, path, text }) => ({ id: noteId, base: { path, text, sha: result.blobs[path] } })),
        batch.folders,
        batch.removed,
      );
      shares.landed(id, batch.notes);
    }
    if (migration) {
      migrations.delete(id);
      migrated = { notebook: id, commit: base, skipped: migration.skipped };
    }
    return "pushed";
  }

  function onEdit() {
    if (status.state === "signed-out") return;
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
    getMigrationReport: () => migrated,
    getConflicts: () => conflicts,
    dismissConflict: (copyId) => {
      if (!conflicts.some((conflict) => conflict.copyId === copyId)) return;
      conflicts = conflicts.filter((conflict) => conflict.copyId !== copyId);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sync,
    requestSync,
    refreshNotebooks: () => {
      listDue = true;
      return sync();
    },

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
