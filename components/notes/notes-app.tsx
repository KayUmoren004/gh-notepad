"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Account } from "@/lib/device-store";
import { cn } from "@/lib/utils";
import { NoteEditor } from "./note-editor";
import { NoteList } from "./note-list";
import { NotepadProvider, useNotepad, useNotes } from "./notepad-provider";

/**
 * The notes screen for this slice: a flat list beside the open note (on small
 * screens, one or the other). Everything reads from the device store; sync runs
 * in the background.
 */
export function NotesApp({ account }: { account: Account }) {
  return (
    <NotepadProvider
      account={account}
      fallback={<p className="m-auto text-sm text-muted-foreground">Opening your notes…</p>}
    >
      <Notes />
    </NotepadProvider>
  );
}

function Notes() {
  const { store, engine } = useNotepad();
  const notes = useNotes();
  const [openId, setOpenId] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const open = notes.find((note) => note.id === openId);

  function show(id: string | null) {
    // Switching notes is a good moment to sync what was just written.
    if (id !== openId) engine.requestSync();
    setOpenId(id);
  }

  function createNote() {
    const id = store.createNote();
    setCreatedId(id);
    show(id);
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        aria-label="Notes"
        className={cn("w-full min-w-0 flex-col border-r md:flex md:w-72 md:shrink-0", open ? "hidden" : "flex")}
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 pr-2 pl-5">
          <h1 className="text-sm font-medium text-muted-foreground">Notes</h1>
          <Button variant="ghost" size="sm" onClick={createNote}>
            <Plus aria-hidden />
            New note
          </Button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <NoteList notes={notes} openId={open?.id ?? null} onOpen={show} />
        </nav>
      </aside>

      <section aria-label="Editor" className={cn("min-w-0 flex-1 flex-col md:flex", open ? "flex" : "hidden")}>
        {open ? (
          <NoteEditor key={open.id} noteId={open.id} focusTitle={open.id === createdId} onBack={() => show(null)} />
        ) : (
          <p className="m-auto px-6 text-center text-sm text-muted-foreground">
            Pick a note, or start a new one.
          </p>
        )}
      </section>
    </div>
  );
}
