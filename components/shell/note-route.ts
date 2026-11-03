"use client";

import { usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";

const NOTES = "/notes";

/** The note id a `/notes/<id>` path names, or `null` for `/notes` itself. */
export function noteIdOfPath(pathname: string): string | null {
  if (!pathname.startsWith(`${NOTES}/`)) return null;
  const segment = pathname.slice(NOTES.length + 1).split("/")[0];
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function pathOfNote(id: string): string {
  return `${NOTES}/${encodeURIComponent(id)}`;
}

/** What this app put in a history entry when it made one. */
interface NotepadHistoryState {
  /** The path of the entry before this one, when this app made it. */
  notepadFrom?: string;
}

function state(): NotepadHistoryState {
  const current: unknown = window.history.state;
  return typeof current === "object" && current !== null ? (current as NotepadHistoryState) : {};
}

function go(path: string) {
  if (window.location.pathname === path) return;
  // Next.js syncs `usePathname` with pushState, so the page stays mounted and nothing is fetched (ADR 0002:
  // the UI reads only from the device). It copies its own markers into the state; a push that already carries
  // them is taken for one of its own and the URL is not applied, so only our key goes in.
  const data: NotepadHistoryState = { notepadFrom: window.location.pathname };
  window.history.pushState(data, "", path);
}

export interface NoteRoute {
  /** The note the URL names, or `null` on `/notes`. */
  noteId: string | null;
  /** Opens a note: a new history entry, so the browser's Back returns to what was open. */
  open: (id: string) => void;
  /** Closes the note: back to the tree, through the history when the tree is what came before. */
  close: () => void;
}

/**
 * The note open in the URL. `/notes/<id>` is a stable, deep-linkable address
 * for a note; it names the note by id, so renaming the note never changes it.
 */
export function useNoteRoute(): NoteRoute {
  const pathname = usePathname();
  const noteId = useMemo(() => noteIdOfPath(pathname), [pathname]);

  const open = useCallback((id: string) => go(pathOfNote(id)), []);
  const close = useCallback(() => {
    if (state().notepadFrom === NOTES) window.history.back();
    else go(NOTES);
  }, []);

  return useMemo(() => ({ noteId, open, close }), [noteId, open, close]);
}
