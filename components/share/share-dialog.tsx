"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNote, useNotepad, useSyncStatus } from "@/components/notes/notepad-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RemoteError } from "@/lib/remote";
import { newShareId, sharePath } from "@/lib/share";

/** How long the copy button says "Copied". */
const COPIED_MS = 1_500;

type Phase = "idle" | "creating" | "confirming" | "stopping";

export interface ShareDialogProps {
  noteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function problemOf(error: unknown, fallback: string): string {
  if (error instanceof RemoteError && error.kind === "offline") return "You're offline";
  if (error instanceof RemoteError && error.kind === "signed-out") return "Sign in again first";
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The share dialog for one note: its sharing state, the link with a copy
 * button once shared, and a way to stop sharing. Creating a link writes the
 * share id into the note and syncs, so the published copy exists before the
 * link is shown; stopping deletes the copy first, then the id.
 */
export function ShareDialog({ noteId, open, onOpenChange }: ShareDialogProps) {
  const { store, engine, remote } = useNotepad();
  const note = useNote(noteId);
  const sync = useSyncStatus();
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const linkField = useRef<HTMLInputElement>(null);

  /** Closing forgets the dialog's transient state: a confirmation left open, a problem, "Copied". */
  function changeOpen(next: boolean) {
    if (!next) {
      setPhase("idle");
      setProblem(null);
      setCopied(false);
    }
    onOpenChange(next);
  }

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!note) return null;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = note.share ? `${origin}${sharePath(note.share)}` : null;
  const shared = link !== null && phase !== "creating";
  const current = note.synced && sync.state !== "syncing";

  async function create() {
    setProblem(null);
    setPhase("creating");
    store.setShare(noteId, newShareId());
    try {
      await engine.sync();
    } catch (error) {
      // The link exists on the note already; the copy is published by the sync that gets through.
      setProblem(`${problemOf(error, "The link couldn't be published yet")}; it's published when this note next syncs`);
    }
    setPhase("idle");
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // A browser that refuses the clipboard still lets the member copy the selected text.
      linkField.current?.focus();
      linkField.current?.select();
      setProblem("The browser wouldn't copy; the link is selected for you to copy");
    }
  }

  async function stop() {
    if (!note?.share) return;
    setProblem(null);
    setPhase("stopping");
    try {
      const location = store.sync.notebook(note.notebook);
      if (!location?.branch) throw new Error("This notebook hasn't synced yet");
      await remote.revokeShare({ owner: location.owner, repo: location.repo, branch: location.branch }, note.share);
      store.setShare(noteId, null);
      engine.requestSync();
    } catch (error) {
      setProblem(`Couldn't stop sharing: ${problemOf(error, "try again")}`);
    }
    setPhase("idle");
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription>
            Anyone with the link can read this note. They can&apos;t change it, and they don&apos;t need to sign in.
          </DialogDescription>
        </DialogHeader>

        {shared ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input
                ref={linkField}
                readOnly
                value={link}
                aria-label="Share link"
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 font-mono"
              />
              <Button variant="outline" onClick={copy} className="w-24 shrink-0" aria-live="polite">
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {phase === "confirming"
                ? "The link stops working for everyone who has it."
                : current
                  ? "The link shows the note as last synced."
                  : "The link updates when this note syncs."}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{phase === "creating" ? "Creating the link…" : "Not shared"}</p>
        )}

        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}

        <DialogFooter>
          {!shared ? (
            <Button onClick={create} disabled={phase === "creating"}>
              {phase === "creating" ? "Creating link…" : "Create link"}
            </Button>
          ) : phase === "confirming" ? (
            <>
              <Button variant="outline" onClick={() => setPhase("idle")}>
                Keep sharing
              </Button>
              <Button variant="destructive" onClick={stop}>
                Stop sharing
              </Button>
            </>
          ) : (
            <Button variant="destructive" onClick={() => setPhase("confirming")} disabled={phase === "stopping"}>
              {phase === "stopping" ? "Stopping…" : "Stop sharing"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
