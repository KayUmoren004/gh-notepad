import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Editor } from "@tiptap/core";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { richTextExtensions } from "@/lib/rich-text";

/** The corpus documents in `corpus/<group>/`, as `[file name, contents]` pairs. */
export function corpus(group: "gfm" | "preserved"): [string, string][] {
  const directory = fileURLToPath(new URL(`./corpus/${group}`, import.meta.url));
  return readdirSync(directory)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => [name, readFileSync(join(directory, name), "utf8")]);
}

/** Rich text mode on a note body, headless: the editor runs without a DOM. */
export function openInRichText(markdown: string): Editor {
  return new Editor({ extensions: richTextExtensions({ markdown }) });
}

/**
 * GitHub's rendering of a Markdown document, from micromark with its GFM
 * extensions (an implementation of the same spec as GitHub's cmark-gfm),
 * independent of the parser rich text mode uses.
 */
export function renderOnGitHub(markdown: string): string {
  return micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()], allowDangerousHtml: true });
}

/** The document position just after the first occurrence of `needle` in the editor's text. */
export function positionAfter(editor: Editor, needle: string): number {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isText && node.text?.includes(needle)) {
      found = pos + node.text.indexOf(needle) + needle.length;
      return false;
    }
    return true;
  });
  if (found === null) throw new Error(`"${needle}" is not in the document`);
  return found;
}

/** Types `text` at `position`, the way a keystroke reaches the editor. */
export function typeAt(editor: Editor, position: number, text: string): void {
  editor.view.dispatch(editor.state.tr.insertText(text, position));
}

/** Types `text` at the cursor. */
export function type(editor: Editor, text: string): void {
  const { from, to } = editor.state.selection;
  editor.view.dispatch(editor.state.tr.insertText(text, from, to));
}

/** The lines of `after` that differ from `before`, compared line by line from both ends. */
export function changedLines(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { removed: a.slice(start, endA), added: b.slice(start, endB) };
}
