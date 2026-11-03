"use client";

import { Ellipsis, FolderPlus, LogOut, SquarePen, Users } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { useNotebook } from "@/components/notes/notepad-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { LeaveNotebookDialog } from "./leave-notebook-dialog";
import { NotebookSettingsDialog } from "./notebook-settings-dialog";

/**
 * The "…" on a notebook's row in the sidebar: a new note in that notebook,
 * and for a shared notebook its collaborators and, for a collaborator, the way
 * out. On desktop it shows when the row is pointed at or focused; on a phone
 * it is always there.
 */
export function NotebookRowMenu({
  notebookId,
  name,
  onCreateNote,
  onCreateFolder,
  className,
}: {
  notebookId: string;
  name: string;
  /** Creates a note in the notebook and opens it; a keyboard activation has `event.detail === 0`. */
  onCreateNote: (event: MouseEvent) => void;
  /** Starts a folder at the top level of the notebook. */
  onCreateFolder?: () => void;
  className?: string;
}) {
  const notebook = useNotebook(notebookId);
  const [dialog, setDialog] = useState<"collaborators" | "leave" | null>(null);
  const shared = notebook?.kind === "shared";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Options for ${name}`}
              className={cn(
                "size-9 shrink-0 text-muted-foreground md:size-6",
                "md:opacity-0 md:group-hover/notebook:opacity-100 md:group-focus-within/notebook:opacity-100 md:focus-visible:opacity-100 md:aria-expanded:opacity-100",
                className,
              )}
            />
          }
        >
          <Ellipsis aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          <DropdownMenuItem onClick={onCreateNote}>
            <SquarePen aria-hidden />
            New note
          </DropdownMenuItem>
          {onCreateFolder && (
            <DropdownMenuItem onClick={onCreateFolder}>
              <FolderPlus aria-hidden />
              New folder
            </DropdownMenuItem>
          )}
          {shared && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDialog("collaborators")}>
                <Users aria-hidden />
                Collaborators…
              </DropdownMenuItem>
              {notebook.role === "collaborator" && (
                <DropdownMenuItem variant="destructive" onClick={() => setDialog("leave")}>
                  <LogOut aria-hidden />
                  Leave notebook…
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {shared && (
        <NotebookSettingsDialog
          notebook={notebook}
          open={dialog === "collaborators"}
          onOpenChange={(open) => setDialog(open ? "collaborators" : null)}
          onLeave={notebook.role === "collaborator" ? () => setDialog("leave") : undefined}
        />
      )}
      {shared && notebook.role === "collaborator" && (
        <LeaveNotebookDialog notebook={notebook} open={dialog === "leave"} onOpenChange={(open) => setDialog(open ? "leave" : null)} />
      )}
    </>
  );
}
