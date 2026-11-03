import { diff3Merge } from "node-diff3";

/**
 * A change made elsewhere, merged with what was typed since `base` (the text
 * both sides last agreed on): a line-based 3-way merge where, if both touched
 * the same lines, the typing wins. Returns `incoming` itself when nothing was
 * typed, so an unchanged note never moves.
 */
export function mergeIncoming(current: string, base: string, incoming: string): string {
  if (current === base) return incoming;
  const regions = diff3Merge(current.split("\n"), base.split("\n"), incoming.split("\n"), { excludeFalseConflicts: true });
  return regions.flatMap((region) => region.ok ?? region.conflict?.a ?? []).join("\n");
}
