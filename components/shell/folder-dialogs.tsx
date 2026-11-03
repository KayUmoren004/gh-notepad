"use client";

import { FolderPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNotepad } from "@/components/notes/notepad-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { folderName, NEW_FOLDER } from "@/lib/notebook-format";
import { notebookName } from "@/lib/notebook-tree";
import { SidebarAction } from "./sidebar";

/** Where a new folder goes: a notebook, and a folder in it (`""` for the top level). */
export interface FolderPlace {
  notebook: string;
  parent: string;
}

export interface NewFolderDialogProps {
  /** Where the folder goes; `null` keeps the dialog closed. */
  place: FolderPlace | null;
  onClose: () => void;
  /** Called with the new folder's path once it exists. */
  onCreated?: (path: string, place: FolderPlace) => void;
}

/**
 * Asks for a folder's name and makes it, kept even while empty. The name
 * follows the rules of titles, so whatever is typed works; "New folder" when
 * nothing is.
 */
export function NewFolderDialog({ place, onClose, onCreated }: NewFolderDialogProps) {
  const { store } = useNotepad();
  const [name, setName] = useState("");
  // The place is kept while the dialog closes, so its text doesn't change mid-fade.
  const [shown, setShown] = useState(place);
  if (place && place !== shown) setShown(place);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!place) return;
    const path = store.createFolder(place.notebook, place.parent, name);
    onClose();
    onCreated?.(path, place);
  }

  return (
    <Dialog
      open={place !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) setName("");
      }}
    >
      <DialogContent render={<form onSubmit={submit} />}>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            {shown?.parent ? `In ${folderName(shown.parent)}` : `At the top level of ${shown ? notebookName(shown.notebook) : "the notebook"}`}
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Folder name"
          placeholder={NEW_FOLDER}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          autoFocus
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          className="h-10 md:h-8"
        />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button type="submit">Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The sidebar's "New folder": a folder at the top level of the personal notebook. */
export function NewFolderAction() {
  const { store } = useNotepad();
  const [place, setPlace] = useState<FolderPlace | null>(null);
  return (
    <>
      <SidebarAction icon={FolderPlus} onClick={() => setPlace({ notebook: store.personalNotebook, parent: "" })}>
        New folder
      </SidebarAction>
      <NewFolderDialog place={place} onClose={() => setPlace(null)} />
    </>
  );
}
