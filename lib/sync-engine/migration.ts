import type { PullChange, SyncRecord } from "@/lib/device-store";
import { migrateV1, type TextFile } from "@/lib/notebook-format";
import type { FileChange } from "@/lib/remote";
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
  /** The rest of the commit: every v1 file removed, and empty folders kept. */
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

/** GitHub keeps whole messages, but the notebook routes take up to 1,000 characters. */
const MAX_MESSAGE = 1000;

/**
 * Plans converting the v1 data in a pulled notebook. The converted notes join
 * the device as notes that haven't reached the notebook yet, so the next push
 * commits them together with the removal of every v1 file, in one commit.
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
  return {
    base: head,
    notes: migration.notes.map(({ id, path, text }) => ({ id, base: null, device: { path, text } })),
    changes: [
      ...migration.folders.map((path) => ({ path, content: "" })),
      ...migration.removed.map((path) => ({ path, delete: true as const })),
    ],
    message: commitMessage(migration.skipped),
    skipped: migration.skipped,
  };
}

function commitMessage(skipped: readonly SkippedFile[]): string {
  let message = "Convert v1 notes to Markdown";
  if (skipped.length === 0) return message;
  message += `\n\nLeft out ${skipped.length === 1 ? "1 file" : `${skipped.length} files`} that couldn't be read; this notebook's history keeps them:`;
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
