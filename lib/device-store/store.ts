import { attachmentLink, attachmentPath, imageProblem } from "@/lib/attachments";
import {
  folderName,
  folderOfPath,
  isInFolder,
  isInsideOrSelf,
  movedPath,
  notePath,
  readNote,
  sanitizeFolderName,
  sanitizeTitle,
  titleOfPath,
  uniqueFolderName,
  uniqueTitle,
  UNTITLED,
  writeNote,
  type NoteFields,
} from "@/lib/notebook-format";
import {
  NotepadDatabase,
  type AgreedVersion,
  type AttachmentRow,
  type DatabaseOptions,
  type FolderRow,
  type NoteRow,
  type NotebookRow,
} from "./database";

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

/** A folder kept on its own, whether or not notes are in it: made with "New folder", or marked by a `.gitkeep` in the notebook. */
export interface Folder {
  notebook: string;
  /** `Projects/Garden`. */
  path: string;
  /** Its marker in the notebook is where this device has it. */
  synced: boolean;
}

export interface DeviceState {
  /** Every note on the device, by id. Unchanged notes keep their identity across states. */
  notes: ReadonlyMap<string, Note>;
  /** Every folder kept on its own, by notebook and path. Folders that only hold notes aren't here: the tree derives them. */
  folders: ReadonlyMap<string, Folder>;
  /** Counts local edits, so sync can tell typing from its own changes. */
  edits: number;
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

/** A folder kept on its own, as sync sees it. */
export interface FolderRecord {
  path: string;
  /** Where its marker is in the notebook; `null` for one that has never reached it. */
  base: string | null;
  /** The marker must be added or moved: there is something to push. */
  dirty: boolean;
}

/** What a pull decided for one folder kept on its own. */
export type FolderPullChange =
  /** The folder as it now stands on the device, and where the notebook has its marker (`null`: nowhere, yet). */
  | { path: string; base: string | null }
  /** Its marker left the notebook and nothing changed here: the folder goes from the device too. */
  | { path: string; remove: true };

/** A folder renamed or moved on this device since the last push, for the commit message. */
export interface FolderMove {
  from: string;
  to: string;
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
  /** The folders kept on their own, by path. */
  folders: (notebook: string) => FolderRecord[];
  /** Folders renamed or moved here since the last push, oldest first, so a push can say what it did. */
  folderMoves: (notebook: string) => FolderMove[];
  /**
   * Applies a pull in one step: remote versions, agreed bases, the folders
   * kept on their own and the new head commit. A `null` head leaves the head
   * as it was, for a pull whose outcome only counts once a push commits it
   * (converting v1 notes).
   */
  applyPull: (
    notebook: string,
    head: string | null,
    changes: readonly PullChange[],
    folderChanges?: readonly FolderPullChange[],
  ) => void;
  /**
   * Records a successful push: each pushed version becomes the agreed base,
   * and each folder in `folders` has its marker where this device has it.
   * Text typed while the push was in flight stays, and keeps the note unsynced.
   */
  applyPush: (
    notebook: string,
    head: string,
    pushed: readonly { id: string; base: AgreedVersion }[],
    folders?: readonly string[],
  ) => void;

  /** Attachments inserted on this device that no commit holds yet. */
  pendingAttachments: (notebook: string) => PendingAttachment[];
  /** Records that an attachment's bytes are stored on GitHub as blob `sha`, so a retried push needn't send them again. */
  recordAttachmentBlob: (notebook: string, path: string, sha: string) => void;
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
  /** Moves a note into `folder` (`""` for the top level), de-duplicating its title there; returns nothing if it is there already. */
  moveNote: (id: string, folder: string) => void;

  /**
   * Makes a folder in `parent` (`""` for the top level), kept even while empty.
   * The name is sanitised and de-duplicated among the folders beside it.
   * Returns the folder's path.
   */
  createFolder: (notebook: string, parent: string, name: string) => string;
  /** Renames a folder: everything in it moves along, notes keeping their ids. Returns the folder's new path. */
  renameFolder: (notebook: string, path: string, name: string) => string;
  /**
   * Moves a folder into `destination` (`""` for the top level), everything in
   * it along, its name de-duplicated there. Throws for a move into itself.
   * Returns the folder's new path.
   */
  moveFolder: (notebook: string, path: string, destination: string) => string;

  /**
   * Stores an image on this device, to be committed under `attachments/` with
   * the next push, and returns the root-relative link a note embeds it with.
   * Throws, storing nothing, for a file that isn't an attachable image (the
   * message is for the member: see `imageProblem`).
   */
  addAttachment: (notebook: string, image: NewAttachment) => string;
  /** A URL showing the device's copy of the attachment at `path`, or `null` if this device holds none. */
  attachmentSrc: (notebook: string, path: string) => string | null;

  readonly sync: SyncLedger;

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
  const [noteRows, notebookRows, attachmentRows, folderRows] = await Promise.all([
    db.notes.toArray(),
    db.notebooks.toArray(),
    db.attachments.toArray(),
    db.folders.toArray(),
  ]);

