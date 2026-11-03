import { diff3Merge } from "node-diff3";
import { readNote, writeNote, type NoteChanges, type NoteFields } from "@/lib/notebook-format";

/** What merging the device's and the notebook's versions of a note came to. */
export type MergeOutcome =
  /** Both sides' changes, joined. */
  | { conflict: false; text: string }
  /** Both changed the same lines: the merge needs a person (the device's version stays, see `reconcile`). */
  | { conflict: true };

/**
 * Line-based three-way merge of `device` and `remote`, two versions of
 * `base` (the version both sides last agreed on). Only overlapping edits
 * to the body are a conflict. Frontmatter is merged field by field: a
 * field the device didn't change follows the notebook, so `updated`
 * stamps set on both sides never make a conflict of their own.
 */
export function mergeNote(device: string, base: string, remote: string): MergeOutcome {
  if (device === remote) return { conflict: false, text: device };
  if (device === base) return { conflict: false, text: remote };
  if (remote === base) return { conflict: false, text: device };

  const [ours, agreed, theirs] = [device, base, remote].map(readNote);
  const body = mergeLines(ours.body, agreed.body, theirs.body);
  if (body === null) return { conflict: true };

  const meta: NoteChanges = {};
  for (const field of ["tags", "created", "updated"] as const) {
    if (sameField(ours[field], agreed[field]) && !sameField(theirs[field], agreed[field])) meta[field] = theirs[field];
  }
  return { conflict: false, text: writeNote(device, { ...meta, body }) };
}

/** `ours` and `theirs` joined line by line, or `null` where both changed the same lines. */
function mergeLines(ours: string, base: string, theirs: string): string | null {
  const regions = diff3Merge(ours.split("\n"), base.split("\n"), theirs.split("\n"), { excludeFalseConflicts: true });
  const lines: string[] = [];
  for (const region of regions) {
    if (!region.ok) return null;
    lines.push(...region.ok);
  }
  return lines.join("\n");
}

function sameField(a: NoteFields["tags" | "created" | "updated"], b: typeof a): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((tag, index) => tag === b[index]);
  }
  return a === b;
}
