"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Where the layout changes from the phone (tree as the home screen) to the desktop (sidebar beside the editor). */
export const DESKTOP = "(min-width: 768px)";
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether `query` matches now; `false` on the server. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Whether a Mac keyboard (⌘) or another (Ctrl) is in front of the member, for shortcut hints. */
export function modifierLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl+";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
}