  const entries = new Map<string, Entry>();
  for (const row of noteRows) entries.set(row.key, { row, persisted: row.revision, parsed: parse(row.text) });
  const notebooks = new Map<string, NotebookRow>(notebookRows.map((row) => [row.id, row]));
  const attachments = new Map<string, AttachmentRow>(attachmentRows.map((row) => [attachmentKey(row), row]));
  const folders = new Map<string, FolderRow>(folderRows.map((row) => [pathKey(row), row]));
  /** Folders renamed or moved since the last push, by notebook; only for naming that push. */
  const folderMoves = new Map<string, FolderMove[]>();
  /** Object URLs made for showing device copies, revoked when the store closes. */
  const objectUrls = new Map<string, string>();

  const listeners = new Set<() => void>();
  let state: DeviceState = {
    notes: new Map([...entries].map(([key, entry]) => [key, view(entry)])),
    folders: folderViews(),
    edits: 0,
  };

  const pendingNotes = new Set<string>();
  const removedNotes = new Set<string>();
  const pendingNotebooks = new Set<string>();
  const pendingAttachmentRows = new Set<string>();
  const pendingFolders = new Set<string>();
  /** `[notebook, path]` keys of folder rows to delete: a renamed folder's row moves to a new key. */
  const removedFolders = new Map<string, [string, string]>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();

  function folderViews(): Map<string, Folder> {
    return new Map(
      [...folders].map(([key, row]) => [key, { notebook: row.notebook, path: row.path, synced: row.base === row.path }]),
    );
  }

  /** Publishes new views of the changed notes (and of every folder, when they changed), then tells subscribers. */
  function publish(changed: Iterable<string>, edits = 0, { folders: foldersChanged = false } = {}) {
    const notes = new Map(state.notes);
    for (const key of changed) {
      const entry = entries.get(key);
      if (entry) notes.set(key, view(entry));
      else notes.delete(key);
    }
    state = { notes, folders: foldersChanged ? folderViews() : state.folders, edits: state.edits + edits };
    for (const listener of [...listeners]) listener();
  }

  function schedule() {
    timer ??= setTimeout(() => void flush(), writeDelayMs);
  }

