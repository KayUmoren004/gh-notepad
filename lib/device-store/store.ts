import { attachmentLink, attachmentPath, imageProblem, removeImageLinks } from "@/lib/attachments";
import {
  folderOfPath,
  notePath,
  readNote,
  sanitizeTitle,
  titleOfPath,
  uniqueTitle,
  UNTITLED,
  writeNote,
  type NoteFields,
} from "@/lib/notebook-format";
import { canonicalTags, indexTags } from "@/lib/tags";
import {
  NotepadDatabase,
  type AgreedVersion,
  type AttachmentRow,
  type DatabaseOptions,
  type NoteRow,
  type NotebookRow,
} from "./database";
import { createVersionCache, type VersionCache } from "./version-cache";

export type { AgreedVersion } from "./database";

/** The GitHub account whose device data this is. */
export interface Account {
  id: number;
  login: string;
}

/** A note as the UI shows it. */
export interface Note {
  id: string;
  /** The notebook's id, `owner/repo` lowercased. */
  notebook: string;
  path: string;
  title: string;
  /** `""` at the top level of the notebook. */
  folder: string;
  body: string;
  tags: string[];
  created: string | null;
  updated: string | null;
  /** Its latest edits are stored on this device and survive a reload. */
  saved: boolean;
  /** This device's version matches the notebook's on GitHub. */
  synced: boolean;
}

export interface DeviceState {
  /** Every note on the device, by id. Unchanged notes keep their identity across states. */
  notes: ReadonlyMap<string, Note>;
  /** Counts local edits, so sync can tell typing from its own changes. */
  edits: number;
  /**
   * Attachments the notebook refused, oldest first: still shown from the
   * device copy, out of every push, until removed. Keeps its identity while
   * nothing about attachments changes.
   */
  failedAttachments: readonly FailedAttachment[];
}

/** An attachment inserted on this device that its notebook refused. */
export interface FailedAttachment {
  notebook: string;
  path: string;
  /** Why, in the member's words: the refusal the notebook route gave. */
  reason: string;
}

export interface NotebookLocation {
  owner: string;
  repo: string;
  branch: string;
}

export interface Notebook {
  id: string;
  owner: string;
  repo: string;
  /** `null` until the notebook has been found on GitHub. */
  branch: string | null;
  /** The head commit this device last pulled or pushed. */
  head: string | null;
}

/** A note as sync sees it: the device's file, and the version both sides last agreed on. */
export interface SyncRecord {
  id: string;
  path: string;
  text: string;
  revision: number;
  /** `null` for a note that has never reached its notebook. */
  base: AgreedVersion | null;
  /** The device's version differs from `base`: there is something to push. */
  dirty: boolean;
}

/** What a pull decided for one note. */
export type PullChange =
  /** The note as it now stands on the device, and the version now agreed with the notebook. */
  | { id: string; base: AgreedVersion | null; device: { path: string; text: string } }
  /** The note left the notebook and has nothing unsynced: it goes from the device too. */
  | { id: string; remove: true };

/** An image to attach: its content type and bytes (a `File` will do). */
export interface NewAttachment {
  type: string;
  bytes: Blob;
}

/** An attachment waiting for the push that commits it. */
export interface PendingAttachment {
  path: string;
  type: string;
  bytes: Blob;
  /** The blob SHA GitHub gave its bytes, once stored there; `null` until then. */
  sha: string | null;
}

/** The sync engine's side of the store. The UI never calls these. */
export interface SyncLedger {
  notebook: (id: string) => Notebook | undefined;
  /** Records where a notebook lives on GitHub, once it has been found or created. */
  locate: (id: string, location: NotebookLocation) => void;
  records: (notebook: string) => SyncRecord[];
  /**
   * Applies a pull in one step: remote versions, agreed bases and the new head
   * commit. A `null` head leaves the head as it was, for a pull whose outcome
   * only counts once a push commits it (converting v1 notes).
   */
  applyPull: (notebook: string, head: string | null, changes: readonly PullChange[]) => void;
  /**
   * Records a successful push: each pushed version becomes the agreed base.
   * Text typed while the push was in flight stays, and keeps the note unsynced.
   */
  applyPush: (notebook: string, head: string, pushed: readonly { id: string; base: AgreedVersion }[]) => void;

