"use client";

import { Ellipsis, FolderInput, Pencil } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { MoveToSheet } from "@/components/shell/move-to-sheet";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Note } from "@/lib/device-store";
import type { DragSource } from "@/lib/notebook-tree";

export interface MoreMenuProps {
  note: Note;
  /** Puts the member in the title to rename the note. */
  onRename?: () => void;
  /** Further items, as other features add theirs. */
  children?: ReactNode;
}

/**
 * The note's "…" in the top bar: Rename, Move to…, and whatever other
 * features add. Actions that need the member's attention elsewhere (the
 * title) run once the menu has closed and given focus back.
 */
export function MoreMenu({ note, onRename, children }: MoreMenuProps) {
  const [moving, setMoving] = useState<DragSource | null>(null);
  const afterClose = useRef<(() => void) | null>(null);
  /** What had focus when the menu opened: its button. */
  const trigger = useRef<HTMLElement | null>(null);

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onOpenChangeComplete={(open) => {
          if (open) return;
          const action = afterClose.current;
          afterClose.current = null;
          // The menu's own focus return would land after the action's, and take the title's focus away.
          if (action) action();
          else trigger.current?.focus();
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="More"
              title="More"
              className="text-muted-foreground pointer-coarse:size-10"
            />
          }
        >
          <Ellipsis aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent finalFocus={false} align="end" className="w-auto min-w-40">
          {onRename && (
            <DropdownMenuItem
              onClick={() => {
                afterClose.current = onRename;
              }}
            >
              <Pencil aria-hidden />
              Rename
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() =>
              setMoving({ kind: "note", id: note.id, notebook: note.notebook, folder: note.folder, title: note.title })
            }
          >
            <FolderInput aria-hidden />
            Move to…
          </DropdownMenuItem>
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
      <MoveToSheet source={moving} onClose={() => setMoving(null)} />
    </>
  );
}
