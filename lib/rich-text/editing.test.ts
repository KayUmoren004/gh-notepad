import { describe, expect, test } from "vitest";
import { getMarkdown } from "@/lib/rich-text";
import { changedLines, corpus, openInRichText, positionAfter, type, typeAt } from "./test-support";

const note = Object.fromEntries(corpus("gfm"))["representative-note.md"];

describe("editing a note in rich text mode", () => {
  test("editing one paragraph changes only that paragraph's lines in the saved file", () => {
    const editor = openInRichText(note);

    typeAt(editor, positionAfter(editor, "everything else waits."), " Even the docs.");

    // The paragraph's first line keeps its `_main_` even though Tiptap writes `*main*`.
    expect(changedLines(note, getMarkdown(editor))).toEqual({
      removed: ["**beta**, so everything else waits."],
      added: ["**beta**, so everything else waits. Even the docs."],
    });
  });

  test("ticking a task changes only that task's line", () => {
    const editor = openInRichText(note);
    let taskItem = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "taskItem" && node.textContent === "Email the beta testers") taskItem = pos;
    });

    editor.view.dispatch(editor.state.tr.setNodeAttribute(taskItem, "checked", true));

    expect(changedLines(note, getMarkdown(editor))).toEqual({
      removed: ["- [ ] Email the beta testers"],
      added: ["- [x] Email the beta testers"],
    });
  });

  test("editing a nested item keeps the list's own markers and indentation", () => {
    const editor = openInRichText(note);

    typeAt(editor, positionAfter(editor, "Check with support"), " and sales");

    expect(changedLines(note, getMarkdown(editor))).toEqual({
      removed: ["    * Check with support"],
      added: ["    * Check with support and sales"],
    });
  });

  test("editing a line keeps its other syntax as written", () => {
    const editor = openInRichText("Some _emphasis_ and __strong__ text.\n");

    typeAt(editor, positionAfter(editor, " text"), " here");

    expect(getMarkdown(editor)).toBe("Some _emphasis_ and __strong__ text here.\n");
  });

  test("a new paragraph is added without touching its neighbours", () => {
    const editor = openInRichText(note);
    const end = editor.state.doc.content.size;

    editor.view.dispatch(editor.state.tr.insert(end, editor.schema.node("paragraph", null, [editor.schema.text("P.S. Thanks all.")])));

    expect(getMarkdown(editor)).toBe(`${note.trimEnd()}\n\nP.S. Thanks all.\n`);
  });

  test("deleting a block removes only its lines", () => {
    const editor = openInRichText("First.\n\nSecond.\n\nThird.\n");
    const second = editor.state.doc.child(0).nodeSize;

    editor.view.dispatch(editor.state.tr.delete(second, second + editor.state.doc.child(1).nodeSize));

    expect(getMarkdown(editor)).toBe("First.\n\nThird.\n");
  });

  test("undoing an edit restores the original bytes", () => {
    const editor = openInRichText(note);

    typeAt(editor, positionAfter(editor, "Ship small"), ", ship safe");
    editor.commands.undo();

    expect(getMarkdown(editor)).toBe(note);
  });

  test("text typed into a new note is saved as Markdown", () => {
    const editor = openInRichText("");

    type(editor, "First thought");

    expect(getMarkdown(editor)).toBe("First thought\n");
  });

  test("typed characters that look like Markdown stay text", () => {
    const editor = openInRichText("");

    type(editor, "1. not a list, *not emphasis*, AT&T & <b>");

    expect(getMarkdown(editor)).toBe("1\\. not a list, \\*not emphasis\\*, AT&T & &lt;b>\n");
  });
});
