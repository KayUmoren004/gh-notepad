"use client";

import { useEffect, useRef, useState } from "react";
import { RichTextMode, type RichTextModeHandle } from "@/components/rich-text-mode";
import { TopBar } from "@/components/shell";
import { breadcrumbOf } from "@/lib/notebook-tree";
import { useNoteImages } from "./note-images";
import { useNote, useNotepad } from "./notepad-provider";
import { SyncIndicator } from "./sync-indicator";

/**
 * The editor for one note, given its id: a title (the note's file name) and its
 * body in rich text mode, saved to the device as they change. A sync that
 * changes the body is merged into rich text mode in place. Self-contained, so
 * layouts can place it anywhere.
 */
export function NoteEditor({
  noteId,
  focusTitle = false,
  onBack,
}: {
  noteId: string;
  /** Puts the cursor in the title with it selected, for a note just created. */
  focusTitle?: boolean;
  /** On a phone, where the note covers the tree, the top bar's back button calls this. */
  onBack?: () => void;
}) {
  const { store } = useNotepad();
  const note = useNote(noteId);
  const title = useRef<HTMLInputElement>(null);
  const body = useRef<RichTextModeHandle>(null);
  // What the member is typing into the title: the stored title is sanitised, and mustn't fight the keyboard.
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const images = useNoteImages(note);

  useEffect(() => {
    if (!focusTitle) return;
    title.current?.focus();
    title.current?.select();
  }, [focusTitle, noteId]);

  if (!note) return null;

  return (
    <article className="flex h-full min-h-0 flex-col">
      <TopBar
        crumbs={breadcrumbOf(note)}
        onBack={onBack}
        backLabel={note.folder ? note.folder.slice(note.folder.lastIndexOf("/") + 1) : "Notes"}
      >
        <SyncIndicator note={note} className="px-2" />
        {/* Where the note's actions (history, share, more) go as their tickets land. */}
        <div data-slot="note-actions" className="flex items-center gap-0.5" />
      </TopBar>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-safe">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 pt-3 pb-24 md:pt-14">
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
          {images.element}
          <RichTextMode
            key={noteId}
            ref={body}
            label="Note text"
            value={note.body}
            onChange={(text) => store.editBody(noteId, text)}
            {...images.editorProps}
          />
        </div>
      </div>
    </article>
  );
}
