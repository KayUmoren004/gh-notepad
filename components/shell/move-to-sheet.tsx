"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Folder, Notebook } from "lucide-react";
import { useState } from "react";
import { useNotebookTrees, useNotepad } from "@/components/notes/notepad-provider";
import { folderName } from "@/lib/notebook-format";
import { moveDestinations, type DragSource } from "@/lib/notebook-tree";
import { cn } from "@/lib/utils";

/** Folders keep indenting this deep, then stop. */
const MAX_INDENT_DEPTH = 6;
const INDENT_PX = 14;

export interface MoveToSheetProps {
  /** What to move; `null` keeps the sheet closed. */
  source: DragSource | null;
  onClose: () => void;
  /** Called once the move is made, with where it went. */
  onMoved?: (folder: string) => void;
}

/**
 * "Move to…": the notebook's folders as a list, each a place the note or
 * folder can go, the ones it can't marked and disabled. A bottom sheet on a
 * phone, a small dialog on desktop. Moving happens on the device at once;
 * sync carries it to the notebook.
 */
export function MoveToSheet({ source, onClose, onMoved }: MoveToSheetProps) {
  const { store } = useNotepad();
  const trees = useNotebookTrees();
  // The source is kept while the sheet closes, so its list doesn't empty mid-slide.
  const [shown, setShown] = useState(source);
  if (source && source !== shown) setShown(source);

  const tree = shown ? trees.find((candidate) => candidate.id === shown.notebook) : undefined;
  const destinations = tree && shown ? moveDestinations(tree, shown) : [];
  const what = shown ? (shown.kind === "note" ? shown.title : folderName(shown.path)) : "";

  function move(folder: string) {
    if (!source) return;
    if (source.kind === "note") store.moveNote(source.id, folder);
    else store.moveFolder(source.notebook, source.path, folder);
    onClose();
    onMoved?.(folder);
  }

  return (
    <DialogPrimitive.Root
      open={source !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 isolate z-50 bg-black/10 transition-opacity duration-(--duration-base) ease-out supports-backdrop-filter:backdrop-blur-xs data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <DialogPrimitive.Popup
          aria-label={`Move ${what} to`}
          className={cn(
            "fixed z-50 flex flex-col bg-popover text-popover-foreground ring-1 ring-foreground/10 outline-none",
            // A phone: a sheet from the bottom, clear of the home indicator, with the drawer's curve.
            "max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[85dvh] max-md:rounded-t-2xl max-md:pb-safe",
            "max-md:transition-[translate,opacity] max-md:duration-(--duration-enter) max-md:ease-drawer",
            "max-md:data-[starting-style]:translate-y-(--push-offset) max-md:data-[ending-style]:translate-y-(--push-offset)",
            // Desktop: a small dialog, centred, scaling in like any other.
            "md:top-1/2 md:left-1/2 md:max-h-[min(32rem,calc(100dvh-4rem))] md:w-full md:max-w-sm md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl",
            "md:transition-[scale,opacity] md:duration-(--duration-base) md:ease-out",
            "md:data-[starting-style]:scale-(--enter-scale) md:data-[ending-style]:scale-(--enter-scale)",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
          )}
        >
          <div className="shrink-0 px-4 pt-3 pb-2 md:px-3">
            <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-muted-foreground/40 md:hidden" />
            <DialogPrimitive.Title className="truncate text-base font-medium md:text-sm">
              Move <span className="text-muted-foreground">{what}</span> to…
            </DialogPrimitive.Title>
          </div>
          <ul aria-label="Folders" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
            {destinations.map((destination) => {
              const Icon = destination.depth === 0 ? Notebook : Folder;
              return (
                <li key={destination.folder}>
                  <button
                    type="button"
                    disabled={destination.problem !== null}
                    title={destination.problem ?? undefined}
                    onClick={() => move(destination.folder)}
                    style={{ paddingLeft: 8 + Math.min(destination.depth, MAX_INDENT_DEPTH) * INDENT_PX }}
                    className="pressable flex h-11 w-full min-w-0 items-center gap-2 rounded-md pr-2 text-left text-base outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40 md:h-8 md:text-sm"
                  >
                    <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{destination.name}</span>
                    {destination.problem !== null && (
                      <span className="shrink-0 truncate text-xs text-muted-foreground">{destination.problem}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
