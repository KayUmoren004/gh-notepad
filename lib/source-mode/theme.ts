import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/**
 * Source mode's look, from the design tokens in `app/globals.css`: the note's
 * own text on the page background (no editor chrome, no gutter), 16 px so a
 * phone never zooms into it, and Markdown syntax in the muted colour.
 */
const editorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "var(--foreground)", fontSize: "1rem" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-sans)", lineHeight: "1.75", overflow: "visible" },
    ".cm-content": { padding: "0", caretColor: "var(--foreground)", overflowWrap: "anywhere" },
    ".cm-line": { padding: "0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
    ".cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--ring) 45%, transparent)" },
    ".cm-placeholder": { color: "var(--muted-foreground)" },
  },
  { dark: true },
);

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "600", letterSpacing: "-0.01em" },
  { tag: tags.heading1, fontSize: "1.5em" },
  { tag: tags.heading2, fontSize: "1.25em" },
  { tag: tags.heading3, fontSize: "1.125em" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", fontSize: "0.875em" },
  { tag: [tags.link, tags.url], color: "var(--code-title)" },
  { tag: tags.quote, color: "color-mix(in srgb, var(--foreground) 90%, transparent)" },
  { tag: [tags.processingInstruction, tags.labelName, tags.contentSeparator, tags.atom], color: "var(--muted-foreground)" },
  { tag: tags.comment, color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [tags.escape, tags.character], color: "var(--code-attribute)" },
  { tag: tags.string, color: "var(--code-string)" },
  { tag: tags.tagName, color: "var(--code-keyword)" },
  { tag: tags.attributeName, color: "var(--code-attribute)" },
  { tag: tags.attributeValue, color: "var(--code-string)" },
]);

/** The editor theme and Markdown highlighting for source mode. */
export const sourceTheme: Extension = [editorTheme, syntaxHighlighting(markdownHighlight)];
