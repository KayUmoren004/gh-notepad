import type { Note, NoteWithMeta, Metadata, SyncAction } from './types';

const STORAGE_KEYS = {
  NOTES_CACHE: 'gh-notepad-notes',
  METADATA_CACHE: 'gh-notepad-metadata',
  SYNC_QUEUE: 'gh-notepad-sync-queue',
  LAST_SYNC: 'gh-notepad-last-sync',
};

// Check if we're in a browser environment
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

// Notes cache operations
export function getCachedNotes(): NoteWithMeta[] {
  if (!isBrowser()) return [];

  try {
    const cached = localStorage.getItem(STORAGE_KEYS.NOTES_CACHE);
    return cached ? JSON.parse(cached) : [];
  } catch {
    return [];
  }
}

export function setCachedNotes(notes: NoteWithMeta[]): void {
  if (!isBrowser()) return;

  try {
    localStorage.setItem(STORAGE_KEYS.NOTES_CACHE, JSON.stringify(notes));
  } catch (e) {
    console.error('Failed to cache notes:', e);
  }
}

export function getCachedNoteById(id: string): NoteWithMeta | null {
  const notes = getCachedNotes();
  return notes.find((n) => n.id === id) || null;
}

export function updateCachedNote(note: NoteWithMeta): void {
  const notes = getCachedNotes();
  const index = notes.findIndex((n) => n.id === note.id);

  if (index >= 0) {
    notes[index] = note;
  } else {
    notes.unshift(note);
  }

  setCachedNotes(notes);
}

export function deleteCachedNote(id: string): void {
  const notes = getCachedNotes();
  setCachedNotes(notes.filter((n) => n.id !== id));
}

// Metadata cache operations
export function getCachedMetadata(): Metadata {
  if (!isBrowser()) return { folders: [], tags: [] };

  try {
    const cached = localStorage.getItem(STORAGE_KEYS.METADATA_CACHE);
    return cached ? JSON.parse(cached) : { folders: [], tags: [] };
  } catch {
    return { folders: [], tags: [] };
  }
}

export function setCachedMetadata(metadata: Metadata): void {
  if (!isBrowser()) return;

  try {
    localStorage.setItem(STORAGE_KEYS.METADATA_CACHE, JSON.stringify(metadata));
  } catch (e) {
    console.error('Failed to cache metadata:', e);
  }
}

// Sync queue operations
export function getSyncQueue(): SyncAction[] {
  if (!isBrowser()) return [];

  try {
    const queue = localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
    return queue ? JSON.parse(queue) : [];
  } catch {
    return [];
  }
}

export function addToSyncQueue(action: Omit<SyncAction, 'id' | 'timestamp'>): void {
  if (!isBrowser()) return;

  const queue = getSyncQueue();
  const newAction: SyncAction = {
    ...action,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };

  // Remove any existing actions for the same note
  const filteredQueue = queue.filter((a) => a.noteId !== action.noteId);
  filteredQueue.push(newAction);

  try {
    localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(filteredQueue));
  } catch (e) {
    console.error('Failed to update sync queue:', e);
  }
}

export function removeFromSyncQueue(actionId: string): void {
  const queue = getSyncQueue();
  const filteredQueue = queue.filter((a) => a.id !== actionId);

  try {
    localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(filteredQueue));
  } catch (e) {
    console.error('Failed to update sync queue:', e);
  }
}

export function clearSyncQueue(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(STORAGE_KEYS.SYNC_QUEUE);
}

// Last sync time operations
export function getLastSyncTime(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(STORAGE_KEYS.LAST_SYNC);
}

export function setLastSyncTime(time: string): void {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_KEYS.LAST_SYNC, time);
}

// Clear all cached data
export function clearAllCache(): void {
  if (!isBrowser()) return;

  Object.values(STORAGE_KEYS).forEach((key) => {
    localStorage.removeItem(key);
  });
}

// Online/offline detection
export function isOnline(): boolean {
  if (!isBrowser()) return true;
  return navigator.onLine;
}

export function onOnlineStatusChange(callback: (isOnline: boolean) => void): () => void {
  if (!isBrowser()) return () => {};

  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}

// Generate a temporary ID for notes created offline
export function generateTempId(): string {
  return `temp-${crypto.randomUUID()}`;
}

export function isTempId(id: string): boolean {
  return id.startsWith('temp-');
}
