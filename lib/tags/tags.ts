/** The fields of a note tags read; `Note` from the device store satisfies it. */
export interface TaggedNote {
  id: string;
  tags: readonly string[];
  /** When the note was created: the oldest note's casing of a tag is the one kept. */
  created: string | null;
}

/** One tag across every notebook on the device. */
export interface TagEntry {
  /** What the tag matches on: `tagKey(name)`. */
  key: string;
  /** The tag as shown: the casing first used. */
  name: string;
  /** The notes carrying the tag. */
  count: number;
  noteIds: string[];
}

export interface TagIndex {
  /** Every tag, most used first, then by name. */
  tags: TagEntry[];
  byKey: ReadonlyMap<string, TagEntry>;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const byName = (a: TagEntry, b: TagEntry) => collator.compare(a.name, b.name) || a.name.localeCompare(b.name);

/** A tag as typed, made presentable: trimmed, with runs of whitespace collapsed to one space. `""` for nothing. */
export function normalizeTag(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** What a tag matches on: its normalised form, case-folded and in one Unicode form. */
export function tagKey(tag: string): string {
  return normalizeTag(tag).normalize("NFC").toLocaleLowerCase();
}

/** A list of tags as typed, cleaned: empties dropped, duplicates (by key) dropped keeping the first. */
export function cleanTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    const key = tagKey(tag);
    if (tag === "" || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

/**
 * Every tag across `notes`, with how many notes carry it. Tags match without
 * regard to case; the casing shown is the one the oldest note used.
 */
export function indexTags(notes: Iterable<TaggedNote>): TagIndex {
  const ordered = Array.from(notes).sort(byCreated);
  const byKey = new Map<string, TagEntry>();
  for (const note of ordered) {
    const counted = new Set<string>();
    for (const raw of note.tags) {
      const name = normalizeTag(raw);
      const key = tagKey(name);
      if (name === "" || counted.has(key)) continue;
      counted.add(key);
      let entry = byKey.get(key);
      if (!entry) {
        entry = { key, name, count: 0, noteIds: [] };
        byKey.set(key, entry);
      }
      entry.count++;
      entry.noteIds.push(note.id);
    }
  }
  const tags = [...byKey.values()].sort((a, b) => b.count - a.count || byName(a, b));
  return { tags, byKey };
}

/** Oldest first; notes without a creation time come last, in the order given. */
function byCreated(a: TaggedNote, b: TaggedNote): number {
  if (a.created === b.created) return 0;
  if (a.created === null) return 1;
  if (b.created === null) return -1;
  return a.created < b.created ? -1 : 1;
}

/** Tags as typed, cleaned, with each one already in use taking the casing in use. */
export function canonicalTags(tags: readonly string[], index: TagIndex): string[] {
  return cleanTags(tags).map((tag) => index.byKey.get(tagKey(tag))?.name ?? tag);
}

/** The notes carrying every one of `selected` (matched by key); every note when nothing is selected. */
export function filterByTags<T extends { tags: readonly string[] }>(notes: Iterable<T>, selected: readonly string[]): T[] {
  const wanted = selected.map(tagKey);
  const all = Array.from(notes);
  if (wanted.length === 0) return all;
  return all.filter((note) => {
    const keys = new Set(note.tags.map(tagKey));
    return wanted.every((key) => keys.has(key));
  });
}
