import type { Editor } from "@tiptap/core";
import type { Fragment, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { diff3Merge, diffIndices } from "node-diff3";
import { MarkdownDocument } from "./markdown-document";

/** Line-based 3-way merge of two versions of `base`; where both changed the same lines, `ours` wins. */
function mergeLines(ours: string, base: string, theirs: string): string {
  const regions = diff3Merge(ours.split("\n"), base.split("\n"), theirs.split("\n"), { excludeFalseConflicts: true });
  return regions.flatMap((region) => region.ok ?? region.conflict?.a ?? []).join("\n");
}

const carriesMarkdown = (node: ProseMirrorNode) => !(node.type.name === "paragraph" && node.childCount === 0);
const keyOf = (node: ProseMirrorNode) => JSON.stringify(node.toJSON());

/** Beyond this many characters, a changed textblock is replaced as one range rather than diffed. */
const MAX_INLINE_DIFF = 20_000;

/**
 * Edits that turn one node into another, applied to `tr` from the end of the
 * node backwards so earlier positions stay valid. Content the two share is
 * never replaced, so positions in it (the cursor among them) map through.
 */
function patchNode(tr: Transaction, pos: number, a: ProseMirrorNode, b: ProseMirrorNode): void {
  if (a.eq(b)) return;
  if (a.type !== b.type || a.isLeaf || b.isLeaf) {
    tr.replaceWith(pos, pos + a.nodeSize, b);
    return;
  }
  if (!a.hasMarkup(b.type, b.attrs, b.marks)) tr.setNodeMarkup(pos, undefined, b.attrs, b.marks);
  if (a.isTextblock) patchInline(tr, pos + 1, a.content, b.content);
  else patchChildren(tr, pos + 1, a.content, b.content);
}

function patchChildren(tr: Transaction, start: number, a: Fragment, b: Fragment): void {
  const offsets: number[] = [];
  a.forEach((_child, offset) => offsets.push(start + offset));
  offsets.push(start + a.size);
  const aChildren: ProseMirrorNode[] = [];
  const bChildren: ProseMirrorNode[] = [];
  a.forEach((child) => aChildren.push(child));
  b.forEach((child) => bChildren.push(child));

  for (const hunk of diffIndices(aChildren.map(keyOf), bChildren.map(keyOf)).reverse()) {
    const [aStart, aLength] = hunk.buffer1;
    const [bStart, bLength] = hunk.buffer2;
    if (aLength === bLength) {
      for (let index = aLength - 1; index >= 0; index--) {
        patchNode(tr, offsets[aStart + index], aChildren[aStart + index], bChildren[bStart + index]);
      }
    } else {
      tr.replaceWith(offsets[aStart], offsets[aStart + aLength], bChildren.slice(bStart, bStart + bLength));
    }
  }
}

/** Inline content as one key per position: a UTF-16 unit of text with its marks, or an inline node. */
function inlineKeys(content: Fragment): string[] {
  const keys: string[] = [];
  content.forEach((node) => {
    if (!node.isText) {
      keys.push(keyOf(node));
      return;
    }
    const marks = JSON.stringify(node.marks.map((mark) => mark.toJSON()));
    const text = node.text ?? "";
    for (let index = 0; index < text.length; index++) keys.push(`${text[index]}\u0000${marks}`);
  });
  return keys;
}

function patchInline(tr: Transaction, start: number, a: Fragment, b: Fragment): void {
  if (a.size + b.size > MAX_INLINE_DIFF) {
    tr.replaceWith(start, start + a.size, b);
    return;
  }
  for (const hunk of diffIndices(inlineKeys(a), inlineKeys(b)).reverse()) {
    const [aStart, aLength] = hunk.buffer1;
    const [bStart, bLength] = hunk.buffer2;
    const from = start + aStart;
    if (bLength === 0) tr.delete(from, from + aLength);
    else tr.replaceWith(from, from + aLength, b.cut(bStart, bStart + bLength));
  }
}

/**
 * Turns `doc` into `next`: top-level blocks the two share stay untouched,
 * changed blocks paired one to one are patched, and the rest are replaced.
 * Empty paragraphs carry no Markdown, so they stay where the member put them.
 */
function transform(tr: Transaction, doc: ProseMirrorNode, next: ProseMirrorNode): Transaction {
  const current: { node: ProseMirrorNode; pos: number }[] = [];
  doc.forEach((node, pos) => {
    if (carriesMarkdown(node)) current.push({ node, pos });
  });
  const wanted: ProseMirrorNode[] = [];
  next.forEach((node) => {
    if (carriesMarkdown(node)) wanted.push(node);
  });

  for (const hunk of diffIndices(current.map(({ node }) => keyOf(node)), wanted.map(keyOf)).reverse()) {
    const [aStart, aLength] = hunk.buffer1;
    const [bStart, bLength] = hunk.buffer2;
    const nodes = wanted.slice(bStart, bStart + bLength);
    if (aLength === 0) {
      const after = current[aStart - 1];
      tr.insert(after ? after.pos + after.node.nodeSize : 0, nodes);
    } else if (aLength === bLength) {
      for (let index = aLength - 1; index >= 0; index--) {
        const { node, pos } = current[aStart + index];
        patchNode(tr, pos, node, nodes[index]);
      }
    } else {
      const last = current[aStart + aLength - 1];
      tr.replaceWith(current[aStart].pos, last.pos + last.node.nodeSize, nodes);
    }
  }
  return tr;
}

function sameBlocks(a: ProseMirrorNode, b: ProseMirrorNode): boolean {
  const blocks = (doc: ProseMirrorNode) => {
    const found: ProseMirrorNode[] = [];
    doc.forEach((node) => {
      if (carriesMarkdown(node)) found.push(node);
    });
    return found;
  };
  const [left, right] = [blocks(a), blocks(b)];
  return left.length === right.length && left.every((node, index) => node.eq(right[index]));
}

/**
 * Merges a change made elsewhere into the open editor. `base` is the Markdown
 * the editor and the note last agreed on: what was typed since then is kept,
 * and where it and the incoming change touched the same lines, the typing
 * wins. Only what differs is replaced, outside the undo history, so the
 * cursor, the selection and the member's own undo steps survive.
 */
export function mergeMarkdown(editor: Editor, incoming: string, base: string): void {
  const storage = editor.storage.markdownDocument;
  const { doc } = editor.state;
  const current = storage.document.serialize(doc);
  if (incoming === current) return;

  const target = current === base ? incoming : mergeLines(current, base, incoming);
  const next = MarkdownDocument.load(storage.codec, target);

  let tr = transform(editor.state.tr, doc, next.doc);
  // Patching can only fail to reach `next` if ProseMirror had to fit content differently; replace it all then.
  if (!sameBlocks(tr.doc, next.doc)) tr = editor.state.tr.replaceWith(0, doc.content.size, next.doc.content);

  storage.document = next;
  if (tr.docChanged) editor.view.dispatch(tr.setMeta("addToHistory", false));
}
