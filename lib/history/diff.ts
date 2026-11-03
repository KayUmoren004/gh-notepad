import { diffLines as jsdiffLines } from "diff";

/** A run of lines in a line diff, or a gap standing in for unchanged lines left out. */
export type DiffHunk =
  | { kind: "unchanged" | "added" | "removed"; lines: string[] }
  | { kind: "gap"; hidden: number };

/** Unchanged lines kept on each side of a change. */
export const CONTEXT_LINES = 3;

/** Edits beyond this many lines are shown as "everything changed" rather than computed line by line. */
const MAX_EDIT_LENGTH = 5_000;

function lines(text: string): string[] {
  const normalised = text.replace(/\r\n?/g, "\n");
  if (normalised === "") return [];
  return (normalised.endsWith("\n") ? normalised.slice(0, -1) : normalised).split("\n");
}

/**
 * The line-by-line difference between `before` (an older version) and `after`
 * (the note now): what the newer text added and removed, with a few unchanged
 * lines of context around each change and the rest folded into gaps. Line
 * endings never count as a change.
 */
export function diffLines(before: string, after: string): DiffHunk[] {
  const a = lines(before);
  const b = lines(after);
  // Every line ends in a newline, the last one included: a missing final newline is not a change.
  const text = (list: string[]) => list.map((line) => `${line}\n`).join("");
  const changes = jsdiffLines(text(a), text(b), { maxEditLength: MAX_EDIT_LENGTH }) ?? [
    ...(a.length ? [{ removed: true, added: false, value: text(a) }] : []),
    ...(b.length ? [{ added: true, removed: false, value: text(b) }] : []),
  ];

  const hunks: DiffHunk[] = [];
  changes.forEach((change, index) => {
    const changeLines = lines(change.value);
    if (changeLines.length === 0) return;
    if (change.added) hunks.push({ kind: "added", lines: changeLines });
    else if (change.removed) hunks.push({ kind: "removed", lines: changeLines });
    else {
      const first = index === 0;
      const last = index === changes.length - 1;
      const keepBefore = first ? 0 : CONTEXT_LINES;
      const keepAfter = last ? 0 : CONTEXT_LINES;
      if (changes.length === 1) {
        // Nothing changed: the whole text is the context.
        hunks.push({ kind: "unchanged", lines: changeLines });
      } else if (changeLines.length > keepBefore + keepAfter) {
        if (keepBefore > 0) hunks.push({ kind: "unchanged", lines: changeLines.slice(0, keepBefore) });
        hunks.push({ kind: "gap", hidden: changeLines.length - keepBefore - keepAfter });
        if (keepAfter > 0) hunks.push({ kind: "unchanged", lines: changeLines.slice(changeLines.length - keepAfter) });
      } else {
        hunks.push({ kind: "unchanged", lines: changeLines });
      }
    }
  });
  return hunks;
}
