"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UpdatePromptProps {
  open: boolean;
  onReload: () => void;
  onDismiss: () => void;
}

/**
 * A quiet notice that a new version of the app is installed and waiting.
 * The live region stays mounted so screen readers announce the notice when it appears.
 */
export function UpdatePrompt({ open, onReload, onDismiss }: UpdatePromptProps) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-safe pb-safe md:justify-end"
    >
      {open && (
        <div
          role="status"
          className="pointer-events-auto m-4 flex animate-enter items-center gap-1 rounded-xl border bg-popover py-1.5 pr-1.5 pl-4 text-sm text-popover-foreground shadow-lg"
        >
          <span className="mr-2">Update available</span>
          <Button size="sm" onClick={onReload}>
            Reload
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={onDismiss}>
            <X aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
