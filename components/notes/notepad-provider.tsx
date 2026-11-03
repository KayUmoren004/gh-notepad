"use client";

import { createContext, use, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { openDeviceStore, type Account, type DeviceStore, type Note } from "@/lib/device-store";
import { buildNotebookTrees, recentNotes, type NotebookTree } from "@/lib/notebook-tree";
import { createRemote, type Remote } from "@/lib/remote";
import { createSyncEngine, type SyncEngine, type SyncStatus } from "@/lib/sync-engine";

/** The app's client side for one signed-in member: their device store, its sync engine, and the remote both reach GitHub through. */
export interface Notepad {
  store: DeviceStore;
  engine: SyncEngine;
  /** For reads that aren't part of sync, such as a note's history. */
  remote: Remote;
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
        const remote = createRemote();
        const engine = createSyncEngine({ store, remote });
        engine.start();
        opened = { store, engine, remote };
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

/** Every notebook on the device as a tree of folders and notes, the personal notebook always among them. */
export function useNotebookTrees(): NotebookTree[] {
  const { store } = useNotepad();
  const { notes } = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return useMemo(
    () => buildNotebookTrees(notes.values(), { notebooks: [store.personalNotebook] }),
    [notes, store.personalNotebook],
  );
}

/** The last edited notes, newest first, at most `limit`. */
export function useRecentNotes(limit: number): Note[] {
  const { store } = useNotepad();
  const { notes } = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return useMemo(() => recentNotes(notes.values(), limit), [notes, limit]);
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
