"use client";

import { Link2 } from "lucide-react";
import { useState } from "react";
import { useNote } from "@/components/notes/notepad-provider";
import { usePaletteAction } from "@/components/palette";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ShareDialog } from "./share-dialog";

/**
 * The Share button in a note's actions: opens the share dialog, carries a dot
 * while the note has a link, and lists "Share" in the command palette while
 * the note is open.
 */
export function ShareButton({ noteId }: { noteId: string }) {
  const note = useNote(noteId);
  const [open, setOpen] = useState(false);
  usePaletteAction({ id: "share", label: "Share", keywords: "link publish public read-only", icon: Link2, run: () => setOpen(true) });
  if (!note) return null;
  const shared = note.share !== null;

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="relative text-muted-foreground pointer-coarse:size-10"
                aria-haspopup="dialog"
                onClick={() => setOpen(true)}
              />
            }
          >
            <Link2 aria-hidden />
            {shared && <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-foreground" />}
            <span className="sr-only">{shared ? "Share, link active" : "Share"}</span>
          </TooltipTrigger>
          <TooltipContent>{shared ? "Share · link active" : "Share"}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <ShareDialog noteId={noteId} open={open} onOpenChange={setOpen} />
    </>
  );
}
