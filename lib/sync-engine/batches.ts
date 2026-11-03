import type { FileChange } from "@/lib/remote";

/** The version of a note a push carries. */
export interface PushedNote {
  id: string;
  path: string;
  text: string;
}

/**
 * Changes that must land in the same commit, so the notebook is consistent
 * after each one: a renamed note's new file with the removal of its old one,
 * a converted v1 note with the v1 file it replaces, a note with its attachments.
 */
export interface ChangeUnit {
  /** The notes the unit carries; they count as synced once it lands. */
  notes: PushedNote[];
  /** The folders (by path) whose markers the unit carries; they count as synced once it lands. */
  folders?: string[];
  changes: FileChange[];
}

/** One commit of a push: whole units, holding at most the per-commit limit of changes. */
export interface Batch {
  notes: PushedNote[];
  folders: string[];
  changes: FileChange[];
}

/**
 * Splits a push into the fewest commits that hold at most `limit` changes
 * each, keeping the units' order and never splitting one. Units that touch
 * the same path (two notes that swapped names) are committed together, a
 * write to a path winning over a delete of it, since one commit may not change
 * a path twice and either on its own would lose a note.
 */
export function planBatches(units: readonly ChangeUnit[], limit: number): Batch[] {
  const batches: Batch[] = [];
  let current: Batch | null = null;
  for (const unit of joinSharingPaths(units)) {
    if (unit.changes.length > limit) {
      throw new Error(`${count(unit.changes.length)} changes must land together, but a commit holds at most ${count(limit)}`);
    }
    if (!current || current.changes.length + unit.changes.length > limit) {
      current = { notes: [], folders: [], changes: [] };
      batches.push(current);
    }
    current.notes.push(...unit.notes);
    current.folders.push(...(unit.folders ?? []));
    current.changes.push(...unit.changes);
  }
  return batches;
}

/** The commit message of commit `index` (from 1) of `total`: `Update 1,234 notes (2 of 3)`. */
export function batchMessage(message: string, index: number, total: number): string {
  if (total <= 1) return message;
  const end = message.indexOf("\n");
  const subject = end === -1 ? message : message.slice(0, end);
  const rest = end === -1 ? "" : message.slice(end);
  return `${subject} (${count(index)} of ${count(total)})${rest}`;
}

const numbers = new Intl.NumberFormat("en-US");

/** A count as a commit message or the UI shows it: `1,234`. */
export function count(n: number): string {
  return numbers.format(n);
}

/** Units sharing a path merged into one, at the position of the first; the rest kept as they are. */
function joinSharingPaths(units: readonly ChangeUnit[]): ChangeUnit[] {
  // Union-find over unit indexes, joined through the paths they change.
  const parent = units.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const byPath = new Map<string, number>();
  units.forEach((unit, index) => {
    for (const { path } of unit.changes) {
      const other = byPath.get(path);
      if (other === undefined) byPath.set(path, index);
      else parent[find(index)] = find(other);
    }
  });

  const groups = new Map<number, ChangeUnit[]>();
  units.forEach((unit, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(unit);
    else groups.set(root, [unit]);
  });
  // Insertion order follows each group's first unit, since `find` never changes which index comes first.
  return [...groups.values()].map((group) => (group.length === 1 ? group[0] : merge(group)));
}

function merge(group: readonly ChangeUnit[]): ChangeUnit {
  const changes = new Map<string, FileChange>();
  for (const unit of group) {
    for (const change of unit.changes) {
      const existing = changes.get(change.path);
      // A write wins over a delete: two notes may have swapped names.
      if (existing && !("delete" in existing) && "delete" in change) continue;
      changes.delete(change.path);
      changes.set(change.path, change);
    }
  }
  return {
    notes: group.flatMap((unit) => unit.notes),
    folders: group.flatMap((unit) => unit.folders ?? []),
    changes: [...changes.values()],
  };
}
