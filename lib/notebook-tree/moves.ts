import { folderOfPath, isInsideOrSelf } from "@/lib/notebook-format";
import type { NotebookTree, TreeFolder } from "./tree";

/** What is being moved: a note, or a folder with everything in it. */
export type DragSource =
  | { kind: "note"; id: string; notebook: string; folder: string; title: string }
  | { kind: "folder"; notebook: string; path: string };

/** Where it could go: a folder of a notebook, `""` for the top level. */
export interface DropTarget {
  notebook: string;
  folder: string;
}

/**
 * Why `source` can't be dropped on `target`, in the member's words, or `null`
 * when it can: a note goes anywhere but the folder it is in; a folder goes
 * anywhere but where it is, itself, or a folder inside it; nothing changes
 * notebook.
 */
export function dropProblem(source: DragSource, target: DropTarget): string | null {
  if (source.notebook !== target.notebook) {
    return source.kind === "note" ? "Notes stay in their notebook" : "Folders stay in their notebook";
  }
  if (source.kind === "note") {
    return target.folder === source.folder ? "Already in this folder" : null;
  }
  if (isInsideOrSelf(target.folder, source.path)) return "A folder can't go inside itself";
  return target.folder === folderOfPath(source.path) ? "Already in this folder" : null;
}

/** One place `source` could be moved to, as the Move to… sheet lists them. */
export interface MoveDestination {
  folder: string;
  /** The folder's name, or the notebook's for the top level. */
  name: string;
  depth: number;
  /** Why it can't take the item, or `null`. */
  problem: string | null;
}

/** The notebook's top level and every folder in it, in reading order, each judged for `source`. */
export function moveDestinations(tree: NotebookTree, source: DragSource): MoveDestination[] {
  const destinations: MoveDestination[] = [];
  const add = (folder: string, name: string, depth: number) =>
    destinations.push({ folder, name, depth, problem: dropProblem(source, { notebook: tree.id, folder }) });
  const visit = (folders: readonly TreeFolder[], depth: number) => {
    for (const folder of folders) {
      add(folder.path, folder.name, depth);
      visit(folder.folders, depth + 1);
    }
  };
  add("", tree.name, 0);
  visit(tree.folders, 1);
  return destinations;
}
