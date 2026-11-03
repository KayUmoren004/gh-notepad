"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";

/** Something the command palette can do besides opening a note. */
export interface PaletteAction {
  /** Stable, unique: a later registration with the same id replaces the earlier one. */
  id: string;
  label: string;
  /** Words besides the label's that should find the action, space-separated. */
  keywords?: string;
  icon?: LucideIcon;
  run: () => void;
}

const actions = new Map<string, PaletteAction>();
const listeners = new Set<() => void>();
let snapshot: readonly PaletteAction[] = [];

function emit() {
  snapshot = [...actions.values()];
  for (const listener of listeners) listener();
}

/** Lists `action` in the palette until the returned function is called. */
export function registerPaletteAction(action: PaletteAction): () => void {
  actions.set(action.id, action);
  emit();
  return () => {
    if (actions.get(action.id) !== action) return;
    actions.delete(action.id);
    emit();
  };
}

export function subscribePaletteActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The actions registered now, in registration order. */
export function getPaletteActions(): readonly PaletteAction[] {
  return snapshot;
}

/**
 * Lists `action` in the command palette while the calling component is
 * mounted: an action exists exactly when what handles it is on screen. The
 * label and keywords can change between renders; `run` always calls the
 * latest one.
 */
export function usePaletteAction({ id, label, keywords, icon, run }: PaletteAction): void {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  }, [run]);
  useEffect(() => registerPaletteAction({ id, label, keywords, icon, run: () => latest.current() }), [id, label, keywords, icon]);
}
