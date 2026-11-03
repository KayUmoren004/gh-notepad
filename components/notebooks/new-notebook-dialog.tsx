"use client";

import { Plus } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useNotepad } from "@/components/notes/notepad-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { notebookId } from "@/lib/device-store";
import { RemoteError } from "@/lib/remote";
import { cn } from "@/lib/utils";
import { checkNotebookName } from "./notebook-name";

/** The window event the command palette dispatches to open the dialog from anywhere. */
export const NEW_NOTEBOOK_EVENT = "notepad:new-notebook";

/**
 * The sidebar's "New shared notebook" action: a small button by the Notebooks
 * heading that opens the dialog, which the palette's event opens too.
 */
export function NewNotebookButton({ onCreated, className }: { onCreated?: (id: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(NEW_NOTEBOOK_EVENT, show);
    return () => window.removeEventListener(NEW_NOTEBOOK_EVENT, show);
  }, []);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="New shared notebook"
        title="New shared notebook"
        className={cn("size-9 text-muted-foreground md:size-6", className)}
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden />
      </Button>
      <NewNotebookDialog open={open} onOpenChange={setOpen} onCreated={onCreated} />
    </>
  );
}

/**
 * Names a shared notebook and creates it: a private repository in the
 * member's GitHub account, tagged as a notebook. The name is shown as the
 * repository it becomes (spaces turn into hyphens), and what can't be a
 * repository name is explained before anything is sent.
 */
export function NewNotebookDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new notebook's id once GitHub has it; sync picks it up right after. */
  onCreated?: (id: string) => void;
}) {
  const { store, engine, remote } = useNotepad();
  const hintId = useId();
  const [typed, setTyped] = useState("");
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { slug, problem } = checkNotebookName(typed);
  const owner = store.account.login;
  const canCreate = slug !== "" && problem === null && !creating;

  function change(next: boolean) {
    // Reset when opening, not closing, so the content stays put while the dialog fades out.
    if (next) {
      setTyped("");
      setFailure(null);
      setCreating(false);
    }
    onOpenChange(next);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!canCreate) return;
    setCreating(true);
    setFailure(null);
    try {
      const notebook = await remote.createNotebook(slug);
      onOpenChange(false);
      onCreated?.(notebookId(notebook.owner, notebook.repo));
      // Brings the new notebook onto the device; a failure here is sync's to retry.
      engine.refreshNotebooks().catch(() => undefined);
    } catch (error) {
      const taken = error instanceof RemoteError && error.code === "name_taken";
      setFailure(
        taken
          ? `You already have a repository named ${slug}`
          : error instanceof Error
            ? error.message
            : "The notebook couldn't be created",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent render={<form onSubmit={(event) => void create(event)} />}>
        <DialogHeader>
          <DialogTitle>New shared notebook</DialogTitle>
          <DialogDescription>
            A private repository in your GitHub account. Everyone you invite can read and edit all of it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Input
            aria-label="Notebook name"
            aria-describedby={hintId}
            aria-invalid={problem !== null || undefined}
            placeholder="Name"
            value={typed}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={120}
            onChange={(event) => {
              setTyped(event.currentTarget.value);
              setFailure(null);
            }}
          />
          <p id={hintId} className={cn("min-h-5 text-xs", problem ? "text-destructive" : "text-muted-foreground")}>
            {problem ??
              (slug ? (
                <>
                  Will be created as{" "}
                  <span className="font-mono text-foreground" style={{ overflowWrap: "anywhere" }}>
                    {owner}/{slug}
                  </span>
                </>
              ) : (
                "Letters, digits, '.', '-' and '_'; spaces become hyphens."
              ))}
          </p>
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={creating} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canCreate}>
            {creating ? "Creating…" : "Create notebook"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
