import type { Editor, Extensions } from "@tiptap/core";
import { documentExtensions, MARKDOWN_SOURCE } from "./document-extensions";
import { MarkdownCodec } from "./markdown-codec";
import { MarkdownDocument } from "./markdown-document";
import { MarkdownDocumentExtension } from "./markdown-document-extension";

/**
 * Rich text mode's document: a note body in GitHub-Flavored Markdown, edited
 * as formatting. Unchanged blocks are written back byte-for-byte, and blocks
 * rich text mode can't express faithfully are kept as Markdown source.
 */

export { MARKDOWN_SOURCE } from "./document-extensions";
export { mergeMarkdown } from "./merge";

/** The editor extensions for a note body, loaded from `markdown`. */
export function richTextExtensions({ markdown }: { markdown: string }): Extensions {
  return [...documentExtensions(), MarkdownDocumentExtension.configure({ markdown })];
}

/** The note body as Markdown: original bytes for everything the member hasn't changed. */
export function getMarkdown(editor: Editor): string {
  return editor.storage.markdownDocument.document.serialize(editor.state.doc);
}

/** The blocks shown as Markdown source because rich text mode can't express them. */
export function markdownSourceBlocks(editor: Editor): string[] {
  const sources: string[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name === MARKDOWN_SOURCE) sources.push(node.textContent);
  });
  return sources;
}

/** The Markdown rich text mode would write for `markdown` if every block were rewritten. */
export function normalizeMarkdown(markdown: string): string {
  return MarkdownDocument.load(new MarkdownCodec(documentExtensions()), markdown).canonical();
}
