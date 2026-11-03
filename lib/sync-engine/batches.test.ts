import { describe, expect, it } from "vitest";
import type { FileChange } from "@/lib/remote";
import { batchMessage, planBatches, type ChangeUnit } from "./batches";

const write = (path: string): FileChange => ({ path, content: `# ${path}\n` });
const remove = (path: string): FileChange => ({ path, delete: true });

/** A unit carrying one note and `size` changes at paths of its own. */
function unit(name: string, size = 1): ChangeUnit {
  return {
    notes: [{ id: name, path: `${name}.md`, text: `# ${name}\n` }],
    changes: Array.from({ length: size }, (_, index) =>
      index === 0 ? write(`${name}.md`) : remove(`${name}-${index}.md`),
    ),
  };
}

describe("planning the commits of a push", () => {
  it("packs units in order into the fewest commits that hold at most the limit", () => {
    const batches = planBatches([unit("a", 3), unit("b", 1), unit("c", 1), unit("d", 3), unit("e", 2)], 4);

    expect(batches.map((batch) => batch.notes.map((note) => note.id))).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(batches.map((batch) => batch.changes.length)).toEqual([4, 4, 2]);
  });

  it("plans one commit when everything fits, and none for nothing", () => {
    expect(planBatches([unit("a"), unit("b")], 1000)).toHaveLength(1);
    expect(planBatches([unit("a"), unit("b")], 2)).toHaveLength(1);
    expect(planBatches([], 1000)).toEqual([]);
  });

  it("never splits a unit: a rename's new file and old file land in the same commit", () => {
    const rename = (from: string, to: string): ChangeUnit => ({
      notes: [{ id: to, path: `${to}.md`, text: "" }],
      changes: [remove(`${from}.md`), write(`${to}.md`)],
    });
    const batches = planBatches([rename("a", "A"), rename("b", "B"), rename("c", "C")], 3);

    expect(batches.map((batch) => batch.changes.map((change) => change.path))).toEqual([
      ["a.md", "A.md"],
      ["b.md", "B.md"],
      ["c.md", "C.md"],
    ]);
  });

  it("refuses a unit no commit can hold", () => {
    expect(() => planBatches([unit("a", 3)], 2)).toThrow(/3 changes .* at most 2/);
  });

  it("commits units that touch the same path together, a write winning over a delete", () => {
    // Two notes swapped names: each one's old path is the other's new path.
    const swap: ChangeUnit[] = [
      { notes: [{ id: "x", path: "b.md", text: "x" }], changes: [remove("a.md"), { path: "b.md", content: "x" }] },
      { notes: [{ id: "y", path: "a.md", text: "y" }], changes: [remove("b.md"), { path: "a.md", content: "y" }] },
    ];
    const batches = planBatches([unit("before"), ...swap, unit("after")], 2);

    expect(batches.map((batch) => batch.notes.map((note) => note.id))).toEqual([["before"], ["x", "y"], ["after"]]);
    expect(batches[1].changes).toEqual([
      { path: "b.md", content: "x" },
      { path: "a.md", content: "y" },
    ]);
  });

  it("merges a chain of units sharing paths, keeping the position of the first", () => {
    const chain: ChangeUnit[] = [
      { notes: [{ id: "p", path: "2.md", text: "" }], changes: [remove("1.md"), write("2.md")] },
      { notes: [], changes: [write("other.md")] },
      { notes: [{ id: "q", path: "3.md", text: "" }], changes: [remove("2.md"), write("3.md")] },
      { notes: [{ id: "r", path: "4.md", text: "" }], changes: [remove("3.md"), write("4.md")] },
    ];
    // The merged chain (4 changes) fills a commit on its own; the unit between its members follows.
    const [first, second] = planBatches(chain, 4);

    expect(first.notes.map((note) => note.id)).toEqual(["p", "q", "r"]);
    expect(first.changes).toEqual([remove("1.md"), write("2.md"), write("3.md"), write("4.md")]);
    expect(second.changes).toEqual([write("other.md")]);
  });

  it("keeps a unit's notes and changes in order within its commit", () => {
    const [batch] = planBatches([unit("b", 2), unit("a", 2)], 10);

    expect(batch.notes.map((note) => note.id)).toEqual(["b", "a"]);
    expect(batch.changes.map((change) => change.path)).toEqual(["b.md", "b-1.md", "a.md", "a-1.md"]);
  });
});

describe("the message of each commit", () => {
  it("leaves the message alone when the push is one commit", () => {
    expect(batchMessage("Update 3 notes", 1, 1)).toBe("Update 3 notes");
  });

  it("numbers each commit of several, with readable counts", () => {
    expect(batchMessage("Update 1,234 notes", 1, 3)).toBe("Update 1,234 notes (1 of 3)");
    expect(batchMessage("Update 1,234 notes", 3, 3)).toBe("Update 1,234 notes (3 of 3)");
    expect(batchMessage("Update 999,999 notes", 1000, 1234)).toBe("Update 999,999 notes (1,000 of 1,234)");
  });

  it("numbers the first line of a longer message", () => {
    expect(batchMessage("Convert v1 notes to Markdown\n\nLeft out 1 file", 2, 2)).toBe(
      "Convert v1 notes to Markdown (2 of 2)\n\nLeft out 1 file",
    );
  });
});
