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

  return (
    <>
      <DropdownMenu
        onOpenChangeComplete={(open) => {
          if (open) return;
          const action = afterClose.current;
          afterClose.current = null;
          action?.();
        }}
      >
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="More" title="More" className="text-muted-foreground pointer-coarse:size-10" />}
        >
          <Ellipsis aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-40">
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
