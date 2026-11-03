"use client";

import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

interface ToolbarButtonProps extends Omit<ComponentProps<"button">, "children"> {
  /** The button's face; without one, the label is shown as text. */
  icon?: LucideIcon;
  label: string;
  /** Whether the formatting is on at the selection; omit for actions. */
  active?: boolean;
  /** `touch` buttons are 44 px, for the bar above the software keyboard. */
  size?: "default" | "touch";
}

/**
 * A formatting control. It never takes focus from the editor: the selection
 * stays put and, on a phone, the keyboard stays open.
 */
export function ToolbarButton({ icon: Icon, label, active, size = "default", className, ...props }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={Icon ? label : undefined}
      title={Icon ? label : undefined}
      aria-pressed={active}
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        "pressable inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-accent aria-pressed:text-foreground disabled:opacity-50",
        size === "touch" ? "h-11 min-w-11 [&_svg]:size-5" : "h-8 min-w-8 [&_svg]:size-4",
        !Icon && "px-2.5 text-sm font-medium whitespace-nowrap",
        className,
      )}
      {...props}
    >
      {Icon ? <Icon aria-hidden /> : label}
    </button>
  );
}
