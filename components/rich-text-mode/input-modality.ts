"use client";

import { type RefObject, useEffect, useRef } from "react";

export type InputModality = "pointer" | "keyboard";

/**
 * Whether the member last used a pointer or the keyboard. Popovers opened by
 * the keyboard (typing `/`, selecting with Shift+arrows) appear instantly;
 * only pointer-opened ones animate in.
 */
export function useInputModality(): RefObject<InputModality> {
  const modality = useRef<InputModality>("keyboard");
  useEffect(() => {
    const pointer = () => {
      modality.current = "pointer";
    };
    const keyboard = () => {
      modality.current = "keyboard";
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, []);
  return modality;
}

/** Whether the primary pointer is coarse (a finger), which gets the formatting bar above the keyboard. */
export function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}
