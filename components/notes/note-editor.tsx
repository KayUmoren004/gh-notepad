"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { HistoryButton, HistoryPanel, useHistoryPanel } from "@/components/history";
import { usePaletteAction } from "@/components/palette";
import { RichTextMode, type RichTextModeHandle } from "@/components/rich-text-mode";
import { TopBar } from "@/components/shell";
import { ModeToggle, SourceMode } from "@/components/source-mode";
import { breadcrumbOf } from "@/lib/notebook-tree";
import { useNoteImages } from "./note-images";
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
import { TagField } from "./tag-field";

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
  /** On a phone, where the note covers the tree, the top bar's back button calls this. */
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
  const images = useNoteImages(note);
  const [mode, setMode] = useState<EditingMode>(() => initialMode(deviceStorage(), login, noteId, note?.body ?? ""));
  // After a switch: the cursor to put in the other mode as soon as it exists.
  const carried = useRef<{ anchor: CursorAnchor; focus: boolean } | null>(null);
  const history = useHistoryPanel();

  useEffect(() => {
    if (!focusTitle) return;
    title.current?.focus();
    title.current?.select();
  }, [focusTitle, noteId]);

  // A pull can re-title the note while its title is focused but not yet typed into (a fresh "Untitled"
  // becomes "Untitled 2" when another device created one at the same moment). The new value drops the
  // selection, so keystrokes would be appended to it: select the whole title again, so the next keystroke
  // still replaces it. A draft is left alone: the member sees what they typed, and renames go on from it.
  const storedTitle = note?.title;
  useLayoutEffect(() => {
    const input = title.current;
    if (titleDraft !== null || !input || document.activeElement !== input) return;
    input.select();
  }, [storedTitle, titleDraft]);

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

  // The palette lists the switch to the other mode while this note is open.
  usePaletteAction({
    id: "switch-mode",
    label: mode === "source" ? "Switch to rich text mode" : "Switch to source mode",
    keywords: "toggle editing markdown",
    run: () => switchMode(mode === "source" ? "rich-text" : "source"),
  });

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
      <TopBar
        crumbs={breadcrumbOf(note)}
        onBack={onBack}
        backLabel={note.folder ? note.folder.slice(note.folder.lastIndexOf("/") + 1) : "Notes"}
      >
        <SyncIndicator note={note} className="px-2" />
        {/* The note's actions: the mode toggle now, history, share and more as their tickets land. */}
        <div data-slot="note-actions" className="flex items-center gap-0.5">
          <ModeToggle mode={mode} onChange={switchMode} />
          <HistoryButton open={history.open} onToggle={() => history.toggle()} />
        </div>
      </TopBar>

      <div className="flex min-h-0 flex-1">
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
          <TagField noteId={noteId} className="-mt-2" />
          {images.element}
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
              {...images.editorProps}
            />
          )}
        </div>
      </div>
      <HistoryPanel note={note} open={history.open} instant={history.instant} onClose={() => history.close()} imageSrc={images.editorProps.imageSrc} />
      </div>
    </article>
  );
}
