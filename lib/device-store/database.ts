import Dexie, { type Table } from "dexie";

/** The last version of a note that this device and its notebook agreed on. */
export interface AgreedVersion {
  path: string;
  text: string;
  /** Git blob SHA of `text`, as the notebook has it. */
  sha: string;
}

/** A note as stored on the device. */
export interface NoteRow {
  /** The note's id: its frontmatter `id`, or a device-made one for files that have none. */
  key: string;
  notebook: string;
  /** Where the note lives on this device: `<folder>/<title>.md`. */
  path: string;
  /** The whole file as this device has it. */
  text: string;
  /** Counts local edits; a sync never overwrites text whose revision moved on. */
  revision: number;
  /** `null` until the note first reaches its notebook. */
  base: AgreedVersion | null;
}

export interface NotebookRow {
  /** `owner/repo`, lowercased. */
  id: string;
  owner: string;
  repo: string;
  /** The branch the app syncs; `null` until the notebook has been found on GitHub. */
  branch: string | null;
  /** The head commit this device last pulled or pushed. */
  head: string | null;
}

/** An attachment this device holds: inserted here (pending until a push commits it), kept for showing offline. */
export interface AttachmentRow {
  notebook: string;
  /** Its path in the notebook: `attachments/<id>.<ext>`. */
  path: string;
  type: string;
  bytes: Blob;
  /** Git blob SHA once the bytes are stored on GitHub, which happens before the commit that adds the file. */
  sha: string | null;
  /** Committed to the notebook. */
  synced: boolean;
}

/** A note's version list as last fetched from its notebook, by the note's path. */
export interface HistoryRow {
  notebook: string;
  path: string;
  /** The notebook's head commit the list was fetched at. */
  head: string;
  versions: { commit: string; path: string; message: string; date: string; author: string }[];
}

/** The text of one version of a note this device has looked at. Commits never change, so it never expires. */
export interface VersionRow {
  notebook: string;
  commit: string;
  /** The note's path at that commit. */
  path: string;
  text: string;
}

export interface DatabaseOptions {
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

/** The name of an account's database: keyed by GitHub's numeric id, which survives a login change. */
export function databaseName(accountId: number): string {
  return `gh-notepad-account-${accountId}`;
}

/** One IndexedDB database per GitHub account, so accounts on a shared browser never see each other's notes. */
export class NotepadDatabase extends Dexie {
  notes!: Table<NoteRow, string>;
  notebooks!: Table<NotebookRow, string>;
  attachments!: Table<AttachmentRow, [string, string]>;
  histories!: Table<HistoryRow, [string, string]>;
  versions!: Table<VersionRow, [string, string, string]>;

  constructor(accountId: number, options: DatabaseOptions = {}) {
    super(databaseName(accountId), options);
    this.version(1).stores({ notes: "key, notebook", notebooks: "id" });
    this.version(2).stores({ notes: "key, notebook", notebooks: "id", attachments: "[notebook+path], notebook" });
    this.version(3).stores({
      notes: "key, notebook",
      notebooks: "id",
      attachments: "[notebook+path], notebook",
      histories: "[notebook+path]",
      versions: "[notebook+commit+path]",
    });
  }
}

/**
 * Deletes an account's database: every note and notebook this device holds for
 * it. Close any `NotepadDatabase` open on it first; an open connection keeps
 * the deletion waiting, and Dexie reopens (and so recreates) the database on
 * that connection's next write.
 */
export async function deleteDatabase(accountId: number, options: DatabaseOptions = {}): Promise<void> {
  await new NotepadDatabase(accountId, options).delete();
}
