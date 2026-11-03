"use client";

import { useEffect } from "react";

export interface Shortcuts {
  /** ⌘N / Ctrl+N. */
  newNote: () => void;
  /** ⌘\ / Ctrl+\. */
  toggleSidebar: () => void;
  /** ⌘K / Ctrl+K: the command palette, open or closed. */
  search: () => void;
}

/**
 * The shell's keyboard shortcuts, on the window so they work from the editor
 * too. Everything they do happens without animation: keyboard actions are
 * repeated all day, and motion would only make them feel slow.
 */
export function useShortcuts({ newNote, toggleSidebar, search }: Shortcuts) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.repeat || event.isComposing) return;
      const key = event.key.toLowerCase();
      const action = key === "n" ? newNote : key === "k" ? search : event.key === "\\" ? toggleSidebar : null;
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newNote, toggleSidebar, search]);
}
