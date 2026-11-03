import { describe, expect, test } from "vitest";
import { cursorAnchor, findAnchor, type CursorLocation } from "./cursor-anchor";

// The same note as rich text mode's textblocks and as source mode's lines.
const blocks = [
  "Weekly planning",
  "The release is in beta, so everything else waits.",
  "Ship small, ship often. Always",
  "Email the beta testers",
  "Check with support",
  "const answer = 42;\nconsole.log(answer);",
  "Thanks all.",
];
const lines = [
  "# Weekly planning",
  "",
  "The release is in **beta**, so",
  "everything else waits.",
  "",
  "> Ship small, ship often.",
  "> Always",
  "",
  "- [ ] Email the beta testers",
  "    * Check with support",
  "",
  "```js",
  "const answer = 42;",
  "console.log(answer);",
  "```",
  "",
  "Thanks all.",
  "",
];

const at = (texts: string[], block: number, offset: number): CursorLocation => ({ blocks: texts, block, offset });

describe("carrying the cursor between rich text mode and source mode", () => {
  test("a cursor in a heading lands after the same word in the heading's source line", () => {
    const anchor = cursorAnchor(at(blocks, 0, "Weekly".length));
    expect(findAnchor(lines, anchor)).toEqual({ block: 0, offset: "# Weekly".length });
  });

  test("a cursor in the second source line of a paragraph lands on that line, not the first", () => {
    const anchor = cursorAnchor(at(blocks, 1, blocks[1].indexOf("else")));
    expect(findAnchor(lines, anchor)).toEqual({ block: 3, offset: "everything ".length });
  });

  test("formatting marks around a word don't throw the match off", () => {
    const anchor = cursorAnchor(at(blocks, 1, blocks[1].indexOf("beta") + "beta".length));
    expect(findAnchor(lines, anchor)).toEqual({ block: 2, offset: "The release is in **beta".length });
  });

  test("a cursor at the start of a block lands at the start of that block's text", () => {
    const anchor = cursorAnchor(at(blocks, 3, 0));
    expect(findAnchor(lines, anchor)).toEqual({ block: 8, offset: "- [ ] ".length });
  });

  test("the same place is found on the way back", () => {
    const anchor = cursorAnchor(at(lines, 9, "    * Check".length));
    expect(findAnchor(blocks, anchor)).toEqual({ block: 4, offset: "Check".length });
  });

  test("a cursor inside a code block finds its line", () => {
    const anchor = cursorAnchor(at(blocks, 5, blocks[5].indexOf("console") + "console".length));
    expect(findAnchor(lines, anchor)).toEqual({ block: 13, offset: "console".length });
  });

  test("with no words to go by, the cursor keeps its relative place in the note", () => {
    const anchor = cursorAnchor(at(["", "", ""], 2, 0));
    expect(findAnchor(lines, anchor)).toEqual({ block: lines.length - 1, offset: 0 });
    expect(findAnchor([], anchor)).toEqual({ block: 0, offset: 0 });
  });

  test("between lines with the same words, the nearer one wins", () => {
    const repeated = ["- item", "- item", "- item", "- item"];
    expect(findAnchor(repeated, cursorAnchor(at(["item", "item", "item", "item"], 3, 4)))).toEqual({ block: 3, offset: 6 });
    expect(findAnchor(repeated, cursorAnchor(at(["item", "item", "item", "item"], 0, 0)))).toEqual({ block: 0, offset: 2 });
  });

  test("non-Latin words are words too", () => {
    const anchor = cursorAnchor(at(["週次の計画", "小さく出荷する"], 1, 3));
    expect(findAnchor(["# 週次の計画", "", "小さく出荷する"], anchor)).toEqual({ block: 2, offset: 3 });
  });
});
