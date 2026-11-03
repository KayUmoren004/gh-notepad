/**
 * The notebook tree the sidebar shows: pure functions over the device store's
 * notes, with no idea of React or the DOM.
 *
 * - `buildNotebookTrees` derives folders from note paths (folders are real
 *   directories, ADR 0001) and the folders kept while empty, nested to any
 *   depth, folders first and everything sorted naturally.
 * - `dropProblem` says whether a note or folder may be moved somewhere, and
 *   `moveDestinations` lists everywhere it could go (`moves.ts`), so drag and
 *   drop and the Move to… sheet refuse the same things with the same words.
 * - `flattenTrees` turns the trees into the rows a (virtualised) list renders,
 *   skipping what is inside collapsed notebooks and folders; `keysAbove` names
 *   what to expand so a given note shows.
 * - `recentNotes`, `breadcrumbOf` and `formatNoteCount` are the small
 *   derivations the shell's labels need.
 */
export { dropProblem, moveDestinations, type DragSource, type DropTarget, type MoveDestination } from "./moves";
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
  type TreeFolderInput,
  type TreeNote,
  type TreeNoteInput,
  type TreeRow,
} from "./tree";
