/** The fields of a note the tree reads; `Note` from the device store satisfies it. */
export interface TreeNoteInput {
  id: string;
  /** The notebook's id, `owner/repo`. */
  notebook: string;
  path: string;
  title: string;
  /** `""` at the top level of the notebook. */
  folder: string;
  updated: string | null;
}

export interface TreeNote {
  kind: "note";
  id: string;
  notebook: string;
  title: string;
  folder: string;
}

export interface TreeFolder {
  kind: "folder";
  notebook: string;
  name: string;
  /** The folder's path in the notebook, `Projects/Garden`. */
  path: string;
  folders: TreeFolder[];
  notes: TreeNote[];
  /** Notes in this folder and every folder inside it. */
  noteCount: number;
}

export interface NotebookTree {
  kind: "notebook";
  id: string;
  /** The repository's name: what the sidebar shows. */
  name: string;
  folders: TreeFolder[];
  notes: TreeNote[];
  noteCount: number;
}

/** One line of the sidebar, as the tree is read top to bottom with some folders collapsed. */
export type TreeRow =
  | { kind: "notebook"; key: string; depth: 0; label: string; notebook: NotebookTree; expanded: boolean }
  | { kind: "folder"; key: string; depth: number; label: string; folder: TreeFolder; expanded: boolean }
  | { kind: "note"; key: string; depth: number; label: string; note: TreeNote };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const byName = <T extends { name: string }>(a: T, b: T) => collator.compare(a.name, b.name) || a.name.localeCompare(b.name);
const byTitle = (a: TreeNote, b: TreeNote) => collator.compare(a.title, b.title) || a.title.localeCompare(b.title);

export function notebookName(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1);
}

export function notebookKey(notebook: string): string {
  return `notebook:${notebook}`;
}

export function folderKey(notebook: string, path: string): string {
  return `folder:${notebook}:${path}`;
}

/** A folder that exists on its own (kept by a `.gitkeep`), whether or not notes are in it. */
export interface TreeFolderInput {
  notebook: string;
  path: string;
}

/**
 * The tree of every notebook: folders derived from the notes' paths and from
 * `folders` (the ones kept while empty), nested to any depth, folders before
 * notes and each sorted alphabetically. Notebooks in `notebooks` are included
 * even when they hold nothing yet.
 */
export function buildNotebookTrees(
  notes: Iterable<TreeNoteInput>,
  { notebooks = [], folders = [] }: { notebooks?: readonly string[]; folders?: Iterable<TreeFolderInput> } = {},
): NotebookTree[] {
  const trees = new Map<string, NotebookTree>();
  const tree = (id: string): NotebookTree => {
    let found = trees.get(id);
    if (!found) {
      found = { kind: "notebook", id, name: notebookName(id), folders: [], notes: [], noteCount: 0 };
      trees.set(id, found);
    }
    return found;
  };
  for (const id of notebooks) tree(id);

  /** The folder at `path` in `notebook`, made along with the folders above it; `count` adds a note to each. */
  const folderAt = (notebook: string, path: string, count: boolean) => {
    let level: { folders: TreeFolder[]; notes: TreeNote[] } = tree(notebook);
    if (!path) return level;
    let current = "";
    for (const name of path.split("/")) {
      current = current ? `${current}/${name}` : name;
      let folder = level.folders.find((candidate) => candidate.path === current);
      if (!folder) {
        folder = { kind: "folder", notebook, name, path: current, folders: [], notes: [], noteCount: 0 };
        level.folders.push(folder);
      }
      if (count) folder.noteCount++;
      level = folder;
    }
    return level;
  };

  for (const folder of folders) folderAt(folder.notebook, folder.path, false);
  for (const note of notes) {
    tree(note.notebook).noteCount++;
    const level = folderAt(note.notebook, note.folder, true);
    level.notes.push({ kind: "note", id: note.id, notebook: note.notebook, title: note.title, folder: note.folder });
  }

  const sort = (level: { folders: TreeFolder[]; notes: TreeNote[] }) => {
    level.folders.sort(byName);
    level.notes.sort(byTitle);
    for (const folder of level.folders) sort(folder);
  };
  const result = [...trees.values()].sort(byName);
  for (const root of result) sort(root);
  return result;
}

/** The rows the sidebar shows, given which notebooks and folders are expanded. */
export function flattenTrees(trees: readonly NotebookTree[], isExpanded: (key: string) => boolean): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (level: { folders: TreeFolder[]; notes: TreeNote[] }, depth: number) => {
    for (const folder of level.folders) {
      const key = folderKey(folder.notebook, folder.path);
      const expanded = isExpanded(key);
      rows.push({ kind: "folder", key, depth, label: folder.name, folder, expanded });
      if (expanded) visit(folder, depth + 1);
    }
    for (const note of level.notes) rows.push({ kind: "note", key: `note:${note.id}`, depth, label: note.title, note });
  };
  for (const notebook of trees) {
    const key = notebookKey(notebook.id);
    const expanded = isExpanded(key);
    rows.push({ kind: "notebook", key, depth: 0, label: notebook.name, notebook, expanded });
    if (expanded) visit(notebook, 1);
  }
  return rows;
}

/** The keys of the notebook and every folder above a note in `folder`: expand them all and the note shows. */
export function keysAbove(notebook: string, folder: string): string[] {
  const keys = [notebookKey(notebook)];
  if (!folder) return keys;
  let path = "";
  for (const name of folder.split("/")) {
    path = path ? `${path}/${name}` : name;
    keys.push(folderKey(notebook, path));
  }
  return keys;
}

/** The last edited notes, newest first and at most `limit`; notes that were never edited don't count. */
export function recentNotes<T extends { title: string; updated: string | null }>(notes: Iterable<T>, limit: number): T[] {
  const edited = Array.from(notes).filter((note): note is T & { updated: string } => note.updated !== null);
  edited.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : collator.compare(a.title, b.title)));
  return edited.slice(0, limit);
}

/** `my-notes / Projects / Garden / Plan`, one entry per segment. */
export function breadcrumbOf(note: Pick<TreeNoteInput, "notebook" | "folder" | "title">): string[] {
  return [notebookName(note.notebook), ...(note.folder ? note.folder.split("/") : []), note.title];
}

const plural = new Intl.PluralRules("en");
const number = new Intl.NumberFormat("en");

export function formatNoteCount(count: number): string {
  if (count === 0) return "No notes";
  return `${number.format(count)} ${plural.select(count) === "one" ? "note" : "notes"}`;
}
