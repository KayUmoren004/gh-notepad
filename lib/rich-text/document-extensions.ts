import { type Extensions, Node, type JSONContent } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Image } from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { BulletList, OrderedList, TaskItem, TaskList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import { TableKit } from "@tiptap/extension-table";
import HardBreak from "@tiptap/extension-hard-break";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";

/**
 * The nodes and marks of rich text mode: GitHub-Flavored Markdown and nothing
 * Markdown can't express (ADR 0001), with Markdown handlers that keep the
 * meaning of a block when Tiptap rewrites it.
 */

/** The node holding Markdown rich text mode can't express, shown and edited as source. */
export const MARKDOWN_SOURCE = "markdownSource";

export const lowlight = createLowlight(common);

const textOf = (node: JSONContent): string => (node.content ?? []).map((child) => child.text ?? "").join("");

/**
 * Markdown rich text mode can't show as formatting (raw HTML, link
 * definitions, footnotes, …), kept byte-for-byte and edited as plain text.
 */
const MarkdownSource = Node.create({
  name: MARKDOWN_SOURCE,
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,

  parseHTML() {
    return [{ tag: "pre[data-markdown-source]", preserveWhitespace: "full" }];
  },

  renderHTML() {
    return ["pre", { "data-markdown-source": "", spellcheck: "false" }, ["code", 0]];
  },

  renderMarkdown: (node) => textOf(node),
});

/** Escapes what would start a different block at the beginning of a line of paragraph text. */
function escapeLineStarts(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)(#{1,6})(?=\s|$)/, "$1\\$2")
        .replace(/^(\s*)>/, "$1\\>")
        .replace(/^(\s*)([-+])(?=\s|$)/, "$1\\$2")
        .replace(/^(\s*)(\d{1,9})([.)])(?=\s|$)/, "$1$2\\$3")
        .replace(/^(\s*)(=+\s*)$/, "$1\\$2")
        .replace(/^(\s*)-(\s*-){2,}\s*$/, (match, indent: string) => `${indent}\\${match.slice(indent.length)}`),
    )
    .join("\n");
}

/** Images stay inline inside their paragraph, as they are in Markdown. */
const GfmParagraph = Paragraph.extend({
  parseMarkdown: (token, helpers) => helpers.createNode("paragraph", undefined, helpers.parseInline(token.tokens ?? [])),
  // An empty paragraph has no Markdown; the blank lines around it are the document's.
  renderMarkdown: (node, helpers) => (node.content?.length ? escapeLineStarts(helpers.renderChildren(node.content)) : ""),
});

/** A backslash survives editors that strip trailing spaces; two spaces don't. */
const GfmHardBreak = HardBreak.extend({ renderMarkdown: () => "\\\n" });

/** A link whose text is its own absolute URL or email address, written `<…>` in Markdown. */
export function isAutolink(text: string, href: string, title?: string | null): boolean {
  if (title) return false;
  if (href === `mailto:${text}`) return /^[^\s<>@]+@[^\s<>@]+$/.test(text);
  return href === text && /^[a-z][a-z0-9+.-]{1,31}:[^\s<>]*$/i.test(href);
}

const GfmLink = Link.extend({
  // Marks render around a placeholder; `meta.markText` is the text the link spans.
  renderMarkdown: (node, helpers, context) => {
    const href: string = node.attrs?.href ?? "";
    const title: string = node.attrs?.title ?? "";
    const text = helpers.renderChildren(node);
    const markText = typeof context?.meta?.markText === "string" ? context.meta.markText : null;
    if (markText !== null && isAutolink(markText, href, title)) return `<${text}>`;
    const destination = /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, encodeURIComponent)}>` : href;
    return title ? `[${text}](${destination} "${title.replace(/"/g, '\\"')}")` : `[${text}](${destination})`;
  },
});

/** Fences long enough that a fence inside the code can't close the block. */
const GfmCodeBlock = CodeBlockLowlight.extend({
  renderMarkdown: (node) => {
    const code = textOf(node);
    const longestRun = Math.max(2, ...[...code.matchAll(/^ {0,3}(`{3,}|~{3,})/gm)].map((match) => match[1].length));
    const fence = "`".repeat(longestRun + 1);
    const language: string = node.attrs?.language ?? "";
    return code ? `${fence}${language}\n${code}\n${fence}` : `${fence}${language}\n${fence}`;
  },
}).configure({ lowlight, defaultLanguage: null });

const GfmImage = Image.configure({ inline: true, allowBase64: true });

/** The list types whose Markdown style (marker and looseness) is kept. */
export const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

/**
 * How a list was written: its bullet character or ordered delimiter, and
 * whether items are separated by blank lines. Two lists written with
 * different markers are different lists in Markdown, and a loose list
 * renders differently from a tight one, so both survive a rewrite.
 */
const listStyle = {
  marker: { default: null, rendered: false, keepOnSplit: true },
  spread: { default: false, rendered: false, keepOnSplit: true },
};

const GfmBulletList = BulletList.extend({
  addAttributes() {
    return { ...this.parent?.(), ...listStyle };
  },
});
const GfmOrderedList = OrderedList.extend({
  addAttributes() {
    return { ...this.parent?.(), ...listStyle };
  },
});
const GfmTaskList = TaskList.extend({
  addAttributes() {
    return { ...this.parent?.(), ...listStyle };
  },
});

/** The document's extensions, shared by the editor and the headless codec. */
export function documentExtensions(): Extensions {
  return [
    StarterKit.configure({
      paragraph: false,
      hardBreak: false,
      codeBlock: false,
      link: false,
      underline: false,
      bulletList: false,
      orderedList: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    GfmParagraph,
    GfmHardBreak,
    GfmLink.configure({ openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https" }),
    GfmCodeBlock,
    GfmImage,
    GfmBulletList,
    GfmOrderedList,
    GfmTaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    MarkdownSource,
  ];
}
