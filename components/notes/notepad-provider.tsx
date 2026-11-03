"use client";

import { createContext, use, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { openDeviceStore, type Account, type DeviceStore, type Note } from "@/lib/device-store";
import { buildNotebookTrees, notebookName, recentNotes, type NotebookTree } from "@/lib/notebook-tree";
import { createRemote, type Remote } from "@/lib/remote";
import { createSyncEngine, type SyncEngine, type SyncStatus } from "@/lib/sync-engine";

/** The app's client side for one signed-in member: their device store, its sync engine, and the remote both reach GitHub through. */
export interface Notepad {
  store: DeviceStore;
  engine: SyncEngine;
  remote: Remote;
}

/** A notebook on this device, as the shell names it. */
export interface NotebookSummary {
  id: string;
  /** The repository's name: what the sidebar shows. */
  name: string;
  owner: string;
  repo: string;
  kind: "personal" | "shared";
  /** Whether the member owns it (and manages its collaborators) or collaborates on it. */
  role: "owner" | "collaborator";
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

/** Every notebook on the device as a tree of folders and notes: the personal notebook first (always there), then the shared ones by name. */
export function useNotebookTrees(): NotebookTree[] {
  const { store } = useNotepad();
  const { notes, notebooks } = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return useMemo(() => {
    const trees = buildNotebookTrees(notes.values(), { notebooks: [store.personalNotebook, ...notebooks.keys()] });
    return [...trees.filter((tree) => tree.id === store.personalNotebook), ...trees.filter((tree) => tree.id !== store.personalNotebook)];
  }, [notes, notebooks, store.personalNotebook]);
}

/** Every notebook on the device: the personal notebook first, then the shared ones by name. */
export function useNotebooks(): NotebookSummary[] {
  const { store } = useNotepad();
  const { notebooks } = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return useMemo(() => {
    const { login } = store.account;
    const [personalOwner] = store.personalNotebook.split("/");
    const summaries = new Map<string, NotebookSummary>();
    summaries.set(store.personalNotebook, {
      id: store.personalNotebook,
      name: notebookName(store.personalNotebook),
      owner: personalOwner,
      repo: notebookName(store.personalNotebook),
      kind: "personal",
      role: "owner",
    });
    for (const notebook of notebooks.values()) {
      if (summaries.has(notebook.id)) continue;
      summaries.set(notebook.id, {
        id: notebook.id,
        name: notebookName(notebook.id),
        owner: notebook.owner,
        repo: notebook.repo,
        kind: "shared",
        role: notebook.owner.toLowerCase() === login.toLowerCase() ? "owner" : "collaborator",
      });
    }
    const [personal, ...shared] = summaries.values();
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    shared.sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
    return [personal, ...shared];
  }, [notebooks, store.account, store.personalNotebook]);
}

/** One notebook by id, or `undefined` once it has left the device. */
export function useNotebook(id: string): NotebookSummary | undefined {
  const notebooks = useNotebooks();
  return notebooks.find((notebook) => notebook.id === id);
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
