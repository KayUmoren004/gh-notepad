import { deviceKey } from "@/lib/device-store";
import { hasMarkdownSource } from "@/lib/rich-text";

/** How a note is being edited: as formatting, or as its Markdown. */
export type EditingMode = "rich-text" | "source";

/** What's needed of `localStorage`. */
export interface ModeStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

// Under the account's prefix, so "Remove notes from this device" forgets it with everything else.
const key = (login: string, noteId: string) => deviceKey(login, `editing-mode:${noteId}`);

/** This browser's `localStorage`, or null where it's unavailable or blocked. */
export function deviceStorage(): ModeStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The mode the member last chose for this note on this device, if any. */
export function rememberedMode(storage: ModeStorage | null, login: string, noteId: string): EditingMode | null {
  try {
    const stored = storage?.getItem(key(login, noteId));
    return stored === "rich-text" || stored === "source" ? stored : null;
  } catch {
    return null;
  }
}

export function rememberMode(storage: ModeStorage | null, login: string, noteId: string, mode: EditingMode): void {
  try {
    storage?.setItem(key(login, noteId), mode);
  } catch {
    // Storage that is full or blocked just doesn't remember.
  }
}

/**
 * The mode a note opens in: the one chosen for it on this device, or else
 * source mode for a note with Markdown rich text mode can't show as
 * formatting, and rich text mode for everything else.
 */
export function initialMode(storage: ModeStorage | null, login: string, noteId: string, body: string): EditingMode {
  return rememberedMode(storage, login, noteId) ?? (hasMarkdownSource(body) ? "source" : "rich-text");
}
