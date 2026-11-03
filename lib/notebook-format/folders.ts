import { ATTACHMENTS_DIR, sanitizeName, uniqueTitle } from "./paths";

/** The file that keeps an empty folder in git, which has no directories of its own. */
export const FOLDER_KEEP = ".gitkeep";

/** The name a folder gets when the member typed none. */
export const NEW_FOLDER = "New folder";

/** The path of the file that keeps `folder` (never `""`) while it holds no notes. */
export function folderKeepPath(folder: string): string {
  return `${folder}/${FOLDER_KEEP}`;
}

/**
 * The folder a `.gitkeep` at `path` keeps, or `null` when the file keeps
 * nothing a member sees: the notebook's root, `attachments/`, or anything
 * inside a hidden directory.
 */
export function folderOfKeepPath(path: string): string | null {
  const segments = path.split("/");
  if (segments.length < 2 || segments[segments.length - 1] !== FOLDER_KEEP) return null;
  const folder = segments.slice(0, -1);
  if (folder[0] === ATTACHMENTS_DIR) return null;
  if (folder.some((segment) => segment === "" || segment.startsWith("."))) return null;
  return folder.join("/");
}

/** A folder's name: its last segment. */
export function folderName(folder: string): string {
  return folder.slice(folder.lastIndexOf("/") + 1);
}

/** Whether `path` (a note's, a `.gitkeep`'s or a folder's) is inside `folder`, at any depth; `""` holds everything. */
export function isInFolder(path: string, folder: string): boolean {
  return folder === "" ? true : path.startsWith(`${folder}/`);
}

/** Whether `folder` is `ancestor` or inside it: where `ancestor` can't be moved to. */
export function isInsideOrSelf(folder: string, ancestor: string): boolean {
  return folder === ancestor || isInFolder(folder, ancestor);
}

/** `path`, which is in `from` (or is `from`), once `from` has moved to `to`. */
export function movedPath(path: string, from: string, to: string): string {
  const rest = from === "" ? path : path.slice(from.length + 1);
  if (rest === "") return to;
  return to === "" ? rest : `${to}/${rest}`;
}

/** A folder name that works as a directory name on every system; empty becomes "New folder". */
export function sanitizeFolderName(raw: string): string {
  return sanitizeName(raw, NEW_FOLDER);
}

/**
 * `name`, or `name 2`, `name 3`, …: the first that no folder in `siblings`
 * (the names of the folders in `parent`) uses, ignoring case. At the top
 * level `attachments` is spoken for.
 */
export function uniqueFolderName(name: string, parent: string, siblings: Iterable<string>): string {
  return uniqueTitle(name, parent === "" ? [...siblings, ATTACHMENTS_DIR] : siblings);
}
