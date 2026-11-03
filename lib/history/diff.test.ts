import { describe, expect, it } from "vitest";
import { diffLines } from ".";

describe("diffLines", () => {
  it("reports an unchanged text as one unchanged hunk", () => {
    expect(diffLines("a\nb\n", "a\nb\n")).toEqual([{ kind: "unchanged", lines: ["a", "b"] }]);
  });

  it("marks the lines a version added and removed, keeping the lines around them as context", () => {
    const before = "Alpha\nBravo\nCharlie\n";
    const after = "Alpha\nBravo revised\nCharlie\nDelta\n";

    expect(diffLines(before, after)).toEqual([
      { kind: "unchanged", lines: ["Alpha"] },
      { kind: "removed", lines: ["Bravo"] },
      { kind: "added", lines: ["Bravo revised"] },
      { kind: "unchanged", lines: ["Charlie"] },
      { kind: "added", lines: ["Delta"] },
    ]);
  });

  it("folds unchanged stretches longer than the context into a gap that says how many lines it hides", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const before = lines.join("\n") + "\n";
    const after = ["first"].concat(lines.slice(0, 19), ["twenty changed"]).join("\n") + "\n";

    expect(diffLines(before, after)).toEqual([
      { kind: "added", lines: ["first"] },
      { kind: "unchanged", lines: ["line 1", "line 2", "line 3"] },
      { kind: "gap", hidden: 13 },
      { kind: "unchanged", lines: ["line 17", "line 18", "line 19"] },
      { kind: "removed", lines: ["line 20"] },
      { kind: "added", lines: ["twenty changed"] },
    ]);
  });

  it("treats an empty text and a text without a final newline sensibly", () => {
    expect(diffLines("", "Hello")).toEqual([{ kind: "added", lines: ["Hello"] }]);
    expect(diffLines("Hello", "")).toEqual([{ kind: "removed", lines: ["Hello"] }]);
    expect(diffLines("", "")).toEqual([]);
  });

  it("compares lines whatever their line endings", () => {
    expect(diffLines("a\r\nb\r\n", "a\nb\n")).toEqual([{ kind: "unchanged", lines: ["a", "b"] }]);
  });
});
