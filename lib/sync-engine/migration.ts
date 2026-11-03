import type { PullChange, SyncRecord } from "@/lib/device-store";
import { migrateV1, type TextFile } from "@/lib/notebook-format";
import type { FileChange } from "@/lib/remote";
import type { ChangeUnit } from "./batches";
import type { RemoteNote } from "./reconcile";

/** A v1 file that couldn't be converted, and why. */
export interface SkippedFile {
  path: string;
  reason: string;
}

/** A conversion of v1 data that a pull found, committed by the push that follows. */
export interface PendingMigration {
  /** The head commit the conversion was made against, and the push's base. */
  base: string;
  /** The converted notes, which the device takes as new notes. */
  notes: PullChange[];
  /** The v1 file each converted note replaces, by note id: removed in the same commit as the note's file. */
  replaces: Map<string, string>;
  /** The rest of the commit: empty folders kept, and every other v1 file removed. */
  changes: FileChange[];
  message: string;
  skipped: SkippedFile[];
}

/** What a v1 conversion this device committed came to, for telling the member. */
export interface MigrationReport {
  notebook: string;
  /** The commit that made the conversion. */
  commit: string;
  /** v1 files left out because they couldn't be read; the notebook's history keeps them. */
  skipped: SkippedFile[];
}

/**
 * GitHub keeps whole messages, but the notebook routes take up to 1,000
 * characters; a push of several commits adds ` (1,000 of 1,000)` at most.
 */
const MAX_MESSAGE = 1000 - " (1,000 of 1,000)".length;

/**
 * Plans converting the v1 data in a pulled notebook. The converted notes join
 * the device as notes that haven't reached the notebook yet, so the next push
 * commits them together with the removal of every v1 file.
 */
export function planMigration(
  head: string,
  v1: readonly TextFile[],
  device: { records: readonly SyncRecord[]; pulled: readonly PullChange[]; remote: readonly RemoteNote[] },
): PendingMigration {
  const existing = [
    ...device.remote,
    ...device.records,
    ...device.pulled.flatMap((change) => ("device" in change ? [change.device] : [])),
  ];
  const migration = migrateV1(v1, existing);
  // Converted earlier too: a conversion that resumes after a failure part-way keeps each note with its v1 file.
  const replaces = new Map([...migration.notes, ...migration.converted].map(({ id, source }) => [id, source]));
  const replaced = new Set(replaces.values());
  return {
    base: head,
    notes: migration.notes.map(({ id, path, text }) => ({ id, base: null, device: { path, text } })),
    replaces,
    changes: [
      ...migration.folders.map((path) => ({ path, content: "" })),
      ...migration.removed.filter((path) => !replaced.has(path)).map((path) => ({ path, delete: true as const })),
    ],
    message: commitMessage(migration.skipped),
    skipped: migration.skipped,
  };
}

/**
 * The push's units with the conversion added: each converted note's unit
 * also removes the v1 file it replaces, so the two land in one commit, and
 * the rest of the conversion follows as a unit of its own.
 */
export function migrationUnits(migration: PendingMigration, units: readonly ChangeUnit[]): ChangeUnit[] {
  const pending = new Map(migration.replaces);
  const joined = units.map((unit) => {
    const removed: FileChange[] = [];
    for (const { id } of unit.notes) {
      const source = pending.get(id);
      if (source === undefined) continue;
      pending.delete(id);
      removed.push({ path: source, delete: true });
    }
    return removed.length === 0 ? unit : { notes: unit.notes, changes: [...unit.changes, ...removed] };
  });
  // A v1 file whose note isn't in the push (nothing to write for it) is removed on its own.
  const rest = [...migration.changes, ...[...pending.values()].map((path) => ({ path, delete: true as const }))];
  return rest.length === 0 ? joined : [...joined, { notes: [], changes: rest }];
}

function commitMessage(skipped: readonly SkippedFile[]): string {
  let message = "Convert v1 notes to Markdown";
  if (skipped.length === 0) return message;
  const files = skipped.length === 1 ? "1 file" : `${skipped.length} files`;
  message += `\n\nLeft out ${files} that couldn't be read; this notebook's history keeps them:`;
  for (const [index, { path, reason }] of skipped.entries()) {
    const line = `\n- ${path}: ${reason}`;
    const rest = `\n- and ${skipped.length - index} more`;
    if (message.length + line.length + (index < skipped.length - 1 ? rest.length : 0) > MAX_MESSAGE) {
      return message + rest;
    }
    message += line;
  }
  return message;
}
