import type { SyncRecord } from "@/lib/device-store";
import { folderOfPath, titleOfPath } from "@/lib/notebook-format";
import type { FileChange } from "@/lib/remote";

export interface PushPlan {
  message: string;
  changes: FileChange[];
  /** The version of each note the commit holds. */
  pushed: { id: string; path: string; text: string }[];
}

/**
 * One commit for every note with unsynced changes: new and edited files are
 * written, and a renamed note's old path is deleted in the same commit.
 */
export function planPush(dirty: readonly SyncRecord[]): PushPlan {
  const changes = new Map<string, FileChange>();
  for (const record of dirty) {
    if (record.base && record.base.path !== record.path && !changes.has(record.base.path)) {
      changes.set(record.base.path, { path: record.base.path, delete: true });
    }
  }
  // Writes win over deletes: two notes may have swapped names.
  for (const record of dirty) changes.set(record.path, { path: record.path, content: record.text });

  return {
    message: commitMessage(dirty),
    changes: [...changes.values()],
    pushed: dirty.map(({ id, path, text }) => ({ id, path, text })),
  };
}

/** A readable message: `Update "Groceries"`, `Rename "A" to "B"`, `Move "X" to Recipes`, `Update 3 notes`. */
export function commitMessage(dirty: readonly SyncRecord[]): string {
  if (dirty.length !== 1) return `Update ${dirty.length} notes`;
  const [{ path, base }] = dirty;
  const title = titleOfPath(path);
  if (!base) return `Add "${title}"`;
  if (base.path === path) return `Update "${title}"`;
  const folder = folderOfPath(path);
  if (folderOfPath(base.path) !== folder) return `Move "${title}" to ${folder || "the top level"}`;
  return `Rename "${titleOfPath(base.path)}" to "${title}"`;
}
