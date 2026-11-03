import type { AgreedVersion, PullChange, SyncRecord } from "@/lib/device-store";
import { folderOfPath, notePath, readNote, titleOfPath, uniqueTitle, writeNote } from "@/lib/notebook-format";
import { mergeNote } from "./merge";

/** A note file as the notebook has it at the commit being pulled. */
export type RemoteNote = AgreedVersion;

/** A note whose device and notebook versions couldn't be merged: the device's stays, the notebook's becomes a conflict copy. */
export interface ConflictCopy {
  /** The note that kept the device's version. */
  noteId: string;
  /** The new note holding the notebook's version, created next to it. */
  copyId: string;
  path: string;
}

export interface Reconciliation {
  changes: PullChange[];
  conflicts: ConflictCopy[];
}

/**
 * Decides what a pull does to each note on the device. Pure, and applied in
 * the same synchronous step it is computed in, so nothing typed can slip
 * between the decision and the change.
 *
 * - Remote notes are matched to device notes by frontmatter `id` (so a rename
 *   elsewhere is followed), falling back to the path both sides agreed on.
 * - A note with no unsynced changes takes the remote version as it is.
 * - A note with unsynced changes is merged three ways with the remote version
 *   over the version they agreed on (`mergeNote`): edits to different lines
 *   join, and the result goes out with the next push. Where both changed the
 *   same lines, the device's text stays and the remote version becomes a
 *   conflict copy beside it (`<title> (conflict copy)`), so neither is lost.
 *   It follows a remote rename when the device didn't rename it too.
 * - A note gone from the notebook leaves the device too, unless it has
 *   unsynced changes, which are kept and pushed back.
 * - A device note whose path a remote note now holds is re-titled ("Title 2").
 */
export function reconcile(
  records: readonly SyncRecord[],
  remote: readonly RemoteNote[],
  ids: {
    /** The id every device gives a file that carries none (see `fallbackNoteId`). */
    fallback: (path: string) => string;
    /** A fresh id, for the rare fallback that is already taken. */
    random: () => string;
  },
): Reconciliation {
  const byId = new Map(records.map((record) => [record.id, record]));
  const byBasePath = new Map(records.flatMap((record) => (record.base ? [[record.base.path, record] as const] : [])));
  const matched = new Set<string>();
  const claimedIds = new Set<string>();
  const changes = new Map<string, Extract<PullChange, { device: unknown }> | Extract<PullChange, { remove: true }>>();
  const unmerged: { record: SyncRecord; path: string; remote: RemoteNote }[] = [];

  for (const file of [...remote].sort((a, b) => a.path.localeCompare(b.path))) {
    const id = readNote(file.text).id;
    // A second file carrying the same id (a copy made outside the app) is matched by path instead.
    const byFrontmatter = id && !claimedIds.has(id) ? byId.get(id) : undefined;
    if (id) claimedIds.add(id);
    let record = byFrontmatter && !matched.has(byFrontmatter.id) ? byFrontmatter : undefined;
    if (!record) {
      const byPath = byBasePath.get(file.path);
      record = byPath && !matched.has(byPath.id) ? byPath : undefined;
    }

    if (!record) {
      const free = (candidate: string) => !byId.has(candidate) && !changes.has(candidate);
      const fallback = ids.fallback(file.path);
      const key = id && free(id) ? id : free(fallback) ? fallback : ids.random();
      changes.set(key, { id: key, base: file, device: { path: file.path, text: file.text } });
      continue;
    }

    matched.add(record.id);
    const unchanged = record.base && record.base.sha === file.sha && record.base.path === file.path;
    if (unchanged) continue;
    if (!record.dirty) {
      changes.set(record.id, { id: record.id, base: file, device: { path: file.path, text: file.text } });
    } else {
      const renamedHere = record.base !== null && record.path !== record.base.path;
      const path = renamedHere || record.base === null ? record.path : file.path;
      const merge = record.base ? mergeNote(record.text, record.base.text, file.text) : null;
      if (merge && !merge.conflict) {
        changes.set(record.id, { id: record.id, base: file, device: { path, text: merge.text } });
      } else {
        changes.set(record.id, { id: record.id, base: file, device: { path, text: record.text } });
        if (merge?.conflict) unmerged.push({ record, path, remote: file });
      }
    }
  }

  for (const record of records) {
    if (matched.has(record.id) || record.base === null) continue;
    if (record.dirty) {
      changes.set(record.id, { id: record.id, base: null, device: { path: record.path, text: record.text } });
    } else {
      changes.set(record.id, { id: record.id, remove: true });
    }
  }

  const conflicts = conflictCopies(records, changes, unmerged, ids.random);
  const retitled = retitleCollisions(records, changes);
  return { changes: [...changes.values(), ...retitled], conflicts };
}

