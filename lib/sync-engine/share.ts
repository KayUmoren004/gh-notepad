import type { DeviceStore } from "@/lib/device-store";
import { isTrashPath, readNote } from "@/lib/notebook-format";
import type { NotebookRef, Remote } from "@/lib/remote";
import type { PushedNote } from "./batches";

/**
 * Keeps share links current (ticket #14): a note that lands in a commit with
 * a share id in its frontmatter has its published copy replaced once the push
 * is done, by the share route, which reads the note from the notebook's head.
 */
export interface ShareRepublisher {
  /** Notes a commit just landed; the shared ones among them are republished by the next `republish`. */
  landed: (notebook: string, notes: readonly PushedNote[]) => void;
  /**
   * Republishes every note waiting for it. One that failed stays waiting for
   * the next sync, and the failure is thrown so the sync reports and retries it.
   */
  republish: (notebook: string, ref: NotebookRef) => Promise<void>;
}

export function createShareRepublisher(store: DeviceStore, remote: Remote): ShareRepublisher {
  /** Note ids waiting to be republished, by notebook. */
  const pending = new Map<string, Set<string>>();

  return {
    landed: (notebook, notes) => {
      for (const note of notes) {
        if (!readNote(note.text).share) continue;
        let ids = pending.get(notebook);
        if (!ids) pending.set(notebook, (ids = new Set()));
        ids.add(note.id);
      }
    },

    republish: async (notebook, ref) => {
      const ids = pending.get(notebook);
      if (!ids || ids.size === 0) return;
      const records = new Map(store.sync.records(notebook).map((record) => [record.id, record]));
      let failure: unknown;
      for (const id of [...ids]) {
        const record = records.get(id);
        // Gone, edited again since (its next push republishes it), no longer shared, or in the Trash (the
        // published copy stays as it was until the note is restored or the link revoked): nothing to publish now.
        if (!record || record.dirty || isTrashPath(record.path) || !readNote(record.text).share) {
          ids.delete(id);
          continue;
        }
        try {
          await remote.publishShare(ref, record.path);
          ids.delete(id);
        } catch (error) {
          failure ??= error;
        }
      }
      if (failure !== undefined) throw failure;
    },
  };
}
