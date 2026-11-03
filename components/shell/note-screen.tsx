"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ScreenPhase = "closed" | "entering" | "open" | "exiting";

export interface NoteScreenProps {
  /** Whether a note is open. */
  open: boolean;
  /** Whether this change of `open` slides (a tap) or jumps (a keyboard action, desktop). */
  animate: boolean;
  onBack: () => void;
  /** Tells the shell where the screen is, so it can keep the note on screen while it slides out. */
  onPhaseChange?: (phase: ScreenPhase) => void;
  children: ReactNode;
}

/** How far from the left edge a drag counts as going back. */
const EDGE_PX = 20;
/** A drag must commit to a direction before the screen follows it. */
const SLOP_PX = 6;

/**
 * Where the note shows. On desktop it is the column beside the sidebar. On a
 * phone it is a full screen pushed over the tree, popped by the back button,
 * the browser's Back, or a drag from the left edge.
 */
export function NoteScreen({ open, animate, onBack, onPhaseChange, children }: NoteScreenProps) {
  const [phase, setPhase] = useState<ScreenPhase>(open ? "open" : "closed");
  const [wasOpen, setWasOpen] = useState(open);
  // A swipe already animated the exit; the route change that follows it jumps.
  const [swiped, setSwiped] = useState(false);
  const screen = useRef<HTMLDivElement>(null);

  // `open` changed: the phase follows, in this same render.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPhase(animate ? "entering" : "open");
    else {
      setPhase(animate && !swiped ? "exiting" : "closed");
      if (swiped) setSwiped(false);
    }
  }

  // Entering: painted off screen first, then let the transition bring it in.
  useLayoutEffect(() => {
    if (phase !== "entering") return;
    void screen.current?.offsetWidth;
    const frame = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  // Exiting ends with the transition, or soon after should it never fire.
  useEffect(() => {
    if (phase !== "exiting") return;
    const timer = setTimeout(() => setPhase("closed"), 400);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === "closed" && screen.current) {
      screen.current.style.translate = "";
      screen.current.style.transition = "";
    }
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  const drag = useRef<{ id: number; x: number; y: number; at: number; engaged: boolean; dropped: boolean } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (drag.current || !event.isPrimary) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), engaged: false, dropped: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    const element = screen.current;
    if (!state || !element || state.id !== event.pointerId || state.dropped) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.engaged) {
      if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return;
      // A vertical drag is a scroll; a drag to the left is nothing.
      if (Math.abs(dy) > Math.abs(dx) || dx < 0) {
        state.dropped = true;
        return;
      }
      state.engaged = true;
      element.style.transition = "none";
    }
    element.style.translate = `${Math.max(0, dx)}px 0`;
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const state = drag.current;
    const element = screen.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    if (!state.engaged || !element) return;
    const dx = Math.max(0, event.clientX - state.x);
    const velocity = dx / Math.max(1, performance.now() - state.at);
    // A flick is enough; otherwise a third of the way.
    const pop = !cancelled && (dx > element.offsetWidth / 3 || velocity > 0.5);
    element.style.transition = "translate var(--duration-base) var(--ease-out), opacity var(--duration-base) var(--ease-out)";
    element.style.translate = pop ? "100% 0" : "0px 0";
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      element.removeEventListener("transitionend", done);
      if (pop) {
        setSwiped(true);
        onBack();
      } else {
        element.style.transition = "";
        element.style.translate = "";
      }
    };
    element.addEventListener("transitionend", done);
    setTimeout(done, 300);
  }

  return (
    <div
      ref={screen}
      data-phase={phase}
      onTransitionEnd={(event) => {
        if (event.target === screen.current && phase === "exiting") setPhase("closed");
      }}
      className={cn(
        "relative flex min-w-0 flex-1 flex-col bg-background",
        // A phone: a full screen over the tree, sliding in from the right and out again.
        "max-md:fixed max-md:inset-0 max-md:z-20 max-md:px-safe max-md:shadow-2xl max-md:shadow-black/40",
        "max-md:transition-[translate,opacity] max-md:duration-(--duration-enter) max-md:ease-drawer",
        "max-md:data-[phase=closed]:hidden",
        "max-md:data-[phase=entering]:translate-x-(--push-offset) max-md:data-[phase=entering]:opacity-0",
        "max-md:data-[phase=exiting]:translate-x-(--push-offset) max-md:data-[phase=exiting]:opacity-0",
      )}
    >
      {children}
      {/* Below the top bar, the left edge takes a drag back to the tree. */}
      <div
        aria-hidden
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onPointerEnd(event, false)}
        onPointerCancel={(event) => onPointerEnd(event, true)}
        style={{ width: EDGE_PX }}
        className="absolute bottom-0 left-0 top-[calc(3rem+env(safe-area-inset-top,0px))] touch-pan-y md:hidden"
      />
    </div>
  );
}
