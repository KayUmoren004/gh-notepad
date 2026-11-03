/**
 * The notebook tree the sidebar shows: pure functions over the device store's
 * notes, with no idea of React or the DOM.
 *
 * - `buildNotebookTrees` derives folders from note paths (folders are real
 *   directories, ADR 0001), nested to any depth, folders first and everything
 *   sorted naturally.
 * - `flattenTrees` turns the trees into the rows a (virtualised) list renders,
 *   skipping what is inside collapsed notebooks and folders; `keysAbove` names
 *   what to expand so a given note shows.
 * - `recentNotes`, `breadcrumbOf` and `formatNoteCount` are the small
 *   derivations the shell's labels need.
 */
export {
  breadcrumbOf,
  buildNotebookTrees,
  flattenTrees,
  folderKey,
  formatNoteCount,
  keysAbove,
  notebookKey,
  notebookName,
  recentNotes,
  type NotebookTree,
  type TreeFolder,
  type TreeNote,
  type TreeNoteInput,
  type TreeRow,
} from "./tree";
