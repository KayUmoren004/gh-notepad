import type { FolderMove, FolderRecord, SyncRecord } from "@/lib/device-store";
import { folderKeepPath, folderName, isInFolder, isInsideOrSelf, isTrashPath, movedPath, titleOfPath } from "@/lib/notebook-format";
import { count, type ChangeUnit } from "./batches";

/** What a push removes for good: notes and folders deleted from the Trash, each still in the notebook at its base. */
export interface Deletions {
  notes: readonly SyncRecord[];
  folders: readonly FolderRecord[];
  /** Nothing is left in the Trash once they are gone. */
  emptiesTrash: boolean;
}

export const NO_DELETIONS: Deletions = { notes: [], folders: [], emptiesTrash: false };

/** One unit per deleted note or folder: the removal of its file, or of its marker, from where the notebook has it. */
export function deleteUnits({ notes, folders }: Deletions): ChangeUnit[] {
  const units: ChangeUnit[] = [];
  for (const record of notes) {
    if (!record.base) continue;
    units.push({ notes: [], changes: [{ path: record.base.path, delete: true }], removed: { notes: [record.id], folders: [] } });
  }
  for (const record of folders) {
    if (record.base === null) continue;
    units.push({ notes: [], changes: [{ path: folderKeepPath(record.base), delete: true }], removed: { notes: [], folders: [record.path] } });
  }
  return units;
}

/** A note going into the Trash with this push (or created and trashed before it ever reached the notebook). */
const isTrashing = (record: SyncRecord) => isTrashPath(record.path) && (record.base === null || !isTrashPath(record.base.path));
/** A note coming out of the Trash with this push. */
const isRestoring = (record: SyncRecord) => !isTrashPath(record.path) && record.base !== null && isTrashPath(record.base.path);

/**
 * The message of a push that moved things into or out of the Trash, or
 * removed them from it: `Delete "Plan"`, `Delete "Garden"` (a folder with
 * everything in it), `Delete 3 notes`, `Restore "Plan"`, `Restore "Garden"`,
 * `Restore 3 notes`, `Remove "Plan" from Trash`, `Remove 3 notes from Trash`,
 * `Empty Trash`; or `null` when the push is something else.
 */
export function trashMessage(
  dirty: readonly SyncRecord[],
  folders: readonly FolderRecord[],
  moves: readonly FolderMove[],
  deletions: Deletions,
): string | null {
  const removing = deletions.notes.length + deletions.folders.length > 0;
  if (removing) {
    if (dirty.length > 0 || folders.length > 0) return null;
    if (deletions.emptiesTrash) return "Empty Trash";
    if (deletions.notes.length === 1 && deletions.folders.length === 0) {
      return `Remove "${titleOfPath(deletions.notes[0].path)}" from Trash`;
    }
    const [folder] = deletions.folders;
    if (deletions.folders.length === 1 && deletions.notes.every((record) => isInFolder(record.path, folder.path))) {
      return `Remove "${folderName(folder.path)}" from Trash`;
    }
    if (deletions.notes.length === 0) return `Remove ${count(deletions.folders.length)} folders from Trash`;
    return `Remove ${count(deletions.notes.length)} ${deletions.notes.length === 1 ? "note" : "notes"} from Trash`;
  }

  if (moves.length === 1) {
    const [{ from, to }] = moves;
    const trashing = isTrashPath(to) && !isTrashPath(from);
    const restoring = isTrashPath(from) && !isTrashPath(to);
    const notesFollow = dirty.every(
      (record) => record.base !== null && isInFolder(record.base.path, from) && record.path === movedPath(record.base.path, from, to),
    );
    const foldersFollow = folders.every((record) => isInsideOrSelf(record.path, to));
    if ((trashing || restoring) && notesFollow && foldersFollow) {
      return `${trashing ? "Delete" : "Restore"} "${folderName(trashing ? from : to)}"`;
    }
    return null;
  }
  if (moves.length > 0 || folders.length > 0 || dirty.length === 0) return null;

  if (dirty.every(isTrashing)) return dirty.length === 1 ? `Delete "${titleOfPath(dirty[0].path)}"` : `Delete ${count(dirty.length)} notes`;
  if (dirty.every(isRestoring)) return dirty.length === 1 ? `Restore "${titleOfPath(dirty[0].path)}"` : `Restore ${count(dirty.length)} notes`;
  return null;
}
