import { diffIndices } from "node-diff3";

/** One replacement in a document: the text at `from`..`to` becomes `insert`. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * The smallest set of replacements that turns `before` into `after`, in
 * document order and never overlapping, so CodeMirror can apply them as one
 * transaction. Lines are compared first and each changed stretch is then
 * narrowed to the characters that differ, so an edit elsewhere in the note
 * never touches the line the cursor is on, and a change on that line leaves
 * the cursor where it was unless the change itself covers it.
 */
export function minimalChanges(before: string, after: string): TextChange[] {
  if (before === after) return [];
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of oldLines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const endOfLine = (index: number) => starts[index] + oldLines[index].length;

  const changes: TextChange[] = [];
  for (const hunk of diffIndices(oldLines, newLines)) {
    const [oldStart, oldLength] = hunk.buffer1;
    const [newStart, newLength] = hunk.buffer2;
    const inserted = newLines.slice(newStart, newStart + newLength).join("\n");
    const oldEnd = oldStart + oldLength;
    let change: TextChange;
    if (oldLength > 0 && newLength > 0) {
      change = { from: starts[oldStart], to: endOfLine(oldEnd - 1), insert: inserted };
    } else if (oldLength > 0) {
      // Whole lines go, and one of the newlines around them with them.
      change =
        oldEnd < oldLines.length
          ? { from: starts[oldStart], to: starts[oldEnd], insert: "" }
          : { from: oldStart > 0 ? endOfLine(oldStart - 1) : 0, to: endOfLine(oldEnd - 1), insert: "" };
    } else if (oldStart < oldLines.length) {
      change = { from: starts[oldStart], to: starts[oldStart], insert: `${inserted}\n` };
    } else {
      change = { from: before.length, to: before.length, insert: `\n${inserted}` };
    }
    changes.push(narrow(before, change));
  }
  return changes;
}

/** `change` without the characters at either end that it would replace with themselves. */
function narrow(text: string, { from, to, insert }: TextChange): TextChange {
  const removed = text.slice(from, to);
  let prefix = 0;
  while (prefix < removed.length && prefix < insert.length && removed[prefix] === insert[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < removed.length - prefix &&
    suffix < insert.length - prefix &&
    removed[removed.length - 1 - suffix] === insert[insert.length - 1 - suffix]
  ) {
    suffix++;
  }
  return { from: from + prefix, to: to - suffix, insert: insert.slice(prefix, insert.length - suffix) };
}
