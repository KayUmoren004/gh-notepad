/** A run of text in a snippet or title, marked where it matched the search. */
export interface Segment {
  text: string;
  marked: boolean;
}

/** The words of a text, found the way MiniSearch's default tokenizer splits it: on spaces and punctuation. */
const WORDS = /[^\n\r\p{Z}\p{P}]+/gu;

/** Leading Markdown block markers (`#`, `>`, list bullets, `1.`) and a task's checkbox. */
const BLOCK_MARKER = /^(?:#{1,6}|>|[-*+]|\d+[.)])\s+/;
const TASK_MARKER = /^\[[ xX]\]\s+/;

/** How much of a long line a snippet shows, and how much of it comes before the match. */
const WINDOW = 140;
const LEAD = 40;

const plain = (text: string): Segment[] => (text ? [{ text, marked: false }] : []);

/**
 * Splits `text` into segments, marking every word that starts with one of
 * `terms` (the index terms a search matched), regardless of case.
 */
export function highlight(text: string, terms: readonly string[]): Segment[] {
  const lowered = terms.map((term) => term.toLowerCase()).filter((term) => term.length > 0);
  if (lowered.length === 0 || text.length === 0) return plain(text);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(WORDS)) {
    const word = match[0];
    const lower = word.toLowerCase();
    if (!lowered.some((term) => lower.startsWith(term))) continue;
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index), marked: false });
    segments.push({ text: word, marked: true });
    cursor = match.index + word.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), marked: false });
  return segments;
}

/** A line of Markdown as the member would read it: without its block markers. */
function stripMarkers(line: string): string {
  let text = line.trim();
  for (;;) {
    const next = text.replace(BLOCK_MARKER, "");
    if (next === text) break;
    text = next;
  }
  return text.replace(TASK_MARKER, "");
}

/** `text` cut to the window around its first marked word, with an ellipsis on each cut side. */
function windowAround(text: string, matchStart: number, matchEnd: number): string {
  if (text.length <= WINDOW) return text;
  let start = Math.max(0, matchStart - LEAD);
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space !== -1 && space < matchStart) start = space + 1;
  }
  let end = Math.min(text.length, start + WINDOW);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > matchEnd) end = space;
  }
  end = Math.max(end, matchEnd);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/**
 * The first line of `body` holding a word that starts with one of `terms`,
 * its Markdown markers removed and the matches marked; long lines are cut to
 * a window around the first match. `null` when no line matches.
 */
export function snippetOf(body: string, terms: readonly string[]): Segment[] | null {
  if (terms.length === 0) return null;
  for (const line of body.split(/\r?\n/)) {
    const text = stripMarkers(line);
    if (!text) continue;
    const segments = highlight(text, terms);
    const first = segments.findIndex((segment) => segment.marked);
    if (first === -1) continue;
    const matchStart = segments.slice(0, first).reduce((length, segment) => length + segment.text.length, 0);
    const matchEnd = matchStart + segments[first].text.length;
    const windowed = windowAround(text, matchStart, matchEnd);
    return windowed === text ? segments : highlight(windowed, terms);
  }
  return null;
}

/** The tags as `#tag` segments, each marked whole when a search matched any word of it. */
export function tagSegments(tags: readonly string[], terms: readonly string[]): Segment[] {
  const segments: Segment[] = [];
  tags.forEach((tag, index) => {
    const marked = highlight(tag, terms).some((segment) => segment.marked);
    segments.push({ text: `${index > 0 ? " " : ""}#`, marked: false }, { text: tag, marked });
  });
  return segments;
}

/** A path with at most three segments: a deep one keeps its last two behind an ellipsis. */
export function shortPath(segments: readonly string[]): string[] {
  if (segments.length <= 3) return [...segments];
  return ["…", ...segments.slice(-2)];
}
