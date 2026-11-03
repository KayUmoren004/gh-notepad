import { describe, expect, it } from "vitest";
import {
  breadcrumbOf,
  buildNotebookTrees,
  flattenTrees,
  folderKey,
  formatNoteCount,
  keysAbove,
  notebookKey,
  notebookName,
  recentNotes,
  type TreeNoteInput,
} from ".";

let counter = 0;
/** A note as the device store shows it, with the fields the tree reads. */
function note(path: string, options: { notebook?: string; updated?: string | null } = {}): TreeNoteInput {
  const slash = path.lastIndexOf("/");
  return {
    id: `id-${++counter}`,
    notebook: options.notebook ?? "mira/my-notes",
    path,
    title: path.slice(slash + 1).replace(/\.md$/, ""),
    folder: slash === -1 ? "" : path.slice(0, slash),
    updated: options.updated ?? null,
  };
}

describe("buildNotebookTrees", () => {
  it("derives nested folders from note paths, to any depth", () => {
    const [tree] = buildNotebookTrees([
      note("Projects/Garden/Beds/Cedar.md"),
      note("Projects/Garden/Plan.md"),
      note("Groceries.md"),
    ]);

    expect(tree.id).toBe("mira/my-notes");
    expect(tree.name).toBe("my-notes");
    expect(tree.notes.map((n) => n.title)).toEqual(["Groceries"]);
    const projects = tree.folders[0];
    expect(projects.name).toBe("Projects");
    expect(projects.path).toBe("Projects");
    const garden = projects.folders[0];
    expect(garden.path).toBe("Projects/Garden");
    expect(garden.notes.map((n) => n.title)).toEqual(["Plan"]);
    expect(garden.folders[0].path).toBe("Projects/Garden/Beds");
    expect(garden.folders[0].notes.map((n) => n.title)).toEqual(["Cedar"]);
  });

  it("sorts folders first, then notes, each alphabetically and naturally", () => {
    const [tree] = buildNotebookTrees([
      note("zebra.md"),
      note("Apple.md"),
      note("note 10.md"),
      note("note 2.md"),
      note("Work/a.md"),
      note("archive/b.md"),
      note("Été.md"),
    ]);

    expect(tree.folders.map((f) => f.name)).toEqual(["archive", "Work"]);
    expect(tree.notes.map((n) => n.title)).toEqual(["Apple", "Été", "note 2", "note 10", "zebra"]);
  });

  it("counts the notes in each folder, including those in folders inside it", () => {
    const [tree] = buildNotebookTrees([note("A/B/one.md"), note("A/B/two.md"), note("A/three.md"), note("four.md")]);

    expect(tree.noteCount).toBe(4);
    expect(tree.folders[0].noteCount).toBe(3);
    expect(tree.folders[0].folders[0].noteCount).toBe(2);
  });

  it("shows a notebook with no notes yet, and sorts notebooks by name", () => {
    const trees = buildNotebookTrees([note("x.md", { notebook: "team/family-trip" })], {
      notebooks: ["mira/my-notes"],
    });

    expect(trees.map((t) => [t.name, t.noteCount])).toEqual([
      ["family-trip", 1],
      ["my-notes", 0],
    ]);
  });

  it("shows folders that hold no notes, nested where their paths say, counting no notes", () => {
    const [tree] = buildNotebookTrees([note("Projects/Plan.md")], {
      folders: [
        { notebook: "mira/my-notes", path: "Projects/Garden/Beds" },
        { notebook: "mira/my-notes", path: "Archive" },
        // One that notes already make: nothing doubles.
        { notebook: "mira/my-notes", path: "Projects" },
      ],
    });

    expect(tree.folders.map((f) => [f.name, f.noteCount])).toEqual([
      ["Archive", 0],
      ["Projects", 1],
    ]);
    const garden = tree.folders[1].folders[0];
    expect(garden.path).toBe("Projects/Garden");
    expect(garden.noteCount).toBe(0);
    expect(garden.folders.map((f) => f.path)).toEqual(["Projects/Garden/Beds"]);
    expect(tree.noteCount).toBe(1);
  });

  it("shows a notebook that holds only an empty folder", () => {
    const trees = buildNotebookTrees([], { folders: [{ notebook: "mira/my-notes", path: "Ideas" }] });
    expect(trees.map((t) => [t.name, t.folders.map((f) => f.name)])).toEqual([["my-notes", ["Ideas"]]]);
  });

  it("keeps emoji and non-Latin folder and note names as they are", () => {
    const [tree] = buildNotebookTrees([note("日記/🌱 春.md"), note("Заметки/Идеи.md")]);

    expect(tree.folders.map((f) => f.name)).toEqual(["Заметки", "日記"]);
    expect(tree.folders[1].notes[0].title).toBe("🌱 春");
  });
});

