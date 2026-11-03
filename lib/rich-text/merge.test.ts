import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import { describe, expect, test } from "vitest";
import { getMarkdown, mergeMarkdown } from "@/lib/rich-text";
import { openInRichText, positionAfter, type } from "./test-support";

const note = "# Plan\n\nAlpha paragraph.\n\nBravo paragraph.\n\nCharlie paragraph.\n";

/** Opens `note` with the cursor just after `needle`. */
function openWithCursorAfter(markdown: string, needle: string): Editor {
  const editor = openInRichText(markdown);
  const position = positionAfter(editor, needle);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)));
  return editor;
}

describe("merging a remote change into the open note", () => {
  test("a remote change elsewhere appears, and typing continues where the member was typing", () => {
    const editor = openWithCursorAfter(note, "Bravo");
    type(editor, " two");

    mergeMarkdown(editor, "# Plan\n\nAlpha paragraph, edited remotely.\n\nBravo paragraph.\n\nCharlie paragraph.\n\nDelta.\n", note);
    type(editor, "!");

    expect(getMarkdown(editor)).toBe(
      "# Plan\n\nAlpha paragraph, edited remotely.\n\nBravo two! paragraph.\n\nCharlie paragraph.\n\nDelta.\n",
    );
  });

  test("blocks added above the cursor don't move it", () => {
    const editor = openWithCursorAfter(note, "Charlie");

    mergeMarkdown(editor, "# Plan\n\n- [ ] New task\n\nAlpha paragraph.\n\n> A quote\n\nBravo paragraph.\n\nCharlie paragraph.\n", note);
    type(editor, " (cursor)");

    expect(getMarkdown(editor)).toContain("Charlie (cursor) paragraph.");
  });

  test("a remote edit inside the paragraph being read keeps the cursor at the same text", () => {
    const editor = openWithCursorAfter(note, "Bra");

    mergeMarkdown(editor, "# Plan\n\nAlpha paragraph.\n\nThe Bravo paragraph, longer now.\n\nCharlie paragraph.\n", note);
    type(editor, "X");

    expect(getMarkdown(editor)).toContain("The BraXvo paragraph, longer now.");
  });

  test("where both changed the same lines, the member's typing is kept", () => {
    const editor = openWithCursorAfter(note, "Bravo");
    type(editor, " (mine)");

    mergeMarkdown(editor, "# Plan\n\nAlpha paragraph.\n\nBravo paragraph (theirs).\n\nCharlie paragraph, also theirs.\n", note);

    expect(getMarkdown(editor)).toBe("# Plan\n\nAlpha paragraph.\n\nBravo (mine) paragraph.\n\nCharlie paragraph, also theirs.\n");
  });

  test("the merged note keeps the remote Markdown byte-for-byte", () => {
    const editor = openInRichText(note);
    const remote = "# Plan\n\n* Alpha, now a _list_\n* With a second item\n\nBravo paragraph.\n\nCharlie paragraph.\n";

    mergeMarkdown(editor, remote, note);

    expect(getMarkdown(editor)).toBe(remote);
  });

  test("undo takes back the member's typing but not the remote change", () => {
    const editor = openWithCursorAfter(note, "Bravo");
    type(editor, " two");

    mergeMarkdown(editor, "# Plan\n\nAlpha paragraph, edited remotely.\n\nBravo paragraph.\n\nCharlie paragraph.\n", note);
    editor.commands.undo();

    expect(getMarkdown(editor)).toBe("# Plan\n\nAlpha paragraph, edited remotely.\n\nBravo paragraph.\n\nCharlie paragraph.\n");
  });

  test("the editor's own Markdown coming back leaves the document untouched", () => {
    const editor = openWithCursorAfter(note, "Bravo");
    type(editor, " two");
    const before = editor.state.doc;

    mergeMarkdown(editor, getMarkdown(editor), note);

    expect(editor.state.doc).toBe(before);
  });

  test("a remote change to a table cell keeps the cursor in another cell", () => {
    const table = "| Name | Count |\n| --- | --- |\n| Apples | 1 |\n| Pears | 2 |\n";
    const editor = openWithCursorAfter(table, "Pears");

    mergeMarkdown(editor, "| Name | Count |\n| --- | --- |\n| Apples | 10 |\n| Pears | 2 |\n", table);
    type(editor, "!");

    expect(getMarkdown(editor)).toBe("| Name | Count |\n| --- | --- |\n| Apples | 10 |\n| Pears! | 2 |\n");
  });
});
