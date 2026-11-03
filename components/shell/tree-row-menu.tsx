"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { FolderInput, FolderPlus, Pencil } from "lucide-react";
import { useRef, useState } from "react";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { TreeRow } from "@/lib/notebook-tree";

/** What a row's menu offers. */
export type RowAction = "new-folder" | "rename" | "move";

/** What the menu opens from: the row's "…" button, or the point of a right click. */
export type MenuAnchor = Element | { getBoundingClientRect: () => DOMRect };

export function anchorAt(x: number, y: number): MenuAnchor {
  return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
}

export interface RowMenuProps {
  /** The row the menu is open for; `null` keeps it closed. */
  row: TreeRow | null;
  anchor: MenuAnchor | null;
  onClose: () => void;
  onAction: (row: TreeRow, action: RowAction) => void;
}

/**
 * The one menu behind every row's "…" and right click, mounted once for the
 * tree so a thousand rows don't carry a thousand menus. Notebooks take new
 * folders; folders are renamed, moved and given folders; notes are renamed
 * and moved. The chosen action runs once the menu has closed and given focus
 * back, so what it opens (a field, a dialog) keeps the focus it takes.
 */
export function RowMenu({ row, anchor, onClose, onAction }: RowMenuProps) {
  const pending = useRef<RowAction | null>(null);
  // The row is kept while the menu closes, so its items don't change mid-fade.
  const [shown, setShown] = useState(row);
  if (row && row !== shown) setShown(row);

  return (
    <MenuPrimitive.Root
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onOpenChangeComplete={(open) => {
        if (open) return;
        const action = pending.current;
        pending.current = null;
        if (action && shown) onAction(shown, action);
        // Focus goes back to the "…" that opened the menu (right clicks have the pointer); an action takes it elsewhere.
        else if (anchor instanceof HTMLElement) anchor.focus();
      }}
    >
      <DropdownMenuContent
        finalFocus={false}
        anchor={anchor ?? undefined}
        align={anchor instanceof Element ? "end" : "start"}
        className="w-auto min-w-40"
      >
        {shown?.kind !== "note" && (
          <DropdownMenuItem
            onClick={() => {
              pending.current = "new-folder";
            }}
          >
            <FolderPlus aria-hidden />
            New folder
          </DropdownMenuItem>
        )}
        {shown?.kind !== "notebook" && (
          <>
            <DropdownMenuItem
              onClick={() => {
                pending.current = "rename";
              }}
            >
              <Pencil aria-hidden />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                pending.current = "move";
              }}
            >
              <FolderInput aria-hidden />
              Move to…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </MenuPrimitive.Root>
  );
}
