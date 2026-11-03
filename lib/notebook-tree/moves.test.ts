import { describe, expect, it } from "vitest";
import { buildNotebookTrees, dropProblem, moveDestinations, type DragSource, type TreeNoteInput } from ".";

const notebook = "mira/my-notes";
const plan: DragSource = { kind: "note", notebook, folder: "Projects/Garden", title: "Plan" };
const garden: DragSource = { kind: "folder", notebook, path: "Projects/Garden" };

describe("dropProblem", () => {
  it("lets a note go to any folder but the one it is in", () => {
    expect(dropProblem(plan, { notebook, folder: "" })).toBeNull();
    expect(dropProblem(plan, { notebook, folder: "Projects" })).toBeNull();
    expect(dropProblem(plan, { notebook, folder: "Projects/Garden/Beds" })).toBeNull();
    expect(dropProblem(plan, { notebook, folder: "Projects/Garden" })).toBe("Already in this folder");
  });

  it("lets a folder go anywhere but into itself, its descendants, or where it already is", () => {
    expect(dropProblem(garden, { notebook, folder: "" })).toBeNull();
    expect(dropProblem(garden, { notebook, folder: "Archive" })).toBeNull();
    expect(dropProblem(garden, { notebook, folder: "Projects" })).toBe("Already in this folder");
    expect(dropProblem(garden, { notebook, folder: "Projects/Garden" })).toBe("A folder can't go inside itself");
    expect(dropProblem(garden, { notebook, folder: "Projects/Garden/Beds" })).toBe("A folder can't go inside itself");
    expect(dropProblem({ kind: "folder", notebook, path: "Projects" }, { notebook, folder: "" })).toBe("Already in this folder");
  });

  it("keeps notes and folders in their notebook", () => {
    expect(dropProblem(plan, { notebook: "team/trip", folder: "" })).toBe("Notes stay in their notebook");
    expect(dropProblem(garden, { notebook: "team/trip", folder: "" })).toBe("Folders stay in their notebook");
  });
});

describe("moveDestinations", () => {
  let counter = 0;
  const note = (path: string): TreeNoteInput => ({
    id: `id-${++counter}`,
    notebook,
    path,
    title: path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, ""),
    folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
    updated: null,
  });
  const [tree] = buildNotebookTrees([note("Projects/Garden/Beds/Cedar.md"), note("Archive/Old.md"), note("Top.md")], {
    folders: [{ notebook, path: "Ideas" }],
  });

  it("lists the top level and every folder in reading order, each with its depth and whether it can take the item", () => {
    expect(moveDestinations(tree, plan)).toEqual([
      { folder: "", name: "my-notes", depth: 0, problem: null },
      { folder: "Archive", name: "Archive", depth: 1, problem: null },
      { folder: "Ideas", name: "Ideas", depth: 1, problem: null },
      { folder: "Projects", name: "Projects", depth: 1, problem: null },
      { folder: "Projects/Garden", name: "Garden", depth: 2, problem: "Already in this folder" },
      { folder: "Projects/Garden/Beds", name: "Beds", depth: 3, problem: null },
    ]);
  });

  it("marks a folder's own subtree out of bounds", () => {
    const problems = moveDestinations(tree, garden).map((d) => [d.folder, d.problem]);
    expect(problems).toContainEqual(["Projects", "Already in this folder"]);
    expect(problems).toContainEqual(["Projects/Garden", "A folder can't go inside itself"]);
    expect(problems).toContainEqual(["Projects/Garden/Beds", "A folder can't go inside itself"]);
    expect(problems).toContainEqual(["Archive", null]);
  });
});
