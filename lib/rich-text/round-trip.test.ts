import { describe, expect, test } from "vitest";
import { getMarkdown, markdownSourceBlocks, normalizeMarkdown } from "@/lib/rich-text";
import { corpus, openInRichText, renderOnGitHub } from "./test-support";

/*
 * The round-trip corpus, and the gate for the editor choice (ticket #7).
 *
 * Tiptap 3 + @tiptap/markdown alone does not reproduce these documents: its
 * serializer writes one canonical syntax (setext headings become ATX, `_em_`
 * becomes `*em*`, `*` bullets become `-`, tables are re-padded), and it loses
 * HTML, link definitions, footnotes and named entities outright. Milkdown's
 * remark-stringify normalises the same way, so neither editor passes a raw
 * `serialize(parse(x)) === x`. Rich text mode therefore keeps every block's
 * original text and writes it back unless the member changed that block, and
 * the gate is that Tiptap can represent every GFM construct faithfully when a
 * block *is* rewritten: GitHub renders the rewritten document identically.
 * Tiptap passes with the fixes in this module (inline images, line-start and
 * entity escaping, autolinks, fence length); constructs it can't express are
 * kept as editable Markdown source blocks instead.
 */

describe.each(corpus("gfm"))("GFM corpus: %s", (_name, markdown) => {
  test("loads and serialises without edits byte-for-byte", () => {
    expect(getMarkdown(openInRichText(markdown))).toBe(markdown);
  });

  test("shows every block as rich text", () => {
    expect(markdownSourceBlocks(openInRichText(markdown))).toEqual([]);
  });

  test("renders the same on GitHub when every block is rewritten by rich text mode", () => {
    expect(renderOnGitHub(normalizeMarkdown(markdown))).toBe(renderOnGitHub(markdown));
  });
});

describe("constructs rich text mode can't express", () => {
  const preserved = Object.fromEntries(corpus("preserved"));

  test.each(Object.keys(preserved))("%s round-trips byte-for-byte", (name) => {
    expect(getMarkdown(openInRichText(preserved[name]))).toBe(preserved[name]);
  });

  test("raw HTML blocks and inline HTML are kept as Markdown source", () => {
    const editor = openInRichText(preserved["html.md"]);

    // An HTML block ends at a blank line, so the paragraph inside <details> stays rich text.
    expect(markdownSourceBlocks(editor)).toEqual([
      "<details>\n<summary>Click to expand</summary>",
      "</details>",
      "Press <kbd>Ctrl</kbd> + <kbd>K</kbd> to search.",
      "<!-- A comment only visible in the source -->",
    ]);
  });

  test("linked images and checkboxes in ordered lists are kept as Markdown source", () => {
    expect(markdownSourceBlocks(openInRichText(preserved["nested-constructs.md"]))).toEqual([
      "[![A linked image](attachments/thumb.png)](https://example.com/full.png)",
      "1. [ ] Ordered with a checkbox",
    ]);
  });

  test("link definitions and footnotes are kept as Markdown source", () => {
    // The reference link resolves through the definitions, so its paragraph stays rich text;
    // the footnote reference has no rich text equivalent.
    expect(markdownSourceBlocks(openInRichText(preserved["references-and-footnotes.md"]))).toEqual([
      "A claim that needs a source.[^source]",
      '[docs]: https://example.com/docs "Documentation"\n[collapsed one]: https://example.com/collapsed',
      "[^source]: The footnote that backs the claim.",
    ]);
  });

  test("named entities are kept as Markdown source; the rest stays rich text", () => {
    expect(markdownSourceBlocks(openInRichText(preserved["entities.md"]))).toEqual([
      "Copyright &copy; 2026, written&nbsp;together, &#8212; with an em dash.",
    ]);
  });
});

describe("whitespace and line endings", () => {
  test.each([
    ["an empty note", ""],
    ["only blank lines", "\n\n"],
    ["no trailing newline", "# Title\n\nLast line"],
    ["leading blank lines", "\n\nStarts lower down.\n"],
    ["several trailing newlines", "Text\n\n\n"],
    ["Windows line endings", "# Title\r\n\r\nFirst line\r\nsecond line\r\n\r\n- item\r\n"],
    ["tabs", "-\tTab after the marker\n\n\tIndented code with a tab\n"],
    ["a byte order mark", "﻿# Title\n"],
  ])("%s round-trips byte-for-byte", (_name, markdown) => {
    expect(getMarkdown(openInRichText(markdown))).toBe(markdown);
  });
});
