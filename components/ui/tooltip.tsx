"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";

/**
 * Tooltips on Base UI. The first one waits before it opens; while one is
 * open, moving to the next control opens its tooltip at once and without
 * animation (`data-instant`). The popup scales from its trigger.
 */
function TooltipProvider({ delay = 500, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />;
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = "bottom",
  sideOffset = 6,
  children,
  ...props
}: TooltipPrimitive.Popup.Props & Pick<TooltipPrimitive.Positioner.Props, "side" | "sideOffset">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} className="z-50">
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "origin-(--transform-origin) rounded-md bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-[opacity,scale] duration-(--duration-fast) ease-(--ease-out) select-none data-ending-style:scale-(--enter-scale) data-ending-style:opacity-0 data-instant:duration-0 data-starting-style:scale-(--enter-scale) data-starting-style:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
