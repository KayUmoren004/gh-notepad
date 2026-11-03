import type { FolderMove, FolderPullChange, FolderRecord, SyncRecord } from "@/lib/device-store";
import { folderKeepPath, folderName, folderOfPath, isInFolder, isInsideOrSelf, movedPath, titleOfPath } from "@/lib/notebook-format";
import type { FileChange } from "@/lib/remote";
import { count, type ChangeUnit } from "./batches";

/**
 * Decides what a pull does to the folders kept on their own, given the
 * folders whose `.gitkeep` the notebook holds at the commit being pulled.
 *
 * - A marker the device already knows (as a folder's base) is unchanged, even
 *   if the folder was renamed here: the push moves the marker.
 * - A marker for a folder made here too means both sides agree on it now.
 * - A new marker is a new folder.
 * - A marker gone from the notebook takes its folder from the device, unless
 *   the folder was renamed here, which the push then adds afresh.
 */
export function reconcileFolders(records: readonly FolderRecord[], remote: readonly string[]): FolderPullChange[] {
  const changes: FolderPullChange[] = [];
  const kept = new Set(remote);
  const bases = new Set(records.flatMap((record) => (record.base === null ? [] : [record.base])));
  const byPath = new Map(records.map((record) => [record.path, record]));
  for (const folder of remote) {
    if (bases.has(folder)) continue;
    const here = byPath.get(folder);
    if (!here || here.base !== folder) changes.push({ path: folder, base: folder });
  }
  for (const record of records) {
    if (record.base === null || kept.has(record.base)) continue;
    if (record.dirty) changes.push({ path: record.path, base: null });
    else changes.push({ path: record.path, remove: true });
  }
  return changes;
}

/** The changes a folder's marker needs in one commit: added where the folder is, and removed from where it was. */
export function folderUnits(dirty: readonly FolderRecord[]): ChangeUnit[] {
  return dirty.map((record) => {
    const changes: FileChange[] = [];
    if (record.base !== null && record.base !== record.path) changes.push({ path: folderKeepPath(record.base), delete: true });
    changes.push({ path: folderKeepPath(record.path), content: "" });
    return { notes: [], folders: [record.path], changes };
  });
}

/**
 * The message of a push that moved things: `Rename "Garden" to "Allotment"`
 * or `Move "Garden" to Projects` when one folder move accounts for every
 * change, `Add folder "Ideas"`, `Add 2 folders`, `Move 3 notes to Archive`,
 * `Move 2 notes`; or `null` when the push is something else.
 */
export function moveMessage(
  dirty: readonly SyncRecord[],
  folders: readonly FolderRecord[],
  moves: readonly FolderMove[],
): string | null {
  if (moves.length === 1) {
    const [{ from, to }] = moves;
    const notesFollow = dirty.every(
      (record) => record.base !== null && isInFolder(record.base.path, from) && record.path === movedPath(record.base.path, from, to),
    );
    const foldersFollow = folders.every((record) => record.base !== null && isInsideOrSelf(record.base, from));
    if (notesFollow && foldersFollow) return folderMoveMessage(from, to);
  }
  if (dirty.length === 0 && folders.length > 0) {
    if (folders.length > 1) {
      return folders.every((record) => record.base === null) ? `Add ${count(folders.length)} folders` : `Update ${count(folders.length)} folders`;
    }
    const [{ base, path }] = folders;
    return base === null ? `Add folder "${folderName(path)}"` : folderMoveMessage(base, path);
  }
  if (dirty.length > 1 && folders.length === 0 && dirty.every(isPureMove)) {
    const destinations = new Set(dirty.map((record) => folderOfPath(record.path)));
    const message = `Move ${count(dirty.length)} notes`;
    if (destinations.size !== 1) return message;
    const [destination] = destinations;
    return `${message} to ${destination || "the top level"}`;
  }
  return null;
}

/** `Rename "Garden" to "Allotment"` when the folder stays where it is, `Move "Garden" to Projects` otherwise. */
function folderMoveMessage(from: string, to: string): string {
  if (folderOfPath(from) === folderOfPath(to)) return `Rename "${folderName(from)}" to "${folderName(to)}"`;
  return `Move "${folderName(from)}" to ${folderOfPath(to) || "the top level"}`;
}

/** A note that only changed folder: same title, same text. */
function isPureMove(record: SyncRecord): boolean {
  return (
    record.base !== null &&
    record.base.text === record.text &&
    folderOfPath(record.base.path) !== folderOfPath(record.path) &&
    titleOfPath(record.base.path) === titleOfPath(record.path)
  );
}
