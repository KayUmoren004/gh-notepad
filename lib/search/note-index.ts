import MiniSearch, { type SearchOptions } from "minisearch";
import { notebookName } from "@/lib/notebook-tree";
import { highlight, snippetOf, tagSegments, type Segment } from "./snippet";

/** The fields of a note the index reads; `Note` from the device store satisfies it. */
export interface SearchableNote {
  id: string;
  /** The notebook's id, `owner/repo`. */
  notebook: string;
  /** `""` at the top level of the notebook. */
  folder: string;
  title: string;
  body: string;
  tags: readonly string[];
}

export interface SearchResult {
  id: string;
  notebook: string;
  folder: string;
  title: string;
  /** Whether the title matched (`title`, listed first) or only the text, tags or folder (`text`). */
  kind: "title" | "text";
  /** Where the note is: the notebook's name, then its folders. */
  path: string[];
  /** The title with its matched words marked. */
  titleSegments: Segment[];
  /** The first matching line of the body, or the tags, with the matches marked; `null` when only the title matched. */
  snippet: Segment[] | null;
}

export interface NoteIndex {
  /** How many notes are indexed. */
  readonly size: number;
  has(id: string): boolean;
  add(note: SearchableNote): void;
  /** Re-indexes a note; adds it if it wasn't there. */
  replace(note: SearchableNote): void;
  remove(id: string): void;
  /**
   * Brings the index in line with the device store's notes, touching only what
   * changed: a note is re-indexed when its object is a new one (the store keeps
   * unchanged notes' identity) and its searchable text differs.
   */
  update(notes: ReadonlyMap<string, SearchableNote>): void;
  /** Title matches first (by prefix, tolerating a typo), then matches in the text, tags or folder. */
  search(query: string, options?: { limit?: number }): SearchResult[];
}

const FIELDS = ["title", "body", "tags", "folder"] as const;
type Field = (typeof FIELDS)[number];

const DEFAULT_LIMIT = 50;

const sameText = (a: SearchableNote, b: SearchableNote) =>
  a.title === b.title &&
  a.body === b.body &&
  a.folder === b.folder &&
  a.notebook === b.notebook &&
  a.tags.length === b.tags.length &&
  a.tags.every((tag, index) => tag === b.tags[index]);

const pathOf = (note: SearchableNote) => [notebookName(note.notebook), ...(note.folder ? note.folder.split("/") : [])];

/** The terms of a result that matched in `field`. */
function termsIn(match: Record<string, string[]>, field: Field): string[] {
  return Object.entries(match)
    .filter(([, fields]) => fields.includes(field))
    .map(([term]) => term);
}

/** A client-side full-text index over notes, built on MiniSearch. */
export function createNoteIndex(): NoteIndex {
  const notes = new Map<string, SearchableNote>();
  const mini = new MiniSearch<SearchableNote>({
    fields: [...FIELDS],
    idField: "id",
    extractField: (note, field) => (field === "tags" ? note.tags.join(" ") : String(note[field as keyof SearchableNote])),
  });

  const add = (note: SearchableNote) => {
    notes.set(note.id, note);
    mini.add(note);
  };
  const replace = (note: SearchableNote) => {
    if (!notes.has(note.id)) return add(note);
    notes.set(note.id, note);
    mini.replace(note);
  };
  const remove = (id: string) => {
    if (!notes.delete(id)) return;
    mini.discard(id);
  };

  const resultOf = (note: SearchableNote, kind: SearchResult["kind"], terms: string[], match: Record<string, string[]>): SearchResult => {
    let snippet: Segment[] | null = null;
    if (kind === "text") {
      const inBody = termsIn(match, "body");
      const inTags = termsIn(match, "tags");
      snippet = (inBody.length > 0 ? snippetOf(note.body, inBody) : null) ?? (inTags.length > 0 ? tagSegments(note.tags, inTags) : null);
    }
    return {
      id: note.id,
      notebook: note.notebook,
      folder: note.folder,
      title: note.title,
      kind,
      path: pathOf(note),
      titleSegments: highlight(note.title, terms),
      snippet,
    };
  };

  return {
    get size() {
      return notes.size;
    },
    has: (id) => notes.has(id),
    add,
    replace,
    remove,
    update(next) {
      for (const id of [...notes.keys()]) if (!next.has(id)) remove(id);
      for (const [id, note] of next) {
        const indexed = notes.get(id);
        if (indexed === note) continue;
        if (indexed && sameText(indexed, note)) {
          notes.set(id, note);
          continue;
        }
        replace(note);
      }
    },
    search(query, { limit = DEFAULT_LIMIT } = {}) {
      const trimmed = query.trim();
      if (!trimmed || limit <= 0) return [];
      const shared: SearchOptions = { prefix: true, combineWith: "AND" };
      const results: SearchResult[] = [];
      const seen = new Set<string>();
      for (const hit of mini.search(trimmed, { ...shared, fields: ["title"], fuzzy: 0.2 })) {
        if (results.length >= limit) return results;
        const note = notes.get(hit.id as string);
        if (!note) continue;
        seen.add(note.id);
        results.push(resultOf(note, "title", hit.terms, hit.match));
      }
      for (const hit of mini.search(trimmed, { ...shared, boost: { title: 2, tags: 1.5 } })) {
        if (results.length >= limit) break;
        const note = notes.get(hit.id as string);
        if (!note || seen.has(note.id)) continue;
        results.push(resultOf(note, "text", hit.terms, hit.match));
      }
      return results;
    },
  };
}
