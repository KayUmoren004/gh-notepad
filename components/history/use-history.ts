"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useNotepad } from "@/components/notes/notepad-provider";
import type { Note } from "@/lib/device-store";
import { groupSessions, type Session, type Version } from "@/lib/history";
import { readNote } from "@/lib/notebook-format";
import { RemoteError } from "@/lib/remote";
import { useOnline } from "./use-online";

export type HistoryState =
  /** Fetching; `sessions` are what the device already knew, if anything. */
  | { kind: "loading"; sessions: Session[] }
  | { kind: "ready"; sessions: Session[] }
  /** No connection: the sessions this device has cached, if any, can still be browsed. */
  | { kind: "offline"; sessions: Session[] }
  | { kind: "failed"; sessions: Session[]; message: string };

export interface History {
  state: HistoryState;
  /** The note's body at that version, from the device cache or the notebook; `null` if the version has no such file. */
  bodyAt: (version: Version) => Promise<string | null>;
  /** Fetches the list again. */
  refresh: () => void;
}

/**
 * A note's history while the panel is open: the version list, cached on the
 * device by the notebook's head commit (a head that hasn't moved means the
 * list hasn't either), fetched anew when the head moves, and the text of
 * versions looked at, cached for good.
 */
export function useHistory(note: Note, open: boolean): History {
  const { store, remote } = useNotepad();
  const online = useOnline();
  const [state, setState] = useState<HistoryState>({ kind: "loading", sessions: [] });
  const [attempt, setAttempt] = useState(0);
  const { id: noteId, notebook, path } = note;

  const readHead = useCallback(() => store.sync.notebook(notebook)?.head ?? null, [store, notebook]);
  const head = useSyncExternalStore(store.subscribe, readHead, readHead);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const location = store.sync.notebook(notebook);

    async function load() {
      const cached = await store.versions.history(notebook, path);
      const known = cached ? groupSessions(cached.versions) : [];
      if (cancelled) return;
      if (cached && head !== null && cached.head === head) {
        setState({ kind: "ready", sessions: known });
        return;
      }
      if (!location?.branch || head === null) {
        // Never synced: there is nothing in the notebook yet.
        setState({ kind: "ready", sessions: known });
        return;
      }
      if (!online) {
        setState({ kind: "offline", sessions: known });
        return;
      }
      setState({ kind: "loading", sessions: known });
      try {
        const versions = await remote.versions({ ...location, branch: location.branch }, path);
        if (cancelled) return;
        await store.versions.rememberHistory({ notebook, path, head, versions });
        if (!cancelled) setState({ kind: "ready", sessions: groupSessions(versions) });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof RemoteError && error.kind === "offline") setState({ kind: "offline", sessions: known });
        else setState({ kind: "failed", sessions: known, message: "History couldn't be loaded" });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, store, remote, notebook, path, head, online, attempt, noteId]);

  const bodyAt = useCallback(
    async (version: Version) => {
      const cached = await store.versions.text(notebook, version.commit, version.path);
      if (cached !== null) return readNote(cached).body;
      const location = store.sync.notebook(notebook);
      if (!location?.branch) return null;
      const text = await remote.fileAt({ ...location, branch: location.branch }, version.commit, version.path);
      if (text === null) return null;
      await store.versions.rememberText(notebook, version.commit, version.path, text);
      return readNote(text).body;
    },
    [store, remote, notebook],
  );

  return { state, bodyAt, refresh: () => setAttempt((count) => count + 1) };
}
