"use client";

import { useLayoutEffect, useRef, type Ref } from "react";
import { cn } from "@/lib/utils";

export interface BodyFieldProps {
  /** The note's Markdown body. */
  value: string;
  /** Called with the whole body after every change the member makes. */
  onChange: (body: string) => void;
  className?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

/**
 * The plain body field: Markdown in, Markdown out. A change from elsewhere (a
 * sync) is written into the field in place, keeping the caret where it was,
 * rather than re-rendering over what the member is doing. Rich text mode
 * replaces this component with the same props.
 */
export function BodyField({ value, onChange, className, ref }: BodyFieldProps) {
  const field = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const element = field.current;
    if (!element || element.value === value) return;
    const { selectionStart, selectionEnd } = element;
    element.value = value;
    if (document.activeElement === element) {
      element.setSelectionRange(Math.min(selectionStart, value.length), Math.min(selectionEnd, value.length));
    }
  }, [value]);

  return (
    <textarea
      ref={(element) => {
        field.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      }}
      aria-label="Note text"
      placeholder="Start writing…"
      defaultValue={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      spellCheck
      className={cn(
        "field-sizing-content min-h-96 w-full resize-none bg-transparent leading-relaxed text-foreground outline-none placeholder:text-muted-foreground",
        className,
      )}
    />
  );
}
