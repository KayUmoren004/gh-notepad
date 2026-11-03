import { isMap, isScalar, isSeq, parseDocument, Scalar, stringify, type Document, type Node } from "yaml";

/** What the app reads from, and writes to, one note file. */
export interface NoteFields {
  /** The note's stable identity, or `null` for a file written without one (outside the app). */
  id: string | null;
  tags: string[];
  /** ISO 8601 timestamps, as written in the frontmatter. */
  created: string | null;
  updated: string | null;
  /** The note's share link id while it is shared (ticket #14), or `null`. */
  share: string | null;
  /** When the note was moved to the Trash (ISO 8601), while it is there; `null` otherwise. */
  trashed: string | null;
  /** Everything after the frontmatter, exactly as it is in the file. */
  body: string;
}

/**
 * Changes to apply to a note file. A field left out, or given as `null`, keeps
 * whatever the file has; a field equal to what the file has changes nothing.
 * An empty `share` or `trashed` removes the key: a note is either shared or it
 * isn't, in the Trash or not.
 */
export type NoteChanges = { [Field in keyof NoteFields]?: NoteFields[Field] | null };

type MetaField = Exclude<keyof NoteFields, "body">;

/** The order the app writes its own keys in when a file has none. */
const META_FIELDS: readonly MetaField[] = ["id", "tags", "created", "updated", "share", "trashed"];

interface Parts {
  /** A byte order mark, kept as found. */
  bom: string;
  /** The opening `---` line with its line ending, or `""` when the file has no frontmatter. */
  open: string;
  /** The YAML between the fences. */
  source: string;
  /** The closing `---` or `...` line, with its line ending if it has one. */
  close: string;
  body: string;
}

/** Splits a file into frontmatter and body without changing a byte of either. */
function split(text: string): Parts {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const rest = text.slice(bom.length);
  const none: Parts = { bom, open: "", source: "", close: "", body: rest };

  const open = /^---[ \t]*\r?\n/.exec(rest);
  if (!open) return none;

  let index = open[0].length;
  for (;;) {
    const newline = rest.indexOf("\n", index);
    const lineEnd = newline === -1 ? rest.length : newline + 1;
    const line = rest.slice(index, lineEnd).replace(/\r?\n$/, "");
    if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) {
      return {
        bom,
        open: open[0],
        source: rest.slice(open[0].length, index),
        close: rest.slice(index, lineEnd),
        body: rest.slice(lineEnd),
      };
    }
    if (newline === -1) return none;
    index = lineEnd;
  }
}

function join({ bom, open, source, close, body }: Parts): string {
  return bom + open + source + close + body;
}

interface Frontmatter {
  doc: Document;
  /** False when the YAML is invalid or isn't a mapping: the app then leaves it exactly as it is. */
  editable: boolean;
}

function parse(source: string): Frontmatter {
  // Frontmatter is data: `yaml` never evaluates it, and unknown tags only warn.
  const doc = parseDocument(source, { version: "1.2", prettyErrors: false });
  const editable = doc.errors.length === 0 && (doc.contents === null || isMap(doc.contents));
  return { doc, editable };
}

function scalarText(node: unknown): string | null {
  if (!isScalar(node)) return null;
  const value = node.value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return null;
}

const NO_META = (): Omit<NoteFields, "body"> => ({ id: null, tags: [], created: null, updated: null, share: null, trashed: null });

function readMeta({ doc, editable }: Frontmatter): Omit<NoteFields, "body"> {
  const meta: Omit<NoteFields, "body"> = NO_META();
  if (!editable || !isMap(doc.contents)) return meta;

  meta.id = scalarText(doc.get("id", true));
  meta.share = scalarText(doc.get("share", true));
  meta.trashed = scalarText(doc.get("trashed", true));
  meta.created = scalarText(doc.get("created", true));
  meta.updated = scalarText(doc.get("updated", true));
  const tags = doc.get("tags", true);
  if (isSeq(tags)) {
    meta.tags = tags.items.map(scalarText).filter((tag): tag is string => tag !== null && tag !== "");
  } else {
    const single = scalarText(tags);
    if (single) meta.tags = [single];
  }
  return meta;
}

/** Reads a note file. Never throws: a file that isn't what the app writes still has a body. */
export function readNote(text: string): NoteFields {
  const parts = split(text);
  const meta = parts.open ? readMeta(parse(parts.source)) : NO_META();
  return { ...meta, body: parts.body };
}

function hasKey(frontmatter: Frontmatter | null, field: MetaField): boolean {
  return !!frontmatter && frontmatter.editable && isMap(frontmatter.doc.contents) && frontmatter.doc.has(field);
}

