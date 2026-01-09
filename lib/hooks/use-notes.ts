"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Note, NoteWithMeta, Metadata, SyncStatus } from "../types";
import {
  getCachedNotes,
  setCachedNotes,
  getCachedMetadata,
  setCachedMetadata,
  updateCachedNote,
  deleteCachedNote,
  getSyncQueue,
  addToSyncQueue,
  removeFromSyncQueue,
  getLastSyncTime,
  setLastSyncTime,
  isOnline,
  onOnlineStatusChange,
  generateTempId,
  isTempId,
} from "../offline-storage";

interface UseNotesOptions {
  autoSync?: boolean;
  syncDebounceMs?: number;
}

interface UseNotesReturn {
  notes: NoteWithMeta[];
  metadata: Metadata;
  syncStatus: SyncStatus;
  isLoading: boolean;
  error: string | null;
  createNote: (
    note: Omit<Note, "id" | "createdAt" | "updatedAt">
  ) => Promise<NoteWithMeta>;
  updateNote: (id: string, updates: Partial<Note>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  syncNotes: () => Promise<void>;
  addFolder: (name: string) => Promise<void>;
  removeFolder: (name: string) => Promise<void>;
  addTag: (tag: { name: string; color: string }) => Promise<void>;
  removeTag: (name: string) => Promise<void>;
}

export function useNotes(options: UseNotesOptions = {}): UseNotesReturn {
  const { autoSync = true, syncDebounceMs = 2000 } = options;

  const [notes, setNotes] = useState<NoteWithMeta[]>([]);
  const [metadata, setMetadata] = useState<Metadata>({ folders: [], tags: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: true,
    isSyncing: false,
    lastSyncTime: null,
    pendingChanges: 0,
  });

  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const syncNotesRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // Initialize from cache
  useEffect(() => {
    const cachedNotes = getCachedNotes();
    const cachedMetadata = getCachedMetadata();
    const lastSync = getLastSyncTime();
    const queue = getSyncQueue();

    setNotes(cachedNotes);
    setMetadata(cachedMetadata);
    setSyncStatus((prev) => ({
      ...prev,
      isOnline: isOnline(),
      lastSyncTime: lastSync,
      pendingChanges: queue.length,
    }));

    setIsLoading(false);
  }, []);

  // Monitor online status
  useEffect(() => {
    const unsubscribe = onOnlineStatusChange((online) => {
      setSyncStatus((prev) => ({ ...prev, isOnline: online }));

      if (online && autoSync) {
        // Use ref to always call the latest syncNotes function
        syncNotesRef.current?.();
      }
    });

    return unsubscribe;
  }, [autoSync]);

  // Fetch notes from API
  const fetchNotes = useCallback(async () => {
    if (!isOnline()) return;

    try {
      const response = await fetch("/api/notes");
      if (!response.ok) {
        if (response.status === 401) {
          // Not authenticated, use cached data
          return;
        }
        throw new Error("Failed to fetch notes");
      }

      const data = await response.json();
      setNotes(data.notes);
      setMetadata(data.metadata);
      setCachedNotes(data.notes);
      setCachedMetadata(data.metadata);
      setLastSyncTime(new Date().toISOString());
      setSyncStatus((prev) => ({
        ...prev,
        lastSyncTime: new Date().toISOString(),
      }));
    } catch (err) {
      console.error("Failed to fetch notes:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch notes");
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Sync pending changes
  const syncNotes = useCallback(async () => {
    if (!isOnline()) return;

    const queue = getSyncQueue();
    if (queue.length === 0) {
      await fetchNotes();
      return;
    }

    setSyncStatus((prev) => ({ ...prev, isSyncing: true }));

    for (const action of queue) {
      try {
        if (action.type === "create" && action.note) {
          const response = await fetch("/api/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(action.note),
          });

          if (response.ok) {
            const { note: serverNote } = await response.json();
            // Update local cache with server ID
            setNotes((prev) =>
              prev.map((n) => (n.id === action.noteId ? { ...serverNote } : n))
            );
            removeFromSyncQueue(action.id);
          }
        } else if (action.type === "update" && action.note) {
          const cachedNote = notes.find((n) => n.id === action.noteId);
          if (cachedNote?.sha) {
            const response = await fetch(`/api/notes/${action.noteId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...action.note, sha: cachedNote.sha }),
            });

            if (response.ok) {
              const { note: serverNote } = await response.json();
              setNotes((prev) =>
                prev.map((n) => (n.id === action.noteId ? serverNote : n))
              );
              removeFromSyncQueue(action.id);
            }
          }
        } else if (action.type === "delete") {
          const cachedNote = notes.find((n) => n.id === action.noteId);
          if (cachedNote?.sha && !isTempId(action.noteId)) {
            const response = await fetch(
              `/api/notes/${action.noteId}?sha=${cachedNote.sha}`,
              { method: "DELETE" }
            );

            if (response.ok) {
              removeFromSyncQueue(action.id);
            }
          } else {
            // Temp note, just remove from queue
            removeFromSyncQueue(action.id);
          }
        }
      } catch (err) {
        console.error("Sync error:", err);
      }
    }

    // Refresh from server
    await fetchNotes();

    const remainingQueue = getSyncQueue();
    setSyncStatus((prev) => ({
      ...prev,
      isSyncing: false,
      pendingChanges: remainingQueue.length,
      lastSyncTime: new Date().toISOString(),
    }));
  }, [fetchNotes, notes]);

  // Keep ref in sync with latest syncNotes function
  useEffect(() => {
    syncNotesRef.current = syncNotes;
  }, [syncNotes]);

  // Debounced sync
  const debouncedSync = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(() => {
      if (autoSync && isOnline()) {
        syncNotes();
      }
    }, syncDebounceMs);
  }, [autoSync, syncDebounceMs, syncNotes]);

  // Create note
  const createNote = useCallback(
    async (
      noteData: Omit<Note, "id" | "createdAt" | "updatedAt">
    ): Promise<NoteWithMeta> => {
      const now = new Date().toISOString();
      const tempId = generateTempId();

      const newNote: NoteWithMeta = {
        ...noteData,
        id: tempId,
        createdAt: now,
        updatedAt: now,
      };

      // Update local state immediately
      setNotes((prev) => [newNote, ...prev]);
      updateCachedNote(newNote);

      // Queue for sync
      addToSyncQueue({
        type: "create",
        noteId: tempId,
        note: newNote,
      });

      setSyncStatus((prev) => ({
        ...prev,
        pendingChanges: prev.pendingChanges + 1,
      }));

      debouncedSync();

      return newNote;
    },
    [debouncedSync]
  );

  // Update note
  const updateNote = useCallback(
    async (id: string, updates: Partial<Note>): Promise<void> => {
      const existingNote = notes.find((n) => n.id === id);
      if (!existingNote) return;

      const updatedNote: NoteWithMeta = {
        ...existingNote,
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      // Update local state immediately
      setNotes((prev) => prev.map((n) => (n.id === id ? updatedNote : n)));
      updateCachedNote(updatedNote);

      // Queue for sync
      addToSyncQueue({
        type: "update",
        noteId: id,
        note: updatedNote,
      });

      setSyncStatus((prev) => ({
        ...prev,
        pendingChanges: getSyncQueue().length,
      }));

      debouncedSync();
    },
    [notes, debouncedSync]
  );

  // Delete note
  const deleteNote = useCallback(
    async (id: string): Promise<void> => {
      // Update local state immediately
      setNotes((prev) => prev.filter((n) => n.id !== id));
      deleteCachedNote(id);

      // Queue for sync
      addToSyncQueue({
        type: "delete",
        noteId: id,
      });

      setSyncStatus((prev) => ({
        ...prev,
        pendingChanges: getSyncQueue().length,
      }));

      debouncedSync();
    },
    [debouncedSync]
  );

  // Add folder
  const addFolder = useCallback(
    async (name: string): Promise<void> => {
      if (metadata.folders.includes(name)) return;

      const updatedMetadata = {
        ...metadata,
        folders: [...metadata.folders, name],
      };

      setMetadata(updatedMetadata);
      setCachedMetadata(updatedMetadata);

      if (isOnline()) {
        try {
          await fetch("/api/metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "folder", name }),
          });
        } catch (err) {
          console.error("Failed to add folder:", err);
        }
      }
    },
    [metadata]
  );

  // Remove folder
  const removeFolder = useCallback(
    async (name: string): Promise<void> => {
      const updatedMetadata = {
        ...metadata,
        folders: metadata.folders.filter((f) => f !== name),
      };

      setMetadata(updatedMetadata);
      setCachedMetadata(updatedMetadata);

      if (isOnline()) {
        try {
          await fetch(
            `/api/metadata?type=folder&name=${encodeURIComponent(name)}`,
            {
              method: "DELETE",
            }
          );
        } catch (err) {
          console.error("Failed to remove folder:", err);
        }
      }
    },
    [metadata]
  );

  // Add tag
  const addTag = useCallback(
    async (tag: { name: string; color: string }): Promise<void> => {
      if (metadata.tags.find((t) => t.name === tag.name)) return;

      const updatedMetadata = {
        ...metadata,
        tags: [...metadata.tags, tag],
      };

      setMetadata(updatedMetadata);
      setCachedMetadata(updatedMetadata);

      if (isOnline()) {
        try {
          await fetch("/api/metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "tag", ...tag }),
          });
        } catch (err) {
          console.error("Failed to add tag:", err);
        }
      }
    },
    [metadata]
  );

  // Remove tag
  const removeTag = useCallback(
    async (name: string): Promise<void> => {
      const updatedMetadata = {
        ...metadata,
        tags: metadata.tags.filter((t) => t.name !== name),
      };

      setMetadata(updatedMetadata);
      setCachedMetadata(updatedMetadata);

      if (isOnline()) {
        try {
          await fetch(
            `/api/metadata?type=tag&name=${encodeURIComponent(name)}`,
            {
              method: "DELETE",
            }
          );
        } catch (err) {
          console.error("Failed to remove tag:", err);
        }
      }
    },
    [metadata]
  );

  return {
    notes,
    metadata,
    syncStatus,
    isLoading,
    error,
    createNote,
    updateNote,
    deleteNote,
    syncNotes,
    addFolder,
    removeFolder,
    addTag,
    removeTag,
  };
}