/** The notes as they will stand once `changes` are applied, by id. */
function outcome(records: readonly SyncRecord[], changes: Map<string, PullChange>) {
  const final = new Map<string, { path: string; text: string; base: AgreedVersion | null }>();
  for (const record of records) final.set(record.id, { path: record.path, text: record.text, base: record.base });
  for (const change of changes.values()) {
    if ("remove" in change) final.delete(change.id);
    else final.set(change.id, { ...change.device, base: change.base });
  }
  return final;
}

/**
 * A conflict copy for each note that couldn't be merged: a new note holding
 * the remote version, titled `<title> (conflict copy)` (de-duplicated like
 * any title) in the note's folder. It has never reached the notebook, so the
 * next push commits it along with the device's version of the note.
 */
function conflictCopies(
  records: readonly SyncRecord[],
  changes: Map<string, PullChange>,
  unmerged: readonly { record: SyncRecord; path: string; remote: RemoteNote }[],
  newId: () => string,
): ConflictCopy[] {
  const conflicts: ConflictCopy[] = [];
  for (const { record, path, remote } of unmerged) {
    const final = outcome(records, changes);
    const folder = folderOfPath(path);
    const taken = [...final.values()].filter((note) => folderOfPath(note.path) === folder).map((note) => titleOfPath(note.path));
    const copyPath = notePath(folder, uniqueTitle(`${titleOfPath(path)} (conflict copy)`, taken));
    let copyId = newId();
    while (final.has(copyId)) copyId = newId();
    changes.set(copyId, { id: copyId, base: null, device: { path: copyPath, text: writeNote(remote.text, { id: copyId }) } });
    conflicts.push({ noteId: record.id, copyId, path: copyPath });
  }
  return conflicts;
}

/**
 * Paths must stay unique: when a pull brings a note to a path a device-only
 * note (new, or renamed here) also uses, the device-only one is re-titled.
 */
function retitleCollisions(records: readonly SyncRecord[], changes: Map<string, PullChange>): PullChange[] {
  const final = outcome(records, changes);

  const holders = new Map<string, string[]>();
  for (const [id, { path }] of final) {
    const key = path.toLowerCase();
    holders.set(key, [...(holders.get(key) ?? []), id]);
  }

  const retitled: PullChange[] = [];
  for (const ids of holders.values()) {
    if (ids.length < 2) continue;
    // The note the notebook already has at this path keeps it; device-only ones move aside.
    for (const id of ids) {
      const note = final.get(id);
      if (!note || (note.base && note.base.path === note.path)) continue;
      const folder = folderOfPath(note.path);
      const taken = [...final.values()].filter((other) => folderOfPath(other.path) === folder).map((other) => titleOfPath(other.path));
      const path = notePath(folder, uniqueTitle(titleOfPath(note.path), taken));
      final.set(id, { ...note, path });
      changes.delete(id);
      retitled.push({ id, base: note.base, device: { path, text: note.text } });
    }
  }
  return retitled;
}
