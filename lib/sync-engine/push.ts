import type { SyncRecord } from "@/lib/device-store";
import { folderOfPath, titleOfPath } from "@/lib/notebook-format";
import type { FileChange } from "@/lib/remote";
import { count, type ChangeUnit, type PushedNote } from "./batches";

export interface PushPlan {
  message: string;
  /** One unit per note: what must land in the same commit for that note. */
  units: ChangeUnit[];
  /** The version of each note the push holds. */
  pushed: PushedNote[];
}

/**
 * What a push of every note with unsynced changes consists of: each new or
 * edited file is written, and a renamed note's old path is deleted in the
 * same commit. The units are packed into commits by `planBatches`.
 */
export function planPush(dirty: readonly SyncRecord[]): PushPlan {
  const units = dirty.map(unitFor);
  return {
    message: commitMessage(dirty),
    units,
    pushed: units.flatMap((unit) => unit.notes),
  };
}

/** The changes a note needs in one commit: its file, and the removal of its old path when it was renamed. */
function unitFor(record: SyncRecord): ChangeUnit {
  const changes: FileChange[] = [];
  if (record.base && record.base.path !== record.path) changes.push({ path: record.base.path, delete: true });
  changes.push({ path: record.path, content: record.text });
  return { notes: [{ id: record.id, path: record.path, text: record.text }], changes };
}

/** A readable message: `Update "Groceries"`, `Rename "A" to "B"`, `Move "X" to Recipes`, `Update 1,234 notes`. */
export function commitMessage(dirty: readonly SyncRecord[]): string {
  if (dirty.length !== 1) return `Update ${count(dirty.length)} notes`;
  const [{ path, base }] = dirty;
  const title = titleOfPath(path);
  if (!base) return `Add "${title}"`;
  if (base.path === path) return `Update "${title}"`;
  const folder = folderOfPath(path);
  if (folderOfPath(base.path) !== folder) return `Move "${title}" to ${folder || "the top level"}`;
  return `Rename "${titleOfPath(base.path)}" to "${title}"`;
}
