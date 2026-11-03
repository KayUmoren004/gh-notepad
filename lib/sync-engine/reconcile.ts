import type { AgreedVersion, PullChange, SyncRecord } from "@/lib/device-store";
import { folderOfPath, notePath, readNote, titleOfPath, uniqueTitle } from "@/lib/notebook-format";

/** A note file as the notebook has it at the commit being pulled. */
export type RemoteNote = AgreedVersion;

/**
 * Decides what a pull does to each note on the device. Pure, and applied in
 * the same synchronous step it is computed in, so nothing typed can slip
 * between the decision and the change.
 *
 * - Remote notes are matched to device notes by frontmatter `id` (so a rename
 *   elsewhere is followed), falling back to the path both sides agreed on.
 * - A note with no unsynced changes takes the remote version as it is.
 * - A note with unsynced changes keeps the device's text (the merge point:
 *   #4 replaces "device wins" with a three-way merge and conflict copies); it
 *   follows a remote rename when the device didn't rename it too.
 * - A note gone from the notebook leaves the device too, unless it has
 *   unsynced changes, which are kept and pushed back.
 * - A device note whose path a remote note now holds is re-titled ("Title 2").
 */
export function reconcile(
  records: readonly SyncRecord[],
  remote: readonly RemoteNote[],
  newId: () => string,
): PullChange[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const byBasePath = new Map(records.flatMap((record) => (record.base ? [[record.base.path, record] as const] : [])));
  const matched = new Set<string>();
  const claimedIds = new Set<string>();
  const changes = new Map<string, Extract<PullChange, { device: unknown }> | Extract<PullChange, { remove: true }>>();

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
      const key = id && !byId.has(id) && !changes.has(id) ? id : newId();
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
      changes.set(record.id, { id: record.id, base: file, device: { path, text: record.text } });
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

  const retitled = retitleCollisions(records, changes);
  return [...changes.values(), ...retitled];
}

/**
 * Paths must stay unique: when a pull brings a note to a path a device-only
 * note (new, or renamed here) also uses, the device-only one is re-titled.
 */
function retitleCollisions(records: readonly SyncRecord[], changes: Map<string, PullChange>): PullChange[] {
  const final = new Map<string, { path: string; text: string; base: AgreedVersion | null }>();
  for (const record of records) final.set(record.id, { path: record.path, text: record.text, base: record.base });
  for (const change of changes.values()) {
    if ("remove" in change) final.delete(change.id);
    else final.set(change.id, { ...change.device, base: change.base });
  }

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
