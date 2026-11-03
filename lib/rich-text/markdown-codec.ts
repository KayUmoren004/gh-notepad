import { type Extensions, getSchema, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import { Marked } from "marked";
import { micromark, parse, postprocess, preprocess } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { isAutolink, LIST_TYPES, MARKDOWN_SOURCE, SOFT_BREAK } from "./document-extensions";

/** One top-level block of a Markdown document and the whitespace before it. */
export interface SourceBlock {
  source: string;
  gapBefore: string;
  /**
   * The link or footnote definitions in the block, which other blocks need to
   * resolve their references. A block with definitions stays Markdown source.
   */
  definitions: string[];
}

export interface SplitDocument {
  blocks: SourceBlock[];
  /** Everything after the last block (normally the final newline). */
  trailing: string;
}

/** What GitHub shows for a Markdown document (micromark implements the same GFM spec as cmark-gfm). */
function renderOnGitHub(markdown: string): string {
  return micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()], allowDangerousHtml: true });
}

/** Tokens between blocks: line endings, blank lines and indentation. */
const BETWEEN_BLOCKS = new Set(["lineEnding", "lineEndingBlank", "linePrefix", "whitespace"]);

interface ListStyle {
  marker: string | null;
  spread: boolean;
}

/** A list's marker (`*`, `+`, `)` …) and whether blank lines separate its items, read from its source. */
function listStyleOf(source: string): ListStyle {
  const lines = source.split("\n");
  const first = /^( {0,3})([-*+]|\d{1,9}([.)]))(?=[ \t]|$)/.exec(lines[0]);
  if (!first) return { marker: null, spread: false };
  const item = new RegExp(`^ {${first[1].length}}(?:[-*+]|\\d{1,9}[.)])(?=[ \\t]|$)`);
  const spread = lines.some((line, index) => index > 0 && item.test(line) && lines[index - 1].trim() === "");
  return { marker: first[3] ?? first[2], spread };
}

/**
 * Tiptap's table Markdown without column padding, so a row's text doesn't
 * depend on the widest cell in its column and editing a cell changes one line.
 */
function compactTable(markdown: string): string {
  return markdown
    .split("\n")
    .map((line, index) => (index === 1 ? line.replace(/-{3,}/g, "---") : line.replace(/ {2,}(?=\|)/g, " ")))
    .join("\n");
}