  function changed(keys: Iterable<string>, { edit = false, folders: foldersChanged = false } = {}) {
    const list = [...keys];
    for (const key of list) {
      if (entries.has(key)) pendingNotes.add(key);
      else removedNotes.add(key);
    }
    publish(list, edit ? 1 : 0, { folders: foldersChanged });
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
    const kept = [...pendingFolders].flatMap((key) => {
      const row = folders.get(key);
      return row ? [{ ...row }] : [];
    });
    const unkept = [...removedFolders];
    pendingNotes.clear();
    removedNotes.clear();
    pendingNotebooks.clear();
    pendingAttachmentRows.clear();
    pendingFolders.clear();
    removedFolders.clear();
    if ([notes, removed, books, images, kept, unkept].every((list) => list.length === 0)) return writing;

    writing = writing.then(async () => {
      try {
        await db.transaction("rw", db.notes, db.notebooks, db.attachments, db.folders, async () => {
          if (notes.length > 0) await db.notes.bulkPut(notes);
          if (removed.length > 0) await db.notes.bulkDelete(removed);
          if (books.length > 0) await db.notebooks.bulkPut(books);
          if (images.length > 0) await db.attachments.bulkPut(images);
          if (unkept.length > 0) await db.folders.bulkDelete(unkept.map(([, key]) => key));
          if (kept.length > 0) await db.folders.bulkPut(kept);
        });
      } catch (error) {
        // Keep everything pending and try again; nothing in memory is lost.
        for (const row of notes) pendingNotes.add(row.key);
        for (const key of removed) removedNotes.add(key);
        for (const row of books) pendingNotebooks.add(row.id);
        for (const row of images) pendingAttachmentRows.add(attachmentKey(row));
        for (const row of kept) pendingFolders.add(pathKey(row));
        for (const [key, value] of unkept) removedFolders.set(key, value);
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

  /** The names of the folders in `parent`, whether notes or markers make them, leaving out the folder at `except`. */
  function foldersBeside(notebook: string, parent: string, except?: string): string[] {
    const names = new Set<string>();
    const consider = (folder: string) => {
      if (folder === "" || !isInFolder(folder, parent)) return;
      const name = (parent === "" ? folder : folder.slice(parent.length + 1)).split("/")[0];
      if ((parent ? `${parent}/${name}` : name) !== except) names.add(name);
    };
    for (const { row } of entries.values()) if (row.notebook === notebook) consider(folderOfPath(row.path));
    for (const row of folders.values()) if (row.notebook === notebook) consider(row.path);
    return [...names];
  }

  /** Adds a folder row (or moves one to its new key), to be written. */
  function putFolder(row: FolderRow, previousPath?: string) {
    if (previousPath !== undefined && previousPath !== row.path) {
      const old = pathKey({ notebook: row.notebook, path: previousPath });
      folders.delete(old);
      pendingFolders.delete(old);
      removedFolders.set(old, [row.notebook, previousPath]);
    }
    const key = pathKey(row);
    folders.set(key, row);
    pendingFolders.add(key);
    removedFolders.delete(key);
  }

  function dropFolder(notebook: string, path: string) {
    const key = pathKey({ notebook, path });
    if (!folders.delete(key)) return;
    pendingFolders.delete(key);
    removedFolders.set(key, [notebook, path]);
  }

  /** Moves the folder at `from` to `to`: every note and folder marker in it goes along, notes keeping their ids. */
  function relocateFolder(notebook: string, from: string, to: string): string {
    const moved: string[] = [];
    for (const [key, entry] of entries) {
      const { row } = entry;
      if (row.notebook !== notebook || !isInFolder(row.path, from)) continue;
      row.path = movedPath(row.path, from, to);
      row.text = writeNote(row.text, { id: row.key });
      row.revision++;
      if (entry.parsed.text !== row.text) entry.parsed = parse(row.text);
      moved.push(key);
    }
    for (const row of [...folders.values()]) {
      if (row.notebook !== notebook || !isInsideOrSelf(row.path, from)) continue;
      const previous = row.path;
      row.path = movedPath(row.path, from, to);
      putFolder(row, previous);
    }
    folderMoves.set(notebook, [...(folderMoves.get(notebook) ?? []), { from, to }]);
    changed(moved, { edit: true, folders: true });
    return to;
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

    folders: (notebook) =>
      [...folders.values()]
        .filter((row) => row.notebook === notebook)
        .map((row) => ({ path: row.path, base: row.base, dirty: row.base !== row.path }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),

    folderMoves: (notebook) => [...(folderMoves.get(notebook) ?? [])],

    applyPull: (notebook, head, changes, folderChanges = []) => {
      for (const change of folderChanges) {
        if ("remove" in change) {
          dropFolder(notebook, change.path);
          continue;
        }
        const existing = folders.get(pathKey({ notebook, path: change.path }));
        if (existing) existing.base = change.base;
        putFolder(existing ?? { notebook, path: change.path, base: change.base });
      }
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
      changed(
        changes.map((change) => change.id),
        { folders: folderChanges.length > 0 },
      );
    },

    applyPush: (notebook, head, pushed, landedFolders = []) => {
      const keys: string[] = [];
      for (const { id, base } of pushed) {
        const entry = entries.get(id);
        if (!entry) continue;
        entry.row.base = { ...base };
        keys.push(id);
      }
      for (const path of landedFolders) {
        const row = folders.get(pathKey({ notebook, path }));
        if (!row) continue;
        row.base = path;
        putFolder(row);
      }
      // The push has said what it did; the next one starts its own account.
      folderMoves.delete(notebook);
      setHead(notebook, head);
      changed(keys, { folders: landedFolders.length > 0 });
    },

    pendingAttachments: (notebook) =>
      [...attachments.values()]
        .filter((row) => row.notebook === notebook && !row.synced)
        .map(({ path, type, bytes, sha }) => ({ path, type, bytes, sha })),

    recordAttachmentBlob: (notebook, path, sha) => {
      const row = attachments.get(attachmentKey({ notebook, path }));
      if (!row || row.sha === sha) return;
      row.sha = sha;
      pendingAttachmentRows.add(attachmentKey(row));
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

    moveNote: (id, folder) =>
      edit(id, (row) => {
        if (folderOfPath(row.path) === folder) return false;
        row.path = notePath(folder, uniqueTitle(titleOfPath(row.path), titlesBeside(row.notebook, folder, id)));
        row.text = writeNote(row.text, { id: row.key });
        return true;
      }),

    createFolder: (notebook, parent, name) => {
      const unique = uniqueFolderName(sanitizeFolderName(name), parent, foldersBeside(notebook, parent));
      const path = parent ? `${parent}/${unique}` : unique;
      putFolder({ notebook, path, base: null });
      publish([], 1, { folders: true });
      schedule();
      return path;
    },

    renameFolder: (notebook, path, name) => {
      const parent = folderOfPath(path);
      const unique = uniqueFolderName(sanitizeFolderName(name), parent, foldersBeside(notebook, parent, path));
      const to = parent ? `${parent}/${unique}` : unique;
      return to === path ? path : relocateFolder(notebook, path, to);
    },

    moveFolder: (notebook, path, destination) => {
      if (isInsideOrSelf(destination, path)) throw new Error("A folder can't go inside itself");
      if (destination === folderOfPath(path)) return path;
      const unique = uniqueFolderName(folderName(path), destination, foldersBeside(notebook, destination));
      return relocateFolder(notebook, path, destination ? `${destination}/${unique}` : unique);
    },

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

    sync,
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

function pathKey({ notebook, path }: { notebook: string; path: string }): string {
  return `${notebook}\u0000${path}`;
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