  /** Attachments inserted on this device that no commit holds yet, and the notebook hasn't refused. */
  pendingAttachments: (notebook: string) => PendingAttachment[];
  /** Records that an attachment's bytes are stored on GitHub as blob `sha`, so a retried push needn't send them again. */
  recordAttachmentBlob: (notebook: string, path: string, sha: string) => void;
  /**
   * Records that the notebook refused an attachment for `reason` (it is over
   * the deployment's size limit): it leaves the pending ones for good, so the
   * notes that embed it still sync, and is listed in `failedAttachments`.
   */
  failAttachment: (notebook: string, path: string, reason: string) => void;
  /** Records that a commit added these attachments to the notebook. The device keeps its copies for showing them offline. */
  applyAttachmentPush: (notebook: string, paths: readonly string[]) => void;
}

export interface DeviceStore {
  readonly account: Account;
  /** The member's personal notebook, `<login>/my-notes`. */
  readonly personalNotebook: string;

  getState: () => DeviceState;
  /** Calls `listener` after every change; returns the unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
  note: (id: string) => Note | undefined;

  /** Creates an untitled note (titles de-duplicated in its folder) and returns its id. */
  createNote: (options?: { notebook?: string; folder?: string }) => string;
  /** Replaces a note's body, as typed. */
  editBody: (id: string, body: string) => void;
  /** Renames a note: the title is sanitised and de-duplicated, and becomes its file name. */
  rename: (id: string, title: string) => void;
  /**
   * Replaces a note's tags, as typed: cleaned (`cleanTags`), each one taking
   * the casing it already has elsewhere on the device, written into the note's
   * frontmatter, so sync pushes it like any other edit.
   */
  setTags: (id: string, tags: readonly string[]) => void;

  /**
   * Stores an image on this device, to be committed under `attachments/` with
   * the next push, and returns the root-relative link a note embeds it with.
   * Throws, storing nothing, for a file that isn't an attachable image (the
   * message is for the member: see `imageProblem`).
   */
  addAttachment: (notebook: string, image: NewAttachment) => string;
  /** A URL showing the device's copy of the attachment at `path`, or `null` if this device holds none. */
  attachmentSrc: (notebook: string, path: string) => string | null;
  /**
   * Forgets an attachment this device holds (one the notebook refused, say)
   * and takes its images out of every note in the notebook that embeds it,
   * as an edit, so the notes sync without the link.
   */
  removeAttachment: (notebook: string, path: string) => void;

  readonly sync: SyncLedger;
  /** Commit data the History panel has fetched, kept on the device for good: commits never change. */
  readonly versions: VersionCache;

  /** Writes everything pending to IndexedDB now. */
  flush: () => Promise<void>;
  /** Flushes and closes the database. */
  close: () => Promise<void>;
}

export interface DeviceStoreOptions extends DatabaseOptions {
  account: Account;
  /** Delay of the trailing write after a change. Default 250 ms. */
  writeDelayMs?: number;
  now?: () => number;
  newId?: () => string;
}

interface Entry {
  row: NoteRow;
  /** The revision IndexedDB holds. */
  persisted: number;
  /** Parsed `row.text`, kept until the text changes. */
  parsed: { text: string; fields: NoteFields };
}

export function personalNotebookId(login: string): string {
  return `${login}/my-notes`.toLowerCase();
}

