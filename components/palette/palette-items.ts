import type { PaletteAction } from "./actions";

/** The words of a text, split the way the search index splits them. */
const WORDS = /[^\n\r\p{Z}\p{P}]+/gu;
const wordsOf = (text: string) => Array.from(text.toLowerCase().matchAll(WORDS), (match) => match[0]);

/**
 * Whether an action belongs in the list for `query`: every word of the query
 * starts a word of the action's label or keywords. An empty query lists all.
 */
export function matchesAction(action: Pick<PaletteAction, "label" | "keywords">, query: string): boolean {
  const needles = wordsOf(query);
  if (needles.length === 0) return true;
  const words = wordsOf(`${action.label} ${action.keywords ?? ""}`);
  return needles.every((needle) => words.some((word) => word.startsWith(needle)));
}
