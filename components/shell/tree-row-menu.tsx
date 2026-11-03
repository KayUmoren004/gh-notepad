"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Ellipsis, FolderInput, FolderPlus, Pencil } from "lucide-react";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { TreeRow } from "@/lib/notebook-tree";
import { cn } from "@/lib/utils";

/** What a row's menu offers. */
export type RowAction = "new-folder" | "rename" | "move";

/** A point to open the menu at (a right click), standing in for an element. */
export interface MenuAnchor {
  getBoundingClientRect: () => DOMRect;
}

export function anchorAt(x: number, y: number): MenuAnchor {
  return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
}

export interface RowMenuProps {
  row: TreeRow;
  open: boolean;
  /** Where the menu opens from when not from its button: the right click's point. */
  anchor: MenuAnchor | null;
  onOpenChange: (open: boolean) => void;
  onAction: (action: RowAction) => void;
}

/**
 * The "…" at the end of a tree row and the menu behind it, which a right
 * click (or Shift+F10) opens at the pointer instead. Notebooks take new
 * folders; folders are renamed, moved and given folders; notes are renamed
 * and moved. On desktop the button shows on hover or focus; on a phone it is
 * always there, since nothing hovers.
 */
export function RowMenu({ row, open, anchor, onOpenChange, onAction }: RowMenuProps) {
  const act = (action: RowAction) => () => onAction(action);
  return (
    <MenuPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <MenuPrimitive.Trigger
        aria-label={`Actions for ${row.label}`}
        title="Actions"
        className={cn(
          "pressable absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          "md:inset-y-auto md:right-1 md:h-5 md:w-5 md:rounded-sm md:hover:bg-sidebar-accent md:hover:text-sidebar-foreground",
          // Desktop: only while the row is hovered or holds focus, or the menu is open; coarse pointers see it always.
          "md:hidden md:group-hover:flex md:group-focus-within:flex md:pointer-coarse:flex",
          open && "md:flex",
        )}
      >
        <Ellipsis aria-hidden className="size-4" />
      </MenuPrimitive.Trigger>
      <DropdownMenuContent anchor={anchor ?? undefined} align={anchor ? "start" : "end"} className="w-auto min-w-40">
        {row.kind !== "note" && (
          <DropdownMenuItem onClick={act("new-folder")}>
            <FolderPlus aria-hidden />
            New folder
          </DropdownMenuItem>
        )}
        {row.kind !== "notebook" && (
          <>
            <DropdownMenuItem onClick={act("rename")}>
              <Pencil aria-hidden />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={act("move")}>
              <FolderInput aria-hidden />
              Move to…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </MenuPrimitive.Root>
  );
}