function sameValue(field: MetaField, current: Omit<NoteFields, "body">, next: string | string[]): boolean {
  const value = current[field];
  if (Array.isArray(next)) return Array.isArray(value) && value.length === next.length && value.every((v, i) => v === next[i]);
  return value === next;
}

/** A scalar the way YAML would write it, in the quoting style of `like` when there is one. */
function renderScalar(value: string, like?: Node | null): string {
  const type = isScalar(like) ? like.type : undefined;
  const quoted = type === Scalar.QUOTE_SINGLE || type === Scalar.QUOTE_DOUBLE;
  return stringify(value, { defaultStringType: quoted ? type : Scalar.PLAIN, lineWidth: 0 }).replace(/\n$/, "");
}

function renderTags(tags: readonly string[]): string {
  return `[${tags.map((tag) => renderScalar(tag)).join(", ")}]`;
}

/**
 * Applies metadata changes to frontmatter YAML. Values are spliced into the
 * source where they already are, so comments, spacing and every other key stay
 * byte-identical; only what changed is rewritten. An empty string removes the
 * key, with the line it was on.
 */
function applyMeta(source: string, eol: string, changes: Partial<Record<MetaField, string | string[]>>): string {
  const { doc } = parse(source);
  const splices: { start: number; end: number; text: string }[] = [];
  const appended: string[] = [];
  let rerender = false;

  for (const field of META_FIELDS) {
    const value = changes[field];
    if (value === undefined) continue;
    const node = isMap(doc.contents) ? doc.get(field, true) : undefined;
    const text = Array.isArray(value) ? renderTags(value) : renderScalar(value, node as Node | undefined);

    if (value === "") {
      const pair = isMap(doc.contents) ? doc.contents.items.find((item) => scalarText(item.key) === field) : undefined;
      const start = isScalar(pair?.key) ? pair.key.range?.[0] : undefined;
      if (start === undefined) continue;
      const lineEnd = source.indexOf("\n", start);
      splices.push({ start, end: lineEnd === -1 ? source.length : lineEnd + 1, text: "" });
    } else if (node === undefined) {
      appended.push(`${field}: ${text}${eol}`);
    } else if (isScalar(node) && node.range && !Array.isArray(value)) {
      splices.push({ start: node.range[0], end: node.range[1], text });
    } else if (isSeq(node) && node.flow && node.range) {
      splices.push({ start: node.range[0], end: node.range[1], text });
    } else {
      rerender = true;
    }
  }

  if (rerender || (appended.length > 0 && isMap(doc.contents) && doc.contents.flow)) {
    for (const field of META_FIELDS) {
      const value = changes[field];
      if (value === undefined) continue;
      if (value === "") doc.delete(field);
      else doc.set(field, Array.isArray(value) ? doc.createNode(value, { flow: true }) : value);
    }
    const rendered = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
    return eol === "\n" ? rendered : rendered.replace(/\r?\n/g, eol);
  }

  let result = source;
  for (const { start, end, text } of splices.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, start) + text + result.slice(end);
  }
  return result + appended.join("");
}

/**
 * Writes changes into a note file. Applying no changes, or only values the file
 * already has, returns the file unchanged, byte for byte. A file without
 * frontmatter gets one the first time metadata is written to it; frontmatter
 * the app can't safely edit (invalid YAML, or not a mapping) is kept as is.
 */
export function writeNote(text: string, changes: NoteChanges): string {
  const parts = split(text);
  const frontmatter = parts.open ? parse(parts.source) : null;
  const current = frontmatter ? readMeta(frontmatter) : NO_META();

  const metaChanges: Partial<Record<MetaField, string | string[]>> = {};
  for (const field of META_FIELDS) {
    const value = changes[field];
    if (value === undefined || value === null) continue;
    // An empty tag list and no `tags` key mean the same thing; so do an empty share id and no `share` key, an empty `trashed` likewise.
    if (value === "" && (field === "share" || field === "trashed")) {
      if (hasKey(frontmatter, field)) metaChanges[field] = value;
      continue;
    }
    if ((hasKey(frontmatter, field) || field === "tags") && sameValue(field, current, value)) continue;
    metaChanges[field] = value;
  }

  const next: Parts = { ...parts, body: changes.body ?? parts.body };
  if (Object.keys(metaChanges).length > 0) {
    if (!frontmatter) {
      next.open = "---\n";
      next.source = applyMeta("", "\n", metaChanges);
      next.close = "---\n";
    } else if (frontmatter.editable) {
      const eol = parts.open.endsWith("\r\n") ? "\r\n" : "\n";
      next.source = applyMeta(parts.source, eol, metaChanges);
    }
  }
  if (next.open && next.body !== "" && !/\n$/.test(next.close)) {
    next.close += next.open.endsWith("\r\n") ? "\r\n" : "\n";
  }
  return join(next);
}
