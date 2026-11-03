"use client";

import { ChevronLeft, PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Breadcrumb } from "./breadcrumb";
import { useOptionalSidebar } from "./sidebar-state";

export interface TopBarProps {
  /** `notebook / folder / … / note`, shown on desktop. */
  crumbs?: readonly string[];
  /** On a phone, the note covers the tree: a back button leads to it. */
  onBack?: () => void;
  /** What the back button says: the folder the note is in, or "Notes". */
  backLabel?: string;
  /** The right-hand group: the Saved / Synced indicator, then actions. */
  children?: ReactNode;
  className?: string;
}

/**
 * The slim bar over the editor: the way back on a phone, the breadcrumb on
 * desktop (and the button that brings a collapsed sidebar back), and whatever
 * the note's header puts on the right.
 */
export function TopBar({ crumbs, onBack, backLabel = "Notes", children, className }: TopBarProps) {
  const sidebar = useOptionalSidebar();

  return (
    <header className={cn("shrink-0 pt-safe", className)}>
      <div className="flex h-12 items-center gap-2 pr-3 pl-2 md:pl-3">
        {sidebar?.collapsed && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Show sidebar"
            title="Show sidebar"
            className="hidden text-muted-foreground md:inline-flex"
            onClick={() => sidebar.toggle()}
          >
            <PanelLeftOpen aria-hidden />
          </Button>
        )}
        {onBack && (
          // Named by where it leads, as a phone's back buttons are: "Notes", or the folder the note is in.
          <Button
            variant="ghost"
            size="sm"
            className="-ml-1 max-w-48 min-w-0 justify-start pl-1 text-muted-foreground md:hidden"
            onClick={onBack}
          >
            <ChevronLeft aria-hidden className="size-5!" />
            <span className="truncate text-sm">{backLabel}</span>
          </Button>
        )}
        {crumbs && <Breadcrumb segments={crumbs} className="hidden md:block" />}
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1">{children}</div>
      </div>
    </header>
  );
}
