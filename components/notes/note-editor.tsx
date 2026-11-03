"use client";

import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BodyField } from "./body-field";
import { useNote, useNotepad } from "./notepad-provider";
import { SyncIndicator } from "./sync-indicator";

/**
 * The editor for one note, given its id: a title (the note's file name) and its
 * body, saved to the device as they change. Self-contained, so layouts can
 * place it anywhere and rich text mode can take over the body field.
 */
export function NoteEditor({
  noteId,
  focusTitle = false,
  onBack,
}: {
  noteId: string;
  /** Puts the cursor in the title with it selected, for a note just created. */
  focusTitle?: boolean;
  /** Shown on small screens, where the editor covers the list. */
  onBack?: () => void;
}) {
  const { store } = useNotepad();
  const note = useNote(noteId);
  const title = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  // What the member is typing into the title: the stored title is sanitised, and mustn't fight the keyboard.
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!focusTitle) return;
    title.current?.focus();
    title.current?.select();
  }, [focusTitle, noteId]);

  if (!note) return null;

  return (
    <article className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-2 md:px-4">
        {onBack && (
          <Button variant="ghost" size="sm" className="md:hidden" onClick={onBack}>
            <ChevronLeft aria-hidden />
            Notes
          </Button>
        )}
        <SyncIndicator note={note} className="ml-auto px-2" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-safe">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 pt-2 pb-24 md:pt-8">
          <input
            ref={title}
            aria-label="Title"
            placeholder="Untitled"
            value={titleDraft ?? note.title}
            onChange={(event) => {
              setTitleDraft(event.currentTarget.value);
              store.rename(noteId, event.currentTarget.value);
            }}
            onBlur={() => setTitleDraft(null)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                body.current?.focus();
              }
            }}
            enterKeyHint="next"
            autoComplete="off"
            className="w-full min-w-0 bg-transparent text-3xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground"
          />
          <BodyField ref={body} value={note.body} onChange={(text) => store.editBody(noteId, text)} />
        </div>
      </div>
    </article>
  );
}