describe("flattenTrees", () => {
  const trees = buildNotebookTrees([note("A/B/deep.md"), note("A/top.md"), note("root.md")]);

  it("lists every row with its depth when everything is expanded", () => {
    const rows = flattenTrees(trees, () => true);

    expect(rows.map((row) => [row.kind, row.depth, row.label])).toEqual([
      ["notebook", 0, "my-notes"],
      ["folder", 1, "A"],
      ["folder", 2, "B"],
      ["note", 3, "deep"],
      ["note", 2, "top"],
      ["note", 1, "root"],
    ]);
  });

  it("hides what is inside a collapsed folder or notebook", () => {
    const collapsed = new Set([folderKey("mira/my-notes", "A/B")]);
    const rows = flattenTrees(trees, (key) => !collapsed.has(key));
    expect(rows.map((row) => row.label)).toEqual(["my-notes", "A", "B", "top", "root"]);
    expect(rows[2].kind === "folder" && rows[2].expanded).toBe(false);

    const all = flattenTrees(trees, (key) => key !== notebookKey("mira/my-notes"));
    expect(all.map((row) => row.label)).toEqual(["my-notes"]);
  });

  it("gives every row a key that is stable across rebuilds", () => {
    const first = flattenTrees(trees, () => true).map((row) => row.key);
    const again = flattenTrees(buildNotebookTrees([note("A/B/deep.md"), note("A/top.md"), note("root.md")]), () => true);
    // Folder and notebook keys come from their paths; note keys from their ids, which are new here.
    expect(again.map((row) => row.key).slice(0, 3)).toEqual(first.slice(0, 3));
  });
});

describe("keysAbove", () => {
  it("names the notebook and every folder that must be expanded for a note to show", () => {
    expect(keysAbove("mira/my-notes", "A/B")).toEqual([
      notebookKey("mira/my-notes"),
      folderKey("mira/my-notes", "A"),
      folderKey("mira/my-notes", "A/B"),
    ]);
    expect(keysAbove("mira/my-notes", "")).toEqual([notebookKey("mira/my-notes")]);
  });
});

describe("recentNotes", () => {
  it("lists the last edited notes first, at most `limit`, leaving out notes never edited", () => {
    const notes = [
      note("old.md", { updated: "2026-01-01T00:00:00Z" }),
      note("newest.md", { updated: "2026-03-01T00:00:00Z" }),
      note("never.md", { updated: null }),
      note("middle.md", { updated: "2026-02-01T00:00:00Z" }),
    ];

    expect(recentNotes(notes, 2).map((n) => n.title)).toEqual(["newest", "middle"]);
    expect(recentNotes(notes, 10).map((n) => n.title)).toEqual(["newest", "middle", "old"]);
  });
});

describe("labels", () => {
  it("names a notebook by its repository", () => {
    expect(notebookName("mira/my-notes")).toBe("my-notes");
    expect(notebookName("family-trip")).toBe("family-trip");
  });

  it("builds the breadcrumb from notebook, folders and title", () => {
    expect(breadcrumbOf(note("Projects/Garden/Plan.md"))).toEqual(["my-notes", "Projects", "Garden", "Plan"]);
    expect(breadcrumbOf(note("Plan.md"))).toEqual(["my-notes", "Plan"]);
  });

  it("pluralises and groups note counts", () => {
    expect(formatNoteCount(0)).toBe("No notes");
    expect(formatNoteCount(1)).toBe("1 note");
    expect(formatNoteCount(2)).toBe("2 notes");
    expect(formatNoteCount(1284)).toBe("1,284 notes");
  });
});
