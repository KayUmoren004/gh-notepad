"use client";

import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { RichTextMode, type RichTextModeHandle } from "@/components/rich-text-mode";
import { ModeToggle, SourceMode } from "@/components/source-mode";
import { Button } from "@/components/ui/button";
import {
  cursorAnchor,
  deviceStorage,
  findAnchor,
  initialMode,
  rememberMode,
  type CursorAnchor,
  type EditingMode,
} from "@/lib/source-mode";
import { useNote, useNotepad } from "./notepad-provider";
import { SyncIndicator } from "./sync-indicator";

/** What either mode's editor offers: focus, and the cursor's place for carrying it across a switch. */
type BodyHandle = Pick<RichTextModeHandle, "focus" | "selection" | "placeCursor">;

/** Mod+Shift+M switches between rich text mode and source mode. */
const isModeShortcut = (event: KeyboardEvent) =>
  (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "m";

/**
 * The editor for one note, given its id: a title (the note's file name) and its
 * body in rich text mode or source mode, saved to the device as they change. A
 * sync that changes the body is merged into the open mode in place. The mode
 * is remembered per note on this device, and switching carries the cursor to
 * near the same place. Self-contained, so layouts can place it anywhere.
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
  const { login } = store.account;
  const article = useRef<HTMLElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const body = useRef<BodyHandle | null>(null);
  // What the member is typing into the title: the stored title is sanitised, and mustn't fight the keyboard.
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [mode, setMode] = useState<EditingMode>(() => initialMode(deviceStorage(), login, noteId, note?.body ?? ""));
  // After a switch: the cursor to put in the other mode as soon as it exists.
  const carried = useRef<{ anchor: CursorAnchor; focus: boolean } | null>(null);

  useEffect(() => {
    if (!focusTitle) return;
    title.current?.focus();
    title.current?.select();
  }, [focusTitle, noteId]);

  function switchMode(next: EditingMode) {
    if (next === mode) return;
    const location = body.current?.selection();
    const active = document.activeElement;
    const focus = !!active && active !== title.current && (article.current?.contains(active) ?? false);
    carried.current = location ? { anchor: cursorAnchor(location), focus } : null;
    rememberMode(deviceStorage(), login, noteId, next);
    setMode(next);
  }

  /** Both modes attach here; after a switch, the new one receives the carried cursor once its editor exists. */
  const attachBody = useCallback((handle: BodyHandle | null) => {
    body.current = handle;
    const pending = carried.current;
    if (!handle || !pending) return;
    const location = handle.selection();
    if (!location) return;
    carried.current = null;
    const { block, offset } = findAnchor(location.blocks, pending.anchor);
    // The handle attaches while React is still committing, and the editor behind it may still be mounting
    // (rich text mode reconfigures its state as its content mounts): place the cursor once that has settled.
    requestAnimationFrame(() => {
      if (body.current === handle) handle.placeCursor(block, offset, pending.focus);
    });
  }, []);

  if (!note) return null;

  return (
    <article
      ref={article}
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(event) => {
        if (!isModeShortcut(event)) return;
        event.preventDefault();
        switchMode(mode === "source" ? "rich-text" : "source");
      }}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 px-2 md:px-4">
        {onBack && (
          <Button variant="ghost" size="sm" className="md:hidden" onClick={onBack}>
            <ChevronLeft aria-hidden />
            Notes
          </Button>
        )}
        <SyncIndicator note={note} className="ml-auto px-2" />
        <ModeToggle mode={mode} onChange={switchMode} />
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
          {mode === "source" ? (
            <SourceMode
              key={noteId}
              ref={attachBody}
              label="Note text"
              value={note.body}
              onChange={(text) => store.editBody(noteId, text)}
            />
          ) : (
            <RichTextMode
              key={noteId}
              ref={attachBody}
              label="Note text"
              value={note.body}
              onChange={(text) => store.editBody(noteId, text)}
            />
          )}
        </div>
      </div>
    </article>
  );
}
