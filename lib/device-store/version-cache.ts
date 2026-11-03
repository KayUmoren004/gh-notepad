import type { HistoryRow, NotepadDatabase, VersionRow } from "./database";

/** One version of a note, as the History panel lists it. */
export interface CachedVersion {
  commit: string;
  /** The note's path at that commit. */
  path: string;
  message: string;
  /** ISO 8601, the commit's author date. */
  date: string;
  author: string;
}

/** A note's history as last fetched: the versions listed at `head`. */
export interface CachedHistory {
  notebook: string;
  path: string;
  /** The notebook's head commit the list was fetched at; a moved head means the list may have grown. */
  head: string;
  versions: CachedVersion[];
}

/**
 * Commit data cached on the device (a commit never changes, so it never
 * expires): a note's version list, and the text of versions already looked at.
 * History still needs a connection to fetch; this is what makes a second look
 * free, and lets cached versions be browsed offline.
 */
export interface VersionCache {
  /** The note's history as last fetched, or `null` if this device never fetched it. */
  history: (notebook: string, path: string) => Promise<CachedHistory | null>;
  /** Replaces the note's history with the list just fetched. */
  rememberHistory: (history: CachedHistory) => Promise<void>;
  /** The text of a version this device has fetched, or `null`. */
  text: (notebook: string, commit: string, path: string) => Promise<string | null>;
  rememberText: (notebook: string, commit: string, path: string, text: string) => Promise<void>;
}

export function createVersionCache(db: NotepadDatabase): VersionCache {
  const quiet = async <T>(read: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      // A cache miss is the worst a broken cache can do; history then fetches as if there were none.
      console.error("Reading the version cache failed", error);
      return fallback;
    }
  };

  return {
    history: (notebook, path) =>
      quiet(async () => {
        const row: HistoryRow | undefined = await db.histories.get([notebook, path]);
        return row ? { notebook, path, head: row.head, versions: row.versions } : null;
      }, null),

    rememberHistory: async ({ notebook, path, head, versions }) => {
      await db.histories.put({ notebook, path, head, versions });
    },

    text: (notebook, commit, path) =>
      quiet(async () => {
        const row: VersionRow | undefined = await db.versions.get([notebook, commit, path]);
        return row?.text ?? null;
      }, null),

    rememberText: async (notebook, commit, path, text) => {
      await db.versions.put({ notebook, commit, path, text });
    },
  };
}
