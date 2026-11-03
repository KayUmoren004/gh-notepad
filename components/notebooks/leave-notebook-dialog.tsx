"use client";

import { useState } from "react";
import { useNote, useNotepad, type NotebookSummary } from "@/components/notes/notepad-provider";
import { useNoteRoute } from "@/components/shell/note-route";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Confirms leaving a shared notebook, then gives up the member's access on
 * GitHub and forgets the notebook on this device, notes and all. Only a
 * collaborator can leave: an owner's notebook is theirs for good.
 */
export function LeaveNotebookDialog({
  notebook,
  open,
  onOpenChange,
}: {
  notebook: NotebookSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { store, remote } = useNotepad();
  const route = useNoteRoute();
  const openNote = useNote(route.noteId ?? "");
  const [leaving, setLeaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  function change(next: boolean) {
    if (next) setFailure(null);
    onOpenChange(next);
  }

  async function leave() {
    setLeaving(true);
    setFailure(null);
    try {
      await remote.leaveNotebook({ owner: notebook.owner, repo: notebook.repo });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Leaving didn't work");
      setLeaving(false);
      return;
    }
    // The note on screen goes with the notebook: back to the list first.
    if (openNote?.notebook === notebook.id) route.close();
    store.forgetNotebook(notebook.id);
    setLeaving(false);
    onOpenChange(false);
  }

  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogContent className="duration-200 ease-out motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:zoom-out-100">
        <AlertDialogHeader>
          <AlertDialogTitle>
            <span className="break-words">Leave {notebook.name}?</span>
          </AlertDialogTitle>
          <AlertDialogDescription>
            Its notes leave this device too. {notebook.owner} can invite you again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus disabled={leaving}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={leaving} onClick={() => void leave()}>
            {leaving ? "Leaving…" : "Leave notebook"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
