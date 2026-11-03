"use client";

import { X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { attachmentLink } from "@/lib/attachments";
import type { FailedAttachment } from "@/lib/device-store";
import type { Conflict } from "@/lib/sync-engine";
import { cn } from "@/lib/utils";
import { useFailedAttachments, useNotepad, useNotes, useSyncStatus } from "./notepad-provider";

/**
 * What sync needs the member to know, wherever the layout puts it: the session
 * ended and they must sign in again to keep syncing (their notes stay on the
 * device meanwhile), notes that couldn't be merged and got a conflict copy,
 * images the notebook refused (over the deployment's size limit) that the
 * member can remove, and a quiet line while the device is offline or a sync
 * is being retried.
 */
export function SyncNotices({
  className,
  onOpen,
}: {
  className?: string;
  /** Opens a note, for the conflict copy; without it the notice only says where the copy is. */
  onOpen?: (noteId: string) => void;
}) {
  const { store, engine } = useNotepad();
  const status = useSyncStatus();
  const conflicts = useSyncExternalStore(engine.subscribe, engine.getConflicts, engine.getConflicts);
  const failedAttachments = useFailedAttachments();
  if (
    status.state !== "signed-out" &&
    status.state !== "offline" &&
    status.state !== "failed" &&
    conflicts.length === 0 &&
    failedAttachments.length === 0
  ) {
    return null;
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {status.state === "signed-out" && <SignInAgain />}
      {failedAttachments.length > 0 && (
        <FailedAttachmentsNotice
          failed={failedAttachments}
          onRemove={({ notebook, path }) => store.removeAttachment(notebook, path)}
        />
      )}
      {conflicts.length > 0 && (
        <ConflictNotice
          conflicts={conflicts}
          onOpen={
            onOpen &&
            ((conflict) => {
              engine.dismissConflict(conflict.copyId);
              onOpen(conflict.copyId);
            })
          }
          onDismiss={() => conflicts.forEach((conflict) => engine.dismissConflict(conflict.copyId))}
        />
      )}
      {status.state === "offline" && <QuietLine>Offline · syncs when you&apos;re back online</QuietLine>}
      {status.state === "failed" && <QuietLine detail={status.message}>Sync failed · retrying automatically</QuietLine>}
    </div>
  );
}

function SignInAgain() {
  return (
    <section
      role="alert"
      aria-labelledby="sign-in-again-title"
      className="animate-enter flex flex-col gap-3 rounded-lg border bg-card p-3 text-sm"
    >
      <div className="flex flex-col gap-1">
        <h2 id="sign-in-again-title" className="font-medium text-foreground">
          Sign in again to sync
        </h2>
        <p className="text-muted-foreground">
          Your notes are saved on this device and you can keep writing. Sign in to GitHub again to sync them.
        </p>
      </div>
      {/* A plain link: the sign-in route sends the browser to GitHub and back to the notes. */}
      <a href="/api/auth/login" className={cn(buttonVariants({ size: "sm" }), "self-start")}>
        Sign in again
      </a>
    </section>
  );
}

function ConflictNotice({
  conflicts,
  onOpen,
  onDismiss,
}: {
  conflicts: readonly Conflict[];
  onOpen?: (conflict: Conflict) => void;
  onDismiss: () => void;
}) {
  const count = conflicts.length;
  return (
    <section
      role="alert"
      aria-labelledby="conflict-notice-title"
      className="animate-enter rounded-lg border bg-card p-3 text-sm"
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="conflict-notice-title" className="font-medium text-foreground">
            {count === 1 ? "1 note couldn't be merged" : `${count.toLocaleString()} notes couldn't be merged`}
          </h2>
          <p className="text-muted-foreground">
            {count === 1 ? "It" : "Each"} changed here and in the notebook at the same time. This device&apos;s version
            was kept; the notebook&apos;s is in a conflict copy next to it.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={onDismiss}>
          <X aria-hidden />
        </Button>
      </div>
      <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto overscroll-contain">
        {conflicts.map((conflict) => (
          <li key={conflict.copyId} className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-foreground" title={conflict.title}>
              {conflict.title}
            </span>
            {onOpen && (
              <Button
                variant="secondary"
                size="xs"
                className="shrink-0"
                aria-label={`Open the conflict copy of ${conflict.title}`}
                onClick={() => onOpen(conflict)}
              >
                Open copy
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Images the notebook refused: each with the note that embeds it and why,
 * and a way to take it out of the note. Nothing to dismiss: the image stays
 * in the note, unsynced, until it is removed or replaced with a smaller one.
 */
function FailedAttachmentsNotice({
  failed,
  onRemove,
}: {
  failed: readonly FailedAttachment[];
  onRemove: (attachment: FailedAttachment) => void;
}) {
  const notes = useNotes();
  const count = failed.length;
  /** The title of the first note embedding the attachment, so the member knows where it is. */
  const embeddedIn = ({ notebook, path }: FailedAttachment) =>
    notes.find((note) => note.notebook === notebook && note.body.includes(attachmentLink(path)))?.title ?? null;

  return (
    <section
      role="alert"
      aria-labelledby="failed-attachments-title"
      className="animate-enter rounded-lg border bg-card p-3 text-sm"
    >
      <div className="flex flex-col gap-1">
        <h2 id="failed-attachments-title" className="font-medium text-foreground">
          {count === 1 ? "1 image couldn't be stored" : `${count.toLocaleString()} images couldn't be stored`}
        </h2>
        <p className="text-muted-foreground">
          {count === 1
            ? "The notebook refused it, so the note synced without it. Remove it, or replace it with a smaller image."
            : "The notebook refused them, so the notes synced without them. Remove them, or replace them with smaller images."}
        </p>
      </div>
      <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto overscroll-contain">
        {failed.map((attachment) => {
          const title = embeddedIn(attachment);
          return (
            <li key={`${attachment.notebook}/${attachment.path}`} className="flex min-w-0 items-center gap-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-foreground" title={title ?? undefined}>
                  {title ?? "Not in any note"}
                </span>
                <span className="truncate text-xs text-muted-foreground" title={attachment.reason}>
                  {attachment.reason}
                </span>
              </span>
              <Button
                variant="secondary"
                size="xs"
                className="shrink-0"
                aria-label={title ? `Remove the image from ${title}` : "Remove the image"}
                onClick={() => onRemove(attachment)}
              >
                Remove
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function QuietLine({ children, detail }: { children: React.ReactNode; detail?: string }) {
  return (
    <p aria-live="polite" title={detail} className="flex min-w-0 items-center gap-2 px-1 text-xs text-muted-foreground">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
      <span className="truncate">{children}</span>
    </p>
  );
}
