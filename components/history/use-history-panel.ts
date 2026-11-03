"use client";

import { History } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { usePaletteAction } from "@/components/palette";

/** An event anything can dispatch on `window` to open the open note's History; `detail.instant` skips the animation. */
export const OPEN_HISTORY_EVENT = "notepad:open-history";

export interface HistoryPanelState {
  open: boolean;
  /** The last change was keyboard-initiated: the panel jumps rather than slides. */
  instant: boolean;
  toggle: (options?: { instant?: boolean }) => void;
  close: (options?: { instant?: boolean }) => void;
}

/**
 * Whether the History panel is open: toggled by its button, opened from the
 * command palette ("Open history", listed while a note is on screen) or by a
 * `notepad:open-history` event. Both of those are keyboard-driven, so they
 * open it without animation.
 */
export function useHistoryPanel(): HistoryPanelState {
  const [state, setState] = useState({ open: false, instant: false });

  const toggle = useCallback(({ instant = false } = {}) => setState((current) => ({ open: !current.open, instant })), []);
  const close = useCallback(({ instant = false } = {}) => setState({ open: false, instant }), []);
  const openInstantly = useCallback(() => setState({ open: true, instant: true }), []);

  usePaletteAction({
    id: "open-history",
    label: "Open history",
    keywords: "versions changes restore previous",
    icon: History,
    run: openInstantly,
  });

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as { instant?: boolean } | null) : null;
      setState({ open: true, instant: detail?.instant !== false });
    };
    window.addEventListener(OPEN_HISTORY_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_HISTORY_EVENT, onOpen);
  }, []);

  return { open: state.open, instant: state.instant, toggle, close };
}
