import { folderOfKeepPath, isInFolder } from "./folders";
import { isNotePath } from "./paths";

/** The directory deleted notes and folders wait in, mirroring their original paths. */
export const TRASH_DIR = ".trash";

/** How long an item stays in the Trash before sync removes it for good. */
export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Where `path` (a note's, a `.gitkeep`'s or a folder's; `""` for the top level) goes when trashed: `.trash/<path>`. */
export function trashPath(path: string): string {
  return path === "" ? TRASH_DIR : `${TRASH_DIR}/${path}`;
}

/** Whether `path` is in the Trash (or is the Trash itself, as the folder `""` becomes). */
export function isTrashPath(path: string): boolean {
  return path === TRASH_DIR || isInFolder(path, TRASH_DIR);
}

/** `path` with `.trash/` taken off: where the item was, or where it goes back to. `path` itself when it isn't trashed. */
export function originalPath(path: string): string {
  if (path === TRASH_DIR) return "";
  return isTrashPath(path) ? path.slice(TRASH_DIR.length + 1) : path;
}

/** Whether the file at `path` is a trashed note: a note path under `.trash/`. */
export function isTrashedNotePath(path: string): boolean {
  return isTrashPath(path) && isNotePath(originalPath(path));
}

/** The trashed folder a `.gitkeep` at `path` keeps (`.trash/Garden`), or `null` when it keeps nothing a member sees. */
export function folderOfTrashedKeepPath(path: string): string | null {
  if (!isTrashPath(path)) return null;
  const folder = folderOfKeepPath(originalPath(path));
  return folder === null ? null : trashPath(folder);
}

/**
 * When an item trashed at `trashed` (an ISO timestamp) leaves the Trash for
 * good: `TRASH_RETENTION_DAYS` later. `null` for a timestamp that can't be
 * read, so an item whose date is unknown is never purged by mistake.
 */
export function purgeTime(trashed: string): number | null {
  const time = Date.parse(trashed);
  return Number.isNaN(time) ? null : time + TRASH_RETENTION_MS;
}