/** Tiptap's list Markdown (`-` and `1.`, tight) in the list's own style. */
function applyListStyle(markdown: string, { marker, spread }: ListStyle): string {
  const lines: string[] = [];
  for (const line of markdown.split("\n")) {
    const item = /^(-|\d+\.)(?= |$)/.exec(line);
    if (!item) {
      lines.push(line);
      continue;
    }
    if (spread && lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(marker ? line.replace(/^-|^(\d+)\./, (_match, number?: string) => (number ? number + marker : marker)) : line);
  }
  return lines.join("\n");
}

/**
 * Converts between Markdown and rich text mode's document one top-level block
 * at a time, using Tiptap's Markdown handlers for the conversion and GitHub's
 * rendering to decide whether a block survives it.
 */
export class MarkdownCodec {
  readonly schema: Schema;
  private readonly manager: MarkdownManager;
  private readonly codeTypes: Set<string>;
  private readonly canonical = new WeakMap<ProseMirrorNode, string>();

  constructor(extensions: Extensions, schema: Schema = getSchema(extensions)) {
    this.schema = schema;
    this.codeTypes = new Set([
      ...Object.values(schema.nodes).filter((type) => type.spec.code).map((type) => type.name),
      ...Object.values(schema.marks).filter((type) => type.spec.code).map((type) => type.name),
    ]);
    // Its own marked instance: Tiptap registers tokenizers on the one it is given.
    const marked = new Marked({ gfm: true });
    this.manager = new MarkdownManager({ marked: marked as never, extensions });
    // Tiptap entity-encodes every `&`, `<` and `>`, so an edited "AT&T" would be
    // saved as "AT&amp;T". Escape only what would otherwise change meaning.
    Object.assign(this.manager, {
      encodeTextForMarkdown: (text: string, node: JSONContent, parent?: JSONContent) => this.encodeText(text, node, parent),
    });
  }

  /**
   * The document's top-level blocks as GitHub reads them (micromark, so block
   * boundaries follow the GFM spec rather than Tiptap's parser), and the
   * whitespace around them.
   */
  split(markdown: string): SplitDocument {
    const events = postprocess(parse({ extensions: [gfm()] }).document().write(preprocess()(markdown, undefined, true)));
    const blocks: SourceBlock[] = [];
    let gapStart = 0;
    let depth = 0;
    let current: { start: number; end: number; definitions: string[] } | null = null;

    for (const [kind, token] of events) {
      if (kind === "exit") {
        depth--;
        if (depth === 0 && current) {
          const source = markdown.slice(current.start, current.end).replace(/[ \t]+$/, "");
          blocks.push({ source, gapBefore: markdown.slice(gapStart, current.start), definitions: current.definitions });
          gapStart = current.start + source.length;
          current = null;
        }
        continue;
      }
      if (depth === 0 && !BETWEEN_BLOCKS.has(token.type)) {
        current = { start: token.start.offset, end: token.end.offset, definitions: [] };
        if (token.type === "gfmFootnoteDefinition") current.definitions.push(markdown.slice(token.start.offset, token.end.offset));
      } else if (depth === 1 && current && token.type === "definition") {
        current.definitions.push(markdown.slice(token.start.offset, token.end.offset));
      }
      depth++;
    }

    return { blocks, trailing: markdown.slice(gapStart) };
  }

  /**
   * The block as a rich text node, or null when rich text mode can't express it
   * faithfully: rewriting it would change what GitHub shows, or Tiptap would
   * read its rewritten form back differently.
   */
  toNode({ source, definitions }: SourceBlock, context: BlockContext): ProseMirrorNode | null {
    if (definitions.length) return null;
    const node = this.parse(source, context);
    if (!node) return null;
    const canonical = this.toMarkdown(node);
    if (!this.rendersAlike(source, canonical, context)) return null;
    const reread = this.parse(canonical, context);
    return reread?.eq(node) ? node : null;
  }

  /** A block kept as Markdown source. */
  sourceNode(source: string): ProseMirrorNode {
    return this.schema.node(MARKDOWN_SOURCE, null, source ? [this.schema.text(source)] : []);
  }

  /** The block as Tiptap writes it. */
  toMarkdown(node: ProseMirrorNode): string {
    let markdown = this.canonical.get(node);
    if (markdown === undefined) {
      if (node.type.name === MARKDOWN_SOURCE) {
        markdown = node.textContent;
      } else {
        markdown = this.manager.serialize({ type: "doc", content: [node.toJSON()] }).replace(/^\n+|\n+$/g, "");
        if (LIST_TYPES.has(node.type.name)) markdown = applyListStyle(markdown, node.attrs as ListStyle);
        if (node.type.name === "table") markdown = compactTable(markdown);
      }
      this.canonical.set(node, markdown);
    }
    return markdown;
  }

  /** Whether GitHub shows the two blocks the same, given the document's definitions. */
  rendersAlike(a: string, b: string, context: BlockContext): boolean {
    if (a === b) return true;
    const definitions = context.definitions ? `\n\n${context.definitions}` : "";
    return renderOnGitHub(a + definitions) === renderOnGitHub(b + definitions);
  }

  /** The definitions a document's blocks may refer to. */
  contextOf(blocks: SourceBlock[]): BlockContext {
    const definitions = blocks.flatMap((block) => block.definitions);
    return {
      linkDefinitions: definitions.filter((definition) => !definition.startsWith("[^")).join("\n"),
      definitions: definitions.join("\n\n"),
    };
  }

  private parse(source: string, context: BlockContext): ProseMirrorNode | null {
    try {
      const json = this.manager.parse(context.linkDefinitions ? `${source}\n\n${context.linkDefinitions}` : source);
      const content = (json.content ?? []).filter((child) => child.type);
      if (content.length !== 1) return null;
      const block = this.withSoftBreaks(content[0]);
      if (block.type && LIST_TYPES.has(block.type)) block.attrs = { ...block.attrs, ...listStyleOf(source) };
      const node = this.schema.nodeFromJSON(block);
      node.check();
      return node;
    } catch {
      return null;
    }
  }

  /** Newlines in paragraph text (soft line breaks) as soft-break nodes; code keeps its newlines. */
  private withSoftBreaks(node: JSONContent): JSONContent {
    if (!node.content || (node.type && this.codeTypes.has(node.type))) return node;
    const content = node.content.flatMap((child): JSONContent[] => {
      const inCode = (child.marks ?? []).some((mark) => this.codeTypes.has(mark.type));
      if (child.type !== "text" || inCode || !child.text?.includes("\n")) return [this.withSoftBreaks(child)];
      return child.text
        .split("\n")
        .flatMap((part, index) => [
          ...(index > 0 ? [{ type: SOFT_BREAK, marks: child.marks }] : []),
          ...(part ? [{ ...child, text: part }] : []),
        ]);
    });
    return { ...node, content };
  }

  private encodeText(text: string, node: JSONContent, parent?: JSONContent): string {
    const marks = node.marks ?? [];
    if ((parent?.type && this.codeTypes.has(parent.type)) || marks.some((mark) => this.codeTypes.has(mark.type))) return text;
    if (marks.some((mark) => mark.type === "link" && isAutolink(text, mark.attrs?.href ?? "", mark.attrs?.title))) return text;
    return text
      .replace(/[\\`*_[\]~]/g, "\\$&")
      .replace(/&(?=#?[a-z0-9]+;)/gi, "&amp;")
      .replace(/<(?=[a-z/!?])/gi, "&lt;");
  }
}

/** What a block needs from the rest of its document to be read correctly. */
export interface BlockContext {
  /** Link definitions, appended when parsing so references resolve. */
  linkDefinitions: string;
  /** Link and footnote definitions, appended when comparing renderings. */
  definitions: string;
}
