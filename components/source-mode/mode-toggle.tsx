"use client";

import { useSyncExternalStore } from "react";
import type { EditingMode } from "@/lib/source-mode";
import { cn } from "@/lib/utils";

export interface ModeToggleProps {
  mode: EditingMode;
  onChange: (mode: EditingMode) => void;
  className?: string;
}

const OPTIONS: { mode: EditingMode; label: string }[] = [
  { mode: "rich-text", label: "Rich text" },
  { mode: "source", label: "Source" },
];

const isApple = () =>
  /Mac|iPhone|iPad|iPod/.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform,
  );

/** The switching shortcut as this device writes it; the server's guess is corrected on hydration. */
function useShortcutLabel(): string {
  return useSyncExternalStore(
    () => () => {},
    () => (isApple() ? "⌘⇧M" : "Ctrl+Shift+M"),
    () => "Ctrl+Shift+M",
  );
}

/**
 * The switch between rich text mode and source mode: two options, the chosen
 * one lit. It never takes focus from the editor, so the cursor can be carried
 * to the same place in the other mode, and it changes instantly: a switch is
 * a keyboard action, not an occasion.
 */
export function ModeToggle({ mode, onChange, className }: ModeToggleProps) {
  const shortcut = useShortcutLabel();
  return (
    <div
      role="group"
      aria-label="Editing mode"
      className={cn("inline-flex h-8 shrink-0 items-center rounded-lg bg-muted p-0.5 pointer-coarse:h-10", className)}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          aria-pressed={mode === option.mode}
          title={`${option.label} mode (${shortcut})`}
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange(option.mode)}
          className="pressable h-full rounded-[min(var(--radius-md),12px)] px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
