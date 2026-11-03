"use client";

import { useEffect, useState } from "react";
import type { Note } from "@/lib/device-store";
import type { SyncStatus } from "@/lib/sync-engine";
import { cn } from "@/lib/utils";
import { useSyncStatus } from "./notepad-provider";

interface Indication {
  label: string;
  /** Said in full on hover. */
  detail: string;
  tone: "quiet" | "busy" | "warning";
}

const numbers = new Intl.NumberFormat();

/** Saved (on this device) and Synced (matches GitHub) are separate states, shown separately (ADR 0002). */
function indicate(note: Note, saving: boolean, status: SyncStatus): Indication {
  if (saving) return { label: "Saving…", detail: "Saving on this device", tone: "busy" };
  if (note.synced) return { label: "Synced", detail: "Saved on this device and synced to GitHub", tone: "quiet" };
  const saved = "Saved on this device";
  switch (status.state) {
    case "syncing": {
      // A sync of more than one commit says how far it has come: "Syncing 2 of 3…".
      const { progress } = status;
      const part = progress ? ` ${numbers.format(progress.done + 1)} of ${numbers.format(progress.total)}` : "";
      return {
        label: `Saved · Syncing${part}…`,
        detail: `${saved}; syncing to GitHub${part && `, part${part}`}`,
        tone: "busy",
      };
    }
    case "offline":
      return { label: "Saved · Offline", detail: `${saved}; syncs when you're back online`, tone: "quiet" };
    case "signed-out":
      return { label: "Saved · Sign in to sync", detail: `${saved}; sign in again to sync`, tone: "warning" };
    case "failed":
      return { label: "Saved · Sync failed", detail: `${saved}; sync failed and will retry`, tone: "warning" };
    default:
      return { label: "Saved", detail: `${saved}; not synced to GitHub yet`, tone: "quiet" };
  }
}

/** True once `value` has stayed true for `ms`: brief saves don't flicker the label. */
function useLingering(value: boolean, ms: number): boolean {
  const [lingering, setLingering] = useState(false);
  useEffect(() => {
    if (!value) return;
    const timer = setTimeout(() => setLingering(true), ms);
    return () => {
      clearTimeout(timer);
      setLingering(false);
    };
  }, [value, ms]);
  return value && lingering;
}

export function SyncIndicator({ note, className }: { note: Note; className?: string }) {
  const status = useSyncStatus();
  const saving = useLingering(!note.saved, 600);
  const { label, detail, tone } = indicate(note, saving, status);

  return (
    <p
      role="status"
      title={detail}
      className={cn("flex min-w-0 items-center gap-2 text-xs text-muted-foreground", className)}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full transition-colors",
          tone === "quiet" && "bg-muted-foreground/60",
          tone === "busy" && "bg-foreground",
          tone === "warning" && "bg-destructive",
        )}
      />
      <span className="truncate">{label}</span>
    </p>
  );
}
