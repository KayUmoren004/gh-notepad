"use client";

import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The clock in the note's actions that opens and closes its History panel. */
export function HistoryButton({ open, onToggle, className }: { open: boolean; onToggle: () => void; className?: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="History"
      title="History"
      aria-pressed={open}
      onClick={onToggle}
      className={cn("text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground pointer-coarse:size-10", className)}
    >
      <History aria-hidden />
    </Button>
  );
}