export async function openDeviceStore(options: DeviceStoreOptions): Promise<DeviceStore> {
  const { account } = options;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const writeDelayMs = options.writeDelayMs ?? 250;
  const personalNotebook = personalNotebookId(account.login);

  const db = new NotepadDatabase(account.id, options);
  await db.open();
  const [noteRows, notebookRows, attachmentRows] = await Promise.all([
    db.notes.toArray(),
    db.notebooks.toArray(),
    db.attachments.toArray(),
  ]);

  const entries = new Map<string, Entry>();
  for (const row of noteRows) entries.set(row.key, { row, persisted: row.revision, parsed: parse(row.text) });
  const notebooks = new Map<string, NotebookRow>(notebookRows.map((row) => [row.id, row]));
  const attachments = new Map<string, AttachmentRow>(attachmentRows.map((row) => [attachmentKey(row), row]));
  /** Object URLs made for showing device copies, revoked when the store closes. */
  const objectUrls = new Map<string, string>();

  const listeners = new Set<() => void>();
  let state: DeviceState = {
    notes: new Map([...entries].map(([key, entry]) => [key, view(entry)])),
    edits: 0,
    failedAttachments: failedAttachments(attachments),
  };

  const pendingNotes = new Set<string>();
  const removedNotes = new Set<string>();
  const pendingNotebooks = new Set<string>();
  const pendingAttachmentRows = new Set<string>();
  const removedAttachmentRows = new Map<string, [string, string]>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();

  /** Publishes new views of the changed notes, then tells subscribers. */
  function publish(changed: Iterable<string>, edits = 0, { attachments: attachmentsChanged = false } = {}) {
    const notes = new Map(state.notes);
    for (const key of changed) {
      const entry = entries.get(key);
      if (entry) notes.set(key, view(entry));
      else notes.delete(key);
    }
    state = {
      notes,
      edits: state.edits + edits,
      failedAttachments: attachmentsChanged ? failedAttachments(attachments) : state.failedAttachments,
    };
    for (const listener of [...listeners]) listener();
  }

  function schedule() {
    timer ??= setTimeout(() => void flush(), writeDelayMs);
  }

  function changed(keys: Iterable<string>, { edit = false } = {}) {
    const list = [...keys];
    for (const key of list) {
      if (entries.has(key)) pendingNotes.add(key);
      else removedNotes.add(key);
    }
    publish(list, edit ? 1 : 0);
    schedule();
  }

  function flush(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    const notes = [...pendingNotes].flatMap((key) => {
      const entry = entries.get(key);
      return entry ? [{ ...entry.row }] : [];
    });
    const removed = [...removedNotes];
    const books = [...pendingNotebooks].flatMap((id) => {
      const row = notebooks.get(id);
      return row ? [{ ...row }] : [];
    });
    const images = [...pendingAttachmentRows].flatMap((key) => {
      const row = attachments.get(key);
      return row ? [{ ...row }] : [];
    });
    const removedImages = [...removedAttachmentRows];
    pendingNotes.clear();
    removedNotes.clear();
    pendingNotebooks.clear();
    pendingAttachmentRows.clear();
    removedAttachmentRows.clear();
    if (
      notes.length === 0 &&
      removed.length === 0 &&
      books.length === 0 &&
      images.length === 0 &&
      removedImages.length === 0
    ) {
      return writing;
    }

    writing = writing.then(async () => {
      try {
        await db.transaction("rw", db.notes, db.notebooks, db.attachments, async () => {
          if (notes.length > 0) await db.notes.bulkPut(notes);
          if (removed.length > 0) await db.notes.bulkDelete(removed);
          if (books.length > 0) await db.notebooks.bulkPut(books);
          if (images.length > 0) await db.attachments.bulkPut(images);
          if (removedImages.length > 0) await db.attachments.bulkDelete(removedImages.map(([, key]) => key));
        });
      } catch (error) {
        // Keep everything pending and try again; nothing in memory is lost.
        for (const row of notes) pendingNotes.add(row.key);
        for (const key of removed) removedNotes.add(key);
        for (const row of books) pendingNotebooks.add(row.id);
        for (const row of images) pendingAttachmentRows.add(attachmentKey(row));
        for (const [key, id] of removedImages) removedAttachmentRows.set(key, id);
        schedule();
        console.error("Saving to this device failed; retrying", error);
        return;
      }
      const saved: string[] = [];
      for (const row of notes) {
        const entry = entries.get(row.key);
        if (entry && row.revision > entry.persisted) {
          entry.persisted = row.revision;
          saved.push(row.key);
        }
      }
      if (saved.length > 0) publish(saved);
    });
    return writing;
  }

  // Tab switches, app switches and page unloads write at once instead of waiting for the trailing write.
  const flushOnHide = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  const flushNow = () => void flush();
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flushNow);
  }

  function titlesBeside(notebook: string, folder: string, except?: string): string[] {
    const titles: string[] = [];
    for (const [key, { row }] of entries) {
      if (key !== except && row.notebook === notebook && folderOfPath(row.path) === folder) {
        titles.push(titleOfPath(row.path));
      }
    }
    return titles;
  }

  function iso() {
    return new Date(now()).toISOString();
  }

  function edit(id: string, change: (row: NoteRow, fields: NoteFields) => boolean) {
    const entry = entries.get(id);
    if (!entry || !change(entry.row, entry.parsed.fields)) return;
    entry.row.revision++;
    if (entry.parsed.text !== entry.row.text) entry.parsed = parse(entry.row.text);
    changed([id], { edit: true });
  }

  const sync: SyncLedger = {
    notebook: (id) => {
      const row = notebooks.get(id);
      return row && { ...row };
    },

    locate: (id, { owner, repo, branch }) => {
      const row = notebooks.get(id);
      notebooks.set(id, { id, owner, repo, branch, head: row?.branch === branch ? row.head : null });
      pendingNotebooks.add(id);
      schedule();
    },

    records: (notebook) =>
      [...entries.values()]
        .filter(({ row }) => row.notebook === notebook)
        .map(({ row }) => ({
          id: row.key,
          path: row.path,
          text: row.text,
          revision: row.revision,
          base: row.base && { ...row.base },
          dirty: isDirty(row),
        })),

    applyPull: (notebook, head, changes) => {
      for (const change of changes) {
        if ("remove" in change) {
          entries.delete(change.id);
          continue;
        }
        const existing = entries.get(change.id);
        if (existing) {
          existing.row.base = change.base;
          existing.row.path = change.device.path;
          existing.row.text = change.device.text;
          if (existing.parsed.text !== existing.row.text) existing.parsed = parse(existing.row.text);
        } else {
          const row: NoteRow = {
            key: change.id,
            notebook,
            path: change.device.path,
            text: change.device.text,
            revision: 0,
            base: change.base,
          };
          entries.set(change.id, { row, persisted: 0, parsed: parse(row.text) });
        }
      }
      if (head !== null) setHead(notebook, head);
      changed(changes.map((change) => change.id));
    },

    applyPush: (notebook, head, pushed) => {
      const keys: string[] = [];
      for (const { id, base } of pushed) {
        const entry = entries.get(id);
        if (!entry) continue;
        entry.row.base = { ...base };
        keys.push(id);
      }
      setHead(notebook, head);
      changed(keys);
    },

    pendingAttachments: (notebook) =>
      [...attachments.values()]
        .filter((row) => row.notebook === notebook && !row.synced && !row.failed)
        .map(({ path, type, bytes, sha }) => ({ path, type, bytes, sha })),

    recordAttachmentBlob: (notebook, path, sha) => {
      const row = attachments.get(attachmentKey({ notebook, path }));
      if (!row || row.sha === sha) return;
      row.sha = sha;
      pendingAttachmentRows.add(attachmentKey(row));
      schedule();
    },

    failAttachment: (notebook, path, reason) => {
      const row = attachments.get(attachmentKey({ notebook, path }));
      if (!row || row.synced || row.failed === reason) return;
      row.failed = reason;
      pendingAttachmentRows.add(attachmentKey(row));
      publish([], 0, { attachments: true });
      schedule();
    },

    applyAttachmentPush: (notebook, paths) => {
      for (const path of paths) {
        const row = attachments.get(attachmentKey({ notebook, path }));
        if (!row || row.synced) continue;
        row.synced = true;
        pendingAttachmentRows.add(attachmentKey(row));
      }
      schedule();
    },
  };

  function setHead(notebook: string, head: string) {
    const row = notebooks.get(notebook);
    if (!row) return;
    row.head = head;
    pendingNotebooks.add(notebook);
  }

  return {
    account,
    personalNotebook,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    note: (id) => state.notes.get(id),

    createNote: ({ notebook = personalNotebook, folder = "" } = {}) => {
      const id = newId();
      const created = iso();
      const row: NoteRow = {
        key: id,
        notebook,
        path: notePath(folder, uniqueTitle(UNTITLED, titlesBeside(notebook, folder))),
        text: writeNote("", { id, created, updated: created }),
        revision: 1,
        base: null,
      };
      entries.set(id, { row, persisted: 0, parsed: parse(row.text) });
      changed([id], { edit: true });
      return id;
    },

    editBody: (id, body) =>
      edit(id, (row, fields) => {
        if (fields.body === body) return false;
        // The first save of a file written elsewhere gives it frontmatter with this note's id.
        row.text = writeNote(row.text, { body, id: row.key, updated: iso() });
        return true;
      }),

    rename: (id, title) =>
      edit(id, (row) => {
        const folder = folderOfPath(row.path);
        const path = notePath(folder, uniqueTitle(sanitizeTitle(title), titlesBeside(row.notebook, folder, id)));
        if (path === row.path) return false;
        row.path = path;
        // Only the file name changes (a pure rename in git), unless the file still needs its id.
        row.text = writeNote(row.text, { id: row.key });
        return true;
      }),

    setTags: (id, tags) =>
      edit(id, (row, fields) => {
        const index = indexTags([...state.notes.values()]);
        const next = canonicalTags(tags, index);
        if (next.length === fields.tags.length && next.every((tag, i) => tag === fields.tags[i])) return false;
        // The first save of a file written elsewhere gives it frontmatter with this note's id.
        row.text = writeNote(row.text, { tags: next, id: row.key, updated: iso() });
        return true;
      }),

    addAttachment: (notebook, image) => {
      const problem = imageProblem({ type: image.type, size: image.bytes.size });
      if (problem) throw new Error(problem);
      const row: AttachmentRow = {
        notebook,
        path: attachmentPath(image.type, newId()),
        type: image.type,
        bytes: image.bytes,
        sha: null,
        synced: false,
      };
      attachments.set(attachmentKey(row), row);
      pendingAttachmentRows.add(attachmentKey(row));
      // Counts as an edit: the note that embeds it changes next, and the pair goes out together.
      publish([], 1);
      schedule();
      return attachmentLink(row.path);
    },

    attachmentSrc: (notebook, path) => {
      const key = attachmentKey({ notebook, path });
      const row = attachments.get(key);
      if (!row) return null;
      let url = objectUrls.get(key);
      if (!url) {
        url = URL.createObjectURL(row.bytes);
        objectUrls.set(key, url);
      }
      return url;
    },

    removeAttachment: (notebook, path) => {
      const key = attachmentKey({ notebook, path });
      const row = attachments.get(key);
      if (!row) return;
      attachments.delete(key);
      pendingAttachmentRows.delete(key);
      removedAttachmentRows.set(key, [row.notebook, row.path]);
      const url = objectUrls.get(key);
      if (url) {
        URL.revokeObjectURL(url);
        objectUrls.delete(key);
      }
      const updated = iso();
      const edited: string[] = [];
      for (const [id, entry] of entries) {
        if (entry.row.notebook !== notebook) continue;
        const body = removeImageLinks(entry.parsed.fields.body, path);
        if (body === entry.parsed.fields.body) continue;
        entry.row.text = writeNote(entry.row.text, { body, id, updated });
        entry.row.revision++;
        entry.parsed = parse(entry.row.text);
        edited.push(id);
      }
      for (const id of edited) pendingNotes.add(id);
      // An edit only when a note changed: that is what there is to sync.
      publish(edited, edited.length > 0 ? 1 : 0, { attachments: true });
      schedule();
    },

    sync,
    versions: createVersionCache(db),
    flush,
    close: async () => {
      await flush();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", flushOnHide);
        window.removeEventListener("pagehide", flushNow);
      }
      for (const url of objectUrls.values()) URL.revokeObjectURL(url);
      objectUrls.clear();
      db.close();
    },
  };
}

function attachmentKey({ notebook, path }: { notebook: string; path: string }): string {
  return `${notebook}\u0000${path}`;
}

/** The refused attachments among `rows`, in the order they were inserted. */
function failedAttachments(rows: ReadonlyMap<string, AttachmentRow>): FailedAttachment[] {
  const failed: FailedAttachment[] = [];
  for (const row of rows.values()) {
    if (row.failed && !row.synced) failed.push({ notebook: row.notebook, path: row.path, reason: row.failed });
  }
  return failed;
}

function parse(text: string): Entry["parsed"] {
  return { text, fields: readNote(text) };
}

function isDirty(row: NoteRow): boolean {
  return row.base === null || row.base.path !== row.path || row.base.text !== row.text;
}

function view({ row, persisted, parsed }: Entry): Note {
  const { fields } = parsed;
  return {
    id: row.key,
    notebook: row.notebook,
    path: row.path,
    title: titleOfPath(row.path),
    folder: folderOfPath(row.path),
    body: fields.body,
    tags: fields.tags,
    created: fields.created,
    updated: fields.updated,
    saved: persisted >= row.revision,
    synced: !isDirty(row),
  };
}
