import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { BlockContext, MarkdownCodec } from "./markdown-codec";

interface LoadedBlock {
  node: ProseMirrorNode;
  /** The block's text exactly as it was in the file. */
  source: string;
  /** The whitespace between the previous block (or the start of the file) and this one. */
  gapBefore: string;
}

const isEmptyParagraph = (node: ProseMirrorNode) => node.type.name === "paragraph" && node.childCount === 0;
const keyOf = (node: ProseMirrorNode) => `${node.type.name}\u0000${node.textContent}`;

/**
 * A note body as rich text mode loaded it. It remembers every top-level
 * block's original text, so serialising an edited document writes the
 * original bytes for each block the member didn't change, the original
 * whitespace between them, and only the changed lines of a changed block.
 */
export class MarkdownDocument {
  /** The editor document for the loaded Markdown. */
  readonly doc: ProseMirrorNode;
  private readonly byKey = new Map<string, number[]>();
  private readonly equalBlocks = new WeakMap<ProseMirrorNode, number[]>();
  private readonly patched = new WeakMap<ProseMirrorNode, { position: number; markdown: string }>();

  private constructor(
    private readonly codec: MarkdownCodec,
    private readonly blocks: LoadedBlock[],
    private readonly trailing: string,
    private readonly context: BlockContext,
    private readonly lineEnding: "\n" | "\r\n",
  ) {
    const { schema } = codec;
    this.doc = schema.node("doc", null, blocks.length ? blocks.map((block) => block.node) : [schema.node("paragraph")]);
    blocks.forEach((block, index) => {
      const key = keyOf(block.node);
      this.byKey.set(key, [...(this.byKey.get(key) ?? []), index]);
    });
  }

  static load(codec: MarkdownCodec, markdown: string): MarkdownDocument {
    const crlf = markdown.includes("\r\n") && !/\r(?!\n)|(?<!\r)\n/.test(markdown);
    const text = crlf ? markdown.replace(/\r\n/g, "\n") : markdown;
    // Mixed line endings can't be written back exactly from rich text, so that document stays whole, as source.
    const mixed = text.includes("\r");
    const pieces = mixed ? { blocks: [{ source: text, gapBefore: "", definitions: [] }], trailing: "" } : codec.split(text);
    const context = codec.contextOf(pieces.blocks);
    const blocks = pieces.blocks.map((block) => ({
      source: block.source,
      gapBefore: block.gapBefore,
      node: (!mixed && codec.toNode(block, context)) || codec.sourceNode(block.source),
    }));
    return new MarkdownDocument(codec, blocks, pieces.trailing, context, crlf ? "\r\n" : "\n");
  }

  /** The Markdown for an edited version of this document. */
  serialize(doc: ProseMirrorNode): string {
    const children: ProseMirrorNode[] = [];
    doc.forEach((child) => {
      if (!isEmptyParagraph(child)) children.push(child);
    });
    if (children.length === 0) return this.blocks.length ? "" : this.restore(this.trailing);

    // Unchanged blocks, matched in order where possible: their bytes are the original ones.
    const unchanged: (number | null)[] = [];
    const anchors: (number | null)[] = [];
    let last = -1;
    for (const child of children) {
      const equal = this.equalTo(child);
      const next = equal.find((index) => index > last);
      anchors.push(next ?? null);
      unchanged.push(next ?? equal[0] ?? null);
      if (next !== undefined) last = next;
    }

    // Changed blocks that took the place of as many loaded blocks keep those blocks' positions.
    const positions = [...anchors];
    for (let start = 0; start < children.length; start++) {
      if (anchors[start] !== null) continue;
      let end = start;
      while (end < children.length && anchors[end] === null) end++;
      const before = start > 0 ? (anchors[start - 1] as number) : -1;
      const after = end < children.length ? (anchors[end] as number) : this.blocks.length;
      if (end - start === after - before - 1) {
        for (let index = start; index < end; index++) positions[index] = before + 1 + index - start;
      }
      start = end;
    }

    const parts: string[] = [];
    children.forEach((child, index) => {
      parts.push(index === 0 ? this.leading : this.gapBetween(children, positions, index));
      const original = unchanged[index];
      const position = positions[index];
      parts.push(original !== null ? this.blocks[original].source : this.rewrite(child, position));
    });
    parts.push(this.blocks.length ? this.trailing : "\n");
    return this.restore(parts.join(""));
  }

  /** The document with every block as rich text mode writes it. */
  canonical(): string {
    return this.blocks.map((block) => this.codec.toMarkdown(block.node)).join("\n\n") + (this.blocks.length ? "\n" : "");
  }

  private get leading(): string {
    return this.blocks[0]?.gapBefore ?? "";
  }

  private gapBetween(children: ProseMirrorNode[], positions: (number | null)[], index: number): string {
    const previous = positions[index - 1];
    const current = positions[index];
    if (previous === null || current === null || current !== previous + 1) return "\n\n";
    const gap = this.blocks[current].gapBefore;
    // Without a blank line, two blocks only stay apart if they are still the kinds they were.
    const sameKinds =
      children[index - 1].type === this.blocks[previous].node.type && children[index].type === this.blocks[current].node.type;
    return gap.includes("\n\n") || sameKinds ? gap : "\n\n";
  }

  private equalTo(node: ProseMirrorNode): number[] {
    let equal = this.equalBlocks.get(node);
    if (!equal) {
      equal = (this.byKey.get(keyOf(node)) ?? []).filter((index) => this.blocks[index].node.eq(node));
      this.equalBlocks.set(node, equal);
    }
    return equal;
  }

  /**
   * A changed block. In place of a loaded block, the lines Tiptap's rewrite
   * leaves alone keep their original text, as long as GitHub still shows the
   * result the same as the full rewrite.
   */
  private rewrite(node: ProseMirrorNode, position: number | null): string {
    const canonical = this.codec.toMarkdown(node);
    if (position === null) return canonical;
    const cached = this.patched.get(node);
    if (cached?.position === position) return cached.markdown;

    const loaded = this.blocks[position];
    const source = loaded.source.split("\n");
    const before = this.codec.toMarkdown(loaded.node).split("\n");
    const after = canonical.split("\n");
    let markdown = canonical;
    if (source.length === before.length) {
      let start = 0;
      while (start < before.length && start < after.length && before[start] === after[start]) start++;
      let endBefore = before.length;
      let endAfter = after.length;
      while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
        endBefore--;
        endAfter--;
      }
      const patched = [...source.slice(0, start), ...after.slice(start, endAfter), ...source.slice(endBefore)].join("\n");
      if (this.codec.rendersAlike(patched, canonical, this.context)) markdown = patched;
    }
    this.patched.set(node, { position, markdown });
    return markdown;
  }

  private restore(markdown: string): string {
    return this.lineEnding === "\n" ? markdown : markdown.replace(/\n/g, "\r\n");
  }
}
