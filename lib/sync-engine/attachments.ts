import type { DeviceStore } from "@/lib/device-store";
import type { FileChange, NotebookRef, Remote } from "@/lib/remote";

/** The attachments a push adds to the notebook, ready to go into its commit. */
export interface AttachmentsPush {
  /** One `{ path, sha }` change per attachment, naming the blob that holds its bytes. */
  changes: FileChange[];
  paths: string[];
}

/**
 * Gets every attachment pending on this device into GitHub as a blob, so the
 * next commit can name it beside the notes that embed it. Bytes stored by an
 * earlier attempt (a push that lost the race, or was interrupted) are not sent
 * again: the store remembers their blob SHA.
 */
export async function stageAttachments(
  store: DeviceStore,
  remote: Remote,
  notebook: string,
  ref: NotebookRef,
): Promise<AttachmentsPush> {
  const push: AttachmentsPush = { changes: [], paths: [] };
  for (const attachment of store.sync.pendingAttachments(notebook)) {
    let { sha } = attachment;
    if (!sha) {
      sha = await remote.storeAttachment(ref, { type: attachment.type, bytes: attachment.bytes });
      store.sync.recordAttachmentBlob(notebook, attachment.path, sha);
    }
    push.changes.push({ path: attachment.path, sha });
    push.paths.push(attachment.path);
  }
  return push;
}

/**
 * The commit message with its attachments: `Update "Trip notes" and add 2
 * attachments`, or `Add 1 attachment` when no note changed.
 */
export function withAttachments(message: string, changedNotes: number, attachments: AttachmentsPush): string {
  const count = attachments.paths.length;
  if (count === 0) return message;
  const added = `add ${count} ${count === 1 ? "attachment" : "attachments"}`;
  if (changedNotes === 0) return added.charAt(0).toUpperCase() + added.slice(1);
  return `${message} and ${added}`;
}
