"use client";

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { FolderInput, FolderPlus, Pencil } from "lucide-react";
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { TreeRow } from "@/lib/notebook-tree";

/** What a row's menu offers. */
export type RowAction = "new-folder" | "rename" | "move";

export interface RowMenuProps {
  rows: readonly TreeRow[];
  /** No menus while a drag is on. */
  disabled: boolean;
  /** Which row's menu is open, or `null`. */
  onOpenChange: (key: string | null) => void;
  onAction: (row: TreeRow, action: RowAction) => void;
  /** The list: a right click (or a long press) on any of its rows opens the menu for that row. */
  children: ReactNode;
}

/**
 * Opens the menu for the row holding `element` from its "…": the same path a
 * right click takes, so the menu behaves the same whichever way it was asked
 * for. The point is the button's corner, so the menu hangs off it.
 */
export function openRowMenuFrom(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.right - 2, clientY: box.bottom - 2 }),
  );
}

/**
 * The one menu behind every row's "…" and right click, mounted once around
 * the list so a thousand rows don't carry a thousand menus: a context menu,
 * which opens where the pointer is (or where a finger is held), and whose
 * row is read off the right-clicked element. Notebooks take new folders;
 * folders are renamed, moved and given folders; notes are renamed and moved.
 * The chosen action runs once the menu has closed, so what it opens (a
 * field, a dialog) keeps the focus it takes; otherwise focus goes back to
 * what opened the menu.
 */
export function RowMenu({ rows, disabled, onOpenChange, onAction, children }: RowMenuProps) {
  const pending = useRef<RowAction | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const target = useRef<TreeRow | null>(null);
  // The row whose items show; kept while the menu closes, so they don't change mid-fade.
  const [shown, setShown] = useState<TreeRow | null>(null);

  function onContextMenuCapture(event: MouseEvent<HTMLDivElement>) {
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tree-row]") : null;
    const row = element && rows.find((candidate) => candidate.key === element.dataset.treeRow);
    if (!element || !row || disabled || element.dataset.renaming) {
      // Not for the menu: a field being edited keeps the browser's own menu.
      event.stopPropagation();
      return;
    }
    const box = element.getBoundingClientRect();
    const { clientX: x, clientY: y } = event;
    const inside = x >= box.left && x <= box.right && y >= box.top && y <= box.bottom && (x !== 0 || y !== 0);
    if (!inside && event.isTrusted) {
      // The keyboard (Shift+F10) has no point: the menu opens from the row's "…" instead.
      event.stopPropagation();
      event.preventDefault();
      openRowMenuFrom(element.querySelector<HTMLElement>("[data-row-menu]") ?? element);
      return;
    }
    target.current = row;
    opener.current = event.target instanceof Element ? event.target.closest("button") : null;
    setShown(row);
  }

  return (
    <ContextMenuPrimitive.Root
      onOpenChange={(open) => onOpenChange(open ? (target.current?.key ?? null) : null)}
      onOpenChangeComplete={(open) => {
        if (open) return;
        const action = pending.current;
        const row = target.current;
        pending.current = null;
        if (action && row) onAction(row, action);
        else opener.current?.focus();
      }}
    >
      <ContextMenuPrimitive.Trigger onContextMenuCapture={onContextMenuCapture}>{children}</ContextMenuPrimitive.Trigger>
      <DropdownMenuContent finalFocus={false} align="start" className="w-auto min-w-40">
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
    </ContextMenuPrimitive.Root>
  );
}
