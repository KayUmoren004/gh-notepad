"use client";

import { useCallback, useSyncExternalStore } from "react";

/*
 * Preferences that belong to this device, not to the notes: whether the
 * sidebar is collapsed, which folders are. They live in localStorage and never
 * sync. Reads and writes are guarded: private windows and blocked storage
 * must leave the app working, just forgetful.
 */

const PREFIX = "notepad.";
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // Nothing to do: the preference holds for this page only.
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** A string preference, `null` until set; the setter takes effect at once in every subscriber. */
export function useDevicePreference(key: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const set = useCallback((next: string | null) => write(key, next), [key]);
  return [value, set];
}
