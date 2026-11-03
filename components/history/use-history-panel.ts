"use client";

import { useCallback, useEffect, useState } from "react";

/** The event the command palette dispatches on `window` to open a note's History; `detail.instant` skips the animation. */
export const OPEN_HISTORY_EVENT = "notepad:open-history";

export interface HistoryPanelState {
  open: boolean;
  /** The last change was keyboard-initiated: the panel jumps rather than slides. */
  instant: boolean;
  toggle: (options?: { instant?: boolean }) => void;
  close: (options?: { instant?: boolean }) => void;
}

/** Whether the History panel is open, toggled by its button or by `notepad:open-history` from the command palette. */
export function useHistoryPanel(): HistoryPanelState {
  const [state, setState] = useState({ open: false, instant: false });

  const toggle = useCallback(({ instant = false } = {}) => setState((current) => ({ open: !current.open, instant })), []);
  const close = useCallback(({ instant = false } = {}) => setState({ open: false, instant }), []);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as { instant?: boolean } | null) : null;
      // The palette is driven from the keyboard, so an open from it never animates unless it says so.
      setState({ open: true, instant: detail?.instant !== false });
    };
    window.addEventListener(OPEN_HISTORY_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_HISTORY_EVENT, onOpen);
  }, []);

  return { open: state.open, instant: state.instant, toggle, close };
}
