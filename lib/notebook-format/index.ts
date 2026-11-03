/**
 * The notebook format (ADR 0001): how notes are laid out as files in a
 * notebook's repository. Pure functions, used on the device and on the server.
 *
 * - A note is `<folder path>/<title>.md`: Markdown with optional YAML
 *   frontmatter holding `id`, `tags`, `created`, `updated` and, while the
 *   note has a share link, `share`.
 * - Reading and writing never disturb what they don't change: an unchanged
 *   note serialises to the original bytes.
 * - A folder is a directory; one that holds no notes is kept by a `.gitkeep`
 *   (`folders.ts`). Folder names follow the rules of titles.
 */
export {
  FOLDER_KEEP,
  NEW_FOLDER,
  folderKeepPath,
  folderName,
  folderOfKeepPath,
  isInFolder,
  isInsideOrSelf,
  movedPath,
  sanitizeFolderName,
  uniqueFolderName,
} from "./folders";
export { readNote, writeNote, type NoteChanges, type NoteFields } from "./note-file";
export {
  fallbackNoteId,
  folderOfPath,
  isNotePath,
  isSafePath,
  notePath,
  sanitizeTitle,
  titleOfPath,
  uniqueTitle,
  UNTITLED,
} from "./paths";
export { isV1Path, migrateV1, type TextFile, type V1Migration } from "./v1-migration";
