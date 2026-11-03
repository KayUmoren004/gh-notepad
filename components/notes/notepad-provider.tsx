"use client";

import { createContext, use, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { openDeviceStore, type Account, type DeviceStore, type Note } from "@/lib/device-store";
import { buildNotebookTrees, recentNotes, type NotebookTree } from "@/lib/notebook-tree";
import { createRemote } from "@/lib/remote";
import { createSyncEngine, type SyncEngine, type SyncStatus } from "@/lib/sync-engine";
import { filterByTags, indexTags, type TagIndex } from "@/lib/tags";

/** The app's client side for one signed-in member: their device store and its sync engine. */
export interface Notepad {
  store: DeviceStore;
  engine: SyncEngine;
}

const NotepadContext = createContext<Notepad | null>(null);

/**
 * Opens the member's device store, starts background sync, and provides both
 * to everything inside. Renders `fallback` until the device's notes are loaded.
 */
export function NotepadProvider({
  account,
  fallback,
  children,
}: {
  account: Account;
  fallback: ReactNode;
  children: ReactNode;
}) {
  const [notepad, setNotepad] = useState<Notepad | null>(null);
  const [failed, setFailed] = useState(false);
  const { id, login } = account;

  useEffect(() => {
    let cancelled = false;
    let opened: Notepad | null = null;
    openDeviceStore({ account: { id, login } }).then(
      (store) => {
        if (cancelled) {
          void store.close();
          return;
        }
        const engine = createSyncEngine({ store, remote: createRemote() });
        engine.start();
        opened = { store, engine };
        setNotepad(opened);
      },
      (error: unknown) => {
        console.error("Opening this device's notes failed", error);
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      if (opened) {
        opened.engine.stop();
        void opened.store.close();
      }
      setNotepad(null);
    };
  }, [id, login]);

  if (failed) {
    return (
      <p role="alert" className="m-auto max-w-sm px-6 text-center text-sm text-muted-foreground">
        This browser won&apos;t let the notepad store notes on this device. Private browsing modes sometimes block it.
      </p>
    );
  }
  if (!notepad) return fallback;
  return <NotepadContext value={notepad}>{children}</NotepadContext>;
}

export function useNotepad(): Notepad {
  const notepad = use(NotepadContext);
  if (!notepad) throw new Error("useNotepad needs a NotepadProvider");
  return notepad;
}

/** Every note on the device, by title. */
export function useNotes(): Note[] {
  const { store } = useNotepad();
  const { notes } = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return useMemo(
    () =>
      [...notes.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" })),
    [notes],
  );
}

/** Narrows the notes a list shows: with `tags`, only the notes carrying every one of them. */
export interface NoteListOptions {
  tags?: readonly string[];
}

/** The tag option as a stable value, so a caller passing a fresh array each render doesn't recompute. */
function useTagSelection(tags: readonly string[] | undefined): readonly string[] {
  const joined = tags?.join("\u0000") ?? "";
  return useMemo(() => (joined ? joined.split("\u0000") : []), [joined]);
}

/**
 * Every notebook on the device as a tree of folders and notes, the personal
 * notebook always among them. With `tags`, only the matching notes and the
 * folders holding them.
 */
export function useNotebookTrees({ tags }: NoteListOptions = {}): NotebookTree[] {
  const { store } = useNotepad();
  const { notes } = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const selected = useTagSelection(tags);
  return useMemo(
    () => buildNotebookTrees(filterByTags(notes.values(), selected), { notebooks: [store.personalNotebook] }),
    [notes, selected, store.personalNotebook],
  );
}

/** The last edited notes, newest first, at most `limit`; with `tags`, among the matching notes only. */
export function useRecentNotes(limit: number, { tags }: NoteListOptions = {}): Note[] {
  const { store } = useNotepad();
  const { notes } = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const selected = useTagSelection(tags);
  return useMemo(() => recentNotes(filterByTags(notes.values(), selected), limit), [notes, selected, limit]);
}

/** Every tag across the device's notebooks, with how many notes carry each. */
export function useTagIndex(): TagIndex {
  const { store } = useNotepad();
  const { notes } = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return useMemo(() => indexTags(notes.values()), [notes]);
}

/** One note, re-rendering only when that note changes. */
export function useNote(id: string): Note | undefined {
  const { store } = useNotepad();
  const read = () => store.note(id);
  return useSyncExternalStore(store.subscribe, read, read);
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useNotepad();
  return useSyncExternalStore(engine.subscribe, engine.getStatus, engine.getStatus);
}
