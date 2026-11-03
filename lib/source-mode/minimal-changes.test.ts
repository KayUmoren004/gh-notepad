import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { minimalChanges } from "./minimal-changes";

/** `before` edited by the changes, as CodeMirror would apply them, with the cursor at `cursor` mapped through. */
function apply(before: string, after: string, cursor = 0): { text: string; cursor: number } {
  const state = EditorState.create({ doc: before, selection: EditorSelection.cursor(cursor) });
  const next = state.update({ changes: minimalChanges(before, after) }).state;
  return { text: next.doc.toString(), cursor: next.selection.main.head };
}

const note = "# Plan\n\nFirst paragraph.\n\n- one\n- two\n\nLast paragraph.\n";

describe("minimal changes between two versions of a note", () => {
  test("an unchanged note needs no changes", () => {
    expect(minimalChanges(note, note)).toEqual([]);
  });

  test("the changes turn the old text into the new one", () => {
    const cases: [string, string][] = [
      ["", "Hello\n"],
      ["Hello\n", ""],
      [note, `Remote intro.\n\n${note}`],
      [note, note.replace("- two\n", "- two\n- three\n")],
      [note, note.replace("First paragraph.", "First paragraph, revised.").replace("Last", "Final")],
      [note, "Something else entirely"],
      ["a\nb", "a\nb\nc"],
      ["a\nb\n", "a\nb\nc\n"],
      ["a\nb\nc", "a\nc"],
      ["one\n\ntwo\n", "one\ntwo\n"],
      ["tab\tseparated\n", "tab\t\tseparated\n"],
      ["日本語の\nメモ\n", "日本語の\nノート\n"],
      ["same\nsame\nsame\n", "same\nsame\n"],
      ["x\n", "x\n\n\ny\n"],
    ];
    for (const [before, after] of cases) expect(apply(before, after).text).toBe(after);
  });

  test("a change elsewhere leaves the cursor on the same text", () => {
    const cursor = note.indexOf("one") + 2;
    const { text, cursor: moved } = apply(note, `Remote intro.\n\n${note.replace("Last", "Final")}`, cursor);
    expect(text.slice(moved - 2, moved + 1)).toBe("one");
  });

  test("an edit on the cursor's line touches only the changed characters", () => {
    const before = "The quick brown fox\n";
    const cursor = before.indexOf("fox");
    const { cursor: moved } = apply(before, "The quick, brown fox\n", cursor);
    expect(moved).toBe(cursor + 1);
  });

  test("separate edits are separate changes, so the text between them is never replaced", () => {
    const changes = minimalChanges(note, note.replace("First", "Opening").replace("Last", "Final"));
    expect(changes).toEqual([
      { from: note.indexOf("First"), to: note.indexOf("First") + "First".length, insert: "Opening" },
      { from: note.indexOf("Last"), to: note.indexOf("Last") + "Last".length, insert: "Final" },
    ]);
  });
});
