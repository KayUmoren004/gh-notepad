"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { dropProblem, type DragSource, type DropTarget, type TreeRow } from "@/lib/notebook-tree";

/** A press must travel this far before it is a drag rather than a click. */
const THRESHOLD_PX = 8;
/** Hovering a collapsed folder this long opens it, so a drop can go deeper. */
const EXPAND_AFTER_MS = 600;
/** Dragging this close to the list's top or bottom scrolls it. */
const SCROLL_EDGE_PX = 32;
const SCROLL_STEP_PX = 8;

export interface DragState {
  source: DragSource;
  /** What is being dragged, as the ghost shows it. */
  label: string;
  /** The pointer, in viewport coordinates. */
  x: number;
  y: number;
  /** The row under the pointer, and what dropping there would do. */
  overKey: string | null;
  target: DropTarget | null;
  /** Why the drop can't happen, in the member's words, or `null`. */
  problem: string | null;
}

export interface TreeDragOptions {
  rows: readonly TreeRow[];
  /** The list's scrolling ancestor, scrolled when a drag nears its edges. */
  scroller: RefObject<HTMLElement | null>;
  /** Off on a phone, where a drag is a scroll and "Move to…" does the moving. */
  enabled: boolean;
  onDrop: (source: DragSource, target: DropTarget) => void;
  onExpand: (key: string) => void;
}

export interface TreeDrag {
  drag: DragState | null;
  /** For each row's button: a press that travels far enough becomes a drag. */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, row: TreeRow) => void;
  /** Whether the click that follows a drop should be ignored; asking resets it. */
  consumeClick: () => boolean;
}

/** What dropping on `row` means: into the folder it is, or the folder it is in. */
export function targetOf(row: TreeRow): DropTarget {
  if (row.kind === "notebook") return { notebook: row.notebook.id, folder: "" };
  if (row.kind === "folder") return { notebook: row.folder.notebook, folder: row.folder.path };
  return { notebook: row.note.notebook, folder: row.note.folder };
}

export function sourceOf(row: TreeRow): DragSource | null {
  if (row.kind === "note") {
    const { id, notebook, folder, title } = row.note;
    return { kind: "note", id, notebook, folder, title };
  }
  if (row.kind === "folder") return { kind: "folder", notebook: row.folder.notebook, path: row.folder.path };
  return null;
}

/**
 * Drag and drop in the tree with pointer events: notes and folders go into
 * folders or the notebook's top level. The drop is judged as the pointer
 * moves (`dropProblem`), shown by the cursor and the ghost; nothing moves
 * until the pointer is released over somewhere it may go. Escape cancels.
 */
export function useTreeDrag({ rows, scroller, enabled, onDrop, onExpand }: TreeDragOptions): TreeDrag {
  const [drag, setDrag] = useState<DragState | null>(null);
  const current = useRef<DragState | null>(null);
  const pending = useRef<{ row: TreeRow; x: number; y: number; pointerId: number; element: HTMLElement } | null>(null);
  const latest = useRef({ rows, onDrop, onExpand });
  latest.current = { rows, onDrop, onExpand };
  const suppressClick = useRef(false);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollFrame = useRef<number | undefined>(undefined);
  const listeners = useRef<(() => void) | null>(null);

  // Nothing survives the component: a drag in flight is dropped nowhere.
  useEffect(() => () => listeners.current?.(), []);

  function update(next: DragState | null) {
    current.current = next;
    setDrag(next);
  }

  function rowAt(x: number, y: number): TreeRow | null {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-tree-row]");
    const key = element?.dataset.treeRow;
    return key ? (latest.current.rows.find((row) => row.key === key) ?? null) : null;
  }

  /** Judges the drop at the pointer and shows it. */
  function track(x: number, y: number) {
    const state = current.current;
    const press = pending.current;
    if (!state || !press) return;
    const row = rowAt(x, y);
    const target = row ? targetOf(row) : null;
    const problem = target ? dropProblem(state.source, target) : null;
    if ((row?.key ?? null) !== state.overKey) {
      clearTimeout(expandTimer.current);
      if (row && row.kind !== "note" && !row.expanded) {
        expandTimer.current = setTimeout(() => latest.current.onExpand(row.key), EXPAND_AFTER_MS);
      }
    }
    press.element.style.cursor = problem ? "not-allowed" : "grabbing";
    update({ ...state, x, y, overKey: row?.key ?? null, target, problem });
  }

  function autoScroll() {
    const state = current.current;
    const element = scroller.current;
    if (!state || !element) return;
    const box = element.getBoundingClientRect();
    if (state.y < box.top + SCROLL_EDGE_PX && element.scrollTop > 0) {
      element.scrollTop -= SCROLL_STEP_PX;
      track(state.x, state.y);
    } else if (state.y > box.bottom - SCROLL_EDGE_PX) {
      element.scrollTop += SCROLL_STEP_PX;
      track(state.x, state.y);
    }
    scrollFrame.current = requestAnimationFrame(autoScroll);
  }

  function finish({ drop }: { drop: boolean }) {
    listeners.current?.();
    listeners.current = null;
    clearTimeout(expandTimer.current);
    if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
    const press = pending.current;
    const state = current.current;
    pending.current = null;
    if (press) {
      press.element.style.cursor = "";
      try {
        press.element.releasePointerCapture(press.pointerId);
      } catch {
        // The capture is already gone.
      }
    }
    if (!state) return;
    suppressClick.current = true;
    update(null);
    if (drop && state.target && !state.problem) latest.current.onDrop(state.source, state.target);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>, row: TreeRow) {
    suppressClick.current = false;
    if (!enabled || pending.current || event.pointerType !== "mouse" || event.button !== 0 || !event.isPrimary) return;
    const source = sourceOf(row);
    if (!source) return;
    const press = { row, x: event.clientX, y: event.clientY, pointerId: event.pointerId, element: event.currentTarget };
    pending.current = press;

    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== press.pointerId) return;
      if (!current.current) {
        if (Math.hypot(move.clientX - press.x, move.clientY - press.y) < THRESHOLD_PX) return;
        try {
          press.element.setPointerCapture(press.pointerId);
        } catch {
          // Some elements refuse capture; the window listeners still see the pointer.
        }
        update({ source, label: row.label, x: move.clientX, y: move.clientY, overKey: null, target: null, problem: null });
        scrollFrame.current = requestAnimationFrame(autoScroll);
      }
      track(move.clientX, move.clientY);
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId === press.pointerId) finish({ drop: true });
    };
    const onCancel = (cancel: PointerEvent) => {
      if (cancel.pointerId === press.pointerId) finish({ drop: false });
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key === "Escape") finish({ drop: false });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    listeners.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }

  return {
    drag,
    onPointerDown,
    consumeClick: () => {
      const suppress = suppressClick.current;
      suppressClick.current = false;
      return suppress;
    },
  };
}
