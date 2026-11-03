"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNotepad } from "@/components/notes/notepad-provider";
import { Button } from "@/components/ui/button";
import type { NotebookInvitation } from "@/lib/remote";
import { cn } from "@/lib/utils";

/** How often the member's invitations are looked up while the app is visible, and the least time between two looks (focus, visibility). */
const POLL_MS = 60_000;
const MIN_LOOK_MS = 15_000;

/**
 * The invitations waiting for the member, each with Accept: GitHub's offer to
 * collaborate on a notebook, which they take up here rather than on
 * github.com. Looked up when the app opens, when it regains focus, and every
 * minute while visible; "Not now" hides one until the app is opened again.
 */
export function InvitationsBanner({ className }: { className?: string }) {
  const { engine, remote } = useNotepad();
  const [invitations, setInvitations] = useState<NotebookInvitation[]>([]);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const lookedAt = useRef(0);

  const look = useCallback(
    async (force = false) => {
      if (!force && Date.now() - lookedAt.current < MIN_LOOK_MS) return;
      lookedAt.current = Date.now();
      try {
        const open = await remote.myInvitations();
        setInvitations(open.filter((invitation) => !invitation.expired));
      } catch {
        // Best effort: the next look will try again, and sync tells the member when the session is over.
      }
    },
    [remote],
  );

  useEffect(() => {
    // The first look, once mounted; later ones follow the app's focus and the clock.
    void Promise.resolve().then(() => look(true));
    const onFocus = () => void look();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void look();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void look();
    }, POLL_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [look]);

  async function accept(invitation: NotebookInvitation) {
    setBusy(invitation.id);
    setProblem(null);
    try {
      await remote.acceptInvitation(invitation.id);
      setInvitations((open) => open.filter((other) => other.id !== invitation.id));
      // The notebook is the member's now: sync brings it onto the device.
      engine.refreshNotebooks().catch(() => undefined);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The invitation couldn't be accepted");
      void look(true);
    } finally {
      setBusy(null);
    }
  }

  const shown = invitations.filter((invitation) => !hidden.has(invitation.id));
  if (shown.length === 0) return null;

  return (
    <section aria-label="Invitations" className={cn("animate-enter rounded-lg border bg-card p-3 text-sm", className)}>
      <ul className="flex flex-col gap-3">
        {shown.map((invitation) => (
          <li key={invitation.id} className="flex flex-col gap-2">
            <p className="text-pretty text-foreground">
              <span className="font-medium" style={{ overflowWrap: "anywhere" }}>
                {invitation.inviter}
              </span>{" "}
              <span className="text-muted-foreground">invited you to</span>{" "}
              <span className="font-medium" style={{ overflowWrap: "anywhere" }}>
                {invitation.notebook.repo}
              </span>
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                aria-label={`Accept the invitation to ${invitation.notebook.repo}`}
                disabled={busy !== null}
                onClick={() => void accept(invitation)}
              >
                {busy === invitation.id ? "Accepting…" : "Accept"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                aria-label={`Not now: ${invitation.notebook.repo}`}
                disabled={busy !== null}
                onClick={() => setHidden((current) => new Set([...current, invitation.id]))}
              >
                Not now
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {problem && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {problem}
        </p>
      )}
    </section>
  );
}
